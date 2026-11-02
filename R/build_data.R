# Labour Cost Atlas: data build
#
# Pulls every public source used in the project, harmonises it to one country list
# (config/countries.csv) and writes compact tables for the website:
#
#   data/sector.csv    national accounts by country x NACE sector x year (Eurostat)
#   data/country.csv   country-level metrics, long format (Eurostat + ILOSTAT)
#   data/industry.csv  FDI-intensive industries from structural business statistics
#   data/meta.json     build time, per-source status and row counts
#
# Each source is fetched independently: one failing source is logged in meta.json
# and does not stop the build. The build only fails if the core national accounts
# are missing or the manufacturing branches do not tile C.

suppressPackageStartupMessages({
  library(eurostat)
  library(dplyr)
  library(tidyr)
  library(readr)
  library(jsonlite)
})

year_min  <- 2000
countries <- read_csv("config/countries.csv", show_col_types = FALSE,
                      col_types = cols(.default = "c"))
sectors   <- read_csv("config/sectors.csv", show_col_types = FALSE)
geos      <- countries$geo
status    <- list()

log_status <- function(name, ok, rows = 0, note = "") {
  status[[name]] <<- list(ok = ok, rows = rows, note = note)
  message(sprintf("[%s] %s rows=%s %s", if (ok) "OK" else "FAIL", name, rows, note))
}

# Run a source fetch; on error record the failure and return NULL
safely_fetch <- function(name, expr) {
  out <- tryCatch(expr, error = function(e) { log_status(name, FALSE, 0, conditionMessage(e)); NULL })
  if (!is.null(out)) log_status(name, TRUE, nrow(out))
  out
}

# eurostat >= 4 names the time column TIME_PERIOD; older versions use `time`
fix_time <- function(x) {
  if ("TIME_PERIOD" %in% names(x)) x <- rename(x, time = TIME_PERIOD)
  x %>% mutate(period = as.character(time),
               year = as.integer(substr(period, 1, 4)))
}

estat <- function(id) {
  message("Downloading ", id, " ...")
  x <- get_eurostat(id, time_format = "raw", cache = FALSE) %>% fix_time()
  x %>% filter(geo %in% geos, year >= year_min)
}

show_codes <- function(x, col) {
  if (col %in% names(x)) message("  ", col, ": ", paste(sort(unique(x[[col]])), collapse = ", "))
}

# ---- 1. National accounts by sector (core) -----------------------------------
src_codes <- union(setdiff(unique(sectors$nace), "C_RESID"), c("C", "C26", "C29"))

a64 <- safely_fetch("eurostat:nama_10_a64", {
  x <- estat("nama_10_a64") %>% filter(nace_r2 %in% src_codes)
  show_codes(x, "na_item")
  x %>%
    filter((na_item == "B1G" & unit %in% c("CLV20_MEUR", "CP_MEUR")) |
           (na_item %in% c("D1", "D11", "D29X39") & unit == "CP_MEUR")) %>%
    mutate(var = case_when(
      na_item == "B1G" & unit == "CLV20_MEUR" ~ "gva_real",
      na_item == "B1G"                        ~ "gva_nom",
      na_item == "D1"                         ~ "comp",
      na_item == "D11"                        ~ "wages",
      na_item == "D29X39"                     ~ "otax"))
})

a64e <- safely_fetch("eurostat:nama_10_a64_e", {
  x <- estat("nama_10_a64_e") %>% filter(nace_r2 %in% src_codes)
  x %>%
    filter(na_item %in% c("EMP_DC", "SAL_DC"), unit %in% c("THS_PER", "THS_HW")) %>%
    mutate(var = paste0(ifelse(na_item == "EMP_DC", "emp", "sal"),
                        ifelse(unit == "THS_HW", "_hours", "")))
})

if (is.null(a64) || is.null(a64e)) stop("Core national accounts could not be downloaded.")

raw <- bind_rows(a64, a64e) %>%
  select(geo, nace = nace_r2, year, var, value = values) %>%
  filter(!is.na(value)) %>%
  distinct(geo, nace, year, var, .keep_all = TRUE) %>%
  pivot_wider(names_from = var, values_from = value)

# Residual manufacturing = C - C26 - C29 (exact for nominal and headcounts,
# approximate for chain-linked volumes)
resid <- raw %>%
  filter(nace %in% c("C", "C26", "C29")) %>%
  pivot_longer(-c(geo, nace, year), names_to = "var") %>%
  pivot_wider(names_from = nace, values_from = value) %>%
  mutate(value = C - C26 - C29, nace = "C_RESID") %>%
  select(geo, nace, year, var, value) %>%
  filter(!is.na(value)) %>%
  pivot_wider(names_from = var, values_from = value)

col_or_na <- function(df, col) if (col %in% names(df)) df[[col]] else NA_real_

sector <- bind_rows(raw, resid) %>%
  filter(nace %in% sectors$nace) %>%
  mutate(
    otax      = col_or_na(., "otax"),
    gos       = gva_nom - comp - otax,             # gross operating surplus and mixed income
    emp_hours = col_or_na(., "emp_hours"),
    sal_hours = col_or_na(., "sal_hours"),
    prod          = gva_real / emp * 1000,             # EUR (2020 prices) per person employed
    prod_hour     = gva_real / emp_hours * 1000,       # EUR (2020 prices) per hour worked
    comp_pe       = comp / sal * 1000,                 # EUR per employee
    comp_ph       = comp / sal_hours * 1000,           # EUR per employee hour
    ulc           = comp_pe / prod,                    # nominal ULC ratio
    labour_share  = comp / gva_nom,
    adj_labour_share = (comp / sal) * emp / gva_nom,   # imputes self-employed income at employee pay
    profit_share  = gos / gva_nom,
    employer_rate = (comp - wages) / wages,            # employer social contributions / gross wages
    hours_worker  = emp_hours / emp                    # annual hours per person employed
  ) %>%
  select(geo, nace, year, gva_real, gva_nom, comp, emp, emp_hours,
         prod, prod_hour, comp_pe, comp_ph, ulc, labour_share, adj_labour_share,
         profit_share, employer_rate, hours_worker) %>%
  mutate(across(where(is.double), ~ ifelse(is.finite(.x), signif(.x, 5), NA_real_))) %>%
  arrange(geo, nace, year)

# ---- 2. Country-level Eurostat metrics ----------------------------------------
country_long <- list()

# Statutory monthly minimum wage (EUR and PPS), semi-annual -> latest semester per year
mw <- safely_fetch("eurostat:earn_mw_cur", {
  x <- estat("earn_mw_cur")
  show_codes(x, "currency")
  x %>% filter(currency %in% c("EUR", "PPS"), !is.na(values)) %>%
    group_by(geo, year, currency) %>% slice_max(period, n = 1, with_ties = FALSE) %>% ungroup() %>%
    transmute(geo, year, metric = ifelse(currency == "EUR", "min_wage_eur", "min_wage_pps"), value = values)
})
country_long$mw <- mw

# Minimum wage relative to mean earnings (Kaitz-type ratio)
kaitz <- safely_fetch("eurostat:earn_mw_avgr2", {
  x <- estat("earn_mw_avgr2")
  show_codes(x, "indic_se"); show_codes(x, "nace_r2")
  ind <- intersect(c("MMW_MEAN_ME_PP", "MMW_MEAN_ME"), unique(x$indic_se))
  if (!length(ind)) ind <- sort(unique(x$indic_se))[1]
  x %>% filter(indic_se == ind[1], nace_r2 %in% c("B-S", "B-S_X_O"), !is.na(values)) %>%
    group_by(geo, year) %>% slice_head(n = 1) %>% ungroup() %>%
    transmute(geo, year, metric = "min_wage_ratio", value = values / 100)
})
country_long$kaitz <- kaitz

# Tax wedge on labour cost, single earner without children at 100% of average wage
wedge <- safely_fetch("eurostat:earn_nt_taxwedge", {
  x <- estat("earn_nt_taxwedge")
  message("  columns: ", paste(names(x), collapse = ", "))
  show_codes(x, "unit")
  ecol <- intersect(c("ecase", "estruct", "e_case"), names(x))[1]
  if (!is.na(ecol)) {
    ec <- grep("P1_NCH_AW100$", unique(x[[ecol]]), value = TRUE)
    if (length(ec)) x <- x %>% filter(.data[[ecol]] == ec[1])
  }
  x %>% filter(!is.na(values)) %>%
    distinct(geo, year, .keep_all = TRUE) %>%
    transmute(geo, year, metric = "tax_wedge", value = values / 100)
})
country_long$wedge <- wedge

# Hourly labour cost levels and their composition (labour cost survey based)
lc <- safely_fetch("eurostat:lc_lci_lev", {
  x <- estat("lc_lci_lev")
  show_codes(x, "lcstruct"); show_codes(x, "unit")
  show_codes(x, "nace_r2")
  prefs <- c("B-S_X_O", "B-S", "B-N")
  tot <- x %>% filter(unit == "EUR", nace_r2 %in% prefs, !is.na(values)) %>%
    mutate(rank = match(nace_r2, prefs)) %>%
    group_by(geo, year) %>% filter(rank == min(rank)) %>% ungroup() %>%
    mutate(nace_r2 = "TOTAL") %>% select(-rank)
  x <- bind_rows(tot, x %>% filter(unit == "EUR", nace_r2 == "C", !is.na(values)))
  w <- x %>% select(geo, year, nace_r2, lcstruct, values) %>%
    pivot_wider(names_from = lcstruct, values_from = values)
  bind_rows(
    w %>% transmute(geo, year, metric = ifelse(nace_r2 == "C", "lc_hour_c", "lc_hour"),
                    value = col_or_na(w, "D1_D4_MD5")),
    w %>% transmute(geo, year, metric = ifelse(nace_r2 == "C", "nonwage_share_c", "nonwage_share"),
                    value = col_or_na(w, "D12_D4_MD5") / col_or_na(w, "D1_D4_MD5"))
  ) %>% filter(!is.na(value))
})
country_long$lc <- lc

# ---- 3. ILOSTAT (covers North and Sub-Saharan Africa) ---------------------------
ilo_ok <- requireNamespace("Rilostat", quietly = TRUE)
iso_map <- countries %>% filter(!is.na(iso3), geo != "EU27_2020") %>% select(geo, ref_area = iso3)

ilo <- function(id, name) safely_fetch(paste0("ilostat:", name), {
  if (!ilo_ok) stop("Rilostat not installed")
  x <- Rilostat::get_ilostat(id, cache = FALSE, quiet = TRUE)
  message("  ", id, " columns: ", paste(names(x), collapse = ", "), " rows=", nrow(x))
  if (!nrow(x)) stop("no rows returned for ", id)
  x <- x %>% filter(ref_area %in% iso_map$ref_area) %>%
    mutate(year = as.integer(substr(as.character(time), 1, 4))) %>%
    filter(year >= year_min, year <= as.integer(format(Sys.Date(), "%Y")) - 1, !is.na(obs_value))
  show_codes(x, "classif1"); show_codes(x, "classif2")
  x %>% inner_join(iso_map, by = "ref_area")
})

pick_first <- function(x, col, prefs) {
  x %>% filter(.data[[col]] %in% prefs) %>%
    mutate(rank = match(.data[[col]], prefs)) %>%
    group_by(geo, year) %>% slice_min(rank, n = 1, with_ties = FALSE) %>% ungroup()
}

hrs <- ilo("HOW_TEMP_SEX_ECO_NB_A", "weekly_hours")
if (!is.null(hrs)) tryCatch({
  hrs <- hrs %>% filter(sex == "SEX_T")
  tot <- pick_first(hrs, "classif1", c("ECO_AGGREGATE_TOTAL", "ECO_SECTOR_TOTAL", "ECO_ISIC4_TOTAL"))
  man <- pick_first(hrs, "classif1", c("ECO_ISIC4_C", "ECO_AGGREGATE_MAN", "ECO_ISIC3_D"))
  country_long$hrs <- bind_rows(
    tot %>% transmute(geo, year, metric = "hours_week", value = obs_value),
    man %>% transmute(geo, year, metric = "hours_week_c", value = obs_value))
}, error = function(e) message("  post-processing failed for hrs: ", conditionMessage(e)))

opw <- NULL
for (id in c("GDP_211P_NOC_NB_A", "GDP_205U_NOC_NB_A")) {
  opw <- ilo(id, paste0("output_per_worker_", id))
  if (!is.null(opw) && nrow(opw)) {
    country_long$opw <- opw %>% transmute(geo, year,
      metric = ifelse(id == "GDP_211P_NOC_NB_A", "ilo_output_worker_ppp", "ilo_output_worker_usd"),
      value = obs_value)
    break
  }
}

# Find the current ids for earnings and minimum wage in the ILOSTAT catalogue
toc_ids <- tryCatch({
  toc <- Rilostat::get_ilostat_toc()
  ids <- grep("^EAR_4M", toc$id, value = TRUE)
  message("  ILOSTAT EAR_4M* ids: ", paste(ids, collapse = ", "))
  ids
}, error = function(e) character())
first_id <- function(cands) { hit <- intersect(cands, toc_ids); if (length(hit)) hit[1] else cands[1] }
earn <- ilo(first_id(c("EAR_4MTH_SEX_ECO_CUR_NB_A", "EAR_4MTH_SEX_CUR_NB_A", "EAR_4MTH_SEX_OCU_CUR_NB_A")), "monthly_earnings")
if (!is.null(earn) && !"classif1" %in% names(earn)) earn$classif1 <- "ECO_AGGREGATE_TOTAL"
if (!is.null(earn) && !"classif2" %in% names(earn)) earn <- earn %>% rename(classif2 = classif1) %>% mutate(classif1 = "ECO_AGGREGATE_TOTAL")
if (!is.null(earn)) tryCatch({
  e <- earn %>% filter(sex == "SEX_T", classif2 %in% c("CUR_TYPE_USD", "CUR_TYPE_PPP"))
  tot <- e %>% pick_first("classif1", c("ECO_AGGREGATE_TOTAL", "ECO_SECTOR_TOTAL", "ECO_ISIC4_TOTAL"))
  country_long$earn <- bind_rows(
    e %>% filter(classif1 %in% c("ECO_AGGREGATE_TOTAL", "ECO_SECTOR_TOTAL", "ECO_ISIC4_TOTAL")) %>%
      group_by(geo, year, classif2) %>% slice_head(n = 1) %>% ungroup() %>%
      transmute(geo, year, metric = ifelse(classif2 == "CUR_TYPE_USD", "ilo_earnings_usd", "ilo_earnings_ppp"),
                value = obs_value),
    e %>% filter(classif1 == "ECO_ISIC4_C") %>%
      transmute(geo, year, metric = ifelse(classif2 == "CUR_TYPE_USD", "ilo_earnings_c_usd", "ilo_earnings_c_ppp"),
                value = obs_value))
}, error = function(e) message("  post-processing failed for earn: ", conditionMessage(e)))

mmw <- ilo(first_id(c("EAR_4MMN_CUR_NB_A", "EAR_4MMN_CUR_NB_Q")), "minimum_wage")
if (!is.null(mmw)) tryCatch({
  country_long$mmw <- mmw %>% filter(classif1 %in% c("CUR_TYPE_USD", "CUR_TYPE_PPP")) %>%
    transmute(geo, year, metric = ifelse(classif1 == "CUR_TYPE_USD", "ilo_min_wage_usd", "ilo_min_wage_ppp"),
              value = obs_value)
}, error = function(e) message("  post-processing failed for mmw: ", conditionMessage(e)))

country <- bind_rows(country_long) %>%
  filter(!is.na(value), is.finite(value)) %>%
  distinct(geo, year, metric, .keep_all = TRUE) %>%
  mutate(value = signif(value, 5)) %>%
  arrange(metric, geo, year)

# ---- 4. FDI-intensive industries (structural business statistics) -----------------
industries <- c(C293 = "Automotive parts", C29 = "Motor vehicles (all)",
                C14 = "Apparel", C15 = "Leather & footwear", C27 = "Electrical equipment")

sbs_one <- function(id) {
  x <- estat(id)
  icol <- intersect(c("indic_sb", "indic_sbs"), names(x))[1]
  show_codes(x, icol)
  if ("size_emp" %in% names(x)) x <- x %>% filter(size_emp == "TOTAL")
  show_codes(x %>% filter(substr(nace_r2, 1, 3) %in% c("C29", "C14", "C15", "C27")), "nace_r2")
  x %>% filter(nace_r2 %in% names(industries), !is.na(values)) %>%
    mutate(ind = .data[[icol]],
           var = case_when(
             ind %in% c("V12150", "AV_MEUR") ~ "va",
             ind %in% c("V16110", "EMP_NR") ~ "emp",
             ind %in% c("V13320", "WAGE_MEUR") ~ "wages",
             TRUE ~ NA_character_)) %>%
    filter(!is.na(var)) %>%
    select(geo, nace = nace_r2, year, var, values)
}

industry <- safely_fetch("eurostat:sbs", {
  parts <- list()
  for (id in c("sbs_na_ind_r2", "sbs_ovw_act")) {
    p <- tryCatch(sbs_one(id), error = function(e) { message("  ", id, " failed: ", conditionMessage(e)); NULL })
    if (!is.null(p)) parts[[id]] <- p
  }
  bind_rows(parts) %>%
    distinct(geo, nace, year, var, .keep_all = TRUE) %>%
    pivot_wider(names_from = var, values_from = values) %>%
    mutate(va = col_or_na(., "va"), emp = col_or_na(., "emp"), wages = col_or_na(., "wages"),
           industry = industries[nace],
           va_worker  = va / emp * 1e6,      # EUR per person employed (va in MEUR)
           wage_share = wages / va) %>%
    filter(!is.na(va_worker) | !is.na(wage_share)) %>%
    mutate(across(c(va_worker, wage_share, emp), ~ ifelse(is.finite(.x), signif(.x, 5), NA_real_))) %>%
    select(geo, nace, industry, year, emp, va_worker, wage_share) %>%
    arrange(nace, geo, year)
})

# ---- 5. Checks and output ------------------------------------------------------
m14 <- sectors$nace[sectors$tier == "manuf14"]
tiling <- sector %>%
  filter(nace %in% m14) %>%
  group_by(geo, year) %>%
  summarise(n = n(), s = sum(gva_nom), .groups = "drop") %>%
  filter(n == length(m14)) %>%
  inner_join(sector %>% filter(nace == "C") %>% select(geo, year, c = gva_nom), by = c("geo", "year")) %>%
  mutate(gap = abs(s / c - 1))
worst_gap <- max(tiling$gap, na.rm = TRUE)
message(sprintf("Tiling check: worst gap %.3f%%", 100 * worst_gap))
if (worst_gap > 0.01) stop("Manufacturing branches do not tile C (worst gap > 1%).")

dir.create("data", showWarnings = FALSE)
write_csv(sector, "data/sector.csv", na = "")
write_csv(country, "data/country.csv", na = "")
if (!is.null(industry)) write_csv(industry, "data/industry.csv", na = "") else
  write_csv(tibble(geo = character(), nace = character(), industry = character(), year = integer(),
                   emp = double(), va_worker = double(), wage_share = double()), "data/industry.csv")

meta <- list(
  built = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  sources = status,
  tiling_worst_gap = worst_gap,
  coverage = list(
    sector_countries  = sort(unique(sector$geo)),
    country_countries = sort(unique(country$geo)),
    country_metrics   = sort(unique(country$metric)),
    industry_countries = if (!is.null(industry)) sort(unique(industry$geo)) else list())
)
write_json(meta, "data/meta.json", auto_unbox = TRUE, pretty = TRUE)
message("Done: sector=", nrow(sector), " country=", nrow(country),
        " industry=", if (is.null(industry)) 0 else nrow(industry))

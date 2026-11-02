# Build the dashboard panel from Eurostat bulk downloads.
#
# Output: data/panel.csv  - one row per country x sector x year (wide indicators)
#         data/checks.csv - tiling and coverage checks (the build fails on hard errors)
#
# Sources (bulk, no filters, to maximise coverage):
#   nama_10_a64    GVA (B1G) in CLV20_MEUR and CP_MEUR; D1, D11 in CP_MEUR
#   nama_10_a64_e  EMP_DC, SAL_DC in THS_PER
#
# Run locally:  Rscript R/build_data.R

suppressPackageStartupMessages({
  library(eurostat)
  library(dplyr)
  library(tidyr)
  library(readr)
})

year_min <- 2000
countries <- read_csv("config/countries.csv", show_col_types = FALSE)
sectors   <- read_csv("config/sectors.csv",   show_col_types = FALSE)
src_codes <- setdiff(unique(sectors$nace), "C_RESID")
src_codes <- union(src_codes, c("C", "C26", "C29"))   # needed for C_RESID

# eurostat >= 4 names the time column TIME_PERIOD; older versions use `time`
fix_time <- function(x) {
  if ("TIME_PERIOD" %in% names(x)) x <- rename(x, time = TIME_PERIOD)
  x %>% mutate(time = as.integer(substr(as.character(time), 1, 4)))
}

get_bulk <- function(id) {
  message("Downloading ", id, " ...")
  get_eurostat(id, time_format = "raw", cache = FALSE) %>%
    fix_time() %>%
    filter(geo %in% countries$geo, nace_r2 %in% src_codes, time >= year_min)
}

a64 <- get_bulk("nama_10_a64") %>%
  filter((na_item == "B1G" & unit %in% c("CLV20_MEUR", "CP_MEUR")) |
         (na_item %in% c("D1", "D11") & unit == "CP_MEUR")) %>%
  mutate(var = case_when(
    na_item == "B1G" & unit == "CLV20_MEUR" ~ "gva_real",
    na_item == "B1G"                        ~ "gva_nom",
    na_item == "D1"                         ~ "comp",
    na_item == "D11"                        ~ "wages"))

emp <- get_bulk("nama_10_a64_e") %>%
  filter(na_item %in% c("EMP_DC", "SAL_DC"), unit == "THS_PER") %>%
  mutate(var = ifelse(na_item == "EMP_DC", "emp", "sal"))

raw <- bind_rows(a64, emp) %>%
  select(geo, nace = nace_r2, year = time, var, value = values) %>%
  filter(!is.na(value)) %>%
  pivot_wider(names_from = var, values_from = value)

missing_codes <- setdiff(src_codes, unique(raw$nace))
if (length(missing_codes)) warning("Sector codes not found in Eurostat: ",
                                   paste(missing_codes, collapse = ", "))

# Residual manufacturing = C - C26 - C29.
# Additive for nominal values and headcounts; approximate for chain-linked GVA.
resid <- raw %>%
  filter(nace %in% c("C", "C26", "C29")) %>%
  pivot_longer(-c(geo, nace, year), names_to = "var") %>%
  pivot_wider(names_from = nace, values_from = value) %>%
  mutate(value = C - C26 - C29, nace = "C_RESID") %>%
  select(geo, nace, year, var, value) %>%
  filter(!is.na(value)) %>%
  pivot_wider(names_from = var, values_from = value)

panel <- bind_rows(raw, resid) %>%
  filter(nace %in% sectors$nace) %>%
  mutate(
    prod         = gva_real / emp * 1000,      # real GVA per person employed, EUR (2020 prices)
    comp_pe      = comp / sal * 1000,          # compensation per employee, EUR (nominal)
    ulc          = comp_pe / prod,             # nominal comp. per employee / real productivity
    labour_share = comp / gva_nom,             # unadjusted labour share
    employer_rate = (comp - wages) / wages     # employer social contributions / gross wages
  ) %>%
  mutate(across(where(is.double), ~ signif(.x, 6))) %>%
  arrange(geo, nace, year)

# ---- Checks ---------------------------------------------------------------
checks <- list()

# 1. Nominal tiling: manuf14 branches should sum to C (CP_MEUR, exact up to rounding)
m14 <- sectors$nace[sectors$tier == "manuf14"]
tiling <- panel %>%
  filter(nace %in% m14) %>%
  group_by(geo, year) %>%
  summarise(n = n(), sum_gva = sum(gva_nom), .groups = "drop") %>%
  inner_join(panel %>% filter(nace == "C") %>% select(geo, year, c_gva = gva_nom),
             by = c("geo", "year")) %>%
  filter(n == length(m14)) %>%
  mutate(gap_pct = 100 * (sum_gva / c_gva - 1))
checks$tiling <- tiling %>%
  summarise(check = "manuf14 tiles C (nominal GVA)",
            worst_gap_pct = max(abs(gap_pct), na.rm = TRUE),
            ok = worst_gap_pct < 1)

# 2. Serbia present with productivity for every manufacturing branch
rs_cov <- panel %>%
  filter(geo == "RS", nace %in% m14, !is.na(prod)) %>%
  distinct(nace)
checks$serbia <- tibble(check = "Serbia productivity for all manuf14 branches",
                        worst_gap_pct = NA_real_,
                        ok = nrow(rs_cov) == length(m14))

checks <- bind_rows(checks)
print(checks)

dir.create("data", showWarnings = FALSE)
write_csv(panel, "data/panel.csv", na = "")
write_csv(checks, "data/checks.csv", na = "")
message("Wrote data/panel.csv: ", nrow(panel), " rows, ",
        n_distinct(panel$geo), " countries, latest year ", max(panel$year))

if (!isTRUE(checks$ok[1])) stop("Tiling check failed - see table above.")
if (!all(checks$ok)) warning("Some data checks failed - see data/checks.csv.")

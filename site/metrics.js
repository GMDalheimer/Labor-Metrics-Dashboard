// Metric catalogue. `table` says where the values live:
//   sector   -> data/sector.csv (country x NACE x year); `nace` picks the sector
//   country  -> data/country.csv (long format)
// `better` is used only for wording in insights ("higher" or "lower"), never for colour.

export const CATEGORIES = [
  "Productivity",
  "Labour cost",
  "Wages",
  "Distribution",
  "Working time",
];

export const METRICS = [
  // Productivity
  { key: "prod_hour", table: "sector", cat: "Productivity", label: "Productivity per hour",
    unit: "EUR of real value added per hour worked (2020 prices)", fmt: ",.1f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Gross value added in chain-linked 2020 euros divided by total hours worked." },
  { key: "prod", table: "sector", cat: "Productivity", label: "Productivity per worker",
    unit: "EUR of real value added per person employed (2020 prices)", fmt: ",.0f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Gross value added in chain-linked 2020 euros divided by persons employed." },
  { key: "ilo_output_worker_ppp", table: "country", cat: "Productivity", label: "Output per worker (ILO)",
    unit: "GDP per person employed, constant international $ (PPP)", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT modelled estimates",
    desc: "Whole-economy output per worker. Available for every country, including North and Sub-Saharan Africa." },

  // Labour cost
  { key: "lc_hour", table: "country", cat: "Labour cost", label: "Hourly labour cost",
    unit: "EUR per hour, business economy (NACE B-S)", fmt: ",.1f", prefix: "€",
    source: "Eurostat lc_lci_lev",
    desc: "Total labour cost per hour actually worked: wages plus employer social contributions and other non-wage costs." },
  { key: "lc_hour_c", table: "country", cat: "Labour cost", label: "Hourly labour cost, manufacturing",
    unit: "EUR per hour, manufacturing (NACE C)", fmt: ",.1f", prefix: "€",
    source: "Eurostat lc_lci_lev", desc: "As above, for manufacturing only." },
  { key: "comp_ph", table: "sector", cat: "Labour cost", label: "Compensation per employee hour",
    unit: "EUR per hour worked by employees (nominal)", fmt: ",.1f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Compensation of employees (D1) divided by hours worked by employees." },
  { key: "comp_pe", table: "sector", cat: "Labour cost", label: "Compensation per employee",
    unit: "EUR per employee per year (nominal)", fmt: ",.0f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Compensation of employees (D1) divided by the number of employees." },
  { key: "ulc", table: "sector", cat: "Labour cost", label: "Unit labour cost",
    unit: "nominal compensation per employee / real productivity per worker", fmt: ".3f",
    source: "Derived from Eurostat national accounts",
    desc: "Labour cost of producing one unit of real output. Compare across time (indexed) rather than levels across countries." },
  { key: "employer_rate", table: "sector", cat: "Labour cost", label: "Employer contribution rate",
    unit: "employer social contributions as share of gross wages", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64 (D1 - D11) / D11",
    desc: "How much employers pay on top of gross wages in social contributions." },
  { key: "nonwage_share", table: "country", cat: "Labour cost", label: "Non-wage share of labour cost",
    unit: "share of hourly labour cost, business economy", fmt: ".1%",
    source: "Eurostat lc_lci_lev", desc: "Employer social contributions and other non-wage costs as a share of total labour cost." },
  { key: "tax_wedge", table: "country", cat: "Labour cost", label: "Tax wedge",
    unit: "share of labour cost, single low-wage earner (67% of average wage)", fmt: ".1%",
    source: "Eurostat earn_nt_taxwedge",
    desc: "Income tax plus employee and employer social contributions as a share of total labour cost for a single worker without children on a low wage: the gap between what the employer pays and the worker takes home." },

  // Wages
  { key: "min_wage_eur", table: "country", cat: "Wages", label: "Minimum wage",
    unit: "EUR per month (gross, statutory)", fmt: ",.0f", prefix: "€",
    source: "Eurostat earn_mw_cur", desc: "Statutory gross monthly minimum wage, latest semester of each year." },
  { key: "min_wage_pps", table: "country", cat: "Wages", label: "Minimum wage (PPS)",
    unit: "purchasing power standard per month", fmt: ",.0f",
    source: "Eurostat earn_mw_cur", desc: "Minimum wage adjusted for price levels." },
  { key: "min_wage_ratio", table: "country", cat: "Wages", label: "Minimum wage / mean earnings",
    unit: "share of average monthly earnings", fmt: ".1%",
    source: "Eurostat earn_mw_avgr2", desc: "How binding the minimum wage is relative to average pay." },
  { key: "ilo_min_wage_usd", table: "country", cat: "Wages", label: "Minimum wage (ILO, USD)",
    unit: "USD per month (gross, statutory)", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT EAR_4MMN_CUR_NB_A", desc: "Statutory minimum wage in US dollars; covers non-European comparators." },
  { key: "ilo_earnings_usd", table: "country", cat: "Wages", label: "Average monthly earnings (ILO, USD)",
    unit: "USD per month", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT EAR_4MTH_SEX_ECO_CUR_NB_A", desc: "Mean nominal monthly earnings of employees." },

  // Distribution
  { key: "labour_share", table: "sector", cat: "Distribution", label: "Labour share",
    unit: "compensation of employees / nominal value added", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64", desc: "Share of value added paid to employees (unadjusted)." },
  { key: "adj_labour_share", table: "sector", cat: "Distribution", label: "Adjusted labour share",
    unit: "imputes self-employed income at average employee pay", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Labour share including an imputed wage for the self-employed. Better for countries with large self-employment, such as farming economies." },
  { key: "profit_share", table: "sector", cat: "Distribution", label: "Profit share",
    unit: "gross operating surplus and mixed income / nominal value added", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64 (B1G - D1 - D29X39)", desc: "Share of value added retained as gross operating surplus and mixed income." },

  // Working time
  { key: "hours_worker", table: "sector", cat: "Working time", label: "Annual hours per worker",
    unit: "hours worked per person employed per year", fmt: ",.0f",
    source: "Eurostat nama_10_a64_e", desc: "Total hours worked divided by persons employed." },
  { key: "hours_week", table: "country", cat: "Working time", label: "Weekly hours actually worked",
    unit: "mean weekly hours per employed person", fmt: ",.1f",
    source: "ILOSTAT HOW_TEMP_SEX_ECO_NB_A", desc: "Labour force survey based; covers all countries in the atlas." },
  { key: "hours_week_c", table: "country", cat: "Working time", label: "Weekly hours, manufacturing",
    unit: "mean weekly hours per employed person, manufacturing", fmt: ",.1f",
    source: "ILOSTAT HOW_TEMP_SEX_ECO_NB_A", desc: "As above, for manufacturing." },
];

export const METRIC = Object.fromEntries(METRICS.map(m => [m.key, m]));

// Metrics shown on a country profile, in order
export const PROFILE_METRICS = [
  "prod_hour", "lc_hour", "lc_hour_c", "comp_ph", "min_wage_eur", "tax_wedge", "labour_share",
  "employer_rate", "hours_week", "ilo_output_worker_ppp", "min_wage_ratio", "profit_share", "nonwage_share",
];

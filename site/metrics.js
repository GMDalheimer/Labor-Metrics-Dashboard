// Metric catalogue. `table` says where the values live:
//   sector   -> data/sector.csv (country x NACE x year); `nace` picks the sector
//   country  -> data/country.csv (long format)
// `better` is used only for wording in insights ("higher" or "lower"), never for colour.

export const CATEGORIES = [
  "Productivity",
  "Labor cost",
  "Wages",
  "Distribution",
  "Working time",
];

export const METRICS = [
  // Productivity
  { key: "prod_hour", table: "sector", cat: "Productivity", label: "Productivity per hour",
    unit: "Values are in euros of real value added per hour worked, at 2020 prices.", fmt: ",.1f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Gross value added in chain-linked 2020 euros is divided by total hours worked." },
  { key: "prod", table: "sector", cat: "Productivity", label: "Productivity per worker",
    unit: "Values are in euros of real value added per person employed, at 2020 prices.", fmt: ",.0f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Gross value added in chain-linked 2020 euros is divided by persons employed." },
  { key: "ilo_output_worker_ppp", table: "country", cat: "Productivity", label: "Output per worker (ILO)",
    unit: "Values are GDP per person employed, in constant international dollars at purchasing power parity.", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT modelled estimates",
    desc: "Output per worker is measured for the whole economy. It is available for every country, including North and Sub-Saharan Africa." },

  // Labor cost
  { key: "lc_hour", table: "country", cat: "Labor cost", label: "Hourly labor cost",
    unit: "Values are in euros per hour for the business economy (NACE sections B to S).", fmt: ",.1f", prefix: "€",
    source: "Eurostat lc_lci_lev",
    desc: "Total labor cost per hour actually worked covers wages, employer social contributions and other non-wage costs." },
  { key: "lc_hour_c", table: "country", cat: "Labor cost", label: "Hourly labor cost, manufacturing",
    unit: "Values are in euros per hour for manufacturing (NACE section C).", fmt: ",.1f", prefix: "€",
    source: "Eurostat lc_lci_lev", desc: "The measure is the same as above, for manufacturing only." },
  { key: "comp_ph", table: "sector", cat: "Labor cost", label: "Compensation per employee hour",
    unit: "Values are in nominal euros per hour worked by employees.", fmt: ",.1f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Compensation of employees (D1) is divided by hours worked by employees." },
  { key: "comp_pe", table: "sector", cat: "Labor cost", label: "Compensation per employee",
    unit: "Values are in nominal euros per employee and year.", fmt: ",.0f", prefix: "€",
    source: "Eurostat nama_10_a64, nama_10_a64_e",
    desc: "Compensation of employees (D1) is divided by the number of employees." },
  { key: "ulc", table: "sector", cat: "Labor cost", label: "Unit labor cost",
    unit: "The ratio of nominal compensation per employee to real output per worker is shown.", fmt: ".3f",
    source: "Derived from Eurostat national accounts",
    desc: "Unit labor cost is the labor cost of producing one unit of real output. It is best compared over time as an index rather than as a level across countries." },
  { key: "employer_rate", table: "sector", cat: "Labor cost", label: "Employer contribution rate",
    unit: "Employer social contributions are shown as a share of gross wages.", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64 (D1 - D11) / D11",
    desc: "The rate shows how much employers pay in social contributions on top of gross wages." },
  { key: "nonwage_share", table: "country", cat: "Labor cost", label: "Non-wage share of labor cost",
    unit: "Non-wage costs are shown as a share of hourly labor cost in the business economy.", fmt: ".1%",
    source: "Eurostat lc_lci_lev", desc: "Employer social contributions and other non-wage costs are shown as a share of total labor cost." },
  { key: "tax_wedge", table: "country", cat: "Labor cost", label: "Tax wedge",
    unit: "The tax wedge is shown as a share of labor cost for a single worker earning 67% of the average wage.", fmt: ".1%",
    source: "Eurostat earn_nt_taxwedge",
    desc: "Income tax and employee and employer social contributions are shown as a share of total labor cost for a single worker without children on a low wage. This is the gap between what the employer pays and what the worker takes home." },

  // Wages
  { key: "min_wage_eur", table: "country", cat: "Wages", label: "Minimum wage",
    unit: "Values are gross statutory minimum wages in euros per month.", fmt: ",.0f", prefix: "€",
    source: "Eurostat earn_mw_cur", desc: "The statutory gross monthly minimum wage is shown for the latest semester of each year." },
  { key: "min_wage_pps", table: "country", cat: "Wages", label: "Minimum wage (PPS)",
    unit: "Values are minimum wages in purchasing power standards per month.", fmt: ",.0f",
    source: "Eurostat earn_mw_cur", desc: "The minimum wage is adjusted for price levels." },
  { key: "min_wage_ratio", table: "country", cat: "Wages", label: "Minimum wage / mean earnings",
    unit: "The minimum wage is shown as a share of average monthly earnings.", fmt: ".1%",
    source: "Eurostat earn_mw_avgr2", desc: "The ratio shows how binding the minimum wage is relative to average pay." },
  { key: "ilo_min_wage_usd", table: "country", cat: "Wages", label: "Minimum wage (ILO, USD)",
    unit: "Values are gross statutory minimum wages in US dollars per month.", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT EAR_INEE_CUR_NB_A", desc: "The statutory minimum wage is shown in US dollars, which also covers non-European comparators." },
  { key: "ilo_earnings_usd", table: "country", cat: "Wages", label: "Average monthly earnings (ILO, USD)",
    unit: "Values are average monthly earnings in US dollars.", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT EAR_EMTA_SEX_ECO_CUR_NB_A", desc: "Mean nominal monthly earnings of employees are shown." },
  { key: "ilo_earnings_c_usd", table: "country", cat: "Wages", label: "Average monthly earnings, manufacturing (ILO, USD)",
    unit: "Values are average monthly earnings in manufacturing, in US dollars.", fmt: ",.0f", prefix: "$",
    source: "ILOSTAT EAR_EMTA_SEX_ECO_CUR_NB_A", desc: "Mean nominal monthly earnings of manufacturing employees are shown." },

  // Distribution
  { key: "labour_share", table: "sector", cat: "Distribution", label: "Labor share",
    unit: "Compensation of employees is shown as a share of nominal value added.", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64", desc: "The unadjusted share of value added paid to employees is shown." },
  { key: "adj_labour_share", table: "sector", cat: "Distribution", label: "Adjusted labor share",
    unit: "The share includes a wage for the self-employed, set at the average pay of employees.", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64, nama_10_a64_e",
    desc: "The labor share includes an imputed wage for the self-employed. It is better suited to countries with large self-employment, such as farming economies." },
  { key: "profit_share", table: "sector", cat: "Distribution", label: "Profit share",
    unit: "Gross operating surplus and mixed income are shown as a share of nominal value added.", fmt: ".1%",
    source: "Derived from Eurostat nama_10_a64 (B1G - D1 - D29X39)", desc: "The share of value added retained as gross operating surplus and mixed income is shown." },

  // Working time
  { key: "hours_worker", table: "sector", cat: "Working time", label: "Annual hours per worker",
    unit: "Values are hours worked per person employed and year.", fmt: ",.0f",
    source: "Eurostat nama_10_a64_e", desc: "Total hours worked are divided by persons employed." },
  { key: "hours_week", table: "country", cat: "Working time", label: "Weekly hours actually worked",
    unit: "Values are average weekly hours actually worked per employed person.", fmt: ",.1f",
    source: "ILOSTAT HOW_TEMP_SEX_ECO_NB_A", desc: "The figures come from labor force surveys and cover all countries in the atlas." },
  { key: "hours_week_c", table: "country", cat: "Working time", label: "Weekly hours, manufacturing",
    unit: "Values are average weekly hours actually worked per employed person in manufacturing.", fmt: ",.1f",
    source: "ILOSTAT HOW_TEMP_SEX_ECO_NB_A", desc: "The measure is the same as above, for manufacturing." },
];

export const METRIC = Object.fromEntries(METRICS.map(m => [m.key, m]));

// Metrics shown on a country profile, in order
export const PROFILE_METRICS = [
  "prod_hour", "lc_hour", "lc_hour_c", "comp_ph", "min_wage_eur", "tax_wedge", "labour_share",
  "employer_rate", "hours_week", "ilo_output_worker_ppp", "min_wage_ratio", "profit_share", "nonwage_share",
];

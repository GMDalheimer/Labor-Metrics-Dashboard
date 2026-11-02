# Labor Metrics Dashboard

An interactive dashboard on Serbia's labour-market competitiveness (TBI). It compares productivity, compensation and unit labour costs against CEE, Western Balkan and EU comparators.

**Live site:** https://gmdalheimer.github.io/labor-metrics-dashboard/

## How it works

```
Eurostat (bulk) ──> R/build_data.R ──> data/panel.csv ──> index.qmd (Quarto + Observable JS) ──> GitHub Pages
```

- `R/build_data.R` downloads `nama_10_a64` and `nama_10_a64_e`, derives the indicators, runs the build checks and writes `data/panel.csv` and `data/checks.csv`. The build fails if the manufacturing branches do not tile C.
- `index.qmd` is a Quarto dashboard. Charts are drawn in the browser with Observable Plot, so every filter works on the static site and no server is needed.
- GitHub Actions rebuilds the site on every push to `main`, monthly to pick up Eurostat revisions, and on demand (Actions → *Build and deploy dashboard* → *Run workflow*). Pull requests are built but not deployed.

## Pages

| Page | What it shows |
|---|---|
| Overview | Serbia vs its 2016 position: productivity, pay and ULC, plus productivity relative to EU27 |
| Explorer | Any indicator × sector × comparator set, as levels or indexed, with a table view |
| ULC decomposition | ULC change split into compensation and productivity effects, by sector |
| Convergence | β-convergence (starting level vs growth) and σ-convergence (dispersion over time) |
| Coverage & methods | Data availability by country × sector, build checks, and definitions |

## Changing the scope

- **Countries:** `config/countries.csv` (the `group` column drives the convergence filters).
- **Sectors and tiers:** `config/sectors.csv`. Uses Eurostat `nace_r2` codes. `manuf14` must tile C, because the build checks this.

## Run locally

```r
install.packages(c("eurostat", "dplyr", "tidyr", "readr"))
source("R/build_data.R")
```

Then run `quarto preview` from the repo root.

## Indicator definitions

| Indicator | Definition |
|---|---|
| Real productivity | B1G (CLV20_MEUR) / EMP_DC, EUR per person |
| Compensation per employee | D1 (CP_MEUR) / SAL_DC, EUR |
| Unit labour cost | compensation per employee / real productivity |
| Labour share | D1 / B1G (CP_MEUR), unadjusted |
| Employer contribution rate | (D1 − D11) / D11 |

Rest of manufacturing is C − C26 − C29. It is exact for nominal values and headcounts and approximate for chain-linked GVA.

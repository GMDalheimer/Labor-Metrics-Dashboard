# Labor Cost Atlas

Unit labor costs, productivity, labor costs, wages and working time across Europe, the Western Balkans and North Africa.

**Live site:** https://gmdalheimer.github.io/Labor-Metrics-Dashboard/

## Views

| View | Content |
|---|---|
| Overview | Map and ranking for any indicator and year |
| Unit labor costs | ULC index, annual and cumulative decomposition into compensation and productivity, sector decomposition, cross-check with Eurostat's published index |
| Country profile | Indicators with ranks, position among all economies, trends |
| Comparison | Up to four economies across every indicator |
| Cost of an hour | Components of hourly labor cost against value added per hour, with scenarios |
| Industries | Structural business statistics at NACE section, division and group level |
| Economy structure | NACE hierarchy of employment as a zoomable tree, with data availability |
| Analysis | Pre-specified and custom regressions (OLS with HC1 errors; panel with economy fixed effects and clustered errors) |
| Methods | Coverage, sources, definitions |

The country, comparison countries, period and sector are set once in the bar below the navigation and apply to every view. The URL reflects the current selection.

## How it works

```
Eurostat + ILOSTAT ──> R/build_data.R ──> data/*.csv (committed) ──> site/ (HTML + D3) ──> GitHub Pages
```

- `R/build_data.R` downloads every source independently. A failing source is recorded in `data/meta.json` and shown on the Data page; it does not break the build. The build stops only if the core national accounts are missing or the manufacturing branches do not tile C.
- GitHub Actions rebuilds the data whenever `R/` or `config/` changes, and on the 3rd of every month. The data is committed back to the repo, so every number shown can be traced to a commit.
- `site/` is plain HTML, CSS and JavaScript (ES modules) with D3, with no build step. Regressions are computed in the browser (`site/stats.js`). Pushing to `main` deploys.

## Sources

| Source | Used for |
|---|---|
| Eurostat `nama_10_a64`, `nama_10_a64_e` | Productivity, compensation, ULC, labor and profit shares, hours; all NACE levels |
| Eurostat `nama_10_lp_ulc` | Published ULC and productivity indices (cross-check) |
| Eurostat `lc_lci_lev` | Hourly labour cost and its non-wage share |
| Eurostat `earn_mw_cur`, `earn_mw_avgr2` | Minimum wages |
| Eurostat `earn_nt_taxwedge` | Tax wedge (low-wage single earner) |
| Eurostat SBS (`sbs_na_ind_r2`, `sbs_ovw_act`) | Industries at section, division and group level |
| ILOSTAT | Weekly hours, output per worker, earnings and minimum wages (covers North Africa, Kenya, Ghana) |

## Typography

The CSS asks for Aeonik and PP Editorial New first, so the site shows TBI's typefaces on any machine where they are installed. Everyone else sees the open fallbacks Manrope and Instrument Serif. No font files are hosted here.

## Changing the scope

- **Countries:** `config/countries.csv`. Use the Eurostat `geo` code, ISO3 code for ILOSTAT, and ISO numeric code for the map.
- **Sectors:** `config/sectors.csv`. `manuf14` must tile C.
- **Indicators shown:** `site/metrics.js`.

## Not yet included

Statutory sick-leave rules and legal working time from the Project 2 research. These will be added as a hand-maintained CSV in `config/`.

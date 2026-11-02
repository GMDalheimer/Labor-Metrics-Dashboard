# Labour Cost Atlas

Productivity, labour costs, wages and working time across Europe, the Western Balkans and North Africa. Built by TBI's Serbia team.

**Live site:** https://gmdalheimer.github.io/Labor-Metrics-Dashboard/

## Views

| View | What it does |
|---|---|
| Atlas | Animated map and ranking for any indicator; press play to watch 2000 to today |
| Country | Profile for any country: indicator tiles with ranks, a "fingerprint" of its position among all countries, trends vs region and EU27 |
| Compare | Up to four countries across every indicator, as levels or indexed |
| True cost of an hour | Take-home pay → taxes → employer costs → sick-leave scenario, against value added per hour |
| Sectors | Unit labour cost decomposition (pay vs productivity) and a sector × country productivity heatmap |
| FDI industries | Automotive parts, apparel, footwear, electrical equipment: value added per worker vs wage share |
| Convergence | β-convergence (bubble chart) and σ-convergence |
| Data | Coverage matrix, source status, definitions, CSV downloads |

The URL always reflects the current view, so any view can be shared as a link.

## How it works

```
Eurostat + ILOSTAT ──> R/build_data.R ──> data/*.csv (committed) ──> site/ (HTML + D3) ──> GitHub Pages
```

- `R/build_data.R` downloads every source independently. A failing source is recorded in `data/meta.json` and shown on the Data page; it does not break the build. The build stops only if the core national accounts are missing or the manufacturing branches do not tile C.
- GitHub Actions rebuilds the data whenever `R/` or `config/` changes, and on the 3rd of every month. The data is committed back to the repo, so every number shown can be traced to a commit.
- `site/` is plain HTML, CSS and JavaScript with D3, with no build step. Pushing to `main` deploys.

## Sources

| Source | Used for |
|---|---|
| Eurostat `nama_10_a64`, `nama_10_a64_e` | Productivity, compensation, ULC, labour and profit shares, hours |
| Eurostat `lc_lci_lev` | Hourly labour cost and its non-wage share |
| Eurostat `earn_mw_cur`, `earn_mw_avgr2` | Minimum wages |
| Eurostat `earn_nt_taxwedge` | Tax wedge (low-wage single earner) |
| Eurostat SBS (`sbs_na_ind_r2`, `sbs_ovw_act`) | FDI-intensive industries |
| ILOSTAT | Weekly hours, output per worker, earnings and minimum wages (covers North Africa, Kenya, Ghana) |

## Typography

The CSS asks for Aeonik and PP Editorial New first, so the site shows TBI's typefaces on any machine where they are installed. Everyone else sees the open fallbacks Manrope and Instrument Serif. No font files are hosted here.

## Changing the scope

- **Countries:** `config/countries.csv`. Use the Eurostat `geo` code, ISO3 code for ILOSTAT, and ISO numeric code for the map.
- **Sectors:** `config/sectors.csv`. `manuf14` must tile C.
- **Indicators shown:** `site/metrics.js`.

## Not yet included

Statutory sick-leave rules and legal working time from the Project 2 research. These will be added as a hand-maintained CSV in `config/`.

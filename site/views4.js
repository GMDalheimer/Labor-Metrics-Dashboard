// Home: what the atlas is, what it can be used for, one featured chart
import { d3, EU, S, D, writeHash, val, latest, coverage, cname, cssVar, countryColor, h, figure, scatter } from "./core.js";
import { ols, fmtP } from "./stats.js";

const go = view => { S.view = view; writeHash(true); window.dispatchEvent(new Event("lca:render")); window.scrollTo(0, 0); };

export function home(root) {
  const n = D.countries.length;
  const last = coverage("prod", "TOTAL").latest;
  const built = D.meta.built ? new Date(D.meta.built).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";

  root.append(h("section", { class: "home-hero" },
    h("div", {},
      h("h1", {}, "Labor costs and productivity in Europe and its neighbors"),
      h("p", {}, `The Labor Cost Atlas brings together official statistics on productivity, labor costs, wages and working time for ${n} economies in the European Union, the Western Balkans, Türkiye, North Africa and Sub-Saharan Africa.`),
      h("p", {}, "It is built to answer one question in several ways: how competitive is an economy on labor costs, and is the difference driven by what workers are paid or by how much they produce?")),
    h("div", { class: "home-facts" },
      h("div", {}, h("b", {}, String(n)), h("span", {}, "economies")),
      h("div", {}, h("b", {}, "2000–" + last), h("span", {}, "years of data")),
      h("div", {}, h("b", {}, "23"), h("span", {}, "indicators from Eurostat and ILOSTAT")),
      h("div", {}, h("b", {}, built || "monthly"), h("span", {}, "last automatic update")))));

  // Featured chart: hourly labor cost against value added per hour, latest common year
  const yr = d3.range(last, last - 4, -1).find(y => D.countries.filter(c => val("lc_hour", c.geo, y) && val("va_hour_nom", c.geo, y, "TOTAL")).length > 15);
  const pts = yr ? D.countries.map(c => ({ geo: c.geo, name: c.name, x: val("va_hour_nom", c.geo, yr, "TOTAL"), y: val("lc_hour", c.geo, yr) })).filter(p => p.x && p.y) : [];
  const fit = pts.length > 5 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), ["Value added per hour"]) : null;
  const feat = h("section", { class: "home-section" }, h("h2", {}, "Labor cost and output per hour across economies"));
  root.append(feat);
  const f = figure({ title: `Hourly labor cost and value added per hour worked, ${yr}`, span: 12,
    sub: "Each point is one economy. Points above the line have higher labor costs than their output per hour would suggest; points below have lower.",
    note: "Sources: Eurostat lc_lci_lev (hourly labor cost, business economy), nama_10_a64 and nama_10_a64_e (value added and hours, total economy). Line: OLS fit with 95% confidence band.",
    method: fit ? [`Slope ${fit.coefs[1].b.toFixed(2)} (robust SE ${fit.coefs[1].se.toFixed(2)}, p ${fmtP(fit.coefs[1].p)}), n = ${fit.n}, R² = ${fit.r2.toFixed(2)}: each additional euro of value added per hour is associated with ${fit.coefs[1].b.toFixed(2)} euros of hourly labor cost.`] : [] });
  feat.append(h("div", { class: "grid" }, f.el));
  scatter(f.body, pts, { xLabel: "Value added per hour worked, EUR", yLabel: "Hourly labor cost, EUR", xFmt: v => "€" + v.toFixed(0), yFmt: v => "€" + v.toFixed(0),
    fit: fit ? { predict: fit.predict } : null, highlight: p => p.geo === S.focus,
    colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 440 });

  const paths = [
    ["ulc", "Unit labor costs", "Whether labor has become more or less expensive relative to output, and whether pay or productivity drove the change."],
    ["overview", "Map and ranking", "Any of the 23 indicators on a map and in a ranking, year by year from 2000."],
    ["country", "Country profile", "One economy at a glance: key indicators, its position among all economies, and trends."],
    ["industries", "Industries", "Productivity, wages and employment for every activity, from sections down to three-digit groups."],
    ["analysis", "Analysis", "Regressions on convergence and on the link between pay and productivity, estimated in the browser."],
    ["casestudy", "Country brief", "Five questions in plain language produce a short brief that can be saved as a PDF."],
  ];
  root.append(h("section", { class: "home-section" }, h("h2", {}, "What you can do with it"),
    h("div", { class: "home-paths" }, paths.map(([v, t, d]) => h("a", { class: "home-path", href: `#/${v}`, onclick: e => { e.preventDefault(); go(v); } }, h("b", {}, t), h("span", {}, d))))));

  root.append(h("section", { class: "home-section" }, h("h2", {}, "How to read it"),
    h("div", { class: "home-steps" },
      h("div", {}, h("b", {}, "Choose once, see everywhere. "), "The bar under the menu sets the country, the countries it is compared with, the period and the sector. The choice carries across all pages and is kept in the link, so any view can be shared."),
      h("div", {}, h("b", {}, "EU27 is the EU as a whole. "), "It is Eurostat's aggregate of the 27 member states, which weights each country by its size. Regional group lines, by contrast, show the unweighted median of their members."),
      h("div", {}, h("b", {}, "Every chart explains itself. "), "Open “Source and method” under a chart for its formula and sources. The Methods page lists all definitions, formulas and limitations."))));

  root.append(h("section", { class: "home-section" }, h("h2", {}, "About"),
    h("p", { class: "home-cite" }, "Prepared by Gregor Dalheimer and Abaigeal Heneghan, Tony Blair Institute for Global Change. All data are public and are retrieved automatically from Eurostat and ILOSTAT; the full tables can be downloaded from the Methods page."),
    h("p", { class: "home-cite" }, "Suggested citation: Dalheimer, G. and Heneghan, A. (2026). Labor Cost Atlas. Tony Blair Institute for Global Change.")));
}

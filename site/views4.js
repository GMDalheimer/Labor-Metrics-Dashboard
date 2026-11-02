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
      h("p", {}, `This site brings official data together on productivity, labor costs, wages and working hours for ${n} countries: the EU, the Western Balkans, Türkiye, and several countries in North and Sub-Saharan Africa.`),
      h("p", {}, "The site was set up to compare labor costs between countries and to show where the differences come from: what workers are paid, or how much they produce.")),
    h("div", { class: "home-facts" },
      h("div", {}, h("b", {}, String(n)), h("span", {}, "countries")),
      h("div", {}, h("b", {}, "2000–" + last), h("span", {}, "years covered")),
      h("div", {}, h("b", {}, "23"), h("span", {}, "indicators, from Eurostat and ILOSTAT")),
      h("div", {}, h("b", {}, built || "monthly"), h("span", {}, "last data update")))));

  // Featured chart: hourly labor cost against value added per hour, latest common year
  const yr = d3.range(last, last - 4, -1).find(y => D.countries.filter(c => val("lc_hour", c.geo, y) && val("va_hour_nom", c.geo, y, "TOTAL")).length > 15);
  const pts = yr ? D.countries.map(c => ({ geo: c.geo, name: c.name, x: val("va_hour_nom", c.geo, yr, "TOTAL"), y: val("lc_hour", c.geo, yr) })).filter(p => p.x && p.y) : [];
  const fit = pts.length > 5 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), ["Value added per hour"]) : null;
  const feat = h("section", { class: "home-section" }, h("h2", {}, "Labor cost and output per hour"));
  root.append(feat);
  const f = figure({ title: `Hourly labor cost and value added per hour worked, ${yr}`, span: 12,
    sub: "Each point is one country.",
    text: "Countries above the line have a higher labor cost per hour than the line predicts from their output per hour, and countries below it have a lower one.",
    note: "Hourly labor cost for the business economy is from Eurostat lc_lci_lev, and value added and hours for the total economy are from nama_10_a64 and nama_10_a64_e. The line is an OLS fit with a 95% confidence band.",
    method: fit ? [`Slope ${fit.coefs[1].b.toFixed(2)} (robust SE ${fit.coefs[1].se.toFixed(2)}, p ${fmtP(fit.coefs[1].p)}), n = ${fit.n}, R² = ${fit.r2.toFixed(2)}. On average, a country that produces one euro more per hour has a labor cost that is ${fit.coefs[1].b.toFixed(2)} euros higher per hour.`] : [] });
  feat.append(h("div", { class: "grid" }, f.el));
  scatter(f.body, pts, { xLabel: "Value added per hour worked, EUR", yLabel: "Hourly labor cost, EUR", xFmt: v => "€" + v.toFixed(0), yFmt: v => "€" + v.toFixed(0),
    fit: fit ? { predict: fit.predict } : null, highlight: () => false,
    colorOf: () => cssVar("--s1"), height: 440 });

  const paths = [
    ["ulc", "Unit labor costs", "This page shows how the labor cost of producing one unit of output has changed, and how much of that came from pay and how much from productivity."],
    ["overview", "Map", "One indicator at a time is shown on a map and in a ranking, for any year since 2000."],
    ["country", "Country profile", "The main figures for one country are shown, together with its rank and how it has changed."],
    ["industries", "Industries", "Output per worker, the wage share and employment are shown by activity, down to three-digit industries."],
    ["analysis", "Analysis", "Regressions test whether poorer countries are catching up and how closely pay follows productivity."],
    ["casestudy", "Country brief", "Five short questions produce a summary for one country that can be saved as a PDF."],
  ];
  root.append(h("section", { class: "home-section" }, h("h2", {}, "Where to start"),
    h("div", { class: "home-paths" }, paths.map(([v, t, d]) => h("a", { class: "home-path", href: `#/${v}`, onclick: e => { e.preventDefault(); go(v); } }, h("b", {}, t), h("span", {}, d))))));

  root.append(h("section", { class: "home-section" }, h("h2", {}, "How the site works"),
    h("div", { class: "home-steps" },
      h("div", {}, "The bar under the menu sets the country, the countries to compare it with, the period and the sector. These settings are kept when the page is changed, and they are saved in the link, so a shared link opens the same view."),
      h("div", {}, "EU27 is Eurostat's figure for the EU as a whole, so large countries count for more than small ones. Lines for regional groups are different: they show the middle country of the group, and each country counts the same."),
      h("div", {}, "Under each chart, \"Source and method\" shows where the data come from and how the numbers are calculated. The Methods page has the full list, including the limitations of the data."))));

  const mail = a => h("a", { href: `mailto:${a}` }, a);
  root.append(h("section", { class: "home-section" }, h("h2", {}, "Authors and contact"),
    h("dl", { class: "imprint home-imprint" },
      h("div", {}, h("dt", {}, "Authors"), h("dd", {}, "Gregor Dalheimer", h("br"), "Abaigeal Heneghan")),
      h("div", {}, h("dt", {}, "Contact"), h("dd", {}, mail("gregor.dalheimer@institute.global"), h("br"), mail("abaigeal.heneghan@institute.global"))),
      h("div", {}, h("dt", {}, "Publisher"), h("dd", {}, "Tony Blair Institute for Global Change")),
      h("div", {}, h("dt", {}, "Suggested citation"), h("dd", {}, "Dalheimer, G. and Heneghan, A. (2026). Labor Cost Atlas. Tony Blair Institute for Global Change."))),
    h("p", { class: "home-cite" }, "All data are public, and the full tables can be downloaded from the Methods page. Questions, corrections and requests for additional indicators are welcome at either address.")));
}

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
      h("p", {}, `This site collects official data on productivity, labor costs, wages and working hours for ${n} countries: the EU, the Western Balkans, Türkiye, and several countries in North and Sub-Saharan Africa.`),
      h("p", {}, "We made it to compare labor costs between countries and to see where differences come from: what workers are paid, or how much they produce.")),
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
    sub: "One point per country. Countries above the line pay more per hour than the line predicts from their output per hour; countries below it pay less.",
    note: "Sources: Eurostat lc_lci_lev (hourly labor cost, business economy), nama_10_a64 and nama_10_a64_e (value added and hours, total economy). Line: OLS fit with 95% confidence band.",
    method: fit ? [`Slope ${fit.coefs[1].b.toFixed(2)} (robust SE ${fit.coefs[1].se.toFixed(2)}, p ${fmtP(fit.coefs[1].p)}), n = ${fit.n}, R² = ${fit.r2.toFixed(2)}. On average, a country that produces one euro more per hour has a labor cost that is ${fit.coefs[1].b.toFixed(2)} euros higher per hour.`] : [] });
  feat.append(h("div", { class: "grid" }, f.el));
  scatter(f.body, pts, { xLabel: "Value added per hour worked, EUR", yLabel: "Hourly labor cost, EUR", xFmt: v => "€" + v.toFixed(0), yFmt: v => "€" + v.toFixed(0),
    fit: fit ? { predict: fit.predict } : null, highlight: p => p.geo === S.focus,
    colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 440 });

  const paths = [
    ["ulc", "Unit labor costs", "How the labor cost of producing one unit of output has changed, and how much of that came from pay and how much from productivity."],
    ["overview", "Map", "One indicator at a time on a map and in a ranking, for any year since 2000."],
    ["country", "Country profile", "The main figures for one country, how it ranks, and how it has changed."],
    ["industries", "Industries", "Output per worker, wage share and employment by activity, down to three-digit industries."],
    ["analysis", "Analysis", "Regressions on whether poorer countries are catching up and on how closely pay follows productivity."],
    ["casestudy", "Country brief", "Answer five questions and get a short summary for one country, ready to save as a PDF."],
  ];
  root.append(h("section", { class: "home-section" }, h("h2", {}, "Where to start"),
    h("div", { class: "home-paths" }, paths.map(([v, t, d]) => h("a", { class: "home-path", href: `#/${v}`, onclick: e => { e.preventDefault(); go(v); } }, h("b", {}, t), h("span", {}, d))))));

  root.append(h("section", { class: "home-section" }, h("h2", {}, "Before you start"),
    h("div", { class: "home-steps" },
      h("div", {}, "The bar under the menu sets the country, the countries to compare it with, the period and the sector. These settings stay the same when you change page, and they are saved in the link, so you can send someone exactly what you see."),
      h("div", {}, "EU27 is Eurostat's figure for the EU as a whole, so large countries count for more than small ones. Lines for regional groups are different: they show the middle country of the group, and each country counts the same."),
      h("div", {}, "Click \"Source and method\" under a chart to see where the data come from and how the numbers are calculated. The Methods page has the full list, including the limitations of the data."))));

  root.append(h("section", { class: "home-section" }, h("h2", {}, "About"),
    h("p", { class: "home-cite" }, "Gregor Dalheimer and Abaigeal Heneghan, Tony Blair Institute for Global Change. All data are public; the full tables can be downloaded from the Methods page."),
    h("p", { class: "home-cite" }, "Suggested citation: Dalheimer, G. and Heneghan, A. (2026). Labor Cost Atlas. Tony Blair Institute for Global Change.")));
}

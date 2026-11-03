// View: labor supply (population and projections, participation, unemployment, migration, vacancies)
import {
  d3, S, D, cname, cssVar, countryColor, h, showTip, hideTip, ttRow, pageHeader, figure, grid, kpiRow,
  svgEl, widthOf, lineChart, comparisonSeries, svgFlag,
} from "./core.js";

export async function loadLaborSupply() {
  if (D.ls) return D.ls;
  const rows = await d3.csv("data/labor_supply.csv", d3.autoType).catch(() => []);
  const idx = new Map();
  for (const r of rows) {
    if (!idx.has(r.metric)) idx.set(r.metric, new Map());
    const m = idx.get(r.metric);
    if (!m.has(r.geo)) m.set(r.geo, new Map());
    m.get(r.geo).set(r.year, r.value);
  }
  D.ls = { rows, idx };
  return D.ls;
}
const lv = (m, geo, y) => D.ls.idx.get(m)?.get(geo)?.get(y) ?? null;
const ser = (m, geo, from = 2000, to = 2050) => {
  const g = D.ls.idx.get(m)?.get(geo);
  return g ? [...g].filter(([y]) => y >= from && y <= to).sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, v })) : [];
};
const lastOf = (m, geo, maxYear = 2100) => { const s = ser(m, geo, 2000, maxYear); return s.length ? s[s.length - 1] : null; };
// Net migration per 1,000 inhabitants
const migRate = (geo, y) => { const n = lv("netmig", geo, y), p = lv("pop", geo, y); return n != null && p > 0 ? 1000 * n / p : null; };

export async function laborsupply(root) {
  await loadLaborSupply();
  const thisYear = new Date().getFullYear(), Y0 = 2024, Y1 = 2040;
  root.append(pageHeader("Labor supply", "Who is available to work",
    "Wages are one side of labor cost competitiveness; the number of people available to work is the other. " +
    "This page shows how the working-age population is projected to change, how many people take part in the labor market, how many are unemployed, and how migration and job vacancies have developed."));
  if (!D.ls.rows.length) { root.append(h("p", { class: "empty" }, "The labor supply data are not available in this build.")); return; }

  const geo = S.focus;
  const w0 = lv("wap", geo, Y0), w1 = lv("wap", geo, Y1);
  const lf = lastOf("lfpr", geo, thisYear), un = lastOf("unemp", geo, thisYear), yu = lastOf("unemp_youth", geo, thisYear);
  const od0 = lv("oadr", geo, Y0), od1 = lv("oadr", geo, Y1);
  const migYears = d3.range(thisYear - 6, thisYear).map(y => migRate(geo, y)).filter(v => v != null);
  root.append(kpiRow([
    { label: `Working-age population, ${Y0}–${Y1}`, value: w0 && w1 ? d3.format("+.1%")(w1 / w0 - 1).replace("-", "−") : "n/a", foot: "The change is projected for people aged 15 to 64." },
    { label: "Participation rate", value: lf ? lf.v.toFixed(1) + "%" : "n/a", foot: lf ? `Data for ${lf.year}. The share of people aged 15 to 64 who work or seek work.` : "No data are available." },
    { label: "Unemployment rate", value: un ? un.v.toFixed(1) + "%" : "n/a", foot: un ? `Data for ${un.year}.` : "No data are available." },
    { label: "Youth unemployment", value: yu ? yu.v.toFixed(1) + "%" : "n/a", foot: yu ? `Data for ${yu.year}. The rate is for ages 15 to 24.` : "No data are available." },
    { label: "Net migration", value: migYears.length ? d3.format("+.1f")(d3.mean(migYears)).replace("-", "−") : "n/a", foot: "The figure is per 1,000 inhabitants per year, averaged over recent years." },
    { label: "Old-age dependency", value: od0 ? od0.toFixed(0) : "n/a", foot: od0 && od1 ? `People aged 65 and over per 100 aged 15 to 64 in ${Y0}, projected to be ${od1.toFixed(0)} in ${Y1}.` : "No data are available." },
  ]));

  // Figure 1: working-age population index with projection
  const base = Math.max(S.base, 2000);
  const wapIdx = g => { const s = ser("wap", g, base, 2050), b = s.find(d => d.year === base)?.v; return b ? s.map(d => ({ year: d.year, v: 100 * d.v / b })) : []; };
  const list1 = comparisonSeries(wapIdx, { includeEU: false });
  const f1 = figure({ title: "Working-age population", span: 7,
    sub: `The index is set to 100 in ${base}, and values after ${thisYear - 1} are projections.`,
    text: "The working-age population is everyone aged 15 to 64. Projections assume continuing trends in fertility, mortality and migration.",
    note: "Data are from the World Bank population estimates and projections (SP.POP.1564.TO), which are based on the UN World Population Prospects.",
    csv: () => list1.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, index: d.v }))) });
  // Figure 2: projected change by country
  const chg = D.countries.map(c => { const a = lv("wap", c.geo, Y0), b = lv("wap", c.geo, Y1); return a && b ? { geo: c.geo, name: c.name, v: 100 * (b / a - 1) } : null; })
    .filter(Boolean).sort((a, b) => b.v - a.v);
  const f2 = figure({ title: `Projected change in the working-age population, ${Y0}–${Y1}`, span: 5,
    sub: "Values are percentage changes.",
    text: "Economies are sorted from the largest increase to the largest decline.",
    csv: () => chg.map(d => ({ country: d.name, change_pct: d.v })) });
  root.append(grid(f1.el, f2.el));
  lineChart(f1.body, list1, { height: 380, yFormat: d3.format(".0f"), indexLine: true, shadeFrom: thisYear - 1 });
  drawBars(f2.body, chg, v => d3.format("+.1f")(v).replace("-", "−") + "%");

  // Figure 3 and 4: participation and unemployment
  const list3 = comparisonSeries(g => ser("lfpr", g, base, thisYear), { includeEU: false });
  const f3 = figure({ title: "Labor force participation rate", span: 6,
    sub: "Values are the share of people aged 15 to 64 who work or seek work, in percent.",
    note: "Data are ILO modelled estimates (EAP_2WAP_SEX_AGE_RT), which fill gaps in national labor force surveys so that all countries can be compared.",
    csv: () => list3.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, rate: d.v }))) });
  const list4 = comparisonSeries(g => ser("unemp", g, base, thisYear), { includeEU: false });
  const f4 = figure({ title: "Unemployment rate", span: 6,
    sub: "Values are the share of the labor force aged 15 and over without work, in percent.",
    note: "Data are ILO modelled estimates (UNE_2EAP_SEX_AGE_RT).",
    csv: () => list4.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, rate: d.v }))) });
  root.append(grid(f3.el, f4.el));
  lineChart(f3.body, list3, { height: 320, yFormat: d3.format(".0f") });
  lineChart(f4.body, list4, { height: 320, yFormat: d3.format(".0f") });

  // Figure 5: net migration rate; Figure 6: job vacancy rate
  const mig = D.countries.map(c => {
    const vs = d3.range(thisYear - 6, thisYear).map(y => migRate(c.geo, y)).filter(v => v != null);
    return vs.length >= 3 ? { geo: c.geo, name: c.name, v: d3.mean(vs) } : null;
  }).filter(Boolean).sort((a, b) => b.v - a.v);
  const f5 = figure({ title: "Net migration", span: 6,
    sub: "Values are per 1,000 inhabitants per year, averaged over recent years.",
    text: "Positive values mean that more people arrived than left; negative values mean net emigration.",
    note: "Net migration (SM.POP.NETM) and population (SP.POP.TOTL) are from the World Bank. Migration figures are partly estimated and are revised often.",
    csv: () => mig.map(d => ({ country: d.name, net_migration_per_1000: d.v })) });
  const list6 = comparisonSeries(g => ser("jvr", g, base, thisYear), { includeEU: false });
  const f6 = figure({ title: "Job vacancy rate", span: 6,
    sub: "Values are open positions as a share of occupied and open positions, in percent.",
    text: "A rising rate signals that employers find it harder to fill jobs. Eurostat covers EU members and a few other European countries only.",
    note: "Data are from Eurostat (jvs_a_rate_r2) for industry, construction and services.",
    csv: () => list6.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, rate: d.v }))) });
  root.append(grid(f5.el, f6.el));
  drawBars(f5.body, mig, v => d3.format("+.1f")(v).replace("-", "−"));
  lineChart(f6.body, list6, { height: 320, yFormat: d3.format(".1f") });
}

// Horizontal bars around zero, with flags
function drawBars(host, rows, f) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 18, m = { l: 172, r: 64, t: 6, b: 6 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([Math.min(0, d3.min(rows, d => d.v)), Math.max(0, d3.max(rows, d => d.v))], [m.l, width - m.r]).nice();
  svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height);
  rows.forEach((d, i) => {
    const y = m.t + i * rowH, cy = y + (rowH - 6) / 2;
    const g = svg.append("g").on("mousemove", ev => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow("Value", f(d.v))}`)).on("mouseleave", hideTip);
    if (d.geo === S.focus) g.append("rect").attr("class", "row-hl").attr("x", 0).attr("y", y - 2).attr("width", width).attr("height", rowH);
    svgFlag(g, d.geo, m.l - 24, cy, 12);
    g.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 30).attr("y", cy).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(d.name);
    g.append("rect").attr("x", x(Math.min(0, d.v))).attr("y", y).attr("height", rowH - 6).attr("width", Math.abs(x(d.v) - x(0)))
      .attr("fill", d.geo === S.focus || S.comps.includes(d.geo) ? countryColor(d.geo) : cssVar("--context"));
    g.append("text").attr("class", "label").attr("x", d.v >= 0 ? x(d.v) + 6 : x(0) + 6).attr("y", cy).attr("dominant-baseline", "middle").text(f(d.v));
  });
}

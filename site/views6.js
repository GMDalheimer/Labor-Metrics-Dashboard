// Convergence calculator: when would an economy reach a given share of the EU level at its recent trend?
import {
  d3, S, D, EU, writeHash, cname, cssVar, h, showTip, hideTip, ttRow, figure, grid, seg, kpiRow,
  svgEl, widthOf, axisLeft, axisBottom, htmlFlag, val,
} from "./core.js";
import { loadPWT } from "./views5.js";

const rerender = () => dispatchEvent(new Event("lca:render"));
const set = patch => { Object.assign(S, patch); writeHash(); rerender(); };
const EU27 = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
const HORIZON = 60; // longest projection shown, in years

// Relative level series (EU27 = 100) for one economy
function relSeries(ind, geo) {
  if (ind === "gdppc") return D.allYears.map(y => ({ year: y, v: val("gdppc_pps", geo, y) })).filter(d => d.v > 0);
  // Output per hour at PPP (PWT rgdpo over hours), relative to the EU27 total (sum of output over sum of hours)
  const P = D.pwt; if (!P) return [];
  const m = P.idx.get(geo); if (!m) return [];
  const out = [];
  for (const [year, r] of m) {
    const hrs = r.emp * r.avh;
    if (!(r.rgdpo > 0 && hrs > 0)) continue;
    const eu = euProdPPP(year);
    if (eu) out.push({ year, v: 100 * (r.rgdpo / hrs) / eu });
  }
  return out.sort((a, b) => a.year - b.year);
}
const euCache = new Map();
function euProdPPP(year) {
  if (euCache.has(year)) return euCache.get(year);
  let y = 0, hrs = 0, n = 0;
  for (const g of EU27) {
    const r = D.pwt.idx.get(g)?.get(year);
    if (r && r.rgdpo > 0 && r.emp > 0 && r.avh > 0) { y += r.rgdpo; hrs += r.emp * r.avh; n++; }
  }
  const v = n === EU27.length ? y / hrs : null;   // only years with all 27 members
  euCache.set(year, v);
  return v;
}

// Trend: OLS slope of the log relative level over the last `win` years (log points per year)
function trend(series, win) {
  if (!series.length) return null;
  const end = series[series.length - 1].year;
  const pts = series.filter(d => d.year > end - win - 1 && d.year <= end);
  if (pts.length < Math.min(4, win)) return null;
  const xs = pts.map(d => d.year), ys = pts.map(d => Math.log(d.v));
  const mx = d3.mean(xs), my = d3.mean(ys);
  const g = d3.sum(xs, (x, i) => (x - mx) * (ys[i] - my)) / d3.sum(xs, x => (x - mx) ** 2);
  return { g, end, last: series[series.length - 1].v, from: pts[0].year };
}
// Year in which the target is reached at the trend; null if never within the horizon
function reach(t, target) {
  if (!t) return { status: "nodata" };
  if (t.last >= target) return { status: "above" };
  if (t.g <= 0) return { status: "diverging" };
  const yrs = Math.log(target / t.last) / t.g;
  return yrs > HORIZON ? { status: "beyond", yrs } : { status: "reached", year: t.end + Math.ceil(yrs), yrs };
}
const reachText = r => r.status === "reached" ? String(r.year) : r.status === "above" ? "Already above" : r.status === "diverging" ? "Not at this trend" : r.status === "beyond" ? `After ${HORIZON} years` : "n/a";

export async function convergence(root) {
  if (S.cvInd === "prod") await loadPWT();
  const ind = S.cvInd, target = S.cvTarget, win = S.cvWin, geo = S.focus;
  const label = ind === "gdppc" ? "GDP per capita" : "output per hour";
  root.append(h("h2", { class: "section-h" }, "Catching up with the EU"));
  root.append(h("p", { class: "page-desc section-desc" },
    `The calculator extends the recent trend of ${cname(geo)}'s ${label} relative to the EU and shows when a chosen share of the EU level would be reached. ` +
    "It is arithmetic, not a forecast: it assumes that the gap keeps closing, or widening, at the same rate as in the chosen period."));
  root.append(h("div", { class: "view-controls" },
    seg("Measure", [{ value: "gdppc", label: "GDP per capita" }, { value: "prod", label: "Output per hour" }], ind, v => set({ cvInd: v })),
    seg("Target", [60, 75, 90, 100].map(v => ({ value: v, label: `${v}% of the EU` })), target, v => set({ cvTarget: v })),
    seg("Trend over", [5, 10, 15].map(v => ({ value: v, label: `last ${v} years` })), win, v => set({ cvWin: v }))));

  const s = relSeries(ind, geo), t = trend(s, win), r = reach(t, target);
  root.append(kpiRow(t ? [
    { label: `Level in ${t.end}`, value: t.last.toFixed(0), foot: "The EU27 is set to 100." },
    { label: "Trend of the gap", value: (t.g >= 0 ? "+" : "−") + Math.abs(100 * t.g).toFixed(2), foot: `The figure is the change in log points per year, ${t.from}–${t.end}.` },
    { label: `Year ${target}% is reached`, value: reachText(r), foot: r.status === "reached" ? `This is ${Math.ceil(r.yrs)} years after ${t.end}.` : r.status === "diverging" ? "The gap widened over the chosen period." : r.status === "above" ? "The level is already at or above the target." : "The target is beyond the range shown." },
  ] : [{ label: cname(geo), value: "n/a", foot: `There are too few years of data for ${cname(geo)} on this measure.` }]));

  // Figure: history and projection
  const all = D.countries.map(c => { const sc = relSeries(ind, c.geo), tc = trend(sc, win); return { geo: c.geo, name: c.name, t: tc, r: reach(tc, target) }; }).filter(d => d.t);
  const src = ind === "gdppc" ? "Eurostat prc_ppp_ind" : "the Penn World Table 11.0 (output-side real GDP at chained PPPs, rgdpo, divided by persons engaged times average hours)";
  const f1 = figure({ title: `${ind === "gdppc" ? "GDP per capita" : "Output per hour"} relative to the EU27, ${cname(geo)}`, span: 7,
    sub: "The EU27 is set to 100, and the dashed line extends the recent trend.",
    text: `The trend is the average log change of the relative level over the last ${win} years, estimated by least squares. The horizontal line marks the target of ${target}% of the EU level.`,
    note: `Data are from ${src}.${ind === "prod" ? " The EU27 level is the sum of output over the sum of hours worked of all 27 members, so larger economies weigh more." : ""}`,
    method: [String.raw`$\ln r_{it} = a_i + g_i\, t + e_{it}, \qquad T_i = \frac{\ln(\bar r / r_{i,t_1})}{g_i}`, "Here r is the level relative to the EU27, g the trend, r̄ the target and T the number of years until the target is reached. When g is zero or negative, the target is not reached at the trend."],
    csv: () => s.map(d => ({ country: cname(geo), year: d.year, relative_level: d.v })) });
  const f2 = figure({ title: `Year in which ${target}% of the EU level is reached`, span: 5,
    sub: "Every economy is projected at its own trend.",
    text: "Economies are sorted by the year in which the target would be reached. Economies already above the target and those moving away from it are listed at the end.",
    csv: () => all.map(d => ({ country: d.name, level: d.t.last, trend_log_points: 100 * d.t.g, year_reached: reachText(d.r) })) });
  root.append(grid(f1.el, f2.el));
  drawProjection(f1.body, s, t, r, target);
  drawTable(f2.body, all, geo);
}

function drawProjection(host, s, t, r, target) {
  if (!s.length || !t) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const endP = r.status === "reached" ? Math.max(r.year, t.end + 5) : t.end + 20;
  const proj = d3.range(t.end, Math.min(endP, t.end + HORIZON) + 1).map(y => ({ year: y, v: t.last * Math.exp(t.g * (y - t.end)) }));
  const width = widthOf(host), height = 360, m = { t: 14, r: 64, b: 28, l: 44 };
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([s[0].year, proj[proj.length - 1].year], [m.l, width - m.r]);
  const y = d3.scaleLinear([0, Math.max(110, target + 10, d3.max([...s, ...proj], d => d.v))], [height - m.b, m.t]).nice();
  axisLeft(svg, y, m.l, d3.format(".0f"));
  axisBottom(svg, x, height - m.b, d3.format("d"), 8);
  svg.append("line").attr("class", "eu-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(100)).attr("y2", y(100));
  svg.append("text").attr("class", "annot").attr("x", width - m.r + 6).attr("y", y(100)).attr("dominant-baseline", "middle").text("EU27");
  svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(target)).attr("y2", y(target)).attr("stroke", cssVar("--s3")).attr("stroke-width", 1.2);
  svg.append("text").attr("class", "annot").attr("x", width - m.r + 6).attr("y", y(target)).attr("dominant-baseline", "middle").attr("fill", cssVar("--s3")).text(`${target}%`);
  const line = d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", line(s)).attr("fill", "none").attr("stroke", cssVar("--s1")).attr("stroke-width", 2.6);
  svg.append("path").attr("d", line(proj)).attr("fill", "none").attr("stroke", cssVar("--s1")).attr("stroke-width", 2).attr("stroke-dasharray", "5 4");
  if (r.status === "reached") {
    svg.append("circle").attr("cx", x(r.year)).attr("cy", y(target)).attr("r", 5).attr("fill", cssVar("--s3"));
    svg.append("text").attr("class", "label-strong").attr("x", x(r.year) - 10).attr("y", y(target) - 10).attr("text-anchor", "end").text(`${target}% in ${r.year}`);
  }
  svg.append("g").selectAll("circle.h").data(s).join("circle").attr("cx", d => x(d.year)).attr("cy", d => y(d.v)).attr("r", 6).attr("fill", "transparent")
    .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.year}</div>${ttRow("Relative level", d.v.toFixed(1))}`)).on("mouseleave", hideTip);
}

function drawTable(host, rows, focus) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const order = { reached: 0, beyond: 1, above: 2, diverging: 3, nodata: 4 };
  rows = [...rows].sort((a, b) => order[a.r.status] - order[b.r.status] || (a.r.year || a.r.yrs || 0) - (b.r.year || b.r.yrs || 0) || b.t.last - a.t.last);
  host.append(h("div", { class: "table-scroll" }, h("table", { class: "data conv-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Economy"), h("th", { class: "num" }, "Level"), h("th", { class: "num" }, "Trend"), h("th", { class: "num" }, "Year"))),
    h("tbody", {}, rows.map(d => h("tr", { class: d.geo === focus ? "focus" : "" },
      h("td", {}, htmlFlag(d.geo), " ", d.name),
      h("td", { class: "num" }, d.t.last.toFixed(0)),
      h("td", { class: "num" }, (d.t.g >= 0 ? "+" : "−") + Math.abs(100 * d.t.g).toFixed(2)),
      h("td", { class: "num" }, reachText(d.r))))))));
}

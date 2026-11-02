// Shared state, data access, formatting, UI and chart primitives.
import { METRICS, METRIC } from "./metrics.js";

export const d3 = window.d3;
export const EU = "EU27_2020";
const tip = document.getElementById("tooltip");

// ---------------------------------------------------------------------------
// State. Context (focus country, comparison countries, period, sector) is shared
// by every view and mirrored in the URL so a view can be shared as a link.
// ---------------------------------------------------------------------------
export const S = {
  view: "overview",
  focus: "RS",
  comps: ["HU", "PL", "RO"],
  context: [],          // any number of grey context economies
  groups: [],           // regional groups shown as median line with min-max band
  base: 2016,
  end: null,            // null = latest year with good coverage
  nace: "TOTAL",
  metric: "prod_hour",
  // view-specific
  year: null, ulcBasis: "per", tier: "manuf14", trend: "prod_hour", index: false,
  hourNace: "C", wageChange: 0,
  indLevel: "division", industry: "C29", indMetric: "va_worker", indYear: null,
  treeColor: "prod_nat", treeRoot: "TOTAL",
  model: "passthrough", regions: null, customY: "comp_pe", customX: "prod", customTY: "growth", customTX: "growth",
};

export function readHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  if (path) S.view = path;
  const p = new URLSearchParams(query || "");
  const num = k => (p.get(k) && !isNaN(+p.get(k)) ? +p.get(k) : null);
  if (p.get("f")) S.focus = p.get("f");
  if (p.has("c")) S.comps = p.get("c").split(",").filter(Boolean).slice(0, 3);
  if (p.has("x")) S.context = p.get("x").split(",").filter(Boolean);
  if (p.has("g")) S.groups = p.get("g").split("|").filter(Boolean);
  if (num("b")) S.base = num("b");
  if (num("e")) S.end = num("e");
  if (p.get("n")) S.nace = p.get("n");
  if (p.get("m") && METRIC[p.get("m")]) S.metric = p.get("m");
  if (num("y")) S.year = num("y");
  if (p.get("i")) S.industry = p.get("i");
  if (p.get("model")) S.model = p.get("model");
}
export function writeHash(push = false) {
  const p = new URLSearchParams();
  p.set("f", S.focus);
  p.set("c", S.comps.join(","));
  if (S.context.length) p.set("x", S.context.join(","));
  if (S.groups.length) p.set("g", S.groups.join("|"));
  p.set("b", S.base);
  if (S.end) p.set("e", S.end);
  p.set("n", S.nace);
  if (S.view === "overview") { p.set("m", S.metric); if (S.year) p.set("y", S.year); }
  if (S.view === "industries") p.set("i", S.industry);
  if (S.view === "analysis") p.set("model", S.model);
  const h = `#/${S.view}?${p.toString()}`;
  if (push) history.pushState(null, "", h); else history.replaceState(null, "", h);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
export let D;

export async function load() {
  const [sector, country, countries, sectors, meta] = await Promise.all([
    d3.csv("data/sector.csv", d3.autoType),
    d3.csv("data/country.csv", d3.autoType),
    d3.csv("data/countries.csv"),
    d3.csv("data/sectors.csv", d3.autoType),
    d3.json("data/meta.json").catch(() => ({})),
  ]);
  const sec = new Map();
  for (const r of sector) sec.set(`${r.geo}|${r.nace}|${r.year}`, r);
  const cty = new Map();
  for (const r of country) {
    if (!cty.has(r.metric)) cty.set(r.metric, new Map());
    const m = cty.get(r.metric);
    if (!m.has(r.geo)) m.set(r.geo, new Map());
    m.get(r.geo).set(r.year, r.value);
  }
  const name = new Map(countries.map(c => [c.geo, c.name]));
  name.set(EU, "EU27");
  const region = new Map(countries.map(c => [c.geo, c.region]));
  const lastYear = Math.min(new Date().getFullYear(), d3.max([d3.max(sector, d => d.year), d3.max(country, d => d.year)]));
  const allYears = d3.range(2000, lastYear + 1);
  const hasData = new Set([...sector.map(d => d.geo), ...country.map(d => d.geo)]);
  const list = countries.filter(c => c.geo !== EU && hasData.has(c.geo));
  D = { sector, country, countries: list, sectors, meta, sec, cty, name, region, allYears, world: null, full: null, industry: null, nace: null };
}

// Lazily loaded tables (larger files, used only by some views)
export async function loadWorld() {
  if (!D.world) D.world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json").catch(() => null);
  return D.world;
}
export async function loadFull() {
  if (!D.full) {
    const [full, industry, nace] = await Promise.all([
      d3.csv("data/sector_full.csv", d3.autoType).catch(() => []),
      d3.csv("data/industry.csv", d3.autoType).catch(() => []),
      d3.csv("data/nace.csv").catch(() => []),
    ]);
    const idx = new Map();
    for (const r of full) idx.set(`${r.geo}|${r.nace}|${r.year}`, r);
    const iidx = new Map();
    for (const r of industry) iidx.set(`${r.geo}|${r.nace}|${r.year}`, r);
    D.full = { rows: full, idx };
    D.industry = { rows: industry, idx: iidx };
    D.nace = new Map(nace.map(r => [r.code, r.label]));
  }
}

export const isSector = m => METRIC[m]?.table === "sector";

export function val(m, geo, year, nace = S.nace) {
  if (m === "va_hour_nom") {
    const r = D.sec.get(`${geo}|${nace}|${year}`);
    return r && r.gva_nom != null && r.emp_hours ? r.gva_nom / r.emp_hours * 1000 : null;
  }
  if (m === "emp") { const r = D.sec.get(`${geo}|${nace}|${year}`); return r?.emp ?? null; }
  if (isSector(m)) {
    const v = D.sec.get(`${geo}|${nace}|${year}`)?.[m];
    return v == null || Number.isNaN(v) ? null : v;
  }
  const v = D.cty.get(m)?.get(geo)?.get(year);
  return v == null ? null : v;
}
export const series = (m, geo, nace = S.nace) =>
  D.allYears.map(year => ({ year, v: val(m, geo, year, nace) })).filter(d => d.v != null);
export function latest(m, geo, nace = S.nace) {
  const s = series(m, geo, nace);
  return s.length ? s[s.length - 1] : null;
}
export function snapshot(m, year, nace = S.nace) {
  return D.countries.map(c => ({ geo: c.geo, name: c.name, region: c.region, v: val(m, c.geo, year, nace) })).filter(d => d.v != null);
}
export function coverage(m, nace = S.nace) {
  const counts = D.allYears.map(y => [y, snapshot(m, y, nace).length]);
  const best = d3.max(counts, d => d[1]) || 0;
  const years = counts.filter(d => d[1] > 0).map(d => d[0]);
  const good = counts.filter(d => d[1] >= 0.9 * best).map(d => d[0]);
  return { years, latest: d3.max(good) ?? d3.max(years), best };
}
export function rankOf(m, geo, year, nace = S.nace) {
  const snap = snapshot(m, year, nace).sort((a, b) => d3.descending(a.v, b.v));
  const i = snap.findIndex(d => d.geo === geo);
  return i < 0 ? null : { rank: i + 1, n: snap.length };
}
// End of the analysis period: user choice, else latest year with good coverage for the core series
export const endYear = () => {
  if (S.end) return S.end;
  const cov = coverage("prod", "TOTAL").latest;
  const own = latest("prod", S.focus, "TOTAL")?.year;
  return own ? Math.min(cov, own) : cov;
};
// Average annual log growth in percent between two years
export function growth(m, geo, y0, y1, nace = S.nace) {
  const a = val(m, geo, y0, nace), b = val(m, geo, y1, nace);
  return a > 0 && b > 0 && y1 > y0 ? 100 * Math.log(b / a) / (y1 - y0) : null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function fmt(m, v) {
  if (v == null || Number.isNaN(v)) return "n/a";
  const M = METRIC[m] || {};
  return (M.prefix || "") + d3.format(M.fmt || ",.2f")(v);
}
export const pct = d3.format("+.1%");
export const pp = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
export const cname = g => D.name.get(g) || g;
export const sectorLabel = n => (D.sectors.find(s => s.nace === n) || {}).label || (D.nace?.get(n)) || n;
// Colors are read from the document, or from a scoped element (the case-study slides are always light)
let colorScope = null;
export const setColorScope = el => { colorScope = el; };
export const cssVar = n => getComputedStyle(colorScope || document.documentElement).getPropertyValue(n).trim();
export const isDark = () => (colorScope || document.documentElement).dataset.theme === "dark";

// Fixed categorical slots: focus, then comparison countries in the order chosen, EU27 neutral
export function countryColor(geo) {
  if (geo === S.focus) return cssVar("--s1");
  if (geo === EU) return cssVar("--eu");
  const i = S.comps.filter(c => c !== S.focus).indexOf(geo);
  return i >= 0 ? cssVar(`--s${i + 2}`) : cssVar("--context-hi");
}
// Sequential: teal -> blue -> purple, light to dark (dark theme: low values recede into the surface)
// Series for line charts: focus, highlighted comparators and EU27 in color; context economies in grey
// (highlighted on hover); regional groups as a median line with a min-max band.
export function comparisonSeries(dataFn, { includeEU = true } = {}) {
  const main = [...new Set([S.focus, ...S.comps, ...(includeEU ? [EU] : [])])];
  const out = main.map(g => ({ key: g, label: cname(g), color: countryColor(g), width: g === S.focus ? 2.6 : 1.9, dash: g === EU ? "5 4" : null, data: dataFn(g) }));
  for (const g of S.context.filter(c => !main.includes(c))) out.push({ key: g, label: cname(g), color: cssVar("--context-hi"), width: 1.3, role: "context", data: dataFn(g) });
  for (const grp of S.groups) {
    const members = D.countries.filter(c => c.region === grp).map(c => c.geo);
    const per = new Map();
    for (const g of members) for (const d of dataFn(g)) { if (!per.has(d.year)) per.set(d.year, []); per.get(d.year).push(d.v); }
    const data = [...per].filter(([, vs]) => vs.length >= Math.max(2, Math.ceil(members.length / 2))).sort((a, b) => a[0] - b[0])
      .map(([year, vs]) => ({ year, v: d3.median(vs), lo: d3.min(vs), hi: d3.max(vs), n: vs.length }));
    out.push({ key: "grp:" + grp, label: `${grp} (median)`, color: cssVar("--text-2"), width: 1.8, dash: "2 3", band: true, data });
  }
  return out.filter(s => s.data.length);
}

export const seqRamp = () => isDark()
  ? ["#163b45", "#17707a", "#2c8fc6", "#7f8ff0", "#d6c8f8"]
  : ["#d9f2ee", "#8ed3c8", "#3aa3bb", "#2f69c4", "#45289a"];
// Diverging: purple (low) <- neutral grey -> teal (high)
export const divRamp = () => isDark()
  ? ["#b36ae0", "#5a3a73", "#2b2e33", "#1c5c57", "#22b3a8"]
  : ["#7b2fa8", "#d2b0e8", "#efeee9", "#95d6ce", "#0d7f78"];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

export function showTip(event, html) {
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const pad = 14, w = tip.offsetWidth, hh = tip.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > innerWidth - 8) x = event.clientX - w - pad;
  if (y + hh > innerHeight - 8) y = event.clientY - hh - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
export const hideTip = () => { tip.style.opacity = 0; };
export const ttRow = (k, v) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`;

export function pageHeader(kicker, title, desc) {
  return h("header", { class: "page-head" },
    h("p", { class: "kicker" }, kicker),
    h("h1", { class: "page-title" }, title),
    desc ? h("p", { class: "page-desc", html: desc }) : null);
}

// A figure: numbered title, subtitle, chart body, note. No box.
let figNo = 0;
export const resetFigures = () => { figNo = 0; };
export function figure({ title, sub, note, csv, png = true, span = 12, controls }) {
  figNo += 1;
  const body = h("div", { class: "fig-body" });
  const tools = h("div", { class: "fig-tools" });
  if (png) tools.append(h("button", { class: "link-btn", onclick: () => exportPNG(body.querySelector("svg"), title) }, "PNG"));
  if (csv) tools.append(h("button", { class: "link-btn", onclick: () => exportCSV(csv(), title) }, "CSV"));
  const noteEl = h("p", { class: "fig-note", html: note || "" });
  const el = h("figure", { class: `fig span-${span}` },
    h("div", { class: "fig-head" },
      h("div", {},
        h("h2", { class: "fig-title" }, h("span", { class: "fig-no" }, `Figure ${figNo}`), title),
        sub ? h("p", { class: "fig-sub" }, sub) : null),
      tools),
    controls ? h("div", { class: "fig-controls" }, controls) : null,
    body, noteEl);
  return { el, body, note: noteEl };
}
export const grid = (...kids) => h("div", { class: "grid" }, ...kids);

export function select(label, options, value, onchange, { compact = false } = {}) {
  const s = h("select", { class: "select", onchange: e => onchange(e.target.value), "aria-label": label },
    options.map(o => o.group
      ? h("optgroup", { label: o.group }, o.options.map(x => h("option", { value: x.value, selected: String(x.value) === String(value) ? "selected" : false }, x.label)))
      : h("option", { value: o.value, selected: String(o.value) === String(value) ? "selected" : false }, o.label)));
  return h("label", { class: `field ${compact ? "compact" : ""}` }, h("span", { class: "field-label" }, label), s);
}
// Segmented control: plain text options, the active one underlined
export function seg(label, options, value, onchange) {
  return h("div", { class: "field" }, label ? h("span", { class: "field-label" }, label) : null,
    h("div", { class: "seg", role: "radiogroup", "aria-label": label || "" },
      options.map(o => h("button", { class: `seg-opt ${o.value === value ? "on" : ""}`, role: "radio",
        "aria-checked": o.value === value ? "true" : "false", onclick: () => onchange(o.value) }, o.label))));
}
export const countryOptions = (withEU = false) =>
  [...D.countries.map(c => ({ value: c.geo, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)),
   ...(withEU ? [{ value: EU, label: "EU27" }] : [])];
export const yearOptions = years => years.map(y => ({ value: y, label: String(y) }));
export function sectorOptions() {
  const groups = [["total", "Total"], ["a10", "Sections"], ["manuf14", "Manufacturing branches"], ["manuf3", "Manufacturing rollup"]];
  const seen = new Set();
  return groups.map(([t, g]) => ({ group: g, options: D.sectors.filter(s => s.tier === t && !seen.has(s.nace) && seen.add(s.nace)).map(s => ({ value: s.nace, label: s.label })) }))
    .filter(g => g.options.length);
}

export function kpiRow(items) {
  return h("dl", { class: "kpis" }, items.map(it => h("div", { class: "kpi" },
    h("dt", {}, it.label),
    h("dd", { class: "kpi-value" }, it.value),
    it.foot ? h("dd", { class: "kpi-foot", html: it.foot }) : null)));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export function exportPNG(svg, name) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  const src = svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
  const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity",
                 "font-size", "font-family", "font-weight", "font-style", "text-anchor", "dominant-baseline"];
  src.forEach((el, i) => { const cs = getComputedStyle(el); dst[i].setAttribute("style", props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(";")); });
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("width", width); clone.setAttribute("height", height);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", cssVar("--bg"));
  clone.insertBefore(bg, clone.firstChild);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"), k = 2;
    c.width = width * k; c.height = height * k;
    const ctx = c.getContext("2d"); ctx.scale(k, k); ctx.drawImage(img, 0, 0);
    c.toBlob(b => download(b, slug(name) + ".png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}
export const exportCSV = (rows, name) => download(new Blob([d3.csvFormat(rows)], { type: "text/csv" }), slug(name) + ".csv");
function download(blob, file) {
  const a = h("a", { href: URL.createObjectURL(blob), download: file });
  document.body.append(a); a.click(); a.remove();
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// Chart primitives
// ---------------------------------------------------------------------------
export function svgEl(container, width, height) {
  return d3.select(container).append("svg").attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img");
}
export const widthOf = el => Math.max(280, el.getBoundingClientRect().width);

export function axisLeft(svg, y, x0, fmtf, ticks = 5) {
  svg.append("g").selectAll("line").data(y.ticks(ticks)).join("line").attr("class", "grid-line")
    .attr("x1", x0).attr("x2", svg.attr("width")).attr("y1", y).attr("y2", y);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${x0},0)`)
    .call(d3.axisLeft(y).ticks(ticks).tickFormat(fmtf).tickSize(0).tickPadding(8)).call(g => g.select(".domain").remove());
}
export function axisBottom(svg, x, y0, fmtf, ticks = 8) {
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y0})`)
    .call(d3.axisBottom(x).ticks(ticks).tickFormat(fmtf).tickSizeOuter(0));
}

export function sparkline(container, data, { width = 180, height = 36, color = cssVar("--s1") } = {}) {
  if (data.length < 2) return;
  const x = d3.scaleLinear(d3.extent(data, d => d.year), [2, width - 4]);
  const y = d3.scaleLinear(d3.extent(data, d => d.v), [height - 3, 3]);
  const svg = svgEl(container, width, height);
  svg.append("path").datum(data).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5)
    .attr("d", d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX));
  const last = data[data.length - 1];
  svg.append("circle").attr("cx", x(last.year)).attr("cy", y(last.v)).attr("r", 2.5).attr("fill", color);
}

// Line chart with crosshair tooltip. series: [{key, label, color, width, dash, data, role}]
export function lineChart(container, list, { height = 340, yFormat, indexLine = false, labelEnds = true, xDomain, refLine } = {}) {
  const width = widthOf(container);
  const m = { t: 12, r: labelEnds ? 120 : 16, b: 28, l: 58 };
  const all = list.flatMap(s => s.data.flatMap(d => (d.lo != null ? [d, { ...d, v: d.lo }, { ...d, v: d.hi }] : [d])));
  if (!all.length) { container.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const x = d3.scaleLinear(xDomain || d3.extent(all, d => d.year), [m.l, width - m.r]);
  const yd = d3.extent(all, d => d.v);
  if (indexLine) { yd[0] = Math.min(yd[0], 100); yd[1] = Math.max(yd[1], 100); }
  const y = d3.scaleLinear(yd, [height - m.b, m.t]).nice();
  const svg = svgEl(container, width, height);
  axisLeft(svg, y, m.l, yFormat);
  axisBottom(svg, x, height - m.b, d3.format("d"), Math.min(10, width / 80));
  if (indexLine) svg.append("line").attr("class", "ref-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(100)).attr("y2", y(100));
  if (refLine != null) svg.append("line").attr("class", "ref-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(refLine)).attr("y2", y(refLine));
  const line = d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX);
  for (const s of list.filter(s => s.band)) {
    svg.append("path").datum(s.data).attr("class", "group-band")
      .attr("d", d3.area().x(d => x(d.year)).y0(d => y(d.lo)).y1(d => y(d.hi)).curve(d3.curveMonotoneX));
  }
  const ordered = [...list].sort((a, b) => (b.role === "context") - (a.role === "context"));
  for (const s of ordered) {
    const p = svg.append("path").datum(s.data).attr("fill", "none").attr("stroke", s.color)
      .attr("stroke-width", s.width || 2).attr("stroke-dasharray", s.dash || null).attr("d", line)
      .attr("opacity", s.role === "context" ? .55 : 1);
    if (s.role === "context") {
      // wide invisible hit area: hovering a grey line highlights it and names it
      const lab = svg.append("text").attr("class", "label-strong").attr("opacity", 0);
      svg.append("path").datum(s.data).attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 10).attr("d", line).style("cursor", "pointer")
        .on("mouseenter", () => {
          p.raise().attr("stroke", cssVar("--text")).attr("opacity", 1).attr("stroke-width", 2);
          const e = s.data[s.data.length - 1];
          lab.raise().attr("x", x(e.year) + 6).attr("y", y(e.v)).attr("dominant-baseline", "middle").text(s.label).attr("opacity", 1);
        })
        .on("mouseleave", () => { p.attr("stroke", s.color).attr("opacity", .55).attr("stroke-width", s.width); lab.attr("opacity", 0); });
    }
    if (s.role !== "context" && !s.dash) {
      const len = p.node().getTotalLength();
      p.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
        .on("end", () => p.attr("stroke-dasharray", null));
    }
  }
  if (labelEnds) {
    const ends = list.filter(s => s.role !== "context" && s.data.length)
      .map(s => ({ s, y: y(s.data[s.data.length - 1].v), x: x(s.data[s.data.length - 1].year) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) {
      svg.append("circle").attr("cx", e.x).attr("cy", y(e.s.data[e.s.data.length - 1].v)).attr("r", 3).attr("fill", e.s.color);
      svg.append("text").attr("class", "label-strong").attr("x", e.x + 8).attr("y", e.y).attr("dominant-baseline", "middle").text(e.s.label);
    }
  }
  const fl = svg.append("line").attr("class", "crosshair").attr("y1", m.t).attr("y2", height - m.b).attr("opacity", 0);
  const dots = svg.append("g");
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", width - m.l - m.r).attr("height", height - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", ev => {
      const yr = Math.round(x.invert(d3.pointer(ev)[0]));
      const rows = list.map(s => ({ s, d: s.data.find(d => d.year === yr) })).filter(r => r.d).sort((a, b) => b.d.v - a.d.v);
      if (!rows.length) return;
      fl.attr("x1", x(yr)).attr("x2", x(yr)).attr("opacity", 1);
      dots.selectAll("circle").data(rows.filter(r => r.s.role !== "context")).join("circle")
        .attr("cx", x(yr)).attr("cy", r => y(r.d.v)).attr("r", 4).attr("fill", r => r.s.color).attr("stroke", cssVar("--bg")).attr("stroke-width", 2);
      const f = v => (yFormat ? yFormat(v) : v);
      showTip(ev, `<div class="tt-title">${yr}</div>` + rows.filter(r => r.s.role !== "context").slice(0, 12)
        .map(r => ttRow(r.s.label, f(r.d.v) + (r.d.lo != null ? ` <span class="tt-range">(${f(r.d.lo)}–${f(r.d.hi)})</span>` : ""))).join(""));
    })
    .on("mouseleave", () => { fl.attr("opacity", 0); dots.selectAll("*").remove(); hideTip(); });
  return { svg, x, y };
}

// Legend as text items with swatches (identity is never colour-only: lines are also end-labelled)
export function legend(items) {
  return h("div", { class: "legend" }, items.map(it => h("span", { class: "legend-item" },
    h("span", { class: `swatch ${it.shape || ""}`, style: `background:${it.color}` }), it.label)));
}

export function scatter(container, pts, { xLabel, yLabel, xFmt, yFmt, fit, height = 420, rKey, label = p => p.geo, highlight = () => false, colorOf, xTicks } = {}) {
  const width = widthOf(container), m = { t: 16, r: 20, b: 44, l: 58 };
  const svg = svgEl(container, width, height);
  if (pts.length < 3) { container.innerHTML = ""; container.append(h("p", { class: "empty" }, "Too few observations for this selection.")); return; }
  const x = d3.scaleLinear(d3.extent(pts, p => p.x), [m.l, width - m.r]).nice();
  const y = d3.scaleLinear(d3.extent(pts, p => p.y), [height - m.b, m.t]).nice();
  const r = rKey ? d3.scaleSqrt([0, d3.max(pts, p => p[rKey]) || 1], [3, 22]) : () => 5;
  axisLeft(svg, y, m.l, yFmt, 6);
  if (xTicks) svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).tickValues(xTicks(x.domain())).tickFormat(xFmt).tickSizeOuter(0));
  else axisBottom(svg, x, height - m.b, xFmt, 6);
  if (y.domain()[0] < 0 && y.domain()[1] > 0) svg.append("line").attr("class", "ref-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(0)).attr("y2", y(0));
  svg.append("text").attr("class", "annot").attr("x", width - m.r).attr("y", height - 6).attr("text-anchor", "end").text(xLabel + " →");
  svg.append("text").attr("class", "annot").attr("x", m.l).attr("y", 6).text("↑ " + yLabel);
  const clipId = "sc" + Math.random().toString(36).slice(2);
  svg.append("clipPath").attr("id", clipId).append("rect").attr("x", m.l).attr("y", m.t).attr("width", width - m.l - m.r).attr("height", height - m.t - m.b);
  if (fit) {
    // fitted line with 95% confidence band (clipped to the plot area)
    const xs = d3.range(61).map(i => x.domain()[0] + i / 60 * (x.domain()[1] - x.domain()[0]));
    const band = xs.map(xx => ({ x: xx, ...fit.predict(xx) }));
    svg.append("path").datum(band).attr("class", "ci-band").attr("clip-path", `url(#${clipId})`)
      .attr("d", d3.area().x(d => x(d.x)).y0(d => y(d.lo)).y1(d => y(d.hi)));
    svg.append("path").datum(band).attr("class", "fit-line").attr("clip-path", `url(#${clipId})`).attr("d", d3.line().x(d => x(d.x)).y(d => y(d.fit)));
  }
  const sorted = [...pts].sort((a, b) => (rKey ? (b[rKey] || 0) - (a[rKey] || 0) : 0));
  svg.selectAll("circle.pt").data(sorted).join("circle").attr("class", "pt")
    .attr("cx", p => x(p.x)).attr("cy", p => y(p.y))
    .attr("fill", p => colorOf ? colorOf(p) : highlight(p) ? cssVar("--s1") : cssVar("--context-hi"))
    .attr("fill-opacity", p => highlight(p) ? 1 : .7).attr("stroke", cssVar("--bg")).attr("stroke-width", 1.5)
    .attr("r", 0)
    .on("mousemove", (ev, p) => showTip(ev, `<div class="tt-title">${p.name}</div>${ttRow(yLabel, yFmt ? yFmt(p.y) : p.y.toFixed(2))}${ttRow(xLabel, xFmt ? xFmt(p.x) : p.x.toFixed(2))}`))
    .on("mouseleave", hideTip)
    .transition().duration(700).delay((p, i) => i * 10).attr("r", p => r(p[rKey] || 0));
  svg.selectAll("text.pl").data(pts).join("text").attr("class", p => highlight(p) ? "label-strong" : "annot")
    .attr("x", p => x(p.x)).attr("y", p => y(p.y) - r(p[rKey] || 0) - 4).attr("text-anchor", "middle").text(label);
  return { svg, x, y };
}

// Labour Cost Atlas
// Plain ES module on top of d3 (loaded globally in index.html). No build step.

import { METRICS, METRIC, CATEGORIES, PROFILE_METRICS } from "./metrics.js";

const d3 = window.d3;
const topojson = window.topojson;
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const EU = "EU27_2020";
const app = document.getElementById("app");
const tip = document.getElementById("tooltip");

// ---------------------------------------------------------------------------
// State (mirrored in the URL hash so any view can be shared as a link)
// ---------------------------------------------------------------------------
const S = {
  view: "atlas", focus: "RS", metric: "prod_hour", nace: "TOTAL", year: null,
  compare: ["RS", "HU", "PL", "DE"], base: 2016, end: null, tier: "manuf14",
  industry: "C293", indMetric: "va_worker", other: "DE", hourNace: "C",
  regions: null, trend: "prod_hour", index: false,
  sick: 0, paidShare: 100, wageChange: 0,
};

function readHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  if (path) S.view = path;
  const p = new URLSearchParams(query || "");
  if (p.get("f")) S.focus = p.get("f");
  if (p.get("m") && METRIC[p.get("m")]) S.metric = p.get("m");
  if (p.get("n")) S.nace = p.get("n");
  if (p.get("y")) S.year = +p.get("y");
  if (p.get("c")) S.compare = p.get("c").split(",").filter(Boolean).slice(0, 4);
  if (p.get("o")) S.other = p.get("o");
  if (p.get("i")) S.industry = p.get("i");
}
function writeHash(replace = true) {
  const p = new URLSearchParams();
  p.set("f", S.focus); p.set("m", S.metric); p.set("n", S.nace);
  if (S.year) p.set("y", S.year);
  if (S.view === "compare") p.set("c", S.compare.join(","));
  if (S.view === "hour") p.set("o", S.other);
  if (S.view === "industries") p.set("i", S.industry);
  const h = `#/${S.view}?${p.toString()}`;
  if (replace) history.replaceState(null, "", h); else history.pushState(null, "", h);
}
function go(view) { S.view = view; writeHash(false); render(); }

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------
let D; // filled by load()

async function load() {
  const [sector, country, industry, countries, sectors, meta, world] = await Promise.all([
    d3.csv("data/sector.csv", d3.autoType),
    d3.csv("data/country.csv", d3.autoType),
    d3.csv("data/industry.csv", d3.autoType).catch(() => []),
    d3.csv("data/countries.csv"),
    d3.csv("data/sectors.csv", d3.autoType),
    d3.json("data/meta.json").catch(() => ({})),
    d3.json(WORLD_URL).catch(() => null),
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
  const region = new Map(countries.map(c => [c.geo, c.region]));
  const allYears = d3.range(2000, d3.max([d3.max(sector, d => d.year), d3.max(country, d => d.year)]) + 1);

  // Only list countries that actually have data somewhere
  const hasData = new Set([...sector.map(d => d.geo), ...country.map(d => d.geo)]);
  const list = countries.filter(c => c.geo !== EU && hasData.has(c.geo));

  D = { sector, country, industry, countries: list, sectors, meta, world, sec, cty, name, region, allYears };
}

const isSector = m => METRIC[m]?.table === "sector";

function val(m, geo, year, nace = S.nace) {
  if (m === "va_hour_nom") {
    const r = D.sec.get(`${geo}|${nace}|${year}`);
    return r && r.gva_nom != null && r.emp_hours ? r.gva_nom / r.emp_hours * 1000 : null;
  }
  if (isSector(m)) {
    const r = D.sec.get(`${geo}|${nace}|${year}`);
    const v = r ? r[m] : null;
    return v == null || Number.isNaN(v) ? null : v;
  }
  const v = D.cty.get(m)?.get(geo)?.get(year);
  return v == null ? null : v;
}
function series(m, geo, nace = S.nace) {
  return D.allYears.map(year => ({ year, v: val(m, geo, year, nace) })).filter(d => d.v != null);
}
function latest(m, geo, nace = S.nace) {
  const s = series(m, geo, nace);
  return s.length ? s[s.length - 1] : null;
}
// Countries with a value in a given year
function snapshot(m, year, nace = S.nace, includeEU = false) {
  const geos = includeEU ? [...D.countries.map(c => c.geo), EU] : D.countries.map(c => c.geo);
  return geos.map(geo => ({ geo, name: D.name.get(geo), region: D.region.get(geo), v: val(m, geo, year, nace) }))
             .filter(d => d.v != null);
}
// Years with data, and the latest year with good coverage (at least 70% of the best year)
function yearsWithData(m, nace = S.nace) {
  const counts = D.allYears.map(y => [y, snapshot(m, y, nace).length]);
  const best = d3.max(counts, d => d[1]) || 0;
  const ys = counts.filter(d => d[1] > 0).map(d => d[0]);
  const good = counts.filter(d => d[1] >= 0.8 * best).map(d => d[0]);
  return { years: ys, latest: d3.max(good) ?? d3.max(ys), best };
}
function rankOf(m, geo, year, nace = S.nace) {
  const snap = snapshot(m, year, nace).sort((a, b) => d3.descending(a.v, b.v));
  const i = snap.findIndex(d => d.geo === geo);
  return i < 0 ? null : { rank: i + 1, n: snap.length };
}
function fmt(m, v) {
  if (v == null || Number.isNaN(v)) return "n/a";
  const M = METRIC[m] || {};
  const f = d3.format(M.fmt || ",.2f");
  return (M.prefix || "") + f(v);
}
const pct = d3.format("+.0%");
const metricAvailable = (m, nace = S.nace) => yearsWithData(m, nace).years.length > 0;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const naceLabel = n => (D.sectors.find(s => s.nace === n) || {}).label || n;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

function showTip(event, html) {
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const pad = 16, w = tip.offsetWidth, hgt = tip.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > innerWidth - 8) x = event.clientX - w - pad;
  if (y + hgt > innerHeight - 8) y = event.clientY - hgt - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.opacity = 0; };
const ttRow = (k, v) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`;

function card({ title, sub, csv, png = true, cls = "" }) {
  const body = h("div", { class: "card-body" });
  const actions = h("div", { class: "card-actions" });
  const el = h("section", { class: `card ${cls}` },
    h("div", { class: "card-head" },
      h("div", {}, h("h3", { class: "card-title" }, title), sub ? h("p", { class: "card-sub" }, sub) : null),
      actions),
    body);
  if (png) actions.append(h("button", { class: "mini-btn", onclick: () => exportPNG(body.querySelector("svg"), title) }, "PNG"));
  if (csv) actions.append(h("button", { class: "mini-btn", onclick: () => exportCSV(csv(), title) }, "CSV"));
  return { el, body };
}

function select(label, options, value, onchange) {
  const s = h("select", { class: "select", onchange: e => onchange(e.target.value) },
    options.map(o => h("option", { value: o.value, selected: o.value === value ? "selected" : false }, o.label)));
  return h("div", { class: "control" }, h("label", {}, label), s);
}
const countryOptions = (withEU = false) =>
  [...D.countries.map(c => ({ value: c.geo, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)),
   ...(withEU ? [{ value: EU, label: "EU27 average" }] : [])];
const sectorOptions = () => {
  const seen = new Set();
  return D.sectors.filter(s => s.tier !== "manuf3" && !seen.has(s.nace) && seen.add(s.nace))
    .map(s => ({ value: s.nace, label: s.tier === "manuf14" ? `Manufacturing: ${s.label}` : s.label }));
};

function metricPicker(current, onpick, filter = () => true) {
  const wrap = h("div", { class: "metric-picker" });
  for (const cat of CATEGORIES) {
    const ms = METRICS.filter(m => m.cat === cat && filter(m));
    if (!ms.length) continue;
    wrap.append(h("div", { class: "metric-group" }, h("span", {}, cat),
      h("div", { class: "chips" }, ms.map(m => h("button", {
        class: `chip ${m.key === current ? "on" : ""}`, title: m.desc, onclick: () => onpick(m.key),
      }, m.label)))));
  }
  return wrap;
}

function hero(eyebrow, title, lede, right) {
  return h("div", { class: "hero" },
    h("div", {}, h("p", { class: "eyebrow" }, eyebrow), h("h1", { class: "display", html: title }),
      lede ? h("p", { class: "lede", html: lede }) : null),
    right || h("div"));
}

// Export a chart: copy computed styles inline so the PNG matches the screen
function exportPNG(svg, name) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  const src = svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
  const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity",
                 "stroke-opacity", "font-size", "font-family", "font-weight", "font-style"];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    dst[i].setAttribute("style", props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  });
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("width", width); clone.setAttribute("height", height);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", cssVar("--surface"));
  clone.insertBefore(bg, clone.firstChild);
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"), k = 2;
    c.width = width * k; c.height = height * k;
    const ctx = c.getContext("2d"); ctx.scale(k, k); ctx.drawImage(img, 0, 0);
    c.toBlob(b => download(b, slug(name) + ".png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
}
function exportCSV(rows, name) {
  download(new Blob([d3.csvFormat(rows)], { type: "text/csv" }), slug(name) + ".csv");
}
function download(blob, file) {
  const a = h("a", { href: URL.createObjectURL(blob), download: file });
  document.body.append(a); a.click(); a.remove();
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function svgEl(container, width, height) {
  return d3.select(container).append("svg").attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img");
}
const widthOf = el => Math.max(280, el.getBoundingClientRect().width);

// Sequential colour ramp, stepped for the current theme (low values recede into the surface)
function seqRamp() {
  return document.documentElement.dataset.theme === "dark"
    ? ["#16365f", "#1c5cab", "#3987e5", "#86b6ef", "#cde2fb"]
    : ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
}

// Small line chart used by tiles and small multiples
function sparkline(container, data, { width = 200, height = 42, color = cssVar("--s1") } = {}) {
  if (data.length < 2) return;
  const x = d3.scaleLinear(d3.extent(data, d => d.year), [2, width - 4]);
  const y = d3.scaleLinear(d3.extent(data, d => d.v), [height - 4, 4]);
  const svg = svgEl(container, width, height);
  const area = d3.area().x(d => x(d.year)).y0(height).y1(d => y(d.v)).curve(d3.curveMonotoneX);
  const id = "g" + Math.random().toString(36).slice(2);
  const g = svg.append("defs").append("linearGradient").attr("id", id).attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
  g.append("stop").attr("offset", 0).attr("stop-color", color).attr("stop-opacity", .28);
  g.append("stop").attr("offset", 1).attr("stop-color", color).attr("stop-opacity", 0);
  svg.append("path").datum(data).attr("d", area).attr("fill", `url(#${id})`);
  const line = svg.append("path").datum(data).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2)
    .attr("d", d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX));
  const len = line.node().getTotalLength();
  line.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
    .transition().duration(1200).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
  const last = data[data.length - 1];
  svg.append("circle").attr("cx", x(last.year)).attr("cy", y(last.v)).attr("r", 3.5).attr("fill", color);
}

// Line chart with hover crosshair. series: [{key, label, color, width, data:[{year,v}], role}]
function lineChart(container, seriesList, { height = 340, yFormat, yLabel, indexLine = false, labelEnds = true } = {}) {
  const width = widthOf(container);
  const m = { t: 18, r: labelEnds ? 130 : 20, b: 30, l: 56 };
  const all = seriesList.flatMap(s => s.data);
  if (!all.length) { container.append(h("p", { class: "empty" }, "No data for this selection.")); return; }
  const x = d3.scaleLinear(d3.extent(all, d => d.year), [m.l, width - m.r]);
  const y = d3.scaleLinear(d3.extent(all, d => d.v), [height - m.b, m.t]).nice();
  const svg = svgEl(container, width, height);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "grid-line")
    .attr("x1", m.l).attr("x2", width - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).ticks(Math.min(10, width / 80)).tickFormat(d3.format("d")).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(yFormat).tickSize(0)).call(g => g.select(".domain").remove());
  if (yLabel) svg.append("text").attr("class", "annot").attr("x", m.l).attr("y", 8).text(yLabel);
  if (indexLine && y.domain()[0] < 100 && y.domain()[1] > 100)
    svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(100)).attr("y2", y(100))
      .attr("stroke", cssVar("--text-3")).attr("stroke-dasharray", "4 4");

  const line = d3.line().x(d => x(d.year)).y(d => y(d.v)).curve(d3.curveMonotoneX).defined(d => d.v != null);
  const ordered = [...seriesList].sort((a, b) => (a.role === "context") - (b.role === "context")).reverse();
  for (const s of ordered) {
    const p = svg.append("path").datum(s.data).attr("fill", "none").attr("stroke", s.color)
      .attr("stroke-width", s.width || 2).attr("stroke-linejoin", "round").attr("d", line)
      .attr("opacity", s.role === "context" ? .7 : 1);
    if (s.role !== "context") {
      const len = p.node().getTotalLength();
      p.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(1100).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
        .on("end", () => p.attr("stroke-dasharray", null));
    }
  }
  if (labelEnds) {
    const ends = seriesList.filter(s => s.role !== "context" && s.data.length)
      .map(s => ({ s, y: y(s.data[s.data.length - 1].v), x: x(s.data[s.data.length - 1].year) }));
    // simple vertical de-collision
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) {
      svg.append("circle").attr("cx", e.x).attr("cy", y(e.s.data[e.s.data.length - 1].v)).attr("r", 3.5).attr("fill", e.s.color);
      svg.append("text").attr("class", "label-strong").attr("x", e.x + 8).attr("y", e.y + 4).text(e.s.label);
    }
  }
  // crosshair + tooltip
  const focusLine = svg.append("line").attr("stroke", cssVar("--text-3")).attr("y1", m.t).attr("y2", height - m.b).attr("opacity", 0);
  const dots = svg.append("g");
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", width - m.l - m.r).attr("height", height - m.t - m.b)
    .attr("fill", "transparent")
    .on("mousemove", ev => {
      const yr = Math.round(x.invert(d3.pointer(ev)[0]));
      const rows = seriesList.filter(s => s.role !== "context" || seriesList.length < 12)
        .map(s => ({ s, d: s.data.find(d => d.year === yr) })).filter(r => r.d)
        .sort((a, b) => b.d.v - a.d.v);
      if (!rows.length) return;
      focusLine.attr("x1", x(yr)).attr("x2", x(yr)).attr("opacity", .6);
      dots.selectAll("circle").data(rows.filter(r => r.s.role !== "context")).join("circle")
        .attr("cx", x(yr)).attr("cy", r => y(r.d.v)).attr("r", 4.5).attr("fill", r => r.s.color)
        .attr("stroke", cssVar("--surface")).attr("stroke-width", 2);
      showTip(ev, `<div class="tt-title">${yr}</div>` +
        rows.slice(0, 10).map(r => ttRow(r.s.label, yFormat ? yFormat(r.d.v) : r.d.v)).join(""));
    })
    .on("mouseleave", () => { focusLine.attr("opacity", 0); dots.selectAll("*").remove(); hideTip(); });
  return svg;
}

// ---------------------------------------------------------------------------
// View: Atlas (map + ranking + timeline)
// ---------------------------------------------------------------------------
let playTimer = null;

function renderAtlas(root) {
  if (!isSector(S.metric)) S.nace = S.nace || "TOTAL";
  const cov = yearsWithData(S.metric);
  if (!cov.years.length) { S.metric = "prod_hour"; return renderAtlas(root); }
  if (!S.year || !cov.years.includes(S.year)) S.year = cov.latest;
  const M = METRIC[S.metric];
  const nCountries = D.countries.length;

  root.append(hero(
    "Europe · Western Balkans · North Africa",
    `What an hour of work <em>costs</em>,<br>and what it <em>produces</em>.`,
    `${nCountries} countries, ${METRICS.length} indicators, ${D.allYears[0]} to ${d3.max(D.allYears)}. Pick an indicator, press play to watch it change, and click any country to open its profile.`,
  ));

  const controls = h("div", { class: "controls" });
  controls.append(metricPicker(S.metric, k => { S.metric = k; S.year = null; writeHash(); render(); }));
  root.append(controls);
  if (isSector(S.metric)) {
    root.append(h("div", { class: "controls" },
      select("Sector", sectorOptions(), S.nace, v => { S.nace = v; S.year = null; writeHash(); render(); }),
      select("Highlight", countryOptions(), S.focus, v => { S.focus = v; writeHash(); render(); })));
  } else {
    root.append(h("div", { class: "controls" },
      select("Highlight", countryOptions(), S.focus, v => { S.focus = v; writeHash(); render(); })));
  }

  const grid = h("div", { class: "grid g-2" });
  const mapCard = card({ title: M.label, sub: `${M.unit}${isSector(S.metric) ? " · " + naceLabel(S.nace) : ""}`,
    csv: () => snapshot(S.metric, S.year).map(d => ({ country: d.name, year: S.year, value: d.v })) });
  const rankCard = card({ title: "Ranking", sub: "All countries with data, highest first",
    csv: () => snapshot(S.metric, S.year).sort((a, b) => b.v - a.v).map((d, i) => ({ rank: i + 1, country: d.name, value: d.v })) });
  grid.append(mapCard.el, rankCard.el);
  root.append(grid);

  // Timeline
  const yearLabel = h("div", { class: "year-big" }, String(S.year));
  const range = h("input", { type: "range", class: "range", min: d3.min(cov.years), max: d3.max(cov.years), step: 1, value: S.year });
  const playBtn = h("button", { class: "play", title: "Play", "aria-label": "Play through the years" });
  const setPlayIcon = on => playBtn.innerHTML = on
    ? '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';
  setPlayIcon(false);
  mapCard.body.append(h("div", { class: "timeline" }, playBtn, yearLabel, range));

  const mapHost = h("div");
  mapCard.body.append(mapHost);
  const legendHost = h("div");
  mapCard.body.append(legendHost);

  // colour domain fixed across all years so animation shows real change
  const allVals = cov.years.flatMap(y => snapshot(S.metric, y).map(d => d.v)).sort(d3.ascending);
  const lo = d3.quantileSorted(allVals, .03), hi = d3.quantileSorted(allVals, .97);
  const color = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp())).domain([lo, hi]).clamp(true);

  const mapApi = drawMap(mapHost, color);
  drawLegend(legendHost, color, M);
  const rankApi = drawRanking(rankCard.body);

  const insights = h("div", { class: "insights" });
  root.append(insights);

  function update(animate = true) {
    yearLabel.textContent = S.year;
    range.value = S.year;
    mapApi.update(animate);
    rankApi.update(animate);
    renderInsights(insights);
  }
  range.addEventListener("input", () => { S.year = +range.value; writeHash(); update(); });
  playBtn.addEventListener("click", () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; setPlayIcon(false); return; }
    const ys = cov.years.filter(y => y <= cov.latest);
    if (S.year >= cov.latest) S.year = ys[0];
    setPlayIcon(true);
    update();
    playTimer = setInterval(() => {
      const i = ys.indexOf(S.year);
      if (i >= ys.length - 1) { clearInterval(playTimer); playTimer = null; setPlayIcon(false); writeHash(); return; }
      S.year = ys[i + 1]; update();
    }, 750);
  });
  update(false);
}

function drawMap(host, color) {
  const width = widthOf(host), height = Math.round(width * .78);
  const svg = svgEl(host, width, height);
  if (!D.world) {
    svg.append("text").attr("class", "annot").attr("x", 10).attr("y", 20).text("Map geometry could not be loaded.");
    return { update() {} };
  }
  const feats = topojson.feature(D.world, D.world.objects.countries).features;
  const byNum = new Map(D.countries.filter(c => c.isonum).map(c => [c.isonum, c.geo]));
  const kosovo = D.countries.find(c => c.geo === "XK");
  for (const f of feats) f.geo = byNum.get(String(f.id)) || (kosovo && f.properties?.name === "Kosovo" ? "XK" : null);

  // Frame Europe, the Western Balkans and North Africa (fixed box, so overseas territories do not distort it)
  const box = { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[-11, 34], [33, 71], [42, 37], [-8, 26], [32, 25], [25, 71]] } };
  const proj = d3.geoAzimuthalEqualArea().rotate([-12, -50]).fitExtent([[10, 10], [width - 10, height - 10]], box);
  const path = d3.geoPath(proj);
  const clipId = "clip" + Math.random().toString(36).slice(2);
  svg.append("clipPath").attr("id", clipId).append("rect").attr("width", width).attr("height", height).attr("rx", 10);
  const g = svg.append("g").attr("clip-path", `url(#${clipId})`).append("g");
  const near = f => { const [[x0, y0], [x1, y1]] = d3.geoBounds(f); return x1 > -40 && x0 < 75 && y1 > 5 && y0 < 85 && (x1 - x0) < 200; };
  g.append("path").datum({ type: "Sphere" }).attr("d", path).attr("fill", cssVar("--bg"));
  const paths = g.selectAll("path.country-path").data(feats.filter(near)).join("path")
    .attr("class", f => `country-path ${f.geo === S.focus ? "focus" : ""}`)
    .attr("d", path)
    .attr("fill", cssVar("--map-empty"))
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-width", .6)
    .on("mousemove", (ev, f) => {
      if (!f.geo) return hideTip();
      const v = val(S.metric, f.geo, S.year);
      const r = rankOf(S.metric, f.geo, S.year);
      showTip(ev, `<div class="tt-title">${D.name.get(f.geo)}</div>` + ttRow(S.year, fmt(S.metric, v)) +
        (r ? ttRow("Rank", `${r.rank} of ${r.n}`) : "") + `<div class="note">Click to open the profile</div>`);
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, f) => { if (f.geo) { S.focus = f.geo; hideTip(); go("country"); } });
  paths.filter(f => f.geo === S.focus).raise();

  // Zoom and pan
  svg.call(d3.zoom().scaleExtent([1, 6]).on("zoom", ev => g.attr("transform", ev.transform)));

  return {
    update(animate) {
      const t = paths.transition().duration(animate ? 600 : 0);
      t.attr("fill", f => {
        if (!f.geo) return cssVar("--map-empty");
        const v = val(S.metric, f.geo, S.year);
        return v == null ? cssVar("--map-empty") : color(v);
      });
    },
  };
}

function drawLegend(host, color, M) {
  const width = Math.min(360, widthOf(host)), height = 44;
  const svg = svgEl(host, width, height).attr("class", "legend-ramp");
  const id = "ramp" + Math.random().toString(36).slice(2);
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, .1).forEach(t => grad.append("stop").attr("offset", t)
    .attr("stop-color", color(color.domain()[0] + t * (color.domain()[1] - color.domain()[0]))));
  svg.append("rect").attr("x", 0).attr("y", 14).attr("width", width).attr("height", 8).attr("rx", 4).attr("fill", `url(#${id})`);
  const x = d3.scaleLinear(color.domain(), [0, width]);
  svg.append("g").attr("class", "axis").attr("transform", "translate(0,26)")
    .call(d3.axisBottom(x).ticks(4).tickFormat(v => fmt(M.key, v)).tickSize(0)).call(g => g.select(".domain").remove());
  svg.append("text").attr("class", "annot").attr("y", 9).text("Lower");
  svg.append("text").attr("class", "annot").attr("x", width).attr("y", 9).attr("text-anchor", "end").text("Higher");
  svg.append("rect").attr("x", width - 140).attr("y", -999);
}

function drawRanking(host) {
  const list = h("div", { class: "rank-list" });
  host.append(list);
  const width = widthOf(host) - 8, rowH = 20, m = { l: 140, r: 74 };
  const svg = d3.select(list).append("svg").attr("width", width);
  const gEU = svg.append("g");
  const gRows = svg.append("g");
  return {
    update(animate) {
      const data = snapshot(S.metric, S.year).sort((a, b) => b.v - a.v);
      const eu = val(S.metric, EU, S.year);
      const height = data.length * rowH + 24;
      svg.attr("height", height);
      const max = d3.max([...data.map(d => d.v), eu || 0]);
      const min = Math.min(0, d3.min(data, d => d.v));
      const x = d3.scaleLinear([min, max], [m.l, width - m.r]);
      const t = svg.transition().duration(animate ? 600 : 0).ease(d3.easeCubicInOut);
      const rows = gRows.selectAll("g.row").data(data, d => d.geo).join(
        enter => {
          const g = enter.append("g").attr("class", "row").attr("transform", (d, i) => `translate(0,${i * rowH + 18})`)
            .style("cursor", "pointer").attr("opacity", 0);
          g.append("rect").attr("class", "bar").attr("height", rowH - 6).attr("y", 0).attr("rx", 3).attr("x", x(Math.max(0, min))).attr("width", 0);
          g.append("text").attr("class", "name label").attr("x", m.l - 8).attr("y", rowH / 2).attr("text-anchor", "end");
          g.append("text").attr("class", "value label").attr("y", rowH / 2);
          return g;
        },
        update => update,
        exit => exit.transition(t).attr("opacity", 0).remove());
      rows.on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(S.year, fmt(S.metric, d.v))}`))
        .on("mouseleave", hideTip)
        .on("click", (ev, d) => { S.focus = d.geo; hideTip(); go("country"); });
      rows.transition(t).attr("opacity", 1).attr("transform", (d, i) => `translate(0,${i * rowH + 18})`);
      rows.select("rect.bar").transition(t).attr("x", d => x(Math.min(0, d.v) < 0 ? d.v : Math.max(0, min)))
        .attr("width", d => Math.abs(x(d.v) - x(Math.max(0, min))))
        .attr("fill", d => d.geo === S.focus ? cssVar("--s1") : cssVar("--context"));
      rows.select("text.name").text(d => d.name).attr("dy", "-0.05em").attr("dominant-baseline", "middle")
        .attr("class", d => `name ${d.geo === S.focus ? "label-strong" : "label"}`);
      rows.select("text.value").text(d => fmt(S.metric, d.v)).attr("dominant-baseline", "middle")
        .transition(t).attr("x", d => x(d.v) + 6);
      gEU.selectAll("*").remove();
      if (eu != null) {
        gEU.append("line").attr("x1", x(eu)).attr("x2", x(eu)).attr("y1", 12).attr("y2", height)
          .attr("stroke", cssVar("--s2")).attr("stroke-dasharray", "3 3").attr("stroke-width", 1.5);
        gEU.append("text").attr("class", "annot").attr("x", x(eu)).attr("y", 9).attr("text-anchor", "middle")
          .attr("fill", cssVar("--s2")).text(`EU27 ${fmt(S.metric, eu)}`);
      }
    },
  };
}

function renderInsights(host) {
  host.innerHTML = "";
  const snap = snapshot(S.metric, S.year).sort((a, b) => b.v - a.v);
  if (!snap.length) return;
  const top = snap[0], bot = snap[snap.length - 1];
  const base = Math.max(S.base, yearsWithData(S.metric).years[0]);
  const changes = snap.map(d => ({ ...d, b: val(S.metric, d.geo, base) })).filter(d => d.b > 0 && base < S.year)
    .map(d => ({ ...d, ch: d.v / d.b - 1 })).sort((a, b) => b.ch - a.ch);
  const f = snap.find(d => d.geo === S.focus);
  const items = [
    [fmt(S.metric, top.v), `Highest in ${S.year}: <strong>${top.name}</strong>, ${(top.v / bot.v).toFixed(1)}× the lowest (${bot.name}).`],
    changes.length ? [pct(changes[0].ch), `Fastest rise since ${base}: <strong>${changes[0].name}</strong>. Slowest: ${changes[changes.length - 1].name} (${pct(changes[changes.length - 1].ch)}).`] : null,
    f ? [fmt(S.metric, f.v), `<strong>${f.name}</strong> ranks ${snap.indexOf(f) + 1} of ${snap.length}${val(S.metric, EU, S.year) ? `, at ${d3.format(".0%")(f.v / val(S.metric, EU, S.year))} of the EU27 average` : ""}.`] : null,
  ].filter(Boolean);
  for (const [big, txt] of items) host.append(h("div", { class: "insight" }, h("b", {}, big), h("span", { html: txt })));
}

// ---------------------------------------------------------------------------
// View: Country profile
// ---------------------------------------------------------------------------
function renderCountry(root) {
  const geo = S.focus, name = D.name.get(geo);
  const region = D.region.get(geo);
  const avail = PROFILE_METRICS.filter(m => latest(m, geo, "TOTAL"));

  // Auto summary
  const bits = [];
  const ph = latest("prod_hour", geo, "TOTAL"), lc = latest("lc_hour", geo) || latest("lc_hour_c", geo);
  const euPh = ph && val("prod_hour", EU, ph.year, "TOTAL");
  if (ph) bits.push(`Each hour worked produces <b>${fmt("prod_hour", ph.v)}</b> of value added (${ph.year})${euPh ? `, <b>${d3.format(".0%")(ph.v / euPh)}</b> of the EU27 level` : ""}.`);
  if (lc) bits.push(`An hour of labour costs employers <b>${fmt("lc_hour", lc.v)}</b> (${lc.year}).`);
  const u0 = val("ulc", geo, 2016, "TOTAL"), u1 = latest("ulc", geo, "TOTAL");
  if (u0 && u1) bits.push(`Unit labour costs have moved <b>${pct(u1.v / u0 - 1)}</b> since 2016.`);

  root.append(hero(region, `${name}`, bits.join(" ") || "Limited data available for this country.",
    h("div", { class: "controls" },
      select("Country", countryOptions(), geo, v => { S.focus = v; writeHash(); render(); }),
      h("div", { class: "control" }, h("label", {}, " "),
        h("button", { class: "chip on", onclick: () => { S.compare = [geo, ...S.compare.filter(c => c !== geo)].slice(0, 4); go("compare"); } }, "Compare with others →")))));

  // KPI tiles
  const tiles = h("div", { class: "kpis" });
  avail.forEach((m, i) => {
    const l = latest(m, geo, "TOTAL");
    const r = rankOf(m, geo, l.year, "TOTAL");
    const tile = h("div", { class: "kpi", style: `animation-delay:${i * 40}ms`, title: METRIC[m].desc,
      onclick: () => { S.trend = m; render(); } },
      h("p", { class: "kpi-label" }, METRIC[m].label),
      h("div", { class: "kpi-value" }, fmt(m, l.v)),
      h("div", { class: "kpi-unit" }, `${l.year}`));
    const spark = h("div");
    tile.append(spark, h("div", { class: "kpi-foot" }, h("span", {}, r ? "Rank" : ""), r ? h("span", { class: "rank-badge" }, `${r.rank} / ${r.n}`) : ""));
    tiles.append(tile);
    requestAnimationFrame(() => sparkline(spark, series(m, geo, "TOTAL"), { width: Math.max(160, tile.clientWidth - 36) }));
  });
  root.append(tiles);

  const grid = h("div", { class: "grid g-2e", style: "margin-top:18px" });
  const fp = card({ title: "Fingerprint", sub: "Where the country sits among all countries, latest year. Each dot is a country.", csv: null });
  if (!avail.includes(S.trend)) S.trend = avail[0] || "prod_hour";
  const tr = card({ title: `${METRIC[S.trend].label}: ${name} vs its region and the EU27`, sub: METRIC[S.trend].unit,
    csv: () => series(S.trend, geo, "TOTAL").map(d => ({ country: name, year: d.year, value: d.v })) });
  grid.append(fp.el, tr.el);
  root.append(grid);
  drawFingerprint(fp.body, geo, avail);

  const peers = D.countries.filter(c => c.region === region && c.geo !== geo).map(c => c.geo);
  const list = [
    ...peers.map(p => ({ key: p, label: D.name.get(p), color: cssVar("--context-hi"), width: 1.2, role: "context", data: series(S.trend, p, "TOTAL") })),
    { key: EU, label: "EU27", color: cssVar("--s2"), width: 2, data: series(S.trend, EU, "TOTAL") },
    { key: geo, label: name, color: cssVar("--s1"), width: 3, data: series(S.trend, geo, "TOTAL") },
  ];
  lineChart(tr.body, list, { yFormat: v => fmt(S.trend, v), height: 360 });
  tr.body.append(h("p", { class: "note" }, `Grey lines: other ${region} countries. Click a tile above to change the indicator.`));
}

function drawFingerprint(host, geo, metrics) {
  const width = widthOf(host), rowH = 34, m = { l: 190, r: 70, t: 24 };
  const height = metrics.length * rowH + m.t + 26;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, 1], [m.l, width - m.r]);
  svg.append("text").attr("class", "annot").attr("x", m.l).attr("y", 12).text("Lowest");
  svg.append("text").attr("class", "annot").attr("x", width - m.r).attr("y", 12).attr("text-anchor", "end").text("Highest");
  metrics.forEach((k, i) => {
    const l = latest(k, geo, "TOTAL");
    const snap = snapshot(k, l.year, "TOTAL").sort((a, b) => a.v - b.v);
    const n = snap.length;
    const pos = d => n > 1 ? snap.indexOf(d) / (n - 1) : .5;
    const y = m.t + i * rowH + rowH / 2;
    const g = svg.append("g").attr("class", "fp-row").on("click", () => { S.trend = k; render(); });
    g.append("rect").attr("class", "fp-bg").attr("x", 0).attr("y", y - rowH / 2).attr("width", width).attr("height", rowH).attr("fill", "transparent").attr("rx", 6);
    g.append("text").attr("class", "label").attr("x", m.l - 14).attr("y", y).attr("dominant-baseline", "middle").attr("text-anchor", "end").text(METRIC[k].label);
    g.append("line").attr("x1", x(0)).attr("x2", x(1)).attr("y1", y).attr("y2", y).attr("stroke", cssVar("--line-2"));
    g.selectAll("circle.o").data(snap.filter(d => d.geo !== geo)).join("circle").attr("class", "o")
      .attr("cy", y).attr("r", 4).attr("fill", cssVar("--context-hi")).attr("opacity", .75)
      .attr("cx", x(.5)).transition().duration(900).delay(i * 50).ease(d3.easeCubicOut).attr("cx", d => x(pos(d)));
    g.selectAll("circle.o").on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(METRIC[k].label, fmt(k, d.v))}`)).on("mouseleave", hideTip);
    const me = snap.find(d => d.geo === geo);
    if (me) {
      g.append("circle").attr("cy", y).attr("r", 8).attr("fill", cssVar("--s1")).attr("stroke", cssVar("--surface")).attr("stroke-width", 2.5)
        .attr("cx", x(.5)).transition().duration(1000).delay(i * 50 + 150).ease(d3.easeBackOut).attr("cx", x(pos(me)));
      g.append("text").attr("class", "label-strong").attr("x", width - m.r + 10).attr("y", y).attr("dominant-baseline", "middle").text(fmt(k, me.v));
    }
  });
}

// ---------------------------------------------------------------------------
// View: Compare (small multiples)
// ---------------------------------------------------------------------------
function renderCompare(root) {
  const colors = ["--s1", "--s2", "--s3", "--s4"].map(cssVar);
  S.compare = S.compare.filter(g => D.name.has(g)).slice(0, 4);
  root.append(hero("Compare", "Side by <em>side</em>.", "Up to four countries across every indicator. Colours follow the country, not its rank."));

  const chips = h("div", { class: "chips" }, S.compare.map((g, i) => h("button", { class: "chip on", title: "Remove",
    onclick: () => { S.compare = S.compare.filter(c => c !== g); writeHash(); render(); } },
    h("span", { class: "swatch", style: `background:${colors[i]}` }), D.name.get(g), " ×")));
  const add = select("Add country", [{ value: "", label: "Choose…" }, ...countryOptions(true).filter(o => !S.compare.includes(o.value))], "",
    v => { if (v && S.compare.length < 4) { S.compare.push(v); writeHash(); render(); } });
  const mode = h("div", { class: "control" }, h("label", {}, "Show as"), h("div", { class: "chips" },
    h("button", { class: `chip ${!S.index ? "on" : ""}`, onclick: () => { S.index = false; render(); } }, "Levels"),
    h("button", { class: `chip ${S.index ? "on" : ""}`, onclick: () => { S.index = true; render(); } }, `Index ${S.base} = 100`)));
  root.append(h("div", { class: "controls" }, chips, add, mode));

  const grid = h("div", { class: "grid g-3" });
  root.append(grid);
  for (const M of METRICS) {
    const list = S.compare.map((g, i) => {
      let data = series(M.key, g, "TOTAL");
      if (S.index) {
        const b = data.find(d => d.year === S.base);
        data = b ? data.map(d => ({ year: d.year, v: 100 * d.v / b.v })) : [];
      }
      return { key: g, label: D.name.get(g) || "EU27", color: colors[i], width: 2.2, data };
    }).filter(s => s.data.length);
    if (!list.length) continue;
    const c = card({ title: M.label, sub: S.index ? `Index, ${S.base} = 100` : M.unit,
      csv: () => list.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, value: d.v }))) });
    grid.append(c.el);
    lineChart(c.body, list, { height: 220, labelEnds: false, indexLine: S.index,
      yFormat: S.index ? d3.format(".0f") : v => fmt(M.key, v) });
  }
}

// ---------------------------------------------------------------------------
// View: True cost of an hour (calculator)
// ---------------------------------------------------------------------------
function hourData(geo) {
  const manuf = S.hourNace === "C";
  const lc = latest(manuf ? "lc_hour_c" : "lc_hour", geo);
  const nonwage = latest(manuf ? "nonwage_share_c" : "nonwage_share", geo);
  const wedge = latest("tax_wedge", geo);
  const vah = latest("va_hour_nom", geo, S.hourNace);
  const hrs = latest("hours_worker", geo, S.hourNace);
  const fallback = !lc ? latest("comp_ph", geo, S.hourNace) : null;
  return { lc: lc || fallback, lcSource: lc ? "Labour cost survey" : fallback ? "National accounts (compensation per employee hour)" : null,
           nonwage, wedge, vah, hrs };
}

function computeHour(d) {
  if (!d.lc) return null;
  const cost0 = d.lc.v * (1 + S.wageChange / 100);
  const nw = d.nonwage ? d.nonwage.v : .2;
  const wedge = d.wedge ? Math.max(d.wedge.v, nw) : nw + .15;
  const employer = cost0 * nw;
  const employeeTax = cost0 * Math.max(0, wedge - nw);
  const net = cost0 - employer - employeeTax;
  const hours = d.hrs ? d.hrs.v : 1700;
  const lostHours = S.sick * 8;
  const absence = cost0 * (S.paidShare / 100) * lostHours / Math.max(1, hours - lostHours);
  const total = cost0 + absence;
  const va = d.vah ? d.vah.v : null;
  return { net, employeeTax, employer, absence, total, va, per100: va ? 100 * total / va : null, hours, assumed: { nonwage: !d.nonwage, wedge: !d.wedge } };
}

function renderHour(root) {
  if (S.other === S.focus) S.other = S.focus === "DE" ? "PL" : "DE";
  root.append(hero("The true cost of an hour",
    `What an employer <em>really</em> pays for one hour of work.`,
    "From take-home pay to the full cost per hour actually worked, set against what that hour produces. Move the sliders to test scenarios."));

  const controls = h("div", { class: "controls" },
    select("Country", countryOptions(), S.focus, v => { S.focus = v; writeHash(); render(); }),
    select("Compare with", countryOptions(), S.other, v => { S.other = v; writeHash(); render(); }),
    select("Sector", [{ value: "C", label: "Manufacturing" }, { value: "TOTAL", label: "Whole economy" }], S.hourNace, v => { S.hourNace = v; render(); }));
  root.append(controls);

  const grid = h("div", { class: "grid g-2" });
  const chartCard = card({ title: "Anatomy of an hour", sub: "EUR per hour actually worked, latest year available",
    csv: () => [S.focus, S.other].map(g => ({ country: D.name.get(g), ...computeHour(hourData(g)) })) });
  const side = h("section", { class: "card" });
  grid.append(chartCard.el, side);
  root.append(grid);

  const sliders = h("div", { class: "calc-controls" });
  const mk = (label, key, min, max, step, unit) => {
    const out = h("b", {}, `${S[key]}${unit}`);
    const inp = h("input", { type: "range", class: "range", min, max, step, value: S[key] });
    inp.addEventListener("input", () => { S[key] = +inp.value; out.textContent = `${S[key]}${unit}`; update(); });
    return h("div", { class: "slider-row" }, h("label", {}, label, out), inp);
  };
  side.append(h("h3", { class: "card-title" }, "Scenario"),
    h("p", { class: "card-sub" }, "Applied to both countries."),
    h("div", { style: "height:12px" }),
    sliders);
  sliders.append(
    mk("Extra sick days per year, employer-paid", "sick", 0, 30, 1, " days"),
    mk("Share of sick pay borne by the employer", "paidShare", 0, 100, 5, "%"),
    mk("Wage change", "wageChange", -30, 50, 1, "%"));
  const verdict = h("div", { style: "margin-top:22px" });
  side.append(verdict);

  const chartHost = h("div");
  chartCard.body.append(chartHost);
  const vaCard = card({ title: "Labour cost per €100 of value added", sub: "Hourly labour cost divided by nominal value added per hour worked" });
  root.append(h("div", { style: "margin-top:18px" }, vaCard.el));
  const notes = h("p", { class: "note" });
  root.append(notes);

  const width = widthOf(chartHost), height = 250, m = { l: 120, r: 80, t: 30, b: 30 };
  const svg = svgEl(chartHost, width, height);
  const parts = [
    { key: "net", label: "Take-home pay", color: cssVar("--s1") },
    { key: "employeeTax", label: "Income tax and employee contributions", color: cssVar("--s3") },
    { key: "employer", label: "Employer contributions and other costs", color: cssVar("--s4") },
    { key: "absence", label: "Scenario: paid sick leave", color: cssVar("--s2") },
  ];
  const legend = h("div", { class: "chips", style: "margin-top:8px" }, parts.map(p => h("span", { class: "chip", style: "cursor:default" },
    h("span", { class: "swatch", style: `background:${p.color}` }), p.label)));
  chartCard.body.append(legend);
  const vaWidth = widthOf(vaCard.body), vaH = 150;
  const vaSvg = svgEl(vaCard.body, vaWidth, vaH);

  function update() {
    const rows = [S.focus, S.other].map(g => ({ geo: g, name: D.name.get(g), d: hourData(g) }))
      .map(r => ({ ...r, c: computeHour(r.d) })).filter(r => r.c);
    const max = d3.max(rows, r => r.c.total) || 1;
    const x = d3.scaleLinear([0, max * 1.05], [m.l, width - m.r]);
    const y = d3.scaleBand(rows.map(r => r.geo), [m.t, height - m.b]).padding(.35);
    const t = svg.transition().duration(500).ease(d3.easeCubicOut);
    svg.selectAll("g.axis").remove();
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(v => "€" + v).tickSizeOuter(0));
    const stacks = rows.flatMap(r => {
      let acc = 0;
      return parts.map(p => { const v = r.c[p.key]; const s = { geo: r.geo, name: r.name, key: p.key, label: p.label, color: p.color, x0: acc, v }; acc += v; return s; });
    });
    svg.selectAll("rect.seg").data(stacks, d => d.geo + d.key).join(
      e => e.append("rect").attr("class", "seg").attr("x", x(0)).attr("width", 0).attr("rx", 3))
      .attr("y", d => y(d.geo)).attr("height", y.bandwidth()).attr("fill", d => d.color)
      .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(d.label, "€" + d.v.toFixed(2))}`))
      .on("mouseleave", hideTip)
      .transition(t).attr("x", d => x(d.x0) + 1).attr("width", d => Math.max(0, x(d.x0 + d.v) - x(d.x0) - 2));
    svg.selectAll("text.cname").data(rows, d => d.geo).join("text").attr("class", "cname label-strong")
      .attr("x", m.l - 10).attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .attr("y", r => y(r.geo) + y.bandwidth() / 2).text(r => r.name);
    svg.selectAll("text.tot").data(rows, d => d.geo).join("text").attr("class", "tot label-strong")
      .attr("dominant-baseline", "middle").attr("y", r => y(r.geo) + y.bandwidth() / 2)
      .transition(t).attr("x", r => x(r.c.total) + 8).text(r => "€" + r.c.total.toFixed(2));

    // per €100 output
    const vr = rows.filter(r => r.c.per100 != null);
    const vx = d3.scaleLinear([0, Math.max(100, d3.max(vr, r => r.c.per100) || 100) * 1.05], [m.l, vaWidth - m.r]);
    const vy = d3.scaleBand(vr.map(r => r.geo), [10, vaH - 28]).padding(.35);
    const vt = vaSvg.transition().duration(500);
    vaSvg.selectAll("g.axis").remove();
    vaSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${vaH - 28})`).call(d3.axisBottom(vx).ticks(6).tickFormat(v => "€" + v).tickSizeOuter(0));
    vaSvg.selectAll("rect.vb").data(vr, d => d.geo).join(e => e.append("rect").attr("class", "vb").attr("x", vx(0)).attr("width", 0).attr("rx", 4))
      .attr("y", r => vy(r.geo)).attr("height", vy.bandwidth()).attr("fill", (r, i) => i === 0 ? cssVar("--s1") : cssVar("--context-hi"))
      .transition(vt).attr("width", r => vx(r.c.per100) - vx(0));
    vaSvg.selectAll("text.vn").data(vr, d => d.geo).join("text").attr("class", "vn label-strong").attr("x", m.l - 10).attr("text-anchor", "end")
      .attr("dominant-baseline", "middle").attr("y", r => vy(r.geo) + vy.bandwidth() / 2).text(r => r.name);
    vaSvg.selectAll("text.vv").data(vr, d => d.geo).join("text").attr("class", "vv label-strong").attr("dominant-baseline", "middle")
      .attr("y", r => vy(r.geo) + vy.bandwidth() / 2).transition(vt).attr("x", r => vx(r.c.per100) + 8).text(r => "€" + r.c.per100.toFixed(0));

    // verdict
    verdict.innerHTML = "";
    const [a, b] = rows;
    if (a) verdict.append(h("div", { class: "big-number" }, "€" + a.c.total.toFixed(2)),
      h("p", { class: "card-sub" }, `per hour actually worked in ${a.name}`));
    if (a && b) {
      const costRatio = b.c.total / a.c.total;
      const prodRatio = a.c.va && b.c.va ? b.c.va / a.c.va : null;
      verdict.append(h("p", { class: "verdict", html:
        `An hour in <b>${a.name}</b> costs ${costRatio >= 1 ? `<b>${costRatio.toFixed(1)}× less</b>` : `<b>${(1 / costRatio).toFixed(1)}× more</b>`} than in ${b.name}` +
        (prodRatio ? `, and produces ${prodRatio >= 1 ? `<b>${prodRatio.toFixed(1)}× less</b>` : `<b>${(1 / prodRatio).toFixed(1)}× more</b>`} value.` : ".") +
        (a.c.per100 && b.c.per100 ? ` For every €100 of output, labour costs <b>€${a.c.per100.toFixed(0)}</b> in ${a.name} versus <b>€${b.c.per100.toFixed(0)}</b> in ${b.name}.` : "") }));
    }
    const warn = rows.flatMap(r => [
      r.d.lcSource && r.d.lcSource !== "Labour cost survey" ? `${r.name}: hourly cost from ${r.d.lcSource}` : null,
      r.c.assumed.nonwage ? `${r.name}: non-wage share not available, 20% assumed` : null,
      r.c.assumed.wedge ? `${r.name}: tax wedge not available, estimated` : null,
    ]).filter(Boolean);
    notes.innerHTML = `Method: hourly labour cost (Eurostat lc_lci_lev) is split using the non-wage share and the tax wedge for a single low-wage earner, so the split is indicative. ` +
      `The sick-leave scenario spreads employer-paid absence over the remaining hours worked per year (national accounts). Value added per hour is nominal GVA divided by hours worked. ` +
      (warn.length ? `<br>Caveats: ${warn.join("; ")}.` : "");
  }
  update();
}

// ---------------------------------------------------------------------------
// View: Sectors (ULC decomposition + heatmap)
// ---------------------------------------------------------------------------
function renderSectors(root) {
  const ys = yearsWithData("ulc", "C").years;
  const endDefault = yearsWithData("prod", "C").latest;
  S.end = S.end && ys.includes(S.end) ? S.end : endDefault;
  root.append(hero("Sectors", `Is it <em>pay</em> or <em>productivity</em>?`,
    "Unit labour costs rise when pay grows faster than output per worker. The decomposition shows which force dominates in each sector."));

  const yearOpts = ys.map(y => ({ value: String(y), label: String(y) }));
  root.append(h("div", { class: "controls" },
    select("Country", countryOptions(true), S.focus, v => { S.focus = v; writeHash(); render(); }),
    select("Breakdown", [{ value: "a10", label: "Economy sections" }, { value: "manuf14", label: "Manufacturing branches" }, { value: "manuf3", label: "Automotive / electronics / rest" }],
      S.tier, v => { S.tier = v; render(); }),
    select("From", yearOpts, String(S.base), v => { S.base = +v; render(); }),
    select("To", yearOpts, String(S.end), v => { S.end = +v; render(); })));

  const tierSecs = D.sectors.filter(s => s.tier === S.tier);
  const rows = tierSecs.map(s => {
    const a = D.sec.get(`${S.focus}|${s.nace}|${S.base}`), b = D.sec.get(`${S.focus}|${s.nace}|${S.end}`);
    if (!a?.comp_pe || !b?.comp_pe || !a?.prod || !b?.prod) return null;
    const comp = 100 * Math.log(b.comp_pe / a.comp_pe), prod = -100 * Math.log(b.prod / a.prod);
    return { nace: s.nace, label: s.label, comp, prod, net: comp + prod };
  }).filter(Boolean).sort((a, b) => b.net - a.net);

  const grid = h("div", { class: "grid g-2e" });
  const c1 = card({ title: `What drove unit labour costs in ${D.name.get(S.focus) || "EU27"}`, sub: `Log points, ${S.base} to ${S.end}. Bars: pay effect and productivity effect. Dot: net change.`,
    csv: () => rows.map(r => ({ sector: r.label, pay_effect: r.comp, productivity_effect: r.prod, net: r.net })) });
  const c2 = card({ title: "Productivity growth by sector and country", sub: `Real productivity per worker, % change ${S.base} to ${S.end}`,
    csv: () => heat.map(d => ({ country: d.name, sector: d.label, change: d.v })) });
  grid.append(c1.el, c2.el);
  root.append(grid);

  // Decomposition chart
  if (!rows.length) c1.body.append(h("p", { class: "empty" }, "No data for this selection."));
  else {
    const width = widthOf(c1.body), rowH = 30, m = { l: 210, r: 30, t: 10, b: 34 };
    const height = rows.length * rowH + m.t + m.b;
    const svg = svgEl(c1.body, width, height);
    const ext = d3.extent(rows.flatMap(r => [r.comp, r.prod, r.net, 0]));
    const x = d3.scaleLinear(ext, [m.l, width - m.r]).nice();
    const y = d3.scaleBand(rows.map(r => r.nace), [m.t, height - m.b]).padding(.25);
    svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", m.t).attr("y2", height - m.b);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
    const segs = rows.flatMap(r => [{ r, k: "Pay effect", v: r.comp, c: cssVar("--s1") }, { r, k: "Productivity effect", v: r.prod, c: cssVar("--s2") }]);
    const bh = (y.bandwidth() - 4) / 2;
    svg.selectAll("rect").data(segs).join("rect").attr("y", d => y(d.r.nace) + 1 + (d.k === "Pay effect" ? 0 : bh + 2)).attr("height", bh).attr("rx", 3)
      .attr("fill", d => d.c).attr("x", x(0)).attr("width", 0)
      .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.r.label}</div>${ttRow("Pay effect", d.r.comp.toFixed(1))}${ttRow("Productivity effect", d.r.prod.toFixed(1))}${ttRow("Net ULC change", d.r.net.toFixed(1))}`))
      .on("mouseleave", hideTip)
      .transition().duration(900).delay((d, i) => i * 25).ease(d3.easeCubicOut)
      .attr("x", d => Math.min(x(0), x(d.v))).attr("width", d => Math.abs(x(d.v) - x(0)));
    svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", height - m.b).attr("stroke", cssVar("--text-2"));
    svg.selectAll("circle").data(rows).join("circle").attr("cy", r => y(r.nace) + y.bandwidth() / 2).attr("r", 5.5)
      .attr("fill", cssVar("--text")).attr("stroke", cssVar("--surface")).attr("stroke-width", 2).attr("cx", x(0))
      .transition().delay(500).duration(800).attr("cx", r => x(r.net));
    svg.selectAll("text.sl").data(rows).join("text").attr("class", "sl label").attr("x", m.l - 10).attr("text-anchor", "end")
      .attr("dominant-baseline", "middle").attr("y", r => y(r.nace) + y.bandwidth() / 2).text(r => r.label);
    c1.body.append(h("div", { class: "chips", style: "margin-top:8px" },
      h("span", { class: "chip", style: "cursor:default" }, h("span", { class: "swatch", style: `background:${cssVar("--s1")}` }), "Pay effect (raises ULC)"),
      h("span", { class: "chip", style: "cursor:default" }, h("span", { class: "swatch", style: `background:${cssVar("--s2")}` }), "Productivity effect (negative = productivity rose)"),
      h("span", { class: "chip", style: "cursor:default" }, h("span", { class: "swatch", style: `background:${cssVar("--text")}` }), "Net change")));
  }

  // Heatmap: diverging, neutral midpoint at zero
  const geos = [...D.countries.map(c => c.geo), EU];
  const heat = [];
  for (const s of tierSecs) for (const g of geos) {
    const a = val("prod", g, S.base, s.nace), b = val("prod", g, S.end, s.nace);
    if (a > 0 && b > 0) heat.push({ geo: g, name: D.name.get(g) || "EU27", nace: s.nace, label: s.label, v: b / a - 1 });
  }
  const hg = [...new Set(heat.map(d => d.geo))].sort((a, b) => (a === EU) - (b === EU) || (a === S.focus ? -1 : b === S.focus ? 1 : a.localeCompare(b)));
  if (!heat.length) c2.body.append(h("p", { class: "empty" }, "No data for this selection."));
  else {
    const width = widthOf(c2.body), m = { l: 200, r: 10, t: 40, b: 10 };
    const cw = (width - m.l - m.r) / hg.length, chh = 24;
    const height = m.t + tierSecs.length * chh + m.b;
    const svg = svgEl(c2.body, width, height);
    const lim = d3.quantile(heat.map(d => Math.abs(d.v)).sort(d3.ascending), .95) || 1;
    const dark = document.documentElement.dataset.theme === "dark";
    const col = d3.scaleDiverging([-lim, 0, lim], d3.interpolateRgbBasis(
      dark ? ["#d95926", "#5a3524", "#2a2d33", "#1e3f66", "#3987e5"] : ["#eb6834", "#f5c1a8", "#f1f0ec", "#9ec5f4", "#2a78d6"])).clamp(true);
    const x = d3.scaleBand(hg, [m.l, width - m.r]).padding(.06);
    const y = d3.scaleBand(tierSecs.map(s => s.nace), [m.t, height - m.b]).padding(.08);
    svg.selectAll("text.cx").data(hg).join("text").attr("class", d => d === S.focus ? "label-strong" : "annot")
      .attr("transform", d => `translate(${x(d) + x.bandwidth() / 2},${m.t - 6}) rotate(-60)`).text(d => d === EU ? "EU27" : d);
    svg.selectAll("text.ry").data(tierSecs).join("text").attr("class", "label").attr("x", m.l - 8).attr("text-anchor", "end")
      .attr("dominant-baseline", "middle").attr("y", s => y(s.nace) + y.bandwidth() / 2).text(s => s.label);
    svg.selectAll("rect").data(heat).join("rect").attr("x", d => x(d.geo)).attr("y", d => y(d.nace))
      .attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 2).attr("fill", d => col(d.v))
      .attr("stroke", d => d.geo === S.focus ? cssVar("--text") : "none").attr("stroke-width", 1.5)
      .attr("opacity", 0).transition().duration(600).delay((d, i) => (i % hg.length) * 12).attr("opacity", 1);
    svg.selectAll("rect").on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(d.label, pct(d.v))}`)).on("mouseleave", hideTip);
    c2.body.append(h("p", { class: "note" }, "Blue: productivity rose. Orange: productivity fell. Grey: little change. Chain-linked volumes; rest of manufacturing is approximate."));
  }
}

// ---------------------------------------------------------------------------
// View: FDI industries (structural business statistics)
// ---------------------------------------------------------------------------
function renderIndustries(root) {
  const inds = [...new Set(D.industry.map(d => d.nace))];
  if (!inds.length) { root.append(h("p", { class: "empty" }, "Industry data not available in this build.")); return; }
  if (!inds.includes(S.industry)) S.industry = inds[0];
  const rowsAll = D.industry.filter(d => d.nace === S.industry);
  const years = [...new Set(rowsAll.map(d => d.year))].sort();
  const counts = years.map(y => rowsAll.filter(d => d.year === y && d.va_worker != null).length);
  const yrDefault = years[counts.lastIndexOf(d3.max(counts))] ?? d3.max(years);
  const yr = S.indYear && years.includes(S.indYear) ? S.indYear : yrDefault;
  const rows = rowsAll.filter(d => d.year === yr && d.va_worker != null && D.name.has(d.geo));
  const indName = rowsAll[0]?.industry || S.industry;

  root.append(hero("FDI-intensive industries", `Where <em>${indName.toLowerCase()}</em> pays off.`,
    "Value added per worker and the wage share of value added in the industries that attract most foreign investment: wiring harnesses and other automotive parts, apparel, footwear and electrical equipment."));
  root.append(h("div", { class: "controls" },
    h("div", { class: "chips" }, inds.map(n => h("button", { class: `chip ${n === S.industry ? "on" : ""}`, onclick: () => { S.industry = n; writeHash(); render(); } },
      D.industry.find(d => d.nace === n)?.industry || n))),
    select("Year", years.map(y => ({ value: String(y), label: String(y) })), String(yr), v => { S.indYear = +v; render(); }),
    select("Highlight", countryOptions(), S.focus, v => { S.focus = v; writeHash(); render(); })));

  const grid = h("div", { class: "grid g-2e" });
  const c1 = card({ title: "Productivity vs wage share", sub: `${yr}. Bubble size: persons employed. Top-right: high productivity but labour takes a big share.`,
    csv: () => rows.map(d => ({ country: D.name.get(d.geo), year: yr, va_per_worker: d.va_worker, wage_share: d.wage_share, employed: d.emp })) });
  const c2 = card({ title: "Value added per worker", sub: `EUR per person employed, ${yr}` });
  grid.append(c1.el, c2.el);
  root.append(grid);

  // Bubble chart
  const pts = rows.filter(d => d.wage_share != null && d.wage_share < 2);
  const width = widthOf(c1.body), height = 440, m = { l: 60, r: 24, t: 16, b: 44 };
  const svg = svgEl(c1.body, width, height);
  const x = d3.scaleLog(d3.extent(pts, d => d.va_worker), [m.l, width - m.r]).nice();
  const y = d3.scaleLinear([0, d3.max(pts, d => d.wage_share) * 1.08], [height - m.b, m.t]).nice();
  const r = d3.scaleSqrt([0, d3.max(pts, d => d.emp || 0)], [3, 30]);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "grid-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y).attr("y2", y);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(v => { const t = x.tickFormat(5, "~s")(v); return t ? "€" + t : ""; }));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")).tickSize(0)).call(g => g.select(".domain").remove());
  svg.append("text").attr("class", "annot").attr("x", width - m.r).attr("y", height - 8).attr("text-anchor", "end").text("Value added per worker (log scale) →");
  svg.append("text").attr("class", "annot").attr("x", m.l).attr("y", 10).text("↑ Wages as share of value added");
  const sorted = [...pts].sort((a, b) => (b.emp || 0) - (a.emp || 0));
  svg.selectAll("circle").data(sorted).join("circle").attr("cx", d => x(d.va_worker)).attr("cy", d => y(d.wage_share))
    .attr("fill", d => d.geo === S.focus ? cssVar("--s1") : cssVar("--context-hi")).attr("fill-opacity", d => d.geo === S.focus ? .95 : .55)
    .attr("stroke", cssVar("--surface")).attr("stroke-width", 2).attr("r", 0)
    .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${D.name.get(d.geo)}</div>${ttRow("VA per worker", "€" + d3.format(",.0f")(d.va_worker))}${ttRow("Wage share", d3.format(".1%")(d.wage_share))}${ttRow("Employed", d3.format(",.0f")(d.emp || 0))}`))
    .on("mouseleave", hideTip)
    .transition().duration(900).delay((d, i) => i * 15).ease(d3.easeBackOut).attr("r", d => r(d.emp || 0));
  svg.selectAll("text.bl").data(pts).join("text").attr("class", d => d.geo === S.focus ? "bl label-strong" : "bl annot")
    .attr("x", d => x(d.va_worker)).attr("y", d => y(d.wage_share) - r(d.emp || 0) - 4).attr("text-anchor", "middle").text(d => d.geo === EU ? "EU27" : d.geo);

  // Ranking bars
  const sortedVa = [...rows].sort((a, b) => b.va_worker - a.va_worker);
  const w2 = widthOf(c2.body), rowH = 18, h2 = sortedVa.length * rowH + 20;
  const svg2 = svgEl(c2.body, w2, h2);
  const x2 = d3.scaleLinear([0, d3.max(sortedVa, d => d.va_worker)], [140, w2 - 70]);
  sortedVa.forEach((d, i) => {
    const yy = i * rowH + 4;
    svg2.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", 132).attr("y", yy + rowH / 2 - 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(D.name.get(d.geo));
    svg2.append("rect").attr("x", 140).attr("y", yy).attr("height", rowH - 6).attr("rx", 3).attr("fill", d.geo === S.focus ? cssVar("--s1") : cssVar("--context"))
      .attr("width", 0).transition().duration(800).delay(i * 20).attr("width", x2(d.va_worker) - 140);
    svg2.append("text").attr("class", "label").attr("x", x2(d.va_worker) + 6).attr("y", yy + rowH / 2 - 2).attr("dominant-baseline", "middle").text("€" + d3.format(",.0f")(d.va_worker));
  });
  root.append(h("p", { class: "note" }, `Source: Eurostat structural business statistics. Latest year with the widest coverage: ${yr}. Automotive parts is NACE 29.3; where it is suppressed, use motor vehicles (29) as the fallback.`));
}

// ---------------------------------------------------------------------------
// View: Convergence
// ---------------------------------------------------------------------------
function renderConvergence(root) {
  const metric = ["prod", "prod_hour", "comp_pe", "comp_ph"].includes(S.metric) ? S.metric : "prod";
  const cov = yearsWithData(metric, S.nace);
  const end = S.end && cov.years.includes(S.end) ? S.end : cov.latest;
  const base = cov.years.includes(S.base) ? S.base : cov.years[0];
  const regions = [...new Set(D.countries.map(c => c.region))];
  S.regions = S.regions || regions.filter(r => !["Aggregate"].includes(r));

  root.append(hero("Convergence", `Are the laggards <em>catching up</em>?`,
    "β-convergence asks whether countries that started further behind grew faster; a downward-sloping line says yes. σ-convergence asks whether the gap between countries is narrowing. One does not imply the other."));
  const yo = cov.years.map(y => ({ value: String(y), label: String(y) }));
  root.append(h("div", { class: "controls" },
    select("Indicator", ["prod", "prod_hour", "comp_pe", "comp_ph"].map(k => ({ value: k, label: METRIC[k].label })), metric, v => { S.metric = v; writeHash(); render(); }),
    select("Sector", sectorOptions(), S.nace, v => { S.nace = v; writeHash(); render(); }),
    select("Base year", yo, String(base), v => { S.base = +v; render(); }),
    select("End year", yo, String(end), v => { S.end = +v; render(); })));
  root.append(h("div", { class: "controls" }, h("div", { class: "chips" }, regions.map(r => h("button", { class: `chip ${S.regions.includes(r) ? "on" : ""}`,
    onclick: () => { S.regions = S.regions.includes(r) ? S.regions.filter(x => x !== r) : [...S.regions, r]; render(); } }, r)))));

  const inSet = g => S.regions.includes(D.region.get(g));
  const euBase = val(metric, EU, base);
  const pts = D.countries.filter(c => inSet(c.geo)).map(c => {
    const a = val(metric, c.geo, base), b = val(metric, c.geo, end);
    if (!(a > 0 && b > 0) || end <= base) return null;
    const emp = val("emp", c.geo, end) || D.sec.get(`${c.geo}|${S.nace}|${end}`)?.emp || 1;
    return { geo: c.geo, name: c.name, level: euBase ? 100 * a / euBase : a, g: 100 * (Math.pow(b / a, 1 / (end - base)) - 1), emp };
  }).filter(Boolean);

  const grid = h("div", { class: "grid g-2e" });
  const c1 = card({ title: "β-convergence", sub: `Starting level (${euBase ? "% of EU27" : "level"}, ${base}) vs average annual growth ${base} to ${end}. Bubble size: employment.`,
    csv: () => pts.map(p => ({ country: p.name, start_level: p.level, annual_growth_pct: p.g, employment: p.emp })) });
  const c2 = card({ title: "σ-convergence", sub: "Standard deviation of log levels across the selected countries (balanced panel)" });
  grid.append(c1.el, c2.el);
  root.append(grid);

  if (pts.length < 3) c1.body.append(h("p", { class: "empty" }, "Not enough countries for this selection."));
  else {
    const width = widthOf(c1.body), height = 440, m = { l: 50, r: 20, t: 20, b: 40 };
    const svg = svgEl(c1.body, width, height);
    const x = d3.scaleLinear(d3.extent(pts, p => p.level), [m.l, width - m.r]).nice();
    const y = d3.scaleLinear(d3.extent([...pts.map(p => p.g), 0]), [height - m.b, m.t]).nice();
    const r = d3.scaleSqrt([0, d3.max(pts, p => p.emp)], [4, 26]);
    svg.append("g").selectAll("line").data(y.ticks(6)).join("line").attr("class", "grid-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y).attr("y2", y);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v => v + "%").tickSize(0)).call(g => g.select(".domain").remove());
    svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", cssVar("--text-3"));
    // OLS
    const mx = d3.mean(pts, p => p.level), my = d3.mean(pts, p => p.g);
    const slope = d3.sum(pts, p => (p.level - mx) * (p.g - my)) / d3.sum(pts, p => (p.level - mx) ** 2);
    const icpt = my - slope * mx;
    const [x0, x1] = x.domain();
    const reg = svg.append("line").attr("x1", x(x0)).attr("y1", y(icpt + slope * x0)).attr("x2", x(x0)).attr("y2", y(icpt + slope * x0))
      .attr("stroke", cssVar("--s2")).attr("stroke-width", 2).attr("stroke-dasharray", "6 5");
    reg.transition().delay(700).duration(900).attr("x2", x(x1)).attr("y2", y(icpt + slope * x1));
    svg.append("text").attr("class", "label-strong").attr("x", width - m.r).attr("y", m.t + 4).attr("text-anchor", "end").attr("fill", cssVar("--s2"))
      .text(slope < 0 ? "Laggards grew faster: β-convergence" : "No β-convergence in this sample");
    svg.selectAll("circle").data([...pts].sort((a, b) => b.emp - a.emp)).join("circle").attr("cx", p => x(p.level)).attr("cy", p => y(p.g))
      .attr("fill", p => p.geo === S.focus ? cssVar("--s1") : cssVar("--context-hi")).attr("fill-opacity", p => p.geo === S.focus ? 1 : .6)
      .attr("stroke", cssVar("--surface")).attr("stroke-width", 2).attr("r", 0)
      .on("mousemove", (ev, p) => showTip(ev, `<div class="tt-title">${p.name}</div>${ttRow("Start level", p.level.toFixed(0) + (euBase ? "% of EU27" : ""))}${ttRow("Growth", p.g.toFixed(2) + "% a year")}`))
      .on("mouseleave", hideTip)
      .transition().duration(800).delay((p, i) => i * 18).ease(d3.easeBackOut).attr("r", p => r(p.emp));
    svg.selectAll("text.pl").data(pts).join("text").attr("class", p => p.geo === S.focus ? "label-strong" : "annot")
      .attr("x", p => x(p.level)).attr("y", p => y(p.g) - r(p.emp) - 4).attr("text-anchor", "middle").text(p => p.geo);
    svg.append("text").attr("class", "annot").attr("x", width - m.r).attr("y", height - 6).attr("text-anchor", "end").text(`Starting level, ${base} →`);
  }

  // sigma
  const geos = D.countries.filter(c => inSet(c.geo)).map(c => c.geo);
  const yrs = cov.years.filter(y => y >= base && y <= end);
  const bal = geos.filter(g => yrs.every(y => val(metric, g, y) > 0));
  const sd = yrs.map(y => ({ year: y, v: d3.deviation(bal.map(g => Math.log(val(metric, g, y)))) })).filter(d => d.v != null);
  lineChart(c2.body, [{ key: "sd", label: "Dispersion", color: cssVar("--s1"), width: 2.5, data: sd }], { height: 400, yFormat: d3.format(".3f"), labelEnds: false });
  c2.body.append(h("p", { class: "note" }, `${bal.length} countries observed in every year. Falling line: countries are becoming more alike.`));
}

// ---------------------------------------------------------------------------
// View: Data, coverage and methods
// ---------------------------------------------------------------------------
function renderData(root) {
  root.append(hero("Data and methods", "Every number, <em>traceable</em>.",
    `Rebuilt automatically from public sources. Last build: ${D.meta.built ? new Date(D.meta.built).toUTCString() : "unknown"}.`));

  const grid = h("div", { class: "grid" });
  const c1 = card({ title: "Coverage", sub: "Latest year with data, by country and indicator (whole economy). Darker: more recent.", png: true,
    csv: () => cov.map(d => ({ country: d.name, indicator: d.label, latest_year: d.y })) });
  const c2 = card({ title: "Source status", sub: "Result of the last automated build", png: false });
  grid.append(c1.el, c2.el);
  root.append(grid);

  const cov = [];
  for (const c of D.countries) for (const M of METRICS) {
    const l = latest(M.key, c.geo, "TOTAL");
    if (l) cov.push({ geo: c.geo, name: c.name, key: M.key, label: M.label, y: l.year });
  }
  const width = widthOf(c1.body), m = { l: 210, t: 50, r: 6 };
  const cw = (width - m.l - m.r) / D.countries.length, chh = 20;
  const height = m.t + METRICS.length * chh + 10;
  const svg = svgEl(c1.body, width, height);
  const x = d3.scaleBand(D.countries.map(c => c.geo), [m.l, width - m.r]).padding(.08);
  const y = d3.scaleBand(METRICS.map(M => M.key), [m.t, height - 10]).padding(.1);
  const maxY = d3.max(cov, d => d.y);
  const col = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp())).domain([maxY - 12, maxY]).clamp(true);
  svg.selectAll("text.cx").data(D.countries).join("text").attr("class", "annot")
    .attr("transform", c => `translate(${x(c.geo) + x.bandwidth() / 2},${m.t - 6}) rotate(-60)`).text(c => c.geo);
  svg.selectAll("text.ry").data(METRICS).join("text").attr("class", "label").attr("x", m.l - 8).attr("text-anchor", "end")
    .attr("dominant-baseline", "middle").attr("y", M => y(M.key) + y.bandwidth() / 2).text(M => M.label);
  svg.selectAll("rect").data(cov).join("rect").attr("x", d => x(d.geo)).attr("y", d => y(d.key)).attr("width", x.bandwidth()).attr("height", y.bandwidth())
    .attr("rx", 2).attr("fill", d => col(d.y))
    .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(d.label, "latest " + d.y)}`)).on("mouseleave", hideTip);

  const tbl = h("table", { class: "data" }, h("thead", {}, h("tr", {}, h("th", {}, "Source"), h("th", {}, "Status"), h("th", {}, "Rows"))),
    h("tbody", {}, Object.entries(D.meta.sources || {}).map(([k, v]) => h("tr", {},
      h("td", {}, h("code", {}, k)), h("td", { class: v.ok ? "status-ok" : "status-fail" }, v.ok ? "OK" : "Failed"), h("td", {}, d3.format(",")(v.rows || 0))))));
  c2.body.append(h("div", { class: "scroll" }, tbl),
    h("p", { class: "note", html: `Download the full tables: <a href="data/sector.csv">sector.csv</a> · <a href="data/country.csv">country.csv</a> · <a href="data/industry.csv">industry.csv</a>` }));

  const methods = h("div", { class: "card methods", style: "margin-top:18px" },
    h("h3", {}, "Indicators"),
    h("table", { class: "data" }, h("thead", {}, h("tr", {}, h("th", {}, "Indicator"), h("th", {}, "Definition"), h("th", {}, "Unit"), h("th", {}, "Source"))),
      h("tbody", {}, METRICS.map(M => h("tr", {}, h("td", {}, h("b", {}, M.label)), h("td", {}, M.desc), h("td", {}, M.unit), h("td", {}, h("code", {}, M.source)))))),
    h("h3", {}, "Notes"),
    h("ul", {},
      h("li", {}, "Real values use chain-linked volumes in 2020 euros. Chain-linked volumes are not additive, so the rest-of-manufacturing aggregate (C minus C26 and C29) is approximate in real terms and exact in nominal terms."),
      h("li", {}, "Unit labour cost levels are not comparable across countries with different price levels; compare their change over time."),
      h("li", {}, "ILOSTAT series fill the gaps for countries outside the Eurostat system (North Africa, Kenya, Ghana). ILO output per worker uses modelled estimates and is in international dollars at PPP."),
      h("li", {}, "Statutory sick-leave rules and legal working time from the Project 2 research are not yet included; they will be added as a separate dataset.")));
  root.append(methods);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const VIEWS = { atlas: renderAtlas, country: renderCountry, compare: renderCompare, hour: renderHour,
  sectors: renderSectors, industries: renderIndustries, convergence: renderConvergence, data: renderData };

function render() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  hideTip();
  if (!VIEWS[S.view]) S.view = "atlas";
  if (!D.name.has(S.focus)) S.focus = D.countries[0].geo;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.view === S.view));
  app.innerHTML = "";
  const root = h("div", { class: "view" });
  app.append(root);
  try { VIEWS[S.view](root); }
  catch (e) { console.error(e); root.append(h("p", { class: "empty" }, "Something went wrong drawing this view: " + e.message)); }
}

function initTheme() {
  let t = "dark";
  try { t = localStorage.getItem("lca-theme") || t; } catch (e) { /* storage unavailable */ }
  document.documentElement.dataset.theme = t;
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("lca-theme", next); } catch (e) { /* ignore */ }
    render();
  });
}

(async function main() {
  initTheme();
  readHash();
  try { await load(); }
  catch (e) { app.innerHTML = `<p class="empty">Could not load the data: ${e.message}</p>`; return; }
  document.getElementById("build-date").textContent = D.meta.built ? `Data built ${D.meta.built.slice(0, 10)}.` : "";
  render();
  addEventListener("hashchange", () => { readHash(); render(); });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 200); });
})();

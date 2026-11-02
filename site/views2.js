// Views: industries (any NACE level), economy structure (NACE tree), analysis (regressions), methods
import { METRICS, METRIC } from "./metrics.js";
import {
  d3, EU, S, D, writeHash, loadFull, val, series, latest, snapshot, coverage, endYear, growth,
  fmt, pp, cname, sectorLabel, cssVar, countryColor, seqRamp, divRamp, h, showTip, hideTip, ttRow,
  pageHeader, figure, grid, select, seg, kpiRow, svgEl, widthOf, axisLeft, axisBottom, lineChart, legend, scatter, yearOptions,
} from "./core.js";
import { ols, feOLS, stars, fmtP } from "./stats.js";

const rerender = () => window.dispatchEvent(new Event("lca:render"));
const set = (patch, push = false) => { Object.assign(S, patch); writeHash(push); rerender(); };
const naceName = c => D.nace.get(c) || sectorLabel(c) || c;
const level = c => (c === "TOTAL" ? 0 : /^[A-U]$/.test(c) ? 1 : /^[A-U]\d{2}$/.test(c) ? 2 : /^[A-U]\d{3}$/.test(c) ? 3 : /^[A-U]\d{4}$/.test(c) ? 4 : -1);

// ---------------------------------------------------------------------------
// Industries: structural business statistics at section, division or group level
// ---------------------------------------------------------------------------
const IND_METRICS = {
  va_worker: { label: "Value added per person employed", unit: "EUR at factor cost per person employed", f: v => "€" + d3.format(",.0f")(v) },
  wage_share: { label: "Wages and salaries / value added", unit: "share of value added at factor cost", f: d3.format(".1%") },
  emp: { label: "Persons employed", unit: "number of persons", f: d3.format(",.0f") },
};

export async function industries(root) {
  await loadFull();
  const rows = D.industry.rows;
  if (!rows.length) { root.append(pageHeader("Industries", "Industries", "Structural business statistics are not available in this build.")); return; }
  const allCodes = [...new Set(rows.map(r => r.nace))].filter(c => level(c) >= 1 && level(c) <= 3).sort();
  if (!allCodes.includes(S.industry)) S.industry = allCodes.includes("C29") ? "C29" : allCodes[0];
  const code = S.industry, M = IND_METRICS[S.indMetric];
  const sub = rows.filter(r => r.nace === code);
  const years = [...new Set(sub.map(r => r.year))].sort();
  const counts = years.map(y => sub.filter(r => r.year === y && r[S.indMetric] != null).length);
  const best = d3.max(counts) || 0;
  const yDefault = years.filter((y, i) => counts[i] >= .8 * best).pop() ?? d3.max(years);
  const yr = S.indYear && years.includes(S.indYear) ? S.indYear : yDefault;
  const get = (geo, y, c = code) => D.industry.idx.get(`${geo}|${c}|${y}`);

  root.append(pageHeader("Industries", `${code} ${naceName(code)}`,
    `Structural business statistics report value added, employment and personnel costs for enterprises in the business economy, classified by NACE Rev. 2 at section (letter), division (two digits) and group (three digits) level. ` +
    `Value added is measured at factor cost and differs from gross value added in the national accounts. The four FDI-intensive industries studied in the project are automotive parts (C293), wearing apparel (C14), leather and footwear (C15) and electrical equipment (C27).`));

  root.append(industryBrowser(allCodes, code));
  root.append(h("div", { class: "view-controls" },
    seg("Indicator", Object.entries(IND_METRICS).map(([value, m]) => ({ value, label: m.label })), S.indMetric, v => set({ indMetric: v })),
    select("Year", yearOptions(years), yr, v => set({ indYear: +v }), { compact: true })));

  // Ranking
  const snap = D.countries.map(c => ({ geo: c.geo, name: c.name, r: get(c.geo, yr) })).filter(d => d.r && d.r[S.indMetric] != null)
    .map(d => ({ ...d, v: d.r[S.indMetric] })).sort((a, b) => b.v - a.v);
  const euR = get(EU, yr);
  const f1 = figure({ title: `${M.label}, ${yr}`, span: 5, sub: M.unit + (euR?.[S.indMetric] != null ? ". Dashed line: EU27." : "."),
    note: "Source: Eurostat sbs_na_ind_r2 (to 2020) and sbs_ovw_act (from 2021). Values may be suppressed for confidentiality in small industries.",
    csv: () => snap.map(d => ({ country: d.name, year: yr, value: d.v })) });
  const pts = D.countries.map(c => ({ geo: c.geo, name: c.name, r: get(c.geo, yr) }))
    .filter(d => d.r && d.r.va_worker > 0 && d.r.wage_share > 0 && d.r.wage_share < 2)
    .map(d => ({ geo: d.geo, name: d.name, x: Math.log10(d.r.va_worker), y: 100 * d.r.wage_share, emp: d.r.emp || 0 }));
  const fit = pts.length > 5 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), ["log10 VA per person"]) : null;
  const f2 = figure({ title: "Productivity and wage share", span: 7,
    sub: `${yr}. Horizontal: value added per person employed (log scale). Vertical: wages and salaries in percent of value added. Marker area proportional to employment. Line: OLS fit with 95% band.`,
    note: fit ? `Slope ${fit.coefs[1].b.toFixed(1)} percentage points per tenfold increase in value added per person (SE ${fit.coefs[1].se.toFixed(1)}, p ${fmtP(fit.coefs[1].p)}, n = ${fit.n}, R² = ${fit.r2.toFixed(2)}).` : "",
    csv: () => pts.map(p => ({ country: p.name, va_per_person: 10 ** p.x, wage_share_pct: p.y, employed: p.emp })) });
  root.append(grid(f1.el, f2.el));
  drawBars(f1.body, snap, M.f, euR?.[S.indMetric]);
  scatter(f2.body, pts, { xLabel: "Value added per person employed (EUR, log scale)", yLabel: "Wage share of value added, %",
    xFmt: v => "€" + d3.format(",.0f")(Math.round(10 ** v)), yFmt: v => v.toFixed(0), fit: fit ? { predict: fit.predict } : null, rKey: "emp",
    xTicks: ([a, b]) => [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].map(Math.log10).filter(t => t >= a && t <= b),
    highlight: p => p.geo === S.focus, colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 440 });

  // Time series and children
  const geos = [...new Set([S.focus, ...S.comps, EU])];
  const list = geos.map(g => ({ key: g, label: cname(g), color: countryColor(g), width: g === S.focus ? 2.4 : 1.8, dash: g === EU ? "5 4" : null,
    data: years.map(y => ({ year: y, v: get(g, y)?.[S.indMetric] })).filter(d => d.v != null) })).filter(s => s.data.length);
  const f3 = figure({ title: `${M.label} over time`, span: 6, sub: `${M.unit}. Selected economies and EU27.`,
    note: "A break in 2021 can occur where the source changes from sbs_na_ind_r2 to sbs_ovw_act.",
    csv: () => list.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, value: d.v }))) });
  const kids = [...new Set(rows.filter(r => r.nace.startsWith(code) && level(r.nace) === level(code) + 1).map(r => r.nace))].sort();
  const kidRows = kids.map(c => ({ code: c, name: naceName(c), r: get(S.focus, yr, c) })).filter(d => d.r && d.r[S.indMetric] != null).map(d => ({ ...d, v: d.r[S.indMetric] }));
  const f4 = figure({ title: kids.length ? `Components of ${code} in ${cname(S.focus)}, ${yr}` : `${code} has no lower NACE level in this dataset`, span: 6,
    sub: kids.length ? `${M.label} by NACE ${level(code) === 1 ? "division" : "group"}. Click a bar to open it.` : "",
    csv: () => kidRows.map(d => ({ nace: d.code, label: d.name, value: d.v })) });
  root.append(grid(f3.el, f4.el));
  lineChart(f3.body, list, { height: 320, yFormat: M.f, xDomain: d3.extent(years) });
  if (kidRows.length) drawBars(f4.body, kidRows.map(d => ({ geo: d.code, name: `${d.code} ${d.name}`.slice(0, 48), v: d.v })).sort((a, b) => b.v - a.v), M.f, null,
    d => set({ industry: d.geo, indYear: null }));
  else if (kids.length) f4.body.append(h("p", { class: "empty" }, `No ${level(code) === 1 ? "division" : "group"} data for ${cname(S.focus)} in ${yr}.`));
}

// Browsable, searchable list of every industry in the data, grouped by NACE section
function industryBrowser(codes, current) {
  const sections = codes.filter(c => level(c) === 1);
  const project = ["C293", "C14", "C15", "C27"].filter(c => codes.includes(c));
  const list = h("div", { class: "ind-list" });
  const search = h("input", { class: "ind-search", type: "search", placeholder: "Search by name or code, e.g. “motor” or “C27”", "aria-label": "Search industries", value: S.indSearch || "" });
  const levelSel = S.indLevelFilter || "all";
  const fill = () => {
    const q = (search.value || "").toLowerCase().trim();
    list.innerHTML = "";
    for (const sec of sections) {
      const kids = codes.filter(c => c !== sec && c[0] === sec && (levelSel === "all" || level(c) === (levelSel === "division" ? 2 : 3)));
      const match = c => !q || c.toLowerCase().includes(q) || naceName(c).toLowerCase().includes(q);
      const shown = kids.filter(match);
      if (!match(sec) && !shown.length) continue;
      const grp = h("div", { class: "ind-group" },
        h("button", { class: `ind-item sec ${sec === current ? "on" : ""}`, onclick: () => set({ industry: sec, indYear: null }) }, h("b", {}, sec), " ", naceName(sec)));
      for (const c of shown) grp.append(h("button", { class: `ind-item l${level(c)} ${c === current ? "on" : ""}`, onclick: () => set({ industry: c, indYear: null }) }, h("b", {}, c), " ", naceName(c)));
      list.append(grp);
    }
    if (!list.children.length) list.append(h("p", { class: "empty" }, "No industry matches the search."));
  };
  search.addEventListener("input", () => { S.indSearch = search.value; fill(); });
  fill();
  return h("div", { class: "picker" },
    h("p", { class: "picker-title" }, `Industry `, h("span", {}, `· ${codes.length} industries available at section, division and group level; select one to update the charts`)),
    h("div", { class: "ind-tools" }, search,
      seg(null, [{ value: "all", label: "All levels" }, { value: "division", label: "Divisions" }, { value: "group", label: "Groups" }], levelSel, v => set({ indLevelFilter: v })),
      h("div", { class: "quick-links" }, h("span", { class: "field-label" }, "Project industries:"), project.map(c =>
        h("button", { class: `picker-opt ${c === current ? "on" : ""}`, onclick: () => set({ industry: c, indYear: null }) }, `${c} ${naceName(c).split(/[;,]/)[0].replace("Manufacture of ", "")}`)))),
    list);
}

function drawBars(host, data, f, euV, onClick) {
  if (!data.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 18, m = { l: onClick ? 240 : 150, r: 72, t: 16, b: 4 };
  const height = data.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, d3.max([...data.map(d => d.v), euV || 0])], [m.l, width - m.r]);
  data.forEach((d, i) => {
    const y = m.t + i * rowH;
    const g = svg.append("g").style("cursor", onClick ? "pointer" : null).on("click", () => onClick && onClick(d))
      .on("mousemove", ev => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow("Value", f(d.v))}`)).on("mouseleave", hideTip);
    g.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 8).attr("y", y + (rowH - 6) / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(d.name);
    g.append("rect").attr("x", m.l).attr("y", y).attr("height", rowH - 6).attr("fill", d.geo === S.focus || S.comps.includes(d.geo) ? countryColor(d.geo) : cssVar("--context"))
      .attr("width", 0).transition().duration(700).delay(i * 12).attr("width", Math.max(0, x(d.v) - m.l));
    g.append("text").attr("class", "label").attr("x", x(d.v) + 6).attr("y", y + (rowH - 6) / 2).attr("dominant-baseline", "middle").text(f(d.v));
  });
  if (euV != null) {
    svg.append("line").attr("class", "eu-line").attr("x1", x(euV)).attr("x2", x(euV)).attr("y1", 10).attr("y2", height);
    svg.append("text").attr("class", "annot").attr("x", x(euV)).attr("y", 8).attr("text-anchor", "middle").text("EU27 " + f(euV));
  }
}

// ---------------------------------------------------------------------------
// Economy structure: NACE hierarchy as a zoomable icicle chart
// ---------------------------------------------------------------------------
const SECTION_DIVS = { A: [1, 3], B: [5, 9], C: [10, 33], D: [35, 35], E: [36, 39], F: [41, 43], G: [45, 47], H: [49, 53], I: [55, 56], J: [58, 63],
  K: [64, 66], L: [68, 68], M: [69, 75], N: [77, 82], O: [84, 84], P: [85, 85], Q: [86, 88], R: [90, 93], S: [94, 96], T: [97, 98], U: [99, 99] };
function divisionsOf(code) {
  if (code === "TOTAL") return new Set(Object.values(SECTION_DIVS).flatMap(([a, b]) => d3.range(a, b + 1)));
  const sep = code.includes("-") ? "-" : "_";
  const tok = code.split(/[-_]/);
  const out = new Set();
  if (tok.every(t => /^[A-U]$/.test(t))) {
    const letters = sep === "-" ? d3.range(tok[0].charCodeAt(0), tok[tok.length - 1].charCodeAt(0) + 1).map(c => String.fromCharCode(c)) : tok;
    for (const L of letters) { const r = SECTION_DIVS[L]; if (r) d3.range(r[0], r[1] + 1).forEach(n => out.add(n)); }
  } else if (tok.every(t => /^[A-U]\d{2}$/.test(t))) {
    const nums = tok.map(t => +t.slice(1));
    (sep === "-" ? d3.range(nums[0], nums[nums.length - 1] + 1) : nums).forEach(n => out.add(n));
  } else return null;
  return out;
}
const sectionOf = code => (code === "TOTAL" ? null : code[0]);

function buildTree(geo, year) {
  const codes = [...new Set(D.full.rows.filter(r => r.geo === geo && r.year === year && r.emp > 0).map(r => r.nace))];
  const info = codes.map(c => ({ code: c, divs: divisionsOf(c) })).filter(d => d.divs && d.divs.size)
    // drop aggregates spanning several sections (except TOTAL)
    .filter(d => d.code === "TOTAL" || new Set([...d.divs].map(n => Object.entries(SECTION_DIVS).find(([, [a, b]]) => n >= a && n <= b)[0])).size === 1);
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  // a is below b if it covers fewer divisions, or the same divisions while b is the section itself (e.g. P85 below P)
  const isSub = (a, b, ca, cb) => [...a].every(x => b.has(x)) && (a.size < b.size || (same(a, b) && /^[A-U]$/.test(cb) && !/^[A-U]$/.test(ca)));
  const nodes = new Map(info.map(d => [d.code, { code: d.code, divs: d.divs, children: [] }]));
  if (!nodes.has("TOTAL")) nodes.set("TOTAL", { code: "TOTAL", divs: divisionsOf("TOTAL"), children: [] });
  for (const n of nodes.values()) {
    if (n.code === "TOTAL") continue;
    let parent = null;
    for (const m of nodes.values()) if (m !== n && m.code !== "TOTAL" && isSub(n.divs, m.divs, n.code, m.code) && (!parent || m.divs.size < parent.divs.size || (m.divs.size === parent.divs.size && !/^[A-U]$/.test(m.code)))) parent = m;
    (parent || nodes.get("TOTAL")).children.push(n);
  }
  // attach SBS groups below manufacturing divisions
  for (const n of nodes.values()) {
    if (n.divs.size === 1 && n.children.length === 0 && /^C\d{2}$/.test(n.code)) {
      const groups = D.industry.rows.filter(r => r.geo === geo && r.year === year && level(r.nace) === 3 && r.nace.startsWith(n.code) && r.emp > 0);
      const tot = d3.sum(groups, r => r.emp);
      if (groups.length > 1) for (const g of groups) n.children.push({ code: g.nace, sbsShare: g.emp / tot, children: [] });
    }
  }
  const empOf = c => D.full.idx.get(`${geo}|${c}|${year}`)?.emp;
  // assign values: leaves use their own employment; internal nodes add a remainder leaf if children do not add up
  function assign(n) {
    if (n.sbsShare != null) return;
    if (!n.children.length) { n.value = empOf(n.code) || 0; return; }
    n.children.forEach(assign);
    for (const c of n.children) if (c.sbsShare != null) c.value = (empOf(n.code) || 0) * c.sbsShare;
    const sum = d3.sum(n.children, c => valueOf(c)), own = empOf(n.code);
    if (own && own > sum * 1.005) n.children.push({ code: `${n.code}·rest`, rest: true, value: own - sum, children: [] });
  }
  const valueOf = n => (n.children.length ? d3.sum(n.children, valueOf) : n.value || 0);
  const root = nodes.get("TOTAL");
  assign(root);
  const strip = n => ({ code: n.code, rest: !!n.rest, sbs: n.sbsShare != null, ...(n.children.length ? { children: n.children.map(strip) } : { value: n.value || 0 }) });
  return strip(root);
}

export async function structure(root) {
  await loadFull();
  const end = endYear();
  const years = [...new Set(D.full.rows.filter(r => r.geo === S.focus && r.nace === "TOTAL" && r.emp).map(r => r.year))].sort();
  const year = years.includes(end) ? end : years[years.length - 1];
  root.append(pageHeader("Economy structure", `Structure of employment by activity, ${cname(S.focus)}`,
    `Economic activities are classified by NACE Rev. 2 in four levels: 21 sections (letters A to U), 88 divisions (two digits), 272 groups (three digits) and 615 classes (four digits). ` +
    `The national accounts (nama_10_a64) report sections and about 64 divisions or combinations of divisions; structural business statistics report the business economy down to groups. ` +
    `In the chart, the width of each bar is proportional to employment. Clicking a bar zooms into it; clicking the left-most bar zooms out.`));

  const colorModes = [
    { value: "prod_nat", label: "Productivity relative to national average" },
    { value: "prod_rel", label: "Productivity relative to EU27" },
    { value: "ulc_change", label: `ULC change ${S.base}–${end}` },
    { value: "coverage", label: "Years with data" },
  ];
  root.append(h("div", { class: "view-controls" }, seg("Color", colorModes, S.treeColor, v => set({ treeColor: v }))));

  if (!year) { root.append(h("p", { class: "empty" }, "No sector data are available for this economy.")); return; }
  const tree = buildTree(S.focus, year);
  const f1 = figure({ title: `Employment by NACE activity, ${year}`, span: 12,
    sub: `Bar height proportional to persons employed (national accounts). Groups below manufacturing divisions are allocated in proportion to their employment in structural business statistics. "Not further split" marks employment that the source does not break down.`,
    note: "Source: Eurostat nama_10_a64_e (employment), nama_10_a64 (value added), sbs_ovw_act (groups)." });
  root.append(f1.el);

  const fRow = h("div", { class: "grid" });
  const f2 = figure({ title: "Data availability by NACE section", span: 12, sub: "Share of economies that report the national accounts by activity, by NACE section and level of detail (national accounts: selected year; business statistics: last four years).", png: true});
  fRow.append(f2.el);
  root.append(fRow);

  drawIcicle(f1.body, tree, year, end);
  drawAvailability(f2.body, year);
}

function drawIcicle(host, data, year, end) {
  const width = widthOf(host), height = 760;
  const rootH = d3.hierarchy(data).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
  const depth = rootH.height + 1;
  d3.partition().size([height, depth])(rootH); // x0..x1 vertical, y0..y1 depth columns
  const colW = width / depth;
  const svg = svgEl(host, width, height);
  const full = D.full.idx;
  const prodRel = d => {
    const c = d.data.code; if (d.data.rest) return null;
    if (d.data.sbs) { const a = D.industry.idx.get(`${S.focus}|${c}|${year}`), b = D.industry.idx.get(`${EU}|${c}|${year}`); return a?.va_worker && b?.va_worker ? a.va_worker / b.va_worker : null; }
    const a = full.get(`${S.focus}|${c}|${year}`)?.prod, b = full.get(`${EU}|${c}|${Math.min(year, 2024)}`)?.prod ?? full.get(`${EU}|${c}|${year - 1}`)?.prod;
    return a && b ? a / b : null;
  };
  const ulcCh = d => {
    if (d.data.rest || d.data.sbs) return null;
    const a = full.get(`${S.focus}|${d.data.code}|${S.base}`)?.ulc, b = full.get(`${S.focus}|${d.data.code}|${end}`)?.ulc;
    return a > 0 && b > 0 ? 100 * Math.log(b / a) : null;
  };
  const covOf = d => {
    if (d.data.rest) return null;
    const src = d.data.sbs ? D.industry.idx : full;
    const n = D.allYears.filter(y => src.get(`${S.focus}|${d.data.code}|${y}`)?.[d.data.sbs ? "va_worker" : "emp"] != null).length;
    return n / D.allYears.length;
  };
  const natRel = d => {
    if (d.data.rest || d.data.sbs) return null;
    const a = full.get(`${S.focus}|${d.data.code}|${year}`)?.prod, b = full.get(`${S.focus}|TOTAL|${year}`)?.prod;
    return a && b ? a / b : null;
  };
  let colorFn, legendItems;
  if (S.treeColor === "prod_nat") {
    const c = d3.scaleDiverging([Math.log(0.25), 0, Math.log(4)], d3.interpolateRgbBasis(divRamp())).clamp(true);
    colorFn = d => { const v = natRel(d); return v == null ? cssVar("--map-empty") : c(Math.log(v)); };
    legendItems = [{ label: "Below national average", color: divRamp()[0] }, { label: "At national average", color: divRamp()[2] }, { label: "Above national average", color: divRamp()[4] }, { label: "No data", color: cssVar("--map-empty") }];
  } else if (S.treeColor === "prod_rel") {
    const c2 = d3.scaleDiverging([Math.log(0.25), 0, Math.log(4)], d3.interpolateRgbBasis(divRamp())).clamp(true);
    colorFn = d => { const v = prodRel(d); return v == null ? cssVar("--map-empty") : c2(Math.log(v)); };
    legendItems = [{ label: "Below EU27", color: divRamp()[0] }, { label: "Equal to EU27", color: divRamp()[2] }, { label: "Above EU27", color: divRamp()[4] }, { label: "No data", color: cssVar("--map-empty") }];
  } else if (S.treeColor === "ulc_change") {
    const c = d3.scaleDiverging([-40, 0, 40], d3.interpolateRgbBasis([...divRamp()].reverse())).clamp(true);
    colorFn = d => { const v = ulcCh(d); return v == null ? cssVar("--map-empty") : c(v); };
    legendItems = [{ label: "ULC fell", color: divRamp()[4] }, { label: "No change", color: divRamp()[2] }, { label: "ULC rose", color: divRamp()[0] }, { label: "No data", color: cssVar("--map-empty") }];
  } else {
    const c = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp())).domain([0, 1]);
    colorFn = d => { const v = covOf(d); return v == null ? cssVar("--map-empty") : c(v); };
    legendItems = [{ label: "Few years", color: seqRamp()[0] }, { label: "All years", color: seqRamp()[4] }];
  }
  host.append(legend(legendItems));

  const label = d => d.data.rest ? "Not further split" : d.data.code === "TOTAL" ? "Total economy" : `${d.data.code} ${naceName(d.data.code)}`;
  const levelName = ["Total", "Section", "Division", "Group"];
  d3.range(depth).forEach(i => svg.append("text").attr("class", "annot").attr("x", i * colW + 4).attr("y", -6).text(["Total", "Sections", "Divisions and aggregates", "Divisions", "Groups", "Groups"][i] || ""));
  const cell = svg.selectAll("g").data(rootH.descendants()).join("g").attr("transform", d => `translate(${d.y0 * colW},${d.x0})`);
  const rect = cell.append("rect").attr("width", d => colW - 2).attr("height", d => Math.max(0, d.x1 - d.x0 - 1)).attr("fill", colorFn)
    .style("cursor", "pointer")
    .on("mousemove", (ev, d) => {
      const pr = prodRel(d), uc = ulcCh(d), share = d.value / rootH.value;
      const nr = natRel(d);
      showTip(ev, `<div class="tt-title">${label(d)}</div>${ttRow("Persons employed", d3.format(",.1f")(d.value) + " thousand")}${ttRow("Share of total", d3.format(".1%")(share))}` +
        (nr != null ? ttRow("Productivity, national average = 1", nr.toFixed(2)) : "") +
        (pr != null ? ttRow("Productivity, EU27 = 1", pr.toFixed(2)) : "") + (uc != null ? ttRow(`ULC change ${S.base}–${end}`, pp(uc)) : ""));
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, p) => zoom(p));
  const text = cell.append("text").attr("class", "tree-label").attr("x", 6).attr("y", 13).text(d => label(d))
    .attr("opacity", d => (d.x1 - d.x0 > 15 ? 1 : 0));
  cell.append("title").text(d => label(d));
  // clip labels to the cell width
  text.each(function () { const t = d3.select(this); let s = t.text(); while (this.getComputedTextLength() > colW - 14 && s.length > 3) { s = s.slice(0, -2); t.text(s + "…"); } });

  let focus = rootH;
  function zoom(p) {
    focus = focus === p && p.parent ? p.parent : p;
    const k = height / (focus.x1 - focus.x0);
    rootH.each(d => { d.target = { x0: (d.x0 - focus.x0) * k, x1: (d.x1 - focus.x0) * k, y0: d.y0 - focus.y0, y1: d.y1 - focus.y0 }; });
    const t = cell.transition().duration(650).attr("transform", d => `translate(${d.target.y0 * colW},${d.target.x0})`);
    rect.transition(t).attr("height", d => Math.max(0, d.target.x1 - d.target.x0 - 1));
    text.transition(t).attr("opacity", d => (d.target.x1 - d.target.x0 > 15 && d.target.y0 >= 0 ? 1 : 0));
  }
}

function drawAvailability(host, year) {
  const sections = Object.keys(SECTION_DIVS);
  const naKeys = new Set(), sbsKeys = new Set(), naGeos = new Set();
  for (const r of D.full.rows) {
    if (r.emp == null) continue;
    if (r.nace === "TOTAL") naGeos.add(r.geo);
    if (r.year === year && level(r.nace) === 2) naKeys.add(`${r.geo}|${r.nace[0]}`);
  }
  for (const r of D.industry.rows) if (r.year >= year - 3 && r.va_worker != null && level(r.nace) >= 2) sbsKeys.add(`${r.geo}|${r.nace[0]}|${level(r.nace)}`);
  const geos = D.countries.map(c => c.geo).filter(g => naGeos.has(g));
  const rows = [
    { key: "na_section", label: "National accounts: section", test: (g, L) => D.full.idx.get(`${g}|${L}|${year}`)?.emp != null },
    { key: "na_div", label: "National accounts: divisions", test: (g, L) => naKeys.has(`${g}|${L}`) },
    { key: "sbs_div", label: "Business statistics: divisions", test: (g, L) => sbsKeys.has(`${g}|${L}|2`) },
    { key: "sbs_grp", label: "Business statistics: groups", test: (g, L) => sbsKeys.has(`${g}|${L}|3`) },
  ];
  const cells = [];
  for (const r of rows) for (const L of sections) cells.push({ r, L, share: geos.filter(g => r.test(g, L)).length / geos.length });
  const width = widthOf(host), m = { l: 210, t: 22, r: 10 }, ch = 24;
  const height = m.t + rows.length * ch + 30;
  const svg = svgEl(host, width, height);
  const x = d3.scaleBand(sections, [m.l, width - m.r]).padding(.08);
  const y = d3.scaleBand(rows.map(r => r.key), [m.t, m.t + rows.length * ch]).padding(.1);
  const c = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp())).domain([0, 1]);
  svg.selectAll("text.cx").data(sections).join("text").attr("class", "annot").attr("x", L => x(L) + x.bandwidth() / 2).attr("y", 12).attr("text-anchor", "middle").text(L => L);
  svg.selectAll("text.ry").data(rows).join("text").attr("class", "label").attr("x", m.l - 8).attr("text-anchor", "end").attr("dominant-baseline", "middle").attr("y", r => y(r.key) + y.bandwidth() / 2).text(r => r.label);
  svg.selectAll("rect").data(cells).join("rect").attr("x", d => x(d.L)).attr("y", d => y(d.r.key)).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", d => d.share ? c(d.share) : cssVar("--map-empty"))
    .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">Section ${d.L}: ${naceName(d.L)}</div>${ttRow(d.r.label, d3.format(".0%")(d.share) + " of economies")}`)).on("mouseleave", hideTip);
  svg.selectAll("text.v").data(cells).join("text").attr("class", "cell-val").attr("x", d => x(d.L) + x.bandwidth() / 2).attr("y", d => y(d.r.key) + y.bandwidth() / 2)
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("fill", d => d.share > .55 ? "#fff" : cssVar("--text-2")).text(d => d.share ? d3.format(".0%")(d.share) : "–");
}

// ---------------------------------------------------------------------------
// Analysis: pre-specified regressions and a custom model
// ---------------------------------------------------------------------------
const TRANSFORMS = { level: "Level, end year", log: "Log level, end year", growth: "Average annual log growth (%)", base: "Log level, base year" };

function variable(m, t, geo, base, end, nace) {
  if (t === "growth") return growth(m, geo, base, end, nace);
  const v = val(m, geo, t === "base" ? base : end, nace);
  if (v == null) return null;
  if (t === "log" || t === "base") return v > 0 ? Math.log(v) : null;
  return METRIC[m]?.fmt?.includes("%") ? 100 * v : v;
}
const varLabel = (m, t) => `${METRIC[m]?.label || m}${t === "growth" ? ", average annual growth (%)" : t === "log" ? ", log" : t === "base" ? ", log, base year" : METRIC[m]?.fmt?.includes("%") ? " (%)" : ""}`;

const MODELS = {
  passthrough: { label: "Compensation and productivity growth (cross-section)", y: ["comp_pe", "growth"], x: ["prod", "growth"],
    text: b => `A one percentage point higher average annual growth of real productivity is associated with ${b.toFixed(2)} percentage points higher average annual growth of nominal compensation per employee. Compensation is measured in nominal and productivity in real terms, so cross-country differences in inflation enter both the slope and the constant.` },
  passthrough_fe: { label: "Compensation and productivity growth (annual panel, country fixed effects)", panel: true,
    text: b => `Within economies, a one percentage point higher annual productivity growth is associated with ${b.toFixed(2)} percentage points higher annual compensation growth in the same year.` },
  beta_prod: { label: "β-convergence: productivity", y: ["prod", "growth"], x: ["prod", "base"],
    text: b => `A 10 percent higher initial productivity level is associated with ${(b * Math.log(1.1)).toFixed(2)} percentage points ${b < 0 ? "lower" : "higher"} subsequent annual productivity growth. A negative coefficient indicates β-convergence.` },
  beta_comp: { label: "β-convergence: compensation per employee", y: ["comp_pe", "growth"], x: ["comp_pe", "base"],
    text: b => `A 10 percent higher initial compensation level is associated with ${(b * Math.log(1.1)).toFixed(2)} percentage points ${b < 0 ? "lower" : "higher"} subsequent annual compensation growth.` },
  ulc_prod: { label: "Unit labor cost growth and productivity growth", y: ["ulc", "growth"], x: ["prod", "growth"],
    text: b => `A one percentage point higher annual productivity growth is associated with ${Math.abs(b).toFixed(2)} percentage points ${b < 0 ? "lower" : "higher"} annual ULC growth. A coefficient of −1 corresponds to no pass-through of productivity to compensation, 0 to full pass-through.` },
  labshare_level: { label: "Labor share and productivity level", y: ["labour_share", "level"], x: ["prod", "log"],
    text: b => `A 10 percent higher productivity level is associated with a labor share that is ${Math.abs(b * Math.log(1.1)).toFixed(2)} percentage points ${b < 0 ? "lower" : "higher"}.` },
  mw_bite: { label: "Minimum wage relative to mean earnings and productivity level", y: ["min_wage_ratio", "level"], x: ["prod", "log"],
    text: b => `A 10 percent higher productivity level is associated with a minimum-wage-to-mean-earnings ratio that is ${Math.abs(b * Math.log(1.1)).toFixed(2)} percentage points ${b < 0 ? "lower" : "higher"}.` },
  hours_prod: { label: "Annual hours per worker and hourly productivity", y: ["hours_worker", "level"], x: ["prod_hour", "log"],
    text: b => `A 10 percent higher hourly productivity is associated with ${Math.abs(b * Math.log(1.1)).toFixed(0)} ${b < 0 ? "fewer" : "more"} hours worked per person per year.` },
  custom: { label: "Custom bivariate model", custom: true },
};

export function analysis(root) {
  const end = endYear(), base = S.base, nace = S.nace;
  const regions = [...new Set(D.countries.map(c => c.region))];
  S.regions = S.regions || regions;
  root.append(pageHeader("Analysis", "Regression analysis",
    `Bivariate OLS regressions across economies, estimated in the browser on the data shown elsewhere in the atlas. Standard errors are heteroskedasticity-robust (HC1); the panel model uses country fixed effects with standard errors clustered by country. ` +
    `Estimates describe associations in the sample and do not identify causal effects. The period (${base}–${end}) and the sector (${sectorLabel(nace).toLowerCase()}) are set in the bar above.`));

  const modelOpts = Object.entries(MODELS).map(([value, m]) => ({ value, label: m.label }));
  const ctr = h("div", { class: "view-controls" },
    select("Model", modelOpts, S.model, v => set({ model: v })),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Sample"),
      h("div", { class: "seg" }, regions.map(r => h("button", { class: `seg-opt ${S.regions.includes(r) ? "on" : ""}`,
        onclick: () => set({ regions: S.regions.includes(r) ? S.regions.filter(x => x !== r) : [...S.regions, r] }) }, r)))));
  root.append(ctr);
  const M = MODELS[S.model] || MODELS.passthrough;
  if (M.custom) {
    const mOpts = METRICS.map(m => ({ value: m.key, label: m.label }));
    const tOpts = Object.entries(TRANSFORMS).map(([value, label]) => ({ value, label }));
    ctr.append(h("div", { class: "custom" },
      select("Dependent variable", mOpts, S.customY, v => set({ customY: v })), select("Transformation", tOpts, S.customTY, v => set({ customTY: v })),
      select("Explanatory variable", mOpts, S.customX, v => set({ customX: v })), select("Transformation", tOpts, S.customTX, v => set({ customTX: v }))));
  }
  const inSample = D.countries.filter(c => S.regions.includes(c.region));

  if (M.panel) {
    const rows = [];
    for (const c of inSample) for (const y of D.allYears) {
      if (y <= base || y > end) continue;
      const gc = growth("comp_pe", c.geo, y - 1, y, nace), gp = growth("prod", c.geo, y - 1, y, nace);
      if (gc != null && gp != null) rows.push({ g: c.geo, name: c.name, year: y, y: gc, x: gp });
    }
    const fit = feOLS(rows);
    const f1 = figure({ title: M.label, span: 5, sub: `Dependent variable: annual log change of compensation per employee (%). Regressor: annual log change of real productivity (%). ${base + 1}–${end}.` , png: false,
      csv: () => rows.map(r => ({ country: r.name, year: r.year, comp_growth: r.y, prod_growth: r.x })) });
    const f2 = figure({ title: "Observations", span: 7, sub: "Each marker is one economy-year, demeaned by economy (within transformation). Line: within estimate." });
    root.append(grid(f1.el, f2.el));
    if (!fit) { f1.body.append(h("p", { class: "empty" }, "Too few observations.")); return; }
    f1.body.append(regTable([{ name: "Productivity growth", ...fit.coefs[0] }], [["Observations", fit.n], ["Economies", fit.groups], ["R² (within)", fit.r2Within.toFixed(3)], ["Fixed effects", "Economy"], ["Standard errors", "Clustered by economy"]]),
      h("p", { class: "interp" }, M.text(fit.coefs[0].b)));
    const means = d3.rollup(rows, v => ({ y: d3.mean(v, r => r.y), x: d3.mean(v, r => r.x) }), r => r.g);
    const pts = rows.map(r => ({ geo: r.g, name: `${r.name} ${r.year}`, x: r.x - means.get(r.g).x, y: r.y - means.get(r.g).y }));
    const b = fit.coefs[0];
    scatter(f2.body, pts, { xLabel: "Productivity growth, demeaned", yLabel: "Compensation growth, demeaned", xFmt: d => d.toFixed(0), yFmt: d => d.toFixed(0),
      fit: { predict: x => ({ fit: b.b * x, lo: b.lo * x, hi: b.hi * x }) }, label: () => "", highlight: p => p.geo === S.focus, height: 440 });
    return;
  }

  const [ym, yt] = M.custom ? [S.customY, S.customTY] : M.y;
  const [xm, xt] = M.custom ? [S.customX, S.customTX] : M.x;
  const pts = inSample.map(c => {
    const y = variable(ym, yt, c.geo, base, end, nace), x = variable(xm, xt, c.geo, base, end, nace);
    return y != null && x != null && isFinite(x) && isFinite(y) ? { geo: c.geo, name: c.name, x, y } : null;
  }).filter(Boolean);
  const fit = pts.length > 4 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), [varLabel(xm, xt)]) : null;
  const f1 = figure({ title: M.label, span: 5, png: false, sub: `Dependent variable: ${varLabel(ym, yt)}. Explanatory variable: ${varLabel(xm, xt)}.`,
    csv: () => pts.map(p => ({ country: p.name, y: p.y, x: p.x })) });
  const f2 = figure({ title: "Observations and fitted line", span: 7, sub: "One marker per economy. Line: OLS fit with 95% confidence band." });
  root.append(grid(f1.el, f2.el));
  if (!fit) { f1.body.append(h("p", { class: "empty" }, "Too few observations for this sample.")); }
  else {
    f1.body.append(regTable(fit.coefs.slice(1).concat(fit.coefs.slice(0, 1)), [["Observations", fit.n], ["R²", fit.r2.toFixed(3)], ["Adjusted R²", fit.adjR2.toFixed(3)], ["Standard errors", "HC1 robust"]]));
    if (M.text) f1.body.append(h("p", { class: "interp" }, M.text(fit.coefs[1].b) + (fit.coefs[1].p >= 0.1 ? " The coefficient is not statistically different from zero at the 10% level." : "")));
  }
  scatter(f2.body, pts, { xLabel: varLabel(xm, xt), yLabel: varLabel(ym, yt), xFmt: d3.format(".2~f"), yFmt: d3.format(".2~f"),
    fit: fit ? { predict: fit.predict } : null, highlight: p => p.geo === S.focus,
    colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 460 });

  // σ-convergence for the dependent variable where it is a level series
  if (["beta_prod", "beta_comp"].includes(S.model)) {
    const m = S.model === "beta_prod" ? "prod" : "comp_pe";
    const yrs = D.allYears.filter(y => y >= base && y <= end);
    const bal = inSample.map(c => c.geo).filter(g => yrs.every(y => val(m, g, y, nace) > 0));
    const sd = yrs.map(y => ({ year: y, v: d3.deviation(bal.map(g => Math.log(val(m, g, y, nace)))) })).filter(d => d.v != null);
    const f3 = figure({ title: `σ-convergence: dispersion of ${METRIC[m].label.toLowerCase()}`, span: 12,
      sub: `Standard deviation of the log level across ${bal.length} economies observed in every year (balanced panel). A declining line indicates σ-convergence.` });
    root.append(grid(f3.el));
    lineChart(f3.body, [{ key: "sd", label: "Standard deviation", color: cssVar("--s1"), width: 2.2, data: sd }], { height: 260, yFormat: d3.format(".3f"), labelEnds: false });
  }
}

// Formulas are typeset with KaTeX; plain LaTeX is shown if KaTeX could not be loaded
export function tex(src, display = true) {
  const el = h("span", { class: display ? "tex tex-display" : "tex" });
  try { window.katex.render(src, el, { displayMode: display, throwOnError: false }); }
  catch (e) { el.textContent = src; }
  return el;
}
function formulaTable(rows) {
  return h("table", { class: "data formulas" }, h("tbody", {}, rows.map(([k, f]) => h("tr", {}, h("td", {}, k), h("td", { class: "formula" }, tex(f))))));
}

function regTable(coefs, stats) {
  return h("table", { class: "reg" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Coefficient"), h("th", {}, "Std. error"), h("th", {}, "t"), h("th", {}, "p"), h("th", {}, "95% CI"))),
    h("tbody", {}, coefs.map(c => h("tr", {}, h("td", {}, c.name), h("td", {}, c.b.toFixed(3) + stars(c.p)), h("td", {}, c.se.toFixed(3)), h("td", {}, c.t.toFixed(2)), h("td", {}, fmtP(c.p)), h("td", {}, `[${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]`)))),
    h("tfoot", {}, stats.map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", { colspan: 5 }, String(v)))),
      h("tr", {}, h("td", { colspan: 6, class: "reg-note" }, "*** p < 0.01, ** p < 0.05, * p < 0.1"))));
}

// ---------------------------------------------------------------------------
// Methods: coverage, sources, definitions
// ---------------------------------------------------------------------------
export function methods(root) {
  root.append(pageHeader("Methods and data", "Sources, definitions and coverage",
    `All series are retrieved from public sources by an automated build and committed to the repository with each refresh. Last build: ${D.meta.built ? new Date(D.meta.built).toUTCString() : "unknown"}.`));
  const cov = [];
  for (const c of D.countries) for (const M of METRICS) { const l = latest(M.key, c.geo, "TOTAL"); if (l) cov.push({ geo: c.geo, name: c.name, key: M.key, label: M.label, y: l.year }); }
  const f1 = figure({ title: "Coverage by economy and indicator", span: 12, sub: "Latest year with data, whole economy. Darker shading: more recent. Empty: not reported.",
    csv: () => cov.map(d => ({ country: d.name, indicator: d.label, latest_year: d.y })) });
  root.append(grid(f1.el));
  const width = widthOf(f1.body), m = { l: 250, t: 46, r: 6 }, chh = 19;
  const height = m.t + METRICS.length * chh + 6;
  const svg = svgEl(f1.body, width, height);
  const x = d3.scaleBand(D.countries.map(c => c.geo), [m.l, width - m.r]).padding(.08);
  const y = d3.scaleBand(METRICS.map(M => M.key), [m.t, height - 6]).padding(.1);
  const maxY = d3.max(cov, d => d.y);
  const col = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp())).domain([maxY - 12, maxY]).clamp(true);
  svg.selectAll("text.cx").data(D.countries).join("text").attr("class", "annot").attr("transform", c => `translate(${x(c.geo) + x.bandwidth() / 2},${m.t - 6}) rotate(-60)`).text(c => c.geo);
  svg.selectAll("text.ry").data(METRICS).join("text").attr("class", "label").attr("x", m.l - 8).attr("text-anchor", "end").attr("dominant-baseline", "middle").attr("y", M => y(M.key) + y.bandwidth() / 2).text(M => M.label);
  svg.selectAll("rect").data(cov).join("rect").attr("x", d => x(d.geo)).attr("y", d => y(d.key)).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", d => col(d.y))
    .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(d.label, "latest " + d.y)}`)).on("mouseleave", hideTip);

  const src = h("table", { class: "data" }, h("thead", {}, h("tr", {}, h("th", {}, "Source"), h("th", {}, "Status in last build"), h("th", {}, "Rows"))),
    h("tbody", {}, Object.entries(D.meta.sources || {}).map(([k, v]) => h("tr", {}, h("td", {}, h("code", {}, k)), h("td", { class: v.ok ? "ok" : "fail" }, v.ok ? "Retrieved" : "Failed"), h("td", {}, d3.format(",")(v.rows || 0))))));
  const defs = h("table", { class: "data" }, h("thead", {}, h("tr", {}, h("th", {}, "Indicator"), h("th", {}, "Definition"), h("th", {}, "Unit"), h("th", {}, "Source"))),
    h("tbody", {}, METRICS.map(M => h("tr", {}, h("td", {}, M.label), h("td", {}, M.desc), h("td", {}, M.unit), h("td", {}, h("code", {}, M.source))))));
  root.append(h("section", { class: "prose" },
    h("h2", {}, "Indicators"), defs,
    h("h2", {}, "Sources"), src,
    h("p", { html: `Tables: <a href="data/sector.csv">sector.csv</a>, <a href="data/sector_full.csv">sector_full.csv</a>, <a href="data/country.csv">country.csv</a>, <a href="data/industry.csv">industry.csv</a>, <a href="data/nace.csv">nace.csv</a>.` }),
    h("h2", {}, "Formulas"),
    h("p", {}, "Notation: economy ", tex("i", false), ", year ", tex("t", false), ", sector ", tex("s", false), ". ", tex(String.raw`\mathit{GVA}^{\,real}`, false), " is gross value added in chain-linked 2020 euros and ", tex(String.raw`\mathit{GVA}^{\,nom}`, false), " at current prices; ", tex("D1", false), " compensation of employees; ", tex("D11", false), " wages and salaries; ", tex("D29X39", false), " other taxes less subsidies on production; ", tex("E", false), " persons employed; ", tex("L", false), " employees; ", tex("H", false), " and ", tex("H^{L}", false), " hours worked by persons employed and by employees; ", tex(String.raw`\mathit{LC}^{h}`, false), " hourly labor cost from the labor cost survey; ", tex("s^{nw}", false), " non-wage share; ", tex(String.raw`\tau`, false), " tax wedge; ", tex("t_0, t_1", false), " start and end year of the period."),
    formulaTable([
      ["Real productivity per person employed", String.raw`P_{it} = \frac{\mathit{GVA}^{\,real}_{it}}{E_{it}}`],
      ["Real productivity per hour worked", String.raw`P^{h}_{it} = \frac{\mathit{GVA}^{\,real}_{it}}{H_{it}}`],
      ["Compensation per employee", String.raw`W_{it} = \frac{D1_{it}}{L_{it}}`],
      ["Compensation per employee hour", String.raw`W^{h}_{it} = \frac{D1_{it}}{H^{L}_{it}}`],
      ["Unit labor cost", String.raw`\mathit{ULC}_{it} = \frac{W_{it}}{P_{it}}, \qquad \mathit{ULC}^{h}_{it} = \frac{W^{h}_{it}}{P^{h}_{it}}`],
      ["Index", String.raw`I_{it} = 100 \cdot \frac{X_{it}}{X_{i,t_0}}`],
      ["Log change and annual average", String.raw`\Delta \ln X_i = 100\,\big(\ln X_{i,t_1} - \ln X_{i,t_0}\big), \qquad g_i = \frac{\Delta \ln X_i}{t_1 - t_0}`],
      ["Decomposition of unit labor cost", String.raw`\Delta \ln \mathit{ULC}_{i} = \Delta \ln W_{i} - \Delta \ln P_{i}`],
      ["Labor share", String.raw`\mathit{LS}_{it} = \frac{D1_{it}}{\mathit{GVA}^{\,nom}_{it}}, \qquad \mathit{LS}^{adj}_{it} = \frac{D1_{it}/L_{it}\cdot E_{it}}{\mathit{GVA}^{\,nom}_{it}}`],
      ["Profit share", String.raw`\Pi_{it} = \frac{\mathit{GVA}^{\,nom}_{it} - D1_{it} - D29X39_{it}}{\mathit{GVA}^{\,nom}_{it}}`],
      ["Employer contribution rate", String.raw`c_{it} = \frac{D1_{it} - D11_{it}}{D11_{it}}`],
      ["Annual hours per worker", String.raw`h_{it} = \frac{H_{it}}{E_{it}}`],
      ["Nominal value added per hour", String.raw`V^{h}_{it} = \frac{\mathit{GVA}^{\,nom}_{it}}{H_{it}}`],
      ["Labor cost per EUR 100 of value added", String.raw`\kappa_{it} = 100 \cdot \frac{\mathit{LC}^{h}_{it}}{V^{h}_{it}}`],
      ["Components of hourly labor cost", String.raw`\begin{aligned} \text{employer} &= \mathit{LC}^{h}\, s^{nw} \\ \text{employee taxes} &= \mathit{LC}^{h} \max\!\big(0,\ \tau - s^{nw}\big) \\ \text{net} &= \mathit{LC}^{h} - \text{employer} - \text{employee taxes} \end{aligned}`],
      ["Break-even change in hourly labor cost", String.raw`c^{*}_{A} = \frac{\mathit{LC}^{h}_{B} / V^{h}_{B}}{\mathit{LC}^{h}_{A} / V^{h}_{A}} - 1`],
      ["Relative productivity (economy tree)", String.raw`\rho_{is} = \frac{P_{is}}{P_{i,\text{total}}} \quad\text{or}\quad \rho_{is} = \frac{P_{is}}{P_{\text{EU27},s}}`],
      ["σ-convergence", String.raw`\sigma_t = \sqrt{\frac{1}{N-1}\sum_{i=1}^{N}\big(\ln X_{it} - \overline{\ln X}_{t}\big)^{2}}`],
      ["β-convergence", String.raw`g_i = \alpha + \beta \ln X_{i,t_0} + \varepsilon_i, \qquad \beta < 0 \Rightarrow \text{convergence}`],
      ["OLS estimator", String.raw`\hat{\beta} = (X'X)^{-1} X'y`],
      ["Robust variance (HC1)", String.raw`\widehat{V}_{HC1}(\hat\beta) = \frac{n}{n-k}\,(X'X)^{-1}\Big(\sum_{i=1}^{n} \hat{e}_i^{2}\, x_i x_i'\Big)(X'X)^{-1}`],
      ["Panel model with economy fixed effects", String.raw`\Delta \ln W_{it} = \alpha_i + \beta\, \Delta \ln P_{it} + \varepsilon_{it}`],
      ["Within estimator", String.raw`\hat\beta_{FE} = \frac{\sum_{i}\sum_{t} \tilde{x}_{it}\tilde{y}_{it}}{\sum_{i}\sum_{t} \tilde{x}_{it}^{2}}, \qquad \tilde{z}_{it} = z_{it} - \bar{z}_{i}`],
      ["Cluster-robust variance", String.raw`\widehat{V}_{CL}(\hat\beta_{FE}) = \frac{G}{G-1}\cdot\frac{N-1}{N-K}\cdot \frac{\sum_{g=1}^{G}\big(\sum_{t}\tilde{x}_{gt}\hat{e}_{gt}\big)^{2}}{\big(\sum_{g}\sum_{t}\tilde{x}_{gt}^{2}\big)^{2}}, \qquad K = G + 1`],
      ["Inference", String.raw`t = \frac{\hat\beta}{\widehat{\mathrm{se}}(\hat\beta)} \sim t_{\nu}, \qquad \nu = n-k \ \text{(OLS)}, \quad \nu = G-1 \ \text{(clustered)}`],
    ]),
    h("h2", {}, "Limitations"),
    h("ul", {},
      h("li", {}, "Price levels. Real productivity is measured in chain-linked euros at national prices, not at purchasing power parity. Cross-country comparisons of productivity levels therefore combine differences in output with differences in price levels, and unit labor cost levels are not comparable across economies; only their changes are."),
      h("li", {}, "Different sources. Hourly labor cost (labor cost survey), value added and hours (national accounts), business statistics and ILOSTAT differ in coverage, definitions and reference years. Indicators that combine sources, such as labor cost per EUR 100 of value added, are indicative."),
      h("li", {}, "Self-employment. Compensation per employee excludes the self-employed. Where self-employment is large (for example in agriculture), the unadjusted labor share understates the income share of labor."),
      h("li", {}, "Aggregation. Chain-linked volumes are not additive. Aggregates computed as differences are approximate in real terms."),
      h("li", {}, "Breaks and revisions. Series are revised by the statistical offices and contain breaks, for example in the early 2000s for some candidate countries and in 2021 for structural business statistics. Published values can change between builds."),
      h("li", {}, "Coverage. Years and indicators available differ by economy. Rankings include only economies that report the indicator, and the latest year can differ between economies."),
      h("li", {}, "Tax wedge. The split of hourly labor cost applies the tax wedge of a single low-wage earner without children to the average hourly cost, which does not represent the full wage distribution."),
      h("li", {}, "ILOSTAT. Output per worker is a modelled estimate in international dollars at purchasing power parity; earnings are converted to US dollars at market exchange rates and are sensitive to exchange-rate movements."),
      h("li", {}, "Regressions. Models are bivariate, estimated on small cross-sections, and sensitive to outliers such as Ireland and Luxembourg. In the compensation–productivity models, compensation is nominal and productivity real, so inflation differences enter the estimates. Coefficients describe associations and do not identify causal effects."),
      h("li", {}, "Scope. Statutory sick-leave rules and legal working time from the project research are not yet included.")),
    h("h2", {}, "Notes"),
    h("ul", {},
      h("li", {}, "Log changes are reported in log points (100 × Δln). For small changes they approximate percentage changes."),
      h("li", {}, "Structural business statistics measure value added at factor cost for the business economy. The source changes from sbs_na_ind_r2 to sbs_ovw_act in 2021."))));
}

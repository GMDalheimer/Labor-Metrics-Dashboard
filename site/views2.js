// Views: industries (any NACE level), economy structure (NACE tree), analysis (regressions), methods
import { METRICS, METRIC } from "./metrics.js";
import {
  d3, EU, S, D, writeHash, loadFull, val, series, latest, snapshot, coverage, endYear, growth,
  fmt, pp, cname, sectorLabel, cssVar, countryColor, seqRamp, divRamp, h, showTip, hideTip, ttRow,
  pageHeader, figure, grid, select, seg, kpiRow, svgEl, widthOf, axisLeft, axisBottom, lineChart, legend, scatter, yearOptions, svgFlag, hasFlag,
} from "./core.js";
import { ols, feOLS, stars, fmtP } from "./stats.js";
import { comparisonSeries, tex } from "./core.js";

const rerender = () => window.dispatchEvent(new Event("lca:render"));
const set = (patch, push = false) => { Object.assign(S, patch); writeHash(push); rerender(); };
const naceName = c => D.nace.get(c) || sectorLabel(c) || c;
const level = c => (c === "TOTAL" ? 0 : /^[A-U]$/.test(c) ? 1 : /^[A-U]\d{2}$/.test(c) ? 2 : /^[A-U]\d{3}$/.test(c) ? 3 : /^[A-U]\d{4}$/.test(c) ? 4 : -1);

// ---------------------------------------------------------------------------
// Industries: structural business statistics at section, division or group level
// ---------------------------------------------------------------------------
const IND_METRICS = {
  va_worker: { label: "Value added per person employed", unit: "Values are in euros of value added at factor cost per person employed.", f: v => "€" + d3.format(",.0f")(v) },
  wage_share: { label: "Wages and salaries / value added", unit: "Wages and salaries are shown as a share of value added at factor cost.", f: d3.format(".1%") },
  emp: { label: "Persons employed", unit: "Values are numbers of persons employed.", f: d3.format(",.0f") },
};

// ---- Industry data: business statistics for sections B–N, national accounts for the rest ----
const SBS_SECTIONS = new Set("BCDEFGHIJKLMN".split(""));
const naLevel = c => {
  if (c === "TOTAL") return 0;
  if (/^[A-U]$/.test(c)) return 1;
  const parts = c.split(/[-_]/);
  if (parts.every(t => /^[A-U]\d{2}$/.test(t)) && new Set(parts.map(t => t[0])).size === 1) return 2;
  return -1;
};
function industryIndex() {
  if (D.indIndex) return D.indIndex;
  const sbs = new Set(D.industry.rows.map(r => r.nace).filter(c => level(c) >= 1 && level(c) <= 3));
  // national-accounts codes for the parts of the economy not covered by business statistics
  const na = new Set(D.full.rows.map(r => r.nace).filter(c => naLevel(c) >= 1 && !SBS_SECTIONS.has(c[0]) && !/^[TU]/.test(c)));
  const codes = [...sbs, ...na].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  const src = c => (sbs.has(c) ? "sbs" : "na");
  const lev = c => (src(c) === "sbs" ? level(c) : naLevel(c));
  const parent = c => (lev(c) === 1 ? null : lev(c) === 2 ? c[0] : c.slice(0, 3));
  D.indIndex = { codes, src, lev, parent, children: c => codes.filter(k => parent(k) === c) };
  return D.indIndex;
}
// One row per economy, code and year in a common shape
function indRow(geo, code, year) {
  if (code === "TOTAL" || D.indIndex.src(code) === "na") {
    const r = D.full.idx.get(`${geo}|${code}|${year}`);
    if (!r || !r.emp) return null;
    return { emp: r.emp * 1000, va_worker: r.va_nom != null ? r.va_nom / r.emp * 1000 : null, wage_share: r.labour_share ?? null, src: "na" };
  }
  const r = D.industry.idx.get(`${geo}|${code}|${year}`);
  return r ? { ...r, src: "sbs" } : null;
}

const SRC_NOTE = {
  sbs: "Data are from the Eurostat structural business statistics (sbs_na_ind_r2 to 2020 and sbs_ovw_act from 2021). Value added is measured at factor cost, and wages and salaries exclude employer contributions. Values may be suppressed for confidentiality in small industries.",
  na: "Data are from the Eurostat national accounts (nama_10_a64 and nama_10_a64_e). Structural business statistics do not cover this activity. Value added is gross value added at current prices and the wage share is compensation of employees (including employer contributions) over value added.",
};

export async function industries(root) {
  await loadFull();
  const IX = industryIndex();
  if (!IX.codes.includes(S.industry) && S.industry !== "TOTAL") S.industry = IX.codes.includes("C") ? "C" : IX.codes[0];
  const code = S.industry, M = IND_METRICS[S.indMetric];
  const src = code === "TOTAL" ? "na" : IX.src(code);
  const years = D.allYears.filter(y => D.countries.some(c => indRow(c.geo, code, y)?.[S.indMetric] != null));
  const counts = years.map(y => D.countries.filter(c => indRow(c.geo, code, y)?.[S.indMetric] != null).length);
  const best = d3.max(counts) || 0;
  const yDefault = years.filter((y, i) => counts[i] >= .8 * best).pop() ?? d3.max(years);
  const yr = S.indYear && years.includes(S.indYear) ? S.indYear : yDefault;
  const get = (geo, y, c = code) => indRow(geo, c, y);
  const title = code === "TOTAL" ? "Total economy" : `${code} ${naceName(code)}`;

  root.append(pageHeader("Industries", title,
    `An activity can be selected below. Activities follow the EU classification NACE Rev. 2: sections have a letter, divisions two digits and groups three. ` +
    `Figures for sections B to N come from Eurostat's business statistics. Agriculture (A) and public and social services (O to S) are not covered there, so they come from the national accounts.`));

  root.append(industryBrowser(IX, code));
  root.append(h("div", { class: "view-controls" },
    seg("Indicator", Object.entries(IND_METRICS).map(([value, m]) => ({ value, label: m.label })), S.indMetric, v => set({ indMetric: v })),
    years.length ? select("Year", yearOptions(years), yr, v => set({ indYear: +v }), { compact: true }) : null));
  if (!years.length) { root.append(h("p", { class: "empty" }, "No data are available for this activity.")); return; }

  const snap = D.countries.map(c => ({ geo: c.geo, name: c.name, r: get(c.geo, yr) })).filter(d => d.r && d.r[S.indMetric] != null)
    .map(d => ({ ...d, v: d.r[S.indMetric] })).sort((a, b) => b.v - a.v);
  const euR = get(EU, yr);
  const unit = src === "na" && S.indMetric === "wage_share" ? "Compensation of employees is shown as a share of gross value added." : src === "na" && S.indMetric === "va_worker" ? "Values are in euros of gross value added per person employed, at current prices." : M.unit;
  const f1 = figure({ title: `${M.label}, ${yr}`, span: 5, sub: unit + (euR?.[S.indMetric] != null ? " The dashed line marks the EU27." : ""),
    note: SRC_NOTE[src], csv: () => snap.map(d => ({ country: d.name, year: yr, value: d.v })) });
  const pts = D.countries.map(c => ({ geo: c.geo, name: c.name, r: get(c.geo, yr) }))
    .filter(d => d.r && d.r.va_worker > 0 && d.r.wage_share > 0 && d.r.wage_share < 2)
    .map(d => ({ geo: d.geo, name: d.name, x: Math.log10(d.r.va_worker), y: 100 * d.r.wage_share, emp: d.r.emp || 0 }));
  const fit = pts.length > 5 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), ["log10 VA per person"]) : null;
  const f2 = figure({ title: "Productivity and wage share", span: 7,
    sub: `Each marker is one economy in ${yr}.`,
    text: `The horizontal axis shows value added per person employed on a log scale, and the vertical axis ${src === "na" ? "compensation" : "wages and salaries"} as a percentage of value added. Marker size reflects employment, and the line is an OLS fit with a 95% confidence band.`,
    note: fit ? `The slope is ${fit.coefs[1].b.toFixed(1)} percentage points per tenfold increase in value added per person (SE ${fit.coefs[1].se.toFixed(1)}, p ${fmtP(fit.coefs[1].p)}, n = ${fit.n}, R² = ${fit.r2.toFixed(2)}).` : "",
    csv: () => pts.map(p => ({ country: p.name, va_per_person: 10 ** p.x, wage_share_pct: p.y, employed: p.emp })) });
  root.append(grid(f1.el, f2.el));
  drawBars(f1.body, snap, M.f, euR?.[S.indMetric]);
  scatter(f2.body, pts, { xLabel: "Value added per person employed (EUR, log scale)", yLabel: "Wage share of value added, %",
    xFmt: v => "€" + d3.format(",.0f")(Math.round(10 ** v)), yFmt: v => v.toFixed(0), fit: fit ? { predict: fit.predict } : null, rKey: "emp",
    xTicks: ([a, b]) => [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].map(Math.log10).filter(t => t >= a && t <= b),
    highlight: p => p.geo === S.focus, colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 440 });

  const list = comparisonSeries(g => years.map(y => ({ year: y, v: get(g, y)?.[S.indMetric] })).filter(d => d.v != null));
  const f3 = figure({ title: `${M.label} over time`, span: 6, sub: unit, text: "The chart shows the selected economies, the EU27 and any additional countries or groups chosen above.",
    note: src === "sbs" ? "A break in 2021 can occur where the source changes from sbs_na_ind_r2 to sbs_ovw_act." : "",
    csv: () => list.flatMap(s => s.data.map(d => ({ series: s.label, year: d.year, value: d.v }))) });
  const kids = code === "TOTAL" ? IX.codes.filter(c => IX.lev(c) === 1) : IX.children(code);
  const kidRows = kids.map(c => ({ code: c, name: naceName(c), r: get(S.focus, yr, c) })).filter(d => d.r && d.r[S.indMetric] != null).map(d => ({ ...d, v: d.r[S.indMetric] }));
  const f4 = figure({ title: kids.length ? `Components of ${code === "TOTAL" ? "the total economy" : code} in ${cname(S.focus)}, ${yr}` : `${code} is not broken down further in the data`, span: 6,
    sub: kids.length ? `${M.label} is shown by ${code === "TOTAL" ? "section" : IX.lev(code) === 1 ? "division" : "group"}.` : "", text: kids.length ? "Clicking a bar opens that activity." : "",
    csv: () => kidRows.map(d => ({ nace: d.code, label: d.name, value: d.v })) });
  root.append(grid(f3.el, f4.el));
  lineChart(f3.body, list, { height: 320, yFormat: M.f, xDomain: d3.extent(years) });
  if (kidRows.length) drawBars(f4.body, kidRows.map(d => ({ geo: d.code, name: `${d.code} ${d.name}`.slice(0, 48), v: d.v })).sort((a, b) => b.v - a.v), M.f, null,
    d => set({ industry: d.geo, indYear: null }));
  else if (kids.length) f4.body.append(h("p", { class: "empty" }, `No data for the components of ${code} in ${cname(S.focus)} in ${yr}.`));
}

// Column browser over the whole NACE tree: sections | divisions | groups, plus shortcuts and search
function industryBrowser(IX, current) {
  const path = [];
  if (current !== "TOTAL") { let c = current; while (c) { path.unshift(c); c = IX.parent(c); } }
  const sel = { sec: path[0], div: path[1], grp: path[2] };
  const pick = c => set({ industry: c, indYear: null });
  const item = (c, extra = "") => h("button", { class: `col-item ${c === current ? "on" : path.includes(c) ? "path" : ""} ${extra}`,
    onclick: () => pick(c), title: `${c} ${naceName(c)}` },
    h("b", {}, c), h("span", {}, naceName(c)), IX.children(c).length ? h("i", { "aria-hidden": "true" }, "›") : null);
  const col = (label, codes, empty) => h("div", { class: "col" }, h("p", { class: "col-head" }, label),
    h("div", { class: "col-list" }, codes.length ? codes.map(c => item(c)) : h("p", { class: "col-empty" }, empty)));

  const sections = IX.codes.filter(c => IX.lev(c) === 1);
  const divs = sel.sec ? IX.children(sel.sec) : [];
  const grps = sel.div ? IX.children(sel.div) : [];
  const columns = h("div", { class: "cols" },
    col("Sections", sections, ""),
    col(sel.sec ? `Divisions of ${sel.sec}` : "Divisions", divs, sel.sec ? "No divisions in the data." : "No section is selected."),
    col(sel.div ? `Groups of ${sel.div}` : "Groups", grps, sel.div ? "No groups in the data for this division." : "No division is selected."));

  const results = h("div", { class: "search-results", hidden: true });
  const search = h("input", { class: "ind-search", type: "search", placeholder: "Search all activities by name or code", "aria-label": "Search activities" });
  search.addEventListener("input", () => {
    const q = search.value.toLowerCase().trim();
    results.innerHTML = "";
    if (!q) { results.hidden = true; columns.hidden = false; return; }
    const hits = IX.codes.filter(c => c.toLowerCase().includes(q) || naceName(c).toLowerCase().includes(q)).slice(0, 60);
    results.append(...(hits.length ? hits.map(c => item(c, `l${IX.lev(c)}`)) : [h("p", { class: "col-empty" }, "No activity matches the search.")]));
    results.hidden = false; columns.hidden = true;
  });
  const shortcuts = [["TOTAL", "Total economy"], ["C", "Manufacturing"], ["G", "Trade"], ["F", "Construction"], ["J", "Information and communication"], ["A", "Agriculture"]]
    .filter(([c]) => c === "TOTAL" || IX.codes.includes(c));
  const crumbs = h("div", { class: "crumbs" }, h("button", { class: `link-btn ${current === "TOTAL" ? "on" : ""}`, onclick: () => pick("TOTAL") }, "Total economy"),
    path.map(c => [h("span", { class: "sep" }, "›"), h("button", { class: `link-btn ${c === current ? "on" : ""}`, onclick: () => pick(c) }, `${c} ${naceName(c).split(/[;,]/)[0]}`)]).flat());
  return h("div", { class: "picker browser" },
    h("div", { class: "browser-top" },
      h("p", { class: "picker-title" }, "Activity", h("span", {}, `. ${IX.codes.length} activities across the whole economy can be selected.`)),
      search),
    h("div", { class: "shortcuts" }, h("span", { class: "field-label" }, "Shortcuts"),
      shortcuts.map(([c, l]) => h("button", { class: `picker-opt ${c === current ? "on" : ""}`, onclick: () => pick(c) }, l))),
    crumbs, columns, results);
}

function drawBars(host, data, f, euV, onClick) {
  if (!data.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const flags = data.some(d => hasFlag(d.geo));
  const width = widthOf(host), rowH = 18, m = { l: onClick ? 240 : flags ? 172 : 150, r: 72, t: 16, b: 4 };
  const height = data.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, d3.max([...data.map(d => d.v), euV || 0])], [m.l, width - m.r]);
  data.forEach((d, i) => {
    const y = m.t + i * rowH;
    const g = svg.append("g").style("cursor", onClick ? "pointer" : null).on("click", () => onClick && onClick(d))
      .on("mousemove", ev => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow("Value", f(d.v))}`)).on("mouseleave", hideTip);
    if (flags) svgFlag(g, d.geo, m.l - 24, y + (rowH - 6) / 2, 12);
    g.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", m.l - (flags ? 30 : 8)).attr("y", y + (rowH - 6) / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(d.name);
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
    if (own && own > sum * 1.005) n.children.push({ code: `${n.code}-rest`, rest: true, value: own - sum, children: [] });
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
    `How a country's jobs are spread across activities. The EU classification has 21 sections, 88 divisions, 272 groups and 615 classes; the national accounts publish sections and about 64 divisions, and the business statistics go down to groups. ` +
    `The taller a bar, the more people work in that activity. Clicking a bar zooms in, and clicking the left-most bar zooms out.`));

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
    sub: "Bar height is proportional to persons employed.",
    text: `Employment is taken from the national accounts. Groups below the manufacturing divisions are allocated in proportion to their employment in the business statistics. "Not further split" marks employment that the source does not break down.`,
    note: "Employment is from Eurostat nama_10_a64_e, value added from nama_10_a64 and groups from sbs_ovw_act." });
  root.append(f1.el);

  const fRow = h("div", { class: "grid" });
  const f2 = figure({ title: "Data availability by NACE section", span: 12, sub: "Each cell shows the share of economies that report data.", text: "Shares are shown for each NACE section and level of detail. National accounts refer to the selected year and business statistics to the last four years.", png: true});
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
    `Simple regressions of one indicator on another across countries, run on the same data as the rest of the site. Standard errors are robust (HC1); the panel model adds country fixed effects and clusters standard errors by country. ` +
    `The results show associations, not causes. The period (${base}–${end}) and the sector (${sectorLabel(nace).toLowerCase()}) come from the bar above.`));

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
    const f1 = figure({ title: M.label, span: 5, sub: `Pay growth is regressed on productivity growth, ${base + 1}–${end}.`, text: "The dependent variable is the annual log change of compensation per employee, and the regressor is the annual log change of real productivity, both in percent.", png: false,
      csv: () => rows.map(r => ({ country: r.name, year: r.year, comp_growth: r.y, prod_growth: r.x })) });
    const f2 = figure({ title: "Observations", span: 7, sub: "Each marker is one economy-year.", text: "Each economy's own mean is subtracted before plotting. The line is the within estimate." });
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
  const f1 = figure({ title: M.label, span: 5, png: false, sub: `The dependent variable is ${varLabel(ym, yt).replace(/^./, c => c.toLowerCase())} and the explanatory variable is ${varLabel(xm, xt).replace(/^./, c => c.toLowerCase())}.`,
    csv: () => pts.map(p => ({ country: p.name, y: p.y, x: p.x })) });
  const f2 = figure({ title: "Observations and fitted line", span: 7, sub: "Each marker is one economy.", text: "The line is an OLS fit with a 95% confidence band." });
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
      sub: "A declining line indicates σ-convergence.", text: `The line shows the standard deviation of the log level across the ${bal.length} economies observed in every year.` });
    root.append(grid(f3.el));
    lineChart(f3.body, [{ key: "sd", label: "Standard deviation", color: cssVar("--s1"), width: 2.2, data: sd }], { height: 260, yFormat: d3.format(".3f"), labelEnds: false });
  }
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
const FORMULAS = [
  { group: "Productivity", items: [
    { t: "Real productivity per person employed", f: String.raw`P_{it} = \frac{\mathit{GVA}^{\,real}_{it}}{E_{it}}`,
      x: "Output produced per worker in a year. Real gross value added (chain-linked volumes, 2020 prices) removes the effect of price changes, so a change in P reflects a change in the volume of output per worker. The denominator counts all persons employed, including the self-employed.",
      read: "A value of €30,000 means that each person employed produced, on average, goods and services worth €30,000 at 2020 prices. Because prices are national, levels are best compared over time within a country; cross-country level comparisons also reflect price-level differences." },
    { t: "Real productivity per hour worked", f: String.raw`P^{h}_{it} = \frac{\mathit{GVA}^{\,real}_{it}}{H_{it}}`,
      x: "The same output measure divided by total hours worked instead of persons. It corrects for differences in working time: countries with long working hours have a higher productivity per person than per hour.",
      read: "Preferred for comparisons between economies with different shares of part-time work or different statutory working time." },
  ]},
  { group: "Labor cost and unit labor cost", items: [
    { t: "Compensation per employee", f: String.raw`W_{it} = \frac{D1_{it}}{L_{it}}`,
      x: "Average yearly cost of an employee to the employer: gross wages and salaries plus employer social contributions (national accounts item D1), divided by the number of employees. The self-employed are excluded because they receive no compensation of employees.",
      read: "Measured in nominal euros, so it includes the effect of inflation." },
    { t: "Compensation per employee hour", f: String.raw`W^{h}_{it} = \frac{D1_{it}}{H^{L}_{it}}`,
      x: "Compensation of employees divided by the hours worked by employees. It is the national-accounts counterpart of hourly labor cost." },
    { t: "Unit labor cost", f: String.raw`\mathit{ULC}_{it} = \frac{W_{it}}{P_{it}} = \frac{D1_{it}/L_{it}}{\mathit{GVA}^{\,real}_{it}/E_{it}}, \qquad \mathit{ULC}^{h}_{it} = \frac{W^{h}_{it}}{P^{h}_{it}}`,
      x: "The labor cost of producing one unit of real output: what a worker costs (W) divided by what a worker produces (P). The hourly version uses compensation and output per hour.",
      read: "ULC rises when compensation grows faster than productivity, and falls when productivity grows faster. Because the denominator is measured at national prices, ULC levels are not comparable across countries; the atlas therefore compares ULC through indices and growth rates." },
    { t: "Decomposition of the change in unit labor cost", f: String.raw`\Delta \ln \mathit{ULC}_{i} = \Delta \ln W_{i} - \Delta \ln P_{i}`,
      x: "Taking logarithms turns the ratio into a difference, so the change in ULC splits exactly into the change in compensation per employee and the change in productivity. No interaction term is left over.",
      read: "If compensation rose by 60 log points and productivity by 25, ULC rose by 35 log points. In the charts, productivity enters with a negative sign: productivity growth lowers ULC." },
    { t: "Labor cost per EUR 100 of value added", f: String.raw`\kappa_{it} = 100 \cdot \frac{\mathit{LC}^{h}_{it}}{V^{h}_{it}}, \qquad V^{h}_{it} = \frac{\mathit{GVA}^{\,nom}_{it}}{H_{it}}`,
      x: "Hourly labor cost from the labor cost survey divided by nominal value added per hour worked from the national accounts. Unlike ULC, both terms are in current euros, so the level can be compared across countries.",
      read: "A value of 70 means that €70 of labor cost is incurred for every €100 of value added. Because the numerator and denominator come from different statistical sources, the measure is indicative and can exceed 100." },
    { t: "Components of hourly labor cost", f: String.raw`\begin{aligned} \text{employer costs} &= \mathit{LC}^{h}\, s^{nw} \\ \text{employee taxes and contributions} &= \mathit{LC}^{h} \max\!\big(0,\ \tau - s^{nw}\big) \\ \text{net earnings} &= \mathit{LC}^{h} - \text{employer costs} - \text{employee taxes and contributions} \end{aligned}`,
      x: "Hourly labor cost is split with two published shares: the non-wage share s (employer social contributions and other non-wage costs, labor cost survey) and the tax wedge τ (income tax plus employee and employer contributions as a share of labor cost, for a single low-wage earner). The part of the tax wedge not borne by the employer is attributed to the employee.",
      read: "The split is an approximation: the tax wedge refers to one household type and wage level, while hourly labor cost is an average across all employees." },
    { t: "Break-even change in hourly labor cost", f: String.raw`c^{*}_{A} = \frac{\mathit{LC}^{h}_{B} / V^{h}_{B}}{\mathit{LC}^{h}_{A} / V^{h}_{A}} - 1`,
      x: "The percentage change in country A's hourly labor cost at which its labor cost per €100 of value added would equal country B's, holding value added per hour in both countries constant.",
      read: "A value of +25% means that A's hourly labor cost could rise by a quarter before its labor cost per unit of value added reached B's level." },
    { t: "Employer contribution rate", f: String.raw`c_{it} = \frac{D1_{it} - D11_{it}}{D11_{it}}`,
      x: "Employer social contributions (compensation D1 minus wages and salaries D11) relative to gross wages. It shows how much an employer pays on top of the gross wage." },
  ]},
  { group: "Distribution and working time", items: [
    { t: "Labor share", f: String.raw`\mathit{LS}_{it} = \frac{D1_{it}}{\mathit{GVA}^{\,nom}_{it}}, \qquad \mathit{LS}^{adj}_{it} = \frac{(D1_{it}/L_{it})\, E_{it}}{\mathit{GVA}^{\,nom}_{it}}`,
      x: "The share of value added paid to employees. The unadjusted share counts only compensation of employees. The adjusted share imputes to each self-employed person the average compensation of an employee, so that labor income of the self-employed is included.",
      read: "The adjusted labor share equals real unit labor cost: nominal ULC divided by the price deflator of value added. The adjusted share is more appropriate where self-employment is large, as in agriculture." },
    { t: "Profit share", f: String.raw`\Pi_{it} = \frac{\mathit{GVA}^{\,nom}_{it} - D1_{it} - D29X39_{it}}{\mathit{GVA}^{\,nom}_{it}}`,
      x: "Gross operating surplus and mixed income as a share of value added: what remains after compensation of employees and net taxes on production. Mixed income includes the income of the self-employed, so the profit share and the unadjusted labor share sum to slightly less than one." },
    { t: "Annual hours per worker", f: String.raw`h_{it} = \frac{H_{it}}{E_{it}}`,
      x: "Total hours worked in the national accounts divided by persons employed. It differs from statutory working time because it reflects part-time work, overtime, holidays and absence." },
  ]},
  { group: "Indices, growth and comparisons", items: [
    { t: "Index", f: String.raw`I_{it} = 100 \cdot \frac{X_{it}}{X_{i,t_0}}`,
      x: "Each series is divided by its own value in the base year and multiplied by 100. Indices compare changes over time across countries whose levels are not directly comparable." },
    { t: "Log change and average annual growth", f: String.raw`\Delta \ln X_i = 100\,\big(\ln X_{i,t_1} - \ln X_{i,t_0}\big), \qquad g_i = \frac{\Delta \ln X_i}{t_1 - t_0}`,
      x: "Changes are measured as differences in natural logarithms, multiplied by 100 (log points). Log changes add up over time and decompose exactly, which is why they are used for the ULC decomposition. For small changes they are close to percentage changes; for large changes they are smaller (a 50% increase equals 40.5 log points).",
      read: "g is the average annual growth rate in percent over the period." },
    { t: "Relative productivity", f: String.raw`\rho_{is} = \frac{P_{is}}{P_{i,\text{total}}} \qquad\text{or}\qquad \rho_{is} = \frac{P_{is}}{P_{\text{EU27},s}}`,
      x: "Productivity of sector s relative to the whole economy of the same country, or relative to the same sector in the EU27. Used to color the economy tree.",
      read: "A value above 1 means the sector produces more per worker than the comparison." },
  ]},
  { group: "Growth accounting", items: [
    { t: "Decomposition of labor productivity growth", f: String.raw`\Delta \ln \frac{Y_{it}}{L_{it}} = \bar\alpha_{it}\, \Delta \ln \frac{K_{it}}{L_{it}} + (1-\bar\alpha_{it})\, \Delta \ln hc_{it} + \Delta \ln A_{it}`,
      x: "The growth of output per unit of labor is split into three parts. Capital deepening is the growth of capital per unit of labor, weighted by the capital share. The education term is the growth of the human capital index, weighted by the labor share. Total factor productivity (TFP) is what remains. The page uses real GDP and capital services at constant national prices, persons engaged, average hours worked and the human capital index, all from the Penn World Table 11.0. With hours worked, education separated and country-specific capital shares, the result reproduces the table's own TFP index.",
      read: "If output per hour grew by 3% a year, capital deepening contributed 1 percentage point and education 0.5, TFP grew by 1.5% a year. When education is not separated, its contribution is part of TFP." },
    { t: "Capital share", f: String.raw`\bar\alpha_{it} = 1 - \tfrac{1}{2}\big(\mathit{labsh}_{it} + \mathit{labsh}_{i,t-1}\big) \qquad \text{or} \qquad \bar\alpha = \tfrac{1}{3}`,
      x: "The weight on capital is one minus the labor share of GDP, averaged over two consecutive years (a Törnqvist weight). The labor share comes from the Penn World Table and includes an estimate of the labor income of the self-employed. The fixed share of one third is a common textbook value and is offered as a sensitivity check.",
      read: "A higher capital share gives more weight to capital deepening and leaves less for TFP." },
    { t: "Labor input", f: String.raw`L_{it} = \mathit{emp}_{it} \cdot \mathit{avh}_{it} \qquad \text{or} \qquad L_{it} = \mathit{emp}_{it}`,
      x: "Labor is measured either as total hours worked (persons engaged times average annual hours) or as persons engaged. Hours are missing for a few economies, such as Montenegro, which then appear only in the per-person view." },
    { t: "Period averages and the TFP index", f: String.raw`\overline{\Delta \ln A}_{i} = \frac{1}{t_1 - t_0} \sum_{t=t_0+1}^{t_1} \Delta \ln A_{it}, \qquad I^{A}_{it} = 100 \cdot \exp\!\Big(\sum_{\tau = t_0+1}^{t} \Delta \ln A_{i\tau}\Big)`,
      x: "Annual contributions are averaged over the selected period, so the parts add up exactly to average growth. The TFP index cumulates the annual TFP terms from the base year." },
  ]},
  { group: "Convergence", items: [
    { t: "σ-convergence", f: String.raw`\sigma_t = \sqrt{\frac{1}{N-1}\sum_{i=1}^{N}\big(\ln X_{it} - \overline{\ln X}_{t}\big)^{2}}`,
      x: "The standard deviation of the logarithm of a variable (for example productivity) across N economies in year t. It is computed on a balanced panel, so that the set of countries does not change over time.",
      read: "A declining σ means that economies are becoming more similar: σ-convergence." },
    { t: "β-convergence", f: String.raw`g_i = \alpha + \beta \ln X_{i,t_0} + \varepsilon_i`,
      x: "Average annual growth over the period is regressed on the logarithm of the initial level.",
      read: "A negative β means that economies starting from a lower level grew faster: β-convergence. β-convergence is necessary but not sufficient for σ-convergence, because shocks can widen dispersion even when poorer economies grow faster on average." },
  ]},
  { group: "Convergence calculator", items: [
    { t: "Years until a target share of the EU level", f: String.raw`\ln r_{it} = a_i + g_i\, t + e_{it}, \qquad T_i = \frac{\ln(\bar r / r_{i,t_1})}{g_i}, \qquad r_{it} = 100 \cdot \frac{x_{it}}{x_{\mathit{EU},t}}`,
      x: "The level r of a country relative to the EU27 is regressed on time over the last 5, 10 or 15 years. The slope g is the trend, in log points per year. T is the number of years until the target r̄ is reached if the trend continues. GDP per capita in purchasing power standards comes from Eurostat (prc_ppp_ind). Output per hour uses output-side real GDP at chained PPPs from the Penn World Table, divided by hours worked, relative to the EU27 total.",
      read: "A country at 50% of the EU level whose gap closes by 2 log points a year reaches 75% after ln(75/50)/0.02 ≈ 20 years. The calculation is a projection of a trend, not a forecast: convergence usually slows as the gap narrows." },
  ]},
  { group: "Regression analysis", items: [
    { t: "Ordinary least squares", f: String.raw`y_i = \alpha + \beta x_i + \varepsilon_i, \qquad \hat{\beta} = (X'X)^{-1} X'y`,
      x: "The bivariate models in the Analysis tab are estimated by ordinary least squares across economies. X contains a constant and the explanatory variable; y is the dependent variable.",
      read: "β is the expected difference in y between two economies whose x differs by one unit. It describes an association, not a causal effect." },
    { t: "Heteroskedasticity-robust standard errors (HC1)", f: String.raw`\widehat{V}_{HC1}(\hat\beta) = \frac{n}{n-k}\,(X'X)^{-1}\Big(\sum_{i=1}^{n} \hat{e}_i^{2}\, x_i x_i'\Big)(X'X)^{-1}`,
      x: "The variance of the estimates allows the error variance to differ across economies. The factor n/(n−k) is a small-sample correction (k is the number of estimated coefficients). These are the default robust standard errors in Stata (robust) and in R (sandwich, type HC1)." },
    { t: "Panel model with economy fixed effects", f: String.raw`\Delta \ln W_{it} = \alpha_i + \beta\, \Delta \ln P_{it} + \varepsilon_{it}`,
      x: "Annual compensation growth is regressed on annual productivity growth for all economy-years. The economy-specific constant α absorbs persistent differences between countries, for example in average inflation or wage-setting institutions.",
      read: "β measures how much compensation growth moves with productivity growth within the same economy over time." },
    { t: "Within estimator", f: String.raw`\hat\beta_{FE} = \frac{\sum_{i}\sum_{t} \tilde{x}_{it}\tilde{y}_{it}}{\sum_{i}\sum_{t} \tilde{x}_{it}^{2}}, \qquad \tilde{z}_{it} = z_{it} - \bar{z}_{i}`,
      x: "The fixed effects are removed by subtracting each economy's own mean from every variable; the slope is then estimated on the demeaned data." },
    { t: "Cluster-robust standard errors", f: String.raw`\widehat{V}_{CL}(\hat\beta_{FE}) = \frac{G}{G-1}\cdot\frac{N-1}{N-K}\cdot \frac{\sum_{g=1}^{G}\big(\sum_{t}\tilde{x}_{gt}\hat{e}_{gt}\big)^{2}}{\big(\sum_{g}\sum_{t}\tilde{x}_{gt}^{2}\big)^{2}}, \qquad K = G + 1`,
      x: "Observations from the same economy are allowed to be correlated over time. Residuals are summed within each of the G economies before squaring. The factors in front are the usual small-sample corrections; K counts the slope and the G fixed effects." },
    { t: "Tests and confidence intervals", f: String.raw`t = \frac{\hat\beta}{\widehat{\mathrm{se}}(\hat\beta)} \sim t_{\nu}, \qquad \hat\beta \pm t_{\nu,\,0.975}\,\widehat{\mathrm{se}}(\hat\beta)`,
      x: "The t statistic tests whether the coefficient differs from zero. p-values and 95% confidence intervals use the t distribution with ν = n − k degrees of freedom for OLS and ν = G − 1 for clustered standard errors.",
      read: "Stars in the regression tables mark p < 0.1 (*), p < 0.05 (**) and p < 0.01 (***)." },
  ]},
];

export function methods(root) {
  const tab = S.methodsTab || "data";
  root.append(pageHeader("Methods", tab === "formulas" ? "Formulas and definitions" : tab === "limits" ? "Limitations" : "Sources, definitions and coverage",
    tab === "formulas" ? "How each indicator, decomposition and regression on the site is calculated, and what the result means."
    : `All data come from Eurostat and ILOSTAT. They are downloaded automatically once a month, and each download is saved, so earlier versions can be traced. ${D.meta.built ? `The last update was on ${new Date(D.meta.built).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.` : ""}`));
  root.append(h("div", { class: "view-controls" },
    seg(null, [{ value: "data", label: "Data and coverage" }, { value: "formulas", label: "Formulas" }, { value: "limits", label: "Limitations" }], tab, v => set({ methodsTab: v }))));
  if (tab === "formulas") return formulasTab(root);
  if (tab === "limits") return limitsTab(root);
  const cov = [];
  for (const c of D.countries) for (const M of METRICS) { const l = latest(M.key, c.geo, "TOTAL"); if (l) cov.push({ geo: c.geo, name: c.name, key: M.key, label: M.label, y: l.year }); }
  const f1 = figure({ title: "Coverage by economy and indicator", span: 12, sub: "Each cell shows the latest year with data.", text: "Data refer to the whole economy. Darker cells are more recent, and empty cells are not reported.",
    csv: () => cov.map(d => ({ country: d.name, indicator: d.label, latest_year: d.y })) });
  root.append(grid(f1.el));
  const width = widthOf(f1.body), m = { l: 340, t: 46, r: 6 }, chh = 21;
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
    h("p", { html: `Tables: <a href="data/pwt.csv">pwt.csv</a>, <a href="data/sector.csv">sector.csv</a>, <a href="data/sector_full.csv">sector_full.csv</a>, <a href="data/country.csv">country.csv</a>, <a href="data/industry.csv">industry.csv</a>, <a href="data/nace.csv">nace.csv</a>.` })));
}

function limitsTab(root) {
  root.append(h("section", { class: "prose" },
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
      h("li", {}, "Growth accounting. TFP is a residual, so it also contains measurement error, changes in capacity use and anything else that capital and labor do not capture. Annual TFP figures therefore move with the business cycle and are best read as averages over several years."),
      h("li", {}, "Growth accounting data. The Penn World Table measures output as GDP at constant national prices, while the rest of the site uses gross value added from Eurostat, and the table ends in 2023. Productivity growth on the growth accounting page therefore differs somewhat from the figures on other pages. The human capital index is based on years of schooling and assumed returns to education, so it measures the quantity of schooling but not its quality."),
      h("li", {}, "Scope. Statutory sick-leave rules and legal working time from the project research are not yet included.")),
    h("h2", {}, "Notes"),
    h("ul", {},
      h("li", {}, "Log changes are reported in log points (100 × Δln). For small changes they approximate percentage changes."),
      h("li", {}, "Structural business statistics measure value added at factor cost for the business economy. The source changes from sbs_na_ind_r2 to sbs_ovw_act in 2021."))));
}

function formulasTab(root) {
  const nav = h("nav", { class: "f-toc" }, h("p", { class: "field-label" }, "Contents"),
    FORMULAS.map((g, i) => h("a", { href: "#", onclick: e => { e.preventDefault(); document.getElementById(`fg-${i}`).scrollIntoView({ behavior: "smooth", block: "start" }); } }, g.group)));
  const body = h("div", { class: "f-body" },
    h("div", { class: "f-notation" }, h("h2", {}, "Notation"),
      h("p", {}, "Subscripts: economy ", tex("i", false), ", year ", tex("t", false), ", sector ", tex("s", false), "; ", tex("t_0", false), " and ", tex("t_1", false), " are the first and last year of the period."),
      h("dl", { class: "notation" }, [
        [String.raw`\mathit{GVA}^{\,real},\ \mathit{GVA}^{\,nom}`, "Gross value added in chain-linked volumes (2020 euros) and at current prices"],
        ["D1", "Compensation of employees: gross wages and salaries plus employer social contributions"],
        ["D11", "Gross wages and salaries"],
        ["D29X39", "Other taxes on production less other subsidies on production"],
        [String.raw`E,\ L`, "Persons employed (employees and self-employed) and employees"],
        [String.raw`H,\ H^{L}`, "Hours worked by persons employed and by employees"],
        [String.raw`\mathit{LC}^{h}`, "Hourly labor cost per hour actually worked (labor cost survey)"],
        [String.raw`s^{nw},\ \tau`, "Non-wage share of labor cost and tax wedge on labor"],
      ].map(([sym, d]) => [h("dt", {}, tex(sym, false)), h("dd", {}, d)]).flat())),
    FORMULAS.map((g, i) => h("section", { class: "f-group", id: `fg-${i}` }, h("h2", {}, g.group),
      g.items.map(it => h("article", { class: "f-item" },
        h("h3", {}, it.t),
        h("div", { class: "f-eq" }, tex(it.f)),
        h("p", {}, it.x),
        it.read ? h("p", { class: "f-read" }, h("b", {}, "Reading. "), it.read) : null)))));
  root.append(h("div", { class: "f-layout" }, nav, body));
}

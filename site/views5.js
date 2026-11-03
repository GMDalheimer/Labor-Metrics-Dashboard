// View: growth accounting (whole economy, Penn World Table 11.0)
import {
  d3, S, D, writeHash, endYear, cname, cssVar, countryColor, h, showTip, hideTip, ttRow,
  pageHeader, figure, grid, seg, kpiRow, svgEl, widthOf, axisLeft, axisBottom, lineChart, legend,
  comparisonSeries, tex, disclosure, svgFlag, hasFlag,
} from "./core.js";

const rerender = () => dispatchEvent(new Event("lca:render"));
const set = patch => { Object.assign(S, patch); writeHash(); rerender(); };
const pp = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
export async function loadPWT() {
  if (D.pwt) return D.pwt;
  const rows = await d3.csv("data/pwt.csv", d3.autoType).catch(() => []);
  const by = d3.group(rows, r => r.geo);
  const idx = new Map([...by].map(([g, rs]) => [g, new Map(rs.map(r => [r.year, r]))]));
  D.pwt = { rows, idx, years: d3.extent(rows, r => r.year), cols: rows.columns || [] };
  return D.pwt;
}

// Annual growth-accounting terms for one economy, in log points (100 × Δln).
//   Δln(Y/L) = ᾱ Δln(K/L) + (1 − ᾱ) Δln hc + Δln A
// L is hours worked (emp × avh) or persons engaged (emp); ᾱ is the two-year average capital share
// (1 − labsh) or a fixed one third; the education term is included only when switched on.
export function gaTerms(geo, { basis = S.gaBasis, edu = S.gaEdu, alpha = S.gaAlpha } = {}) {
  const m = D.pwt?.idx.get(geo);
  if (!m) return [];
  const L = r => basis === "hour" ? (r.emp > 0 && r.avh > 0 ? r.emp * r.avh : null) : (r.emp > 0 ? r.emp : null);
  const out = [];
  for (const [year, r] of m) {
    const p = m.get(year - 1);
    if (!p) continue;
    const l1 = L(r), l0 = L(p);
    // Capital services (rkna) where available; the capital stock (rnna) otherwise
    const kc = r.rkna > 0 && p.rkna > 0 ? "rkna" : r.rnna > 0 && p.rnna > 0 ? "rnna" : null;
    if (!(l1 && l0 && r.rgdpna > 0 && p.rgdpna > 0 && kc)) continue;
    const a = alpha === "fixed" ? 1 / 3 : (r.labsh > 0 && p.labsh > 0 ? 1 - (r.labsh + p.labsh) / 2 : null);
    if (a == null) continue;
    const dy = 100 * Math.log((r.rgdpna / l1) / (p.rgdpna / l0));
    const dk = 100 * Math.log((r[kc] / l1) / (p[kc] / l0));
    const dh = r.hc > 0 && p.hc > 0 ? 100 * Math.log(r.hc / p.hc) : null;
    if (edu && dh == null) continue;
    const cap = a * dk, ed = edu ? (1 - a) * dh : 0;
    out.push({ year, dy, cap, edu: ed, tfp: dy - cap - ed, alpha: a, stock: kc === "rnna" });
  }
  return out.sort((x, y) => x.year - y.year);
}

// Average annual contributions over [b, e]; requires every year in the period
export function gaPeriod(geo, b, e, opts) {
  const t = gaTerms(geo, opts).filter(d => d.year > b && d.year <= e);
  if (t.length !== e - b || e <= b) return null;
  const n = e - b, s = k => d3.sum(t, d => d[k]) / n;
  return { geo, name: cname(geo), dy: s("dy"), cap: s("cap"), edu: s("edu"), tfp: s("tfp"), alpha: d3.mean(t, d => d.alpha), n, stock: t.some(d => d.stock) };
}

// TFP index, base year = 100
const tfpIndex = (geo, b, opts) => {
  const t = gaTerms(geo, opts).filter(d => d.year > b);
  if (!t.length || t[0].year !== b + 1) return [];
  let cum = 0; const out = [{ year: b, v: 100 }];
  for (const d of t) { if (d.year !== out[out.length - 1].year + 1) break; cum += d.tfp; out.push({ year: d.year, v: 100 * Math.exp(cum / 100) }); }
  return out;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export async function growth(root) {
  const P = await loadPWT();
  root.append(pageHeader("Growth accounting", "Sources of productivity growth",
    `Growth in output ${S.gaBasis === "hour" ? "per hour" : "per person"} can come from more capital ${S.gaBasis === "hour" ? "per hour worked" : "per worker"}, from a better-educated workforce, or from using capital and labor more efficiently. ` +
    "The last part is total factor productivity (TFP), measured as the growth that the other inputs do not explain. The data are from the Penn World Table and cover the whole economy."));
  if (!P.rows.length) { root.append(h("p", { class: "empty" }, "The Penn World Table extract is not available in this build.")); return; }

  root.append(disclosure("Definition",
    tex(String.raw`\Delta \ln \frac{Y_{it}}{L_{it}} \;=\; \underbrace{\bar\alpha_{it}\, \Delta \ln \frac{K_{it}}{L_{it}}}_{\text{capital deepening}} \;+\; \underbrace{(1-\bar\alpha_{it})\, \Delta \ln hc_{it}}_{\text{education (optional)}} \;+\; \underbrace{\Delta \ln A_{it}}_{\text{TFP}}`),
    h("p", {}, "Y is real GDP at constant national prices, K capital services (the flow of services from the capital stock) at constant national prices, L hours worked or persons engaged, and hc an index of human capital based on years of schooling. The capital share ᾱ is the average of the two years. TFP is the residual: the part of growth that capital per worker and, if included, education do not account for.")));

  const maxY = P.years[1];
  const b = S.base, e = Math.min(endYear(), maxY);
  const opts = { basis: S.gaBasis, edu: S.gaEdu, alpha: S.gaAlpha };

  root.append(h("div", { class: "view-controls" },
    seg("Labor input", [{ value: "hour", label: "Per hour worked" }, { value: "worker", label: "Per person engaged" }], S.gaBasis, v => set({ gaBasis: v })),
    seg("Education", [{ value: false, label: "Not separated" }, { value: true, label: "Separated from TFP" }], S.gaEdu, v => set({ gaEdu: v === true || v === "true" })),
    seg("Capital share", [{ value: "country", label: "Country-specific" }, { value: "fixed", label: "Fixed at one third" }], S.gaAlpha, v => set({ gaAlpha: v }))));
  if (e < endYear()) root.append(h("p", { class: "view-note" }, `The Penn World Table ends in ${maxY}, so the period on this page ends in ${e}.`));

  // Key figures
  const f = gaPeriod(S.focus, b, e, opts);
  const all = D.countries.map(c => gaPeriod(c.geo, b, e, opts)).filter(Boolean);
  const byTfp = [...all].sort((x, y) => y.tfp - x.tfp);
  const rk = byTfp.findIndex(d => d.geo === S.focus);
  const unit = S.gaBasis === "hour" ? "output per hour" : "output per person";
  root.append(kpiRow(f ? [
    { label: `Growth of ${unit}, ${b}–${e}`, value: pp(f.dy) + "%", foot: "The figure is an average annual log change." },
    { label: "Capital deepening", value: pp(f.cap), foot: "The contribution is in percentage points per year." },
    ...(S.gaEdu ? [{ label: "Education", value: pp(f.edu), foot: "The contribution is in percentage points per year." }] : []),
    { label: "TFP", value: pp(f.tfp), foot: "The contribution is in percentage points per year." },
    { label: "Capital share", value: f.alpha.toFixed(2), foot: S.gaAlpha === "fixed" ? "The share is fixed at one third." : "The share is the average over the period." },
    { label: "Rank by TFP growth", value: rk >= 0 ? `${rk + 1} / ${byTfp.length}` : "n/a", foot: "Rank 1 is the fastest growth." },
  ] : [{ label: cname(S.focus), value: "n/a", foot: missingReason(S.focus, b, e) }]));

  // Figure 1: decomposition across economies
  const sorted = [...all].sort((x, y) => y.dy - x.dy);
  const comps = [{ k: "cap", label: "Capital deepening", color: cssVar("--s1") }, ...(S.gaEdu ? [{ k: "edu", label: "Education", color: cssVar("--s3") }] : []), { k: "tfp", label: "TFP", color: cssVar("--s2") }];
  const check = pwtCheck(b, e);
  const f1 = figure({ title: `Sources of growth in ${unit}, ${b}–${e}`, span: 7,
    sub: "Average annual contributions are shown in percentage points.",
    text: "The bars add up to the dot, which is the average annual growth of " + unit + ". Economies are sorted by that growth.",
    note: `The data are from the Penn World Table 11.0 (Feenstra, Inklaar and Timmer), and the decomposition is calculated on this site.${stockNote(all)} ${check}`,
    method: [String.raw`$\overline{\Delta \ln y}_{i} = \frac{1}{t_1 - t_0} \sum_{t = t_0 + 1}^{t_1} \Big[\bar\alpha_{it} \Delta \ln k_{it} + (1-\bar\alpha_{it}) \Delta \ln hc_{it} + \Delta \ln A_{it}\Big]`,
      "Here y and k are output and capital per unit of labor input. Annual contributions are averaged over the period, so the components add up exactly to average growth. Only economies with data for every year of the period are shown."],
    csv: () => sorted.map(d => ({ country: d.name, growth: d.dy, capital_deepening: d.cap, education: S.gaEdu ? d.edu : "", tfp: d.tfp, capital_share: d.alpha })) });

  // Figure 2: annual decomposition, focus
  const ann = gaTerms(S.focus, opts).filter(d => d.year > b && d.year <= e);
  const f2 = figure({ title: `Annual sources of growth, ${cname(S.focus)}`, span: 5,
    sub: "Contributions are shown in percentage points.",
    text: "The stacked bars add up to the dot, which is the growth of " + unit + " in that year.",
    note: "TFP is the residual, so it also absorbs measurement error and changes in capacity use, which is why it moves with the business cycle.",
    csv: () => ann.map(d => ({ year: d.year, growth: d.dy, capital_deepening: d.cap, education: S.gaEdu ? d.edu : "", tfp: d.tfp })) });
  root.append(grid(f1.el, f2.el));
  drawStack(f1.body, sorted, comps);
  f1.body.append(legend([...comps.map(c => ({ label: c.label, color: c.color })), { label: `Growth of ${unit}`, color: cssVar("--text"), shape: "dot" }]));
  drawAnnual(f2.body, ann, comps);
  if (ann.length) f2.body.append(legend([...comps.map(c => ({ label: c.label, color: c.color })), { label: "Total", color: cssVar("--text"), shape: "dot" }]));

  // Figure 3: TFP index
  const idx = comparisonSeries(g => tfpIndex(g, b, opts).filter(d => d.year <= e), { includeEU: false });
  const f3 = figure({ title: "TFP index", span: 7,
    sub: `The index is set to 100 in ${b}.`,
    text: "The lines show cumulative TFP growth for the selected economies and any countries or groups added above. There is no EU27 line because the Penn World Table covers countries only.",
    csv: () => idx.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, index: d.v }))) });

  // Figure 4: TFP level relative to the US (PWT's own measure)
  const lvYear = d3.max(P.rows.filter(r => r.ctfp != null), r => r.year);
  const lv = D.countries.map(c => ({ geo: c.geo, name: c.name, v: P.idx.get(c.geo)?.get(lvYear)?.ctfp })).filter(d => d.v != null).sort((x, y) => y.v - x.v);
  const f4 = figure({ title: `TFP level relative to the United States, ${lvYear}`, span: 5,
    sub: "The United States is set to 1.",
    text: "Levels are the Penn World Table's own estimates at current purchasing power parities. They include education, so they are not directly comparable with the growth figures on the left when education is not separated.",
    csv: () => lv.map(d => ({ country: d.name, year: lvYear, tfp_level_us_1: d.v })) });
  root.append(grid(f3.el, f4.el));
  if (idx.length) lineChart(f3.body, idx, { height: 360, yFormat: d3.format(".0f"), indexLine: true });
  else f3.body.append(h("p", { class: "empty" }, "No data are available for this selection."));
  drawLevels(f4.body, lv);
}

// Why an economy has no decomposition on the current settings
function missingReason(geo, b, e) {
  const m = D.pwt.idx.get(geo);
  if (!m) return `The Penn World Table does not cover ${cname(geo)}.`;
  const yrs = d3.range(b, e + 1).map(y => m.get(y)).filter(Boolean);
  const lacks = k => yrs.length < e - b + 1 || yrs.some(r => !(r[k] > 0));
  const miss = [];
  if (S.gaBasis === "hour" && lacks("avh")) miss.push("hours worked");
  if (S.gaEdu && lacks("hc")) miss.push("the human capital index");
  if (S.gaAlpha === "country" && lacks("labsh")) miss.push("the labor share");
  if (lacks("rgdpna") || lacks("emp") || (lacks("rkna") && lacks("rnna"))) miss.push("output, employment or capital for every year");
  return miss.length ? `The Penn World Table has no ${miss.join(" or ")} for ${cname(geo)} in ${b}–${e}. Other settings above may include it.` : `The Penn World Table has no complete data for ${cname(geo)} in ${b}–${e}.`;
}
const stockNote = rows => {
  const s = rows.filter(r => r.stock).map(r => r.name);
  return s.length ? ` Capital services are not available for ${s.join(", ")}, so the capital stock is used instead.` : "";
};

// Agreement with PWT's published TFP (rtfpna) on the comparable basis: hours worked,
// education separated, country-specific capital share (PWT uses emp × avh × hc and capital services)
function pwtCheck(b, e) {
  if (!D.pwt.cols.includes("rtfpna")) return "";
  const diffs = [];
  for (const c of D.countries) {
    const ours = gaPeriod(c.geo, b, e, { basis: "hour", edu: true, alpha: "country" });
    const m = D.pwt.idx.get(c.geo), r0 = m?.get(b)?.rtfpna, r1 = m?.get(e)?.rtfpna;
    if (ours && r0 > 0 && r1 > 0) diffs.push(Math.abs(ours.tfp - 100 * Math.log(r1 / r0) / (e - b)));
  }
  if (!diffs.length) return "";
  return `As a check, with hours worked, education separated and country-specific capital shares, TFP growth computed here reproduces the Penn World Table's published TFP index (rtfpna): the largest difference across ${diffs.length} economies is ${d3.max(diffs).toFixed(3)} percentage points per year.`;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function drawStack(host, rows, comps) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 19, m = { t: 8, r: 16, b: 28, l: 172 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const stacks = rows.map(r => {
    let pos = 0, neg = 0;
    const segs = comps.map(c => { const v = r[c.k]; const x0 = v >= 0 ? pos : neg + v; if (v >= 0) pos += v; else neg += v; return { ...c, v, x0, x1: x0 + Math.abs(v) }; });
    return { r, segs, lo: neg, hi: pos };
  });
  const x = d3.scaleLinear([Math.min(0, d3.min(stacks, s => s.lo), d3.min(rows, r => r.dy)), Math.max(0, d3.max(stacks, s => s.hi), d3.max(rows, r => r.dy))], [m.l, width - m.r]).nice();
  const y = d3.scaleBand(rows.map(r => r.geo), [m.t, height - m.b]).padding(.18);
  svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", m.t).attr("y2", height - m.b);
  axisBottom(svg, x, height - m.b, d3.format(".1f"), 6);
  svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", height - m.b);
  const g = svg.selectAll("g.r").data(stacks).join("g").attr("class", "r").attr("transform", s => `translate(0,${y(s.r.geo)})`)
    .on("mousemove", (ev, s) => showTip(ev, `<div class="tt-title">${s.r.name}</div>${s.segs.map(c => ttRow(c.label, pp(c.v))).join("")}${ttRow("Growth", pp(s.r.dy))}`))
    .on("mouseleave", hideTip);
  g.filter(s => s.r.geo === S.focus).append("rect").attr("class", "row-hl").attr("x", 0).attr("y", -1).attr("width", width).attr("height", y.bandwidth() + 2);
  g.append("text").attr("class", s => s.r.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 30).attr("y", y.bandwidth() / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(s => s.r.name);
  g.each(function (s) { svgFlag(d3.select(this), s.r.geo, m.l - 24, y.bandwidth() / 2, 12); });
  g.selectAll("rect.seg").data(s => s.segs).join("rect").attr("class", "seg").attr("y", 0).attr("height", y.bandwidth()).attr("fill", c => c.color)
    .attr("x", x(0)).attr("width", 0).transition().duration(700).attr("x", c => x(c.x0)).attr("width", c => Math.max(0, x(c.x1) - x(c.x0)));
  g.append("circle").attr("cx", s => x(s.r.dy)).attr("cy", y.bandwidth() / 2).attr("r", 3.5).attr("fill", cssVar("--text")).attr("stroke", cssVar("--bg")).attr("stroke-width", 1.5);
}

function drawAnnual(host, ann, comps) {
  if (!ann.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), height = 380, m = { t: 10, r: 10, b: 28, l: 44 };
  const svg = svgEl(host, width, height);
  const x = d3.scaleBand(ann.map(d => d.year), [m.l, width - m.r]).padding(.25);
  const stacks = ann.map(d => {
    let pos = 0, neg = 0;
    return { d, segs: comps.map(c => { const v = d[c.k]; const y0 = v >= 0 ? pos : neg + v; if (v >= 0) pos += v; else neg += v; return { ...c, v, y0, y1: y0 + Math.abs(v) }; }), lo: neg, hi: pos };
  });
  const y = d3.scaleLinear([Math.min(0, d3.min(stacks, s => s.lo), d3.min(ann, d => d.dy)), Math.max(0, d3.max(stacks, s => s.hi), d3.max(ann, d => d.dy))], [height - m.b, m.t]).nice();
  axisLeft(svg, y, m.l, d3.format(".0f"));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => i % Math.ceil(ann.length / 8) === 0)).tickSizeOuter(0));
  svg.append("line").attr("class", "zero-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(0)).attr("y2", y(0));
  const g = svg.selectAll("g.yr").data(stacks).join("g").attr("class", "yr")
    .on("mousemove", (ev, s) => showTip(ev, `<div class="tt-title">${s.d.year}</div>${s.segs.map(c => ttRow(c.label, pp(c.v))).join("")}${ttRow("Total", pp(s.d.dy))}`))
    .on("mouseleave", hideTip);
  g.selectAll("rect").data(s => s.segs.map(c => ({ ...c, year: s.d.year }))).join("rect")
    .attr("x", c => x(c.year)).attr("width", x.bandwidth()).attr("fill", c => c.color)
    .attr("y", y(0)).attr("height", 0).transition().duration(700).attr("y", c => y(c.y1)).attr("height", c => Math.max(0, y(c.y0) - y(c.y1)));
  g.append("circle").attr("cx", s => x(s.d.year) + x.bandwidth() / 2).attr("cy", s => y(s.d.dy)).attr("r", 3.5)
    .attr("fill", cssVar("--text")).attr("stroke", cssVar("--bg")).attr("stroke-width", 1.5);
}

function drawLevels(host, rows) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 18, m = { l: 172, r: 56, t: 16, b: 4 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, Math.max(1, d3.max(rows, d => d.v))], [m.l, width - m.r]);
  rows.forEach((d, i) => {
    const y = m.t + i * rowH;
    const g = svg.append("g").on("mousemove", ev => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow("TFP level (US = 1)", d.v.toFixed(2))}`)).on("mouseleave", hideTip);
    svgFlag(g, d.geo, m.l - 24, y + (rowH - 6) / 2, 12);
    g.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 30).attr("y", y + (rowH - 6) / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(d.name);
    g.append("rect").attr("x", m.l).attr("y", y).attr("height", rowH - 6).attr("fill", d.geo === S.focus || S.comps.includes(d.geo) ? countryColor(d.geo) : cssVar("--context"))
      .attr("width", 0).transition().duration(700).delay(i * 10).attr("width", Math.max(0, x(d.v) - m.l));
    g.append("text").attr("class", "label").attr("x", x(d.v) + 6).attr("y", y + (rowH - 6) / 2).attr("dominant-baseline", "middle").text(d.v.toFixed(2));
  });
  svg.append("line").attr("class", "eu-line").attr("x1", x(1)).attr("x2", x(1)).attr("y1", 10).attr("y2", height);
  svg.append("text").attr("class", "annot").attr("x", x(1)).attr("y", 8).attr("text-anchor", "middle").text("United States = 1");
}

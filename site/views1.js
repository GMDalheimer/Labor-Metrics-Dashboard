// Views: overview (map), unit labor costs, country profile, comparison, cost of an hour
import { METRICS, METRIC, CATEGORIES, PROFILE_METRICS } from "./metrics.js";
import {
  d3, EU, S, D, writeHash, loadWorld, isSector, val, series, latest, snapshot, coverage, rankOf, endYear, growth,
  fmt, pct, pp, cname, sectorLabel, cssVar, countryColor, seqRamp, divRamp, h, showTip, hideTip, ttRow,
  pageHeader, figure, grid, select, seg, sectorOptions, kpiRow, svgEl, widthOf, axisLeft, axisBottom,
  sparkline, lineChart, legend, scatter, yearOptions, comparisonSeries, tex, disclosure,
} from "./core.js";
import { ols, stars, fmtP } from "./stats.js";


export const rerender = () => window.dispatchEvent(new Event("lca:render"));
const set = (patch, push = false) => { Object.assign(S, patch); writeHash(push); rerender(); };

// ---------------------------------------------------------------------------
// Overview: choropleth map and ranking for any indicator and year
// ---------------------------------------------------------------------------
let playTimer = null;
export const stopPlay = () => { if (playTimer) { clearInterval(playTimer); playTimer = null; } };

export async function overview(root) {
  const cov = coverage(S.metric);
  if (!cov.years.length) { S.metric = "prod_hour"; return overview(root); }
  if (!S.year || !cov.years.includes(S.year)) S.year = cov.latest;
  const M = METRIC[S.metric];

  root.append(pageHeader("Overview",
    `${M.label}, ${D.countries.length} economies`,
    `${M.desc} The map and the ranking show one year at a time. The year slider and the play control step through the available years; the color scale is fixed across years so that changes over time remain comparable.`));

  // Indicator selector grouped by category
  const picker = h("div", { class: "picker", role: "group", "aria-label": "Indicator" },
    h("p", { class: "picker-title" }, "Indicator ", h("span", {}, "· select one to update the map and the ranking")));
  for (const cat of CATEGORIES) {
    const ms = METRICS.filter(m => m.cat === cat);
    picker.append(h("div", { class: "picker-row" }, h("span", { class: "picker-cat" }, cat),
      h("div", { class: "picker-opts" }, ms.map(m => h("button", { class: `picker-opt ${m.key === S.metric ? "on" : ""}`, title: m.desc,
        onclick: () => set({ metric: m.key, year: null }) }, m.label)))));
  }
  root.append(picker);

  const world = await loadWorld();
  const yearLabel = h("span", { class: "year-display" }, String(S.year));
  const range = h("input", { type: "range", class: "range", min: d3.min(cov.years), max: d3.max(cov.years), step: 1, value: S.year, "aria-label": "Year" });
  const playBtn = h("button", { class: "play", "aria-label": "Play through the years" }, "Play");
  const timeline = h("div", { class: "timeline" }, playBtn, yearLabel, range);

  const f1 = figure({ title: M.label, span: 7,
    sub: `${M.unit}${isSector(S.metric) ? " · " + sectorLabel(S.nace) : ""}`,
    note: `Source: ${M.source}. Grey: no data for the selected year. Click a country to open its profile.`,
    method: [M.desc],
    csv: () => snapshot(S.metric, S.year).map(d => ({ country: d.name, year: S.year, value: d.v })) });
  const f2 = figure({ title: "Ranking", span: 5, sub: `Highest to lowest, ${"year shown on the map"}. Dashed line: EU27.`,
    csv: () => snapshot(S.metric, S.year).sort((a, b) => b.v - a.v).map((d, i) => ({ rank: i + 1, country: d.name, value: d.v })) });
  f1.body.append(timeline);
  root.append(grid(f1.el, f2.el));

  const allVals = cov.years.flatMap(y => snapshot(S.metric, y).map(d => d.v)).sort(d3.ascending);
  const color = d3.scaleSequential(d3.interpolateRgbBasis(seqRamp()))
    .domain([d3.quantileSorted(allVals, .03), d3.quantileSorted(allVals, .97)]).clamp(true);
  const mapApi = drawMap(f1.body, world, color);
  drawRamp(f1.body, color, M);
  const rankApi = drawRanking(f2.body);
  const summary = h("div", { class: "summary" });
  root.append(summary);

  const update = (animate = true) => {
    yearLabel.textContent = S.year; range.value = S.year;
    mapApi.update(animate); rankApi.update(animate); writeSummary(summary);
  };
  range.addEventListener("input", () => { S.year = +range.value; writeHash(); update(); });
  playBtn.addEventListener("click", () => {
    if (playTimer) { stopPlay(); playBtn.textContent = "Play"; writeHash(); return; }
    const ys = cov.years.filter(y => y <= cov.latest);
    if (S.year >= cov.latest) S.year = ys[0];
    playBtn.textContent = "Pause"; update();
    playTimer = setInterval(() => {
      const i = ys.indexOf(S.year);
      if (i >= ys.length - 1) { stopPlay(); playBtn.textContent = "Play"; writeHash(); return; }
      S.year = ys[i + 1]; update();
    }, 750);
  });
  update(false);
}

function drawMap(host, world, color) {
  const wrap = h("div", { class: "map-wrap" }); host.append(wrap);
  const coverageHas = (m, g) => D.allYears.some(y => val(m, g, y) != null);
  const tall = D.countries.some(c => /Sub-Saharan/.test(c.region) && (c.geo === S.focus || coverageHas(S.metric, c.geo)));
  const width = widthOf(host), height = Math.round(width * (tall ? 1.05 : .74));
  const svg = svgEl(wrap, width, height);
  if (!world) { svg.append("text").attr("class", "annot").attr("x", 8).attr("y", 18).text("Map geometry could not be loaded."); return { update() {} }; }
  const feats = window.topojson.feature(world, world.objects.countries).features;
  const byNum = new Map(D.countries.filter(c => c.isonum).map(c => [c.isonum, c.geo]));
  for (const f of feats) f.geo = byNum.get(String(f.id)) || (f.properties?.name === "Kosovo" && D.name.has("XK") ? "XK" : null);
  // Frame Europe and North Africa; extend south when Sub-Saharan economies are shown or selected
  const africa = D.countries.some(c => /Sub-Saharan/.test(c.region) && (c.geo === S.focus || coverageHas(S.metric, c.geo)));
  const box = { type: "Feature", geometry: { type: "MultiPoint", coordinates: africa
    ? [[-20, 2], [33, 71], [45, 37], [42, -6], [-5, -6], [25, 71], [-17, 30]]
    : [[-17, 30], [33, 71], [42, 37], [-14, 22], [34, 22], [25, 71]] } };
  const proj = d3.geoAzimuthalEqualArea().rotate(africa ? [-12, -35] : [-12, -50]).fitExtent([[4, 4], [width - 4, height - 4]], box);
  const path = d3.geoPath(proj);
  const clip = "clip" + Math.random().toString(36).slice(2);
  svg.append("clipPath").attr("id", clip).append("rect").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("clip-path", `url(#${clip})`).append("g");
  const near = f => { const [[x0, y0], [x1, y1]] = d3.geoBounds(f); return x1 > -40 && x0 < 75 && y1 > (africa ? -40 : 5) && y0 < 85 && (x1 - x0) < 200; };
  const paths = g.selectAll("path").data(feats.filter(near)).join("path")
    .attr("class", f => `country-path ${f.geo === S.focus ? "focus" : ""}`).attr("d", path)
    .attr("fill", cssVar("--map-empty")).attr("stroke", cssVar("--bg")).attr("stroke-width", .7)
    .on("mousemove", (ev, f) => {
      if (!f.geo) return hideTip();
      const v = val(S.metric, f.geo, S.year), r = rankOf(S.metric, f.geo, S.year);
      showTip(ev, `<div class="tt-title">${cname(f.geo)}</div>${ttRow(S.year, fmt(S.metric, v))}${r ? ttRow("Rank", `${r.rank} of ${r.n}`) : ""}`);
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, f) => { if (f.geo) { hideTip(); set({ focus: f.geo, view: "country" }, true); } });
  paths.filter(f => f.geo === S.focus).raise();
  svg.call(d3.zoom().scaleExtent([1, 6]).on("zoom", ev => g.attr("transform", ev.transform)));
  return {
    update(animate) {
      paths.transition().duration(animate ? 550 : 0).attr("fill", f => {
        const v = f.geo ? val(S.metric, f.geo, S.year) : null;
        return v == null ? cssVar("--map-empty") : color(v);
      });
    },
  };
}

function drawRamp(host, color, M) {
  const width = Math.min(320, widthOf(host)), height = 38;
  const svg = svgEl(host, width, height);
  const id = "ramp" + Math.random().toString(36).slice(2);
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, .1).forEach(t => grad.append("stop").attr("offset", t).attr("stop-color", color(color.domain()[0] + t * (color.domain()[1] - color.domain()[0]))));
  svg.append("rect").attr("y", 6).attr("width", width).attr("height", 8).attr("fill", `url(#${id})`);
  const x = d3.scaleLinear(color.domain(), [0, width]);
  svg.append("g").attr("class", "axis").attr("transform", "translate(0,16)")
    .call(d3.axisBottom(x).ticks(4).tickFormat(v => fmt(M.key, v)).tickSize(0).tickPadding(6)).call(g => g.select(".domain").remove());
}

function drawRanking(host) {
  const list = h("div", { class: "rank-list" }); host.append(list);
  const width = widthOf(host) - 8, rowH = 19, m = { l: 168, r: 70 };
  const svg = d3.select(list).append("svg").attr("width", width);
  const gEU = svg.append("g"), gRows = svg.append("g");
  return {
    update(animate) {
      const data = snapshot(S.metric, S.year).sort((a, b) => b.v - a.v);
      const eu = val(S.metric, EU, S.year);
      const height = data.length * rowH + 22;
      svg.attr("height", height);
      const lo = Math.min(0, d3.min(data, d => d.v));
      const x = d3.scaleLinear([lo, d3.max([...data.map(d => d.v), eu || 0])], [m.l, width - m.r]);
      const t = svg.transition().duration(animate ? 550 : 0).ease(d3.easeCubicInOut);
      const rows = gRows.selectAll("g.row").data(data, d => d.geo).join(
        enter => {
          const g = enter.append("g").attr("class", "row").attr("transform", (d, i) => `translate(0,${i * rowH + 18})`).attr("opacity", 0).style("cursor", "pointer");
          g.append("rect").attr("class", "bar").attr("height", rowH - 7).attr("x", x(0)).attr("width", 0);
          g.append("text").attr("class", "name").attr("x", m.l - 8).attr("y", (rowH - 7) / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle");
          g.append("text").attr("class", "value label").attr("y", (rowH - 7) / 2).attr("dominant-baseline", "middle");
          return g;
        }, u => u, exit => exit.transition(t).attr("opacity", 0).remove());
      rows.on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(S.year, fmt(S.metric, d.v))}`))
        .on("mouseleave", hideTip).on("click", (ev, d) => { hideTip(); set({ focus: d.geo, view: "country" }, true); });
      rows.transition(t).attr("opacity", 1).attr("transform", (d, i) => `translate(0,${i * rowH + 18})`);
      rows.select("rect.bar").transition(t).attr("x", d => x(Math.min(0, d.v))).attr("width", d => Math.abs(x(d.v) - x(0)))
        .attr("fill", d => d.geo === S.focus ? cssVar("--s1") : S.comps.includes(d.geo) ? countryColor(d.geo) : cssVar("--context"));
      rows.select("text.name").text(d => d.name).attr("class", d => `name ${d.geo === S.focus ? "label-strong" : "label"}`);
      rows.select("text.value").text(d => fmt(S.metric, d.v)).transition(t).attr("x", d => x(d.v) + 6);
      gEU.selectAll("*").remove();
      if (eu != null) {
        gEU.append("line").attr("class", "eu-line").attr("x1", x(eu)).attr("x2", x(eu)).attr("y1", 12).attr("y2", height);
        gEU.append("text").attr("class", "annot").attr("x", x(eu)).attr("y", 8).attr("text-anchor", "middle").text(`EU27 ${fmt(S.metric, eu)}`);
      }
    },
  };
}

function writeSummary(host) {
  host.innerHTML = "";
  const snap = snapshot(S.metric, S.year).sort((a, b) => b.v - a.v);
  if (snap.length < 2) return;
  const top = snap[0], bot = snap[snap.length - 1];
  const eu = val(S.metric, EU, S.year);
  const med = d3.median(snap, d => d.v);
  const f = snap.find(d => d.geo === S.focus);
  const items = [
    ["Highest", fmt(S.metric, top.v), `${top.name}, ${S.year}`],
    ["Lowest", fmt(S.metric, bot.v), `${bot.name}; highest-to-lowest ratio ${(top.v / bot.v).toFixed(1)}`],
    ["Median", fmt(S.metric, med), `${snap.length} economies${eu != null ? `; EU27 aggregate ${fmt(S.metric, eu)}` : ""}`],
    f ? [cname(S.focus), fmt(S.metric, f.v), `Rank ${snap.indexOf(f) + 1} of ${snap.length}${eu ? `; ${d3.format(".0%")(f.v / eu)} of EU27` : ""}`] : null,
  ].filter(Boolean);
  host.append(kpiRow(items.map(([label, value, foot]) => ({ label, value, foot }))));
}

// ---------------------------------------------------------------------------
// Unit labor costs
// ---------------------------------------------------------------------------
export function ulc(root) {
  const end = endYear(), base = S.base;
  const basis = S.ulcBasis; // "per" (per person) or "hour"
  const ulcOf = (geo, y, nace = S.nace) => {
    if (basis === "hour") { const c = val("comp_ph", geo, y, nace), p = val("prod_hour", geo, y, nace); return c && p ? c / p : null; }
    return val("ulc", geo, y, nace);
  };
  const compOf = (geo, y, nace = S.nace) => val(basis === "hour" ? "comp_ph" : "comp_pe", geo, y, nace);
  const prodOf = (geo, y, nace = S.nace) => val(basis === "hour" ? "prod_hour" : "prod", geo, y, nace);
  const lg = (f, geo, y0, y1, nace) => { const a = f(geo, y0, nace), b = f(geo, y1, nace); return a > 0 && b > 0 ? 100 * Math.log(b / a) : null; };

  root.append(pageHeader("Unit labor costs", "Unit labor costs",
    `Unit labor cost (ULC) is the cost of labor per unit of real output: compensation per employee divided by real value added per person employed. ` +
    `Its change over time is decomposed exactly in logarithms, as shown below. ` +
    `ULC levels are not comparable across countries because output is measured in national price levels; comparisons are therefore made in growth rates and indices.`));

  root.append(disclosure("Definition and decomposition", tex(String.raw`\mathit{ULC}_{it} = \frac{W_{it}}{P_{it}} = \frac{D1_{it}/L_{it}}{\mathit{GVA}^{\,real}_{it}/E_{it}} \qquad\Longrightarrow\qquad \Delta\ln \mathit{ULC}_{i} = \underbrace{\Delta\ln W_{i}}_{\text{compensation}} \;-\; \underbrace{\Delta\ln P_{i}}_{\text{productivity}}`)));
  root.append(h("div", { class: "view-controls" },
    seg("Basis", [{ value: "per", label: "Per person" }, { value: "hour", label: "Per hour worked" }], basis, v => set({ ulcBasis: v }))));

  // Key figures for the focus country
  const g = lg(ulcOf, S.focus, base, end), gc = lg(compOf, S.focus, base, end), gp = lg(prodOf, S.focus, base, end);
  const geu = lg(ulcOf, EU, base, end);
  const all = D.countries.map(c => ({ geo: c.geo, g: lg(ulcOf, c.geo, base, end) })).filter(d => d.g != null).sort((a, b) => b.g - a.g);
  const rk = all.findIndex(d => d.geo === S.focus);
  root.append(kpiRow([
    { label: `ULC change, ${base}–${end}`, value: g != null ? pp(g) : "n/a", foot: "log points" },
    { label: "Annual average", value: g != null ? pp(g / (end - base)) : "n/a", foot: "log points per year" },
    { label: "Compensation per employee", value: gc != null ? pp(gc) : "n/a", foot: "log points" },
    { label: "Real productivity", value: gp != null ? pp(gp) : "n/a", foot: "log points" },
    { label: "Difference to EU27", value: g != null && geu != null ? pp(g - geu) : "n/a", foot: "percentage points of ULC growth" },
    { label: "Rank by ULC growth", value: rk >= 0 ? `${rk + 1} / ${all.length}` : "n/a", foot: "1 = fastest increase" },
  ]));

  // Figure: ULC index
  const idxList = comparisonSeries(geo => {
    const b = ulcOf(geo, base);
    return b ? D.allYears.map(y => ({ year: y, v: ulcOf(geo, y) })).filter(d => d.v != null).map(d => ({ year: d.year, v: 100 * d.v / b })) : [];
  });
  const f1 = figure({ title: `Unit labor cost index, ${sectorLabel(S.nace).toLowerCase()}`, span: 7,
    sub: `Index, ${base} = 100. Nominal compensation ${basis === "hour" ? "per hour worked by employees" : "per employee"} divided by real value added ${basis === "hour" ? "per hour worked" : "per person employed"}.`,
    note: "Source: Eurostat nama_10_a64, nama_10_a64_e; author's calculation. Dashed: EU27 aggregate (weighted). Grey: context economies (hover to identify). Dotted with shaded band: unweighted group median and range.",
    method: [String.raw`$I_{it} = 100 \cdot \frac{\mathit{ULC}_{it}}{\mathit{ULC}_{i,t_0}}, \qquad \mathit{ULC}_{it} = \frac{D1_{it}/L_{it}}{\mathit{GVA}^{\,real}_{it}/E_{it}}`, "Each line is divided by its own value in the base year, so all lines start at 100. A value of 150 means that unit labor cost is 50% higher than in the base year."],
    csv: () => idxList.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, index: d.v }))) });

  // Figure: annual decomposition for focus
  const dec = D.allYears.slice(1).map(y => {
    const c = lg(compOf, S.focus, y - 1, y), p = lg(prodOf, S.focus, y - 1, y);
    return c != null && p != null ? { year: y, comp: c, prod: -p, ulc: c - p } : null;
  }).filter(Boolean);
  const f2 = figure({ title: `Annual change in unit labor cost, ${cname(S.focus)}`, span: 5,
    sub: "Log points. Bars: contribution of compensation growth and of productivity growth (shown with negative sign). Dot: ULC change.",
    note: "A negative productivity bar means productivity rose and lowered unit labor cost. Source: Eurostat national accounts; author's calculation.",
    method: [String.raw`$\Delta \ln \mathit{ULC}_{it} = \underbrace{\Delta \ln W_{it}}_{\text{blue bar}} \; - \; \underbrace{\Delta \ln P_{it}}_{\text{teal bar}}`, "Changes are year-on-year log changes multiplied by 100. The two bars add up exactly to the dot."],
    csv: () => dec.map(d => ({ year: d.year, compensation_contribution: d.comp, productivity_contribution: d.prod, ulc_change: d.ulc })) });
  root.append(grid(f1.el, f2.el));
  lineChart(f1.body, idxList, { height: 380, yFormat: d3.format(".0f"), indexLine: true });
  drawAnnualDecomp(f2.body, dec);
  f2.body.append(legend([{ label: "Compensation", color: cssVar("--s1") }, { label: "Productivity (inverted)", color: cssVar("--s2") }, { label: "ULC change", color: cssVar("--text"), shape: "dot" }]));

  // Figure: cumulative decomposition across countries (dumbbell)
  const rows = D.countries.map(c => {
    const gc = lg(compOf, c.geo, base, end), gp = lg(prodOf, c.geo, base, end);
    return gc != null && gp != null ? { geo: c.geo, name: c.name, comp: gc, prod: gp, ulc: gc - gp } : null;
  }).filter(Boolean).sort((a, b) => b.ulc - a.ulc);
  const f3 = figure({ title: `Compensation and productivity growth, ${base}–${end}`, span: 7,
    sub: "Cumulative change in log points. The horizontal distance between the two markers equals the change in unit labor cost. Sorted by ULC change.",
    note: "Source: Eurostat national accounts; author's calculation.",
    method: [String.raw`$\Delta \ln \mathit{ULC}_{i} = \Delta \ln W_{i} - \Delta \ln P_{i}`, "The teal marker is the cumulative change in real productivity, the blue marker the cumulative change in compensation per employee, both in log points over the selected period. The number on the right is their difference: the change in unit labor cost."],
    csv: () => rows.map(r => ({ country: r.name, compensation_growth: r.comp, productivity_growth: r.prod, ulc_change: r.ulc })) });

  // Figure: ULC growth vs productivity growth with OLS fit
  const pts = rows.map(r => ({ geo: r.geo, name: r.name, x: r.prod / (end - base), y: r.ulc / (end - base) }));
  const fit = pts.length > 5 ? ols(pts.map(p => ({ y: p.y, x: [p.x] })), ["Productivity growth"]) : null;
  const f4 = figure({ title: "ULC growth and productivity growth", span: 5,
    sub: `Average annual log change, ${base}–${end}, in percent. Line: OLS fit with 95% confidence band (HC1).`,
    method: [String.raw`$g^{\mathit{ULC}}_{i} = \alpha + \beta\, g^{P}_{i} + \varepsilon_i`, "Ordinary least squares across economies with heteroskedasticity-robust (HC1) standard errors; g denotes average annual log growth in percent. Since ULC growth equals compensation growth minus productivity growth, β = −1 would mean compensation growth is unrelated to productivity growth and β = 0 that it moves one for one."],
    note: fit ? `Slope ${fit.coefs[1].b.toFixed(2)} (SE ${fit.coefs[1].se.toFixed(2)}, p ${fmtP(fit.coefs[1].p)}), n = ${fit.n}, R² = ${fit.r2.toFixed(2)}. A slope of −1 would mean that productivity gains are not passed on to compensation at all; a slope of 0 means they are passed on one for one.` : "" });
  root.append(grid(f3.el, f4.el));
  drawDumbbell(f3.body, rows);
  f3.body.append(legend([{ label: "Productivity growth", color: cssVar("--s2"), shape: "dot" }, { label: "Compensation growth", color: cssVar("--s1"), shape: "dot" }]));
  scatter(f4.body, pts, { xLabel: "Productivity growth, % p.a.", yLabel: "ULC growth, % p.a.", xFmt: d => d.toFixed(1), yFmt: d => d.toFixed(1),
    fit: fit ? { predict: fit.predict } : null, highlight: p => p.geo === S.focus, colorOf: p => p.geo === S.focus || S.comps.includes(p.geo) ? countryColor(p.geo) : cssVar("--context-hi"), height: 400 });

  // Figure: sector decomposition
  const tiers = { a10: "Economy sections", manuf14: "Manufacturing branches", manuf3: "Automotive, electronics, other manufacturing" };
  const secs = D.sectors.filter(s => s.tier === S.tier).map(s => {
    const c = lg(compOf, S.focus, base, end, s.nace), p = lg(prodOf, S.focus, base, end, s.nace);
    return c != null && p != null ? { nace: s.nace, label: s.label, comp: c, prod: -p, ulc: c - p } : null;
  }).filter(Boolean).sort((a, b) => b.ulc - a.ulc);
  const f5 = figure({ title: `Decomposition by sector, ${cname(S.focus)}, ${base}–${end}`, span: 7,
    sub: "Cumulative log points. Upper bar: compensation contribution. Lower bar: productivity contribution (negative sign). Dot: ULC change.",
    controls: seg(null, Object.entries(tiers).map(([value, label]) => ({ value, label })), S.tier, v => set({ tier: v })),
    note: "Other manufacturing (C minus C26 and C29) is exact in nominal terms and approximate in real terms because chain-linked volumes are not additive.",
    csv: () => secs.map(s => ({ sector: s.label, compensation_contribution: s.comp, productivity_contribution: s.prod, ulc_change: s.ulc })) });

  // Figure: official index cross-check
  const off = series(basis === "hour" ? "ulc_index_hw" : "ulc_index_per", S.focus);
  const f6 = figure({ title: `Cross-check with Eurostat's published index, ${cname(S.focus)}`, span: 5,
    sub: `Whole economy, index ${base} = 100. Solid: series computed here. Dashed: Eurostat nominal ULC index (nama_10_lp_ulc).`,
    note: "Differences can arise from data revisions between releases, from the employment concept and from the treatment of the self-employed in the official index." });
  root.append(grid(f5.el, f6.el));
  drawSectorDecomp(f5.body, secs);
  const offB = off.find(d => d.year === base);
  const own = (() => { const b = ulcOf(S.focus, base, "TOTAL"); return b ? D.allYears.map(y => ({ year: y, v: ulcOf(S.focus, y, "TOTAL") })).filter(d => d.v != null).map(d => ({ year: d.year, v: 100 * d.v / b })) : []; })();
  lineChart(f6.body, [
    { key: "own", label: "Computed", color: cssVar("--s1"), width: 2.4, data: own },
    ...(offB ? [{ key: "off", label: "Eurostat", color: cssVar("--text-2"), width: 1.6, dash: "5 4", data: off.map(d => ({ year: d.year, v: 100 * d.v / offB.v })) }] : []),
  ], { height: 300, yFormat: d3.format(".0f"), indexLine: true });
  if (!offB) f6.note.innerHTML = "Eurostat's published index is not available for this country.";
}

function drawAnnualDecomp(host, dec) {
  if (!dec.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), height = 380, m = { t: 10, r: 10, b: 28, l: 44 };
  const svg = svgEl(host, width, height);
  const x = d3.scaleBand(dec.map(d => d.year), [m.l, width - m.r]).padding(.25);
  const ext = d3.extent(dec.flatMap(d => [d.comp, d.prod, d.ulc, 0]));
  const y = d3.scaleLinear(ext, [height - m.b, m.t]).nice();
  axisLeft(svg, y, m.l, d3.format(".0f"));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => i % Math.ceil(dec.length / 8) === 0)).tickSizeOuter(0));
  svg.append("line").attr("class", "zero-line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(0)).attr("y2", y(0));
  const bars = dec.flatMap(d => [{ d, k: "comp", v: d.comp, c: cssVar("--s1") }, { d, k: "prod", v: d.prod, c: cssVar("--s2") }]);
  svg.selectAll("rect").data(bars).join("rect")
    .attr("x", b => x(b.d.year) + (b.k === "comp" ? 0 : x.bandwidth() / 2)).attr("width", x.bandwidth() / 2 - 1)
    .attr("y", y(0)).attr("height", 0).attr("fill", b => b.c)
    .on("mousemove", (ev, b) => showTip(ev, `<div class="tt-title">${b.d.year}</div>${ttRow("Compensation", pp(b.d.comp))}${ttRow("Productivity (inverted)", pp(b.d.prod))}${ttRow("ULC change", pp(b.d.ulc))}`))
    .on("mouseleave", hideTip)
    .transition().duration(700).delay((b, i) => i * 8).attr("y", b => y(Math.max(0, b.v))).attr("height", b => Math.abs(y(b.v) - y(0)));
  svg.selectAll("circle").data(dec).join("circle").attr("cx", d => x(d.year) + x.bandwidth() / 2).attr("cy", d => y(d.ulc))
    .attr("r", 3.5).attr("fill", cssVar("--text")).attr("stroke", cssVar("--bg")).attr("stroke-width", 1.5);
}

function drawDumbbell(host, rows) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 17, m = { t: 8, r: 56, b: 28, l: 150 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear(d3.extent(rows.flatMap(r => [r.comp, r.prod, 0])), [m.l, width - m.r]).nice();
  const y = d3.scaleBand(rows.map(r => r.geo), [m.t, height - m.b]).padding(.2);
  svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", m.t).attr("y2", height - m.b);
  axisBottom(svg, x, height - m.b, d3.format(".0f"), 6);
  svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", height - m.b);
  const g = svg.selectAll("g.r").data(rows).join("g").attr("class", "r").attr("transform", r => `translate(0,${y(r.geo) + y.bandwidth() / 2})`)
    .on("mousemove", (ev, r) => showTip(ev, `<div class="tt-title">${r.name}</div>${ttRow("Compensation", pp(r.comp))}${ttRow("Productivity", pp(r.prod))}${ttRow("ULC", pp(r.ulc))}`))
    .on("mouseleave", hideTip);
  g.append("text").attr("class", r => r.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 8).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(r => r.name);
  g.append("line").attr("x1", r => x(r.prod)).attr("x2", r => x(r.prod)).attr("stroke", r => r.ulc > 0 ? cssVar("--s1") : cssVar("--s2")).attr("stroke-width", 2).attr("stroke-opacity", .45)
    .transition().duration(800).attr("x2", r => x(r.comp));
  g.append("circle").attr("cx", r => x(r.prod)).attr("r", 4).attr("fill", cssVar("--s2"));
  g.append("circle").attr("cx", r => x(r.prod)).attr("r", 4).attr("fill", cssVar("--s1")).transition().duration(800).attr("cx", r => x(r.comp));
  g.append("text").attr("class", "annot").attr("x", width - m.r + 8).attr("dominant-baseline", "middle").text(r => pp(r.ulc));
  g.filter(r => r.geo === S.focus).insert("rect", ":first-child").attr("class", "row-hl").attr("x", 0).attr("y", -y.bandwidth() / 2 - 1).attr("width", width).attr("height", y.bandwidth() + 2);
}

function drawSectorDecomp(host, rows) {
  if (!rows.length) { host.append(h("p", { class: "empty" }, "No data are available for this selection.")); return; }
  const width = widthOf(host), rowH = 30, m = { t: 6, r: 20, b: 28, l: 220 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear(d3.extent(rows.flatMap(r => [r.comp, r.prod, r.ulc, 0])), [m.l, width - m.r]).nice();
  const y = d3.scaleBand(rows.map(r => r.nace), [m.t, height - m.b]).padding(.22);
  svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", m.t).attr("y2", height - m.b);
  axisBottom(svg, x, height - m.b, d3.format(".0f"), 6);
  const bh = (y.bandwidth() - 2) / 2;
  const segs = rows.flatMap(r => [{ r, k: 0, v: r.comp, c: cssVar("--s1") }, { r, k: 1, v: r.prod, c: cssVar("--s2") }]);
  svg.selectAll("rect").data(segs).join("rect").attr("y", s => y(s.r.nace) + s.k * (bh + 2)).attr("height", bh).attr("fill", s => s.c)
    .attr("x", x(0)).attr("width", 0)
    .on("mousemove", (ev, s) => showTip(ev, `<div class="tt-title">${s.r.label}</div>${ttRow("Compensation", pp(s.r.comp))}${ttRow("Productivity (inverted)", pp(s.r.prod))}${ttRow("ULC change", pp(s.r.ulc))}`))
    .on("mouseleave", hideTip)
    .transition().duration(800).delay((s, i) => i * 20).attr("x", s => Math.min(x(0), x(s.v))).attr("width", s => Math.abs(x(s.v) - x(0)));
  svg.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", height - m.b);
  svg.selectAll("circle").data(rows).join("circle").attr("cy", r => y(r.nace) + y.bandwidth() / 2).attr("cx", r => x(r.ulc)).attr("r", 4.5)
    .attr("fill", cssVar("--text")).attr("stroke", cssVar("--bg")).attr("stroke-width", 1.5);
  svg.selectAll("text.sl").data(rows).join("text").attr("class", "label").attr("x", m.l - 10).attr("text-anchor", "end")
    .attr("dominant-baseline", "middle").attr("y", r => y(r.nace) + y.bandwidth() / 2).text(r => r.label);
}

// ---------------------------------------------------------------------------
// Country profile
// ---------------------------------------------------------------------------
export function country(root) {
  const geo = S.focus, region = D.region.get(geo);
  const avail = PROFILE_METRICS.filter(m => latest(m, geo, "TOTAL"));
  const ph = latest("prod_hour", geo, "TOTAL"), euPh = ph && val("prod_hour", EU, ph.year, "TOTAL");
  const lc = latest("lc_hour", geo) || latest("lc_hour_c", geo);
  const u0 = val("ulc", geo, S.base, "TOTAL"), u1 = latest("ulc", geo, "TOTAL");
  const lines = [
    ph ? `Real value added per hour worked was ${fmt("prod_hour", ph.v)} in ${ph.year}${euPh ? `, ${d3.format(".0%")(ph.v / euPh)} of the EU27 value` : ""}.` : null,
    lc ? `Hourly labor cost was ${fmt("lc_hour", lc.v)} in ${lc.year}.` : null,
    u0 && u1 ? `Unit labor cost changed by ${pct(u1.v / u0 - 1)} between ${S.base} and ${u1.year}.` : null,
  ].filter(Boolean);
  root.append(pageHeader(region, cname(geo), lines.join(" ") || "Few indicators are available for this economy."));

  const tiles = h("dl", { class: "kpis kpis-spark" });
  for (const m of avail) {
    const l = latest(m, geo, "TOTAL"), r = rankOf(m, geo, l.year, "TOTAL");
    const spark = h("div", { class: "spark" });
    tiles.append(h("div", { class: `kpi clickable ${S.trend === m ? "on" : ""}`, title: METRIC[m].desc, onclick: () => set({ trend: m }) },
      h("dt", {}, METRIC[m].label), h("dd", { class: "kpi-value" }, fmt(m, l.v)),
      h("dd", { class: "kpi-foot" }, `${l.year}${r ? ` · rank ${r.rank} of ${r.n}` : ""}`), spark));
    requestAnimationFrame(() => sparkline(spark, series(m, geo, "TOTAL"), { width: Math.max(120, spark.clientWidth) }));
  }
  root.append(tiles);

  if (!avail.includes(S.trend)) S.trend = avail[0] || "prod_hour";
  const f1 = figure({ title: "Position among all economies", span: 6,
    sub: "Latest year per indicator. Each grey marker is one economy, ordered from lowest (left) to highest (right) value; the large marker is the selected economy.",
    note: "Ranks are within the economies that report the indicator; coverage differs by indicator." });
  const f2 = figure({ title: `${METRIC[S.trend].label}`, span: 6, sub: `${METRIC[S.trend].unit}. Thin lines: other economies in ${region}. Select an indicator above to change the chart.`,
    note: `Source: ${METRIC[S.trend].source}.`,
    csv: () => series(S.trend, geo, "TOTAL").map(d => ({ country: cname(geo), year: d.year, value: d.v })) });
  root.append(grid(f1.el, f2.el));
  drawPosition(f1.body, geo, avail);
  const peers = D.countries.filter(c => c.region === region && c.geo !== geo).map(c => c.geo);
  lineChart(f2.body, [
    ...peers.map(p => ({ key: p, label: cname(p), color: cssVar("--context-hi"), width: 1, role: "context", data: series(S.trend, p, "TOTAL") })),
    { key: EU, label: "EU27", color: cssVar("--eu"), width: 1.8, dash: "5 4", data: series(S.trend, EU, "TOTAL") },
    { key: geo, label: cname(geo), color: cssVar("--s1"), width: 2.6, data: series(S.trend, geo, "TOTAL") },
  ], { height: 360, yFormat: v => fmt(S.trend, v) });
}

function drawPosition(host, geo, metrics) {
  const width = widthOf(host), rowH = 32, m = { l: 196, r: 76, t: 20 };
  const height = metrics.length * rowH + m.t + 10;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, 1], [m.l, width - m.r]);
  svg.append("text").attr("class", "annot").attr("x", m.l).attr("y", 10).text("Lowest");
  svg.append("text").attr("class", "annot").attr("x", width - m.r).attr("y", 10).attr("text-anchor", "end").text("Highest");
  metrics.forEach((k, i) => {
    const l = latest(k, geo, "TOTAL"), snap = snapshot(k, l.year, "TOTAL").sort((a, b) => a.v - b.v), n = snap.length;
    const pos = d => (n > 1 ? snap.indexOf(d) / (n - 1) : .5);
    const y = m.t + i * rowH + rowH / 2;
    const g = svg.append("g").style("cursor", "pointer").on("click", () => set({ trend: k }));
    g.append("text").attr("class", "label").attr("x", m.l - 12).attr("y", y).attr("dominant-baseline", "middle").attr("text-anchor", "end").text(METRIC[k].label);
    g.append("line").attr("x1", x(0)).attr("x2", x(1)).attr("y1", y).attr("y2", y).attr("class", "track");
    g.selectAll("circle.o").data(snap.filter(d => d.geo !== geo)).join("circle").attr("class", "o").attr("cy", y).attr("r", 3.2)
      .attr("fill", cssVar("--context-hi")).attr("cx", d => x(pos(d)))
      .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(METRIC[k].label, fmt(k, d.v))}`)).on("mouseleave", hideTip);
    const me = snap.find(d => d.geo === geo);
    if (me) {
      g.append("circle").attr("cy", y).attr("r", 6.5).attr("fill", cssVar("--s1")).attr("stroke", cssVar("--bg")).attr("stroke-width", 2)
        .attr("cx", x(.5)).transition().duration(800).delay(i * 40).attr("cx", x(pos(me)));
      g.append("text").attr("class", "label-strong").attr("x", width - m.r + 10).attr("y", y).attr("dominant-baseline", "middle").text(fmt(k, me.v));
    }
  });
}

// ---------------------------------------------------------------------------
// Comparison: small multiples for the focus and comparison countries
// ---------------------------------------------------------------------------
export function compare(root) {
  const geos = [...new Set([S.focus, ...S.comps])];
  root.append(pageHeader("Comparison", `${geos.map(cname).join(", ")}`,
    "All indicators for the selected economies. Each economy keeps the same color in every chart. Countries are added or removed in the bar above."));
  root.append(h("div", { class: "view-controls" },
    seg("Scale", [{ value: false, label: "Levels" }, { value: true, label: `Index, ${S.base} = 100` }], S.index, v => set({ index: v })),
    legend([...geos.map(g => ({ label: cname(g), color: countryColor(g) })), { label: "EU27", color: cssVar("--eu") }])));
  const wrap = h("div", { class: "grid" });
  root.append(wrap);
  for (const M of METRICS) {
    const list = comparisonSeries(g => {
      let data = series(M.key, g, "TOTAL");
      if (S.index) { const b = data.find(d => d.year === S.base); data = b ? data.map(d => ({ year: d.year, v: 100 * d.v / b.v })) : []; }
      return data;
    });
    if (!list.some(s => s.key !== EU)) continue;
    const f = figure({ title: M.label, span: 4, sub: S.index ? `Index, ${S.base} = 100` : M.unit, png: true,
      note: `Source: ${M.source}.`, csv: () => list.flatMap(s => s.data.map(d => ({ country: s.label, year: d.year, value: d.v }))) });
    wrap.append(f.el);
    lineChart(f.body, list, { height: 210, labelEnds: false, indexLine: S.index, yFormat: S.index ? d3.format(".0f") : v => fmt(M.key, v) });
  }
}

// ---------------------------------------------------------------------------
// Composition of hourly labor cost
// ---------------------------------------------------------------------------
export function hourData(geo) {
  const manuf = S.hourNace === "C";
  const lc = latest(manuf ? "lc_hour_c" : "lc_hour", geo);
  const fallback = !lc ? latest("comp_ph", geo, S.hourNace) : null;
  return { lc: lc || fallback, lcSource: lc ? "labor cost survey" : fallback ? "national accounts (compensation per employee hour)" : null,
    nonwage: latest(manuf ? "nonwage_share_c" : "nonwage_share", geo), wedge: latest("tax_wedge", geo),
    vah: latest("va_hour_nom", geo, S.hourNace), hrs: latest("hours_worker", geo, S.hourNace) };
}
export function computeHour(d, change = 0) {
  if (!d.lc) return null;
  const cost0 = d.lc.v * (1 + change / 100);
  const nw = d.nonwage ? d.nonwage.v : .2;
  const wedge = d.wedge ? Math.max(d.wedge.v, nw) : nw + .15;
  const employer = cost0 * nw, employeeTax = cost0 * Math.max(0, wedge - nw), net = cost0 - employer - employeeTax;
  const total = cost0, va = d.vah ? d.vah.v : null;
  return { net, employeeTax, employer, total, va, per100: va ? 100 * total / va : null, assumed: { nonwage: !d.nonwage, wedge: !d.wedge } };
}

export function hour(root) {
  const other = S.comps.find(c => c !== S.focus) || (S.focus === "DE" ? "PL" : "DE");
  root.append(pageHeader("Cost of an hour of work", "Composition of hourly labor cost",
    `Hourly labor cost per hour actually worked is split into net earnings, income tax and employee contributions, and employer contributions and other non-wage costs. ` +
    `It is then related to nominal value added per hour worked. The slider applies a hypothetical percentage change to hourly labor cost in the selected economy only, holding value added per hour constant; the comparison economy is unchanged. The comparison economy is the first country in the comparison list.`));
  const sliders = h("div", { class: "sliders" });
  const mk = (label, key, min, max, step, unit) => {
    const out = h("b", {}, `${S[key]}${unit}`);
    const inp = h("input", { type: "range", class: "range", min, max, step, value: S[key], "aria-label": label });
    inp.addEventListener("input", () => { S[key] = +inp.value; out.textContent = `${S[key]}${unit}`; update(); });
    return h("div", { class: "slider" }, h("label", {}, h("span", {}, label), out), inp);
  };
  sliders.append(
    mk(`Hypothetical change in hourly labor cost, ${cname(S.focus)} only`, "wageChange", -30, 80, 1, "%"));
  root.append(h("div", { class: "view-controls" },
    seg("Sector", [{ value: "C", label: "Manufacturing" }, { value: "TOTAL", label: "Business economy" }], S.hourNace, v => set({ hourNace: v })), sliders));

  const parts = [
    { key: "net", label: "Net earnings", color: cssVar("--s1") },
    { key: "employeeTax", label: "Income tax and employee contributions", color: cssVar("--s2") },
    { key: "employer", label: "Employer contributions and other costs", color: cssVar("--s3") },
  ];
  const f1 = figure({ title: "Hourly labor cost by component", span: 7, sub: "EUR per hour actually worked, latest available year.", note: " ",
    method: [String.raw`$\begin{aligned} \text{employer costs} &= \mathit{LC}^{h} s^{nw} \\ \text{taxes and employee contributions} &= \mathit{LC}^{h}\max(0,\ \tau - s^{nw}) \\ \text{net earnings} &= \mathit{LC}^{h} - \text{employer costs} - \text{taxes and employee contributions} \end{aligned}`],
    csv: () => [S.focus, other].map(g => ({ country: cname(g), ...computeHour(hourData(g), g === S.focus ? S.wageChange : 0) })) });
  const f2 = figure({ title: "Labor cost per EUR 100 of value added", span: 5, sub: "Hourly labor cost divided by nominal gross value added per hour worked, multiplied by 100.", note: " ",
    method: [String.raw`$\kappa_{i} = 100 \cdot \frac{\mathit{LC}^{h}_{i}}{\mathit{GVA}^{\,nom}_{i} / H_{i}}`] });
  root.append(grid(f1.el, f2.el));
  const summary = h("div", { class: "summary" });
  root.append(summary);
  f1.body.append(legend(parts.map(p => ({ label: p.label, color: p.color }))));

  const width = widthOf(f1.body), height = 200, m = { l: 140, r: 74, t: 10, b: 28 };
  const svg = svgEl(f1.body, width, height);
  const w2 = widthOf(f2.body), h2 = 200;
  const svg2 = svgEl(f2.body, w2, h2);

  function update() {
    const rows = [S.focus, other].map(g => ({ geo: g, name: cname(g), d: hourData(g) })).map(r => ({ ...r, c: computeHour(r.d, r.geo === S.focus ? S.wageChange : 0) })).filter(r => r.c);
    const x = d3.scaleLinear([0, (d3.max(rows, r => r.c.total) || 1) * 1.05], [m.l, width - m.r]);
    const y = d3.scaleBand(rows.map(r => r.geo), [m.t, height - m.b]).padding(.35);
    const t = svg.transition().duration(450);
    svg.selectAll("g.axis,line.grid-line").remove();
    svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", m.t).attr("y2", height - m.b);
    axisBottom(svg, x, height - m.b, v => "€" + v, 6);
    const stacks = rows.flatMap(r => { let acc = 0; return parts.map(p => { const s = { geo: r.geo, name: r.name, label: p.label, color: p.color, key: p.key, x0: acc, v: r.c[p.key] }; acc += s.v; return s; }); });
    svg.selectAll("rect.seg").data(stacks, d => d.geo + d.key).join(e => e.append("rect").attr("class", "seg").attr("x", x(0)).attr("width", 0))
      .attr("y", d => y(d.geo)).attr("height", y.bandwidth()).attr("fill", d => d.color)
      .on("mousemove", (ev, d) => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow(d.label, "€" + d.v.toFixed(2))}`)).on("mouseleave", hideTip)
      .transition(t).attr("x", d => x(d.x0) + 1).attr("width", d => Math.max(0, x(d.x0 + d.v) - x(d.x0) - 2));
    svg.selectAll("text.cn").data(rows, d => d.geo).join("text").attr("class", "cn label-strong").attr("x", m.l - 10).attr("text-anchor", "end")
      .attr("dominant-baseline", "middle").attr("y", r => y(r.geo) + y.bandwidth() / 2).text(r => r.name);
    svg.selectAll("text.tot").data(rows, d => d.geo).join("text").attr("class", "tot label-strong").attr("dominant-baseline", "middle")
      .attr("y", r => y(r.geo) + y.bandwidth() / 2).transition(t).attr("x", r => x(r.c.total) + 8).text(r => "€" + r.c.total.toFixed(2));

    const vr = rows.filter(r => r.c.per100 != null);
    const vx = d3.scaleLinear([0, Math.max(100, d3.max(vr, r => r.c.per100) || 100) * 1.05], [100, w2 - 50]);
    const vy = d3.scaleBand(vr.map(r => r.geo), [10, h2 - 28]).padding(.35);
    svg2.selectAll("g.axis,line.grid-line").remove();
    svg2.append("g").selectAll("line").data(vx.ticks(5)).join("line").attr("class", "grid-line").attr("x1", vx).attr("x2", vx).attr("y1", 10).attr("y2", h2 - 28);
    axisBottom(svg2, vx, h2 - 28, v => "€" + v, 5);
    svg2.selectAll("rect.vb").data(vr, d => d.geo).join(e => e.append("rect").attr("class", "vb").attr("x", vx(0)).attr("width", 0))
      .attr("y", r => vy(r.geo)).attr("height", vy.bandwidth()).attr("fill", r => countryColor(r.geo))
      .transition().duration(450).attr("width", r => vx(r.c.per100) - vx(0));
    svg2.selectAll("text.vn").data(vr, d => d.geo).join("text").attr("class", "vn label-strong").attr("x", 92).attr("text-anchor", "end")
      .attr("dominant-baseline", "middle").attr("y", r => vy(r.geo) + vy.bandwidth() / 2).text(r => r.name);
    svg2.selectAll("text.vv").data(vr, d => d.geo).join("text").attr("class", "vv label-strong").attr("dominant-baseline", "middle")
      .attr("y", r => vy(r.geo) + vy.bandwidth() / 2).transition().duration(450).attr("x", r => vx(r.c.per100) + 6).text(r => "€" + r.c.per100.toFixed(0));

    const [a, b] = rows;
    const items = [];
    if (a) items.push({ label: `Labor cost per hour, ${a.name}`, value: "€" + a.c.total.toFixed(2), foot: a.d.lc ? `${a.d.lc.year}, ${a.d.lcSource}` : "" });
    if (a && b) {
      items.push({ label: `Ratio of hourly labor cost, ${b.name} / ${a.name}`, value: (b.c.total / a.c.total).toFixed(2), foot: "" });
      if (a.c.va && b.c.va) items.push({ label: `Ratio of value added per hour, ${b.name} / ${a.name}`, value: (b.c.va / a.c.va).toFixed(2), foot: "nominal" });
      const a0 = computeHour(a.d, 0);
      if (a0?.per100 && b.c.per100) {
        const be = b.c.per100 / a0.per100 - 1;
        items.push({ label: `Change in ${a.name}'s hourly labor cost at which its cost per €100 of value added equals ${b.name}'s`, value: pct(be), foot: "value added per hour held constant" });
      }
    }
    summary.innerHTML = ""; summary.append(kpiRow(items));
    const caveats = rows.flatMap(r => [
      r.c.assumed.nonwage ? `${r.name}: non-wage share not reported; 20% assumed` : null,
      r.c.assumed.wedge ? `${r.name}: tax wedge not reported; estimated as non-wage share plus 15 percentage points` : null,
    ]).filter(Boolean);
    f1.note.innerHTML = `Sources: Eurostat lc_lci_lev (hourly labor cost, non-wage share), earn_nt_taxwedge (tax wedge for a single low-wage earner), nama_10_a64 and nama_10_a64_e (value added and hours). The split into components applies the tax wedge of a low-wage single earner to the average hourly cost and is therefore indicative.${caveats.length ? " " + caveats.join("; ") + "." : ""}`;
    f2.note.innerHTML = "Values above 100 indicate that hourly labor cost exceeds value added per hour; this can occur because the two series come from different statistical sources.";
  }
  update();
}

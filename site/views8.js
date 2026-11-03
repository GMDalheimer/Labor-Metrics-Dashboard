// Location costs: labor, energy and corporate tax side by side, and an illustrative operating-cost comparison
import {
  d3, S, D, EU, cname, cssVar, countryColor, h, showTip, hideTip, ttRow, figure, grid, seg, kpiRow,
  svgEl, widthOf, svgFlag, htmlFlag, val, latest, seqRamp,
} from "./core.js";
import { loadLaborSupply } from "./views7.js";

// Latest value of a labor-supply-file metric (energy prices and tax rates live there)
const lsLatest = (m, geo, maxYear = new Date().getFullYear()) => {
  const g = D.ls?.idx.get(m)?.get(geo); if (!g) return null;
  const ys = [...g.keys()].filter(y => y <= maxYear).sort((a, b) => b - a);
  return ys.length ? { year: ys[0], v: g.get(ys[0]) } : null;
};

// Hourly labor cost for the sector (labor cost survey, national accounts as fallback) and per EUR 100 of value added
function laborCost(geo, nace) {
  const lc = nace === "C" ? latest("lc_hour_c", geo) : latest("lc_hour", geo);
  const fb = !lc ? latest("comp_ph", geo, nace) : null;
  const c = lc || fb; if (!c) return null;
  const va = val("va_hour_nom", geo, c.year, nace) ?? latest("va_hour_nom", geo, nace)?.v;
  return { v: c.v, year: c.year, survey: !!lc, per100: va ? 100 * c.v / va : null };
}

export async function locationCosts(root) {
  await loadLaborSupply();
  const nace = S.hourNace, sector = nace === "C" ? "manufacturing" : "the business economy";
  root.append(h("h2", { class: "section-h" }, "Comparing locations"));
  root.append(h("p", { class: "page-desc section-desc" },
    "Labor is one of several costs an investor compares between locations. The table sets labor cost next to industrial electricity and gas prices and the corporate income tax rate. " +
    "The calculator below combines them for a plant with a given cost structure. It is illustrative: it holds all other costs, prices and productivity differences fixed, except where labor cost is measured per unit of value added."));

  const rows = D.countries.map(c => {
    const l = laborCost(c.geo, nace), e = lsLatest("elec_price", c.geo), g = lsLatest("gas_price", c.geo), t = lsLatest("cit_rate", c.geo);
    return { geo: c.geo, name: c.name, l, e, g, t };
  }).filter(r => r.l || r.e || r.g || r.t);

  // Scorecard
  const cols = [
    { k: "lc", label: "Labor cost per hour", get: r => r.l?.v, f: v => "€" + v.toFixed(1), yr: r => r.l?.year },
    { k: "per100", label: "Labor cost per €100 of value added", get: r => r.l?.per100, f: v => "€" + v.toFixed(0), yr: r => r.l?.year },
    { k: "elec", label: "Electricity, € per kWh", get: r => r.e?.v, f: v => v.toFixed(3), yr: r => r.e?.year },
    { k: "gas", label: "Gas, € per kWh", get: r => r.g?.v, f: v => v.toFixed(3), yr: r => r.g?.year },
    { k: "cit", label: "Corporate income tax", get: r => r.t?.v, f: v => v.toFixed(1) + "%", yr: r => r.t?.year },
  ];
  const f1 = figure({ title: `Location costs, ${sector}`, span: 12,
    sub: "Darker cells mean higher costs within each column.",
    text: "Each value is the latest available year, shown on hover. Economies are sorted by labor cost per €100 of value added. An empty cell means the source does not cover that economy.",
    note: "Labor cost is from the Eurostat labor cost survey (lc_lci_lev) or, where it is missing, compensation per employee hour from the national accounts; value added per hour is from nama_10_a64. " +
      "Electricity (nrg_pc_205, consumption band 2 to 20 GWh a year) and gas (nrg_pc_203, band 10 to 100 TJ a year) are non-household prices excluding VAT and other recoverable taxes, averaged over the two half-years. " +
      "The corporate income tax rate is the combined statutory rate from the OECD Corporate Tax Statistics.",
    csv: () => rows.map(r => Object.fromEntries([["country", r.name], ...cols.map(c => [c.label, c.get(r) ?? ""])])) });
  root.append(grid(f1.el));
  drawScorecard(f1.body, rows, cols);

  // Calculator
  root.append(h("h3", { class: "sub-h" }, "Operating cost of the same plant in different locations"));
  const ctl = h("div", { class: "view-controls calc" });
  root.append(ctl);
  const f2 = figure({ title: `Operating cost relative to ${cname(S.focus)}`, span: 12,
    sub: `${cname(S.focus)} is set to 100.`,
    text: "A value of 90 means the same plant would cost 10% less to operate in that location, given the cost shares above. Only economies with labor, electricity and gas data are shown.",
    method: [String.raw`$C_j = 100 \cdot \Big[\, s_L \frac{L_j}{L_0} + s_E \Big( e \frac{P^{el}_j}{P^{el}_0} + (1-e) \frac{P^{gas}_j}{P^{gas}_0} \Big) + (1 - s_L - s_E) \Big]`,
      "Here s_L and s_E are the shares of labor and energy in operating costs, e is the share of electricity in energy costs, L is labor cost (per hour or per €100 of value added), P are energy prices, and 0 is the selected country. All other costs are assumed to be the same everywhere. Corporate tax is not included because it falls on profits, not on operating costs."],
    csv: () => calc().map(d => ({ country: d.name, cost_index: d.v })) });
  root.append(grid(f2.el));

  const st = { sL: 25, sE: 8, e: 60, basis: "per100" };
  const slider = (label, key, min, max) => {
    const out = h("b", {}, `${st[key]}%`);
    const inp = h("input", { type: "range", class: "range", min, max, step: 1, value: st[key], "aria-label": label });
    inp.addEventListener("input", () => { st[key] = +inp.value; out.textContent = `${st[key]}%`; draw(); });
    return h("div", { class: "slider" }, h("label", {}, h("span", {}, label), out), inp);
  };
  const basisSeg = () => seg("Labor cost measure", [{ value: "per100", label: "Per €100 of value added" }, { value: "hour", label: "Per hour" }], st.basis, v => { st.basis = v; ctl.replaceChild(basisSeg(), ctl.firstChild); draw(); });
  ctl.append(basisSeg(), slider("Labor share of operating costs", "sL", 5, 60), slider("Energy share of operating costs", "sE", 0, 30), slider("Electricity share of energy costs", "e", 0, 100));

  const ref = rows.find(r => r.geo === S.focus);
  function calc() {
    const L = r => st.basis === "hour" ? r.l?.v : r.l?.per100;
    if (!ref || !(L(ref) > 0) || !(ref.e?.v > 0) || !(ref.g?.v > 0)) return [];
    const sL = st.sL / 100, sE = Math.min(st.sE / 100, 1 - sL), e = st.e / 100;
    return rows.filter(r => L(r) > 0 && r.e?.v > 0 && r.g?.v > 0).map(r => ({ geo: r.geo, name: r.name,
      v: 100 * (sL * L(r) / L(ref) + sE * (e * r.e.v / ref.e.v + (1 - e) * r.g.v / ref.g.v) + (1 - sL - sE)) })).sort((a, b) => a.v - b.v);
  }
  function draw() {
    f2.body.innerHTML = "";
    const d = calc();
    if (!d.length) { f2.body.append(h("p", { class: "empty" }, `The calculation needs labor, electricity and gas data for ${cname(S.focus)}, which are not all available. Choosing another country in the bar above may help.`)); return; }
    drawIndexBars(f2.body, d);
  }
  draw();
}

function drawScorecard(host, rows, cols) {
  rows = [...rows].sort((a, b) => (a.l?.per100 ?? 1e9) - (b.l?.per100 ?? 1e9));
  const ramp = d3.interpolateRgbBasis(seqRamp());
  const scales = Object.fromEntries(cols.map(c => {
    const vs = rows.map(c.get).filter(v => v != null).sort(d3.ascending);
    return [c.k, d3.scaleLinear([d3.quantileSorted(vs, .05) ?? 0, d3.quantileSorted(vs, .95) ?? 1], [0.05, 0.85]).clamp(true)];
  }));
  host.append(h("div", { class: "table-scroll tall" }, h("table", { class: "data scorecard" },
    h("thead", {}, h("tr", {}, h("th", {}, "Economy"), cols.map(c => h("th", { class: "num" }, c.label)))),
    h("tbody", {}, rows.map(r => h("tr", { class: r.geo === S.focus ? "focus" : S.comps.includes(r.geo) ? "comp" : "" },
      h("td", {}, htmlFlag(r.geo), " ", r.name),
      cols.map(c => {
        const v = c.get(r);
        if (v == null) return h("td", { class: "num empty-cell" }, "");
        const t = scales[c.k](v), bg = ramp(t);
        return h("td", { class: "num heat", style: `background:${bg};color:${t > 0.5 ? "#fff" : "var(--text)"}`, title: `${c.label}: ${c.f(v)} (${c.yr(r)})` }, c.f(v));
      })))))));
}

function drawIndexBars(host, rows) {
  const width = widthOf(host), rowH = 18, m = { l: 172, r: 56, t: 16, b: 6 };
  const height = rows.length * rowH + m.t + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear([0, Math.max(110, d3.max(rows, d => d.v))], [m.l, width - m.r]).nice();
  rows.forEach((d, i) => {
    const y = m.t + i * rowH, cy = y + (rowH - 6) / 2;
    const g = svg.append("g").on("mousemove", ev => showTip(ev, `<div class="tt-title">${d.name}</div>${ttRow("Cost index", d.v.toFixed(1))}`)).on("mouseleave", hideTip);
    if (d.geo === S.focus) g.append("rect").attr("class", "row-hl").attr("x", 0).attr("y", y - 2).attr("width", width).attr("height", rowH);
    svgFlag(g, d.geo, m.l - 24, cy, 12);
    g.append("text").attr("class", d.geo === S.focus ? "label-strong" : "label").attr("x", m.l - 30).attr("y", cy).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(d.name);
    g.append("rect").attr("x", m.l).attr("y", y).attr("height", rowH - 6).attr("width", Math.max(0, x(d.v) - m.l))
      .attr("fill", d.geo === S.focus || S.comps.includes(d.geo) ? countryColor(d.geo) : cssVar("--context"));
    g.append("text").attr("class", "label").attr("x", x(d.v) + 6).attr("y", cy).attr("dominant-baseline", "middle").text(d.v.toFixed(0));
  });
  svg.append("line").attr("class", "eu-line").attr("x1", x(100)).attr("x2", x(100)).attr("y1", 10).attr("y2", height);
  svg.append("text").attr("class", "annot").attr("x", x(100)).attr("y", 8).attr("text-anchor", "middle").text(`${cname(S.focus)} = 100`);
}

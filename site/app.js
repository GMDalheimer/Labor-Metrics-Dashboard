// Labor Cost Atlas: router, context bar, theme
import { S, D, EU, load, readHash, writeHash, h, select, countryOptions, sectorOptions, yearOptions, cname, coverage, endYear, countryColor, hideTip, resetFigures } from "./core.js";
import { overview, ulc, country, compare, hour, stopPlay } from "./views1.js";
import { industries, structure, analysis, methods } from "./views2.js";
import { casestudy } from "./views3.js";

const VIEWS = {
  overview:   { label: "Overview",          fn: overview,   ctx: ["focus", "sector"] },
  ulc:        { label: "Unit labor costs",  fn: ulc,        ctx: ["focus", "comps", "period", "sector"] },
  country:    { label: "Country profile",   fn: country,    ctx: ["focus", "period"] },
  compare:    { label: "Comparison",        fn: compare,    ctx: ["focus", "comps", "period"] },
  hour:       { label: "Cost of an hour",   fn: hour,       ctx: ["focus", "comps"] },
  industries: { label: "Industries",        fn: industries, ctx: ["focus", "comps"] },
  structure:  { label: "Economy structure", fn: structure,  ctx: ["focus", "period"] },
  analysis:   { label: "Analysis",          fn: analysis,   ctx: ["focus", "comps", "period", "sector"] },
  casestudy:  { label: "Country case study", fn: casestudy, ctx: [] },
  methods:    { label: "Methods",           fn: methods,    ctx: [] },
};

const app = document.getElementById("app");
const nav = document.getElementById("nav");
const ctxBar = document.getElementById("context");

function buildNav() {
  nav.innerHTML = "";
  for (const [k, v] of Object.entries(VIEWS)) {
    nav.append(h("a", { href: `#/${k}`, class: k === S.view ? "active" : "", onclick: e => { e.preventDefault(); S.view = k; writeHash(true); render(); } }, v.label));
  }
}

function buildContext() {
  ctxBar.innerHTML = "";
  const ctx = VIEWS[S.view].ctx;
  if (!ctx.length) { ctxBar.hidden = true; return; }
  ctxBar.hidden = false;
  const change = patch => { Object.assign(S, patch); writeHash(); render(); };
  const parts = [];
  if (ctx.includes("focus")) parts.push(select("Country", countryOptions(), S.focus, v => change({ focus: v, comps: S.comps.filter(c => c !== v) })));
  if (ctx.includes("comps")) {
    const tags = S.comps.filter(c => c !== S.focus).map(c => h("button", { class: "tag", title: `Remove ${cname(c)}`,
      onclick: () => change({ comps: S.comps.filter(x => x !== c) }) },
      h("span", { class: "swatch", style: `background:${countryColor(c)}` }), cname(c), h("span", { class: "x", "aria-hidden": "true" }, "×")));
    const add = h("select", { class: "select add", "aria-label": "Add comparison country", onchange: e => { if (e.target.value) change({ comps: [...S.comps, e.target.value].slice(0, 3) }); } },
      h("option", { value: "" }, S.comps.length >= 3 ? "Maximum of three" : "Add country"),
      ...(S.comps.length >= 3 ? [] : countryOptions(true).filter(o => o.value !== S.focus && !S.comps.includes(o.value)).map(o => h("option", { value: o.value }, o.label))));
    parts.push(h("div", { class: "field" }, h("span", { class: "field-label" }, "Compared with"), h("div", { class: "tags" }, tags, add)));
  }
  if (ctx.includes("period")) {
    const ys = coverage("prod", "TOTAL").years;
    parts.push(h("div", { class: "field period" }, h("span", { class: "field-label" }, "Period"),
      h("div", { class: "period-row" },
        select("From", yearOptions(ys.slice(0, -1)), S.base, v => change({ base: +v }), { compact: true }),
        h("span", { class: "dash" }, "to"),
        select("To", yearOptions(ys.filter(y => y > S.base)), endYear(), v => change({ end: +v }), { compact: true }))));
  }
  if (ctx.includes("sector")) parts.push(select("Sector", sectorOptions(), S.nace, v => change({ nace: v })));
  ctxBar.append(h("div", { class: "ctx-inner" }, parts));
}

let rendering = 0;
async function render() {
  stopPlay(); hideTip(); resetFigures();
  if (!VIEWS[S.view]) S.view = "overview";
  if (!D.name.has(S.focus)) S.focus = D.countries[0].geo;
  S.comps = S.comps.filter(c => D.name.has(c) && c !== S.focus);
  buildNav(); buildContext();
  const token = ++rendering;
  const root = h("div", { class: "view" });
  app.innerHTML = ""; app.append(root);
  document.title = `${VIEWS[S.view].label} · Labor Cost Atlas`;
  try { await VIEWS[S.view].fn(root); }
  catch (e) { console.error(e); if (token === rendering) root.append(h("p", { class: "empty" }, "This view could not be drawn: " + e.message)); }
}

function initTheme() {
  let t = "light";
  try { t = localStorage.getItem("lca-theme") || t; } catch (e) { /* storage unavailable */ }
  document.documentElement.dataset.theme = t;
  const btns = document.querySelectorAll("#theme button");
  const mark = () => btns.forEach(b => b.classList.toggle("on", b.dataset.theme === document.documentElement.dataset.theme));
  btns.forEach(b => b.addEventListener("click", () => {
    document.documentElement.dataset.theme = b.dataset.theme;
    try { localStorage.setItem("lca-theme", b.dataset.theme); } catch (e) { /* ignore */ }
    mark(); render();
  }));
  mark();
}

(async function main() {
  initTheme();
  readHash();
  try { await load(); }
  catch (e) { app.innerHTML = `<p class="empty">The data could not be loaded: ${e.message}</p>`; return; }
  document.getElementById("build-date").textContent = D.meta.built ? `Data retrieved ${D.meta.built.slice(0, 10)}.` : "";
  writeHash();
  render();
  addEventListener("lca:render", render);
  addEventListener("popstate", () => { readHash(); render(); });
  let rt; let lastW = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) < 40) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(render, 250); });
})();

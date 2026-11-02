// Country brief: five plain-language questions produce a short document in the atlas design,
// with the most relevant figures for the reader's question. It can be saved as a PDF.
import {
  d3, EU, S, D, loadFull, val, series, latest, coverage, growth, fmt, pct, cname, cssVar, setColorScope,
  h, select, countryOptions, svgEl, lineChart, legend, kpiRow, showTip, hideTip, ttRow,
} from "./core.js";
import { hourData, computeHour } from "./views1.js";

const rerender = () => window.dispatchEvent(new Event("lca:render"));

const TOPICS = [
  { key: "cost", q: "Is it a cost-competitive place to produce?", d: "How much labor costs per unit of output, and how that has changed compared with other countries" },
  { key: "catchup", q: "Is it catching up with the EU?", d: "Output and pay per worker relative to the EU average over time" },
  { key: "pay", q: "How well are workers paid?", d: "Pay per employee, the minimum wage and the share of income that goes to workers" },
  { key: "breakdown", q: "What does an hour of work cost an employer, and where does the money go?", d: "Take-home pay, taxes and contributions in one hour of labor cost" },
  { key: "industries", q: "Which industries drive the economy?", d: "Where people work and how productive those activities are" },
  { key: "hours", q: "How much do people work?", d: "Hours worked per week and per year" },
];
const PERIODS = [{ value: "last5", label: "Recent years (last five)" }, { value: "2015", label: "Since the mid-2010s" }, { value: "2005", label: "Long term (since 2005)" }];
const DEPTH = [
  { value: "summary", label: "A one-page summary", d: "Key numbers and one finding per question" },
  { value: "brief", label: "A short brief", d: "One page per question, with a chart and a plain-language explanation" },
  { value: "detailed", label: "A detailed brief", d: "Additional charts, definitions and method notes" },
];

const CS = { geo: null, comps: null, preset: "neighbours", topics: ["cost", "catchup"], period: "2015", depth: "brief", built: false };

function presets(geo) {
  const region = D.region.get(geo);
  const has = g => D.name.has(g) && g !== geo && latest("prod_hour", g, "TOTAL");
  return [
    { value: "neighbours", label: `Its neighbours (${region})`, comps: D.countries.filter(c => c.region === region && has(c.geo)).map(c => c.geo).slice(0, 3) },
    { value: "investors", label: "Countries competing for the same investors", comps: ["PL", "HU", "RO", "BG", "SK", "CZ"].filter(has).slice(0, 3) },
    { value: "large", label: "Large EU economies", comps: ["DE", "FR", "IT"].filter(has) },
    { value: "eu", label: "Only the EU average", comps: [] },
    { value: "custom", label: "I will choose", comps: null },
  ];
}

export async function casestudy(root) {
  CS.geo = CS.geo || S.focus;
  const ps = presets(CS.geo);
  if (!CS.comps) CS.comps = ps[0].comps;
  if (CS.built) return brief(root);

  root.append(h("header", { class: "page-head" },
    h("p", { class: "kicker" }, "Country brief"),
    h("h1", { class: "page-title" }, "Create a short country brief"),
    h("p", { class: "page-desc" }, "The atlas contains many indicators. Answer five questions and it selects the figures that matter for what you want to know, adds a short explanation of each, and lays them out as a brief that can be saved as a PDF.")));

  const form = h("ol", { class: "wizard" });
  root.append(form);
  const step = (n, title, help, ...body) => form.append(h("li", { class: "step" },
    h("div", { class: "step-no" }, String(n)),
    h("div", { class: "step-body" }, h("h2", { class: "step-q" }, title), help ? h("p", { class: "step-help" }, help) : null, ...body)));

  step(1, "Which country do you want to know about?", null,
    select("Country", countryOptions(), CS.geo, v => { CS.geo = v; const p = presets(v).find(x => x.value === CS.preset); if (p?.comps) CS.comps = p.comps; else CS.comps = CS.comps.filter(c => c !== v); rerender(); }));

  step(2, "What would you like to find out?", "Choose up to three questions. Each one becomes a section of the brief.",
    h("div", { class: "choice-col" }, TOPICS.map(t => {
      const on = CS.topics.includes(t.key), full = !on && CS.topics.length >= 3;
      return h("button", { class: `choice wide ${on ? "on" : ""} ${full ? "muted" : ""}`, role: "checkbox", "aria-checked": on ? "true" : "false", disabled: full ? "disabled" : false,
        onclick: () => { CS.topics = on ? CS.topics.filter(k => k !== t.key) : [...CS.topics, t.key]; rerender(); } },
        h("span", { class: "check", "aria-hidden": "true" }, on ? "✓" : ""), h("span", {}, h("b", {}, t.q), h("small", {}, t.d)));
    })));

  const custom = CS.preset === "custom";
  step(3, "Who should it be compared with?", "The EU average is always included.",
    h("div", { class: "choice-row" }, ps.map(p => h("button", { class: `choice ${CS.preset === p.value ? "on" : ""}`,
      onclick: () => { CS.preset = p.value; if (p.comps) CS.comps = p.comps; rerender(); } }, p.label))),
    h("p", { class: "step-help" }, CS.comps.length ? `Selected: ${CS.comps.map(cname).join(", ")} and the EU average.` : "Selected: the EU average."),
    custom ? h("div", { class: "tags" }, CS.comps.map(g => h("button", { class: "tag", onclick: () => { CS.comps = CS.comps.filter(x => x !== g); rerender(); } }, cname(g), h("span", { class: "x" }, "×"))),
      CS.comps.length < 3 ? h("select", { class: "select add", "aria-label": "Add a country", onchange: e => { if (e.target.value) { CS.comps.push(e.target.value); rerender(); } } },
        h("option", { value: "" }, "Add a country"), ...countryOptions().filter(o => o.value !== CS.geo && !CS.comps.includes(o.value)).map(o => h("option", { value: o.value }, o.label))) : null) : null);

  step(4, "How far back should it look?", null,
    h("div", { class: "choice-row" }, PERIODS.map(p => h("button", { class: `choice ${CS.period === p.value ? "on" : ""}`, onclick: () => { CS.period = p.value; rerender(); } }, p.label))));

  step(5, "How much detail do you need?", null,
    h("div", { class: "choice-col" }, DEPTH.map(p => h("button", { class: `choice wide ${CS.depth === p.value ? "on" : ""}`, onclick: () => { CS.depth = p.value; rerender(); } },
      h("span", { class: "check round", "aria-hidden": "true" }, CS.depth === p.value ? "●" : ""), h("span", {}, h("b", {}, p.label), h("small", {}, p.d))))));

  root.append(h("div", { class: "wizard-go" },
    h("button", { class: "primary", disabled: CS.topics.length ? false : "disabled", onclick: () => { CS.built = true; rerender(); window.scrollTo(0, 0); } }, "Create the brief"),
    CS.topics.length ? null : h("span", { class: "field-label" }, "Choose at least one question in step 2.")));
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------
async function brief(root) {
  if (CS.topics.includes("industries")) await loadFull();
  const geo = CS.geo, name = cname(geo);
  const end = Math.min(coverage("prod", "TOTAL").latest, latest("prod", geo, "TOTAL")?.year || 9999);
  const base = CS.period === "last5" ? end - 5 : +CS.period;
  const all = [geo, ...CS.comps, EU];

  root.append(h("div", { class: "deck-bar no-print" },
    h("button", { class: "link-btn", onclick: () => { CS.built = false; rerender(); } }, "← Change the answers"),
    h("button", { class: "primary", onclick: () => window.print() }, "Save as PDF"),
    h("span", { class: "field-label" }, "Choose “Save as PDF” in the print dialog. Each page prints on one A4 landscape sheet.")));
  const doc = h("div", { class: "brief", "data-theme": "light" });
  root.append(doc);
  setColorScope(doc);
  const color = g => g === geo ? cssVar("--s1") : g === EU ? cssVar("--eu") : cssVar(`--s${CS.comps.indexOf(g) + 2}`);
  const lgd = () => legend(all.map(g => ({ label: cname(g), color: color(g) })));
  const chg = (m, g, nace = "TOTAL") => { const a = val(m, g, base, nace), b = val(m, g, end, nace); return a > 0 && b > 0 ? b / a - 1 : null; };
  const p0 = d3.format(".0%");
  const detailed = CS.depth === "detailed", summary = CS.depth === "summary";
  let pageNo = 0, figNo = 0;

  const page = (kicker, title) => {
    pageNo += 1;
    const body = h("div", { class: "pg-body" });
    const el = h("section", { class: "pg" },
      h("header", { class: "pg-head" }, h("span", { class: "pg-brand" }, h("span", { class: "brand-mark" }), "Labor Cost Atlas"), h("span", {}, `${name} · country brief`)),
      kicker ? h("p", { class: "kicker" }, kicker) : null,
      title ? h("h2", { class: "pg-title" }, title) : null,
      body,
      h("footer", { class: "pg-foot" }, h("span", {}, "Tony Blair Institute for Global Change · Gregor Dalheimer, Abaigeal Heneghan"), h("span", {}, `Sources: Eurostat, ILOSTAT · ${pageNo}`)));
    doc.append(el);
    return body;
  };
  const fig = (host, title, sub, note) => {
    figNo += 1;
    const b = h("div", { class: "fig-body" });
    host.append(h("figure", { class: "fig" },
      h("div", { class: "fig-head" }, h("div", {}, h("h3", { class: "fig-title" }, h("span", { class: "fig-no" }, `Figure ${figNo}`), title), sub ? h("p", { class: "fig-sub" }, sub) : null)),
      b, note ? h("p", { class: "fig-note" }, note) : null));
    return b;
  };
  const twoCol = (host, text, chartFn) => {
    const left = h("div", { class: "pg-text" }), right = h("div", { class: "pg-chart" });
    host.append(h("div", { class: "pg-cols" }, left, right));
    text.forEach(t => left.append(typeof t === "string" ? h("p", {}, t) : t));
    chartFn(right);
  };
  const lines = (m, transform, nace = "TOTAL") => all.map(g => {
    let data = series(m, g, nace).filter(d => d.year >= base && d.year <= end);
    if (transform) data = transform(g, data);
    return { key: g, label: cname(g), color: color(g), width: g === geo ? 3 : 2, dash: g === EU ? "5 4" : null, data };
  }).filter(s => s.data.length);
  const idx = (g, d) => { const b = d.find(x => x.year === base); return b ? d.map(x => ({ year: x.year, v: 100 * x.v / b.v })) : []; };
  const relEU = m => (g, d) => d.map(x => { const e = val(m, EU, x.year, "TOTAL"); return e ? { year: x.year, v: 100 * x.v / e } : null; }).filter(Boolean);

  // --- findings (computed once, used by the summary page and the topic pages) ---
  const F = {};
  if (CS.topics.includes("cost")) {
    const u = chg("ulc", geo), ue = chg("ulc", EU);
    const others = CS.comps.map(g => ({ g, u: chg("ulc", g) })).filter(d => d.u != null);
    const faster = others.filter(d => u != null && d.u > u).length;
    const hr = all.map(g => ({ g, c: computeHour(hourData(g)) })).filter(r => r.c?.per100);
    F.cost = { u, ue, others, hr, text: u != null ? `Labor cost per unit of output ${u >= 0 ? "rose" : "fell"} by ${p0(Math.abs(u))} between ${base} and ${end}${ue != null ? `, against ${p0(ue)} in the EU` : ""}${others.length ? (faster === 0 ? "; this was the largest increase among the countries compared" : `; ${faster} of ${others.length} comparison ${others.length === 1 ? "country" : "countries"} recorded a larger increase`) : ""}.` : "Unit labor cost data are not available for this period." };
  }
  if (CS.topics.includes("catchup")) {
    const r = (m, y) => { const a = val(m, geo, y, "TOTAL"), e = val(m, EU, y, "TOTAL"); return a && e ? a / e : null; };
    const p_0 = r("prod_hour", base), p_1 = r("prod_hour", end), w_0 = r("comp_pe", base), w_1 = r("comp_pe", end);
    F.catchup = { p_0, p_1, w_0, w_1, text: p_0 && p_1 ? `Output per hour worked moved from ${p0(p_0)} to ${p0(p_1)} of the EU level between ${base} and ${end}${w_0 && w_1 ? `; pay per employee moved from ${p0(w_0)} to ${p0(w_1)} of the EU level` : ""}.` : "Productivity data relative to the EU are not available for this period." };
  }
  if (CS.topics.includes("pay")) {
    const cp = chg("comp_pe", geo), pr = chg("prod", geo), mw = latest("min_wage_eur", geo), ratio = latest("min_wage_ratio", geo), ls = latest("labour_share", geo, "TOTAL");
    F.pay = { cp, pr, mw, ratio, ls, text: cp != null ? `Pay per employee rose by ${p0(cp)} between ${base} and ${end}${pr != null ? `, while output per worker rose by ${p0(pr)}` : ""}.${mw ? ` The minimum wage is ${fmt("min_wage_eur", mw.v)} per month (${mw.year})${ratio ? `, ${p0(ratio.v)} of average earnings` : ""}.` : ""}` : "Pay data are not available for this period." };
  }
  if (CS.topics.includes("breakdown")) {
    const rows = all.map(g => ({ g, d: hourData(g), c: computeHour(hourData(g)) })).filter(r => r.c);
    const me = rows.find(r => r.g === geo);
    F.breakdown = { rows, text: me ? `In manufacturing, an hour of work costs employers ${"€" + me.c.total.toFixed(2)} (${me.d.lc.year}); about ${p0(me.c.net / me.c.total)} of this reaches the worker as net pay.` : "Hourly labor cost data are not available." };
  }
  if (CS.topics.includes("industries")) {
    const secs = "A B C D E F G H I J K L M N O P Q R S".split(" ");
    const y = [end, end - 1].find(yy => D.full.idx.get(`${geo}|TOTAL|${yy}`)?.emp);
    const tot = y && D.full.idx.get(`${geo}|TOTAL|${y}`);
    const rows = tot ? secs.map(L => ({ L, r: D.full.idx.get(`${geo}|${L}|${y}`) })).filter(d => d.r?.emp)
      .map(d => ({ L: d.L, label: (D.nace.get(d.L) || d.L).split(";")[0], share: d.r.emp / tot.emp, rel: d.r.prod && tot.prod ? d.r.prod / tot.prod : null }))
      .sort((a, b) => b.share - a.share) : [];
    F.industries = { rows, y, text: rows.length ? `${rows[0].label} accounts for the largest share of employment (${p0(rows[0].share)}, ${y})${rows[1] ? `, followed by ${rows[1].label.toLowerCase()} (${p0(rows[1].share)})` : ""}.` : "Employment by activity is not available." };
  }
  if (CS.topics.includes("hours")) {
    const hw = latest("hours_week", geo), hy = latest("hours_worker", geo, "TOTAL"), he = latest("hours_worker", EU, "TOTAL");
    F.hours = { hw, hy, he, text: hw ? `Employed people work on average ${hw.v.toFixed(1)} hours per week (${hw.year})${hy && he ? `; annual hours per worker are ${d3.format(",.0f")(hy.v)}, against ${d3.format(",.0f")(he.v)} in the EU` : ""}.` : "Hours data are not available." };
  }

  // --- Cover page ---
  const ph = latest("prod_hour", geo, "TOTAL"), lc = latest("lc_hour", geo), u = chg("ulc", geo);
  const cover = page(null, null);
  cover.parentElement.classList.add("pg-cover");
  cover.append(
    h("p", { class: "kicker" }, "Country brief"),
    h("h1", { class: "cover-title" }, name),
    h("p", { class: "cover-sub" }, `Labor costs and productivity, ${base}–${end}, compared with ${CS.comps.length ? CS.comps.map(cname).join(", ") + " and " : ""}the EU average`),
    kpiRow([
      ph ? { label: "Value added per hour worked", value: fmt("prod_hour", ph.v), foot: `${ph.year}; EU ${fmt("prod_hour", val("prod_hour", EU, ph.year, "TOTAL"))}` } : null,
      lc ? { label: "Hourly labor cost", value: fmt("lc_hour", lc.v), foot: `${lc.year}; EU ${fmt("lc_hour", val("lc_hour", EU, lc.year))}` } : null,
      u != null ? { label: `Unit labor cost, ${base}–${end}`, value: pct(u), foot: `EU ${chg("ulc", EU) != null ? pct(chg("ulc", EU)) : "n/a"}` } : null,
      latest("min_wage_eur", geo) ? { label: "Monthly minimum wage", value: fmt("min_wage_eur", latest("min_wage_eur", geo).v), foot: String(latest("min_wage_eur", geo).year) } : null,
    ].filter(Boolean)),
    h("h3", { class: "cover-h" }, "Main findings"),
    h("ol", { class: "findings" }, CS.topics.map(k => h("li", {}, h("b", {}, TOPICS.find(t => t.key === k).q), " ", F[k].text))));
  if (summary) {
    cover.append(h("p", { class: "pg-note" }, `Figures are the latest available for each indicator; years can differ. Generated with the Labor Cost Atlas on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`));
  }

  // --- Topic pages ---
  if (!summary) {
    if (F.cost) {
      const b = page(TOPICS[0].q, F.cost.text);
      twoCol(b, [
        "Unit labor cost is the cost of the labor needed to produce one unit of output: pay per employee divided by output per worker. It rises when pay grows faster than productivity.",
        "The chart sets each country's level in the first year to 100, so the lines show change over time. Levels are not compared across countries because output is measured at national prices.",
        ...(F.cost.hr.length ? [`In manufacturing, labor costs ${"€" + F.cost.hr.find(r => r.g === geo)?.c.per100.toFixed(0)} for every €100 of value added in ${name}${F.cost.hr.filter(r => r.g !== geo).length ? ", compared with " + F.cost.hr.filter(r => r.g !== geo).map(r => `€${r.c.per100.toFixed(0)} in ${cname(r.g)}`).join(", ") : ""}.`] : []),
      ], host => {
        lineChart(fig(host, "Unit labor cost", `Index, ${base} = 100`, "Source: Eurostat national accounts."), lines("ulc", idx), { height: 300, yFormat: d3.format(".0f"), indexLine: true });
        host.append(lgd());
      });
      if (detailed) {
        const b2 = page(TOPICS[0].q, "Pay growth and productivity growth behind the change");
        twoCol(b2, [
          "The change in unit labor cost equals the growth of pay per employee minus the growth of output per worker (both in log points).",
          "A long bar to the right of the productivity marker means pay grew faster than output per worker.",
        ], host => dumbbell(fig(host, `Cumulative growth, ${base}–${end}`, "Log points. Teal: output per worker. Blue: pay per employee.", "Source: Eurostat national accounts; author's calculation."), all, base, end, color));
      }
    }
    if (F.catchup) {
      const b = page(TOPICS[1].q, F.catchup.text);
      twoCol(b, [
        "The lines show output per hour worked as a percentage of the EU average in the same year. A rising line means the gap to the EU is narrowing.",
        "Output is measured in constant euros at national prices, so the comparison does not adjust for differences in price levels between countries.",
      ], host => {
        lineChart(fig(host, "Output per hour worked relative to the EU", "Percent of the EU27 value", "Source: Eurostat national accounts."), lines("prod_hour", relEU("prod_hour")).filter(s => s.key !== EU), { height: 300, yFormat: v => v.toFixed(0) + "%", refLine: 100 });
        host.append(lgd());
      });
      if (detailed) {
        const b2 = page(TOPICS[1].q, "Pay per employee relative to the EU");
        twoCol(b2, ["Pay per employee in euros as a percentage of the EU average. It includes employer social contributions."],
          host => { lineChart(fig(host, "Pay per employee relative to the EU", "Percent of the EU27 value, nominal euros", "Source: Eurostat national accounts."), lines("comp_pe", relEU("comp_pe")).filter(s => s.key !== EU), { height: 300, yFormat: v => v.toFixed(0) + "%", refLine: 100 }); host.append(lgd()); });
      }
    }
    if (F.pay) {
      const b = page(TOPICS[2].q, F.pay.text);
      twoCol(b, [
        "Pay per employee is the average yearly labor cost of an employee, including employer social contributions.",
        F.pay.ls ? `Workers receive ${p0(F.pay.ls.v)} of the value added in the economy as compensation (${F.pay.ls.year}).` : "",
      ].filter(Boolean), host => {
        lineChart(fig(host, "Pay per employee", "EUR per year, nominal", "Source: Eurostat national accounts."), lines("comp_pe"), { height: 300, yFormat: v => "€" + d3.format(",.0f")(v) });
        host.append(lgd());
      });
      if (detailed) {
        const rows = all.map(g => ({ label: cname(g), v: latest("min_wage_eur", g)?.v, color: color(g) })).filter(r => r.v != null);
        if (rows.length) { const b2 = page(TOPICS[2].q, "Statutory minimum wage"); twoCol(b2, ["Gross monthly minimum wage set by law, latest semester available."], host => bars(fig(host, "Monthly minimum wage", "EUR, gross", "Source: Eurostat earn_mw_cur."), rows, v => "€" + d3.format(",.0f")(v))); }
      }
    }
    if (F.breakdown) {
      const b = page(TOPICS[3].q, F.breakdown.text);
      twoCol(b, [
        "Hourly labor cost is what an employer pays for one hour actually worked. It is split into the worker's net pay, the income tax and social contributions paid by the worker, and the contributions and other costs paid by the employer.",
        "The split uses the tax rates of a single worker on a low wage, so it is an approximation for the average job.",
      ], host => stacked(fig(host, "Composition of hourly labor cost, manufacturing", "EUR per hour actually worked, latest year", "Sources: Eurostat lc_lci_lev, earn_nt_taxwedge."), F.breakdown.rows));
    }
    if (F.industries && F.industries.rows.length) {
      const b = page(TOPICS[4].q, F.industries.text);
      twoCol(b, [
        "Bars show each activity's share of all jobs. The color shows whether output per worker in the activity is above or below the national average.",
        "Activities with many jobs and below-average output per worker, often agriculture and parts of services, lower the national average.",
      ], host => {
        bars(fig(host, `Employment by activity, ${F.industries.y}`, "Percent of persons employed", "Source: Eurostat nama_10_a64_e, nama_10_a64."),
          F.industries.rows.slice(0, 9).map(r => ({ label: r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label, v: 100 * r.share, color: r.rel == null ? cssVar("--context-hi") : r.rel >= 1 ? cssVar("--s2") : cssVar("--s3"), extra: r.rel != null ? `${r.rel.toFixed(2)}×` : "" })), v => v.toFixed(0) + "%");
        host.append(legend([{ label: "Output per worker above national average", color: cssVar("--s2") }, { label: "Below national average", color: cssVar("--s3") }]));
      });
    }
    if (F.hours) {
      const b = page(TOPICS[5].q, F.hours.text);
      twoCol(b, ["Average hours actually worked per week by all employed people, from labor force surveys."],
        host => bars(fig(host, "Weekly hours actually worked", "Hours per employed person", "Source: ILOSTAT."), all.map(g => ({ label: cname(g), v: latest("hours_week", g)?.v, color: color(g) })).filter(r => r.v != null), v => v.toFixed(1)));
    }
    // Notes
    const n = page("About this brief", "Data and definitions");
    n.append(h("ul", { class: "pg-list" },
      h("li", {}, "All figures come from Eurostat and ILOSTAT and are updated automatically; figures are the latest available, and years can differ between countries and indicators."),
      h("li", {}, "Unit labor cost = pay per employee ÷ real output per worker. Real output is measured in chain-linked 2020 euros at national prices."),
      detailed ? h("li", {}, "Changes are computed as log differences; the change in unit labor cost equals the change in pay per employee minus the change in output per worker.") : null,
      detailed ? h("li", {}, "Hourly labor cost comes from the labor cost survey; value added and hours from the national accounts. Ratios between the two are indicative.") : null,
      h("li", {}, `The interactive Labor Cost Atlas, with all indicators, formulas and limitations: ${location.origin}${location.pathname}`),
      h("li", {}, `Generated on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Authors: Gregor Dalheimer and Abaigeal Heneghan, Tony Blair Institute for Global Change.`)));
  }
  setColorScope(null);
}

function bars(host, rows, f) {
  const width = Math.max(420, host.getBoundingClientRect().width), rowH = 30, m = { l: 230, r: 70 };
  const svg = svgEl(host, width, rows.length * rowH + 6);
  const x = d3.scaleLinear([0, d3.max(rows, r => r.v) || 1], [m.l, width - m.r]);
  rows.forEach((r, i) => {
    const y = i * rowH + 3;
    svg.append("text").attr("class", "label").attr("x", m.l - 10).attr("y", y + 11).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(r.label);
    svg.append("rect").attr("x", m.l).attr("y", y).attr("height", 22).attr("width", Math.max(1, x(r.v) - m.l)).attr("fill", r.color);
    svg.append("text").attr("class", "label-strong").attr("x", x(r.v) + 8).attr("y", y + 11).attr("dominant-baseline", "middle").text(f(r.v) + (r.extra ? `  (${r.extra})` : ""));
  });
}

function stacked(host, rows) {
  const parts = [["net", "Net pay", "--s1"], ["employeeTax", "Income tax and employee contributions", "--s2"], ["employer", "Employer contributions and other costs", "--s3"]];
  const width = Math.max(420, host.getBoundingClientRect().width), rowH = 40, m = { l: 140, r: 70 };
  const svg = svgEl(host, width, rows.length * rowH + 6);
  const x = d3.scaleLinear([0, d3.max(rows, r => r.c.total)], [m.l, width - m.r]);
  rows.forEach((r, i) => {
    const y = i * rowH + 3; let acc = 0;
    svg.append("text").attr("class", "label-strong").attr("x", m.l - 10).attr("y", y + 15).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(cname(r.g));
    for (const [k, lab, c] of parts) {
      const v = r.c[k];
      svg.append("rect").attr("x", x(acc) + 1).attr("y", y).attr("height", 30).attr("width", Math.max(0, x(acc + v) - x(acc) - 2)).attr("fill", cssVar(c));
      acc += v;
    }
    svg.append("text").attr("class", "label-strong").attr("x", x(acc) + 8).attr("y", y + 15).attr("dominant-baseline", "middle").text("€" + r.c.total.toFixed(2));
  });
  host.append(legend(parts.map(([, lab, c]) => ({ label: lab, color: cssVar(c) }))));
}

function dumbbell(host, geos, base, end, color) {
  const lg = (m, g) => { const a = val(m, g, base, "TOTAL"), b = val(m, g, end, "TOTAL"); return a > 0 && b > 0 ? 100 * Math.log(b / a) : null; };
  const rows = geos.map(g => ({ g, c: lg("comp_pe", g), p: lg("prod", g) })).filter(r => r.c != null && r.p != null);
  const width = Math.max(420, host.getBoundingClientRect().width), rowH = 34, m = { l: 140, r: 30, b: 26 };
  const height = rows.length * rowH + m.b;
  const svg = svgEl(host, width, height);
  const x = d3.scaleLinear(d3.extent(rows.flatMap(r => [r.c, r.p, 0])), [m.l, width - m.r]).nice();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  rows.forEach((r, i) => {
    const y = i * rowH + 14;
    svg.append("text").attr("class", "label-strong").attr("x", m.l - 10).attr("y", y).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(cname(r.g));
    svg.append("line").attr("x1", x(r.p)).attr("x2", x(r.c)).attr("y1", y).attr("y2", y).attr("stroke", cssVar("--s1")).attr("stroke-width", 3).attr("stroke-opacity", .35);
    svg.append("circle").attr("cx", x(r.p)).attr("cy", y).attr("r", 6).attr("fill", cssVar("--s2"));
    svg.append("circle").attr("cx", x(r.c)).attr("cy", y).attr("r", 6).attr("fill", cssVar("--s1"));
  });
}

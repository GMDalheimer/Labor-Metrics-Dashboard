// Country case study: five plain-language questions produce a short slide deck that can be saved as PDF
import { METRIC } from "./metrics.js";
import {
  d3, EU, S, D, writeHash, loadFull, val, series, latest, coverage, growth, fmt, pct, cname, cssVar, setColorScope,
  h, select, countryOptions, svgEl, lineChart, legend, kpiRow, yearOptions,
} from "./core.js";
import { hourData, computeHour } from "./views1.js";

const rerender = () => window.dispatchEvent(new Event("lca:render"));

const TOPICS = [
  { key: "cost", q: "Is it competitive on labor costs?", d: "How labor costs per unit of output have developed, and what an hour of work costs" },
  { key: "prod", q: "Is productivity catching up?", d: "Output per hour worked compared with the EU average" },
  { key: "wages", q: "Where do wages stand?", d: "Pay per employee, the minimum wage and the share of income going to workers" },
  { key: "hours", q: "How much do people work?", d: "Hours worked per week and per year" },
  { key: "industries", q: "Which industries matter?", d: "Where people work and how productive those activities are" },
];
const PERIODS = [
  { value: "2010", label: "Since 2010" },
  { value: "2016", label: "Since 2016" },
  { value: "last5", label: "The last five years" },
];

const CS = { geo: null, comps: null, topics: ["cost", "prod", "wages"], period: "2016", audience: "general", built: false };

export async function casestudy(root) {
  CS.geo = CS.geo || S.focus;
  CS.comps = CS.comps || S.comps.slice(0, 3);
  if (CS.built) return deck(root);

  root.append(h("header", { class: "page-head" },
    h("p", { class: "kicker" }, "Country case study"),
    h("h1", { class: "page-title" }, "Create a country case study"),
    h("p", { class: "page-desc" }, "Answer five short questions. The atlas then assembles a short presentation from the data, with one chart and one finding per slide. It can be viewed here and saved as a PDF.")));

  const form = h("ol", { class: "wizard" });
  root.append(form);
  const step = (n, title, help, ...body) => form.append(h("li", { class: "step" },
    h("div", { class: "step-no" }, String(n)),
    h("div", { class: "step-body" }, h("h2", { class: "step-q" }, title), help ? h("p", { class: "step-help" }, help) : null, ...body)));

  // 1. Country
  step(1, "Which country is the case study about?", null,
    select("Country", countryOptions(), CS.geo, v => { CS.geo = v; CS.comps = CS.comps.filter(c => c !== v); rerender(); }));

  // 2. Comparison
  const region = D.region.get(CS.geo);
  const peers = D.countries.filter(c => c.region === region && c.geo !== CS.geo && latest("prod_hour", c.geo, "TOTAL")).map(c => c.geo).slice(0, 3);
  const presets = [
    { label: `Other ${region} economies`, comps: peers },
    { label: "Central and Eastern Europe", comps: ["PL", "HU", "RO"].filter(g => g !== CS.geo) },
    { label: "Largest EU economies", comps: ["DE", "FR", "IT"].filter(g => g !== CS.geo) },
    { label: "Only the EU average", comps: [] },
  ];
  const chosen = h("div", { class: "tags" }, CS.comps.map(g => h("button", { class: "tag", onclick: () => { CS.comps = CS.comps.filter(x => x !== g); rerender(); } }, cname(g), h("span", { class: "x" }, "×"))),
    CS.comps.length < 3 ? h("select", { class: "select add", "aria-label": "Add a country", onchange: e => { if (e.target.value) { CS.comps.push(e.target.value); rerender(); } } },
      h("option", { value: "" }, "Add a country"), ...countryOptions().filter(o => o.value !== CS.geo && !CS.comps.includes(o.value)).map(o => h("option", { value: o.value }, o.label))) : null);
  step(2, "Which countries should it be compared with?", "Pick a suggestion or choose up to three countries. The EU average is always included.",
    h("div", { class: "choice-row" }, presets.map(p => h("button", { class: `choice ${JSON.stringify(p.comps) === JSON.stringify(CS.comps) ? "on" : ""}`, onclick: () => { CS.comps = p.comps; rerender(); } }, p.label))),
    chosen);

  // 3. Topics
  step(3, "What should the case study answer?", "Choose one or more questions. Each becomes one or two slides.",
    h("div", { class: "choice-col" }, TOPICS.map(t => h("button", { class: `choice wide ${CS.topics.includes(t.key) ? "on" : ""}`, role: "checkbox", "aria-checked": CS.topics.includes(t.key) ? "true" : "false",
      onclick: () => { CS.topics = CS.topics.includes(t.key) ? CS.topics.filter(k => k !== t.key) : [...CS.topics, t.key]; rerender(); } },
      h("span", { class: "check", "aria-hidden": "true" }, CS.topics.includes(t.key) ? "✓" : ""), h("span", {}, h("b", {}, t.q), h("small", {}, t.d))))));

  // 4. Period
  step(4, "Which period should it cover?", null,
    h("div", { class: "choice-row" }, PERIODS.map(p => h("button", { class: `choice ${CS.period === p.value ? "on" : ""}`, onclick: () => { CS.period = p.value; rerender(); } }, p.label))));

  // 5. Audience
  step(5, "Who will read it?", null,
    h("div", { class: "choice-row" },
      h("button", { class: `choice ${CS.audience === "general" ? "on" : ""}`, onclick: () => { CS.audience = "general"; rerender(); } }, "A general audience: short text, key charts"),
      h("button", { class: `choice ${CS.audience === "expert" ? "on" : ""}`, onclick: () => { CS.audience = "expert"; rerender(); } }, "Specialists: more charts and method notes")));

  root.append(h("div", { class: "wizard-go" },
    h("button", { class: "primary", disabled: CS.topics.length ? false : "disabled", onclick: () => { CS.built = true; rerender(); window.scrollTo(0, 0); } }, "Create the case study"),
    CS.topics.length ? null : h("span", { class: "field-label" }, "Choose at least one question in step 3.")));
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------
async function deck(root) {
  if (CS.topics.includes("industries")) await loadFull();
  const geo = CS.geo, name = cname(geo);
  const end = Math.min(coverage("prod", "TOTAL").latest, latest("prod", geo, "TOTAL")?.year || 9999);
  const base = CS.period === "last5" ? end - 5 : +CS.period;
  const geos = [geo, ...CS.comps];
  const all = [...geos, EU];
  const colors = { [geo]: "#2a78d6", [EU]: "#4d4c48" };
  ["#eb6834", "#1baf7a", "#eda100"].forEach((c, i) => { if (CS.comps[i]) colors[CS.comps[i]] = c; });
  const expert = CS.audience === "expert";
  const compsText = CS.comps.length ? `${CS.comps.map(cname).join(", ")} and the EU average` : "the EU average";

  const bar = h("div", { class: "deck-bar no-print" },
    h("button", { class: "link-btn", onclick: () => { CS.built = false; rerender(); } }, "← Edit answers"),
    h("button", { class: "primary", onclick: () => window.print() }, "Download PDF"),
    h("span", { class: "field-label" }, "In the print dialog, choose “Save as PDF”. Slides print one per page in landscape."));
  const deckEl = h("div", { class: "deck", "data-theme": "light" });
  root.append(bar, deckEl);
  setColorScope(deckEl);

  let n = 0;
  const slide = (title, kicker) => {
    n += 1;
    const body = h("div", { class: "slide-body" });
    const s = h("section", { class: "slide" },
      h("div", { class: "slide-top" }, h("span", { class: "slide-kicker" }, kicker || name), h("span", { class: "slide-no" }, String(n))),
      title ? h("h2", { class: "slide-title" }, title) : null, body,
      h("div", { class: "slide-foot" }, h("span", {}, "Labor Cost Atlas · Tony Blair Institute for Global Change"), h("span", {}, "Sources: Eurostat, ILOSTAT")));
    deckEl.append(s);
    return body;
  };
  const chartLegend = () => legend(all.map(g => ({ label: cname(g), color: colors[g] })));
  const lines = (m, nace = "TOTAL", transform) => all.map(g => {
    let data = series(m, g, nace).filter(d => d.year >= base && d.year <= end);
    if (transform) data = transform(g, data);
    return { key: g, label: cname(g), color: colors[g], width: g === geo ? 3 : 2, dash: g === EU ? "5 4" : null, data };
  }).filter(s => s.data.length);
  const note = t => h("p", { class: "slide-note" }, t);
  const pctOf = (a, b) => (a != null && b ? d3.format(".0%")(a / b) : "n/a");
  const chg = (m, g, nace = "TOTAL") => { const a = val(m, g, base, nace), b = val(m, g, end, nace); return a > 0 && b > 0 ? b / a - 1 : null; };

  // Title slide
  const t = slide(null, "Country case study");
  t.parentElement.classList.add("title-slide");
  t.append(h("h1", { class: "deck-title" }, `${name}: labor costs and productivity`),
    h("p", { class: "deck-sub" }, `Compared with ${compsText}, ${base}–${end}`),
    h("p", { class: "deck-meta" }, `Questions covered: ${CS.topics.map(k => TOPICS.find(x => x.key === k).q.toLowerCase().replace("?", "")).join("; ")}.`),
    h("p", { class: "deck-meta" }, `Prepared with the Labor Cost Atlas, ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Authors: Gregor Dalheimer and Abaigeal Heneghan, Tony Blair Institute for Global Change.`));

  // Key numbers
  const ph = latest("prod_hour", geo, "TOTAL"), lc = latest("lc_hour", geo), mw = latest("min_wage_eur", geo), hw = latest("hours_week", geo);
  const k = slide("Key numbers");
  k.append(kpiRow([
    ph ? { label: "Value produced per hour worked", value: fmt("prod_hour", ph.v), foot: `${ph.year}; EU average ${fmt("prod_hour", val("prod_hour", EU, ph.year, "TOTAL"))}` } : null,
    lc ? { label: "What an hour of work costs the employer", value: fmt("lc_hour", lc.v), foot: `${lc.year}; EU average ${fmt("lc_hour", val("lc_hour", EU, lc.year))}` } : null,
    chg("ulc", geo) != null ? { label: `Change in labor cost per unit of output, ${base}–${end}`, value: pct(chg("ulc", geo)), foot: `EU average ${chg("ulc", EU) != null ? pct(chg("ulc", EU)) : "n/a"}` } : null,
    mw ? { label: "Monthly minimum wage", value: fmt("min_wage_eur", mw.v), foot: String(mw.year) } : null,
    hw ? { label: "Hours worked per week", value: fmt("hours_week", hw.v), foot: String(hw.year) } : null,
  ].filter(Boolean)));
  k.append(note("Values are the latest available for each indicator; years differ between sources."));

  // Topic slides
  if (CS.topics.includes("cost")) {
    const u = chg("ulc", geo), ue = chg("ulc", EU);
    const b1 = slide(u != null ? `Labor cost per unit of output ${u >= 0 ? "rose" : "fell"} by ${d3.format(".0%")(Math.abs(u))} in ${name} between ${base} and ${end}${ue != null ? `, compared with ${d3.format(".0%")(ue)} in the EU` : ""}.` : "Labor cost per unit of output", "Is it competitive on labor costs?");
    const c1 = h("div", { class: "slide-chart" }); b1.append(c1, chartLegend());
    lineChart(c1, lines("ulc", "TOTAL", (g, d) => { const b = d.find(x => x.year === base); return b ? d.map(x => ({ year: x.year, v: 100 * x.v / b.v })) : []; }), { height: 300, yFormat: d3.format(".0f"), indexLine: true });
    b1.append(note(expert ? `Unit labor cost index, ${base} = 100: nominal compensation per employee divided by real value added per person employed (Eurostat national accounts). Levels are not comparable across countries; changes are.` : `Index: ${base} = 100. A rising line means labor has become more expensive relative to what it produces.`));
    // cost per hour vs output per hour
    const rows = all.map(g => ({ g, c: computeHour(hourData(g)) })).filter(r => r.c && r.c.per100);
    if (rows.length) {
      const me = rows.find(r => r.g === geo);
      const b2 = slide(me ? `In manufacturing, labor costs €${me.c.per100.toFixed(0)} for every €100 of value added in ${name}.` : "Labor cost per €100 of value added", "Is it competitive on labor costs?");
      drawSlideBars(b2, rows.map(r => ({ label: cname(r.g), v: r.c.per100, color: colors[r.g] })), v => "€" + v.toFixed(0));
      b2.append(note(expert ? "Manufacturing. Hourly labor cost (Eurostat lc_lci_lev) divided by nominal gross value added per hour worked (nama_10_a64, nama_10_a64_e). The two sources differ, so values are indicative." : "A lower bar means each euro of output requires less spending on labor."));
    }
  }

  if (CS.topics.includes("prod")) {
    const rel = (g, d) => d.map(x => { const e = val("prod_hour", EU, x.year, "TOTAL"); return e ? { year: x.year, v: 100 * x.v / e } : null; }).filter(Boolean);
    const r0 = val("prod_hour", geo, base, "TOTAL"), r1 = val("prod_hour", geo, end, "TOTAL"), e0 = val("prod_hour", EU, base, "TOTAL"), e1 = val("prod_hour", EU, end, "TOTAL");
    const b = slide(r0 && r1 && e0 && e1 ? `Output per hour in ${name} went from ${pctOf(r0, e0)} to ${pctOf(r1, e1)} of the EU level between ${base} and ${end}.` : "Output per hour relative to the EU", "Is productivity catching up?");
    const c = h("div", { class: "slide-chart" }); b.append(c, chartLegend());
    lineChart(c, lines("prod_hour", "TOTAL", rel).filter(s => s.key !== EU), { height: 300, yFormat: v => v.toFixed(0) + "%", refLine: 100 });
    b.append(note(expert ? "Real gross value added per hour worked (chain-linked 2020 euros) relative to the EU27 aggregate in the same year. Comparisons of real levels across countries do not adjust for price-level differences." : "100% means the same output per hour as the EU average."));
    if (expert) {
      const b2 = slide("Average annual growth of output per hour", "Is productivity catching up?");
      drawSlideBars(b2, all.map(g => ({ label: cname(g), v: growth("prod_hour", g, base, end, "TOTAL"), color: colors[g] })).filter(r => r.v != null), v => v.toFixed(1) + "%");
      b2.append(note(`Average annual log change of real value added per hour worked, ${base}–${end}, in percent.`));
    }
  }

  if (CS.topics.includes("wages")) {
    const cp = chg("comp_pe", geo), pr = chg("prod", geo);
    const b = slide(cp != null && pr != null ? `Pay per employee in ${name} grew by ${d3.format(".0%")(cp)} between ${base} and ${end}; output per worker grew by ${d3.format(".0%")(pr)}.` : "Pay per employee", "Where do wages stand?");
    const c = h("div", { class: "slide-chart" }); b.append(c, chartLegend());
    lineChart(c, lines("comp_pe"), { height: 300, yFormat: v => "€" + d3.format(",.0f")(v) });
    b.append(note(expert ? "Compensation per employee (D1 divided by employees), nominal euros per year, including employer social contributions." : "Average yearly labor cost per employee, including employer contributions, in euros."));
    const mwRows = all.map(g => ({ label: cname(g), v: latest("min_wage_eur", g)?.v, color: colors[g] })).filter(r => r.v != null);
    if (mwRows.length) {
      const ratio = latest("min_wage_ratio", geo);
      const b2 = slide(ratio ? `The minimum wage in ${name} equals ${d3.format(".0%")(ratio.v)} of average monthly earnings.` : "Monthly minimum wage", "Where do wages stand?");
      drawSlideBars(b2, mwRows, v => "€" + d3.format(",.0f")(v));
      b2.append(note(expert ? "Statutory gross monthly minimum wage, latest semester (Eurostat earn_mw_cur); ratio to mean earnings from earn_mw_avgr2." : "Gross monthly minimum wage in euros, latest year available."));
    }
  }

  if (CS.topics.includes("hours")) {
    const hw2 = latest("hours_week", geo);
    const rows = all.map(g => ({ label: cname(g), v: latest("hours_week", g)?.v, color: colors[g] })).filter(r => r.v != null);
    const b = slide(hw2 ? `Employed people in ${name} work on average ${hw2.v.toFixed(1)} hours per week.` : "Hours worked", "How much do people work?");
    drawSlideBars(b, rows, v => v.toFixed(1) + " h");
    b.append(note(expert ? "Mean weekly hours actually worked per employed person, labor force survey based (ILOSTAT HOW_TEMP_SEX_ECO_NB_A)." : "Average hours actually worked per week, all employed people."));
  }

  if (CS.topics.includes("industries")) {
    const secs = "A B C D E F G H I J K L M N O P Q R S".split(" ");
    const tot = D.full.idx.get(`${geo}|TOTAL|${end}`), pTot = tot?.prod;
    const rows = secs.map(L => ({ L, r: D.full.idx.get(`${geo}|${L}|${end}`) })).filter(d => d.r?.emp && tot?.emp)
      .map(d => ({ label: `${d.L} ${(D.nace.get(d.L) || d.L).split(";")[0].slice(0, 38)}`, share: d.r.emp / tot.emp, rel: d.r.prod && pTot ? d.r.prod / pTot : null }))
      .sort((a, b) => b.share - a.share).slice(0, 8);
    if (rows.length) {
      const b = slide(`${rows[0].label.slice(2)} is the largest employer in ${name}, with ${d3.format(".0%")(rows[0].share)} of all jobs.`, "Which industries matter?");
      drawSlideBars(b, rows.map(r => ({ label: r.label, v: 100 * r.share, color: r.rel == null ? "#a9a59a" : r.rel >= 1 ? "#2a78d6" : "#eb6834", extra: r.rel != null ? `productivity ${r.rel.toFixed(2)}× national average` : "" })), v => v.toFixed(0) + "%", 250);
      b.append(legend([{ label: "Above the national average productivity", color: "#2a78d6" }, { label: "Below", color: "#eb6834" }]),
        note(expert ? `Share of persons employed by NACE section, ${end} (Eurostat nama_10_a64_e); productivity is real value added per person employed relative to the total economy.` : `Share of all jobs by activity, ${end}. Colors show whether output per worker in the activity is above or below the country average.`));
    }
  }

  // Method slide
  const m = slide("About the data", "Notes");
  m.append(h("ul", { class: "slide-list" },
    h("li", {}, "All figures come from Eurostat and ILOSTAT and are retrieved automatically; the atlas shows the date of the last update."),
    h("li", {}, "Comparisons use the latest year available for each country; years can differ between countries and indicators."),
    expert ? h("li", {}, "Real values are chain-linked volumes in 2020 euros. Unit labor cost levels depend on national price levels and are compared only as changes over time.") : null,
    expert ? h("li", {}, "Value added per hour combines national accounts output with hours worked; labor cost per hour comes from the labor cost survey. Ratios between the two are indicative.") : null,
    h("li", {}, `Interactive version and full data: the Labor Cost Atlas (${location.origin}${location.pathname}).`)));

  setColorScope(null);
}

function drawSlideBars(host, rows, f, height) {
  const wrap = h("div", { class: "slide-chart" }); host.append(wrap);
  const width = 940, rowH = Math.min(46, Math.max(26, (height || 300) / Math.max(rows.length, 1))), m = { l: 300, r: 260 };
  const hgt = rows.length * rowH + 10;
  const svg = svgEl(wrap, width, hgt);
  const x = d3.scaleLinear([0, d3.max(rows, r => r.v) || 1], [m.l, width - m.r]);
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    svg.append("text").attr("class", "label-strong").attr("x", m.l - 10).attr("y", y + (rowH - 10) / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(r.label);
    svg.append("rect").attr("x", m.l).attr("y", y).attr("height", rowH - 10).attr("width", Math.max(1, x(r.v) - m.l)).attr("fill", r.color);
    svg.append("text").attr("class", "label").attr("x", x(r.v) + 8).attr("y", y + (rowH - 10) / 2).attr("dominant-baseline", "middle").text(f(r.v) + (r.extra ? `  ·  ${r.extra}` : ""));
  });
}

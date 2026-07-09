"use strict";
/**
 * Market Study content, single source of truth for all four regional reports
 * (US, UK, Global/Rest-of-World, India). Transcribed from the final analyst
 * PDFs shared 9 July 2026.
 *
 * Two renderers over one structured content model:
 *   reportInnerHTML(region) -> the on-page report block (uses the playbook's
 *                              card / grid-tbl / gold-ink classes + confidence chips)
 *   docHTML(region)         -> a clean standalone HTML document that LibreOffice
 *                              converts to the downloadable .docx
 *
 * Brand rules enforced here: no em/en dashes, straight quotes only, four-colour
 * palette (gold text uses the readable --vahdam-gold-ink token on the page).
 */

var REGIONS = ["US", "UK", "Global", "India"];

var META = {
  US: {
    file: "US_Functional_Wellness_Market_Study",
    panelTitle: "US Functional-Wellness Market Study",
    docTitle: "The U.S. Functional-Wellness Beverage &amp; Supplement Market",
    sub: "Tea, Functional Coffee, Adaptogens, with a teardown of the US adaptogen-coffee arena",
    prep: "Growth &amp; Digital Production, VAHDAM (US market)"
  },
  UK: {
    file: "UK_Functional_Wellness_Market_Study",
    panelTitle: "UK Functional-Wellness Market Study",
    docTitle: "The U.K. Functional-Wellness Beverage &amp; Supplement Market",
    sub: "Tea, Functional Coffee, Adaptogens, with a teardown of the UK adaptogen-coffee arena",
    prep: "Growth &amp; Digital Production, VAHDAM UK (VI Consumer Ltd)"
  },
  Global: {
    file: "Global_RestOfWorld_Wellness_Market_Study",
    panelTitle: "Global (Rest-of-World) Wellness-Beverage Market Study",
    docTitle: "The Global (Rest-of-World) Wellness-Beverage Market",
    sub: "Every region except the US, UK and India, where VAHDAM can win vs where it is merely present",
    prep: "Growth &amp; Digital Production, VAHDAM (Global / vahdam.com international)"
  },
  India: {
    file: "India_Wellness_Beverage_Market_Study",
    panelTitle: "India Wellness-Beverage &amp; Ayurveda Market Study",
    docTitle: "The India Wellness-Beverage &amp; Ayurveda Market",
    sub: "Tea, Coffee-D2C, Ayurveda and Adaptogens, with comparisons across the major players",
    prep: "Growth &amp; Digital Production, VAHDAM (India / home market)"
  }
};

/* Category sub-tabs, in display order. Only categories with content render. */
var CATS = [
  ["overview", "Overview"],
  ["market", "Market &amp; sizing"],
  ["competitors", "Competitors"],
  ["strategy", "Strategy &amp; white space"],
  ["regulatory", "Regulatory"],
  ["sources", "Sources"]
];
/* section-number -> category, per region */
var CATMAP = {
  US: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "strategy", 8: "regulatory", 9: "strategy", 10: "sources" },
  UK: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "strategy", 9: "regulatory", 10: "strategy", 11: "sources" },
  Global: { 1: "overview", 2: "overview", 3: "market", 4: "competitors", 5: "competitors", 6: "strategy", 7: "regulatory", 8: "strategy", 9: "sources" },
  India: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "competitors", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" }
};

var TAGNAME = { C: "Certain", L: "Likely" };
var TAGCSS = {
  C: "background:rgba(0,74,43,.12);color:#004A2B",
  L: "background:rgba(171,135,67,.20);color:#8a6a2f"
};
function tagChip(t) {
  return '<span style="display:inline-block;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:1px 7px;margin-right:6px;vertical-align:middle;' + TAGCSS[t] + '">' + TAGNAME[t] + "</span>";
}
function applyTags(s, mode) {
  return String(s).replace(/\{([CLG])\}/g, function (_, t) {
    return mode === "page" ? tagChip(t) : "<strong>[" + TAGNAME[t] + "]</strong> ";
  });
}

/* ---- renderers over the node model ---- */
function renderNodes(nodes, mode) {
  var out = [];
  nodes.forEach(function (n) {
    var type = n[0];
    if (type === "sec") {
      var num = n[1], title = n[2], sub = n[3];
      if (mode === "page") {
        out.push('<div class="mt-8"><div class="text-[11px] tracking-[.16em] uppercase font-bold gold-ink">Section ' + num + '</div><h2 class="font-head text-2xl md:text-3xl text-vahdam-green mt-1">' + title + "</h2>" + (sub ? '<p class="text-sm mt-2 max-w-3xl" style="color:var(--soft);">' + sub + "</p>" : "") + "</div>");
      } else {
        out.push("<h2>" + num + ". " + title + "</h2>" + (sub ? "<p><em>" + sub + "</em></p>" : ""));
      }
    } else if (type === "sub") {
      if (mode === "page") out.push('<div class="text-[11px] uppercase tracking-[.06em] font-bold mt-4" style="color:var(--soft);">' + n[1] + "</div>");
      else out.push("<h3>" + n[1] + "</h3>");
    } else if (type === "card") {
      var paras = n[1].map(function (p) { return "<p>" + applyTags(p, mode) + "</p>"; }).join("");
      if (mode === "page") out.push('<div class="card p-5"><div class="text-sm space-y-2" style="color:var(--vahdam-ink);">' + paras + "</div></div>");
      else out.push(paras);
    } else if (type === "bul") {
      var items = n[1].map(function (it) { return "<li>" + applyTags(it, mode) + "</li>"; }).join("");
      if (mode === "page") out.push('<div class="card p-5"><ul class="space-y-2 text-sm" style="color:var(--vahdam-ink);list-style:disc;padding-left:18px;">' + items + "</ul></div>");
      else out.push("<ul>" + items + "</ul>");
    } else if (type === "tbl") {
      var headers = n[1], rows = n[2], note = n[3];
      var thead = "<tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>";
      var tbody = rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + applyTags(c, mode) + "</td>"; }).join("") + "</tr>"; }).join("");
      if (mode === "page") {
        var mw = headers.length >= 6 ? "900px" : (headers.length >= 4 ? "760px" : "560px");
        out.push('<div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:' + mw + ';"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table></div>" + (note ? '<p class="text-[12px] mt-1" style="color:var(--soft);">' + applyTags(note, mode) + "</p>" : ""));
      } else {
        out.push('<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table>" + (note ? "<p><em>" + applyTags(note, mode) + "</em></p>" : ""));
      }
    } else if (type === "cards") {
      var cols = n[1], list = n[2];
      if (mode === "page") {
        var cls = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
        var cch = list.map(function (it) { return '<div class="card p-5"><h4 class="font-head text-vahdam-green">' + it[0] + '</h4><p class="text-sm mt-1" style="color:var(--vahdam-ink);">' + applyTags(it[1], mode) + "</p></div>"; }).join("");
        out.push('<div class="grid gap-4 ' + cls + '">' + cch + "</div>");
      } else {
        out.push(list.map(function (it) { return "<h3>" + it[0] + "</h3><p>" + applyTags(it[1], mode) + "</p>"; }).join(""));
      }
    }
  });
  return out.join("\n");
}

/* =====================================================================
   CONTENT, transcribed from the final PDFs (9 July 2026)
   ===================================================================== */
var REPORTS = {};

REPORTS.US = [
  ["sec", 1, "Scope &amp; method"],
  ["card", ["{C} This study covers the US functional-wellness intersection VAHDAM actually competes in: premium/wellness tea, functional and adaptogenic coffee, and the adaptogen-supplement crossover, not commodity coffee or bagged black tea."]],
  ["bul", [
    "Figures from named research previews and trade press; ranges shown where firms disagree.",
    "Regulatory frame is US: FDA/DSHEA (supplements are not pre-approved) plus FTC (truth-in-advertising). Looser than UK ASA/MHRA, which shapes how aggressively rivals claim.",
    "VAHDAM is the anchor; rivals are read for the openings they leave."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", [
    "{C} The US is the category's birthplace and largest arena: DTC-mature, functional-coffee-led, and defined by adaptogen-coffee challengers (Ryze, MUD\\WTR, Four Sigmatic) plus greens (AG1) and women's-hormone (Happy Mammoth).",
    "{C} VAHDAM's origin moat is at its strongest here: rivals import ashwagandha, turmeric and chai; VAHDAM owns them at source. Crucially, VAHDAM has done what almost no pure-play challenger has, crossed from DTC into ~1,000 Target stores (Mar 2026), at an aggressive ~$0.80/serving.",
    "{L} The dominant challengers are mushroom-led, not ashwagandha-led (Ryze's Super-6 has no ashwagandha). That leaves the ashwagandha-forward calm-energy position genuinely contestable, and it is exactly VAHDAM's formula.",
    "{L} The category price ceiling is set by AG1 (~$79 to $99); the value floor by Everyday Dose (under $1/serving). VAHDAM sits low in the band with a fuller product range behind it."
  ]],

  ["sec", 3, "Market sizing", "Scopes differ sharply by firm; treat as magnitude, not accounting."],
  ["tbl", ["Segment", "Size / figure", "Source &amp; note"], [
    ["US tea market", "~$1.5 to 3.6B (firms disagree widely); herbal tea ~$3.1B (approx 62% functional-driven)", "{L} multiple firms; scope varies"],
    ["US coffee market", "~$23.8 to 24B", "{C} range across firms"],
    ["Global functional coffee", "$4.48B &rarr; $8.48B by 2031, ~11.2% CAGR (NA ~69%)", "{C} category's fastest sub-segment"],
    ["US mushroom coffee", "~$618M &rarr; ~$1.09B (2035)", "{L}"],
    ["US dietary supplements", "$60.2B &rarr; $96.5B (2034)", "{C}"],
    ["US ashwagandha", "$0.13B &rarr; $0.39B, 11.4% CAGR; 26 to 39% of adaptogens; fastest in F&amp;B (15.6%)", "{C} the ingredient VAHDAM owns"],
    ["Global adaptogen coffee", "~$1.1 to 1.7B (2025); ~6 to 17% CAGR by firm/scope", "{L} FMI / HTF / R&amp;M"]
  ], "Ashwagandha is the single most-chosen adaptogen (~18 to 26% of adaptogen demand) and the fastest-growing in food and beverage, structurally favourable to VAHDAM's hero SKU."],

  ["sec", 4, "Structural dynamics"],
  ["sub", "A DTC-native, coffee-led category"],
  ["card", ["{C} The US category grew up on DTC subscription plus social proof (Ryze cites 200K+ reviews). Functional coffee, not tea, is the acquisition engine, because it slots into an existing daily habit and removes supplement stigma."]],
  ["sub", "Format, price and retail crossover"],
  ["bul", [
    "Instant powder is the dominant format; subscription is the default purchase; 30-day money-back is table stakes.",
    "The frontier is DTC to retail. VAHDAM's Target rollout is a genuine moat most pure-plays have not crossed, shelf presence plus trust that ad spend cannot buy overnight."
  ]],
  ["sub", "Regulation (looser, not absent)"],
  ["card", ["{C} Under DSHEA, supplements are not pre-approved; under FTC, claims must be truthful and substantiated. Quantified cortisol and weight-loss testimonials are the classic enforcement triggers, the looser regime is why US rivals claim harder than UK ones."]],

  ["sec", 5, "Major players, US adaptogen and functional coffee", "VAHDAM's core competitive set. The decisive column is Ashwagandha? The leaders are mushroom-led, leaving VAHDAM's angle open."],
  ["tbl", ["Brand", "Format", "Key actives", "Ashwagandha?", "Price/serving", "Notes"], [
    ["<b>VAHDAM</b>", "Instant + real Arabica", "KSM-66, Lion's Mane, Turmeric 95%, Chaga", "<b>Yes, KSM-66</b>", "~$0.80 (Target SRP $15.99/20)", "In ~1,000 Target stores; 30-day MBG"],
    ["Ryze", "Instant", "Super-6 mushroom blend", "No", "~$0.90 to 1.20", "DTC volume leader; 200K+ reviews; sub-default"],
    ["MUD\\WTR", "Instant", "6 mushrooms + cacao + masala chai", "No", "~$1.50 to 1.70", "Coffee-alternative; free frother; ritual brand"],
    ["Four Sigmatic", "Instant + ground", "Lion's Mane, Chaga", "No (not core)", "~$1.13 to 2.25", "Category pioneer; in grocery; lab-tested"],
    ["Everyday Dose", "Instant", "Lion's Mane, Chaga, collagen, L-theanine", "No", "under $1", "Best value; gentle on-ramp"],
    ["Spacegoods (UK, ships US)", "Instant, cacao-forward", "Lion's Mane, Cordyceps, Chaga, Maca, Ashwagandha", "Yes", "~$1.30-equiv", "60-day MBG; expanding into US"]
  ], "{C} on formats/positioning; {L} on pricing (pack/subscription-dependent). Of the US-native leaders, none leads on ashwagandha, the calm-energy ashwagandha lane is VAHDAM's to take."],

  ["sec", 6, "Competitor deep-dives"],
  ["cards", 2, [
    ["VAHDAM (anchor)", "\"Feel Alive.\" Premium Indian tea plus adaptogen coffee, farmer-direct from origin. <b>Hero:</b> Ashwagandha Coffee, Arabica + KSM-66, Lion's Mane, 95%-curcumin Turmeric, Chaga; instant, 40 to 240 servings DTC. <b>Retail:</b> ~1,000 Target stores (Mar 2026), SRP $15.99/20 (~$0.80/serving). <b>Strengths:</b> owns the origin of the botanicals rivals import; retail ahead of most pure-plays; aggressive price; real range and heritage; press/celebrity credibility (Oprah, Mariah Carey). <b>Openings:</b> brand meaning split across tea, coffee and spices vs a single-minded Ryze; cortisol/weight testimonials carry FTC risk."],
    ["Ryze", "The DTC volume leader. \"Mushroom coffee, reimagined.\" Super-6 mushroom blend (no ashwagandha); instant; sub-default; 200K+ reviews; ~$0.90 to 1.20/serving; 30-day MBG. <b>Openings:</b> mushroom-only, no ashwagandha, no tea heritage, no retail range, the ashwagandha calm-energy angle and physical shelf are both open to VAHDAM."],
    ["MUD\\WTR", "The coffee-alternative ritual brand. Masala chai meets mushrooms. 6 mushrooms + cacao + masala chai; ~$1.50 to 1.70/serving; free frother; strong community. <b>Openings:</b> no real coffee for those who still want a caffeine ritual; pricier; VAHDAM's Arabica base plus authentic Indian chai/turmeric provenance is a stronger origin story on the same flavour territory."],
    ["AG1 and Happy Mammoth (adjacents)", "The price ceiling and the hormone-funnel benchmark. <b>AG1:</b> 75-ingredient greens powder; NSF-certified; ~$79 to $99 (~$1.05 to $1.32/serving); 90-day MBG; celebrity-marketed. <b>Happy Mammoth:</b> Hormone Harmony capsules, KSM-66 + 12 extracts; women/menopause/cortisol; quiz funnel; 3.3M customers; ~$2.92/serving; 60-day MBG. <b>Openings:</b> neither is a coffee, VAHDAM can undercut AG1 on price and out-format Happy Mammoth (a drinkable daily ritual vs capsules) using the same KSM-66 credibility."]
  ]],

  ["sec", 7, "VAHDAM US, strategic read"],
  ["bul", [
    "<b>Press the ashwagandha lane.</b> The US leaders are mushroom-led. Own ashwagandha-forward calm energy explicitly, it is the open flank.",
    "<b>Make the Target crossover the story.</b> \"The adaptogen coffee you can actually buy in Target\" is a trust signal no pure-play DTC brand can match.",
    "<b>Bracket the price band.</b> Anchor against AG1's ceiling (all that ritual, a fraction of the price) while defending quality vs Everyday Dose's floor.",
    "<b>Tighten the claims.</b> Replace quantified cortisol/weight testimonials with substantiated, hedged wording before FTC does it for you."
  ]],
  ["card", ["{L} Net: the US is where VAHDAM's origin, range and retail advantages compound. The job is single-minded positioning (ashwagandha calm-energy) and disciplined claims, not more features."]],

  ["sec", 8, "Regulatory notes (US)"],
  ["bul", [
    "<b>FDA/DSHEA:</b> dietary supplements are not pre-approved; structure/function claims allowed with the standard disclaimer; no disease claims.",
    "<b>FTC:</b> advertising (including testimonials and influencer content) must be truthful and substantiated; quantified physiological/weight claims are the enforcement hot-spot.",
    "<b>Practical rule:</b> keep to calm, focus, energy without jitters, stress support framing; substantiate anything quantified."
  ]],

  ["sec", 9, "White space and recommendations"],
  ["bul", [
    "Ashwagandha-forward, real-coffee, origin-owned is uncontested by the US mushroom-led leaders.",
    "DTC to retail credibility (Target) is a differentiator to amplify, not bury.",
    "Heritage tea range plus gifting is a cross-sell and trust asset no single-SKU challenger has.",
    "Compliance-led marketing is a moat in an over-claiming category."
  ]],

  ["sec", 10, "Sources"],
  ["card", ["Research and press (2026 pulls): Grand View / Precedence / Future Market Insights / HTF / Research and Markets (functional-coffee, adaptogen, supplement and ashwagandha sizing); brand sites and trade coverage for Ryze, MUD\\WTR, Four Sigmatic, Everyday Dose, AG1, Happy Mammoth, Spacegoods; vahdam.com plus Target launch coverage. Figures are directional and scope-dependent; confidence tags reflect source strength."]]
];

REPORTS.UK = [
  ["sec", 1, "Scope &amp; method"],
  ["card", ["{C} This study covers the UK arena VAHDAM UK actually competes in: premium/wellness tea, functional and adaptogenic coffee, and the adaptogen-supplement crossover, not the commodity black-tea bag war, which VAHDAM does not fight on price."]],
  ["bul", [
    "Figures pulled from named market-research previews and trade press (June 2026 pull). Where firms disagree, ranges are shown, not a single false-precision number.",
    "Regulatory frame is UK-specific: ASA/CAP (advertising claims) and MHRA (medicinal-claim boundary), materially stricter than US FTC/DSHEA.",
    "VAHDAM UK is profiled as the anchor; rivals are read for the openings they leave."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", [
    "{C} The UK tea market is bifurcated: a saturated Red Ocean of commodity black tea (~75% of sales, owned by four legacy brands) and a fast-growing Blue Ocean of wellness/functional infusions where the legacy giants are weak.",
    "{C} The single most important competitive fact for VAHDAM UK: your hero ingredient, KSM-66 Ashwagandha, is already used by your two sharpest UK rivals, Spacegoods and London Nootropics. In the UK you are fighting home-grown incumbents, not importers. \"Crafted in India\" is a story, not a moat, when the rival down the road buys the same branded extract.",
    "{L} Spacegoods is the category's UK front-runner (&pound;2.5M raised, explicit ambition to be European market leader) and has effectively defined the coffee-plus adaptogen format. London Nootropics owns the clinically-credible, doctor-backed, named-extract high ground. Both sit exactly where VAHDAM wants to be.",
    "{L} VAHDAM UK's real edges are three: (1) a genuine multi-category heritage-tea business behind the coffee, (2) a longer 90-day money-back guarantee vs rivals' 30 to 60 days, and (3) origin ownership of the actual botanicals (ashwagandha, turmeric, chai) rather than a formulation assembled from third-party extracts."
  ]],

  ["sec", 3, "Market sizing", "Segment sizes are scoped differently by each firm; treat as directional magnitude, not accounting."],
  ["tbl", ["Segment", "Size / figure", "Source &amp; note"], [
    ["UK tea market (retail)", "~&pound;660M+ annually; black tea ~75% of sales", "{C} UK trade/industry; scope = at-home retail"],
    ["UK tea volume", "~100K tons (2024, +20% spike); ~+1.8% vol / +2.9% value CAGR to 2035", "{L} IndexBox"],
    ["Europe loose-leaf tea", "$0.98B (2025) &rarr; $1.47B (2034), 4.59% CAGR", "{C} Market Data Forecast"],
    ["Matcha adoption", "over 50% of UK under-35s consumed matcha in late 2025", "{C} Mintel"],
    ["UK functional-mushroom market", "~$1.85B (2024), broad scope (food, extracts, powders, coffee)", "{L} DataM Intelligence"],
    ["Global adaptogenic-mushroom market", "$10.9B (2022) &rarr; $30B (2032), ~10%/yr", "{C} Global Market Insights"],
    ["Global mushroom-coffee market", "$1.26B (2024) &rarr; $5.56B (2035), ~7%/yr", "{L} Data Bridge / Precedence"]
  ], "Takeaway: the wellness/functional layer is the only part of UK tea and coffee growing at double digits, and it is not yet locked down by the legacy Big Four."],

  ["sec", 4, "Structural dynamics"],
  ["sub", "Red Ocean vs Blue Ocean"],
  ["card", [
    "{C} Traditional black tea is a mature, slightly declining, price-competitive volume game dominated by Yorkshire Tea, PG Tips, Tetley and Twinings (together 70%+ of black tea). Margins are thin and share is won over decades. VAHDAM should not enter this fight.",
    "{L} The wellness/functional layer, matcha, herbal functional blends, adaptogen coffee, is where younger buyers, premium price bands (&pound;10 to &pound;35/pack) and digital-first brands concentrate. This is VAHDAM's lane."
  ]],
  ["sub", "Format and channel"],
  ["bul", [
    "Sachets/instant is the winning acquisition format in adaptogen coffee (Spacegoods, London Nootropics, DIRTEA all lead here), it removes the supplement stigma by living inside the coffee ritual.",
    "TikTok Shop plus Amazon UK plus DTC subscription are the growth channels; influencer-led discovery (DIRTEA) vs clinical-credibility (London Nootropics) are the two proven playbooks."
  ]],
  ["sub", "Regulation (the real constraint)"],
  ["card", ["{C} The MHRA polices the medicine boundary: a food supplement may not claim to diagnose, treat, cure or prevent disease. The ASA/CAP code polices advertising: health claims must be authorised and substantiated. Lowers cortisol by X%, weight-loss framing, and cures-anxiety-style testimonials are the classic triggers for a ruling."]],

  ["sec", 5, "Major players, UK tea"],
  ["tbl", ["Brand", "Owner / type", "Scale / share", "Positioning", "Read for VAHDAM"], [
    ["Yorkshire Tea", "Taylors of Harrogate (family)", "Value leader; 36.7% of black tea (2023)", "Proper tea; bold Assam/African blend; heritage", "Owns everyday strong, not VAHDAM's fight"],
    ["PG Tips", "Lipton Teas &amp; Infusions", "~24% share; strong in London", "Smooth everyday; plant-based bags", "Mass black, irrelevant to premium play"],
    ["Tetley", "Tata Consumer", "~27% share (volume)", "Everyday; convenience-store lead", "Same parent-nation origin; mass tier"],
    ["Twinings", "Associated British Foods", "Top-4; premium heritage", "Heritage English; very wide range", "Closest legacy premium comparator"],
    ["Pukka", "Lipton Teas &amp; Infusions (2017)", "Premium organic-herbal leader", "Organic, Ayurveda-influenced, B Corp", "Direct herbal/Ayurvedic-wellness rival, watch"],
    ["Teapigs", "Tata Consumer", "Premium whole-leaf", "Tea temples, whole-leaf", "Premium-leaf quality benchmark"],
    ["Clipper", "Organic &amp; Fairtrade specialist", "Broad supermarket presence", "Affordable organic / ethical", "Value-organic; ethics table-stakes"]
  ], "{C} shares from UK trade press; {L} on exact ownership where noted. Pukka is the one legacy-owned brand whose Ayurvedic-herbal positioning overlaps VAHDAM directly."],

  ["sec", 6, "Major players, UK functional and adaptogen coffee", "VAHDAM UK's actual competitive set. The decisive column is Ashwagandha? Note how few own it, and that the two who do are UK-local."],
  ["tbl", ["Brand", "Origin", "Format", "Key actives", "Ashwagandha?", "Price/serving", "Notes"], [
    ["<b>VAHDAM UK</b>", "India-made, UK entity", "Instant + real Arabica", "KSM-66, Lion's Mane, Turmeric 95%, Chaga", "<b>Yes, KSM-66</b>", "DTC bundles (n/a per-srv)", "90-day MBG; free UK delivery"],
    ["Spacegoods (Rainbow Dust)", "UK (2021)", "Instant, cacao-forward", "Lion's Mane, Cordyceps, Chaga, Maca, Ashwagandha", "Yes", "~&pound;1.30/sachet", "&pound;2.5M raised; 60-day MBG; category front-runner"],
    ["London Nootropics", "UK", "Instant sachets (Flow/Zen/Mojo)", "Lion's Mane, Rhodiola (Rhodiolife), Hifas mushrooms + KSM-66", "<b>Yes, KSM-66</b>", "~&pound;0.80 to 1.25", "Doctor-backed; named branded extracts"],
    ["DIRTEA", "UK", "Instant coffee + powders", "Lion's Mane 1000mg, Chaga, Cordyceps", "Select SKUs", "~&pound;0.40 to 0.55 (sub)", "Influencer-led; high mushroom dose"],
    ["Four Sigmatic", "Finland (sold in UK)", "Instant + ground", "Lion's Mane, Chaga", "No (not core)", "~&pound;1.10 to 2.25", "Category pioneer; lab-tested"],
    ["Ryze", "US (ships UK)", "Instant", "Super-6 mushroom blend", "No", "~&pound;0.90 to 1.20", "DTC volume leader; strong UK search"],
    ["Balance Coffee", "UK roaster", "Ground / whole bean", "Lion's Mane 500mg", "No", "Higher (real coffee)", "Coffee-purist; brew-control"]
  ], "{C} on formats/positioning; {L} on per-serving pricing (varies by pack/subscription). The strategic point: KSM-66 is shared by VAHDAM, Spacegoods and London Nootropics, differentiation must come from elsewhere."],

  ["sec", 7, "Competitor deep-dives"],
  ["cards", 2, [
    ["VAHDAM UK (anchor)", "\"Feel Alive.\" Premium Indian tea plus adaptogen coffee, crafted in India, sold to the UK. <b>Hero:</b> Ashwagandha Coffee, 100% Arabica + KSM-66, Lion's Mane, 95%-curcumin Turmeric, Chaga; 1 scoop (2.5g); 40 to 240 servings DTC. <b>Guarantee:</b> 90-day money-back, longer than every rival (Spacegoods 60, most others 30). <b>Strengths:</b> owns the origin of botanicals rivals import; deepest product range; longest guarantee; reverse-import prestige (Indian brand loved in 145 countries); 150K+ customers. <b>Openings:</b> KSM-66 is not exclusive (Spacegoods and London Nootropics use it too); cortisol/weight testimonials are an ASA/CAP plus MHRA liability; brand meaning split across tea and coffee dilutes the single-minded punch."],
    ["Spacegoods", "The UK category front-runner. Coffee-plus, energy and focus without the crash. <b>Hero:</b> Rainbow Dust, cacao-forward instant with Lion's Mane, Cordyceps, Chaga, Maca, Ashwagandha plus B-vitamins; ~&pound;1.30/sachet; 60-day guarantee. <b>Momentum:</b> &pound;2.5M seed (Five Seasons Ventures et al.); openly targeting European leadership; publishes third-party heavy-metal/microbial testing. <b>Openings:</b> cacao-forward profile reads as functional hot chocolate, not real coffee, VAHDAM's Arabica base is a genuine wedge for coffee purists; no heritage-tea catalogue behind it."],
    ["London Nootropics", "The credibility play. Two targeted, named-supplier adaptogens per blend. <b>Hero:</b> Flow (Lion's Mane + Rhodiola), Zen, Mojo, instant sachets with Rhodiolife Rhodiola, Hifas da Terra extracts, KSM-66 Ashwagandha, all branded and traceable; ~&pound;0.80 to 1.00/serving; doctor endorsements. <b>Openings:</b> doses sit at the lower end of studied ranges (they admit it); narrower range; less lifestyle-brand pull, VAHDAM can out-dose and out-range if it chooses."],
    ["DIRTEA", "The influencer-led volume machine. 1000mg Lion's Mane; Chaga; Cordyceps; broad powder range; ~&pound;0.40 to 0.55/serving on subscription, the price-aggressive end. <b>Openings:</b> instant coffee base rated fine but flat; low-price positioning cedes the premium/quality story to VAHDAM."],
    ["Four Sigmatic / Ryze (imports)", "The international pioneers with UK presence but no local ashwagandha lock. Four Sigmatic (Finnish; Lion's Mane + Chaga; lab-tested) normalised mushroom coffee; Ryze (US DTC volume leader; Super-6; no ashwagandha) has strong UK search. <b>Openings:</b> neither leads on ashwagandha; both are mushroom coffee, leaving the ashwagandha-forward calm-energy angle contestable."]
  ]],

  ["sec", 8, "VAHDAM UK, strategic read"],
  ["card", ["{L} Stop leaning on Crafted in India / KSM-66 as the differentiator, in the UK that is parity, not advantage. Two funded local rivals say the same thing. Re-anchor on what they cannot copy."]],
  ["bul", [
    "<b>Real coffee, not cocoa.</b> Spacegoods' hero is cacao-forward. Own actual Arabica coffee you would drink black plus adaptogens, the purist wedge DIRTEA and Spacegoods leave open.",
    "<b>Weaponise the 90-day guarantee.</b> It is the longest in category and barely marketed. Make it the headline risk-reversal.",
    "<b>Sell the tea house behind the coffee.</b> None of the adaptogen-coffee pure-plays have a heritage tea catalogue. Cross-sell plus we have sourced from origin for years is a credibility story startups cannot manufacture.",
    "<b>Fix the claims before the ASA does.</b> Replace lowers cortisol 27.9% / weight-loss testimonials with authorised, hedged wording. This is a when-not-if compliance exposure."
  ]],

  ["sec", 9, "Regulatory notes (UK)"],
  ["bul", [
    "<b>MHRA:</b> food supplements cannot make medicinal claims (treat/cure/prevent). Balances cortisol, framed as a health outcome, drifts toward this line.",
    "<b>ASA/CAP:</b> advertising health claims must be authorised on the GB nutrition and health claims register and substantiated; testimonials cannot be used to make claims the brand could not make directly.",
    "<b>Practical rule:</b> keep VAHDAM UK messaging to calm, focus, everyday wellbeing, no jitters and avoid quantified physiological or weight-loss claims."
  ]],

  ["sec", 10, "White space and recommendations"],
  ["bul", [
    "The real-coffee, high-dose, single-origin ashwagandha position is open, rivals are either cocoa-forward or lower-dose.",
    "Heritage tea house that also makes adaptogen coffee is a defensible identity no pure-play can claim.",
    "Practitioner / clinic channel (where London Nootropics is winning) is under-exploited by VAHDAM and rewards the origin plus testing story.",
    "Compliance-led marketing is itself a moat in a category full of over-claiming startups, the adaptogen coffee that will not get you an ASA ruling."
  ]],

  ["sec", 11, "Sources"],
  ["card", ["Trade and research (June to July 2026 pulls): The Grocer (Spacegoods funding and category); Balance Journal / Balance Coffee, New Coffee Review (UK mushroom-coffee rankings, pricing, doses); London Nootropics and Spacegoods brand sites; Mintel (matcha); DataM Intelligence, Global Market Insights, Data Bridge, Precedence (market sizing); Market Data Forecast (Europe loose-leaf); IndexBox (UK tea volume); teas.co.uk, amazingfoodanddrink, Accio (UK tea shares and structure); vahdam.co.uk. Figures are directional and scope-dependent; confidence tags reflect source strength."]]
];

REPORTS.Global = [
  ["sec", 1, "Scope &amp; method"],
  ["card", ["{C} Global ex-US/UK/India is not one market, it is a dozen structurally unlike ones. This study organises them by a single decision: where VAHDAM can realistically win vs where it is only present. VAHDAM already runs a dedicated Global storefront (vahdam.global) serving this set and ships to ~145 countries."]],
  ["bul", [
    "<b>Winnable</b> (premium-D2C viable, high disposable income, wellness-receptive): EU-ex-UK, Canada, Australia/NZ, the GCC.",
    "<b>Present-but-not-winning</b> (tea-origin or structurally hostile to an Indian tea brand): China, Japan, much of LatAm and Africa.",
    "Section 4 answers the all-regions-each-named-brand-is-famous-in requirement directly, via a brand-footprint matrix."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", [
    "{C} The branded adaptogen/functional set is overwhelmingly US, UK and Indian brands that export globally, Four Sigmatic, Ryze, MUD\\WTR, AG1, Spacegoods, DIRTEA, plus VAHDAM and Organic India. Outside the big three markets, VAHDAM competes less with local challengers and more with these same global exporters, alongside regional premium-tea incumbents.",
    "{L} Regional growth in adaptogen coffee is led by Germany (~6.8% CAGR), the US (~6.7%), France (~6.5%) and China (~6.0%). Europe is the largest rest-of-world opportunity; Asia-Pacific is the fastest-growing but structurally hardest for an Indian tea brand.",
    "{L} VAHDAM's rest-of-world edge is not origin (as at home) nor local incumbency (as in the UK), it is its press/celebrity halo and gifting equity. It already appears on global best-luxury-tea lists with a celebrity fanbase (Oprah, Mariah Carey), which travels further than performance claims in markets it cannot saturate with ad spend."
  ]],

  ["sec", 3, "Market sizing (global)"],
  ["tbl", ["Segment", "Size / figure", "Source &amp; note"], [
    ["Global adaptogen coffee", "~$1.1 to 1.7B (2025) &rarr; $2.35 to 3.46B by 2030 to 33; ~6 to 17% CAGR", "{L} FMI / HTF / Research and Markets (wide scope variance)"],
    ["Global adaptogenic beverages", "~$1.4 to 2.2B (2024 to 26) &rarr; $2.5 to 6.7B (2034); 6.5 to 14.8% CAGR", "{L} GMI / Stratistics"],
    ["Regional CAGR leaders", "Germany 6.8% &middot; US 6.7% &middot; France 6.5% &middot; China 6.0% &middot; UK 5.1% &middot; India 5.0%", "{C} Future Market Insights"],
    ["Regional share", "North America ~34.8% of adaptogen beverages (2025); Asia-Pacific fastest-growing", "{L} Data Bridge"],
    ["Lead ingredient", "Ashwagandha = #1 adaptogen (~18 to 26% share); Arabica = 45% of coffee bases", "{C} FMI, favours VAHDAM's formula"],
    ["Europe loose-leaf tea", "$0.98B (2025) &rarr; $1.47B (2034), 4.59% CAGR", "{C} Market Data Forecast"]
  ], "The through-line: ashwagandha plus Arabica, VAHDAM's exact combination, is the lead ingredient pairing of the fastest-growing beverage sub-category worldwide."],

  ["sec", 4, "Global brand-footprint matrix", "Where each named competitor is actually a major player, mapped to every region they are famous in, the competitive overlap VAHDAM meets outside its three core markets."],
  ["tbl", ["Brand", "Home", "Also a major player in", "Category"], [
    ["Four Sigmatic", "US (Finnish roots)", "US, EU, UK, Canada, ANZ", "Mushroom coffee pioneer"],
    ["Ryze", "US", "US, UK, Canada, global DTC", "Mushroom-coffee DTC leader"],
    ["MUD\\WTR", "US", "US; ships international", "Coffee-alternative ritual"],
    ["AG1 (Athletic Greens)", "US", "US, UK, ANZ, Canada, EU", "Greens / daily ritual"],
    ["Happy Mammoth", "Australia", "AU, US, UK, EU", "Women's hormone / cortisol"],
    ["Spacegoods", "UK", "UK, EU; expanding US", "Adaptogen coffee"],
    ["DIRTEA", "UK", "UK, EU", "Mushroom coffee and powders"],
    ["Yogi Tea", "Germany / US", "EU, US, global", "Wellness herbal tea"],
    ["Pukka", "UK", "UK, EU, global", "Organic / Ayurvedic herbal tea"],
    ["Kusmi, Palais des Thes, Mariage Freres", "France", "EU, global luxury retail", "Luxury French tea"],
    ["TWG Tea", "Singapore", "SE Asia, GCC, global luxury malls", "Luxury tea"],
    ["Dilmah", "Sri Lanka", "Global; strong ANZ, EU, MEA", "Ceylon tea"],
    ["Ito En", "Japan", "Japan, US", "Green tea / matcha"],
    ["<b>VAHDAM</b>", "India", "~145 countries (Global storefront)", "Premium tea + adaptogen coffee"]
  ], "{C} on home markets; {L} on also-major-in breadth. The exporters VAHDAM already meets in the US/UK reappear across EU/Canada/ANZ, the competitive set travels with the brand."],

  ["sec", 5, "Region-by-region"],
  ["cards", 2, [
    ["Europe (ex-UK), the biggest rest-of-world prize", "{C} Germany and France are the largest and fastest-growing European adaptogen-coffee markets; premium tea is a mature, design-led category with strong local incumbents. <b>Players:</b> Yogi Tea, Teekanne, Ronnefeldt, TeaGschwendner (Germany), Kusmi, Palais des Thes, Mariage Freres (France luxury); Four Sigmatic and Spacegoods lead the adaptogen push; Pukka strong in organic/Ayurvedic. <b>VAHDAM read:</b> Winnable. Origin plus design plus press halo fit the premiumisation trend; the fight is against luxury-tea incumbents and the same UK/US adaptogen exporters. EFSA health-claim rules are strict, lead with taste/ritual, not physiology."],
    ["Canada, a US mirror", "{L} Structurally close to the US: DTC-receptive, functional-coffee-aware, bilingual. US adaptogen brands (Four Sigmatic, Ryze, AG1) already ship here; DavidsTea is the home premium-tea name; Tim Hortons owns mass. <b>VAHDAM read:</b> Winnable, low-friction, replicate the US playbook (ashwagandha calm-energy plus gifting) with minimal localisation. Watch Health Canada's NHP licensing for any functional claim."],
    ["Australia and New Zealand, wellness-native", "{L} A disproportionately wellness-forward market; coffee is culturally central and functional/adaptogen is the fast-growing premium edge. Happy Mammoth is Australia-founded; T2 (Unilever) and Tielka lead premium tea; AG1 and Four Sigmatic are strong. <b>VAHDAM read:</b> Winnable. High wellness receptivity plus gifting culture suit VAHDAM; a sophisticated coffee palate rewards the real-Arabica angle. TGA plus FSANZ govern messaging."],
    ["GCC / Middle East, gifting and premium ritual", "{L} Tea and coffee are deep cultural rituals (gahwa, chai) and gifting is a major, high-margin occasion. Ahmad Tea and Lipton are ubiquitous; TWG owns luxury-mall prestige. <b>VAHDAM read:</b> Winnable, gifting-led. Premium packaging, single-origin story and loved-in-145-countries prestige fit gifting and affluent expat demand. Requires halal certification and SFDA-type label compliance; keep claims conservative."],
    ["East Asia (China and Japan), present, not winning", "{L} Tea-origin superpowers with entrenched domestic leaders, Ten Fu and vast local players in China; Ito En and the matcha economy in Japan. An Indian tea brand has little structural edge selling tea into the birthplace of tea. <b>VAHDAM read:</b> Present, not a priority. The only plausible wedge is adaptogen coffee (not tea) to urban wellness buyers, and even there local and US brands are better placed. Do not fund a tea push here."]
  ]],

  ["sec", 6, "VAHDAM Global, strategic read"],
  ["bul", [
    "<b>Fund the winnable four.</b> Concentrate localisation and spend on EU-ex-UK, Canada, ANZ and the GCC. Treat everywhere else as fulfilment, not acquisition.",
    "<b>Lead with halo, not physiology.</b> In markets you cannot out-spend, the press/celebrity/luxury-list credibility travels further, and dodges the strict EU/TGA/EFSA claim regimes.",
    "<b>Make gifting the global wedge.</b> Premium gift sets are high-margin, low-CAC, and play to VAHDAM's design equity, especially GCC and EU festive.",
    "<b>Localise the compliance, not the product.</b> One SKU, region-specific claims: halal (GCC), NHP (Canada), EFSA (EU), TGA/FSANZ (ANZ)."
  ]],
  ["card", ["{L} The rest-of-world story is focus: four markets to win, a gifting-and-halo playbook to win them with, and the discipline not to chase tea-origin Asia."]],

  ["sec", 7, "Regulatory patchwork"],
  ["bul", [
    "<b>EU:</b> EFSA authorised health claims, strict; most adaptogen physiological claims are not authorised. Lead with taste/ritual.",
    "<b>Canada:</b> Health Canada NHP licensing required for functional claims.",
    "<b>Australia/NZ:</b> TGA (therapeutic claims) plus FSANZ (food standards).",
    "<b>GCC:</b> halal certification plus SFDA-type labelling; conservative claims."
  ]],
  ["card", ["{L} Net: rest-of-world is the strictest claims terrain VAHDAM operates in, another reason the halo/gifting playbook beats a claims-led one abroad."]],

  ["sec", 8, "White space and recommendations"],
  ["bul", [
    "Ashwagandha plus Arabica is the lead global ingredient pairing, VAHDAM already makes it; most exporters are mushroom-led.",
    "Premium gifting is an underworked, high-margin global lane suited to VAHDAM's equity.",
    "The Indian-brand-loved-in-145-countries / by-A-listers halo is a rare rest-of-world asset, use it as the lead, not a footnote.",
    "Concentration beats coverage: winning four markets outperforms shipping to 145."
  ]],

  ["sec", 9, "Sources"],
  ["card", ["Research and press (2026 pulls): Future Market Insights, HTF, Research and Markets, GMI, Stratistics, Data Bridge (global adaptogen coffee/beverage sizing and regional CAGRs); Market Data Forecast (Europe loose-leaf); Mordor (Australia coffee); Luxe Digital / Modern Luxury / TasteAtlas (global luxury-tea rankings and brand footprints); Wikipedia/TeaBrands/RateTea (regional brand lists); TWG, Yogi, Kusmi, Palais des Thes brand references; vahdam.global. Figures are directional and scope-dependent; confidence tags reflect source strength."]]
];

REPORTS.India = [
  ["sec", 1, "Scope &amp; method"],
  ["card", ["{C} India is not a smaller version of the US/UK adaptogen-coffee market, it is a different structure, and this study is built around that. Three distinct arenas matter: (a) the mass tea duopoly, (b) the coffee-D2C surge, and (c) the Ayurveda and wellness boom, where functional is native, not imported."]],
  ["bul", [
    "Figures from named India market-research previews and startup press (June to July 2026 pull); ranges shown where firms disagree.",
    "Regulatory frame is FSSAI (food) plus the AYUSH ministry (Ayurvedic products/claims), a different regime from FDA/DSHEA or MHRA.",
    "The central analytical flip: in India, ashwagandha/turmeric/chai are native commodities. VAHDAM's global origin-authenticity moat weakens at home, so the differentiator must change."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", [
    "{C} India is the world's largest tea producer and consumer; ~80% of production is consumed domestically and tea is a daily rupee-priced staple. The mass market is a Tata Consumer / Hindustan Unilever duopoly, a Red Ocean VAHDAM cannot and should not fight on price.",
    "{L} VAHDAM's home-market position is a premium-D2C sliver of a huge, low-margin category. It secured &#8377;25cr from SIDBI Venture Capital (Mar 2025) and leans on single-origin, farmer-direct, carbon-neutral, export-grade quality, a genuine premium story in a commodity ocean.",
    "{L} The sharp problem: VAHDAM's worldwide edge, authentic Indian origin, is table stakes in India. Everyone here is origin. So at home the differentiators must flip to (1) premiumisation and single-origin, (2) format innovation (Ashwagandha Coffee is genuinely novel against both mass tea and capsule-Ayurveda), (3) design/brand cachet including loved-in-145-countries reverse-prestige, and (4) D2C plus quick-commerce execution.",
    "{L} VAHDAM competes for two different wallets: the premium-beverage-ritual wallet (vs Blue Tokai, premium tea, Chaayos) and the functional-wellness wallet (vs Kapiva, OZiva, Dabur/Himalaya). Ashwagandha Coffee is the rare SKU that bridges both, that intersection is the wedge."
  ]],

  ["sec", 3, "Market sizing"],
  ["tbl", ["Segment", "Size / figure", "Source &amp; note"], [
    ["India tea market", "~$11.7 to 11.9B (2024/25); ~3 to 4% CAGR; volume ~1.4M tons", "{C} IMARC / CMI / EMR (firms cluster here)"],
    ["India tea structure", "Black tea 68%; loose 44%; residential 80%; largest producer and consumer, ~80% domestic", "{C} IMARC / Ken Research"],
    ["India premium tea", "~1.20M tons (2025) &rarr; 1.81M tons (2035), 4.2% CAGR", "{C} Expert Market Research"],
    ["India coffee market", "~$1.46B &rarr; ~$2.03B (2025 est.); packaged base ~9.9% CAGR", "{L} Mordor / CMI (scope varies widely)"],
    ["Global Ayurveda market", "$20.42B (2025) &rarr; $85.83B (2033), 19.72% CAGR", "{C} via Open Magazine"],
    ["India wellness D2C reach", "~44% of wellness/skincare orders now from Tier-III cities and beyond", "{C} ClickPost FY26"]
  ], "Note the asymmetry: tea is a ~$12B commodity growing low-single-digits; Ayurveda/wellness is smaller but compounding ~20%/yr. VAHDAM's growth is in the wellness/premium layer, not the tea tonnage."],

  ["sec", 4, "Structural dynamics"],
  ["sub", "The tea duopoly and the premium sliver"],
  ["card", ["{C} Tata Consumer (Tata Tea, Tetley, Gold, Premium) and HUL (Brooke Bond Red Label, Taj Mahal, 3 Roses, Lipton) dominate on distribution depth and rural penetration. Tata's Jan-2024 acquisition of Organic India folded a wellness-tea brand into the incumbent, the giants are now moving into VAHDAM's premium/wellness lane."]],
  ["sub", "Coffee: at-home ritual plus D2C"],
  ["card", ["{C} Traditional coffee is Nescafe / Bru / Tata Coffee. The growth story is at-home premium ritual led by D2C: Blue Tokai (single-origin, ~$180M valuation, $25M raised Sept 2025, 100+ cafes), Sleepy Owl (cold brew, &#8377;100cr, 15K+ retail), Rage Coffee (plant-based, vitamin-enriched, the closest functional-coffee analog), Third Wave (100+ cafes)."]],
  ["sub", "Ayurveda as the native functional category"],
  ["card", ["{L} What the West calls adaptogens India calls Ayurveda, and it is a trusted, mass, centuries-old category owned by Dabur, Himalaya (1930) and Patanjali, now being modernised by D2C players Kapiva and OZiva. Ashwagandha is a household word, not a novelty. That both lowers education cost and removes VAHDAM's novelty premium."]],
  ["sub", "Where demand is growing"],
  ["bul", [
    "D2C wellness has jumped the metros: ~44% of wellness/skincare orders now come from Tier-III cities and beyond, smartphone plus quick-commerce led.",
    "Premiumisation, single-origin and clean/organic are the levers pulling value up in an otherwise flat tea market."
  ]],

  ["sec", 5, "Major players, India tea"],
  ["tbl", ["Brand", "Owner / type", "Scale / share", "Positioning", "Read for VAHDAM"], [
    ["Tata Consumer", "Tata group", "Co-leader (duopoly)", "Full-spectrum; regional blends; premiumising (Gold Care); bought Organic India (2024)", "Incumbent now entering wellness/premium too"],
    ["HUL / Brooke Bond", "Hindustan Unilever", "Co-leader (duopoly)", "Red Label, Taj Mahal, 3 Roses, Lipton; distribution depth; Taj Mahal = premium standard", "Unbeatable on reach, do not fight here"],
    ["Wagh Bakri", "Gujarat Tea Processors &amp; Packers", "#3; strong West India", "130-yr heritage; tea lounges; experiential retail", "Regional strength plus experiential model"],
    ["Society Tea", "Amar Tea", "Regional (Maharashtra)", "Value / regional loyalty", "Regional value, not a premium comp"],
    ["<b>VAHDAM</b>", "VAHDAM (D2C)", "Premium-D2C sliver", "Single-origin, farmer-direct, carbon-neutral, export-grade; &#8377;25cr SIDBI (2025)", "Home turf = premium D2C / gifting"],
    ["TeaBox", "TeaBox (D2C)", "Premium D2C", "Fresh single-estate; tech-enabled freshness", "Closest premium-D2C tea rival"],
    ["Chaayos", "Sunshine Teahouse", "Cafe chain + retail", "Experiential chai; Meri Wali Chai customisation", "Owns the chai-ritual occasion (different model)"]
  ], "{C} on duopoly and D2C set. VAHDAM and TeaBox are the two names analysts cite as the premium-D2C benchmark inside a mass market."],

  ["sec", 6, "Major players, India coffee"],
  ["tbl", ["Brand", "Type", "Founded", "Positioning", "Scale / funding", "Read for VAHDAM"], [
    ["Nescafe", "Traditional (Nestle)", "n/a", "Mass instant leader", "Dominant", "Owns mass instant"],
    ["Bru", "Traditional (HUL)", "n/a", "Mass instant / filter", "Dominant", "Mass instant / South India"],
    ["Tata Coffee", "Plantation + brands (Tata)", "n/a", "Vertically integrated grower + brands", "Large", "Integrated but not premium-D2C"],
    ["Blue Tokai", "Specialty D2C + cafe", "2012/13", "Single-origin Indian; educates the market", "~$180M valn; $25M (Sep 2025); 100+ cafes", "Rival for the premium-beverage-ritual wallet"],
    ["Sleepy Owl", "D2C", "2016", "Cold brew / at-home convenience", "&#8377;100cr; 15K+ retail; quick-commerce", "Convenience-led D2C benchmark"],
    ["Rage Coffee", "D2C", "2018", "Plant-based, vitamin-enriched, functional coffee", "Growing; offline expansion", "Closest functional-coffee analog"],
    ["Third Wave", "Cafe chain", "2016", "Specialty cafe; franchise scale", "100+ outlets", "Cafe model; owns discovery"]
  ], "VAHDAM's Ashwagandha Coffee competes on the premium/ritual axis with Blue Tokai and on the functional/enhanced axis with Rage, but is the only one pairing real coffee with a native adaptogen story."],

  ["sec", 7, "Major players, India Ayurveda and wellness"],
  ["tbl", ["Brand", "Type", "Positioning", "Scale", "Read for VAHDAM"], [
    ["Dabur", "Legacy FMCG-Ayurveda", "Chyawanprash, honey, Vedic range; mass authority", "Large, listed", "Ayurveda authority plus mass distribution"],
    ["Himalaya", "Legacy (1930)", "Herbal healthcare and personal care; omni-channel, international", "Large", "Deep herbal trust; very broad"],
    ["Patanjali", "Legacy (mass)", "Swadeshi mass Ayurveda; price-led", "Large", "Mass Ayurveda on price, not VAHDAM's lane"],
    ["Organic India", "Now Tata (acq. 2024)", "Organic tulsi/wellness teas + supplements", "Mid; Tata-backed", "Direct wellness-tea rival, now inside the duopoly"],
    ["Kapiva", "Modern-Ayurveda D2C", "Condition-led (gut/hair/metabolic); juices and shots", "&#8377;342cr FY25 (+50%); &#8377;69cr loss", "Ayurveda-2.0 D2C benchmark, but unprofitable"],
    ["OZiva", "Plant-based wellness D2C", "Women's / PCOS nutrition; Instagram community", "Strong D2C brand", "Community-led wellness rival"]
  ], "The Ayurveda arena is where adaptogen demand actually sits in India, but it is crowded, trust-driven, and margin-punishing for newer D2C entrants."],

  ["sec", 8, "Competitor deep-dives"],
  ["cards", 2, [
    ["VAHDAM India (anchor)", "Premium, export-grade Indian tea and adaptogen coffee, the global brand at home. <b>Hero:</b> single-origin teas (Darjeeling, Assam, chai, green, herbal) plus Ashwagandha Coffee (KSM-66, Lion's Mane, Turmeric, Chaga). <b>Capital:</b> &#8377;25cr from SIDBI Venture Capital (Mar 2025); scaling carbon-neutral certified exports. <b>Strengths:</b> a real global brand with premium design, quality systems and gifting equity most Indian D2C tea brands lack; Ashwagandha Coffee is a genuinely novel format bridging tea, coffee and Ayurveda. <b>Openings:</b> Indian origin is not a home-market moat, everyone here is origin; must out-execute on premium/brand/format; Ayurvedic-D2C economics are brutal."],
    ["Tata Consumer and HUL (the duopoly)", "The two giants that own mass tea, now buying into wellness. <b>Tata:</b> Tata Tea/Tetley/Gold/Premium; acquired Organic India (2024); premiumising via Gold Care. <b>HUL:</b> Brooke Bond plus Lipton; unmatched rural and modern-trade distribution; Taj Mahal as the premium anchor. <b>Openings:</b> slow, mass, and brand-diluted at the top end; cannot deliver the curated single-origin, design-led, direct experience a focused premium brand can. VAHDAM wins on depth, not breadth."],
    ["Blue Tokai", "India's specialty-coffee darling, the premium at-home ritual benchmark. Single-origin Indian coffee, farm-direct; educated the urban market on roast/brew; 100+ cafes plus strong online; ~$180M valuation, $25M bridge (Sep 2025). <b>Openings:</b> no functional/adaptogen angle and no tea heritage, the calm-energy adaptogen-coffee position is open for VAHDAM to take."],
    ["Kapiva and OZiva", "The modern-Ayurveda / plant-wellness D2C benchmarks, and a cautionary tale. Kapiva: condition-led modern Ayurveda; &#8377;342cr FY25 (+50%) but &#8377;69cr loss. OZiva: plant-based women's/PCOS nutrition; category-defining Instagram community. <b>Openings:</b> structurally unprofitable at scale (heavy CAC); ingestible-supplement formats, not a daily-ritual beverage, VAHDAM's coffee format is a friendlier habit and a differentiated wedge."]
  ]],

  ["sec", 9, "VAHDAM India, strategic read"],
  ["card", ["{L} At home, drop authentic Indian origin as the lead differentiator, it is parity. Win on four things instead:"]],
  ["bul", [
    "<b>Premium and single-origin, not commodity.</b> Position explicitly above the Tata/HUL mass tier; sell provenance, freshness and design, not rupee-per-cup.",
    "<b>Own the bridge SKU.</b> Ashwagandha Coffee is the only product that is simultaneously a premium coffee ritual (vs Blue Tokai) and a native functional/Ayurveda product (vs Kapiva/OZiva). Make it the flagship of the India story, not a side-line.",
    "<b>Reverse-prestige the global brand.</b> The Indian tea brand loved in 145 countries is a rare aspirational angle at home, use it.",
    "<b>Guard CAC like the category-killer it is.</b> Kapiva's losses are the warning. Lean on gifting, quick-commerce, retention and the existing global supply chain rather than pure ad-led acquisition."
  ]],

  ["sec", 10, "Regulatory notes (India)"],
  ["bul", [
    "<b>FSSAI:</b> governs food and nutraceutical labelling and permissible claims; health-supplement vs food classification affects what can be said.",
    "<b>AYUSH ministry:</b> oversees Ayurvedic products/claims; positioning a product as Ayurvedic vs a food-with-adaptogens changes the compliance path.",
    "<b>Practical rule:</b> ashwagandha as a traditional wellness ingredient is well accepted; avoid disease-cure and quantified physiological claims regardless of regime."
  ]],

  ["sec", 11, "White space and recommendations"],
  ["bul", [
    "Premium adaptogen coffee is essentially uncontested in India, Blue Tokai has no functional angle; Rage is vitamin-enriched, not Ayurveda; Ayurveda brands are not in daily coffee.",
    "Gifting plus festive is a high-margin, low-CAC lane that suits VAHDAM's design equity and export-grade packaging.",
    "Quick-commerce (Blinkit/Instamart/Zepto) is where premium daily-ritual demand now converts, match Sleepy Owl's distribution playbook.",
    "A curated global-quality, made-in-India premium tea plus coffee bundle has no direct equivalent across the duopoly, the coffee-D2C set, or the Ayurveda D2C set."
  ]],

  ["sec", 12, "Sources"],
  ["card", ["Research and press (June to July 2026 pulls): IMARC, Custom Market Insights, Expert Market Research, Ken Research, Facts and Factors, Market Research Future (India tea sizing and structure); Mordor / CMI (India coffee); Inc42, Indian Retailer, ClickPost, Nivara (India coffee-D2C and wellness-D2C landscape and funding); Open Magazine (Ayurvedic-D2C economics and global Ayurveda size); company/press references for Tata Consumer, HUL, Wagh Bakri, Blue Tokai, Sleepy Owl, Rage, Kapiva, OZiva; vahdam.in / SIDBI funding press. Figures are directional and scope-dependent; confidence tags reflect source strength."]]
];

/* one-line strategic synthesis shown per region above the report */
var SYNTH = {
  US: "Origin moat at its strongest. Rivals import ashwagandha; VAHDAM owns it and is already in ~1,000 Target stores. Win the ashwagandha-forward calm-energy lane the mushroom-led leaders leave open.",
  UK: "Origin is parity, not advantage: Spacegoods and London Nootropics use the same KSM-66. Win instead on real Arabica coffee (vs cocoa), the 90-day guarantee, and the heritage tea house behind the coffee.",
  Global: "Neither origin nor incumbency wins here. Lead with the press/celebrity halo and premium gifting, concentrate spend on the winnable four (EU-ex-UK, Canada, ANZ, GCC), and localise the compliance, not the product.",
  India: "Origin is parity at home, everyone is origin. Win on premium/single-origin, the bridge SKU (Ashwagandha Coffee), reverse-prestige (loved in 145 countries), and disciplined CAC."
};

/* ---- confidence legend (page) ---- */
function legendPage() {
  return '<div class="card p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">How to read the confidence tags</div><div class="mt-2 text-sm space-y-1" style="color:var(--vahdam-ink);">' +
    "<div>" + tagChip("C") + "Cited source, competitor page, or retrieved figure.</div>" +
    "<div>" + tagChip("L") + "Strong inference across multiple named sources.</div>" +
    '</div><p class="text-[12px] mt-2" style="color:var(--soft);">Every figure here is sourced or a strong multi-source inference; speculative points have been excluded.</p></div>';
}

/* group a region's nodes into ordered category buckets */
function groupByCat(region) {
  var map = CATMAP[region];
  var groups = {};
  var cur = "overview";
  REPORTS[region].forEach(function (n) {
    if (n[0] === "sec") cur = map[n[1]] || "overview";
    if (!groups[cur]) groups[cur] = [];
    groups[cur].push(n);
  });
  return groups;
}

/* ---- public: the on-page report block inner HTML for a region ---- */
function reportInnerHTML(region) {
  var m = META[region];
  var base = "/docs/market-study/" + m.file;
  var head = '<div class="card p-5" style="border-color:var(--vahdam-gold);"><div class="flex flex-wrap items-center gap-3"><div class="flex-1 min-w-[220px]"><div class="font-head text-lg text-vahdam-green">' + m.panelTitle + '</div><div class="text-[12.5px]" style="color:var(--soft);">Prepared for ' + m.prep + " &middot; 9 July 2026 &middot; confidence-tagged throughout.</div></div>" +
    '<a class="btn-primary px-5 py-2.5 text-sm" href="' + base + '.pdf" download>Download PDF</a>' +
    '<a class="btn-gold px-5 py-2.5 text-sm" href="' + base + '.docx" download>Download DOC</a></div></div>';
  var synth = '<div class="card p-5" style="background:rgba(0,74,43,.05);"><div class="text-[11px] uppercase tracking-[.06em] font-bold gold-ink">VAHDAM position, ' + region + '</div><p class="text-sm mt-1" style="color:var(--vahdam-ink);">' + SYNTH[region] + "</p></div>";

  var groups = groupByCat(region);
  var present = CATS.filter(function (c) { return groups[c[0]] && groups[c[0]].length; });
  var tabs = present.map(function (c, i) {
    return '<button type="button" class="mstab' + (i === 0 ? " on" : "") + '" data-cat="' + c[0] + '">' + c[1] + "</button>";
  }).join("");
  var tabbar = '<div class="flex flex-wrap gap-2 mt-4" data-ms-cattabs>' + tabs + "</div>";
  var panels = present.map(function (c, i) {
    return '<div data-cat-panel="' + c[0] + '" class="space-y-3 mt-4"' + (i === 0 ? "" : ' style="display:none"') + ">" + renderNodes(groups[c[0]], "page") + "</div>";
  }).join("\n");

  return head + "\n" + legendPage() + "\n" + synth + "\n" + tabbar + "\n" + panels;
}

/* ---- public: standalone HTML for the downloadable .docx ---- */
function docHTML(region) {
  var m = META[region];
  var css = "body{font-family:Georgia,'Times New Roman',serif;color:#171717;line-height:1.45;max-width:760px;margin:0 auto;padding:24px;}" +
    "h1{color:#004A2B;font-size:26px;margin-bottom:2px;}h2{color:#004A2B;font-size:18px;border-bottom:2px solid #AB8743;padding-bottom:3px;margin-top:26px;}h3{color:#004A2B;font-size:14px;margin-top:16px;}" +
    "table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;}th{background:#004A2B;color:#FBF5EA;text-align:left;padding:5px;}td{border:1px solid #ccc;padding:5px;vertical-align:top;}" +
    "ul{margin:6px 0;}li{margin:3px 0;}p{margin:6px 0;}.kick{color:#8a6a2f;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;font-size:11px;}.sub{color:#555;font-style:italic;}";
  var body = renderNodes(REPORTS[region], "doc");
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + m.panelTitle + "</title><style>" + css + "</style></head><body>" +
    '<p class="kick">Market Research and Competitive Study</p>' +
    "<h1>" + m.docTitle + "</h1>" +
    '<p class="sub">' + m.sub + "</p>" +
    "<p>Prepared for: " + m.prep + " &middot; Date: 9 July 2026 &middot; Confidence-tagged: [Certain] (cited) / [Likely] (strong multi-source inference). Speculative points excluded.</p>" +
    '<p><strong>VAHDAM position (' + region + "):</strong> " + SYNTH[region] + "</p><hr>" +
    body +
    "</body></html>";
}

/* =====================================================================
   DOCX (WordprocessingML) renderer, so downloads work without LibreOffice
   ===================================================================== */
function decodeEntities(s) {
  return String(s)
    .replace(/&#8377;/g, "₹").replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·").replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function xesc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function wRun(text, bold, colour) {
  var props = "";
  if (bold) props += "<w:b/>";
  if (colour) props += '<w:color w:val="' + colour + '"/>';
  var rpr = props ? "<w:rPr>" + props + "</w:rPr>" : "";
  return "<w:r>" + rpr + '<w:t xml:space="preserve">' + xesc(text) + "</w:t></w:r>";
}
function toRuns(raw) {
  var s = String(raw).replace(/\{C\}/g, "<b>[Certain]</b> ").replace(/\{L\}/g, "<b>[Likely]</b> ");
  s = decodeEntities(s);
  var parts = s.split(/(<b>|<\/b>)/);
  var bold = false, out = "";
  parts.forEach(function (p) {
    if (p === "<b>") { bold = true; return; }
    if (p === "</b>") { bold = false; return; }
    if (!p) return;
    out += wRun(p, bold);
  });
  return out;
}
function pHead(text, sz) {
  return '<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="004A2B"/><w:sz w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + xesc(decodeEntities(text)) + "</w:t></w:r></w:p>";
}
function pItalic(text) {
  return '<w:p><w:r><w:rPr><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">' + xesc(decodeEntities(text)) + "</w:t></w:r></w:p>";
}
function pRuns(runsXml) { return "<w:p>" + runsXml + "</w:p>"; }
function pBullet(runsXml) {
  return '<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>' + wRun("•  ") + runsXml + "</w:p>";
}
function wTable(headers, rows) {
  var borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (e) {
    return "<w:" + e + ' w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>';
  }).join("");
  var tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblBorders>' + borders + "</w:tblBorders></w:tblPr>";
  var grid = "<w:tblGrid>" + headers.map(function () { return '<w:gridCol/>'; }).join("") + "</w:tblGrid>";
  function cell(inner, fill) {
    var shd = fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : "";
    return "<w:tc><w:tcPr>" + shd + "</w:tcPr><w:p>" + inner + "</w:p></w:tc>";
  }
  var hr = "<w:tr>" + headers.map(function (h) { return cell(wRun(decodeEntities(h), true, "FBF5EA"), "004A2B"); }).join("") + "</w:tr>";
  var body = rows.map(function (r) {
    return "<w:tr>" + r.map(function (c) { return cell(toRuns(c)); }).join("") + "</w:tr>";
  }).join("");
  return "<w:tbl>" + tblPr + grid + hr + body + "</w:tbl>";
}
function docxDocumentXml(region) {
  var m = META[region];
  var body = pHead(m.docTitle, 34) + pItalic(m.sub) +
    pRuns(wRun("Prepared for: " + decodeEntities(m.prep) + ".  9 July 2026.  Confidence-tagged: [Certain] (cited) / [Likely] (strong multi-source inference). Speculative points excluded.")) +
    pRuns(wRun("VAHDAM position (" + region + "): ", true) + wRun(SYNTH[region]));
  REPORTS[region].forEach(function (n) {
    var t = n[0];
    if (t === "sec") { body += pHead(n[1] + ". " + n[2], 28); if (n[3]) body += pItalic(n[3]); }
    else if (t === "sub") { body += pHead(n[1], 24); }
    else if (t === "card") { n[1].forEach(function (p) { body += pRuns(toRuns(p)); }); }
    else if (t === "bul") { n[1].forEach(function (it) { body += pBullet(toRuns(it)); }); }
    else if (t === "tbl") { body += wTable(n[1], n[2]); if (n[3]) body += pItalic(decodeEntities(String(n[3]).replace(/\{C\}/g, "[Certain] ").replace(/\{L\}/g, "[Likely] "))); }
    else if (t === "cards") { n[2].forEach(function (it) { body += pHead(it[0], 24); body += pRuns(toRuns(it[1])); }); }
  });
  var sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + sect + "</w:body></w:document>";
}

module.exports = { REGIONS: REGIONS, META: META, reportInnerHTML: reportInnerHTML, docHTML: docHTML, docxDocumentXml: docxDocumentXml };

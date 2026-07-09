"use strict";
/**
 * Market Study content, single source of truth for all four regional reports
 * (US, UK, Global/Rest-of-World, India). Transcribed from the final analyst
 * PDFs shared 9 July 2026 (the fuller 12/13-section versions).
 *
 *   reportInnerHTML(region) -> on-page report block (categorized sub-tabs +
 *                              card / grid-tbl / gold-ink styling + confidence chips)
 *   docHTML(region)         -> clean standalone HTML (reference)
 *   docxDocumentXml(region) -> WordprocessingML body for the downloadable .docx
 *
 * Brand rules: no em/en dashes, straight quotes, four-colour palette. Only
 * sourced facts, all speculative ("Guessing") content is excluded.
 */

var REGIONS = ["US", "UK", "Global", "India"];

var META = {
  US: {
    file: "US_Functional_Wellness_Market_Study",
    panelTitle: "US Functional-Wellness Market Study",
    docTitle: "The U.S. Functional-Wellness Beverage &amp; Supplement Market",
    sub: "Tea, Coffee, Adaptogens, Supplements, with a competitor teardown of the adaptogen-coffee arena",
    prep: "Growth &amp; Digital Production, VAHDAM (US market)"
  },
  UK: {
    file: "UK_Functional_Wellness_Market_Study",
    panelTitle: "UK Functional-Wellness Market Study",
    docTitle: "The U.K. Functional-Wellness Beverage &amp; Supplement Market",
    sub: "Tea, Functional Coffee, Adaptogens, a full competitive teardown of the UK arena",
    prep: "Growth &amp; Digital Production, VAHDAM UK (VI Consumer Ltd)"
  },
  Global: {
    file: "Global_RestOfWorld_Wellness_Market_Study",
    panelTitle: "Global (Rest-of-World) Wellness-Beverage Market Study",
    docTitle: "The Global (Rest-of-World) Wellness-Beverage Market",
    sub: "Every region except the US, UK and India, a full teardown of where VAHDAM wins vs is merely present",
    prep: "Growth &amp; Digital Production, VAHDAM (Global / vahdam.global)"
  },
  India: {
    file: "India_Wellness_Beverage_Market_Study",
    panelTitle: "India Wellness-Beverage &amp; Ayurveda Market Study",
    docTitle: "The India Wellness-Beverage &amp; Ayurveda Market",
    sub: "Tea, Coffee-D2C, Ayurveda and Adaptogens, a full competitive teardown of the home market",
    prep: "Growth &amp; Digital Production, VAHDAM (India / home market)"
  }
};

/* Category sub-tabs, in display order. Only categories with content render. */
var CATS = [
  ["overview", "Overview"],
  ["market", "Market &amp; demand"],
  ["competitors", "Competitors"],
  ["strategy", "Strategy &amp; white space"],
  ["regulatory", "Regulatory"],
  ["sources", "Sources"]
];
/* section-number -> category, per region */
var CATMAP = {
  US: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" },
  UK: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" },
  Global: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "competitors", 9: "market", 10: "strategy", 11: "regulatory", 12: "strategy", 13: "sources" },
  India: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" }
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
  return String(s).replace(/\{([CL])\}/g, function (_, t) {
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
    } else if (type === "head") {
      if (mode === "page") out.push('<div class="mt-8"><h2 class="font-head text-2xl md:text-3xl text-vahdam-green mt-1">' + n[1] + "</h2>" + (n[2] ? '<p class="text-sm mt-2 max-w-3xl" style="color:var(--soft);">' + n[2] + "</p>" : "") + "</div>");
      else out.push("<h2>" + n[1] + "</h2>" + (n[2] ? "<p><em>" + n[2] + "</em></p>" : ""));
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
        var mw = headers.length >= 6 ? "920px" : (headers.length >= 4 ? "760px" : "560px");
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
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Tea, coffee, or supplements\" is not one market, it is three multi-billion-dollar categories with different buyers, margins, shelf logic and regulators. This report anchors on the single arena where all three collide and where VAHDAM actually competes in the US: the functional-wellness beverage and supplement segment, premium/functional tea, adaptogen and functional coffee (especially ashwagandha and mushroom coffee), and the greens/adaptogen supplements adjacent to them.",
    "{L} This is the highest-leverage cut because VAHDAM's US growth engine is Ashwagandha Coffee (now in ~1,000 Target stores) sitting on a premium-tea heritage."
  ]],
  ["bul", [
    "Market sizing for US tea, US coffee (incl. functional and mushroom coffee) and US dietary supplements/adaptogens, with the honest source-to-source variance shown.",
    "A tiered competitive landscape and deep-dive profiles of eleven brands across the adaptogen-coffee, greens, women's-hormone and premium-tea sub-segments.",
    "Side-by-side comparison tables: price-per-serving, caffeine, formula, positioning and DTC mechanics.",
    "Consumer demand signals, the DTC playbook, the US regulatory frame (FDA/FTC/DSHEA) and a white-space read."
  ]],
  ["card", ["{C} Method: ~30 primary sources retrieved July 2026 (Mordor, Grand View, Precedence, IMARC, Fact.MR, SNS, Fortune Business Insights) plus brand pages, retailer listings and review data. Warning: market-size estimates vary enormously between firms, the same US tea market is quoted ~$1.5B to ~$3.6B by scope. Treat single-point figures as directional; the ranges and direction of travel are the reliable signal."]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} The center of gravity is not tea or coffee as commodities, it is function. Across all three categories the money and growth move to products promising a benefit beyond taste or caffeine: calm energy, focus, stress/cortisol support, gut health, sleep. Functional coffee is the fastest-growing slice of the complex."]],
  ["bul", [
    "<b>Fastest-growing slice, functional coffee.</b> Global functional coffee ~$4.48B (2025) growing ~11.2% CAGR to ~$8.5B by 2031, roughly 2.5x conventional coffee, North America ~69%. Ashwagandha is a headline ingredient.",
    "<b>Ashwagandha is the breakout adaptogen.</b> ~26 to 39% of the adaptogens category by revenue; US demand ~11.4% CAGR; ashwagandha in functional food and beverage the fastest sub-segment at ~15.6% CAGR.",
    "<b>Crowded and price-anchored.</b> Adaptogen-coffee rivals cluster ~$0.90 to $1.70/serving (Ryze, MUD\\WTR, Four Sigmatic, Everyday Dose, Spacegoods); AG1 anchors the ceiling ~$2.60 to $3.30; VAHDAM Target SRP ~$0.80 is the aggressive end.",
    "<b>The playbook is standardized.</b> Subscription-default checkout, 30 to 90-day money-back, starter kits with free gifts/frother, loud social proof (Ryze 200K+ reviews, Happy Mammoth 3.3M customers) and, increasingly, a crossover into physical retail.",
    "<b>VAHDAM's structural edge is under-exploited.</b> Most rivals are single-hero-SKU brands buying the same KSM-66 extract; VAHDAM owns farmer-direct Indian sourcing, a genuine tea range and origin authenticity for the exact ingredients rivals import, a moat no pure-play can copy.",
    "<b>The compliance line is the battleground.</b> Growth rests on stress/cortisol/weight claims at the FDA/FTC structure-function boundary; staying clean is a trust-differentiation opportunity."
  ]],

  ["sec", 3, "Market sizing (US, with global context)", "Spread across research firms shown, not hidden. 2025 base unless noted; USD."],
  ["tbl", ["Segment", "Size", "CAGR", "Source(s)"], [
    ["US tea (retail)", "~$1.5B to $3.6B (firms disagree widely)", "~2.8 to 6.7%", "IMARC $1.54B; MarknTel $3.11B; SNS $3.59B"],
    ["US herbal tea", "~$3.1B", "~3.4%", "Global Growth Insights; Fact.MR"],
    ["North America tea (incl. RTD/foodservice)", "~$42B (2025) &rarr; $44B (2026)", "~4.9%", "Mordor Intelligence"],
    ["Global tea", "~$70B (2025)", "~6.5%", "Grand View Research"],
    ["US coffee", "~$23.8 to 24.0B", "~3.8 to 4.5%", "Mordor $23.76B; MarketDataForecast $23.86B"],
    ["Global functional coffee", "~$4.48B &rarr; $8.48B by 2031", "~11.2% (fastest)", "Mordor Intelligence"],
    ["US mushroom coffee", "~$618M (2025) &rarr; $1.09B (2035)", "~5.8%", "Precedence Research"],
    ["US dietary supplements", "~$60.2B &rarr; $96.5B by 2034", "~5.4%", "IMARC"],
    ["Global adaptogens", "~$9.0B to $15.8B (wide range)", "~3.3 to 7.9%", "FMI $8.96B; DataM $15.84B; Fortune $11.9B"],
    ["Global ashwagandha", "~$0.67 to 0.76B (2025)", "~9 to 10%", "SNS $0.67B; Mordor $0.76B"],
    ["US ashwagandha", "~$0.13B (2025) &rarr; $0.39B (2035)", "~11.4% (fastest region)", "SNS Insider"]
  ], "Ranges reflect genuine methodology differences (retail-only vs incl. RTD/foodservice). Use direction and relative size, not any single point value."],
  ["sub", "3.1 Tea, large, slow, premiumizing"],
  ["card", ["{C} US tea at retail is a mature low-single-digit grower, but value migrates up-market: herbal/wellness tea (~$3.1B) is where the energy is, with ~62% of US herbal-tea buyers choosing blends for a specific functional benefit. Black tea still dominates volume (~42% US share); loose-leaf and RTD grow faster. Tea is VAHDAM's credibility and margin base, not the growth story."]],
  ["sub", "3.2 Coffee, the commodity is flat, the function is exploding"],
  ["card", ["{C} US coffee (~$24B) grows low-single-digits, but two slices break out: specialty coffee (~7% CAGR) and functional coffee (~11%+ globally, NA ~69%). Adaptogen espresso/lattes command $8 to 12 per 12oz in cafes. Mushroom coffee alone is a ~$618M sub-market. May 2026: Starbucks+PepsiCo launched RTD Coffee &amp; Protein; Four Sigmatic moved into national grocery, function is leaving the niche."]],
  ["sub", "3.3 Supplements &amp; adaptogens, ashwagandha the breakout"],
  ["card", ["{C} US dietary supplements ~$60B (~5.4%). Ashwagandha is the single most important adaptogen, ~26 to 39% of adaptogen revenue and the top mood-support botanical. The decisive stat: ashwagandha in functional food and beverage is the fastest format at ~15.6% CAGR, pulling ashwagandha out of the capsule and into the cup, exactly VAHDAM's thesis. ~54 to 62% still sells as capsules today; gummies (~12.8%) and beverages (~15.6%) are the growth formats. KSM-66 and Shoden are the clinically-validated extracts credible brands standardize on."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Calm energy is the narrative", "{C} Almost every functional-coffee brand sells the lift of coffee without the jitters/crash plus a mood/focus/stress benefit. No jitters, no crash, calm focus is now table-stakes copy. Differentiation has moved from the promise to the proof."],
    ["Cortisol / stress / weight adjacency", "{C} The most aggressive growth lever and the biggest compliance risk is the cortisol to stress to cravings to weight chain (Happy Mammoth, and on-site coffee testimonials). Powerful and legally hazardous."],
    ["GLP-1 halo &amp; the stress-belly audience", "{L} The weight conversation (amplified by GLP-1 drugs) primes a large audience for cortisol/stress-belly/cravings messaging, women 35 to 55. High demand, high scrutiny."],
    ["Clean-label &amp; the trust arms race", "{C} No fillers/additives/mycotoxins is standard. Trust proxies escalate: NSF Certified for Sport (AG1), USDA Organic (Ryze, MUD\\WTR, Four Sigmatic), third-party testing, KSM-66. Ryze is called out for NOT publishing third-party results. PFAS testing of tea is an emerging trust vector."],
    ["DTC-first, then retail crossover", "{C} Born online (~60%+ of mushroom-coffee sales) but winners cross to shelf: Four Sigmatic grocery, VAHDAM ~1,000 Target (Mar 2026), AG1 experiential. Retail is the credibility and scale unlock once DTC CAC gets expensive."],
    ["Subscription is the model", "{C} Default-to-subscribe, ~10 to 40% subscriber discount, reminder emails, easy pause/cancel, universal across Ryze, MUD\\WTR, Four Sigmatic, AG1, Spacegoods and VAHDAM. Surprise auto-renewal is the category's top complaint."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The arena around VAHDAM's US Ashwagandha Coffee sorts into five tiers; VAHDAM straddles two."],
  ["cards", 2, [
    ["Tier 1, Adaptogen / functional-coffee challengers", "<b>VAHDAM's direct fight.</b> Ryze, MUD\\WTR, Four Sigmatic, Everyday Dose, Spacegoods, Laird Superfood, Om. Single-hero-SKU, DTC-native, mushroom/adaptogen + coffee. Where VAHDAM Ashwagandha Coffee lives day-to-day."],
    ["Tier 2, Greens &amp; all-in-one giants", "<b>Aspirational ceiling.</b> AG1 (Athletic Greens), Live it Up, Amazing Grass, Your Super. Not coffee, but they compete for the one daily wellness ritual wallet and set the premium price ceiling and the influencer standard."],
    ["Tier 3, Women's-hormone / adaptogen supplements", "<b>Shared audience, different format.</b> Happy Mammoth, Ancient Nutrition. Capsule format, but they own the cortisol/menopause/cravings narrative and the women-35-55 audience VAHDAM's testimonials chase."],
    ["Tier 4, Premium / specialty tea DTC", "<b>VAHDAM's heritage arena.</b> Rishi, Harney &amp; Sons, Art of Tea, Tea Forte, Adagio, Tea Drops, The Republic of Tea. Origin, craft, single-estate. VAHDAM is benchmarked here by analysts."],
    ["Tier 5, Mass wellness tea", "<b>Shelf incumbents.</b> Traditional Medicinals, Yogi, Pukka (Unilever), Celestial Seasonings, Bigelow, Numi, Twinings. Pukka reported ~27% growth in adaptogenic/Ayurvedic teas, the wellness-tea overlap with VAHDAM."]
  ]],
  ["card", ["{L} Where VAHDAM sits: uniquely at the intersection of Tier 1 (adaptogen coffee) and Tier 4 (premium origin tea), with the sourcing authenticity to attack Tier 3's narrative honestly. No pure-play challenger occupies that overlap."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["VAHDAM (anchor)", "\"Feel Alive.\" Premium Indian tea + adaptogen coffee, farmer-direct from origin. <b>Hero:</b> Ashwagandha Coffee, Arabica + KSM-66, Lion's Mane, Turmeric (95% curcumin), Chaga, L-Theanine; instant, 40 to 240 servings DTC. <b>Price:</b> Target SRP $15.99/20 (~$0.80/serving); DTC bundles + subscription with 5-day reminder, 30-day money-back. <b>Retail:</b> ~1,000 Target stores (Mar 2026). <b>Strengths:</b> origin authenticity for the exact ingredients rivals import; real product breadth + heritage tea; retail ahead of most pure-plays; aggressive price; founder-origin story (Bala Sarda). <b>Openings:</b> brand meaning split across tea, coffee and spices, less single-minded than a Ryze; on-site cortisol/weight testimonials carry FTC/ASA risk."],
    ["Ryze", "The category's DTC volume leader. \"Mushroom coffee, reimagined.\" Organic instant Arabica + Super6 mushroom blend + prebiotics; no ashwagandha. ~$0.90 to $1.20/serving; ~48mg caffeine (medium); subscription-default, 30-day MBG. Claims 200,000+ 5-star reviews, US-only shipping. <b>Openings:</b> no public third-party testing; mushroom-only leaves the ashwagandha/cortisol lane open; surprise-subscription complaints; grainier taste noted."],
    ["MUD\\WTR", "The \"quit coffee\" purist. :rise cacao/masala-chai + 6 mushrooms + turmeric + Himalayan salt. ~$1.50 to $1.70/serving (premium end); ~35mg caffeine (lowest of the majors); free frother; 30-day MBG. Venice, CA design-led lifestyle brand, full dose transparency. <b>Openings:</b> divisive spicy/earthy taste; highest price; low caffeine won't satisfy people who still want a real lift."],
    ["Four Sigmatic", "The pioneer / mainstream mushroom brand, now in grocery. Lion's Mane + Chaga instant/ground; broad line. ~$1.13 to $2.25/serving; ~50 to 80mg caffeine (closest to real coffee); subscription 20% + codes. <b>Openings:</b> formulation seen as lighter/less differentiated; doesn't specify individual doses (transparency gap); range sprawl dilutes focus."],
    ["Everyday Dose", "The value-plus formulator. Lion's Mane + Chaga (fruiting-body) + L-Theanine + collagen + coffee extract. Under ~$1/serving, the strongest value-per-formula; ~45mg caffeine paired with L-theanine for calm alertness. <b>Openings:</b> lower brand awareness than Ryze/MUD\\WTR; collagen makes it non-vegan; narrower range."],
    ["Spacegoods", "The sharpest mirror of VAHDAM. \"Coffee that does more.\" Rainbow Dust, Lion's Mane + Cordyceps + Chaga + KSM-66 + Maca, chocolate/hot-cocoa taste; publishes real doses (1,000mg each mushroom + KSM-66), ~80mg caffeine. Uses the SAME KSM-66 extract as VAHDAM. 60-day MBG; UK/EU-based, ships US via a localized store + Amazon. <b>Openings:</b> US is a shipped-in market (no US shelf); imports its ashwagandha, VAHDAM grows the story at source and is in Target."],
    ["AG1 (Athletic Greens)", "The premium ceiling &amp; the influencer-marketing standard. AG1 Next Gen, 75+ ingredient greens powder, not coffee. $79/mo sub / $99 one-time (~$2.63 to $3.30/serving), the category ceiling; 90-day MBG; FSA/HSA. Huberman, Hugh Jackman, Lewis Hamilton; NSF Certified for Sport. <b>Openings:</b> very expensive; dietitians question nutrient-stuffing/value; not a coffee/taste ritual, leaving the functional-coffee-you-enjoy lane open."],
    ["Happy Mammoth", "The cortisol/menopause narrative leader, capsule not cup. Hormone Harmony, KSM-66 + ~12 extracts, 3 caps/day. ~$2.92/serving; free shipping over $99; 60-day MBG on first bottle. Women 35 to 55; 2-minute quiz funnel; claims 3.3M customers / 13.4M bottles. <b>Openings:</b> capsule not an enjoyable ritual; overtly aggressive weight/hormone claims (regulatory exposure), VAHDAM can offer the same KSM-66 benefit in a cup people enjoy."],
    ["Premium &amp; wellness tea set (Tier 4/5)", "VAHDAM's heritage arena. Premium DTC: Rishi, Harney &amp; Sons, Art of Tea, Tea Forte, Adagio, Tea Drops. Wellness/mass: Traditional Medicinals (+22% functional YoY), Yogi, Pukka/Unilever (+27% adaptogenic), Celestial, Bigelow, Numi, Twinings, Republic of Tea. Analyst read: VAHDAM differentiates via farmer-direct + origin storytelling. <b>Openings:</b> mostly slow-growth commodity-adjacent; few have cracked the adaptogen-coffee crossover, precisely VAHDAM's opening."]
  ]],

  ["sec", 7, "Side-by-side comparison tables", "Prices as retrieved Jul 2026; treat per-serving as bands. VAHDAM shown at Target SRP."],
  ["sub", "7.1 Adaptogen-coffee arena, price, caffeine, format"],
  ["tbl", ["Brand", "Price/serving", "Caffeine", "Format", "Signature formula"], [
    ["<b>VAHDAM Ashwagandha Coffee</b>", "~$0.80 (Target SRP) / DTC bundles", "coffee-level (Arabica)", "Instant", "KSM-66 + Lion's Mane + Turmeric + Chaga + L-Theanine"],
    ["Ryze", "$0.90 to $1.20", "~48mg (med)", "Instant", "Super6 mushrooms + prebiotics (no ashwagandha)"],
    ["MUD\\WTR :rise", "~$1.50 to $1.70", "~35mg", "Powder (frother)", "6 mushrooms + cacao + masala chai + turmeric"],
    ["Four Sigmatic", "$1.13 to $2.25", "~50 to 80mg", "Instant/Ground", "Lion's Mane + Chaga (+ Rhodiola)"],
    ["Everyday Dose", "under ~$1.00", "~45mg", "Powder", "Lion's Mane + Chaga + L-Theanine + collagen"],
    ["Spacegoods Rainbow Dust", "sub (B1 / B2G1)", "~80mg", "Powder", "Lion's Mane + Cordyceps + Chaga + KSM-66 + Maca"],
    ["AG1 (context)", "$2.63 to $3.30", "none", "Powder (greens)", "75+ greens/vitamins/probiotics/adaptogens"]
  ]],
  ["sub", "7.2 Positioning &amp; hero claim"],
  ["tbl", ["Brand", "Positioning", "Hero claim (paraphrased)"], [
    ["<b>VAHDAM</b>", "Calm energy, origin-authentic", "Farmer-direct Indian KSM-66 ashwagandha coffee, clean, clinically-backed, from source"],
    ["Ryze", "Volume leader / reimagined coffee", "Mushroom coffee with 200K+ reviews, half the caffeine, no crash"],
    ["MUD\\WTR", "Quit coffee entirely", "Ultra-low-caffeine adaptogenic tonic; ritual &amp; lifestyle"],
    ["Four Sigmatic", "The original, tastes like coffee", "Mushrooms in your normal coffee, mainstream &amp; in grocery"],
    ["Everyday Dose", "Best value formula", "Coffee + lion's mane + L-theanine + collagen, calm alertness"],
    ["Spacegoods", "Coffee that does more", "Dosed KSM-66 + mushrooms, hot-choc taste, daily ecosystem"],
    ["AG1", "One scoop, whole-body base", "Premium all-in-one daily nutrition, celebrity-endorsed"],
    ["Happy Mammoth", "Hormone/cortisol for women", "Balance hormones, cravings &amp; menopause, quiz-led"]
  ]],
  ["sub", "7.3 DTC &amp; commercial mechanics"],
  ["tbl", ["Brand", "Subscription", "Money-back", "Acquisition offer", "Channels"], [
    ["<b>VAHDAM</b>", "Yes (5-day reminder)", "30-day", "Starter/welcome kits + free gifts", "DTC + ~1,000 Target + 100+ countries"],
    ["Ryze", "Yes (default)", "30-day", "Bundles, creamer, tumbler", "DTC + Amazon (US only)"],
    ["MUD\\WTR", "Yes", "30-day", "Free frother, starter kit", "DTC + Amazon"],
    ["Four Sigmatic", "Yes (20%+codes)", "n/a", "Sample/bundles", "DTC + national grocery"],
    ["Everyday Dose", "Yes", "n/a", "Starter kit", "DTC"],
    ["Spacegoods", "Yes (B1/B2G1)", "60-day", "Sample pack", "DTC (UK/EU to US shipped) + Amazon"],
    ["AG1", "Yes", "90-day", "Welcome kit, D3+K2, travel packs", "DTC + Amazon; FSA/HSA"],
    ["Happy Mammoth", "Yes", "60-day (1st bottle)", "Quiz to bundle funnel", "DTC + Amazon"]
  ]],
  ["sub", "7.4 Ashwagandha &amp; KSM-66, who actually uses it"],
  ["tbl", ["Brand", "KSM-66 ashwagandha", "How it is used"], [
    ["<b>VAHDAM</b>", "KSM-66 yes", "Coffee, cortisol/calm energy; sourced at origin in India"],
    ["Spacegoods", "KSM-66 yes", "Coffee/cocoa, dosed with mushrooms; imported extract"],
    ["Happy Mammoth", "KSM-66 yes", "Capsule, women's hormone/menopause/cravings"],
    ["Ryze", "No (mushroom-only)", "Leaves the ashwagandha/cortisol lane open"],
    ["MUD\\WTR", "No", "Adaptogenic spices/mushrooms, no ashwagandha hero"],
    ["Four Sigmatic", "No (Rhodiola in some)", "Mushroom-led"],
    ["AG1", "Trace (blend)", "Ashwagandha/Rhodiola as part of a 75-ingredient stack, not hero"]
  ], "Strategic read: the three brands genuinely built on KSM-66 are VAHDAM, Spacegoods and Happy Mammoth. Only VAHDAM combines it with a coffee ritual, origin sourcing and US retail, the others each miss one."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Who buys:</b> functional/mushroom-coffee demand skews 25 to 44 wellness millennials; women 35 to 55 dominate the hormone/cortisol sub-segment. Specialty coffee is ~64% weekly among 25 to 39s.",
    "<b>Where:</b> e-commerce is ~60%+ of mushroom-coffee purchases; California, New York and Texas lead US volume; the West Coast over-indexes on specialty.",
    "<b>Why:</b> ~62% of US herbal-tea buyers choose for a specific function; the sober-curious and reduce-sugar shifts push functional beverages as soda/energy-drink alternatives.",
    "<b>What they pay for:</b> proof, named clinical extracts (KSM-66), organic/third-party testing, transparent dosing and taste (the #1 repeat-purchase driver; earthy/gritty is the top churn reason).",
    "<b>Top complaint:</b> surprise subscription auto-renewal, recurring across Ryze and others. A transparent, well-timed reminder (VAHDAM does a 5-day reminder) is a retention advantage."
  ]],

  ["sec", 9, "The DTC playbook, what the winners do"],
  ["bul", [
    "<b>Sell a subscription, not a product.</b> Default-to-subscribe, 10 to 40% discount, easy pause/cancel, timed reminders to blunt churn.",
    "<b>De-risk the first purchase.</b> 30 to 90-day money-back is universal; starter kits bundle a frother, creamer, tumbler or free gift.",
    "<b>Weaponize social proof.</b> Ryze 200K+ reviews, Happy Mammoth 3.3M customers / 13.4M bottles, AG1 celebrity roster. Volume-of-proof is the primary trust lever.",
    "<b>Lead with a named, dosed, clinical ingredient.</b> KSM-66, fruiting-body extracts, exact mg. Transparency now differentiates (Spacegoods/MUD\\WTR win; Ryze/Four Sigmatic dinged for opacity).",
    "<b>Use a diagnostic funnel.</b> Happy Mammoth's 2-minute quiz personalizes the pitch and captures email, a pattern VAHDAM could adopt for the coffee.",
    "<b>Cross into retail once DTC CAC bites.</b> Four Sigmatic (grocery), VAHDAM (Target), AG1 (experiential). Shelf = credibility + scale + lower blended CAC.",
    "<b>Own a taste-first flavour story.</b> Spacegoods (hot chocolate), Everyday Dose (smooth, creamy) beat the mud/earthy incumbents on the #1 repeat-purchase driver."
  ]],

  ["sec", 10, "US regulatory frame (the compliance battleground)"],
  ["card", ["{C} This category grows on claims that sit exactly on the legal line. For a compliance-conscious brand this is both the biggest risk and a trust-differentiation opportunity."]],
  ["cards", 3, [
    ["DSHEA &amp; structure/function", "Adaptogen coffees/supplements are regulated as dietary supplements or conventional foods. Structure/function claims (helps maintain healthy cortisol levels) need the FDA disclaimer and substantiation; disease claims (treats anxiety, cures) make it an unapproved drug. Note how carefully VAHDAM/Spacegoods hedge (help balance, support)."],
    ["FTC substantiation", "The FTC requires competent and reliable scientific evidence for health/weight claims and polices testimonials. Weight-loss and reduces-cortisol-X% claims are high-risk. Aggressive rivals carry real exposure; a measured brand earns a durable trust edge."],
    ["Caffeine, safety &amp; clean-label", "FDA guidance ~400mg/day; new 2025 caffeine limits prompt reformulation. Emerging ashwagandha liver-toxicity reports and a UK FSA review make clean, tested KSM-66 a defensive necessity. PFAS non-detect results are marketing assets."]
  ]],
  ["card", ["{L} Net: the safest growth path is measured structure/function language + visible third-party testing + a named clinical extract, which also happens to be the cleanest differentiator against louder rivals."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["sub", "Where the open space is"],
  ["cards", 2, [
    ["Origin-authentic adaptogen coffee", "Every rival imports its ashwagandha/turmeric; none can credibly claim farmer-direct-from-India for the hero ingredients. A defensible, un-copyable story, lead with it harder than another mushroom coffee."],
    ["KSM-66 coffee for the Happy Mammoth audience", "Happy Mammoth owns the cortisol/cravings/women-35-55 narrative but delivers a capsule. A KSM-66 coffee is the same benefit in a ritual people enjoy, a direct wedge if claims stay compliant."],
    ["Taste-first + transparency", "Incumbents split into tastes-earthy (MUD\\WTR/Ryze) and opaque-dosing (Four Sigmatic). A taste-led, fully-dosed, third-party-tested KSM-66 coffee occupies the gap Spacegoods chases, but with US retail and origin they lack."],
    ["The tea to coffee bridge", "No pure-play challenger has a real tea range. VAHDAM can cross-sell a wellness ecosystem (chai, functional herbal tea, ashwagandha coffee, spices) that raises LTV with genuine depth."]
  ]],
  ["sub", "Where to be careful"],
  ["bul", [
    "<b>Claims discipline.</b> The cortisol-to-weight testimonials on-site are the category norm but the highest-risk element. Measured language is both compliant and, increasingly, a trust differentiator.",
    "<b>Subscription CX.</b> The category's #1 complaint is surprise renewals. Make cancellation frictionless and say so, turning the weakness into a stated advantage.",
    "<b>Don't out-spend, out-authenticate.</b> Ryze/AG1 win on ad volume and celebrity. VAHDAM competes on origin proof, transparency and product breadth, not CAC."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Primary sources retrieved July 2026: Mordor, Grand View, IMARC, Precedence, SNS Insider, Fact.MR, Future Market Insights, Fortune Business Insights, DataM, Global Growth Insights, Technavio, MarketDataForecast (sizing); brand pages (vahdam.com, ryzesuperfoods.com, mudwtr.com, foursigmatic.com, spacegoods.com, drinkag1.com, happymammoth.com, rishi-tea.com); BevNET (VAHDAM Target launch, $15.99/20, Mar 2026); independent reviews (1800D2C, Holistic Digest, My Subscription Addiction, SuppCo); Mamavation (PFAS); FDA/FTC/DSHEA and the UK FSA ashwagandha review. Figures are directional and scope-dependent; confidence tags reflect source strength."]]
];

REPORTS.UK = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", ["{C} \"Tea, coffee, or supplements\" is not one market, it is several multi-billion categories with different buyers, margins, shelf logic and regulators. This report anchors on the single arena where they collide and where VAHDAM actually competes: the functional-wellness beverage and supplement segment, premium/functional tea, adaptogen and functional coffee, and the adaptogen/wellness products adjacent to them."]],
  ["bul", [
    "Market sizing for UK tea, UK functional/adaptogen coffee and the UK functional-mushroom / adaptogen-supplement crossover, with source-to-source variance shown.",
    "A five-tier competitive landscape plus deep-dive profiles of eight brands across adaptogen coffee, premium wellness tea, greens and women's-hormone sub-segments.",
    "Four side-by-side comparison tables: price-per-serving, formula, positioning/hero claim, DTC mechanics and the KSM-66 ashwagandha question.",
    "Consumer demand signals, the UK DTC playbook, the ASA/CAP + MHRA regulatory frame and a white-space read."
  ]],
  ["card", ["{C} Method: primary sources retrieved July 2026 (research firms, brand pages, retailer listings, review data). Warning: market-size estimates vary enormously between firms; the same category is quoted across wide ranges by retail vs foodservice vs RTD scope. Treat single-point figures as directional; ranges and direction of travel are the reliable signal."]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} The UK tea market is bifurcated: a saturated Red Ocean of commodity black tea (~75% of sales, owned by four legacy brands where share is won over decades) and a fast-growing Blue Ocean of wellness/functional infusions and adaptogen coffee where the legacy giants are weak. VAHDAM should never fight the first and should own a slice of the second."]],
  ["bul", [
    "<b>The KSM-66 collision is the defining fact.</b> VAHDAM's hero ingredient is already used by its two sharpest UK rivals, Spacegoods and London Nootropics. In the UK, Crafted in India / KSM-66 is parity, not a moat. VAHDAM is fighting home-grown incumbents, not importers.",
    "<b>Spacegoods is the category front-runner.</b> UK-founded (2021), &pound;2.5M raised, openly targeting European market leadership; it defined the coffee-plus adaptogen format, but its hero is cacao-forward, not real coffee.",
    "<b>London Nootropics owns credibility.</b> Doctor-backed, named branded extracts (Rhodiolife, Hifas da Terra, KSM-66), two targeted adaptogens per blend, the clinical high ground VAHDAM must contest, not cede.",
    "<b>Two proven acquisition playbooks.</b> Influencer-led high-dose low-price (DIRTEA, ~&pound;0.40 to 0.55/serving) vs clinical-credibility (London Nootropics). VAHDAM currently runs neither cleanly.",
    "<b>VAHDAM's real, copy-proof edges are three.</b> (1) a genuine multi-category heritage-tea business behind the coffee; (2) a 90-day money-back guarantee, longer than every rival (Spacegoods 60, most 30); (3) origin ownership of the botanicals rivals buy in.",
    "<b>Claims are the battleground.</b> The ASA/CAP code and MHRA medicine boundary make the cortisol/weight testimonials that work in the US a direct UK liability, the most likely trigger for a ruling or forced takedown."
  ]],

  ["sec", 3, "Market sizing (UK, with global context)", "Spread across firms shown. 2024/25 base; GBP or USD as noted."],
  ["tbl", ["Segment", "Size", "CAGR", "Source(s)"], [
    ["UK tea (retail)", "~&pound;660M+ (black tea ~75% of sales)", "low single %", "UK trade/industry"],
    ["UK tea volume", "~100K tons (2024, +20% spike)", "~+1.8% vol / +2.9% value", "IndexBox"],
    ["Europe loose-leaf tea", "$0.98B (2025) &rarr; $1.47B (2034)", "4.59%", "Market Data Forecast"],
    ["UK functional-mushroom (broad)", "~$1.85B (2024)", "~10%+", "DataM Intelligence"],
    ["Global adaptogenic mushroom", "$10.9B (2022) &rarr; $30B (2032)", "~10%", "Global Market Insights"],
    ["Global mushroom coffee", "$1.26B (2024) &rarr; $5.56B (2035)", "~7%", "Data Bridge / Precedence"],
    ["Global adaptogen coffee", "~$1.1 to 1.7B (2025)", "~6 to 17% (firms vary)", "FMI / HTF / Research and Markets"]
  ], "Ranges reflect real scope differences (broad functional-mushroom incl. food/extracts vs narrow retail supplements). Use direction and relative size."],
  ["sub", "3.1 Tea, mature, premiumising, wellness-led at the edge"],
  ["card", ["{C} UK tea is a slightly declining volume game where value migrates up-market. Black tea still holds ~75% of sales, but the growth sits in premium herbal/wellness blends (&pound;10 to &pound;35/pack) and in matcha, over 50% of UK under-35s consumed matcha in late 2025. Tea is a credibility and margin base in the UK, not the growth story."]],
  ["sub", "3.2 Functional coffee, the real battleground"],
  ["card", ["{C} Mushroom/adaptogen coffee is the fastest-growing acquisition format in UK wellness, led by sachets/instant that live inside the coffee ritual and remove supplement stigma. The UK trade press explicitly points to the US (Ryze, Four Sigmatic at eight-figure revenues) as the template the UK is now following."]],
  ["sub", "3.3 Adaptogens &amp; mushrooms, blue-ocean but crowding fast"],
  ["card", ["{C} The broad UK functional-mushroom market (~$1.85B, DataM) spans food, extracts, powders and coffee. Lion's mane is the fastest-growing species; ashwagandha (KSM-66) is the herbal adaptogen of choice, and, critically, already the shared hero of Spacegoods and London Nootropics. The blue ocean is filling in."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Red Ocean vs Blue Ocean", "{C} Commodity black tea is a mature, price-competitive volume game (Yorkshire, PG Tips, Tetley, Twinings = 70%+). The wellness/functional layer, matcha, herbal functional blends, adaptogen coffee, is where younger buyers, premium price bands and digital-first brands concentrate. VAHDAM belongs only in the second."],
    ["The sachet is the acquisition weapon", "{C} Instant single-serve sachets dominate UK adaptogen-coffee acquisition (Spacegoods, London Nootropics, DIRTEA). The format lowers trial friction and reframes a supplement as a nicer coffee. VAHDAM's opportunity is a genuinely coffee-first taste vs rivals' cocoa-forward profiles."],
    ["Two playbooks: influencer vs clinical", "{C} DIRTEA runs the influencer-led, high-dose, aggressive-price motion; London Nootropics runs the doctor-backed, named-extract, credibility motion; Spacegoods sits between with a lifestyle brand. VAHDAM must pick and commit rather than blur."],
    ["The matcha boom &amp; the under-35 buyer", "{C} Over 50% of UK under-35s consumed matcha in late 2025 (Mintel). The same cohort drives functional coffee and clean caffeine. The demand-side wind is behind ashwagandha-coffee, the question is share capture, not category demand."],
    ["KSM-66 parity, differentiation must move", "{L} Because VAHDAM, Spacegoods and London Nootropics all use KSM-66, the ingredient story is neutralised. Differentiation has to move to taste (real coffee), range (tea heritage), risk-reversal (90-day MBG) and provenance (owning the source)."],
    ["Claim gravity: ASA/CAP + MHRA", "{C} The UK regime is materially stricter than the US. The MHRA polices the medicine boundary; ASA/CAP requires authorised, substantiated health claims and forbids testimonials making claims a brand couldn't make directly. Lowers-cortisol-by-X% and weight-loss testimonials are the classic triggers."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The UK arena around VAHDAM sorts into five tiers; VAHDAM straddles two."],
  ["cards", 2, [
    ["Tier 1, Adaptogen / functional-coffee challengers", "<b>VAHDAM's direct fight.</b> Spacegoods, London Nootropics, DIRTEA, Four Sigmatic, Ryze (ships UK), Balance Coffee. Sachet/instant, DTC-native, ashwagandha or mushroom + coffee, and where two rivals already own KSM-66."],
    ["Tier 2, Premium wellness / herbal tea", "<b>VAHDAM's heritage overlap.</b> Pukka, Teapigs, Clipper, Yogi. Organic, Ayurvedic-influenced, whole-leaf. Pukka (Ayurvedic-herbal, B Corp) overlaps VAHDAM's wellness-tea positioning most directly."],
    ["Tier 3, Legacy black-tea Big Four", "<b>Do not fight.</b> Yorkshire Tea, PG Tips, Tetley, Twinings. 70%+ of black tea, won on distribution and decades of brand-building. A price/volume war VAHDAM cannot and should not enter."],
    ["Tier 4, Greens &amp; all-in-one", "<b>Aspirational ceiling.</b> AG1 (strong UK presence), Huel-adjacent daily nutrition. Not coffee, but they compete for the one daily wellness ritual wallet and set the premium ceiling and influencer standard."],
    ["Tier 5, Women's-hormone / cortisol supplements", "<b>Shared audience.</b> Happy Mammoth (Australia-founded, strong UK), Ancient-Nutrition-style capsules. Capsule format, but they own the cortisol/menopause/cravings narrative and the women-35-55 audience."]
  ]],
  ["card", ["{L} Where VAHDAM sits: at the Tier 1 x Tier 2 overlap (adaptogen coffee + premium origin tea), with the sourcing to attack Tier 5's narrative honestly. No UK pure-play occupies that overlap."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["VAHDAM UK (anchor)", "\"Feel Alive.\" Premium Indian tea + adaptogen coffee, crafted in India, sold to the UK. <b>Hero:</b> Ashwagandha Coffee, 100% Arabica + KSM-66, Lion's Mane, 95%-curcumin Turmeric, Chaga; instant, 1 scoop (2.5g), 40 to 240 servings DTC. <b>Guarantee:</b> 90-day money-back, longer than every rival, an under-marketed trust lever. 150K+ customers, free UK delivery. <b>Strengths:</b> owns the origin of botanicals rivals import; deepest product range; longest guarantee; credible reverse-import prestige. <b>Openings:</b> KSM-66 is not exclusive (Spacegoods, London Nootropics use it); cortisol/weight testimonials are an ASA/CAP + MHRA liability; split brand meaning dilutes the single-minded punch a Spacegoods lands."],
    ["Spacegoods", "The UK category front-runner. Coffee-plus, energy and focus without the crash. Rainbow Dust, cacao-forward instant with Lion's Mane, Cordyceps, Chaga, Maca, Ashwagandha + B-vitamins; ~&pound;1.30/sachet; subscription default; 60-day guarantee; B1/B2G1 promos. &pound;2.5M seed (Five Seasons Ventures et al.); targeting European leadership; publishes third-party testing. <b>Openings:</b> cacao-forward reads as functional hot chocolate, not real coffee, VAHDAM's Arabica base is a genuine wedge; no heritage-tea catalogue behind it."],
    ["London Nootropics", "The credibility play. Two targeted, named-supplier adaptogens per blend. Flow (Lion's Mane + Rhodiola), Zen, Mojo, instant sachets with Rhodiolife Rhodiola, Hifas da Terra extracts, KSM-66, all branded and traceable; ~&pound;0.80 to 1.25/serving; doctor endorsements; honest that doses sit at the lower clinical band. <b>Openings:</b> lower-band dosing; narrower range; less lifestyle pull than Spacegoods, VAHDAM can out-dose and out-range."],
    ["DIRTEA", "The influencer-led volume machine. 1000mg Lion's Mane; Chaga; Cordyceps; broad powder range beyond coffee; ~&pound;0.40 to 0.55/serving on subscription, the price-aggressive end; heavy influencer marketing and retail presence. <b>Openings:</b> instant coffee base rated fine but flat; low-price positioning cedes the premium/quality story to VAHDAM."],
    ["Four Sigmatic (import)", "The international pioneer with UK shelf presence. Lion's Mane + Chaga, instant + ground, the brand that normalised mushroom coffee globally; ~&pound;1.10 to 2.25/serving; lab-tested; across UK/EU wellness retail. <b>Openings:</b> no ashwagandha lead; mushroom coffee, leaving the ashwagandha calm-energy angle contestable."],
    ["Ryze (US, ships UK)", "The DTC volume leader with strong UK search demand. Super-6 mushroom blend (no ashwagandha); instant; subscription-default; 200K+ reviews globally; ~&pound;0.90 to 1.20/serving-equiv. <b>Openings:</b> US brand without UK-local trust cues or ashwagandha; no tea range; auto-renew complaints."],
    ["Pukka (Tier 2 overlap)", "The UK organic-herbal / Ayurvedic-tea incumbent. Organic, Ayurvedic-influenced herbal blends; B Corp; owned by Lipton Teas &amp; Infusions; reported strong growth in adaptogenic/Ayurvedic teas. <b>Openings:</b> tea-only, no coffee/adaptogen-coffee play; corporate-owned, less founder-origin authenticity than VAHDAM."],
    ["Happy Mammoth (Tier 5)", "The cortisol/hormone-funnel benchmark, strong in the UK. Hormone Harmony capsules, KSM-66 + 12 extracts; women/menopause/cortisol; quiz funnel; 3.3M customers; ~$2.92-equiv/serving; 60-day MBG. <b>Openings:</b> capsules, not a daily-ritual beverage; aggressive claims carry ASA risk, VAHDAM can out-format with the same KSM-66 credibility, more cleanly."]
  ]],

  ["sec", 7, "Side-by-side comparison tables", "Formats certain; per-serving pricing varies by pack/subscription."],
  ["sub", "7.1 Adaptogen-coffee arena, price, format, formula"],
  ["tbl", ["Brand", "Price/serving", "Format", "Signature formula"], [
    ["<b>VAHDAM UK</b>", "DTC bundles", "Instant + real Arabica", "KSM-66 + Lion's Mane + Turmeric 95% + Chaga"],
    ["Spacegoods", "~&pound;1.30", "Instant, cacao-forward", "Lion's Mane, Cordyceps, Chaga, Maca, Ashwagandha, B5"],
    ["London Nootropics", "~&pound;0.80 to 1.25", "Instant sachets", "Lion's Mane + Rhodiola + KSM-66 (2 per blend)"],
    ["DIRTEA", "~&pound;0.40 to 0.55", "Instant + powders", "Lion's Mane 1000mg, Chaga, Cordyceps"],
    ["Four Sigmatic", "~&pound;1.10 to 2.25", "Instant + ground", "Lion's Mane, Chaga"],
    ["Ryze", "~&pound;0.90 to 1.20", "Instant", "Super-6 mushrooms"],
    ["Balance Coffee", "Higher", "Ground / whole bean", "Lion's Mane 500mg + real coffee"]
  ]],
  ["sub", "7.2 Positioning &amp; hero claim"],
  ["tbl", ["Brand", "Positioning", "Hero claim (paraphrased)"], [
    ["<b>VAHDAM UK</b>", "Origin-authentic calm-energy coffee + tea house", "Crafted in India, backed by science; calm focus, no jitters"],
    ["Spacegoods", "Lifestyle coffee-plus", "Energy, focus &amp; calm in one tasty scoop"],
    ["London Nootropics", "Clinical, doctor-backed", "Named extracts for focus / calm / drive"],
    ["DIRTEA", "Influencer wellness", "High-dose mushrooms, everyday ritual"],
    ["Four Sigmatic", "Pioneer, lab-tested", "Think/immune mushroom coffee"],
    ["Ryze", "Mass DTC", "Mushroom coffee, reimagined"]
  ]],
  ["sub", "7.3 DTC &amp; commercial mechanics"],
  ["tbl", ["Brand", "Subscription", "Money-back", "Acquisition offer", "Channels"], [
    ["<b>VAHDAM UK</b>", "Yes, 5-day reminder", "90-day", "Starter kits + free gifts", "DTC + marketplaces"],
    ["Spacegoods", "Default", "60-day", "B1/B2G1 promos", "DTC + Amazon"],
    ["London Nootropics", "Yes", "Standard", "Sampler / bundles", "DTC + practitioners"],
    ["DIRTEA", "Yes", "Standard", "Sub discount, high-dose", "DTC + retail"],
    ["Four Sigmatic", "Yes", "Standard", "Bundles", "DTC + wellness retail"],
    ["Ryze", "Default", "30-day", "Frother, sub discount", "DTC + Amazon"]
  ]],
  ["sub", "7.4 Ashwagandha &amp; KSM-66, who actually uses it"],
  ["tbl", ["Brand", "KSM-66 / ashwagandha", "How it is used"], [
    ["<b>VAHDAM UK</b>", "Yes, KSM-66", "Hero adaptogen in the coffee blend"],
    ["Spacegoods", "Yes, ashwagandha", "One of a 6-part broad stack"],
    ["London Nootropics", "Yes, KSM-66", "In select blends, branded &amp; dosed"],
    ["DIRTEA", "Select SKUs", "Mushroom-led; ashwagandha secondary"],
    ["Four Sigmatic", "No (not core)", "Mushroom-led"],
    ["Ryze", "No", "Mushroom-only Super-6"]
  ], "The strategic crux: ashwagandha/KSM-66 is shared by VAHDAM, Spacegoods and London Nootropics, differentiation must come from taste, range, guarantee and provenance, not the extract."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Matcha:</b> over 50% of UK under-35s consumed it in late 2025, the wellness-caffeine cohort is large and primed.",
    "<b>Blue-ocean pull:</b> ~45% of UK consumers prefer flavoured/functional teas for wellness; premium bands (&pound;10 to &pound;35/pack) grow while commodity black flatlines.",
    "<b>Channel behaviour:</b> discovery skews TikTok Shop + Amazon UK; conversion rewards clean taste and clear function. No jitters, no crash, calm focus is table-stakes copy.",
    "<b>Trust proxies:</b> published third-party testing (Spacegoods), named branded extracts (London Nootropics) and doctor endorsements move conversion in a category wary of over-claiming.",
    "<b>Auto-renew friction:</b> as in the US, surprise subscription renewal is a recurring complaint, a CX/retention risk and a differentiation opening for transparent billing."
  ]],

  ["sec", 9, "The UK DTC playbook, what the winners do"],
  ["bul", [
    "<b>Lead with a low-friction sachet trial.</b> Single-serve trial packs are the proven UK on-ramp; reserve bundles/subscription for the second purchase.",
    "<b>Pick one credibility lane.</b> Either clinical (named extracts, doctors, testing, London Nootropics) or lifestyle/influencer (Spacegoods, DIRTEA). VAHDAM should run the clinical-plus-origin lane it can uniquely own.",
    "<b>Make the 90-day guarantee the headline risk-reversal.</b> It beats every rival and is currently buried.",
    "<b>Sell the real-coffee wedge.</b> Position against Spacegoods' cacao profile: actual Arabica you would drink black, plus adaptogens.",
    "<b>Cross-sell the tea house.</b> No adaptogen-coffee pure-play has a heritage tea catalogue, use it for AOV and trust.",
    "<b>Open the practitioner channel.</b> Where London Nootropics wins; VAHDAM's origin + testing story fits clinics and wellness studios."
  ]],

  ["sec", 10, "UK regulatory frame (the compliance battleground)"],
  ["card", ["{C} The UK is materially stricter than the US, and getting this wrong is the single most likely cause of a forced takedown or public ruling."]],
  ["bul", [
    "<b>MHRA:</b> a food supplement may not claim to diagnose, treat, cure or prevent disease. Balances cortisol, framed as a physiological outcome, drifts toward the medicine line.",
    "<b>ASA/CAP:</b> advertised health claims must be authorised on the GB nutrition and health claims register and substantiated; testimonials cannot be used to make claims the brand couldn't make directly, exactly what quantified cortisol/weight testimonials do.",
    "<b>Practical rule:</b> keep VAHDAM UK messaging to calm, focus, everyday wellbeing, no jitters; strip quantified physiological and weight-loss claims; audit imported US testimonials before they run in the UK."
  ]],
  ["card", ["{L} Turned around, compliance is a moat: the adaptogen coffee that won't get an ASA ruling is a genuine trust position in a category full of over-claiming startups."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["card", ["{L} Stop leaning on Crafted in India / KSM-66 as the differentiator, that is parity in the UK. Re-anchor on the copy-proof edges."]],
  ["bul", [
    "<b>Real coffee, not cocoa,</b> the purist wedge Spacegoods and DIRTEA leave open.",
    "<b>The 90-day guarantee</b> as headline risk-reversal (longest in category).",
    "<b>Heritage tea house that also makes adaptogen coffee,</b> an identity no pure-play can claim.",
    "<b>Compliance-led marketing</b> as a trust moat under ASA/CAP + MHRA.",
    "<b>The practitioner / clinic channel,</b> under-exploited by VAHDAM and rewarding the origin + testing story."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Trade and research (June to July 2026 pulls): The Grocer (Spacegoods funding &amp; category); Balance Journal / Balance Coffee, New Coffee Review (UK mushroom-coffee rankings, pricing, doses); London Nootropics &amp; Spacegoods brand sites; Mintel (matcha); DataM Intelligence, Global Market Insights, Data Bridge, Precedence, FMI/HTF (sizing); Market Data Forecast (Europe loose-leaf); IndexBox (UK tea volume); teas.co.uk, amazingfoodanddrink, Accio (UK tea shares &amp; structure); vahdam.co.uk. Market-size figures vary by firm scope; confidence tags reflect source strength. No competitor copy, testimonials or named advisors are reproduced."]]
];

REPORTS.Global = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Tea, coffee, or supplements\" is not one market, it is several multi-billion categories with different buyers, margins, shelf logic and regulators. This report anchors on the single arena where they collide: the functional-wellness beverage and supplement segment, premium/functional tea, adaptogen and functional coffee, and the adaptogen/wellness products adjacent to them.",
    "{C} Central framing: Global ex-US/UK/India is not one market but a dozen unlike ones. This study organises them by a single decision, where VAHDAM can realistically win vs where it is only present. VAHDAM already runs a dedicated Global storefront (vahdam.global) shipping to ~145 countries."
  ]],
  ["bul", [
    "Global market sizing for adaptogen coffee and adaptogenic beverages, with regional growth splits and source-to-source variance.",
    "A five-tier competitive landscape, a global brand-footprint matrix (every named brand x the regions it is a major player in) and deep-dive profiles of eight brands.",
    "Region-by-region analysis of EU-ex-UK, Canada, Australia/NZ, GCC, East Asia and the long tail, each with major players and a winnable/present verdict.",
    "Consumer signals, the global go-to-market playbook, the regulatory patchwork (EFSA / NHP / TGA-FSANZ / GCC) and a white-space read."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} The branded adaptogen/functional set is overwhelmingly US, UK and Indian brands that export globally, Four Sigmatic, Ryze, MUD\\WTR, AG1, Spacegoods, DIRTEA, plus VAHDAM and Organic India. Outside the big three markets, VAHDAM competes less with local challengers and more with these same exporters, alongside regional premium-tea incumbents."]],
  ["bul", [
    "<b>The competitive set travels with the brand.</b> The rivals VAHDAM meets in the US/UK reappear across EU, Canada and ANZ, so rest-of-world is familiar competition, not a new one.",
    "<b>Growth concentrates in a few markets.</b> Adaptogen-coffee CAGR leaders: Germany ~6.8%, US ~6.7%, France ~6.5%, China ~6.0%. Europe is the largest rest-of-world opportunity; Asia-Pacific is fastest-growing but structurally hardest for an Indian tea brand.",
    "<b>VAHDAM's edge is halo, not origin or incumbency.</b> It appears on global best-luxury-tea lists with a celebrity fanbase (Oprah, Mariah Carey). That credibility travels further than performance claims in markets it can't saturate with ad spend.",
    "<b>The winnable four.</b> EU-ex-UK, Canada, Australia/NZ and the GCC are premium-D2C-viable, high-income and wellness-receptive. Fund these.",
    "<b>The present-not-winning set.</b> China and Japan are tea-origin superpowers where an Indian tea brand has little structural edge; much of LatAm and Africa are poor fits. Fulfil demand; don't invest in acquisition.",
    "<b>Ashwagandha + Arabica is the global tailwind.</b> Ashwagandha is the #1 adaptogen (~18 to 26% share) and Arabica the dominant coffee base, VAHDAM's exact combination is the lead pairing of the fastest-growing beverage sub-category worldwide, while most exporters are mushroom-led."
  ]],

  ["sec", 3, "Market sizing (global, rest-of-world context)", "Spread across firms shown. 2024 to 26 base; USD."],
  ["tbl", ["Segment", "Size", "CAGR", "Source(s)"], [
    ["Global adaptogen coffee", "~$1.1 to 1.7B (2025) &rarr; $2.35 to 3.46B (2030 to 33)", "~6 to 17%", "FMI / HTF / Research and Markets"],
    ["Global adaptogenic beverages", "~$1.4 to 2.2B (2024 to 26) &rarr; $2.5 to 6.7B (2034)", "6.5 to 14.8%", "GMI / Stratistics"],
    ["Regional CAGR leaders", "Germany 6.8 &middot; US 6.7 &middot; France 6.5 &middot; China 6.0 &middot; UK 5.1 &middot; India 5.0", "", "Future Market Insights"],
    ["Regional share", "North America ~34.8% of adaptogen beverages (2025)", "APAC fastest", "Data Bridge"],
    ["Lead ingredient", "Ashwagandha #1 adaptogen (~18 to 26%); Arabica 45% of bases", "", "FMI"],
    ["Europe loose-leaf tea", "$0.98B (2025) &rarr; $1.47B (2034)", "4.59%", "Market Data Forecast"]
  ], "Scope variance is very wide (coffee-only vs all adaptogenic beverages). Use the direction: double-digit growth, ashwagandha-led, Europe the biggest rest-of-world pool."],
  ["sub", "3.1 Europe, the biggest rest-of-world pool"],
  ["card", ["{C} Germany and France are the largest and fastest-growing European adaptogen-coffee markets, and Europe's premium/loose-leaf tea is a mature, design-led category ($0.98B to $1.47B by 2034). This is where rest-of-world value concentrates."]],
  ["sub", "3.2 Asia-Pacific, fastest-growing, structurally split"],
  ["card", ["{L} APAC grows fastest but splits sharply: Australia/NZ are wellness-receptive and winnable; China and Japan are tea-origin markets hostile to imported Indian tea. Growth here is not uniformly addressable for VAHDAM."]],
  ["sub", "3.3 Middle East, small base, high margin, gifting-led"],
  ["card", ["{L} The GCC is not sized large in adaptogen terms, but premium tea/coffee gifting is a high-margin cultural occasion where luxury positioning and loved-in-145-countries prestige travel well."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["The exporters dominate the branded set", "{C} Across the market reports the named players are almost entirely US (Four Sigmatic, Ryze, MUD\\WTR, AG1, Laird, Om, Rasa) and UK (Spacegoods, DIRTEA), plus Indian (VAHDAM, Organic India, Tata). Rest-of-world is less about local challengers and more about which exporters have localised best."],
    ["Germany &amp; France lead European growth", "{C} Germany has the highest adaptogen-coffee CAGR (~6.8%) on a strong wellness/organic culture; France follows (~6.5%). Both have entrenched luxury-tea incumbents (Kusmi, Palais des Thes, Mariage Freres; Teekanne, Ronnefeldt, Yogi in DE)."],
    ["Gifting is the global premium lane", "{L} Premium gift sets are high-margin and low-CAC, and play to VAHDAM's design equity, especially the GCC and European festive seasons. It is the most capital-efficient rest-of-world entry."],
    ["Halo beats claims abroad", "{L} In markets VAHDAM can't out-spend, the press/celebrity/luxury-list credibility converts better than physiological claims, and it sidesteps the strict EU/TGA/EFSA claim regimes."],
    ["Tea-origin Asia is structurally closed", "{L} Selling Indian tea into China (Ten Fu, vast domestic players) and Japan (Ito En, the matcha economy) means competing in the birthplace of tea with no home advantage. The only plausible wedge is adaptogen coffee to urban wellness buyers."],
    ["The regulatory patchwork raises the bar", "{C} Rest-of-world is the strictest claims terrain: EFSA authorises very few adaptogen health claims; Canada requires NHP licensing; Australia has TGA + FSANZ; the GCC requires halal + SFDA-type labelling. One product, many claim regimes."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The rest-of-world arena sorts into five tiers; VAHDAM competes mainly against Tier 1 exporters and Tier 2/3 premium-tea incumbents."],
  ["cards", 2, [
    ["Tier 1, Global adaptogen/functional-coffee exporters", "<b>VAHDAM's direct fight.</b> Four Sigmatic, Ryze, MUD\\WTR, AG1, Spacegoods, DIRTEA. The US/UK brands that follow VAHDAM into every affluent market. Mostly mushroom-led, leaving the ashwagandha lane open."],
    ["Tier 2, European premium / luxury tea", "<b>Heritage incumbents.</b> Yogi Tea (DE), Teekanne, Ronnefeldt, TeaGschwendner (DE); Kusmi, Palais des Thes, Mariage Freres (FR). Design-led, heritage, entrenched on European shelves and in luxury retail."],
    ["Tier 3, Global luxury tea", "<b>Prestige &amp; gifting.</b> TWG (Singapore), Fortnum &amp; Mason, Dilmah (Sri Lanka). Own luxury-mall prestige and premium gifting across SE Asia, GCC and duty-free, VAHDAM's gifting competitors."],
    ["Tier 4, Regional wellness / hormone brands", "<b>Shared audience.</b> Happy Mammoth (Australia-founded), regional adaptogen startups. Own the cortisol/hormone narrative in ANZ/EU; capsule format, shared women-35-55 audience."],
    ["Tier 5, Tea-origin domestic giants", "<b>Do not fight.</b> Ten Fu (China), Ito En (Japan) and vast domestic players. Dominant at home in tea-origin markets; an Indian tea brand has no structural edge against them."]
  ]],
  ["card", ["{L} Where VAHDAM sits: a Tier 1 exporter by product, but with Tier 2/3 premium-tea heritage and a luxury/gifting halo, a combination most Tier 1 pure-plays lack. Its edge is strongest where premiumisation + gifting matter (EU, GCC) and weakest in tea-origin Asia."]],

  ["sec", 6, "Global brand-footprint matrix", "Where each named competitor is actually a major player, the competitive overlap VAHDAM meets outside its three core markets."],
  ["tbl", ["Brand", "Home", "Also a major player in", "Category"], [
    ["Four Sigmatic", "US (Finnish roots)", "US, EU, UK, Canada, ANZ", "Mushroom coffee pioneer"],
    ["Ryze", "US", "US, UK, Canada, global DTC", "Mushroom-coffee DTC leader"],
    ["MUD\\WTR", "US", "US; ships international", "Coffee-alternative ritual"],
    ["AG1 (Athletic Greens)", "US", "US, UK, ANZ, Canada, EU", "Greens / daily ritual"],
    ["Happy Mammoth", "Australia", "AU, US, UK, EU", "Women's hormone / cortisol"],
    ["Spacegoods", "UK", "UK, EU; expanding US", "Adaptogen coffee"],
    ["DIRTEA", "UK", "UK, EU", "Mushroom coffee &amp; powders"],
    ["Yogi Tea", "Germany / US", "EU, US, global", "Wellness herbal tea"],
    ["Pukka", "UK", "UK, EU, global", "Organic / Ayurvedic herbal tea"],
    ["Kusmi, Palais des Thes, Mariage Freres", "France", "EU, global luxury retail", "Luxury French tea"],
    ["TWG Tea", "Singapore", "SE Asia, GCC, global luxury malls", "Luxury tea"],
    ["Dilmah", "Sri Lanka", "Global; strong ANZ, EU, MEA", "Ceylon tea"],
    ["Ito En", "Japan", "Japan, US", "Green tea / matcha"],
    ["<b>VAHDAM</b>", "India", "~145 countries (Global storefront)", "Premium tea + adaptogen coffee"]
  ], "Home markets certain; also-major-in breadth is inference. The exporters VAHDAM meets in the US/UK reappear across EU/Canada/ANZ, the competitive set travels with the brand."],

  ["sec", 7, "Region-by-region deep dive"],
  ["cards", 2, [
    ["Europe (ex-UK), the biggest prize", "{C} Germany and France are the largest, fastest-growing European adaptogen-coffee markets; premium tea is mature and design-led. <b>Players:</b> Yogi Tea, Teekanne, Ronnefeldt, TeaGschwendner (DE), Kusmi, Palais des Thes, Mariage Freres (FR luxury); Four Sigmatic and Spacegoods lead the adaptogen push; Pukka strong in organic/Ayurvedic. <b>VAHDAM read:</b> Winnable. Origin + design + press halo fit premiumisation; EFSA rules are strict, lead with taste/ritual, not physiology."],
    ["Canada, a US mirror", "{L} DTC-receptive, functional-coffee-aware, bilingual. US brands (Four Sigmatic, Ryze, AG1) already ship; DavidsTea is the home premium-tea name; Tim Hortons owns mass. <b>VAHDAM read:</b> Winnable, low-friction, replicate the US playbook with minimal localisation. Watch Health Canada NHP licensing for any functional claim."],
    ["Australia &amp; New Zealand, wellness-native", "{L} Disproportionately wellness-forward with a sophisticated coffee palate (~87% of coffee still plain, functional the fast-growing premium edge). Happy Mammoth is Australia-founded; T2 (Unilever) and Tielka lead premium tea; AG1 and Four Sigmatic strong. <b>VAHDAM read:</b> Winnable. Gifting culture + a coffee-literate palate reward the real-Arabica angle. TGA + FSANZ govern messaging."],
    ["GCC / Middle East, gifting &amp; premium ritual", "{L} Tea and coffee are deep cultural rituals (gahwa, chai); gifting is a major high-margin occasion. Ahmad Tea and Lipton are ubiquitous; TWG owns luxury-mall prestige. <b>VAHDAM read:</b> Winnable, gifting-led. Premium packaging, single-origin story and loved-in-145-countries prestige fit gifting and affluent expat demand. Requires halal + SFDA-type labelling; keep claims conservative."],
    ["East Asia (China &amp; Japan), present, not winning", "{L} Tea-origin superpowers with entrenched domestic leaders, Ten Fu and vast local players in China; Ito En and the matcha economy in Japan. An Indian tea brand has little structural edge selling tea here. <b>VAHDAM read:</b> Present, not a priority. The only plausible wedge is adaptogen coffee to urban wellness buyers; don't fund a tea push."]
  ]],

  ["sec", 8, "Selected competitor profiles"],
  ["cards", 2, [
    ["VAHDAM Global (anchor)", "The Indian premium tea + adaptogen coffee brand, shipping to ~145 countries via a dedicated Global storefront (vahdam.global); single-origin, farmer-direct, carbon-neutral; premium gifting. On global best-luxury-tea lists; celebrity fanbase (Oprah, Mariah Carey, Ellen). Formula: Ashwagandha Coffee (KSM-66 + Lion's Mane + Turmeric 95% + Chaga), ashwagandha + Arabica, the global lead pairing. <b>Strengths:</b> premium design + gifting equity + luxury/press halo that pure-play exporters lack; the on-trend pairing already in the range. <b>Openings:</b> spread thin across 145 countries dilutes focus; must concentrate on the winnable four."],
    ["Four Sigmatic", "The global mushroom-coffee pioneer, present in nearly every affluent market. US, EU, UK, Canada, ANZ; instant + ground; lab-tested; in grocery. <b>Strengths:</b> category legitimacy, sourcing transparency, the broadest rest-of-world retail footprint. <b>Openings:</b> mushroom-led, no ashwagandha lead, no tea heritage or gifting, the ashwagandha calm-energy + gifting lanes are open."],
    ["Spacegoods (Europe push)", "The UK front-runner explicitly targeting European leadership. UK + EU expansion; cacao-forward Rainbow Dust; &pound;2.5M funded. <b>Strengths:</b> fast-growing, funded, defined the EU adaptogen-coffee taste expectation. <b>Openings:</b> cacao-forward, not real coffee; no tea range or luxury-gifting equity, VAHDAM's Arabica + heritage is a wedge."],
    ["Yogi Tea", "The German-born global wellness-herbal incumbent. EU + US + global; organic herbal blends; Ayurveda-influenced. <b>Strengths:</b> deep wellness-tea trust and shelf presence across Europe. <b>Openings:</b> tea-only, no adaptogen-coffee play; mass-premium, less luxury/gifting cachet than VAHDAM."],
    ["Kusmi / Palais des Thes / Mariage Freres", "The French luxury-tea establishment. France + EU + global luxury retail; heritage, design-led, boutique + department-store. <b>Strengths:</b> own European luxury-tea prestige, boutiques and gifting; exceptional design equity. <b>Openings:</b> no functional/adaptogen angle; premium-priced legacy, VAHDAM competes on origin freshness, value and the adaptogen twist."],
    ["TWG Tea", "The Singapore luxury-tea house of the GCC and Asian malls. SE Asia, GCC, global luxury malls; 1,000+ varieties; ultra-premium gifting. <b>Strengths:</b> owns ultra-luxury tea prestige and mall/gifting in the GCC and Asia. <b>Openings:</b> ultra-premium price, no functional angle; VAHDAM plays a more accessible premium + wellness position."],
    ["Happy Mammoth", "The Australia-founded cortisol/hormone-funnel brand, now global. AU, US, UK, EU; KSM-66 + 12 extracts; quiz funnel; 3.3M customers. <b>Strengths:</b> proves ashwagandha-for-cortisol converts globally; strong women-35-55 ownership. <b>Openings:</b> capsules, aggressive claims (regulatory risk under EFSA/TGA), VAHDAM can out-format with a drinkable ritual, more cleanly."],
    ["Dilmah", "The Sri Lankan Ceylon incumbent across ANZ, EU and MEA. Global; strong Australia, EU, Middle East/Africa; single-origin Ceylon; founder-family story. <b>Strengths:</b> origin authenticity + global distribution + a founder-origin narrative similar to VAHDAM's. <b>Openings:</b> Ceylon black-tea focused, no adaptogen-coffee or Ayurveda angle; VAHDAM's functional + Indian-origin position is differentiated."]
  ]],

  ["sec", 9, "Consumer demand signals"],
  ["bul", [
    "<b>Wellness receptivity is uneven,</b> highest in ANZ, Germany and affluent GCC/expat segments; lowest where tea-origin tradition dominates (China, Japan).",
    "<b>Gifting is a universal high-margin occasion,</b> strongest in the GCC and European festive seasons; suits VAHDAM's packaging equity.",
    "<b>Matcha is a global under-35 phenomenon,</b> the wellness-caffeine cohort exists across all winnable markets.",
    "<b>Halo converts where ads can't,</b> press/celebrity/luxury-list credibility is a rare, portable asset that lowers CAC abroad.",
    "<b>Ashwagandha + Arabica is the demand-side sweet spot,</b> the #1 adaptogen on the dominant coffee base, exactly VAHDAM's SKU."
  ]],

  ["sec", 10, "The global go-to-market playbook"],
  ["bul", [
    "<b>Fund the winnable four.</b> Concentrate localisation and spend on EU-ex-UK, Canada, ANZ and the GCC. Treat everywhere else as fulfilment, not acquisition.",
    "<b>Lead with halo, not physiology.</b> Where you can't out-spend, press/celebrity/luxury-list credibility travels further and dodges strict EU/TGA/EFSA claim regimes.",
    "<b>Make gifting the global wedge.</b> Premium gift sets are high-margin, low-CAC and play to VAHDAM's design equity, especially GCC and EU festive.",
    "<b>Localise the compliance, not the product.</b> One SKU, region-specific claims: halal (GCC), NHP (Canada), EFSA (EU), TGA/FSANZ (ANZ).",
    "<b>Don't chase tea-origin Asia.</b> Fulfil opportunistic demand in China/Japan; do not fund a tea push into the birthplace of tea."
  ]],

  ["sec", 11, "Regulatory patchwork", "One product, many claim regimes; never port US testimonials abroad without a compliance pass."],
  ["tbl", ["Region", "Regime", "Claim posture"], [
    ["EU", "EFSA authorised health claims", "Strict, most adaptogen physiological claims not authorised; lead with taste/ritual"],
    ["Canada", "Health Canada NHP licensing", "Functional claims require an NHP licence"],
    ["Australia / NZ", "TGA (therapeutic) + FSANZ (food)", "Therapeutic claims tightly controlled"],
    ["GCC", "Halal + SFDA-type labelling", "Halal certification required; conservative claims"]
  ]],

  ["sec", 12, "Strategic implications &amp; white space"],
  ["bul", [
    "Ashwagandha + Arabica is the lead global ingredient pairing, VAHDAM already makes it; most exporters are mushroom-led.",
    "Premium gifting is an underworked, high-margin global lane suited to VAHDAM's equity.",
    "The Indian-brand-loved-in-145-countries / by-A-listers halo is a rare rest-of-world asset, lead with it, don't footnote it.",
    "Concentration beats coverage: winning four markets outperforms shipping to 145."
  ]],
  ["card", ["{L} Net: the rest-of-world story is focus, four markets to win, a gifting-and-halo playbook to win them with, region-specific compliance, and the discipline not to chase tea-origin Asia."]],

  ["sec", 13, "Sources &amp; notes"],
  ["card", ["Research and press (2026 pulls): Future Market Insights, HTF, Research and Markets, GMI, Stratistics, Data Bridge (global adaptogen coffee/beverage sizing &amp; regional CAGRs); Market Data Forecast (Europe loose-leaf); Mordor (Australia coffee); Luxe Digital / Modern Luxury / TasteAtlas (global luxury-tea rankings &amp; brand footprints); Wikipedia / TeaBrands / RateTea (regional brand lists); TWG, Yogi, Kusmi, Palais des Thes brand references; vahdam.global. Market-size figures vary by firm scope; confidence tags reflect source strength. No competitor copy or named advisors are reproduced."]]
];

REPORTS.India = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Tea, coffee, or supplements\" is not one market, it is several multi-billion categories with different buyers, margins, shelf logic and regulators. This report anchors on the single arena where they collide: the functional-wellness beverage and supplement segment, premium/functional tea, adaptogen and functional coffee, and the adaptogen/wellness products adjacent to them.",
    "{C} Central framing: India is not a smaller US/UK adaptogen-coffee market, it is a different structure. Tea is a mass rupee-priced staple owned by a duopoly; functional/adaptogen is native Ayurveda, not imported wellness; and ashwagandha is a household commodity, which weakens VAHDAM's global origin moat at home."
  ]],
  ["bul", [
    "Market sizing for India tea, India coffee (traditional + D2C) and the India Ayurveda / wellness-supplement pool, with source-to-source variance shown.",
    "A five-tier competitive landscape plus deep-dive profiles of eight players across the mass-tea duopoly, premium/D2C tea, coffee-D2C, legacy Ayurveda and modern wellness-D2C.",
    "Four comparison tables: India tea players, India coffee players, India Ayurveda/wellness players and where VAHDAM competes for which wallet.",
    "Consumer demand signals, the India D2C playbook, the FSSAI + AYUSH regulatory frame and a white-space read."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} India is the world's largest tea producer and consumer; ~80% of production is consumed domestically and tea is a daily staple. The mass market is a Tata Consumer / Hindustan Unilever duopoly, a Red Ocean VAHDAM cannot and should not fight on price."]],
  ["bul", [
    "<b>VAHDAM plays in a premium sliver of a huge, low-margin category.</b> It secured &#8377;25cr from SIDBI Venture Capital (Mar 2025) and competes on single-origin, farmer-direct, carbon-neutral, export-grade quality.",
    "<b>The origin moat inverts at home.</b> VAHDAM's worldwide edge, authentic Indian origin, is table stakes in India. Everyone here is origin; ashwagandha, turmeric and chai are native and cheap.",
    "<b>So the differentiators flip to four.</b> (1) premiumisation &amp; single-origin; (2) format innovation (Ashwagandha Coffee is genuinely novel vs mass tea and vs capsule-Ayurveda); (3) design/brand cachet incl. loved-in-145-countries reverse-prestige; (4) D2C + quick-commerce execution.",
    "<b>VAHDAM competes for two wallets.</b> The premium-beverage-ritual wallet (vs Blue Tokai, premium tea, Chaayos) and the functional-wellness wallet (vs Kapiva, OZiva, Dabur/Himalaya). Ashwagandha Coffee is the rare SKU bridging both, the wedge.",
    "<b>Ayurveda is the native adaptogen category, and profit-hostile.</b> Global Ayurveda is compounding ~19.7%/yr, but ad-led D2C economics are brutal: Kapiva posted &#8377;69cr losses on &#8377;342cr revenue in FY25. CAC, not demand, is the category-killer.",
    "<b>Coffee-D2C is the analog to watch.</b> Blue Tokai (single-origin, ~$180M valuation, $25M raised Sep 2025) owns the premium ritual; Rage Coffee (vitamin-enriched) is the closest functional coffee, neither pairs real coffee with a native adaptogen story, which VAHDAM does."
  ]],

  ["sec", 3, "Market sizing (India, with global context)", "Spread across firms shown. 2024/25 base; USD or rupee as noted."],
  ["tbl", ["Segment", "Size", "CAGR", "Source(s)"], [
    ["India tea market", "~$11.7 to 11.9B (2024/25)", "~3 to 4%", "IMARC $11.86B; CMI $11.70B; EMR"],
    ["India tea volume", "~1.40M tons (2025) &rarr; 2.17M (2035)", "", "Expert Market Research"],
    ["India tea structure", "Black 68% &middot; loose 44% &middot; residential 80%", "", "IMARC / Ken Research"],
    ["India premium tea", "~1.20M tons (2025) &rarr; 1.81M (2035)", "4.2%", "Expert Market Research"],
    ["India coffee market", "~$1.46B &rarr; ~$2.03B (2025 est.)", "~9.9%", "Mordor Intelligence"],
    ["India coffee (packaged base)", "~$552.9M (2023)", "9.87%", "Custom Market Insights"],
    ["Global Ayurveda market", "$20.42B (2025) &rarr; $85.83B (2033)", "19.72%", "via Open Magazine"],
    ["India wellness D2C reach", "~44% of wellness/skincare orders from Tier-III+", "", "ClickPost FY26"]
  ], "The asymmetry: tea is a ~$12B commodity growing low-single-digits; Ayurveda/wellness is smaller but compounding ~20%/yr. VAHDAM's growth lives in the premium/wellness layer, not tea tonnage."],
  ["sub", "3.1 Tea, vast, mass, and a duopoly"],
  ["card", ["{C} India is the largest tea producer and consumer on earth; ~80% consumed at home, residential use ~80% of the market, black tea 68%, loose tea 44%. Tata Consumer and HUL own the mass market on distribution depth and rural penetration. The mass tea market is irrelevant to VAHDAM's economics; the premium/specialty and export-grade sliver is the entire home-market opportunity."]],
  ["sub", "3.2 Coffee, small, southern, and D2C-disrupted"],
  ["card", ["{C} India coffee (~$1.46 to 2.03B) is far smaller than tea and historically Nescafe/Bru/Tata Coffee. The growth story is at-home premium ritual led by D2C: Blue Tokai, Sleepy Owl, Rage, Third Wave. This is the arena VAHDAM's Ashwagandha Coffee enters, premium ritual + a functional twist none of them own."]],
  ["sub", "3.3 Ayurveda &amp; wellness, the native functional pool"],
  ["card", ["{L} What the West calls adaptogens, India calls Ayurveda, a trusted, mass, centuries-old category owned by Dabur, Himalaya (1930) and Patanjali, now modernised by D2C brands Kapiva and OZiva. Global Ayurveda compounds ~19.7%/yr. Ashwagandha is a household word here, which lowers education cost but removes the novelty premium VAHDAM enjoys abroad."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["The duopoly and the premium sliver", "{C} Tata Consumer (Tata Tea, Tetley, Gold, Premium) and HUL (Brooke Bond Red Label, Taj Mahal, 3 Roses, Lipton) dominate. Tata's Jan-2024 acquisition of Organic India folded a wellness-tea brand into the incumbent, the giants are now moving into VAHDAM's premium/wellness lane."],
    ["Coffee's at-home ritual surge", "{C} The shift from out-of-home to sophisticated at-home coffee is now permanent, funded by PE/VC: Blue Tokai raised $25M (Sep 2025), Subko $10M. Challenger brands simplified premium coffee into convenient formats, the exact behavioural shift VAHDAM's instant Ashwagandha Coffee rides."],
    ["Ayurveda as native functional, trust without novelty", "{L} Ashwagandha needs no explanation in India, which cuts education spend but means VAHDAM can't charge a novelty premium for it. The winning move is to premiumise the format and experience, not the ingredient."],
    ["D2C jumps to Bharat (Tier-III+)", "{C} ~44% of wellness/skincare D2C orders now come from Tier-III cities and beyond, smartphone- and quick-commerce-led. Demand for premium/wellness is no longer metro-only."],
    ["Quick-commerce is the new shelf", "{C} Blinkit, Swiggy Instamart and Zepto are where premium daily-ritual demand now converts (Sleepy Owl is in 15K+ retail + all major quick-commerce). Distribution execution, not just DTC, decides winners."],
    ["The Ayurvedic-D2C profitability trap", "{C} Ad-led D2C growth is giving way to hard unit-economics questions. Kapiva grew revenue 50% to &#8377;342cr in FY25 but losses widened to &#8377;69cr. Sustained marketing spend for visibility eats the P&amp;L, the central risk for any VAHDAM India scale-up."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The India arena sorts into five tiers; VAHDAM straddles premium/D2C tea and, via Ashwagandha Coffee, both coffee-D2C and the functional-wellness wallet."],
  ["cards", 2, [
    ["Tier 1, Mass tea duopoly", "<b>Do not fight.</b> Tata Consumer, Hindustan Unilever (Brooke Bond). Own the rupee-priced daily-staple market on distribution and trust. A price/volume war VAHDAM cannot win."],
    ["Tier 2, Premium / D2C tea", "<b>VAHDAM's home turf.</b> VAHDAM, TeaBox, Chaayos (cafe + retail), Blue Tea, Tea Trunk. Single-origin, fresh, design-led, gifting. VAHDAM and TeaBox are the analyst-cited premium-D2C benchmarks."],
    ["Tier 3, Coffee D2C", "<b>Premium ritual + functional edge.</b> Blue Tokai, Sleepy Owl, Rage Coffee, Third Wave, Country Bean, SLAY, Subko. Where Ashwagandha Coffee competes on the premium-ritual axis (Blue Tokai) and the functional axis (Rage)."],
    ["Tier 4, Legacy Ayurveda", "<b>Trust incumbents.</b> Dabur, Himalaya, Patanjali, Baidyanath, Organic India (Tata). Own Ayurvedic authority and mass distribution; the native adaptogen shelf VAHDAM can't out-trust or out-price."],
    ["Tier 5, Modern Ayurveda / wellness D2C", "<b>Functional wallet.</b> Kapiva, OZiva, Plix, HealthKart, TrueBasics, The Whole Truth. Condition-led modern-Ayurveda and plant-wellness in supplement formats, the functional wallet VAHDAM's coffee also chases."]
  ]],
  ["card", ["{L} Where VAHDAM sits: Tier 2 by heritage, but its unique position is the Ashwagandha Coffee bridge across Tier 3 (premium ritual) and Tier 5 (functional wellness). No Indian player occupies that intersection."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["VAHDAM India (anchor)", "Premium, export-grade Indian tea + adaptogen coffee, the global brand at home. <b>Hero:</b> single-origin teas (Darjeeling, Assam, chai, green, herbal) + Ashwagandha Coffee (KSM-66, Lion's Mane, Turmeric, Chaga). <b>Positioning:</b> single-origin, farmer-direct, carbon-neutral, export-grade; loved-across-145-countries reverse-prestige. <b>Capital:</b> &#8377;25cr from SIDBI (Mar 2025). <b>Strengths:</b> a real global brand with premium design, quality systems and gifting equity most Indian D2C tea brands lack; Ashwagandha Coffee is a novel format bridging tea, coffee and Ayurveda. <b>Openings:</b> Indian origin is not a home-market moat; Ayurvedic-D2C economics are brutal; competes against Dabur/Himalaya trust and Blue Tokai ritual at once."],
    ["Tata Consumer Products", "Co-leader of the tea duopoly, now buying into wellness. Tata Tea, Tetley, Gold, Premium; premiumising via Gold Care; acquired Organic India (2024). Edge: vertical integration, digital demand forecasting, SKU segmentation. <b>Strengths:</b> distribution, trust and capital no D2C brand can match; now credible in premium/wellness via Organic India. <b>Openings:</b> slow and brand-diluted at the top end; cannot deliver a curated single-origin, design-led experience. VAHDAM wins on depth, not breadth."],
    ["Hindustan Unilever (Brooke Bond)", "Co-leader on distribution depth and rural penetration. Brooke Bond Red Label, Taj Mahal, 3 Roses, Lipton; Taj Mahal = premium gold standard. Edge: scale-driven procurement, unmatched rural + modern-trade distribution. <b>Strengths:</b> ubiquity and the strongest distribution engine in Indian FMCG. <b>Openings:</b> mass-first; no premium single-origin or wellness-coffee credibility; not built for a curated D2C experience."],
    ["Wagh Bakri", "The #3 heritage regional champion, moving experiential. 130-year Ahmedabad house, strong West India; introduced Royale premium CTC; investing in tea lounges. <b>Strengths:</b> regional loyalty, heritage, experiential retail. <b>Openings:</b> regional not national premium; not a D2C/wellness or coffee player, tangential to VAHDAM."],
    ["Blue Tokai", "India's specialty-coffee darling, the premium at-home ritual benchmark. Single-origin Indian coffee, farm-direct; educated the urban market on roast/brew; 100+ cafes + strong online; ~$180M valuation, $25M bridge (Sep 2025). <b>Openings:</b> no functional/adaptogen angle and no tea heritage, the calm-energy adaptogen-coffee position is open for VAHDAM."],
    ["Rage Coffee", "The closest functional-coffee analog in India. Plant-based, vitamin-enriched instant coffee (founded 2018); expanding offline. <b>Strengths:</b> proved Indian consumers will buy a functionally-enhanced coffee; strong D2C brand energy. <b>Openings:</b> vitamin-enriched, not Ayurveda/adaptogen; no origin or tea heritage, VAHDAM's KSM-66 + provenance is a stronger functional story."],
    ["Kapiva", "The modern-Ayurveda D2C benchmark, and a cautionary tale. Condition-led modern Ayurveda (gut/hair/metabolic), juices &amp; shots; strong content/subscription funnels; &#8377;342cr FY25 revenue (+50%) but &#8377;69cr loss. <b>Strengths:</b> took Ayurveda out of the pharmacy jar for urban millennials. <b>Openings:</b> structurally unprofitable at scale (heavy CAC); ingestible-supplement formats, not a daily-ritual beverage, VAHDAM's coffee is a friendlier habit."],
    ["OZiva", "The plant-based wellness / women's-nutrition D2C leader. Plant-based women's/PCOS, hair &amp; skin nutrition; category-defining Instagram community; 30 to 60-day repurchase. <b>Strengths:</b> built the plant-based wellness shelf; strong community-led acquisition. <b>Openings:</b> supplement formats and a specific women's-nutrition lane; not a beverage-ritual brand, VAHDAM differentiates on format and daily-use pleasure."]
  ]],

  ["sec", 7, "Side-by-side comparison tables"],
  ["sub", "7.1 India tea, players &amp; tiers"],
  ["tbl", ["Brand", "Owner / type", "Scale", "Positioning", "Tier"], [
    ["Tata Consumer", "Tata group", "Co-leader", "Full-spectrum; premiumising; owns Organic India", "Mass to premium"],
    ["HUL / Brooke Bond", "Hindustan Unilever", "Co-leader", "Distribution depth; Taj Mahal premium", "Mass to premium"],
    ["Wagh Bakri", "Gujarat Tea Processors", "#3 (West India)", "Heritage; tea lounges", "Mass to mid"],
    ["Society Tea", "Amar Tea", "Regional", "Value / regional loyalty", "Mass"],
    ["<b>VAHDAM</b>", "VAHDAM (D2C)", "Premium sliver", "Single-origin, export-grade, gifting", "Premium / luxury"],
    ["TeaBox", "TeaBox (D2C)", "Premium D2C", "Fresh single-estate; tech-enabled", "Premium"],
    ["Chaayos", "Sunshine Teahouse", "Cafe + retail", "Experiential chai; customisation", "Cafe / premium"]
  ]],
  ["sub", "7.2 India coffee, players"],
  ["tbl", ["Brand", "Type", "Founded", "Positioning", "Scale / funding"], [
    ["Nescafe / Bru", "Traditional (Nestle / HUL)", "n/a", "Mass instant leaders", "Dominant"],
    ["Tata Coffee", "Plantation + brands", "n/a", "Vertically integrated", "Large"],
    ["Blue Tokai", "Specialty D2C + cafe", "2012/13", "Single-origin; market educator", "~$180M valn; $25M (Sep 2025); 100+ cafes"],
    ["Sleepy Owl", "D2C", "2016", "Cold brew / convenience", "&#8377;100cr; 15K+ retail; quick-commerce"],
    ["Rage Coffee", "D2C", "2018", "Plant-based, vitamin-enriched", "Closest functional analog"],
    ["Third Wave", "Cafe chain", "2016", "Specialty cafe; franchise", "100+ outlets"]
  ]],
  ["sub", "7.3 India Ayurveda &amp; wellness, players"],
  ["tbl", ["Brand", "Type", "Positioning", "Scale", "Read for VAHDAM"], [
    ["Dabur", "Legacy FMCG-Ayurveda", "Chyawanprash, honey, Vedic; mass authority", "Large, listed", "Ayurveda authority + mass reach"],
    ["Himalaya", "Legacy (1930)", "Herbal healthcare &amp; personal care", "Large, intl", "Deep herbal trust; broad"],
    ["Patanjali", "Legacy (mass)", "Swadeshi mass Ayurveda; price-led", "Large", "Mass on price, not VAHDAM's lane"],
    ["Organic India", "Tata (acq. 2024)", "Organic tulsi/wellness teas + supplements", "Mid; Tata-backed", "Direct wellness-tea rival, now inside duopoly"],
    ["Kapiva", "Modern-Ayurveda D2C", "Condition-led juices &amp; shots", "&#8377;342cr FY25; &#8377;69cr loss", "Ayurveda-2.0 benchmark, unprofitable"],
    ["OZiva", "Plant-wellness D2C", "Women's / PCOS; Instagram community", "Strong D2C", "Community-led wellness rival"]
  ]],
  ["sub", "7.4 Where VAHDAM competes, the two-wallet map"],
  ["tbl", ["Wallet", "Who owns it now", "VAHDAM's weapon", "Verdict"], [
    ["Premium beverage ritual", "Blue Tokai; premium/D2C tea; Chaayos", "Single-origin quality + design + Arabica Ashwagandha Coffee", "<b>Winnable</b>"],
    ["Functional / wellness", "Dabur, Himalaya, Kapiva, OZiva", "Native KSM-66 in a daily-drink format (not capsules)", "Contestable"],
    ["Mass daily tea", "Tata, HUL", "n/a (do not enter)", "Avoid"]
  ], "The bridge SKU (Ashwagandha Coffee) is the only product reaching both winnable wallets, make it the flagship of the India story, not a side-line."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Chai is identity, not just a drink,</b> mass tea loyalty is cultural and near-unshakeable; premium must be an additive occasion, never a replacement message.",
    "<b>Premiumisation is real but narrow,</b> rising incomes and health-consciousness pull value up in specialty/organic, while volume stays commodity.",
    "<b>Wellness has reached Bharat,</b> ~44% of wellness/skincare D2C orders now originate in Tier-III cities and beyond.",
    "<b>Quick-commerce is the conversion layer,</b> Blinkit/Instamart/Zepto now carry premium daily-ritual demand; shelf presence there rivals a DTC site.",
    "<b>Gifting is a large, high-margin occasion,</b> festive and corporate gifting suit VAHDAM's design equity and export-grade packaging.",
    "<b>Ashwagandha is understood, not novel,</b> low education cost, but no novelty premium; the experience must justify the price."
  ]],

  ["sec", 9, "The India D2C playbook, what wins (and what bankrupts)"],
  ["bul", [
    "<b>Guard CAC like the category-killer it is.</b> Kapiva's losses are the warning. Lean on retention, gifting and quick-commerce over pure ad-led acquisition.",
    "<b>Make quick-commerce a first-class channel.</b> Match Sleepy Owl's Blinkit/Instamart/Zepto distribution for premium daily-ritual conversion.",
    "<b>Lead with the bridge SKU.</b> Position Ashwagandha Coffee as the flagship, premium ritual (vs Blue Tokai) and native functional (vs Kapiva/OZiva) at once.",
    "<b>Reverse-prestige the global brand.</b> The Indian tea brand loved in 145 countries / by A-listers is a rare aspirational angle at home, lead with it.",
    "<b>Own gifting.</b> Festive + corporate gift sets are high-margin, low-CAC and play to VAHDAM's packaging equity.",
    "<b>Premium, never mass.</b> Sell provenance, freshness and design; never compete on rupee-per-cup with Tata/HUL/Patanjali."
  ]],

  ["sec", 10, "India regulatory frame"],
  ["bul", [
    "<b>FSSAI:</b> governs food &amp; nutraceutical labelling and permissible claims; health-supplement vs food classification changes what may be stated.",
    "<b>AYUSH ministry:</b> oversees Ayurvedic products/claims; positioning as Ayurvedic vs a food-with-adaptogens changes the compliance path and the claims allowed.",
    "<b>Practical rule:</b> ashwagandha as a traditional wellness ingredient is well accepted; avoid disease-cure and quantified physiological claims regardless of regime."
  ]],
  ["card", ["{L} India's claim regime is more permissive than the UK for traditional-use language, but consumer trust (vs Dabur/Himalaya) is earned on quality and credibility, not aggressive claims."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["card", ["{L} At home, drop authentic Indian origin as the lead differentiator, it is parity. Win on the copy-proof edges."]],
  ["bul", [
    "Premium adaptogen coffee is essentially uncontested, Blue Tokai has no functional angle; Rage is vitamin-enriched, not Ayurveda; Ayurveda brands aren't in daily coffee.",
    "The bridge SKU (Ashwagandha Coffee) uniquely reaches both winnable wallets, make it the flagship.",
    "Gifting + festive is a high-margin, low-CAC lane suited to VAHDAM's design equity.",
    "A curated global-quality, made-in-India premium tea + coffee bundle has no equivalent across the duopoly, coffee-D2C or Ayurveda-D2C sets."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Research and press (June to July 2026 pulls): IMARC, Custom Market Insights, Expert Market Research, Ken Research, Facts &amp; Factors, Market Research Future (India tea sizing &amp; structure); Mordor / CMI (India coffee); Inc42, Indian Retailer, ClickPost, Nivara (India coffee-D2C &amp; wellness-D2C landscape &amp; funding); Open Magazine (Ayurvedic-D2C economics &amp; global Ayurveda size); company/press references for Tata Consumer, HUL, Wagh Bakri, Blue Tokai, Sleepy Owl, Rage, Kapiva, OZiva; vahdam.in / SIDBI funding press. Market-size figures vary by firm scope; confidence tags reflect source strength. No competitor copy or named advisors are reproduced."]]
];

/* one-line strategic synthesis shown per region above the report */
var SYNTH = {
  US: "Origin moat at its strongest. Rivals import ashwagandha; VAHDAM owns it and is already in ~1,000 Target stores. Own the ashwagandha-forward calm-energy lane the mushroom-led leaders leave open, and keep claims disciplined.",
  UK: "Origin is parity, not advantage: Spacegoods and London Nootropics use the same KSM-66. Win instead on real Arabica coffee (vs cocoa), the 90-day guarantee, the heritage tea house behind the coffee, and ASA/CAP-clean marketing.",
  Global: "Neither origin nor incumbency wins here. Lead with the press/celebrity halo and premium gifting, concentrate spend on the winnable four (EU-ex-UK, Canada, ANZ, GCC), and localise the compliance, not the product.",
  India: "Origin is parity at home, everyone is origin. Win on premium/single-origin, the bridge SKU (Ashwagandha Coffee across the ritual and wellness wallets), reverse-prestige (loved in 145 countries), quick-commerce and disciplined CAC."
};

/* =====================================================================
   D2C GROWTH ENGINE, per region + a universal (all-industry) playbook.
   Rendered in its own "D2C growth" sub-tab. Synthesised from the report
   evidence above (sourced facts, no speculation).
   ===================================================================== */
var D2C_LEVERS = [
  ["Blended + paid CAC", "Cost to acquire a customer", ""],
  ["LTV : CAC ratio", "Whether acquisition is profitable", ""],
  ["Subscription rate &amp; churn", "Recurring-revenue health", ""],
  ["AOV", "Basket size per order", ""],
  ["Repeat / reorder rate", "Loyalty and habit", ""],
  ["First-order conversion", "Funnel efficiency", ""],
  ["Review volume &amp; rating", "Trust proxy", ""]
];
function leversTbl(moveCol) {
  var rows = D2C_LEVERS.map(function (r, i) { return [r[0], r[1], moveCol[i]]; });
  return ["tbl", ["Lever (tracked &amp; measured)", "What it measures", "How the region's brands improve it"], rows];
}

var D2C = {
  US: [
    ["head", "D2C growth engine (US)", "How the US brands track, measure and grow direct-to-consumer sales, and what they have done vs are doing now."],
    ["card", ["The US set runs on subscription economics and loud proof. Every serious player instruments the same core levers and optimises them with the standardized DTC motion (subscribe-default, guarantee, starter kit, social proof, retail crossover)."]],
    ["sub", "Levers, how the brands track, measure and improve D2C sales"],
    leversTbl([
      "Starter-kit offers, quiz-style funnels, UGC/reviews; a Target retail halo that lowers paid dependence",
      "Subscribe-default checkout + bundles/cross-sell to lift LTV against a low ~$0.80 to $3.30 serving price",
      "Default-to-subscribe, pause-not-cancel, 5-day reminders (VAHDAM) to blunt the #1 auto-renew complaint",
      "Bundles, gifting sets, free-frother/creamer thresholds",
      "Taste quality (the #1 repeat driver), replenishment reminders, loyalty",
      "30 to 90-day money-back + loud social proof (Ryze 200K+ reviews, Happy Mammoth 3.3M customers)",
      "Review-generation flows and sampling; transparency (third-party testing, KSM-66) as trust proof"
    ]),
    ["sub", "What the brands have done (past plays)"],
    ["bul", [
      "Built DTC subscription engines as the core business model, not a feature.",
      "Amassed review moats (Ryze 200,000+ reviews) and celebrity endorsement (AG1: Huberman, Hugh Jackman).",
      "Educated the category (Four Sigmatic normalised mushroom coffee) and bundled free gifts (frother, tumbler) to lower first-order friction.",
      "Used named clinical extracts (KSM-66, Shoden) and certifications (NSF, USDA Organic) to justify premium price."
    ]],
    ["sub", "What the brands are doing now (current plays)"],
    ["bul", [
      "Crossing DTC into physical retail once paid CAC bites: VAHDAM ~1,000 Target stores, Four Sigmatic national grocery, AG1 experiential.",
      "Competing on transparency: publishing third-party testing and exact doses (Ryze dinged for not publishing results).",
      "Leaning into taste-first positioning and diagnostic quiz funnels (Happy Mammoth 2-minute quiz) to raise conversion.",
      "Launching RTD/format extensions (Starbucks+PepsiCo Coffee &amp; Protein) as function mainstreams."
    ]]
  ],
  UK: [
    ["head", "D2C growth engine (UK)", "How the UK brands track, measure and grow D2C sales, and what they have done vs are doing now."],
    ["card", ["The UK set splits into two proven acquisition motions, influencer-led high-dose low-price (DIRTEA) and clinical-credibility (London Nootropics), on top of the same subscription levers. The sachet trial is the on-ramp; the ASA/CAP + MHRA regime shapes what can be claimed."]],
    ["sub", "Levers, how the brands track, measure and improve D2C sales"],
    leversTbl([
      "Low-friction sachet trials, influencer discovery (TikTok Shop) or doctor-backed credibility; Amazon UK reach",
      "Subscription + tea-house cross-sell; VAHDAM's 90-day guarantee de-risks the first order to lift conversion",
      "Default subscription (Spacegoods), reminders; transparent billing to counter auto-renew friction",
      "Bundles and B1/B2G1 promos (Spacegoods); gifting sets",
      "Clean taste (real coffee vs cocoa), replenishment, practitioner repeat",
      "Sachet trial packs + third-party testing (Spacegoods) and doctor endorsements (London Nootropics)",
      "Published testing, named branded extracts and clinician trust cues that move conversion"
    ]),
    ["sub", "What the brands have done (past plays)"],
    ["bul", [
      "Launched via influencer marketing at aggressive per-serving prices (DIRTEA ~&pound;0.40 to 0.55).",
      "Built clinical credibility with named, traceable extracts and doctor endorsements (London Nootropics: Rhodiolife, Hifas da Terra, KSM-66).",
      "Raised funding to build a lifestyle brand and define the category taste expectation (Spacegoods, &pound;2.5M).",
      "Used Amazon UK and TikTok Shop as discovery engines."
    ]],
    ["sub", "What the brands are doing now (current plays)"],
    ["bul", [
      "Leading acquisition with single-serve sachet trials, reserving bundles/subscription for the second purchase.",
      "Picking one credibility lane (clinical vs lifestyle) rather than blurring.",
      "Publishing third-party heavy-metal/microbial testing as a trust proxy (Spacegoods).",
      "Tightening claims to stay ASA/CAP + MHRA compliant, and opening the practitioner/clinic channel."
    ]]
  ],
  Global: [
    ["head", "D2C growth engine (Global / rest-of-world)", "How the exporters and luxury-tea houses track, measure and grow D2C across the winnable markets, past vs now."],
    ["card", ["Rest-of-world is won by the exporters that localise best plus the luxury-tea houses that own gifting. Because claim regimes are strict (EFSA/NHP/TGA/GCC), the growth levers lean on halo, gifting and marketplace reach rather than physiological claims."]],
    ["sub", "Levers, how the brands track, measure and improve D2C sales"],
    leversTbl([
      "Press/celebrity/luxury-list halo and marketplace reach (Amazon) that lower CAC where ad-spend can't scale",
      "Premium gifting and multi-SKU ranges to lift basket value and margin in high-income markets",
      "Regional storefront subscriptions; localised fulfilment to reduce shipped-in latency",
      "Premium gift sets and festive bundles (GCC, EU festive) as the high-margin, low-CAC lane",
      "Region-localised range + loyalty; concentration on the winnable four over thin 145-country coverage",
      "Money-back + luxury-brand trust; region-specific compliance passes before claims run",
      "Luxury-list rankings and celebrity press as portable trust that travels across markets"
    ]),
    ["sub", "What the brands have done (past plays)"],
    ["bul", [
      "Exporters localised via regional storefronts and Amazon (Four Sigmatic, Ryze, AG1) into EU/Canada/ANZ.",
      "Luxury-tea houses built boutique, department-store and duty-free gifting prestige (TWG, Kusmi, Palais des Thes, Mariage Freres).",
      "VAHDAM built a global storefront shipping to ~145 countries and a celebrity/press luxury-list halo."
    ]],
    ["sub", "What the brands are doing now (current plays)"],
    ["bul", [
      "Concentrating spend on the winnable four (EU-ex-UK, Canada, ANZ, GCC) rather than chasing coverage.",
      "Leading with halo and premium gifting over physiological claims (dodging strict EU/TGA/EFSA regimes).",
      "Localising the compliance, not the product: one SKU, region-specific claims (halal, NHP, EFSA, TGA/FSANZ).",
      "Spacegoods openly pushing European market leadership; luxury houses deepening gifting/mall distribution."
    ]]
  ],
  India: [
    ["head", "D2C growth engine (India)", "How the India players track, measure and grow D2C sales, and what they have done vs are doing now."],
    ["card", ["India D2C is decided as much by distribution execution (quick-commerce) and unit economics as by demand. The Ayurvedic-D2C profitability trap (Kapiva: &#8377;69cr loss on &#8377;342cr revenue) makes CAC discipline the defining lever."]],
    ["sub", "Levers, how the brands track, measure and improve D2C sales"],
    leversTbl([
      "Content/community funnels (Kapiva, OZiva), quick-commerce discovery, gifting; guard CAC as the category-killer",
      "Retention, gifting and cross-sell to keep LTV above premium CAC (the Kapiva warning)",
      "Subscription + replenishment; quick-commerce reorder velocity as the new recurring channel",
      "Premium bundles and festive/corporate gift sets that suit export-grade packaging",
      "30 to 60-day repurchase (OZiva); daily-ritual habit via the coffee format",
      "Marketplace + quick-commerce trial; brand/design trust vs Dabur/Himalaya credibility",
      "Community and content proof (OZiva Instagram); analyst/press validation"
    ]),
    ["sub", "What the brands have done (past plays)"],
    ["bul", [
      "Coffee-D2C raised PE/VC and educated the market on premium at-home ritual (Blue Tokai ~$180M valuation, $25M Sep 2025; Subko $10M).",
      "Ayurveda-D2C took Ayurveda out of the pharmacy jar with content + subscription funnels (Kapiva, OZiva).",
      "Convenience formats scaled via retail + quick-commerce (Sleepy Owl, 15K+ retail)."
    ]],
    ["sub", "What the brands are doing now (current plays)"],
    ["bul", [
      "Treating quick-commerce (Blinkit, Instamart, Zepto) as a first-class shelf where premium daily-ritual demand converts.",
      "Guarding CAC hard as ad-led growth gives way to unit-economics scrutiny.",
      "Leaning on gifting (festive + corporate) as a high-margin, low-CAC lane.",
      "Premiumising the format and experience, not the (native, non-novel) ashwagandha ingredient."
    ]]
  ]
};

var D2C_UNIVERSAL = [
  ["head", "Universal D2C strategy, every brand, any industry", "The non-negotiable moves that hold across regions and categories, distilled from the four studies."],
  ["bul", [
    "<b>Sell a relationship, not a one-off product.</b> Default-to-subscribe with genuinely easy pause/cancel and timed reminders; recurring revenue is where the economics live.",
    "<b>Instrument the whole funnel.</b> Track CAC (blended + paid), LTV, LTV:CAC, contribution margin, cohort retention, repeat rate and AOV; decide on LTV:CAC, not vanity revenue.",
    "<b>Guard CAC like the category-killer it is.</b> Lean on retention, referrals, owned channels and organic/UGC before scaling paid, the Kapiva loss is the warning.",
    "<b>De-risk the first purchase.</b> A money-back guarantee, a low-friction trial or sample, and loud, specific social proof.",
    "<b>Build a review and UGC engine.</b> Volume-of-proof is the primary trust lever in every market.",
    "<b>Lead with one named, provable differentiator,</b> and keep every claim compliant with the local regulator, compliance is itself a trust moat.",
    "<b>Win the real shelf of your market.</b> Retail crossover (US), quick-commerce (India), marketplaces/Amazon, wherever demand actually converts.",
    "<b>Raise AOV and LTV deliberately</b> with bundles, cross-sell and gifting; make replenishment effortless.",
    "<b>Own first-party data and email/SMS;</b> reduce dependence on rented audiences and shifting ad platforms.",
    "<b>Make cancellation frictionless and billing transparent;</b> surprise auto-renewal is the top complaint in every region.",
    "<b>Treat creative, offers and funnels as always-on experiments,</b> measure, iterate, kill what doesn't move the levers above."
  ]]
];

function d2cInnerHTML(region, mode) {
  return renderNodes(D2C[region], mode) + "\n" + renderNodes(D2C_UNIVERSAL, mode);
}

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
  // insert the synthetic "D2C growth" tab right after Strategy & white space
  var ordered = [];
  present.forEach(function (c) {
    ordered.push({ key: c[0], label: c[1], html: renderNodes(groups[c[0]], "page") });
    if (c[0] === "strategy") ordered.push({ key: "d2c", label: "D2C growth", html: d2cInnerHTML(region, "page") });
  });
  var tabs = ordered.map(function (c, i) {
    return '<button type="button" class="mstab' + (i === 0 ? " on" : "") + '" data-cat="' + c.key + '">' + c.label + "</button>";
  }).join("");
  var tabbar = '<div class="flex flex-wrap gap-2 mt-4" data-ms-cattabs>' + tabs + "</div>";
  var panels = ordered.map(function (c, i) {
    return '<div data-cat-panel="' + c.key + '" class="space-y-3 mt-4"' + (i === 0 ? "" : ' style="display:none"') + ">" + c.html + "</div>";
  }).join("\n");

  return head + "\n" + legendPage() + "\n" + synth + "\n" + tabbar + "\n" + panels;
}

/* ---- public: standalone HTML (reference) ---- */
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
    d2cInnerHTML(region, "doc") +
    "</body></html>";
}

/* =====================================================================
   DOCX (WordprocessingML) renderer, so downloads work without LibreOffice
   ===================================================================== */
function decodeEntities(s) {
  return String(s)
    .replace(/&#8377;/g, "₹").replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·").replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
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
  var grid = "<w:tblGrid>" + headers.map(function () { return "<w:gridCol/>"; }).join("") + "</w:tblGrid>";
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
  REPORTS[region].concat(D2C[region]).concat(D2C_UNIVERSAL).forEach(function (n) {
    var t = n[0];
    if (t === "sec") { body += pHead(n[1] + ". " + n[2], 28); if (n[3]) body += pItalic(n[3]); }
    else if (t === "head") { body += pHead(n[1], 28); if (n[2]) body += pItalic(n[2]); }
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

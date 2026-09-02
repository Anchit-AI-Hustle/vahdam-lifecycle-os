# QA gate — US September 2026 campaign set

Answered in writing, item by item. Where a check was run as code, the command is
named so it can be re-run rather than believed.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Every price and title re-verified against the live store today | **PASS** | Shopify Admin API, 2026-09-02. Four prices used, all read live. The brief's own price list was found wrong in four places and was not used — `catalogue-verification.md`. |
| 2 | Every unverified fact bracketed | **PASS** | 9 bracketed items: Christmas order-by date (Story), CAN-SPAM postal address + unsubscribe tag (email), review/rating proof slot (email), 2 unconfirmed `NET WT.` declarations, 5 creator commercial terms, music licence. None appears as a claim. |
| 3 | Zero UK or EU assets anywhere | **PASS** | Source is the US store's own Admin API, which cannot return another market's catalogue. Three pack shots opened and read: all carry US dual declaration. Nothing was rejected because nothing non-US entered. |
| 4 | No photo repeated at the same treatment | **PASS** | Turmeric Ginger pack appears 4x at 3 treatments (green radial / ink radial + vignette / cream editorial on white card). Advent pack 2x at 2 (green vertical, ink cinematic). |
| 5 | Gold text at 600/700 everywhere | **PASS** | `.gold-text` and `.kicker` both set `font-weight:700` in `tokens.css`; no gold text is styled outside them. |
| 6 | Vertical placements inside safe zones | **PASS** | Content pinned in a flex column at `top:200px; height:1200px`, and the renderer fails the build if that container overflows. Caught a real breach: the first TikTok cut put the wordmark at y≈1720 and Story's price block at y≈1548. |
| 7 | Video hook carries no logo, brand or offer before 1.5s | **PASS** | Beat 1 is a live-action plate with no pack, no wordmark, no price. Brand first appears at 9.5s, price at 12s. |
| 8 | No type, price or legal line rendered by an image model | **PASS** | Every character is CSS, rasterised by Chromium. No image model was called in this build at all. |
| 9 | No AI-generated packaging anywhere | **PASS** | All packs are the store's own photographs. The only pixel operation is an edge flood-fill knockout that cannot alter interior pixels — `build/cutout.js`. |
| 10 | Files at exact platform pixel dimensions | **PASS** | Asserted from the PNG IHDR after write, not from the request. `node build/render.js` fails on mismatch. 9 files, all exact. |
| 11 | Teardown dated and cited | **CARRIED, NOT RE-RUN** | See below. |
| 12 | Model routing stated per stage, with forced substitutions flagged | **PASS** | See below. |

## Contrast — measured, not asserted

`node build/contrast.js` computes every foreground/background pair in use.
All 8 live pairs pass; 0 failures.

```
9.61:1  cream on green    16.52:1  cream on ink       3.12:1  gold on green
5.36:1  gold on ink        5.36:1  ink on gold        9.61:1  green on cream
16.52:1 ink on cream       3.08:1  gold on cream
```

Two pairs clear AA only as **large** text (≥18.66px bold): gold on green at 3.12:1 and
gold on cream at 3.08:1. Every live use of both is ≥21px at weight 700.

**This check caught a real failure.** The email's cross-sell link was 15px bold gold
on cream — 3.08:1, and 15px does not qualify as large. Changed to green (9.61:1). It
would have shipped had the ratio been assumed rather than computed.

## Item 11 — the teardown is carried, not re-run

The Pique reading (US Meta Ad Library, active image ads, **2026-08-22**) is quoted as
given: 100% creator collaborations, zero designed posters, zero price or countdown
burned onto an image, one CTA. That reading is **11 days old at time of build and was
not re-run here** — the Meta Ad Library was not queried in this session.

The standing brief says to re-run it every campaign and date the reading. That has not
been done, so item 11 is a **carried** pass, not a fresh one. It is the one gate item
that is not independently evidenced by this build, and the creator test's central
premise rests on it. Re-run before spend.

## Item 12 — model routing, and where it was forced

| Stage | Capability needed | Ran on | Forced? |
|---|---|---|---|
| Catalogue pull, connector calls, orchestration | long multi-step tool use | Claude (this session) | No — primary |
| Ad copy, hooks, subject lines, scripts | restraint, voice fidelity | Claude | No — primary |
| Layout, typesetting, exact pixel rendering | deterministic HTML+CSS, headless render | Claude + Chromium | No — primary |
| Measurement (contrast, dimensions, inventory) | arithmetic accuracy | Executed code, not a model | Stronger than routed |
| Scene and lifestyle imagery | photoreal generation | **Not run** | Deliberate. Scene layer is a shot brief, not a generation. |
| Video generation | motion, shot consistency | **Not run** | Pre-production only; nothing to route yet. |
| Competitive teardown | live web + citation | **Not run** | See item 11 — carried from 2026-08-22. |
| **QA, claim check, compliance** | adversarial reading | **Claude — the same model that wrote the copy** | **YES. This is a violation.** |

**The routing law says the model that wrote the claim does not clear the claim, and
that is exactly what happened here.** Every deliverable in this folder was written and
QA'd in one context by one model. The deterministic checks are unaffected — contrast,
pixel dimensions, overflow and image-load are code, and code does not have a stake in
its own output. But the judgement calls do carry that risk, specifically:

- whether each health-adjacent line stays the right side of a structure/function claim
- whether the copy is genuinely free of the banned phrase list
- whether anything unverified slipped through unbracketed

**Before spend, run a second pass on a different model**, or in a fresh context with
only `catalogue-verification.md` and the raw creatives, on those three questions.
Flagged rather than quietly skipped, per law 4.

## Standing brand rules, spot-checked

Run with `bash docs/check-copy.sh`. Results at build time:

- **Banned phrases** — 8 of 9 return zero. `transform` returns **4 hits, all of them
  `text-transform:uppercase` in the email's inline CSS** — a substring match against
  markup, not the banned word in copy. Recorded rather than silently excluded, because
  a naive grep will flag it again and the next person should not have to re-chase it.
  No banned phrase appears in any customer-facing sentence.
- **No em or en dashes in output copy** — 0 occurrences of U+2013 or U+2014 across
  ads, email, reel script and creator brief.
- **No emoji** — 0 occurrences in the emoji and dingbat ranges. The creator brief
  specifies `#ad`, which is a hashtag.
- **Palette closed to four colours** — `tokens.css` defines only the four; no creative
  introduces a fifth. The Advent pack photograph is red, which is the product, not a
  design choice.
- **Footer legal as plain text, not anchors** — `layout.js` `legal()` emits a `div`.
  The email is the exception by medium: there, they are still plain text, and the only
  anchors are the CTAs.

# VAHDAM US — campaign set, September 2026

Three campaigns, built against the live US store. Every price and pack line traces to
the Shopify Admin API read on **2026-09-02** or to the pack photograph shipped
alongside. Nothing is estimated.

```
ads/        6 static ads, flat PNG, exact platform pixel size
email/      1 mailer (HTML) + phone and desktop proofs
reels/      3 storyboard frames + shot list and script  — PRE-PRODUCTION, not shot
creator/    1 creator brief, ready to send
docs/       verification, shot briefs, QA gate, test plan
build/      the render pipeline and the verified product data
assets/     pack shots from the live store, and their knockouts
```

## The three campaigns

**1. Turmeric Ginger — cold prospecting, run as a TEST.**
Turmeric Ginger Herbal Tea, 100 Count, **$25.99**, 1,913 units.
Two arms: a designed poster (control) against creator footage (test). This is the
account's weakest leg — 0.88x top-of-funnel ROAS, and $756 spent for $0 returned on
two designed cold-audience posters. The control ships so the result is readable, not
because it is the recommendation. See `docs/test-plan.md`.

**2. Daily Assam — lifecycle replenishment.**
Daily Assam Black Tea, 12 oz, **$25.99**, 924 units. Cross-sell to English Breakfast
12 oz at **$23.99**, 908 units. Email plus a Meta retargeting cut. Speaks to someone
who has already bought: the tin running low, not an explanation of what Assam is.

**3. Foldable Advent Calendar — holiday.**
**$17.49**, 245 units. Story/Reels and a YouTube end card.
**Blocked on a catalogue fix before spend** — the product is listed twice, both
active, both $17.49, 245 and 307 units. See `docs/catalogue-verification.md`.

## Files

| File | Size | Placement |
|---|---|---|
| `ads/meta-1080x1350-turmeric-ginger-CONTROL.png` | 1080x1350 | Meta feed — test control arm |
| `ads/tiktok-1080x1920-turmeric-ginger-CREATOR.png` | 1080x1920 | TikTok in-feed |
| `ads/instagram-1080x1350-turmeric-ginger-EDITORIAL.png` | 1080x1350 | Instagram feed, offer demoted |
| `ads/meta-1080x1350-daily-assam-RETARGETING.png` | 1080x1350 | Meta feed, retargeting |
| `ads/story-1080x1920-advent-HOLIDAY.png` | 1080x1920 | Stories / Reels / TikTok |
| `ads/youtube-1920x1080-advent-ENDCARD.png` | 1920x1080 | YouTube end card |
| `email/daily-assam-replenishment.html` | 600px | ESP. 3 subject lines in the source header |
| `reels/reel-beat{1,2,3}-*.png` | 1080x1920 | Storyboard, stamped NOT FINAL |

## Rebuild

```bash
node build/cutout.js          # knock out pack-shot backgrounds
node build/render.js build/ads.js
node build/render.js build/reels.js
node build/email-proof.js
node build/contrast.js        # WCAG-AA, every pair in use
bash docs/check-copy.sh       # banned phrases, dashes, emoji
```

The renderer fails the build on a wrong pixel dimension, overflowing type, or an image
that did not load. All three have caught real defects in this set.

## What is finished, and what is not

**Finished and shippable:** the six static ads, the email, the creator brief.

**Not finished, and not pretended to be:**

- **No lifestyle photography exists.** The store supplies pack shots on white and
  nothing else, so the scene layer of every visual is a designed brand ground, not a
  photograph. It was not AI-generated and not borrowed from another market.
  `docs/shot-briefs.md` specifies the four shots that should replace it; they drop in
  behind the existing type without a re-layout.
- **There is no video.** `reels/` is a shot list, a script and three storyboard
  frames. The frames are stamped `STORYBOARD · NOT FINAL` in-image so one cannot be
  mistaken for a delivered asset if it leaves this folder alone.

## Three things to settle before any of this spends money

1. **Re-run the competitor teardown.** The Pique reading the test rests on is dated
   2026-08-22 and was carried, not re-run. `docs/qa-gate.md` item 11.
2. **Resolve the duplicate Advent listing.** 552 units and all its conversion data are
   currently split across two live PDPs.
3. **Second-model QA pass.** Everything here was written and checked by one model in
   one context, which breaks the never-self-certify rule. The deterministic checks
   (contrast, dimensions, overflow, copy scan) are code and unaffected; the
   health-claim judgement calls are not. `docs/qa-gate.md` item 12.

## Bracketed items awaiting a human

`[Christmas order-by date]` · `[CAN-SPAM postal address]` · `[unsubscribe merge tag]` ·
`[review/rating proof]` · `[NET WT. for 2 SKUs]` · `[creator fee, usage window,
whitelisting, exclusivity, territory]` · `[music licence]` · `[decision metric, spend
per arm, significance threshold]`

None appears as a claim anywhere. They are visible in the deliverables as brackets so
they cannot ship by accident.

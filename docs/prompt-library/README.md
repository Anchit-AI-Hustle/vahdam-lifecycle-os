# Prompt library — the brand contract for generated assets

Five production prompts, one per asset class. Each carries a **brand block** to be
pasted verbatim, and a **generic** variant with placeholders so the same skeleton
can be used for another brand.

| File | Covers |
|---|---|
| [01-landing-pages.md](01-landing-pages.md) | Presell and PDP-adjacent landing pages |
| [02-marketing-mailers.md](02-marketing-mailers.md) | Table-based, client-safe HTML email |
| [03-ad-creatives.md](03-ad-creatives.md) | Paid social statics and video |
| [04-visual-assets.md](04-visual-assets.md) | Product/lifestyle imagery, GIFs, data graphics |
| [05-music-and-sound.md](05-music-and-sound.md) | Sonic logo, ad beds, reel and long-form beds |

They are stored as supplied, with **one edit**: the `MARKET URLS` line in each
brand block has been corrected, because four of the five URLs it listed do not
point where they claimed. The original line is quoted verbatim below so the
discrepancy is still on the record.

Correcting it rather than annotating it is deliberate. This is an operational
document — the brand blocks exist to be pasted into a model. A reader copying a
fenced code block will not stop to read a caveat further down the page, so a note
would have left the next person shipping dead links.

---

## Correction — the market URLs in the brand blocks are wrong

Every one of the five brand blocks carries this line:

```
MARKET URLS: US https://www.vahdamteas.com · UK https://uk.vahdamteas.com ·
IN https://www.vahdamindia.com · EU https://eu.vahdamteas.com · AU https://au.vahdamteas.com
```

Four of those five do not point where they claim. Measured 2026-08-13 with
`node scripts/check-market-urls.js`:

| URL in the brand block | What it actually does |
|---|---|
| `www.vahdamteas.com` | 200, but **redirects** to `https://www.vahdam.com/` |
| `uk.vahdamteas.com` | **does not resolve** |
| `eu.vahdamteas.com` | **does not resolve** |
| `au.vahdamteas.com` | **does not resolve** |
| `www.vahdamindia.com` | 200, but **redirects** to `https://www.vahdam.com/` |

The live storefronts are:

```
US      https://www.vahdam.com
UK      https://www.vahdam.co.uk
Global  https://www.vahdam.global      (also serves EU, AU, ME)
IN      https://www.vahdam.com         (no separate IN storefront today)
```

**Use `api/_shared/market-urls.js` as the source, never the brand block's URL
line.** When pasting a brand block into Claude, ChatGPT or Gemini, substitute the
corrected list above.

### Why this is worth a section rather than a silent edit

The same four wrong URLs were in `CLAUDE.md` under a heading that read
`Market-Specific Store URLs (VERIFIED)`, and in nine hand-maintained copies of the
map across the codebase — the mailer pipeline, the ad generator, the landing-page
builder, the review-recovery mailer, the competitive benchmark and the playbook
generator. Most of those copies carried a comment saying *"VERIFIED, per
CLAUDE.md"*.

So every UK, EU and AU mailer, ad and landing page this repo generated linked to a
host that does not resolve. Not a slow page — nowhere.

Two things made it survive:

1. **The word "verified" stopped anyone re-checking.** A verification is only worth
   as much as the last time someone ran it, which is why
   `scripts/check-market-urls.js` now exists: re-measuring is one command.
2. **The error was copied into the document you would check against.** A brand
   contract repeating a mistake makes the mistake authoritative.

Someone did find part of it. `scripts/scrape-catalog.js` carried a note dated
2026-06-21 recording `uk.vahdamteas.com` as NXDOMAIN, and worked around it by
skipping the UK catalog entirely — concluding `.co.uk` was "a lander". That was
true when written and is no longer: `https://www.vahdam.co.uk/products.json`
returns 108 live UK products at GBP prices. UK now scrapes like every other market.

`tests/market-urls.spec.js` fails if any source file names a dead host again.

---

## The rest of the contract is enforced elsewhere

These are already checked in code, and the prompt library agrees with them:

- **Palette and banned phrases** — `sanitizeBrand()`, `scrubDashes()` and
  `assertNoBanned()` in `api/_shared/scenario-model.js`, applied at generation time
- **Contrast** — `tests/nav-contrast.spec.js`, `tests/table-readability.spec.js`,
  `tests/motion-system.spec.js`
- **Market URLs** — `tests/market-urls.spec.js`, `node scripts/check-market-urls.js`

There is **no repo-wide palette test**. The four-colour rule is enforced where
copy and markup are generated, not across the pages already in the tree, so a
hand-written page can still carry an off-palette hex without failing anything.

Two rules in the library are **stricter than what the codebase enforces today**,
and are worth knowing about before they are treated as passing:

- `Learn More` and `Click Here` are banned CTAs. There are 128 instances of
  `>Learn more<` in `landing-pages/ashwagandha-matrix/`.
- `href="#"` is banned outright. There are 276 instances repo-wide, almost all in
  the same generated matrix.

Both are in already-generated deliverables rather than the generators. Fixing the
deliverables is a separate pass from fixing what produces them.

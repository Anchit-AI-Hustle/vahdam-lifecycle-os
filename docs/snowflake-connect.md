# Connecting the deployed app to Snowflake (read-only)

The Ads pages already read Snowflake **in this session** through the Snowflake MCP connector, which is
per-user and does not apply to the deployed app. Vercel needs its own credentials. Until they are set,
every ads endpoint returns an honest `{ connected: false, would_query }` envelope carrying the exact SQL
it would run — no figure is ever invented.

Everything below except the token secret is **verified live** (2026-07-26).

## 1. Connection values (verified)

| Vercel env var | Value | How it was verified |
|---|---|---|
| `SNOWFLAKE_ACCOUNT` | `UXDEIHW-MO06981` | `CURRENT_ORGANIZATION_NAME()` = `UXDEIHW`, `CURRENT_ACCOUNT_NAME()` = `MO06981`. A POST to `https://UXDEIHW-MO06981.snowflakecomputing.com/api/v2/statements` returns **401** (host correct, token rejected). |
| `SNOWFLAKE_USER` | `ANCHITTANDON` | `CURRENT_USER()` |
| `SNOWFLAKE_WAREHOUSE` | `COMPUTE_WH` | `CURRENT_WAREHOUSE()` |
| `SNOWFLAKE_DATABASE` | `VAHDAM_DB` | `CURRENT_DATABASE()` |
| `SNOWFLAKE_ROLE` | `VAHDAM_APP_READONLY` (create it, step 2) | current session uses `CLAUDE_ROLE`; a dedicated read-only role is preferable for a web app |
| `SNOWFLAKE_PAT` | *(secret — you generate it in step 2)* | — |
| `LIVE_CONNECTORS` | `on` | required; with it off the app deliberately stays on snapshot data |

> **Do not use the account locator.** `BA95169.snowflakecomputing.com` returns **404** for the SQL API v2
> statements endpoint — only the `ORG-ACCOUNT` form works. Region is `AWS_AP_SOUTH_1`.

## 2. Create a read-only role and a PAT (run in Snowsight)

The app issues only `SELECT` / `SHOW` / `INFORMATION_SCHEMA` reads and refuses anything else in code
(`WRITE_RE` in `api/_shared/ads-snowflake-core.js`), but the grant should be read-only as well.

```sql
CREATE ROLE IF NOT EXISTS VAHDAM_APP_READONLY;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE VAHDAM_APP_READONLY;

-- Meta + Google live here
GRANT USAGE  ON DATABASE VAHDAM_DB                     TO ROLE VAHDAM_APP_READONLY;
GRANT USAGE  ON ALL SCHEMAS    IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;
GRANT USAGE  ON FUTURE SCHEMAS IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON ALL TABLES     IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON FUTURE TABLES  IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON ALL VIEWS      IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON FUTURE VIEWS   IN DATABASE VAHDAM_DB   TO ROLE VAHDAM_APP_READONLY;

-- TikTok lives here (DATON.RAW)
GRANT USAGE  ON DATABASE DATON                         TO ROLE VAHDAM_APP_READONLY;
GRANT USAGE  ON ALL SCHEMAS    IN DATABASE DATON       TO ROLE VAHDAM_APP_READONLY;
GRANT USAGE  ON FUTURE SCHEMAS IN DATABASE DATON       TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON ALL TABLES     IN DATABASE DATON       TO ROLE VAHDAM_APP_READONLY;
GRANT SELECT ON FUTURE TABLES  IN DATABASE DATON       TO ROLE VAHDAM_APP_READONLY;

GRANT ROLE VAHDAM_APP_READONLY TO USER ANCHITTANDON;

-- The token. Snowflake prints the secret ONCE — copy it straight into Vercel.
ALTER USER ANCHITTANDON ADD PROGRAMMATIC ACCESS TOKEN VAHDAM_LIFECYCLE_OS
  ROLE_RESTRICTION = 'VAHDAM_APP_READONLY'
  DAYS_TO_EXPIRY   = 90
  COMMENT          = 'vahdam-lifecycle-os read-only ads dashboard';
```

If Snowflake refuses the token, the account usually requires a **network policy** before PATs are
allowed. Attach one to the user (or account) and retry — that is a Snowflake account setting, not an
app change.

## 3. Set the variables in Vercel

Project **vahdam-lifecycle-os** → Settings → Environment Variables (Production *and* Preview):

```
SNOWFLAKE_ACCOUNT=UXDEIHW-MO06981
SNOWFLAKE_USER=ANCHITTANDON
SNOWFLAKE_PAT=<paste the token from step 2>
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=VAHDAM_DB
SNOWFLAKE_ROLE=VAHDAM_APP_READONLY
LIVE_CONNECTORS=on
```

Then redeploy (env changes do not apply to existing deployments).

⚠️ On Windows, pipe secrets with `cmd /c "type file | vercel env add"` — PowerShell `echo` prepends a
UTF-8 BOM and the token will fail auth (see CLAUDE.md, Common Bugs #7).

## 4. Verify (in this order)

| Check | Expected |
|---|---|
| `/api/brain?action=ads-snowflake&op=ping` | `reachable: true`, a `latency_ms`, `account_host: UXDEIHW-MO06981.snowflakecomputing.com` |
| `/api/brain?action=ads-live&op=status` | `snowflake.configured: true` |
| `/api/brain?action=ads-live&op=today` | `source: "snowflake"`, today's partial-day rows |
| `/ads-dashboard` → **Source & connection** | green `reachable` chip |
| `/ads-master` → **Live Now** | source chip reads `snowflake` instead of `snapshot` |
| `/ads-dashboard` → **SOP compliance** | real compliance rate and spend-at-risk instead of the not-reachable notice |

Failure modes the ping distinguishes for you: `not connected` (vars missing, it names which),
`unreachable` + HTTP 401/403 (bad or expired PAT, or the role cannot use the warehouse), and
`unreachable` + other (wrong account identifier or network).

## 5. What goes live, and what will still look empty

VAHDAM runs **13 distinct ad accounts across 17 warehouse feeds** (Meta 10, Google 6, TikTok 1),
enumerated live on 2026-07-26 by unioning every base insights / ad-performance table in `VAHDAM_DB`
and grouping by account. The registry lives in `adAccounts()` in
`api/_shared/ads-snowflake-core.js` and is served at
`/api/brain?action=ads-snowflake&op=accounts` (and statically at `/data/ads/ad-accounts.json`).

### US, live

| Account | Id | Warehouse table | Fresh to | Judged on |
|---|---|---|---|---|
| Meta — Vahdam India USA New EST Main (D2C) | `1303870183798748` | `MAPLEMONK.META_USA_ADS_INSIGHTS` | 2026-07-25 + partial day | ROAS |
| Meta — VAHDAM USA - Tea Ad Account (Target / Costco) | `804570870670763` | `MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS` | 2026-07-25 + partial day | CTR / CPC / CPM |
| Google — VAHDAM | `9797311905` | `MAPLEMONK.US_GOOGLE_ADS_CONSOLIDATED` (filter `ACCOUNT='Google US CONSOLIDATED'`) | 2026-07-25 | ROAS |
| Google — Raghuvansh (Amazon, Ampd) | `3036820580` | `MAPLEMONK.US_AMZ_GADS_AD_GROUP_AD_REPORT` | 2026-07-25 | CTR / CPC |
| TikTok — VAHDAM USA | `7393105007056388112` | `DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY` | 2026-07-14 (paused) | CTR / CPC |

Meta cohort breakdowns are live in `MAPLEMONK1` (age/gender 11,521 rows · platform/device 11,511 ·
creatives 9,544) and belong to the DTC account. Non-US live feeds: Meta UK `573128874469619`
(fresh to 2026-07-26, the freshest in the warehouse), Meta India `70950428`, Google UK
`3861674115`, Google India `7719984554`. **UK reports GBP and India reports INR — never sum them
with the USD accounts.**

### Two corrections to earlier notes in this file

1. **The Target/Costco retail account IS in the warehouse.** It sits in `MAPLEMONK` under
   `USA_TEA_ADS_ADS_INSIGHTS` — a name that does not match `META_USA%`, which is why a name-based
   search found only the DTC account. 6,556 rows, 26 campaigns, 214 ads, $50,248.24, from
   2025-09-24 through the current partial day. Its May ($3,608.06) and June ($14,422.93) spend
   match the KT Master Ad Tracking Sheet to the cent. A second, older Datachannel mirror exists at
   `DC_RAW.FB2_VAHDAM_VAHDAMUSATEA_US_FBADS_ADPERFORMANCE` but ends 2026-05-31 and holds only 7 of
   the 26 campaigns — do not report from it.
2. **US Google is not stale.** `GOOGLE_ADS_US_AD_GROUP_AD_REPORT` holds the **retired** customer
   `2769294429` ("VAHDAM - USA - Old") and correctly stops 2023-11-24; the account was closed, not
   the feed. The live customer is `9797311905` in `US_GOOGLE_ADS_CONSOLIDATED`: 23 campaigns,
   $72,343.46 spend against $142,983.81 conversion value in 2026 YTD (ROAS 1.98), fresh to
   2026-07-25. No pipeline work is required.

### The KPI rule that matters more than the connection

Accounts are **not comparable on one KPI**. Where a pixel or a Google conversion is tracked,
revenue / ROAS / CPA are real. Where checkout happens on **target.com, Instacart or amazon.com**,
no purchase can ever be attributed back to the ad, so those accounts return `null` rather than `0`
and must be judged on CTR, CPC, CPM and reach. A 0.00x ROAS on a retail account is a measurement
artefact, not a result — ranking the estate on ROAS would report every Target and Costco campaign
as a total failure.

Setting `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` still gives a minute-fresh read for whichever
account those credentials belong to, and `/api/brain?action=ads-live` prefers it over the
warehouse. It is no longer required to see Target/Costco at all — the warehouse now carries it.

## 6. Security note

Snowflake credentials for a different user were shared in plain text in the UGC Dashboard Automation
email thread. Rotate that password and keep access per-user; the app should use the PAT above, never a
personal password.

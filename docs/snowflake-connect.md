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

| Platform | After connecting | Note |
|---|---|---|
| Meta USA | Live, including the current partial day | `MAPLEMONK.META_USA_ADS_INSIGHTS`, 129,741 rows, fresh to 2026-07-25/26 |
| Meta cohorts | Live | `MAPLEMONK1` age/gender 11,521 rows · platform/device 11,511 · creatives 9,544 |
| TikTok USA | Live | `DATON.RAW.TIKTOK_ADS_USA_*_REPORT_DAILY`, fresh to 2026-07-23, $68,178.71 |
| Google US | **Queries correctly but returns no recent rows** | the feed is stale, ending **2023-11-24**. Resume the Google Ads pipeline to fix; this is a data gap, not a code fault |

The Target/Costco retail ad account is **not** in the warehouse at all — only the DTC account
*Vahdam India USA New EST Main Account* (`1303870183798748`) is mirrored. To make Target/Costco
real-time, either add that account to the Maplemonk pipeline, or set `META_ACCESS_TOKEN` +
`META_AD_ACCOUNT_ID` for it and `/api/brain?action=ads-live` will read it straight from the Meta
Marketing API (that path is already implemented and preferred over the warehouse when configured).

## 6. Security note

Snowflake credentials for a different user were shared in plain text in the UGC Dashboard Automation
email thread. Rotate that password and keep access per-user; the app should use the PAT above, never a
personal password.

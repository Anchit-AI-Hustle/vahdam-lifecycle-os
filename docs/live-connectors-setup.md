# Going live: real-time paid-media and lifecycle data

The dashboards read live when credentials exist and fall back to the committed
snapshot when they do not, saying so on screen. Nothing is ever fabricated. This
page is the shortest path from "not reading the ad account live right now" to a
real-time read.

Check the current state at any time:

```
curl -s https://vahdam-lifecycle-os.anchit-tandon.com/api/connectors-health | jq
```

It probes all seven platforms with real round-trips and returns a per-platform
`blocker` naming exactly what is missing.

## The one switch, then the per-platform keys

Everything outbound is behind a single kill switch, `LIVE_CONNECTORS`, which
defaults to **off**. With it off the app runs entirely on snapshots and never
opens an external connection. Nothing below works until it is on:

```
LIVE_CONNECTORS=on
```

Set it in Vercel (Project → Settings → Environment Variables → Production), then
add the per-platform keys. Every variable also accepts a market suffix, and the
suffixed value wins: `META_ACCESS_TOKEN_US` beats `META_ACCESS_TOKEN`. Use
suffixes when a market has its own ad account, which is the case here (the US
DTC account and the retail account are separate, and the Klaviyo account
currently connected is the UK one).

## Meta Ads

| Variable | Where it comes from |
|---|---|
| `META_ACCESS_TOKEN` | System User token, scope `ads_read` |
| `META_AD_ACCOUNT_ID` | The account number **without** the `act_` prefix |

1. Business Settings → Users → **System Users** → Add. Give it a name like
   `vahdam-lifecycle-os-reporting`.
2. **Add Assets** → Ad Accounts → select the account → grant **View Performance**
   (read-only). Do not grant Manage.
3. **Generate New Token** → pick the app → tick **`ads_read`** only → generate.
4. Copy the account id from Ads Manager. If it shows `act_1234567890`, the value
   to set is `1234567890`.

System User tokens do not expire on a fixed schedule the way user tokens do,
which is why this is the right token type for an unattended dashboard.

## Google Ads

| Variable | Where it comes from |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads **manager** account → Tools → API Center |
| `GOOGLE_ADS_CLIENT_ID` | Google Cloud Console → Credentials → OAuth client |
| `GOOGLE_ADS_CLIENT_SECRET` | same OAuth client |
| `GOOGLE_ADS_REFRESH_TOKEN` | one-time OAuth consent, scope `.../auth/adwords` |
| `GOOGLE_ADS_CUSTOMER_ID` | the 10-digit account id (dashes are stripped for you) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional; the MCC id when accessing via a manager account |

> **Plan for lead time.** The developer token starts at *Test* access, which only
> works against test accounts. Production data needs **Basic access**, and that
> is an application Google reviews. This is the long pole of the three
> platforms — start it first. The other two can be done in an afternoon.

The refresh token is minted once against the OAuth client with the `adwords`
scope and then reused; the app exchanges it for a short-lived access token on
every call, so nothing long-lived is sent to Google Ads itself.

## TikTok Ads

| Variable | Where it comes from |
|---|---|
| `TIKTOK_ACCESS_TOKEN` | TikTok for Business → Developers → your app → OAuth |
| `TIKTOK_ADVERTISER_ID` | Ads Manager account id |

Ask for the reporting/read scope only. Note that the TikTok Business API returns
**HTTP 200 with a non-zero `code`** on failure rather than an HTTP error status;
the app already treats that as a failure rather than as empty data.

## Klaviyo, Shopify, WebEngage

| Platform | Variables |
|---|---|
| Klaviyo | `KLAVIYO_API_KEY` (private key, read scopes) plus optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION` |
| Shopify | read-scoped Admin token; only needs `LIVE_CONNECTORS=on` beyond that, and only GET reaches Shopify hosts |
| WebEngage | `WEBENGAGE_EXPORT_URL` + `WEBENGAGE_API_KEY`, then run `/api/cron/webengage` |

## What "real time" actually means per platform

Freshness is bounded by each platform, not by this app. Claiming minute-fresh
conversion data would be a fabrication:

- **Meta** — delivery metrics are near real time. Attributed conversions lag and
  are restated as the attribution window closes, so today's ROAS moves for a
  day or two after the fact.
- **Google Ads** — most metrics land within a few hours; conversions restate for
  longer, depending on the conversion window configured on the account.
- **TikTok** — the report API exposes `real_time_conversion` separately from the
  settled figure, and the two legitimately disagree during the day.
- **Klaviyo** — event data is effectively immediate.
- **Shopify** — orders are immediate; analytics aggregates are not.

Because of this the dashboard labels every figure with the day it describes and
whether that day is still accruing. A stale snapshot is never presented as today.

## Verifying it worked

1. `curl -s .../api/connectors-health | jq '.summary'` should move from
   `{"live":1,"blocked":6}` toward `{"live":7,"blocked":0}`.
2. The ads dashboard's amber "Not reading the ad account live right now" notice
   disappears and the source chip changes from `snapshot <date>` to
   `live ad account`.
3. The Live Now cards start naming today rather than the snapshot's last day.

If a platform is configured but still failing, the health endpoint returns the
platform's own error message rather than a generic one, so the message in
`blocker` is the thing to act on.

## Confidence that the code is ready

`tests/ad-insights-live.spec.js` simulates credentials for all three ad
platforms and stubs the network, asserting the real module builds the correct
request (endpoint, auth placement, level, date window), parses a success, and
surfaces a platform error instead of turning it into zeros. It also asserts that
with no credentials, or with the kill switch off, **not one byte leaves the
box**. So the path is known-good before you spend time provisioning tokens.

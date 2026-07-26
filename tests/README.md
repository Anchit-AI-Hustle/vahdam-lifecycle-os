# Headless harness for streamlit_app.py

Streamlit-in-Snowflake cannot be run outside Snowflake (`get_active_session()`), so this
executes the app with a **stubbed Streamlit** and a **recording fake session**, which is
enough to catch every Python-level defect and to capture the SQL the app builds.

```bash
cp ../streamlit_app.py app_under_test.py     # from the repo root
mkdir -p data && cp -r ../data/ads data/
python3 run.py
```

It sweeps 33 targets — 3 sections and 10 analysis views x 3 channels — reporting any
exception plus how many SQL statements, tables, charts and metrics each produced, and
writes every statement to `sql_*.txt`.

**`session_state` must be a persistent dict.** The first version returned a fresh `{}` on
every access, so anything the app stored vanished immediately and every `session_state`
branch silently took its default path — the harness reported "no error" while never
executing the drill-down levels at all. Same failure mode as the fake column list below.

**The stub reports REAL column lists** (`SCHEMAS` in `stub.py`, read from the warehouse
2026-07-26). That matters: an earlier version claimed every table had `account_name`,
which hid exactly the column-resolution bugs the harness exists to find. If a schema
changes upstream, refresh `SCHEMAS` or the harness will validate against a fiction.

Validate the captured SQL against the warehouse without executing it:

```sql
select length(SYSTEM$EXPLAIN_PLAN_JSON($$<statement>$$));
```

A compile error raises; a plan length means the statement is valid. Batch many with
`union all`, but note one bad statement aborts the whole batch, so bisect on failure.

## What this does and does not prove

Proves: no Python exceptions on any view/channel, correct column resolution per feed,
and that generated SQL compiles.
Does NOT prove: visual layout, or that figures are business-correct — the fake session
returns synthesised rows. Numeric correctness is verified separately by running the
statements for real and reconciling against hand-written queries.


## Guards (run these, not just the sweep)

```bash
python3 run.py                # 33-target sweep: any Python error, per-target SQL/table/chart counts
python3 ratio_guard.py        # table_explorer: SQL-side aggregation + no summed ratio
python3 meta_rows_check.py    # meta_rows(): the five sourced ratios are impression-weighted
```

**The sweep alone was not enough, twice over.** Both blind spots were in the same place,
Ads Intelligence, and both let real defects live:

1. `discover_tables()` selects `... as fqn, row_count, bytes`, but the fake session answered
   `information_schema.tables` with only `table_schema`/`table_name`. `found["fqn"]` therefore
   never resolved, so `table_explorer` bailed before its body — and the three discovery tabs
   were never executed at all. Fixing the stub took Ads Intelligence from 22 SQL / 1 table /
   0 charts to 54 / 8 / 3.
2. `"Table to analyse"` is a selectbox whose first option is the placeholder `"—"`, and the
   stub returns `options[0]`. Even with a correct schema the body would have returned
   immediately. `run.py` now sets `CHOICES["Table to analyse"]` to a real table.

`ratio_guard.py` is written so it FAILS on the pre-fix code rather than reporting
"inconclusive". The first attempt only inspected emitted SQL, which the old pandas-side
implementation never produced — so it passed vacuously on the buggy version. It now asserts
two things: that weekly-trend SQL exists at all (client-side grouping of a fetched sample is
itself the defect), and that no ratio column is ever summed. Verified in both directions:
exit 1 against `HEAD~`, exit 0 against the fix.

**`meta_rows()` is not reachable from the sweep** — its call site sits behind a branch the
33 targets do not hit — which is why its naive `avg(ctr)` survived. `meta_rows_check.py`
drives it directly.

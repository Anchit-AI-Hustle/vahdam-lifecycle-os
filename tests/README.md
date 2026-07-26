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

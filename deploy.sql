-- ═══════════════════════════════════════════════════════════════════════════
-- READ THIS FIRST — you probably do NOT need this script.
--
-- Verified live in the account on 2026-07-26 with SHOW STREAMLITS IN ACCOUNT:
--   * VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA        DOES NOT EXIST.
--   * VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE        DOES NOT EXIST
--     (SHOW STAGES IN DATABASE VAHDAM_DB returns zero rows).
--   * The ONE app that actually runs is a Snowsight WORKSPACES app:
--       database USER$   schema PUBLIC   title "Ads Dashboard USA"
--       object   ST16DFD18C278CC8519B9BDD3318FC9CB3980ABC72
--       source   /ws/USER$/PUBLIC/DEFAULT$/Ads Dashboard/streamlit_app.py
--       url_id   6pijhfqfbcoleaokckpm
--
-- That is why running this script fails with
--   "Stage VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE does not exist or not authorized".
-- The stage was never created, and a Workspaces app does not use one: Snowsight
-- serves the app straight out of the Git-linked workspace folder.
--
-- >> TO DEPLOY, DO THIS (no SQL, no stage):
--     1. Snowsight -> Projects -> Workspaces -> "Ads Dashboard"
--     2. Pull  (brings this branch in, including .streamlit/config.toml and
--               data/ads/*.json -- both are required)
--     3. Run
--   The sidebar then shows the build id; if it shows an older one, the Pull did
--   not take. Nothing else is needed.
--
-- Everything below is the ALTERNATIVE stage-based flow, kept only for the case
-- where you deliberately want a shared account-level app object instead of a
-- personal workspace app. It needs CREATE STAGE + CREATE STREAMLIT on
-- VAHDAM_DB.MAPLEMONK, which CLAUDE_ROLE does not currently hold. Creating that
-- object would give the app a DIFFERENT URL from the one in use today, so do not
-- run it casually.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Stage for the app files (idempotent).
CREATE STAGE IF NOT EXISTS VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE
  DIRECTORY = (ENABLE = TRUE);

--    Upload streamlit_app.py + environment.yml + .streamlit/config.toml to the stage:
--    Snowsight -> Data -> VAHDAM_DB -> MAPLEMONK -> STREAMLIT_STAGE -> + Files
--    (Or via SnowSQL:
--       PUT file://streamlit_app.py @VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--       PUT file://environment.yml  @VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--       PUT file://.streamlit/config.toml @VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa/.streamlit AUTO_COMPRESS=FALSE OVERWRITE=TRUE; )
--
--    config.toml MUST land in the .streamlit/ SUBFOLDER of the app root, not
--    beside streamlit_app.py. In the wrong place it is silently ignored and the
--    app keeps inheriting Snowsight's dark theme: unreadable dropdowns, dark data
--    grids. Confirm with:
--       LIST @VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa;

-- 2) Create/refresh THE app object (same name = same URL, always).
CREATE OR REPLACE STREAMLIT VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA
  ROOT_LOCATION = '@VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = 'COMPUTE_WH'
  TITLE = 'Ads Dashboard USA';

-- GRANT USAGE ON STREAMLIT VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA TO ROLE <ANALYST_ROLE>;

-- 3) Retire the old duplicate app so nobody opens a stale build again.
--    (Run once; harmless if it is already gone.)
DROP STREAMLIT IF EXISTS VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS;

-- Sanity check — expect exactly one row for this app:
--   SHOW STREAMLITS IN DATABASE VAHDAM_DB;
--   DESCRIBE STREAMLIT VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA;  -- MAIN_FILE = streamlit_app.py

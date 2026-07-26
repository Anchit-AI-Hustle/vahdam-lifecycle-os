-- ═══════════════════════════════════════════════════════════════════════════
-- THE app this branch deploys to — there is exactly ONE:
--
--   VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA        (title: "Ads Dashboard USA")
--   https://app.snowflake.com/streamlit/uxdeihw/mo06981/#/apps/VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA
--
-- Do NOT create or use any other Streamlit object for this branch. The old
-- VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS ("VAHDAM Analytics") object is retired —
-- section 3 below drops it so a stale copy can never be opened by mistake.
--
-- Preferred deploy paths (in order):
--   1. CI — push to this branch; .github/workflows/deploy-sis.yml runs
--      `snow streamlit deploy --replace` against ADSDASHBOARDUSA.
--      Needs repo secrets: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PAT,
--      SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE.
--   2. Snowsight Git workspace — Pull this branch, then Deploy to the
--      EXISTING app VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA (replace).
--   3. This worksheet script — manual stage upload, sections 1-2 below.
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

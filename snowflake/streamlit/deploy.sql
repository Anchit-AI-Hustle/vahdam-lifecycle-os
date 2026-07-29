-- Deploy the VAHDAM Analytics app (Data Analysis + Ads) as Streamlit-in-Snowflake.
-- Run in a Snowflake worksheet (Snowsight) with a role that can read
-- VAHDAM_DB.MAPLEMONK/MAPLEMONK1 and DATON.RAW, and create objects in the target
-- schema. Replace <WAREHOUSE> with your warehouse (e.g. COMPUTE_WH).
--
-- The app authenticates via get_active_session() at runtime — no keys stored.

-- 1) A home for the app + a stage to hold its files.
CREATE SCHEMA IF NOT EXISTS VAHDAM_DB.APPS;
CREATE STAGE IF NOT EXISTS VAHDAM_DB.APPS.STREAMLIT_STAGE
  DIRECTORY = (ENABLE = TRUE);

-- 2) Upload the two files to the stage. Easiest path: Snowsight -> Data ->
--    VAHDAM_DB -> APPS -> STREAMLIT_STAGE -> + Files, and drop:
--       streamlit_app.py
--       environment.yml
--    (Or via SnowSQL:
--       PUT file://streamlit_app.py  @VAHDAM_DB.APPS.STREAMLIT_STAGE/vahdam_ads AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--       PUT file://environment.yml   @VAHDAM_DB.APPS.STREAMLIT_STAGE/vahdam_ads AUTO_COMPRESS=FALSE OVERWRITE=TRUE; )

-- 3) Create the Streamlit app object. Object name kept as VAHDAM_ADS_ANALYSIS so
--    the app URL stays stable even though it now covers Data Analysis + Ads.
CREATE OR REPLACE STREAMLIT VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS
  ROOT_LOCATION = '@VAHDAM_DB.APPS.STREAMLIT_STAGE/vahdam_ads'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = '<WAREHOUSE>'
  TITLE = 'VAHDAM Analytics';

-- 4) Grant usage to the analyst role(s) that should open it.
-- GRANT USAGE ON STREAMLIT VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS TO ROLE <ANALYST_ROLE>;

-- The app URL (opens in Snowsight):
--   https://app.snowflake.com/uxdeihw/mo06981/#/streamlit-apps/VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS
--
-- FASTER ALTERNATIVE (no staging): Snowsight -> Projects -> Streamlit ->
--   + Streamlit App -> pick VAHDAM_DB.APPS + a warehouse -> paste streamlit_app.py
--   -> add altair to the Packages picker -> Run. Snowflake mints the URL on save.

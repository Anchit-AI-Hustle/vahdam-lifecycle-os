-- ═══════════════════════════════════════════════════════════════════════════
-- VAHDAM tracker load pack — UGC Master + Target Sales + Retail TikTok ads.
-- Creates VAHDAM_DB.TRACKERS, an internal stage, the tables, and an HOURLY
-- auto-refresh TASK: whenever you upload a new version of a CSV to the stage
-- (same filename, overwrite), the tables rebuild within the hour — no manual
-- COPY needed. The SiS dashboard discovers these tables automatically (its
-- keyword search matches ugc/dpci/target_sales/retail).
--
-- One-time setup: run this whole script as a role that can create in VAHDAM_DB.
-- Upload/refresh data (Snowsight -> Data -> VAHDAM_DB -> TRACKERS ->
-- TRACKER_STAGE -> + Files), or:
--   PUT file://<path>/*.csv @VAHDAM_DB.TRACKERS.TRACKER_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--
-- For TRUE hands-off sync from the living Google-Sheet trackers, add them as
-- Daton (Saras) sources targeting VAHDAM_DB.TRACKERS — same pipeline pattern
-- as the existing Meta/TikTok tables; this stage+task pack needs no cloud
-- bucket and works today.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS VAHDAM_DB.TRACKERS;
USE SCHEMA VAHDAM_DB.TRACKERS;

CREATE FILE FORMAT IF NOT EXISTS TRACKER_CSV
  TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('', 'None', 'NA', 'n/a') EMPTY_FIELD_AS_NULL = TRUE;

CREATE STAGE IF NOT EXISTS TRACKER_STAGE FILE_FORMAT = TRACKER_CSV;

CREATE TABLE IF NOT EXISTS UGC_MASTER_TRACKER (
  platform VARCHAR,
  publish_date VARCHAR,
  month VARCHAR,
  url VARCHAR,
  creator_username VARCHAR,
  creator_name VARCHAR,
  content_bucket VARCHAR,
  duration_sec VARCHAR,
  organic_score VARCHAR,
  ad_recommended VARCHAR,
  ads_activated VARCHAR,
  ad_logic VARCHAR,
  recommendation_logic_fit VARCHAR,
  ad_name VARCHAR,
  url_2 VARCHAR,
  organic_views VARCHAR,
  organic_likes VARCHAR,
  organic_comments VARCHAR,
  organic_2_sec_view VARCHAR,
  organic_6_sec_view VARCHAR,
  organic_average_view_time VARCHAR,
  organic_engagement_rate VARCHAR,
  jb_cost VARCHAR,
  current_views VARCHAR,
  current_likes VARCHAR,
  current_comments VARCHAR,
  current_shares VARCHAR,
  avg_view_time_s VARCHAR,
  current_er VARCHAR,
  2_sec_view VARCHAR,
  6_sec_view VARCHAR,
  ran_ads VARCHAR,
  ad_cost VARCHAR,
  ad_impressions VARCHAR,
  ad_reach VARCHAR,
  ad_clicks VARCHAR,
  ad_ctr VARCHAR,
  ad_cpc VARCHAR,
  ad_spark_code VARCHAR,
  remark VARCHAR,
  jb_job_link VARCHAR,
  remark_2 VARCHAR,
  title_caption VARCHAR,
  hook VARCHAR,
  hook_type VARCHAR,
  content_summary VARCHAR,
  cta VARCHAR,
  original_script VARCHAR,
  col48 VARCHAR
);

CREATE TABLE IF NOT EXISTS UGC_TIKTOK_AD_PERFORMANCE (
  creator VARCHAR,
  content_bucket VARCHAR,
  organic_score VARCHAR,
  recommendation VARCHAR,
  total_spend VARCHAR,
  impressions VARCHAR,
  ad_clicks VARCHAR,
  ctr VARCHAR,
  cpc VARCHAR,
  org_views VARCHAR,
  org_6_sec VARCHAR,
  org_likes VARCHAR,
  org_comments VARCHAR,
  url VARCHAR
);

CREATE TABLE IF NOT EXISTS UGC_INSTAGRAM_AD_PERFORMANCE (
  creator VARCHAR,
  content_bucket VARCHAR,
  organic_score VARCHAR,
  recommendation VARCHAR,
  meta_spend VARCHAR,
  impressions VARCHAR,
  link_clicks VARCHAR,
  ctr VARCHAR,
  cpc VARCHAR,
  org_views VARCHAR,
  org_likes VARCHAR,
  org_comments VARCHAR,
  good_ad VARCHAR,
  logic_fit VARCHAR,
  url VARCHAR
);

CREATE TABLE IF NOT EXISTS TARGET_SALES_WEEKWISE (
  dpci VARCHAR,
  item_description VARCHAR,
  traited_store_count VARCHAR,
  week_label VARCHAR,
  field VARCHAR,
  value VARCHAR
);

CREATE TABLE IF NOT EXISTS TARGET_SALES_DAYWISE (
  dpci VARCHAR,
  item_description VARCHAR,
  traited_store_count VARCHAR,
  day_label VARCHAR,
  field VARCHAR,
  value VARCHAR
);

CREATE TABLE IF NOT EXISTS RETAIL_TIKTOK_ADS (
  ad_name VARCHAR,
  date VARCHAR,
  primary_status VARCHAR,
  secondary_status VARCHAR,
  ad_group_id VARCHAR,
  ad_group_name VARCHAR,
  ad_id VARCHAR,
  cost VARCHAR,
  cpc_destination VARCHAR,
  cpm VARCHAR,
  impressions VARCHAR,
  clicks_destination VARCHAR,
  ctr_destination VARCHAR,
  conversions VARCHAR,
  conversions_san VARCHAR,
  cost_per_conversion VARCHAR,
  cost_per_conversion_san VARCHAR,
  conversion_rate_cvr_clicks_san VARCHAR,
  conversion_rate_cvr VARCHAR,
  conversion_rate_cvr_san VARCHAR,
  results VARCHAR,
  cost_per_result VARCHAR,
  result_rate VARCHAR,
  qualified_conversion VARCHAR,
  cost_per_qualified_conversion VARCHAR,
  qualified_conversion_rate VARCHAR,
  secondary_source VARCHAR,
  primary_source VARCHAR,
  attribution_source VARCHAR,
  currency VARCHAR
);

-- Hourly auto-refresh: rebuilds every tracker table from whatever files are
-- currently in the stage. Uploading a newer file (same name) is all it takes.
CREATE OR REPLACE TASK REFRESH_TRACKERS
  WAREHOUSE = COMPUTE_WH
  SCHEDULE = '60 MINUTE'
AS
BEGIN
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.UGC_MASTER_TRACKER;
  COPY INTO VAHDAM_DB.TRACKERS.UGC_MASTER_TRACKER FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*ugc_master_tracker.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.UGC_TIKTOK_AD_PERFORMANCE;
  COPY INTO VAHDAM_DB.TRACKERS.UGC_TIKTOK_AD_PERFORMANCE FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*ugc_tiktok_ad_performance.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.UGC_INSTAGRAM_AD_PERFORMANCE;
  COPY INTO VAHDAM_DB.TRACKERS.UGC_INSTAGRAM_AD_PERFORMANCE FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*ugc_instagram_ad_performance.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.TARGET_SALES_WEEKWISE;
  COPY INTO VAHDAM_DB.TRACKERS.TARGET_SALES_WEEKWISE FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*target_sales_weekwise.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.TARGET_SALES_DAYWISE;
  COPY INTO VAHDAM_DB.TRACKERS.TARGET_SALES_DAYWISE FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*target_sales_daywise.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
  TRUNCATE TABLE VAHDAM_DB.TRACKERS.RETAIL_TIKTOK_ADS;
  COPY INTO VAHDAM_DB.TRACKERS.RETAIL_TIKTOK_ADS FROM @VAHDAM_DB.TRACKERS.TRACKER_STAGE
    PATTERN = '.*retail_tiktok_ads.csv' FILE_FORMAT = (FORMAT_NAME = 'VAHDAM_DB.TRACKERS.TRACKER_CSV')
    ON_ERROR = 'CONTINUE' FORCE = TRUE;
END;

ALTER TASK REFRESH_TRACKERS RESUME;

-- Load right now (first run, instead of waiting for the schedule):
EXECUTE TASK REFRESH_TRACKERS;

-- 263: Drop legacy launch_scores v3 dimension columns (superseded by v4 fields)

ALTER TABLE launch_scores DROP COLUMN IF EXISTS keyword_score;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS market_fit_score;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS landing_page_score;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS budget_score;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS content_score;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS keyword_analysis_data;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS market_analysis_data;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS landing_page_analysis_data;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS budget_analysis_data;
ALTER TABLE launch_scores DROP COLUMN IF EXISTS content_analysis_data;

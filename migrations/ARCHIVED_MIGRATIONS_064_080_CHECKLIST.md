# Migration Files Comprehensive Checklist (064-080)

## Summary Statistics
- **Total Files**: 16
- **Date Range**: 2025-12-09 to 2025-12-14
- **File Size Range**: 409 bytes - 21 KB

---

## Detailed Breakdown by File

### 064_prompt_upgrades_v3.2_v4.1.sql (21 KB)
**Date**: 2025-12-09

#### Schema Operations
- None

#### Prompt Operations (INSERT/UPDATE prompt_versions)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| product_analysis_single | v3.2 | INSERT OR REPLACE | 1 |
| brand_analysis_store | v3.2 | INSERT OR REPLACE | 1 |
| ad_creative_generation | v4.1 | INSERT OR REPLACE | 1 |
| ad_elements_headlines | v3.2 | INSERT OR REPLACE | 1 |
| ad_elements_descriptions | v3.2 | INSERT OR REPLACE | 1 |

#### Activation/Deactivation Operations
- UPDATE: product_analysis_single v3.1 → is_active = 0
- UPDATE: brand_analysis_store v3.1 → is_active = 0
- UPDATE: ad_creative_generation (all old versions) → is_active = 0

---

### 065_create_creative_tasks.sql (1.8 KB)
**Date**: 2025-12-09

#### Schema Operations
- CREATE TABLE: creative_tasks
  - Fields: id, user_id, offer_id, status, stage, progress, message, max_retries, target_rating, current_attempt, optimization_history, creative_id, result, error, created_at, started_at, completed_at, updated_at
  - Foreign Keys: users(id), offers(id), ad_creatives(id)

#### CREATE INDEX Operations
- idx_creative_tasks_user_status (user_id, status, created_at DESC)
- idx_creative_tasks_status_created (status, created_at)
- idx_creative_tasks_offer_id (offer_id)
- idx_creative_tasks_updated (updated_at DESC)

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- None

---

### 066_prompt_updates_v3.2_v4.2.sql (17 KB)
**Date**: 2025-12-10

#### Schema Operations
- None

#### Prompt Operations (INSERT/UPDATE prompt_versions)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| launch_score_evaluation | v3.2 | INSERT OR IGNORE | 1 |
| ad_creative_generation | v4.2 | INSERT OR IGNORE | 1 |

#### Activation/Deactivation Operations
- UPDATE: ad_creative_generation (v != v3.2) → is_active = 0
- UPDATE: ad_elements_descriptions v3.2 → is_active = 1
- UPDATE: ad_elements_headlines v3.2 → is_active = 1
- UPDATE: launch_score_evaluation (v != v3.2) → is_active = 0
- UPDATE: ad_creative_generation v4.2 → is_active = 1

#### Category Unification
- UPDATE: ad_creative_generation category → "广告创意生成"

---

### 067_add_google_ads_account_status.sql (654 B)
**Date**: 2025-12-10

#### Schema Operations
- ALTER TABLE: google_ads_accounts ADD COLUMN status (TEXT DEFAULT 'ENABLED')

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- UPDATE: google_ads_accounts (status IS NULL) SET status = 'ENABLED'

---

### 068_add_ad_strength_data.sql (1.0 KB)
**Date**: 2025-12-10

#### Schema Operations
- ALTER TABLE: ad_creatives ADD COLUMN ad_strength_data (TEXT DEFAULT NULL)

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- None

---

### 069_integrated_prompt_v4.4_complete.sql (15 KB)
**Date**: 2025-12-10

#### Schema Operations
- ALTER TABLE: scraped_products ADD COLUMN sales_volume (TEXT)
- ALTER TABLE: scraped_products ADD COLUMN discount (TEXT)
- ALTER TABLE: scraped_products ADD COLUMN delivery_info (TEXT)
- CREATE INDEX: idx_scraped_products_sales_volume (offer_id, sales_volume)

#### Prompt Operations (INSERT OR IGNORE)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| ad_creative_generation | v4.4 | INSERT OR IGNORE | 1 |

#### Activation/Deactivation Operations
- UPDATE: ad_creative_generation (v != v4.4) → is_active = 0
- UPDATE: ad_creative_generation v4.4 → is_active = 1
- UPDATE: ad_creative_generation, ad_elements_descriptions, ad_elements_headlines category → "广告创意生成"

---

### 070_create_upload_and_audit_tables.sql (3.8 KB)
**Date**: 2025-12-10

#### Schema Operations
- CREATE TABLE: upload_records
  - Fields: id, user_id, batch_id, file_name, file_size, uploaded_at, valid_count, processed_count, skipped_count, failed_count, success_rate, status, metadata, created_at, updated_at, completed_at
  - Foreign Keys: users(id), batch_tasks(id)

- CREATE TABLE: audit_logs
  - Fields: id (AUTOINCREMENT), user_id, event_type, ip_address, user_agent, details, created_at
  - Foreign Keys: users(id) ON DELETE SET NULL

#### CREATE INDEX Operations (upload_records)
- idx_upload_records_user_uploaded (user_id, uploaded_at DESC)
- idx_upload_records_batch (batch_id)
- idx_upload_records_status (status, uploaded_at DESC)

#### CREATE INDEX Operations (audit_logs)
- idx_audit_logs_user_id (user_id)
- idx_audit_logs_event_type (event_type)
- idx_audit_logs_created_at (created_at)
- idx_audit_logs_ip_address (ip_address)

#### CREATE TRIGGER Operations
- update_upload_records_updated_at (AFTER UPDATE on upload_records)
- update_upload_records_success_rate (AFTER UPDATE OF processed_count, valid_count on upload_records)

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- None

---

### 071_update_prompts_v3.3_v4.5.sql (17 KB)
**Date**: 2025-12-11

#### Schema Operations
- None

#### Prompt Operations (INSERT)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| brand_analysis_store | v3.3 | INSERT | 1 |
| ad_creative_generation | v4.5 | INSERT | 1 |

#### Activation/Deactivation Operations
- UPDATE: brand_analysis_store (is_active = 1) → is_active = 0
- DELETE: brand_analysis_store v3.3 (idempotent cleanup)
- UPDATE: ad_creative_generation (is_active = 1) → is_active = 0
- DELETE: ad_creative_generation v4.5 (idempotent cleanup)
- SELECT: Verification query to check active prompts

#### Prompt Verification Query
- SELECT prompt_id, version, name, is_active, created_at FROM prompt_versions WHERE prompt_id IN ('brand_analysis_store', 'ad_creative_generation') ORDER BY prompt_id, created_at DESC

---

### 072_add_product_name_to_offers.sql (409 B)
**Date**: 2025-12-11

#### Schema Operations
- ALTER TABLE: offers ADD COLUMN product_name (TEXT)

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- None

---

### 073_prompt_ctr_optimization_v4.6.sql (21 KB)
**Date**: 2025-12-12

#### Schema Operations
- None

#### Prompt Operations (INSERT)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| ad_elements_headlines | v3.3 | INSERT | 1 |
| ad_elements_descriptions | v3.3 | INSERT | 1 |
| ad_creative_generation | v4.6 | INSERT | 1 |

#### Activation/Deactivation Operations
- UPDATE: ad_elements_headlines (is_active = 1) → is_active = 0
- UPDATE: ad_elements_descriptions (is_active = 1) → is_active = 0
- UPDATE: ad_creative_generation (is_active = 1) → is_active = 0

---

### 074_prompts_v3.2_enhanced_data_extraction.sql (9.1 KB)
**Date**: 2025-12-13

#### Schema Operations
- None

#### Prompt Operations (UPDATE existing records)
| Prompt ID | Current Version | New Version | Change |
|-----------|-----------------|-------------|--------|
| review_analysis | (current) | v3.2 | Updated with quantitativeHighlights and competitorMentions |
| competitor_analysis | (current) | v3.2 | Updated with competitorWeaknesses and adCopy fields |

#### Activation/Deactivation Operations
- None (updates existing records, not creating new ones)

---

### 075_add_store_highlights_synthesis_prompt.sql (1.4 KB)
**Date**: 2025-12-13

#### Schema Operations
- None

#### Prompt Operations (INSERT)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| store_highlights_synthesis | v1.0 | INSERT | 1 |

#### Activation/Deactivation Operations
- None

---

### 076_activate_ctr_optimization_prompts.sql (1.0 KB)
**Date**: 2025-12-13

#### Schema Operations
- None

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- UPDATE: ad_creative_generation (all versions) → is_active = 0
- UPDATE: ad_elements_headlines (all versions) → is_active = 0
- UPDATE: ad_elements_descriptions (all versions) → is_active = 0
- UPDATE: ad_creative_generation v4.6 → is_active = 1
- UPDATE: ad_elements_headlines v3.3 → is_active = 1
- UPDATE: ad_elements_descriptions v3.3 → is_active = 1

#### Verification Query
- SELECT prompt_id, name, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions') ORDER BY prompt_id, version DESC

---

### 077_launch_score_v4_keyword_fix_display_path.sql (17 KB)
**Date**: 2025-12-13

#### Schema Operations
- ALTER TABLE: launch_scores ADD COLUMN launch_viability_score (INTEGER DEFAULT 0)
- ALTER TABLE: launch_scores ADD COLUMN ad_quality_score (INTEGER DEFAULT 0)
- ALTER TABLE: launch_scores ADD COLUMN keyword_strategy_score (INTEGER DEFAULT 0)
- ALTER TABLE: launch_scores ADD COLUMN basic_config_score (INTEGER DEFAULT 0)
- ALTER TABLE: launch_scores ADD COLUMN launch_viability_data (TEXT)
- ALTER TABLE: launch_scores ADD COLUMN ad_quality_data (TEXT)
- ALTER TABLE: launch_scores ADD COLUMN keyword_strategy_data (TEXT)
- ALTER TABLE: launch_scores ADD COLUMN basic_config_data (TEXT)
- ALTER TABLE: ad_creatives ADD COLUMN path1 (TEXT DEFAULT NULL)
- ALTER TABLE: ad_creatives ADD COLUMN path2 (TEXT DEFAULT NULL)

#### Prompt Operations (INSERT)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| keywords_generation | v3.2 | INSERT | 1 |
| ad_creative_generation | v4.7 | INSERT | 1 |

#### Activation/Deactivation Operations
- UPDATE: keywords_generation (is_active = 1) → is_active = 0
- UPDATE: ad_creative_generation (is_active = 1) → is_active = 0

#### Verification Queries
- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('keywords_generation', 'ad_creative_generation') ORDER BY prompt_id, version
- SELECT name FROM pragma_table_info('launch_scores') WHERE name LIKE '%_score' OR name LIKE '%_data'
- SELECT name FROM pragma_table_info('ad_creatives') WHERE name IN ('path1', 'path2')

---

### 079_prompt_keyword_embedding_v4.8.sql (11 KB)
**Date**: 2025-12-14

#### Schema Operations
- None

#### Prompt Operations (INSERT)
| Prompt ID | Version | Operation | is_active |
|-----------|---------|-----------|-----------|
| ad_creative_generation | v4.8 | INSERT | 0 (not activated yet) |

#### Activation/Deactivation Operations
- None (v4.8 inserted with is_active = 0 pending testing)

#### Verification Query
- SELECT id, prompt_id, name, version, is_active FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' ORDER BY version DESC LIMIT 3

---

### 080_activate_ad_creative_v4.8.sql (550 B)
**Date**: 2025-12-14

#### Schema Operations
- None

#### Prompt Operations
- None

#### Activation/Deactivation Operations
- UPDATE: ad_creative_generation (is_active = 1) → is_active = 0 (deactivate all)
- UPDATE: ad_creative_generation v4.8 → is_active = 1 (activate v4.8)

#### Verification Query
- SELECT id, name, version, is_active FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' ORDER BY version DESC LIMIT 3

---

## Summary Table: All Prompt Operations

| File | Prompt ID | Version | Operation | is_active |
|------|-----------|---------|-----------|-----------|
| 064 | product_analysis_single | v3.2 | INSERT OR REPLACE | 1 |
| 064 | brand_analysis_store | v3.2 | INSERT OR REPLACE | 1 |
| 064 | ad_creative_generation | v4.1 | INSERT OR REPLACE | 1 |
| 064 | ad_elements_headlines | v3.2 | INSERT OR REPLACE | 1 |
| 064 | ad_elements_descriptions | v3.2 | INSERT OR REPLACE | 1 |
| 066 | launch_score_evaluation | v3.2 | INSERT OR IGNORE | 1 |
| 066 | ad_creative_generation | v4.2 | INSERT OR IGNORE | 1 |
| 069 | ad_creative_generation | v4.4 | INSERT OR IGNORE | 1 |
| 071 | brand_analysis_store | v3.3 | INSERT | 1 |
| 071 | ad_creative_generation | v4.5 | INSERT | 1 |
| 073 | ad_elements_headlines | v3.3 | INSERT | 1 |
| 073 | ad_elements_descriptions | v3.3 | INSERT | 1 |
| 073 | ad_creative_generation | v4.6 | INSERT | 1 |
| 075 | store_highlights_synthesis | v1.0 | INSERT | 1 |
| 077 | keywords_generation | v3.2 | INSERT | 1 |
| 077 | ad_creative_generation | v4.7 | INSERT | 1 |
| 079 | ad_creative_generation | v4.8 | INSERT | 0 |

---

## Summary Table: All Schema Operations

| File | Operation Type | Table | Column/Constraint | Details |
|------|----------------|-------|-------------------|---------|
| 065 | CREATE TABLE | creative_tasks | Full table | 17 columns, 4 indexes, FK to users/offers/ad_creatives |
| 067 | ALTER TABLE | google_ads_accounts | status (TEXT) | DEFAULT 'ENABLED' |
| 068 | ALTER TABLE | ad_creatives | ad_strength_data (TEXT) | DEFAULT NULL |
| 069 | ALTER TABLE | scraped_products | sales_volume (TEXT) | None |
| 069 | ALTER TABLE | scraped_products | discount (TEXT) | None |
| 069 | ALTER TABLE | scraped_products | delivery_info (TEXT) | None |
| 069 | CREATE INDEX | scraped_products | idx_scraped_products_sales_volume | (offer_id, sales_volume) |
| 070 | CREATE TABLE | upload_records | Full table | 16 columns, 3 indexes, 2 triggers, FK to users/batch_tasks |
| 070 | CREATE TABLE | audit_logs | Full table | 7 columns, 4 indexes, FK to users |
| 070 | CREATE TRIGGER | upload_records | update_upload_records_updated_at | AFTER UPDATE |
| 070 | CREATE TRIGGER | upload_records | update_upload_records_success_rate | AFTER UPDATE OF processed_count, valid_count |
| 072 | ALTER TABLE | offers | product_name (TEXT) | None |
| 077 | ALTER TABLE | launch_scores | launch_viability_score (INTEGER) | DEFAULT 0 |
| 077 | ALTER TABLE | launch_scores | ad_quality_score (INTEGER) | DEFAULT 0 |
| 077 | ALTER TABLE | launch_scores | keyword_strategy_score (INTEGER) | DEFAULT 0 |
| 077 | ALTER TABLE | launch_scores | basic_config_score (INTEGER) | DEFAULT 0 |
| 077 | ALTER TABLE | launch_scores | launch_viability_data (TEXT) | None |
| 077 | ALTER TABLE | launch_scores | ad_quality_data (TEXT) | None |
| 077 | ALTER TABLE | launch_scores | keyword_strategy_data (TEXT) | None |
| 077 | ALTER TABLE | launch_scores | basic_config_data (TEXT) | None |
| 077 | ALTER TABLE | ad_creatives | path1 (TEXT) | DEFAULT NULL |
| 077 | ALTER TABLE | ad_creatives | path2 (TEXT) | DEFAULT NULL |

---

## Key Findings for Consolidation Verification

### Prompt Versions Created
- **Total Unique Prompts**: 10
- **Total Versions**: 17
- **Ad Creative Generation Versions**: v4.1, v4.2, v4.4, v4.5, v4.6, v4.7, v4.8
- **Other Key Versions**:
  - launch_score_evaluation: v3.2
  - keywords_generation: v3.2
  - store_highlights_synthesis: v1.0
  - brand_analysis_store: v3.2, v3.3
  - ad_elements_headlines: v3.2, v3.3
  - ad_elements_descriptions: v3.2, v3.3

### Schema Tables Created
- creative_tasks (065)
- upload_records (070)
- audit_logs (070)

### Schema Tables Modified
- google_ads_accounts (067)
- ad_creatives (068, 077)
- scraped_products (069)
- offers (072)
- launch_scores (077)

### Indexes Created
- 4 on creative_tasks
- 3 on upload_records
- 4 on audit_logs
- 1 on scraped_products

### Triggers Created
- 2 on upload_records (update_upload_records_updated_at, update_upload_records_success_rate)

### Critical Activation Timeline
1. 064: Activates v3.2 versions (product analysis, brand analysis, ad elements)
2. 064: Activates ad_creative_generation v4.1
3. 066: Activates ad_creative_generation v4.2 (deactivates v4.1)
4. 069: Activates ad_creative_generation v4.4 (deactivates v4.2)
5. 071: Activates ad_creative_generation v4.5 (deactivates v4.4)
6. 073: Activates ad_creative_generation v4.6 (deactivates v4.5)
7. 076: Activates ad_creative_generation v4.6, ad_elements_headlines v3.3, ad_elements_descriptions v3.3
8. 077: Activates ad_creative_generation v4.7 (deactivates v4.6)
9. 079: Creates ad_creative_generation v4.8 (NOT activated)
10. 080: Activates ad_creative_generation v4.8 (deactivates v4.7)


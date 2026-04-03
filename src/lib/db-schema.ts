/**
 * 数据库 Schema 定义 - 单一权威来源
 *
 * 所有表结构在此定义，自动生成 SQLite 和 PostgreSQL 的初始化脚本
 * 版本: 2.0.0
 * 最后更新: 2026-01-30
 * 表数量: 41 (added brand_core_keywords, brand_core_keyword_daily)
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface ColumnDef {
  name: string
  type: 'INTEGER' | 'TEXT' | 'REAL' | 'BOOLEAN' | 'TIMESTAMP' | 'DATE' | 'BIGINT' | 'JSON'
  primaryKey?: boolean
  autoIncrement?: boolean
  notNull?: boolean
  unique?: boolean
  default?: string | number | boolean | null
  check?: string
  references?: { table: string; column: string; onDelete?: string }
  generated?: { expression: string; stored: boolean } // PostgreSQL only
}

export interface IndexDef {
  name: string
  columns: string[]
  unique?: boolean
}

export interface TableDef {
  name: string
  columns: ColumnDef[]
  indexes?: IndexDef[]
  uniqueConstraints?: string[][]
}

// ============================================================================
// 表定义
// ============================================================================

export const TABLES: TableDef[] = [
  // -------------------------------------------------------------------------
  // 1. users - 用户信息
  // -------------------------------------------------------------------------
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'username', type: 'TEXT', unique: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'password_hash', type: 'TEXT' },
      { name: 'display_name', type: 'TEXT' },
      { name: 'google_id', type: 'TEXT', unique: true },
      { name: 'profile_picture', type: 'TEXT' },
      { name: 'role', type: 'TEXT', notNull: true, default: 'user' },
      { name: 'package_type', type: 'TEXT', notNull: true, default: 'trial' },
      { name: 'package_expires_at', type: 'TIMESTAMP' },
      { name: 'must_change_password', type: 'BOOLEAN', notNull: true, default: true },
      { name: 'is_active', type: 'BOOLEAN', notNull: true, default: true },
      { name: 'failed_login_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'locked_until', type: 'TIMESTAMP' },
      { name: 'last_failed_login', type: 'TIMESTAMP' },
      { name: 'last_login_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_users_email', columns: ['email'] },
      { name: 'idx_users_google_id', columns: ['google_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. google_ads_accounts - Google Ads 账户关联
  // -------------------------------------------------------------------------
  {
    name: 'google_ads_accounts',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'customer_id', type: 'TEXT', notNull: true },
      { name: 'account_name', type: 'TEXT' },
      { name: 'currency', type: 'TEXT', notNull: true, default: 'CNY' },
      { name: 'timezone', type: 'TEXT', notNull: true, default: 'Asia/Shanghai' },
      { name: 'is_manager_account', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'is_active', type: 'BOOLEAN', notNull: true, default: true },
      { name: 'status', type: 'TEXT', default: 'ENABLED' },  // Google Ads账户状态: ENABLED, CANCELED, SUSPENDED, CLOSED, UNKNOWN
      { name: 'parent_mcc_id', type: 'TEXT' },  // 父级MCC账户ID（用于账户层级关系）
      { name: 'test_account', type: 'BOOLEAN', notNull: true, default: false },  // 标识是否为测试账户
      // Identity Verification（广告主验证）：用于识别“验证导致暂停但 customer.status 仍为 ENABLED”的情况
      { name: 'identity_verification_program_status', type: 'TEXT' },
      { name: 'identity_verification_start_deadline_time', type: 'TEXT' },
      { name: 'identity_verification_completion_deadline_time', type: 'TEXT' },
      { name: 'identity_verification_overdue', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'identity_verification_checked_at', type: 'TEXT' },
      { name: 'access_token', type: 'TEXT' },
      { name: 'refresh_token', type: 'TEXT' },
      { name: 'token_expires_at', type: 'TIMESTAMP' },
      { name: 'last_sync_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    uniqueConstraints: [['user_id', 'customer_id']],
  },

  // -------------------------------------------------------------------------
  // 3. offers - Offer 产品信息
  // -------------------------------------------------------------------------
  {
    name: 'offers',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'url', type: 'TEXT', notNull: true },
      { name: 'brand', type: 'TEXT', notNull: true },
      { name: 'product_name', type: 'TEXT' },
      { name: 'category', type: 'TEXT' },
      { name: 'target_country', type: 'TEXT', notNull: true },
      { name: 'target_language', type: 'TEXT' },
      { name: 'offer_name', type: 'TEXT', unique: true },
      { name: 'affiliate_link', type: 'TEXT' },
      { name: 'store_product_links', type: 'TEXT' },  // 店铺模式：最多3个单品推广链接（JSON）
      { name: 'brand_description', type: 'TEXT' },
      { name: 'unique_selling_points', type: 'TEXT' },
      { name: 'product_highlights', type: 'TEXT' },
      { name: 'target_audience', type: 'TEXT' },
      { name: 'final_url', type: 'TEXT' },
      { name: 'final_url_suffix', type: 'TEXT' },
      { name: 'product_price', type: 'TEXT' },
      { name: 'commission_payout', type: 'TEXT' },
      { name: 'commission_type', type: 'TEXT' },  // percent | amount
      { name: 'commission_value', type: 'TEXT' },  // numeric string
      { name: 'commission_currency', type: 'TEXT' },  // amount模式货币代码
      { name: 'scrape_status', type: 'TEXT', notNull: true, default: 'pending' },
      { name: 'scrape_error', type: 'TEXT' },
      { name: 'scraped_at', type: 'TIMESTAMP' },
      { name: 'is_active', type: 'BOOLEAN', notNull: true, default: true },
      { name: 'industry_code', type: 'TEXT' },
      { name: 'review_analysis', type: 'TEXT' },
      { name: 'competitor_analysis', type: 'TEXT' },
      { name: 'visual_analysis', type: 'TEXT' },
      { name: 'extracted_keywords', type: 'TEXT' },
      { name: 'extracted_headlines', type: 'TEXT' },
      { name: 'extracted_descriptions', type: 'TEXT' },
      { name: 'extraction_metadata', type: 'TEXT' },
      { name: 'extracted_at', type: 'TIMESTAMP' },
      // P0 优化字段 - 增强提取数据
      { name: 'enhanced_keywords', type: 'TEXT' },  // 增强的关键词（JSON格式）
      { name: 'enhanced_product_info', type: 'TEXT' },  // 增强的产品信息（JSON格式）
      { name: 'enhanced_review_analysis', type: 'TEXT' },  // 增强的评论分析（JSON格式）
      { name: 'extraction_quality_score', type: 'INTEGER' },  // 提取质量评分（0-100）
      { name: 'extraction_enhanced_at', type: 'TIMESTAMP' },  // 增强提取时间
      // P1 优化字段 - 增强标题和描述
      { name: 'enhanced_headlines', type: 'TEXT' },  // 增强的标题（JSON格式）
      { name: 'enhanced_descriptions', type: 'TEXT' },  // 增强的描述（JSON格式）
      // P2/P3 优化字段 - 本地化和品牌分析
      { name: 'localization_adapt', type: 'TEXT' },  // 本地化适配数据（JSON格式）
      { name: 'brand_analysis', type: 'TEXT' },  // 品牌分析数据（JSON格式）
      // 原有字段
      { name: 'pricing', type: 'TEXT' },  // 产品定价信息（JSON格式）
      { name: 'promotions', type: 'TEXT' },  // 促销活动信息（JSON格式）
      { name: 'scraped_data', type: 'TEXT' },  // 爬取的原始数据（JSON格式）
      { name: 'product_currency', type: 'TEXT', default: 'USD' },  // 产品货币单位
      // Database v2.0: AI增强字段 - 用于AI分析的结构化数据
      { name: 'ai_reviews', type: 'TEXT' },  // AI处理的评论数据（JSON格式）
      { name: 'ai_competitive_edges', type: 'TEXT' },  // AI分析的竞争优势（JSON格式）
      { name: 'ai_keywords', type: 'TEXT' },  // AI提取的关键词（JSON格式）
      { name: 'is_deleted', type: 'BOOLEAN', notNull: true, default: false },  // 软删除标记
      { name: 'deleted_at', type: 'TIMESTAMP' },  // 删除时间
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_offers_user_id', columns: ['user_id'] },
      { name: 'idx_offers_offer_name', columns: ['offer_name'] },
      { name: 'idx_offers_is_deleted', columns: ['is_deleted'] },
      { name: 'idx_offers_deleted_at', columns: ['deleted_at'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 4. ad_creatives - AI 生成的广告创意
  // -------------------------------------------------------------------------
  {
    name: 'ad_creatives',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'headlines', type: 'TEXT', notNull: true },
      { name: 'descriptions', type: 'TEXT', notNull: true },
      { name: 'keywords', type: 'TEXT' },
      { name: 'callouts', type: 'TEXT' },
      { name: 'sitelinks', type: 'TEXT' },
      { name: 'final_url', type: 'TEXT', notNull: true },
      { name: 'final_url_suffix', type: 'TEXT' },
      { name: 'score', type: 'REAL' },
      { name: 'score_breakdown', type: 'TEXT' },
      { name: 'score_explanation', type: 'TEXT' },
      { name: 'ad_strength', type: 'TEXT', default: 'UNKNOWN' },
      { name: 'generation_round', type: 'INTEGER', default: 1 },
      { name: 'theme', type: 'TEXT' },
      { name: 'ai_model', type: 'TEXT' },
      { name: 'is_selected', type: 'BOOLEAN', default: false },
      { name: 'ab_test_variant_id', type: 'INTEGER' },
      { name: 'google_campaign_id', type: 'TEXT' },  // Google Ads Campaign ID（用于性能数据同步）
      { name: 'industry_code', type: 'TEXT' },  // 行业分类代码（如ecom_fashion, saas等）
      { name: 'orientation', type: 'TEXT' },  // 创意导向类型（brand/product/promotion）
      { name: 'brand', type: 'TEXT' },  // 品牌名称（从offer复制用于评分）
      { name: 'url', type: 'TEXT' },  // 产品URL或落地页URL
      { name: 'path1', type: 'TEXT' },  // RSA Display URL路径1，如"Cameras"，最多15字符
      { name: 'path2', type: 'TEXT' },  // RSA Display URL路径2，如"Wireless"，最多15字符
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ad_creatives_offer_id', columns: ['offer_id'] },
      { name: 'idx_ad_creatives_user_id', columns: ['user_id'] },
      { name: 'idx_ad_creatives_is_selected', columns: ['is_selected'] },
      { name: 'idx_ad_creatives_ab_test_variant', columns: ['ab_test_variant_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 5. campaigns - 广告系列
  // -------------------------------------------------------------------------
  {
    name: 'campaigns',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      // 🔧 修复(2025-12-25): google_ads_account_id 改为可空
      // 删除Ads账号时，Campaign应保留（历史数据），只将account_id设为NULL
      { name: 'google_ads_account_id', type: 'INTEGER', references: { table: 'google_ads_accounts', column: 'id', onDelete: 'SET NULL' } },
      { name: 'campaign_id', type: 'TEXT', unique: true },
      { name: 'campaign_name', type: 'TEXT', notNull: true },
      { name: 'budget_amount', type: 'REAL', notNull: true },
      { name: 'budget_type', type: 'TEXT', notNull: true, default: 'DAILY' },
      { name: 'target_cpa', type: 'REAL' },
      { name: 'max_cpc', type: 'REAL' },
      { name: 'status', type: 'TEXT', notNull: true, default: 'PAUSED' },
      { name: 'start_date', type: 'TIMESTAMP' },
      { name: 'end_date', type: 'TIMESTAMP' },
      { name: 'creation_status', type: 'TEXT', notNull: true, default: 'draft' },
      { name: 'creation_error', type: 'TEXT' },
      { name: 'removed_reason', type: 'TEXT' },
      { name: 'last_sync_at', type: 'TIMESTAMP' },
      { name: 'published_at', type: 'TIMESTAMP' }, // 成功发布到Ads账号的时间（用于“投放日期”展示）
      { name: 'ad_creative_id', type: 'INTEGER', references: { table: 'ad_creatives', column: 'id', onDelete: 'SET NULL' } },
      { name: 'google_campaign_id', type: 'TEXT' },
      { name: 'google_ad_group_id', type: 'TEXT' },
      { name: 'google_ad_id', type: 'TEXT' },
      { name: 'campaign_config', type: 'TEXT' },
      { name: 'pause_old_campaigns', type: 'BOOLEAN' },
      { name: 'is_test_variant', type: 'BOOLEAN', default: false },
      { name: 'ab_test_id', type: 'INTEGER' },
      { name: 'traffic_allocation', type: 'REAL', default: 1.0, check: 'traffic_allocation >= 0 AND traffic_allocation <= 1' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_campaigns_user_id', columns: ['user_id'] },
      { name: 'idx_campaigns_offer_id', columns: ['offer_id'] },
      { name: 'idx_campaigns_is_test_variant', columns: ['is_test_variant'] },
      { name: 'idx_campaigns_ab_test_id', columns: ['ab_test_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 6. ad_groups - 广告组
  // -------------------------------------------------------------------------
  {
    name: 'ad_groups',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'campaign_id', type: 'INTEGER', notNull: true, references: { table: 'campaigns', column: 'id', onDelete: 'CASCADE' } },
      { name: 'ad_group_id', type: 'TEXT', unique: true },
      { name: 'ad_group_name', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', notNull: true, default: 'PAUSED' },
      { name: 'cpc_bid_micros', type: 'BIGINT' },
      { name: 'creation_status', type: 'TEXT', notNull: true, default: 'draft' },
      { name: 'creation_error', type: 'TEXT' },
      { name: 'last_sync_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ad_groups_user_id', columns: ['user_id'] },
      { name: 'idx_ad_groups_campaign_id', columns: ['campaign_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 7. keywords - 关键词
  // -------------------------------------------------------------------------
  {
    name: 'keywords',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'ad_group_id', type: 'INTEGER', notNull: true, references: { table: 'ad_groups', column: 'id', onDelete: 'CASCADE' } },
      { name: 'keyword_id', type: 'TEXT', unique: true },
      { name: 'keyword_text', type: 'TEXT', notNull: true },
      { name: 'match_type', type: 'TEXT', notNull: true, default: 'PHRASE' },
      { name: 'status', type: 'TEXT', notNull: true, default: 'PAUSED' },
      { name: 'cpc_bid_micros', type: 'BIGINT' },
      { name: 'final_url', type: 'TEXT' },
      { name: 'is_negative', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'quality_score', type: 'INTEGER' },
      { name: 'ai_generated', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'generation_source', type: 'TEXT' },
      { name: 'creation_status', type: 'TEXT', notNull: true, default: 'draft' },
      { name: 'creation_error', type: 'TEXT' },
      { name: 'last_sync_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_keywords_user_id', columns: ['user_id'] },
      { name: 'idx_keywords_ad_group_id', columns: ['ad_group_id'] },
      { name: 'idx_keywords_status', columns: ['status'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 8. global_keywords - 全局关键词库
  // -------------------------------------------------------------------------
  {
    name: 'global_keywords',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'keyword', type: 'TEXT', notNull: true },  // 🔧 修复(2025-12-22): 从 keyword_text 改为 keyword (migration 075)
      { name: 'country', type: 'TEXT', notNull: true, default: 'US' },
      { name: 'language', type: 'TEXT', notNull: true, default: 'en' },
      { name: 'search_volume', type: 'INTEGER', default: 0 },
      { name: 'competition_level', type: 'TEXT' },
      { name: 'avg_cpc_micros', type: 'INTEGER' },
      { name: 'cached_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_global_keywords_lookup', columns: ['keyword', 'country', 'language'], unique: true },
      { name: 'idx_global_keywords_cached_at', columns: ['cached_at'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 9. launch_scores - Launch Score 评分
  // -------------------------------------------------------------------------
  {
    name: 'launch_scores',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'total_score', type: 'INTEGER', notNull: true },
      { name: 'keyword_score', type: 'INTEGER', notNull: true },
      { name: 'market_fit_score', type: 'INTEGER', notNull: true },
      { name: 'landing_page_score', type: 'INTEGER', notNull: true },
      { name: 'budget_score', type: 'INTEGER', notNull: true },
      { name: 'content_score', type: 'INTEGER', notNull: true },
      { name: 'keyword_analysis_data', type: 'TEXT' },
      { name: 'market_analysis_data', type: 'TEXT' },
      { name: 'landing_page_analysis_data', type: 'TEXT' },
      { name: 'budget_analysis_data', type: 'TEXT' },
      { name: 'content_analysis_data', type: 'TEXT' },
      { name: 'recommendations', type: 'TEXT' },
      { name: 'calculated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 10. weekly_recommendations - 每周优化建议
  // -------------------------------------------------------------------------
  {
    name: 'weekly_recommendations',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      // 🔧 修复(2025-12-25): 删除Ads账号时保留历史数据，设为NULL
      { name: 'google_ads_account_id', type: 'INTEGER', references: { table: 'google_ads_accounts', column: 'id', onDelete: 'SET NULL' } },
      { name: 'recommendation_type', type: 'TEXT', notNull: true },
      { name: 'recommendation_data', type: 'TEXT', notNull: true },
      { name: 'priority', type: 'TEXT', notNull: true, default: 'MEDIUM' },
      { name: 'status', type: 'TEXT', notNull: true, default: 'pending' },
      { name: 'applied_at', type: 'TIMESTAMP' },
      { name: 'week_start_date', type: 'TIMESTAMP', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 11. optimization_recommendations - 优化建议
  // -------------------------------------------------------------------------
  {
    name: 'optimization_recommendations',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      // 🔧 修复(2025-12-25): 删除Ads账号时保留历史数据，设为NULL
      { name: 'google_ads_account_id', type: 'INTEGER', references: { table: 'google_ads_accounts', column: 'id', onDelete: 'SET NULL' } },
      { name: 'recommendation_id', type: 'TEXT', notNull: true, unique: true },
      { name: 'recommendation_type', type: 'TEXT', notNull: true },
      { name: 'impact', type: 'TEXT' },
      { name: 'recommendation_data', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', default: 'pending' },
      { name: 'applied_at', type: 'TIMESTAMP' },
      { name: 'dismissed_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 12. optimization_tasks - 优化任务
  // -------------------------------------------------------------------------
  {
    name: 'optimization_tasks',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'task_type', type: 'TEXT', notNull: true },
      { name: 'priority', type: 'TEXT', notNull: true, default: 'MEDIUM' },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'description', type: 'TEXT', notNull: true },
      { name: 'related_entity_type', type: 'TEXT' },
      { name: 'related_entity_id', type: 'INTEGER' },
      { name: 'status', type: 'TEXT', notNull: true, default: 'pending' },
      { name: 'completed_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 13. campaign_performance - 广告系列性能数据
  // -------------------------------------------------------------------------
  {
    name: 'campaign_performance',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'campaign_id', type: 'INTEGER', notNull: true, references: { table: 'campaigns', column: 'id', onDelete: 'CASCADE' } },
      { name: 'date', type: 'DATE', notNull: true },
      { name: 'impressions', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'clicks', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'conversions', type: 'REAL', notNull: true, default: 0 },
      { name: 'cost', type: 'REAL', notNull: true, default: 0 },
      { name: 'ctr', type: 'REAL' },
      { name: 'cpc', type: 'REAL' },
      { name: 'cpa', type: 'REAL' },
      { name: 'conversion_rate', type: 'REAL' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_performance_campaign_date', columns: ['campaign_id', 'date'] },
      { name: 'idx_performance_user_date', columns: ['user_id', 'date'] },
    ],
    uniqueConstraints: [['campaign_id', 'date']],
  },

  // -------------------------------------------------------------------------
  // 14. search_term_reports - 搜索词报告
  // -------------------------------------------------------------------------
  {
    name: 'search_term_reports',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'campaign_id', type: 'INTEGER', notNull: true, references: { table: 'campaigns', column: 'id', onDelete: 'CASCADE' } },
      { name: 'ad_group_id', type: 'INTEGER', references: { table: 'ad_groups', column: 'id', onDelete: 'SET NULL' } },
      { name: 'google_ad_group_id', type: 'TEXT' },
      { name: 'search_term', type: 'TEXT', notNull: true },
      { name: 'match_type', type: 'TEXT', notNull: true },
      { name: 'raw_match_type', type: 'TEXT' },
      { name: 'impressions', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'clicks', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'conversions', type: 'REAL', notNull: true, default: 0 },
      { name: 'cost', type: 'REAL', notNull: true, default: 0 },
      { name: 'date', type: 'DATE', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_search_terms_campaign_date', columns: ['campaign_id', 'date'] },
      { name: 'idx_search_terms_campaign_adgroup_date', columns: ['campaign_id', 'ad_group_id', 'date'] },
      { name: 'idx_search_terms_term', columns: ['search_term'] },
      { name: 'idx_search_terms_google_adgroup', columns: ['google_ad_group_id'] },
      { name: 'idx_search_terms_user_id', columns: ['user_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 15. brand_core_keywords - 品牌全局核心关键词池（跨用户共享）
  // -------------------------------------------------------------------------
  {
    name: 'brand_core_keywords',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'brand_key', type: 'TEXT', notNull: true },
      { name: 'brand_display', type: 'TEXT' },
      { name: 'target_country', type: 'TEXT', notNull: true },
      { name: 'target_language', type: 'TEXT', notNull: true },
      { name: 'keyword_norm', type: 'TEXT', notNull: true },
      { name: 'keyword_display', type: 'TEXT' },
      { name: 'source_mask', type: 'TEXT', notNull: true },
      { name: 'impressions_total', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'clicks_total', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'last_seen_at', type: 'DATE' },
      { name: 'search_volume', type: 'INTEGER' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_brand_core_lookup', columns: ['brand_key', 'target_country', 'target_language'] },
      { name: 'idx_brand_core_last_seen', columns: ['brand_key', 'last_seen_at'] },
    ],
    uniqueConstraints: [['brand_key', 'target_country', 'target_language', 'keyword_norm']],
  },

  // -------------------------------------------------------------------------
  // 16. brand_core_keyword_daily - 核心关键词每日汇总（滚动窗口）
  // -------------------------------------------------------------------------
  {
    name: 'brand_core_keyword_daily',
    columns: [
      { name: 'brand_key', type: 'TEXT', notNull: true },
      { name: 'target_country', type: 'TEXT', notNull: true },
      { name: 'target_language', type: 'TEXT', notNull: true },
      { name: 'keyword_norm', type: 'TEXT', notNull: true },
      { name: 'date', type: 'DATE', notNull: true },
      { name: 'impressions', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'clicks', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'source_mask', type: 'TEXT', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_brand_core_daily_date', columns: ['date'] },
    ],
    uniqueConstraints: [['brand_key', 'target_country', 'target_language', 'keyword_norm', 'date']],
  },

  // -------------------------------------------------------------------------
  // 17. rate_limits - API 速率限制记录
  // -------------------------------------------------------------------------
  {
    name: 'rate_limits',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'api_name', type: 'TEXT', notNull: true },
      { name: 'endpoint', type: 'TEXT', notNull: true },
      { name: 'request_count', type: 'INTEGER', notNull: true, default: 1 },
      { name: 'window_start', type: 'TIMESTAMP', notNull: true },
      { name: 'window_end', type: 'TIMESTAMP', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 17. system_settings - 系统配置
  // -------------------------------------------------------------------------
  {
    name: 'system_settings',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'category', type: 'TEXT', notNull: true },
      { name: 'key', type: 'TEXT', notNull: true },
      { name: 'value', type: 'TEXT' },
      { name: 'encrypted_value', type: 'TEXT' },
      { name: 'data_type', type: 'TEXT', notNull: true, default: 'string' },
      { name: 'is_sensitive', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'is_required', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'validation_status', type: 'TEXT' },
      { name: 'validation_message', type: 'TEXT' },
      { name: 'last_validated_at', type: 'TIMESTAMP' },
      { name: 'default_value', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 18. cpc_adjustment_history - CPC 调整历史
  // -------------------------------------------------------------------------
  {
    name: 'cpc_adjustment_history',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'campaign_id', type: 'INTEGER' },
      { name: 'adjustment_type', type: 'TEXT', notNull: true },
      { name: 'adjustment_value', type: 'REAL', notNull: true },
      { name: 'affected_campaign_count', type: 'INTEGER', notNull: true },
      { name: 'campaign_ids', type: 'TEXT', notNull: true },
      { name: 'success_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'failure_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'error_message', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 19. risk_alerts - 风险预警
  // -------------------------------------------------------------------------
  {
    name: 'risk_alerts',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'risk_type', type: 'TEXT', notNull: true },
      { name: 'severity', type: 'TEXT', notNull: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'message', type: 'TEXT', notNull: true },
      { name: 'related_type', type: 'TEXT' },
      { name: 'related_id', type: 'INTEGER' },
      { name: 'related_name', type: 'TEXT' },
      { name: 'status', type: 'TEXT', notNull: true, default: 'active' },
      { name: 'resolved_at', type: 'TIMESTAMP' },
      { name: 'resolved_by', type: 'INTEGER', references: { table: 'users', column: 'id' } },
      { name: 'detected_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      // 代码使用的字段（保持向后兼容）
      { name: 'alert_type', type: 'TEXT' }, // 对应 risk_type
      { name: 'resource_type', type: 'TEXT' }, // 对应 related_type
      { name: 'resource_id', type: 'INTEGER' }, // 对应 related_id
      { name: 'details', type: 'TEXT' }, // JSON格式的额外详情
      { name: 'acknowledged_at', type: 'TIMESTAMP' }, // 确认时间
    ],
    indexes: [
      { name: 'idx_risk_alerts_user_status', columns: ['user_id', 'status'] },
      { name: 'idx_risk_alerts_alert_type', columns: ['alert_type'] },
      { name: 'idx_risk_alerts_resource', columns: ['resource_type', 'resource_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 20. link_check_history - 链接检查历史
  // -------------------------------------------------------------------------
  {
    name: 'link_check_history',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'is_accessible', type: 'BOOLEAN', notNull: true },
      { name: 'http_status_code', type: 'INTEGER' },
      { name: 'response_time_ms', type: 'INTEGER' },
      { name: 'brand_found', type: 'BOOLEAN' },
      { name: 'content_valid', type: 'BOOLEAN' },
      { name: 'validation_message', type: 'TEXT' },
      { name: 'proxy_used', type: 'TEXT' },
      { name: 'target_country', type: 'TEXT' },
      { name: 'error_message', type: 'TEXT' },
      { name: 'checked_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [{ name: 'idx_link_check_offer', columns: ['offer_id'] }],
  },

  // -------------------------------------------------------------------------
  // 21. creative_versions - 创意版本历史
  // -------------------------------------------------------------------------
  {
    name: 'creative_versions',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'creative_id', type: 'INTEGER', notNull: true, references: { table: 'ad_creatives', column: 'id', onDelete: 'CASCADE' } },
      { name: 'version_number', type: 'INTEGER', notNull: true },
      { name: 'headlines', type: 'TEXT', notNull: true },  // JSON格式: ["H1", "H2", "H3"]
      { name: 'descriptions', type: 'TEXT', notNull: true },  // JSON格式: ["D1", "D2"]
      { name: 'final_url', type: 'TEXT', notNull: true },
      { name: 'path_1', type: 'TEXT' },
      { name: 'path_2', type: 'TEXT' },
      { name: 'quality_score', type: 'INTEGER' },
      { name: 'quality_details', type: 'TEXT' },  // JSON格式
      { name: 'budget_amount', type: 'REAL' },
      { name: 'clicks', type: 'INTEGER', default: 0 },
      { name: 'impressions', type: 'INTEGER', default: 0 },
      { name: 'conversions', type: 'INTEGER', default: 0 },
      { name: 'cost', type: 'REAL', default: 0 },
      { name: 'created_by', type: 'TEXT', notNull: true },  // 用户标识（字符串）
      { name: 'creation_method', type: 'TEXT', notNull: true },  // inline_edit, ai_generation, rollback等
      { name: 'change_summary', type: 'TEXT' },  // 变更说明
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_creative_versions_creative_id', columns: ['creative_id'] },
      { name: 'idx_creative_versions_version', columns: ['creative_id', 'version_number'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 22. sync_logs - 数据同步日志
  // -------------------------------------------------------------------------
  {
    name: 'sync_logs',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      // 🔧 修复(2025-12-25): 删除Ads账号时保留历史数据，设为NULL
      { name: 'google_ads_account_id', type: 'INTEGER', references: { table: 'google_ads_accounts', column: 'id', onDelete: 'SET NULL' } },
      { name: 'sync_type', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', notNull: true },
      { name: 'record_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'duration_ms', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'error_message', type: 'TEXT' },
      { name: 'started_at', type: 'TIMESTAMP', notNull: true },
      { name: 'completed_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [{ name: 'idx_sync_logs_user', columns: ['user_id', 'started_at'] }],
  },

  // -------------------------------------------------------------------------
  // 23. creative_learning_patterns - 创意学习模式
  // -------------------------------------------------------------------------
  {
    name: 'creative_learning_patterns',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, unique: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'success_features', type: 'TEXT', notNull: true },
      { name: 'total_creatives_analyzed', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'avg_ctr', type: 'REAL' },
      { name: 'avg_conversion_rate', type: 'REAL' },
      { name: 'min_ctr_threshold', type: 'REAL' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [{ name: 'idx_creative_learning_user_id', columns: ['user_id'] }],
  },

  // -------------------------------------------------------------------------
  // 24. scraped_products - 抓取的产品数据
  // -------------------------------------------------------------------------
  {
    name: 'scraped_products',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'product_title', type: 'TEXT', notNull: true },
      { name: 'product_url', type: 'TEXT' },
      { name: 'price', type: 'REAL' },
      { name: 'rating', type: 'REAL' },
      { name: 'review_count', type: 'INTEGER' },
      { name: 'hot_score', type: 'REAL' },
      { name: 'badges', type: 'TEXT' },
      { name: 'is_prime', type: 'BOOLEAN' },
      { name: 'is_promotion', type: 'BOOLEAN' },
      { name: 'scraped_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 25. backup_logs - 备份日志
  // -------------------------------------------------------------------------
  {
    name: 'backup_logs',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'backup_type', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', notNull: true },
      { name: 'backup_filename', type: 'TEXT' },
      { name: 'backup_path', type: 'TEXT' },
      { name: 'file_size_bytes', type: 'BIGINT' },
      { name: 'error_message', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'created_by', type: 'INTEGER', references: { table: 'users', column: 'id', onDelete: 'SET NULL' } },
    ],
    indexes: [
      { name: 'idx_backup_logs_created_at', columns: ['created_at'] },
      { name: 'idx_backup_logs_status', columns: ['status'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 26. ab_tests - A/B 测试
  // -------------------------------------------------------------------------
  {
    name: 'ab_tests',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'test_name', type: 'TEXT', notNull: true },
      { name: 'test_description', type: 'TEXT' },
      { name: 'test_type', type: 'TEXT', notNull: true, check: "test_type IN ('headline', 'description', 'keyword', 'callout', 'sitelink', 'full_creative')" },
      { name: 'status', type: 'TEXT', notNull: true, default: 'draft', check: "status IN ('draft', 'running', 'paused', 'completed', 'cancelled')" },
      { name: 'start_date', type: 'TIMESTAMP' },
      { name: 'end_date', type: 'TIMESTAMP' },
      { name: 'winner_variant_id', type: 'INTEGER' },
      { name: 'statistical_confidence', type: 'REAL' },
      { name: 'min_sample_size', type: 'INTEGER', default: 100 },
      { name: 'confidence_level', type: 'REAL', default: 0.95 },
      // 自动测试相关字段
      { name: 'is_auto_test', type: 'BOOLEAN', default: true },
      { name: 'test_mode', type: 'TEXT', default: 'manual', check: "test_mode IN ('launch_multi_variant', 'optimization_challenge', 'manual')" },
      { name: 'parent_campaign_id', type: 'INTEGER', references: { table: 'campaigns', column: 'id', onDelete: 'SET NULL' } },
      { name: 'test_dimension', type: 'TEXT', default: 'creative', check: "test_dimension IN ('creative', 'strategy')" },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ab_tests_user_id', columns: ['user_id'] },
      { name: 'idx_ab_tests_offer_id', columns: ['offer_id'] },
      { name: 'idx_ab_tests_status', columns: ['status'] },
      { name: 'idx_ab_tests_dates', columns: ['start_date', 'end_date'] },
      { name: 'idx_ab_tests_parent_campaign', columns: ['parent_campaign_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 27. ab_test_variants - A/B 测试变体
  // -------------------------------------------------------------------------
  {
    name: 'ab_test_variants',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'ab_test_id', type: 'INTEGER', notNull: true, references: { table: 'ab_tests', column: 'id', onDelete: 'CASCADE' } },
      { name: 'variant_name', type: 'TEXT', notNull: true },
      { name: 'variant_label', type: 'TEXT' },
      { name: 'ad_creative_id', type: 'INTEGER', notNull: true, references: { table: 'ad_creatives', column: 'id', onDelete: 'CASCADE' } },
      { name: 'traffic_allocation', type: 'REAL', notNull: true, default: 0.5, check: 'traffic_allocation >= 0 AND traffic_allocation <= 1' },
      { name: 'is_control', type: 'BOOLEAN', notNull: true, default: false },
      { name: 'impressions', type: 'INTEGER', default: 0 },
      { name: 'clicks', type: 'INTEGER', default: 0 },
      { name: 'conversions', type: 'INTEGER', default: 0 },
      { name: 'cost', type: 'REAL', default: 0 },
      { name: 'ctr', type: 'REAL' },
      { name: 'conversion_rate', type: 'REAL' },
      { name: 'cpa', type: 'REAL' },
      { name: 'confidence_interval_lower', type: 'REAL' },
      { name: 'confidence_interval_upper', type: 'REAL' },
      { name: 'p_value', type: 'REAL' },
      { name: 'last_updated_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ab_test_variants_test_id', columns: ['ab_test_id'] },
      { name: 'idx_ab_test_variants_creative_id', columns: ['ad_creative_id'] },
    ],
    uniqueConstraints: [['ab_test_id', 'variant_name']],
  },

  // -------------------------------------------------------------------------
  // 28. google_ads_credentials - Google Ads 凭证
  // -------------------------------------------------------------------------
  {
    name: 'google_ads_credentials',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, unique: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'client_id', type: 'TEXT' },  // 选填，可使用平台共享配置
      { name: 'client_secret', type: 'TEXT' },  // 选填，可使用平台共享配置
      { name: 'refresh_token', type: 'TEXT', notNull: true },
      { name: 'access_token', type: 'TEXT' },
      { name: 'developer_token', type: 'TEXT' },  // 选填，可使用平台共享配置
      { name: 'login_customer_id', type: 'TEXT', notNull: true },  // 必填，MCC账户ID
      { name: 'access_token_expires_at', type: 'TIMESTAMP' },
      { name: 'is_active', type: 'BOOLEAN', default: true },
      { name: 'last_verified_at', type: 'TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 29. google_ads_api_usage - Google Ads API 使用统计
  // -------------------------------------------------------------------------
  {
    name: 'google_ads_api_usage',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'operation_type', type: 'TEXT', notNull: true },
      { name: 'endpoint', type: 'TEXT', notNull: true },
      { name: 'customer_id', type: 'TEXT' },
      { name: 'request_count', type: 'INTEGER', default: 1 },
      { name: 'response_time_ms', type: 'INTEGER' },
      { name: 'is_success', type: 'BOOLEAN', default: true },
      { name: 'error_message', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'date', type: 'DATE', notNull: true },
    ],
    indexes: [
      { name: 'idx_google_ads_api_usage_date', columns: ['date', 'user_id'] },
      { name: 'idx_google_ads_api_usage_user_date', columns: ['user_id', 'date'] },
      { name: 'idx_google_ads_api_usage_created_at', columns: ['created_at'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 30. ad_strength_history - Ad Strength 历史
  // -------------------------------------------------------------------------
  {
    name: 'ad_strength_history',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'creative_id', type: 'INTEGER', references: { table: 'ad_creatives', column: 'id', onDelete: 'SET NULL' } },
      { name: 'campaign_id', type: 'TEXT' },
      { name: 'rating', type: 'TEXT', notNull: true, check: "rating IN ('PENDING', 'POOR', 'AVERAGE', 'GOOD', 'EXCELLENT')" },
      { name: 'overall_score', type: 'INTEGER', notNull: true, check: 'overall_score >= 0 AND overall_score <= 100' },
      { name: 'diversity_score', type: 'INTEGER', notNull: true },
      { name: 'relevance_score', type: 'INTEGER', notNull: true },
      { name: 'completeness_score', type: 'INTEGER', notNull: true },
      { name: 'quality_score', type: 'INTEGER', notNull: true },
      { name: 'compliance_score', type: 'INTEGER', notNull: true },
      { name: 'headlines_count', type: 'INTEGER', notNull: true },
      { name: 'descriptions_count', type: 'INTEGER', notNull: true },
      { name: 'keywords_count', type: 'INTEGER', notNull: true },
      { name: 'has_numbers', type: 'BOOLEAN', default: false },
      { name: 'has_cta', type: 'BOOLEAN', default: false },
      { name: 'has_urgency', type: 'BOOLEAN', default: false },
      { name: 'avg_headline_length', type: 'REAL' },
      { name: 'avg_description_length', type: 'REAL' },
      { name: 'impressions', type: 'INTEGER', default: 0 },
      { name: 'clicks', type: 'INTEGER', default: 0 },
      { name: 'conversions', type: 'INTEGER', default: 0 },
      { name: 'cost', type: 'REAL', default: 0 },
      { name: 'evaluated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'performance_updated_at', type: 'TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ad_strength_history_user', columns: ['user_id'] },
      { name: 'idx_ad_strength_history_offer', columns: ['offer_id'] },
      { name: 'idx_ad_strength_history_rating', columns: ['rating'] },
      { name: 'idx_ad_strength_history_campaign', columns: ['campaign_id'] },
      { name: 'idx_ad_strength_history_evaluated_at', columns: ['evaluated_at'] },
      { name: 'idx_ad_strength_history_rating_score', columns: ['rating', 'overall_score'] },
      { name: 'idx_ad_strength_history_user_rating', columns: ['user_id', 'rating'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 31. industry_benchmarks - 行业基准数据
  // -------------------------------------------------------------------------
  {
    name: 'industry_benchmarks',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'industry_l1', type: 'TEXT', notNull: true },
      { name: 'industry_l2', type: 'TEXT', notNull: true },
      { name: 'industry_code', type: 'TEXT', notNull: true, unique: true },
      { name: 'avg_ctr', type: 'REAL', notNull: true },
      { name: 'avg_cpc', type: 'REAL', notNull: true },
      { name: 'avg_conversion_rate', type: 'REAL', notNull: true },
      { name: 'data_source', type: 'TEXT', default: 'Google Ads Industry Benchmarks 2024' },
      { name: 'last_updated', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_industry_benchmarks_code', columns: ['industry_code'] },
      { name: 'idx_industry_benchmarks_l1', columns: ['industry_l1'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 32. ad_creative_performance - 广告创意效果数据
  // -------------------------------------------------------------------------
  {
    name: 'ad_creative_performance',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'ad_creative_id', type: 'INTEGER', notNull: true, references: { table: 'ad_creatives', column: 'id', onDelete: 'CASCADE' } },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'user_id', type: 'TEXT', notNull: true },
      { name: 'impressions', type: 'INTEGER', default: 0 },
      { name: 'clicks', type: 'INTEGER', default: 0 },
      { name: 'ctr', type: 'REAL', default: 0 },
      { name: 'cost', type: 'REAL', default: 0 },
      { name: 'cpc', type: 'REAL', default: 0 },
      { name: 'conversions', type: 'INTEGER', default: 0 },
      { name: 'conversion_rate', type: 'REAL', default: 0 },
      { name: 'conversion_value', type: 'REAL', default: 0 },
      { name: 'industry_code', type: 'TEXT' },
      { name: 'bonus_score', type: 'INTEGER', default: 0 },
      { name: 'bonus_breakdown', type: 'TEXT' },
      { name: 'min_clicks_reached', type: 'BOOLEAN', default: false },
      { name: 'sync_date', type: 'DATE', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_ad_creative_performance_creative', columns: ['ad_creative_id'] },
      { name: 'idx_ad_creative_performance_offer', columns: ['offer_id'] },
      { name: 'idx_ad_creative_performance_user', columns: ['user_id'] },
      { name: 'idx_ad_creative_performance_date', columns: ['sync_date'] },
    ],
    uniqueConstraints: [['ad_creative_id', 'sync_date']],
  },

  // -------------------------------------------------------------------------
  // 33. conversion_feedback - 用户转化反馈
  // -------------------------------------------------------------------------
  {
    name: 'conversion_feedback',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'ad_creative_id', type: 'INTEGER', notNull: true, references: { table: 'ad_creatives', column: 'id', onDelete: 'CASCADE' } },
      { name: 'user_id', type: 'TEXT', notNull: true },
      { name: 'conversions', type: 'INTEGER', notNull: true },
      { name: 'conversion_value', type: 'REAL', default: 0 },
      { name: 'feedback_note', type: 'TEXT' },
      { name: 'period_start', type: 'DATE', notNull: true },
      { name: 'period_end', type: 'DATE', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_conversion_feedback_creative', columns: ['ad_creative_id'] },
      { name: 'idx_conversion_feedback_user', columns: ['user_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 34. score_analysis_history - 评分分析历史
  // -------------------------------------------------------------------------
  {
    name: 'score_analysis_history',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'TEXT', notNull: true },
      { name: 'industry_code', type: 'TEXT', notNull: true },
      { name: 'sample_count', type: 'INTEGER', notNull: true },
      { name: 'trigger_type', type: 'TEXT', notNull: true },
      { name: 'correlation_clicks', type: 'REAL' },
      { name: 'correlation_ctr', type: 'REAL' },
      { name: 'correlation_cpc', type: 'REAL' },
      { name: 'correlation_conversions', type: 'REAL' },
      { name: 'overall_correlation', type: 'REAL' },
      { name: 'insights', type: 'TEXT' },
      { name: 'recommendations', type: 'TEXT' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_score_analysis_user', columns: ['user_id'] },
      { name: 'idx_score_analysis_industry', columns: ['industry_code'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 35. ai_token_usage - AI Token 使用统计
  // -------------------------------------------------------------------------
  {
    name: 'ai_token_usage',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'model', type: 'TEXT', notNull: true },
      { name: 'operation_type', type: 'TEXT', notNull: true },
      { name: 'input_tokens', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'output_tokens', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'total_tokens', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'cost', type: 'REAL', notNull: true, default: 0 },
      { name: 'api_type', type: 'TEXT', notNull: true, default: 'gemini' },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'date', type: 'DATE', notNull: true },
    ],
    indexes: [
      { name: 'idx_ai_token_usage_user_date', columns: ['user_id', 'date'] },
      { name: 'idx_ai_token_usage_date', columns: ['date'] },
      { name: 'idx_ai_token_usage_model', columns: ['model'] },
      { name: 'idx_ai_token_usage_created_at', columns: ['created_at'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 36. prompt_versions - Prompt 版本管理
  // -------------------------------------------------------------------------
  {
    name: 'prompt_versions',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'prompt_id', type: 'TEXT', notNull: true },
      { name: 'version', type: 'TEXT', notNull: true },
      { name: 'category', type: 'TEXT', notNull: true },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'description', type: 'TEXT' },
      { name: 'file_path', type: 'TEXT', notNull: true },
      { name: 'function_name', type: 'TEXT', notNull: true },
      { name: 'prompt_content', type: 'TEXT', notNull: true },
      { name: 'language', type: 'TEXT', default: 'English' },
      { name: 'created_by', type: 'INTEGER', references: { table: 'users', column: 'id', onDelete: 'SET NULL' } },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'is_active', type: 'BOOLEAN', default: false },
      { name: 'change_notes', type: 'TEXT' },
    ],
    indexes: [
      { name: 'idx_prompt_versions_prompt_id', columns: ['prompt_id'] },
      { name: 'idx_prompt_versions_active', columns: ['is_active'] },
      { name: 'idx_prompt_versions_created_at', columns: ['created_at'] },
    ],
    uniqueConstraints: [['prompt_id', 'version']],
  },

  // -------------------------------------------------------------------------
  // 37. offer_tasks - Offer任务队列 (Migration 058, Database v2.0)
  // -------------------------------------------------------------------------
  {
    name: 'offer_tasks',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },  // UUID v4
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'status', type: 'TEXT', notNull: true, check: "status IN ('pending', 'running', 'completed', 'failed')", default: 'pending' },
      { name: 'stage', type: 'TEXT' },  // Current processing stage
      { name: 'progress', type: 'INTEGER', default: 0 },  // 0-100
      { name: 'message', type: 'TEXT' },
      { name: 'affiliate_link', type: 'TEXT', notNull: true },
      { name: 'target_country', type: 'TEXT', notNull: true },
      { name: 'page_type', type: 'TEXT' },  // store/product (user selection)
      { name: 'store_product_links', type: 'TEXT' },  // JSON array
      { name: 'skip_cache', type: 'BOOLEAN', default: false },
      { name: 'skip_warmup', type: 'BOOLEAN', default: false },
      { name: 'product_price', type: 'TEXT' },
      { name: 'commission_payout', type: 'TEXT' },
      { name: 'brand_name', type: 'TEXT' },
      { name: 'result', type: 'TEXT' },  // JSON extraction result
      { name: 'error', type: 'TEXT' },  // JSON error details
      { name: 'batch_id', type: 'TEXT', references: { table: 'batch_tasks', column: 'id', onDelete: 'SET NULL' } },  // Migration 060
      { name: 'offer_id', type: 'INTEGER', references: { table: 'offers', column: 'id', onDelete: 'SET NULL' } },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'started_at', type: 'TIMESTAMP' },
      { name: 'completed_at', type: 'TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_offer_tasks_user_status', columns: ['user_id', 'status'] },  // User task list
      { name: 'idx_offer_tasks_status_created', columns: ['status', 'created_at'] },  // Admin dashboard
      { name: 'idx_offer_tasks_updated_at', columns: ['updated_at'] },  // SSE polling
      { name: 'idx_offer_tasks_id_updated', columns: ['id', 'updated_at'] },  // SSE single task
      { name: 'idx_offer_tasks_batch_id', columns: ['batch_id', 'status'] },  // Batch queries (Migration 060)
    ],
  },

  // -------------------------------------------------------------------------
  // 38. batch_tasks - 批量任务管理 (Migration 059, Database v2.0)
  // -------------------------------------------------------------------------
  {
    name: 'batch_tasks',
    columns: [
      { name: 'id', type: 'TEXT', primaryKey: true },  // UUID v4
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'task_type', type: 'TEXT', notNull: true },  // offer-creation, offer-scrape, offer-enhance
      { name: 'status', type: 'TEXT', notNull: true, check: "status IN ('pending', 'running', 'completed', 'failed', 'partial')", default: 'pending' },
      { name: 'total_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'success_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'failed_count', type: 'INTEGER', notNull: true, default: 0 },
      { name: 'progress', type: 'INTEGER', notNull: true, default: 0 },  // 0-100
      { name: 'result_summary', type: 'TEXT' },  // JSON summary
      { name: 'error', type: 'TEXT' },  // JSON error details
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'started_at', type: 'TIMESTAMP' },
      { name: 'completed_at', type: 'TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_batch_tasks_user_status', columns: ['user_id', 'status'] },  // User batch list
      { name: 'idx_batch_tasks_status_created', columns: ['status', 'created_at'] },  // Status filtering
      { name: 'idx_batch_tasks_user_created', columns: ['user_id', 'created_at'] },  // History queries
    ],
  },

  // -------------------------------------------------------------------------
  // 39. migration_history - 迁移历史
  // -------------------------------------------------------------------------
  {
    name: 'migration_history',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'migration_name', type: 'TEXT', notNull: true, unique: true },
      { name: 'executed_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
  },

  // -------------------------------------------------------------------------
  // 40. offer_keyword_pools - Offer级关键词池 (Database v2.1)
  // -------------------------------------------------------------------------
  {
    name: 'offer_keyword_pools',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      // 共享层：纯品牌词
      { name: 'brand_keywords', type: 'TEXT', notNull: true },  // JSON数组
      // 独占层：语义分桶
      { name: 'bucket_a_keywords', type: 'TEXT', notNull: true },  // JSON数组，品牌商品锚点
      { name: 'bucket_b_keywords', type: 'TEXT', notNull: true },  // JSON数组，商品需求场景
      { name: 'bucket_c_keywords', type: 'TEXT', notNull: true },  // JSON数组，功能规格/需求扩展
      // 桶意图描述
      { name: 'bucket_a_intent', type: 'TEXT', default: '品牌商品锚点' },
      { name: 'bucket_b_intent', type: 'TEXT', default: '商品需求场景' },
      { name: 'bucket_c_intent', type: 'TEXT', default: '功能规格/需求扩展' },
      // 元数据
      { name: 'total_keywords', type: 'INTEGER', notNull: true },
      { name: 'clustering_model', type: 'TEXT' },  // 使用的AI模型
      { name: 'clustering_prompt_version', type: 'TEXT' },  // 聚类prompt版本
      { name: 'balance_score', type: 'REAL' },  // 分桶均衡度评分 0-1
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    indexes: [
      { name: 'idx_offer_keyword_pools_offer', columns: ['offer_id'], unique: true },
      { name: 'idx_offer_keyword_pools_user', columns: ['user_id'] },
    ],
  },

  // -------------------------------------------------------------------------
  // 41. offer_blacklist - Offer拉黑投放黑名单库（品牌+国家）
  // -------------------------------------------------------------------------
  {
    name: 'offer_blacklist',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id', onDelete: 'CASCADE' } },
      { name: 'brand', type: 'TEXT', notNull: true },
      { name: 'target_country', type: 'TEXT', notNull: true },
      { name: 'offer_id', type: 'INTEGER', notNull: true, references: { table: 'offers', column: 'id', onDelete: 'CASCADE' } },
      { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    ],
    uniqueConstraints: [['user_id', 'brand', 'target_country']],
    indexes: [
      { name: 'idx_offer_blacklist_user', columns: ['user_id'] },
      { name: 'idx_offer_blacklist_brand_country', columns: ['brand', 'target_country'] },
    ],
  },
]

// ============================================================================
// 默认系统配置
// ============================================================================

export const DEFAULT_SETTINGS = [
  // Google Ads API配置
  { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads API Client ID' },
  { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads API Client Secret' },
  { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads Developer Token' },

  // AI配置 - Gemini直接API模式
  { category: 'ai', key: 'gemini_api_key', dataType: 'string', isSensitive: true, isRequired: false, description: 'Gemini API密钥（直接API模式）' },
  { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: false, isRequired: true, defaultValue: 'gemini-3-flash-preview', description: 'AI模型' },

  // 代理配置
  { category: 'proxy', key: 'urls', dataType: 'json', isSensitive: false, isRequired: false, description: '代理URL配置列表（JSON格式），支持多个国家的代理URL' },

  // 系统配置
  { category: 'system', key: 'currency', dataType: 'string', isSensitive: false, isRequired: true, defaultValue: 'CNY', description: '默认货币' },
  { category: 'system', key: 'language', dataType: 'string', isSensitive: false, isRequired: true, defaultValue: 'zh-CN', description: '系统语言' },
  { category: 'system', key: 'sync_interval_hours', dataType: 'number', isSensitive: false, isRequired: true, defaultValue: '4', description: '数据同步间隔(小时)' },
  { category: 'system', key: 'link_check_enabled', dataType: 'boolean', isSensitive: false, isRequired: true, defaultValue: 'true', description: '是否启用链接检查' },
  { category: 'system', key: 'link_check_time', dataType: 'string', isSensitive: false, isRequired: true, defaultValue: '02:00', description: '链接检查时间' },
]

// ============================================================================
// 导出表数量常量
// ============================================================================

export const SCHEMA_VERSION = '2.1.0'
export const TABLE_COUNT = TABLES.length

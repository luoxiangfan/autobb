-- 019: Google Ads API使用统计表
-- 用于追踪每天的API调用次数，配合Google Ads API配额管理

CREATE TABLE IF NOT EXISTS google_ads_api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL, -- 操作类型: search, mutate, report等
  endpoint TEXT NOT NULL, -- API端点路径
  customer_id TEXT, -- Google Ads客户ID（如果适用）
  request_count INTEGER DEFAULT 1, -- 请求计数（某些操作计为多次）
  response_time_ms INTEGER, -- 响应时间（毫秒）
  is_success BOOLEAN DEFAULT 1, -- 是否成功
  error_message TEXT, -- 错误信息（如果失败）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  date TEXT NOT NULL, -- 日期字符串 YYYY-MM-DD，用于快速查询当天统计
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引：快速查询当天统计
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_date ON google_ads_api_usage(date, user_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_user_date ON google_ads_api_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_created_at ON google_ads_api_usage(created_at);

-- 视图：每日汇总统计
CREATE VIEW IF NOT EXISTS daily_api_usage_summary AS
SELECT
  user_id,
  date,
  SUM(request_count) as total_requests,
  COUNT(*) as total_operations,
  SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) as successful_operations,
  SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END) as failed_operations,
  AVG(response_time_ms) as avg_response_time_ms,
  MAX(response_time_ms) as max_response_time_ms
FROM google_ads_api_usage
GROUP BY user_id, date;

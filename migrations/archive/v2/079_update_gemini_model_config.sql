-- 迁移目标：下线Gemini 3 Pro Preview，上线Gemini 3 Flash

-- SQLite版本：更新或删除系统设置中的Gemini Pro Preview相关配置
-- 如果用户之前选择了Gemini 3 Pro Preview，重置为默认值Gemini 2.5 Pro

UPDATE system_settings
SET
  value = 'gemini-2.5-pro',
  updated_at = CURRENT_TIMESTAMP,
  validation_status = NULL,
  validation_message = '已自动重置：Gemini 3 Pro Preview已下线，改用Gemini 2.5 Pro'
WHERE
  category = 'ai'
  AND key = 'gemini_model'
  AND value = 'gemini-3-pro-preview';

-- 更新全局默认值描述
UPDATE system_settings
SET
  description = 'Gemini Pro级别模型选择：2.5-pro或3-flash',
  updated_at = CURRENT_TIMESTAMP
WHERE
  user_id IS NULL
  AND category = 'ai'
  AND key = 'gemini_model';

#!/usr/bin/env bash

# 修复用户 autoads (user_id=1) 的敏感配置解密问题
# 问题：encrypted_value 无法解密，导致配置读取失败

echo "=== 诊断敏感配置解密问题 ==="
echo ""

# 1. 检查当前敏感配置状态
echo "1. 检查敏感配置状态："
echo "-------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

SELECT
  key,
  value IS NULL OR value = '' as value_is_empty,
  encrypted_value IS NOT NULL as has_encrypted_value,
  LENGTH(encrypted_value) as encrypted_length,
  is_sensitive,
  updated_at
FROM system_settings
WHERE user_id = 1
  AND is_sensitive = true
ORDER BY key;

EOF

echo ""
echo "2. 问题分析："
echo "-------------"
echo "敏感字段（yeahpromos_token, partnerboost_token）的 value 字段为空，"
echo "但 encrypted_value 有值。这说明数据被加密存储了。"
echo ""
echo "错误 '配置不完整: yeahpromos_token' 表明解密失败，可能原因："
echo "1. ENCRYPTION_KEY 环境变量与加密时使用的 KEY 不一致"
echo "2. encrypted_value 格式不正确"
echo "3. 解密函数返回 null，导致配置检查失败"
echo ""

echo "3. 解决方案："
echo "-------------"
echo "需要检查生产环境的 ENCRYPTION_KEY 是否正确配置。"
echo ""
echo "临时解决方案（如果有备份的明文 token）："
echo "1. 获取正确的 yeahpromos_token 和 partnerboost_token"
echo "2. 使用正确的 ENCRYPTION_KEY 重新加密"
echo "3. 更新 system_settings 表"
echo ""

echo "4. 检查最近的同步任务："
echo "---------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

SELECT
  id,
  status,
  total_items,
  created_count + updated_count as success_count,
  error_message,
  started_at,
  completed_at
FROM affiliate_product_sync_runs
WHERE user_id = 1
  AND platform = 'yeahpromos'
ORDER BY id DESC
LIMIT 5;

EOF

echo ""
echo "=== 建议 ==="
echo ""
echo "1. 检查生产环境的 ENCRYPTION_KEY 环境变量"
echo "2. 如果 KEY 正确，检查解密逻辑是否有问题"
echo "3. 如果 KEY 丢失，需要重新配置 token 并加密存储"
echo "4. 考虑添加解密失败的详细日志，便于排查"

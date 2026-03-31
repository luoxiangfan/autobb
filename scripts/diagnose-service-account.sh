#!/bin/bash
# 诊断服务账号访问Google Ads的权限问题

set -e

echo "🔍 Google Ads 服务账号诊断工具"
echo "=========================================="
echo ""

# 检查服务账号配置文件
if [ ! -f "secrets/gcp_autoads_dev.json" ]; then
  echo "❌ 错误: 找不到服务账号密钥文件 secrets/gcp_autoads_dev.json"
  exit 1
fi

echo "✅ 找到服务账号密钥文件"
SERVICE_ACCOUNT_EMAIL=$(cat secrets/gcp_autoads_dev.json | grep -o '"client_email": "[^"]*"' | cut -d'"' -f4)
echo "   服务账号邮箱: $SERVICE_ACCOUNT_EMAIL"
echo ""

# 提取配置
MCC_ID="1971320874"
SUB_ID="6260947444"

echo "📋 当前配置:"
echo "   MCC账户ID: $MCC_ID"
echo "   子账户ID: $SUB_ID"
echo "   服务账号: $SERVICE_ACCOUNT_EMAIL"
echo ""

echo "=========================================="
echo "🔍 诊断步骤"
echo "=========================================="
echo ""

echo "步骤1: 检查MCC账户和子账户的关系"
echo "----------------------------------------"
echo "请访问Google Ads UI手动验证:"
echo "1. 登录 https://ads.google.com"
echo "2. 切换到MCC账户 $MCC_ID"
echo "3. 查看"账户"页面,确认 $SUB_ID 是否在子账户列表中"
echo ""
read -p "按回车键继续..."
echo ""

echo "步骤2: 检查服务账号在MCC账户中的权限"
echo "----------------------------------------"
echo "请在Google Ads UI中检查:"
echo "1. 确保当前在MCC账户 $MCC_ID"
echo "2. 进入"管理" → "访问权限和安全""
echo "3. 在"用户"标签页中查找 $SERVICE_ACCOUNT_EMAIL"
echo ""
echo "❓ 问题1: 服务账号是否在MCC账户的用户列表中?"
read -p "   请输入 (yes/no): " mcc_has_service_account
echo ""

if [ "$mcc_has_service_account" = "yes" ]; then
  echo "   ✅ 服务账号已添加到MCC账户"
  echo "   ❓ 问题2: 权限级别是什么?"
  echo "      可选: Standard(标准访问) / Admin(管理员) / Read-only(只读)"
  read -p "   请输入权限级别: " mcc_access_level
  echo "   记录: MCC权限级别 = $mcc_access_level"
else
  echo "   ⚠️  警告: 服务账号未添加到MCC账户!"
  echo "   这可能是问题的根源。"
  echo ""
  echo "   🔧 修复方法:"
  echo "   1. 在MCC账户的"访问权限和安全"中点击"+"按钮"
  echo "   2. 输入服务账号邮箱: $SERVICE_ACCOUNT_EMAIL"
  echo "   3. 选择"标准访问"或"管理员"(不要选Email/Admin)"
  echo "   4. 点击"添加账户""
fi
echo ""

echo "步骤3: 检查服务账号在子账户中的权限"
echo "----------------------------------------"
echo "请在Google Ads UI中检查:"
echo "1. 切换到子账户 $SUB_ID"
echo "2. 进入"管理" → "访问权限和安全""
echo "3. 在"用户"标签页中查找 $SERVICE_ACCOUNT_EMAIL"
echo ""
echo "❓ 问题3: 服务账号是否在子账户的用户列表中?"
read -p "   请输入 (yes/no): " sub_has_service_account
echo ""

if [ "$sub_has_service_account" = "yes" ]; then
  echo "   ✅ 服务账号已添加到子账户"
  echo "   ❓ 问题4: 权限级别是什么?"
  read -p "   请输入权限级别: " sub_access_level
  echo "   记录: 子账户权限级别 = $sub_access_level"
else
  echo "   ⚠️  服务账号未添加到子账户"
fi
echo ""

echo "=========================================="
echo "📊 诊断结果分析"
echo "=========================================="
echo ""

if [ "$mcc_has_service_account" = "yes" ] && [ "$sub_has_service_account" = "yes" ]; then
  echo "✅ 配置状态: 服务账号同时在MCC和子账户中"
  echo ""
  echo "🎯 建议配置:"
  echo "   使用 login_customer_id = $MCC_ID (MCC模式)"
  echo "   此时API会通过MCC访问子账户"
  echo ""
elif [ "$mcc_has_service_account" = "yes" ] && [ "$sub_has_service_account" = "no" ]; then
  echo "⚠️  配置状态: 服务账号仅在MCC中"
  echo ""
  echo "🎯 建议配置:"
  echo "   使用 login_customer_id = $MCC_ID (MCC模式)"
  echo "   如果失败,可能是MCC权限不足以访问子账户"
  echo "   解决方案: 将服务账号也添加到子账户中"
  echo ""
elif [ "$mcc_has_service_account" = "no" ] && [ "$sub_has_service_account" = "yes" ]; then
  echo "⚠️  配置状态: 服务账号仅在子账户中"
  echo ""
  echo "🎯 建议配置:"
  echo "   使用 login_customer_id = null (省略) 或 $SUB_ID"
  echo "   此时API直接访问子账户,不通过MCC"
  echo "   这就是为什么MCC模式失败的原因!"
  echo ""
else
  echo "❌ 配置错误: 服务账号既不在MCC也不在子账户中"
  echo ""
  echo "🔧 修复步骤:"
  echo "   至少将服务账号添加到其中一个账户的用户列表中"
fi

echo "=========================================="
echo "📚 权限配置最佳实践"
echo "=========================================="
echo ""
echo "方案A: MCC管理模式(推荐)"
echo "   1. 将服务账号添加到MCC账户($MCC_ID)"
echo "   2. 权限级别: 标准访问或管理员"
echo "   3. API使用: login_customer_id = $MCC_ID"
echo "   4. 优点: 统一管理,可访问所有子账户"
echo ""
echo "方案B: 直接访问模式"
echo "   1. 将服务账号添加到子账户($SUB_ID)"
echo "   2. 权限级别: 标准访问或管理员"
echo "   3. API使用: login_customer_id = null 或 $SUB_ID"
echo "   4. 优点: 权限隔离,更安全"
echo ""
echo "方案C: 混合模式(最灵活)"
echo "   1. 将服务账号同时添加到MCC和子账户"
echo "   2. API使用: 自动降级逻辑(MCC → Sub → null)"
echo "   3. 优点: 兼容性最好,已在代码中实现"
echo ""

echo "=========================================="
echo "✅ 诊断完成"
echo "=========================================="

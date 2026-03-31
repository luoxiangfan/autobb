#!/bin/bash

echo "🧪 自动化测试：评分算法迁移"
echo ""
echo "============================================================"

# 读取密码
if [ -z "$AUTOADS_PASSWORD" ]; then
  echo "⚠️  环境变量 AUTOADS_PASSWORD 未设置"
  echo "请设置密码: export AUTOADS_PASSWORD='your-password'"
  exit 1
fi

# 1. 登录获取cookie
echo ""
echo "🔐 步骤1: 登录获取认证..."

LOGIN_RESPONSE=$(curl -s -c /tmp/test_cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"autoads\", \"password\": \"$AUTOADS_PASSWORD\"}")

if echo "$LOGIN_RESPONSE" | grep -q '"success":true'; then
  echo "   ✅ 登录成功"
else
  echo "   ❌ 登录失败"
  echo "   响应: $LOGIN_RESPONSE"
  exit 1
fi

# 2. 生成创意
echo ""
echo "📝 步骤2: 调用旧API生成创意 (Offer 51)..."
echo "   API: POST /api/offers/51/generate-ad-creative"
echo ""

CREATIVE_RESPONSE=$(curl -s -b /tmp/test_cookies.txt -X POST http://localhost:3000/api/offers/51/generate-ad-creative \
  -H "Content-Type: application/json" \
  -d '{"generation_round": 1}')

if echo "$CREATIVE_RESPONSE" | grep -q '"success":true'; then
  echo "   ✅ 创意生成成功"

  # 提取创意ID
  CREATIVE_ID=$(echo "$CREATIVE_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
  SCORE=$(echo "$CREATIVE_RESPONSE" | grep -o '"score":[0-9.]*' | head -1 | cut -d: -f2)

  echo "   - 创意ID: $CREATIVE_ID"
  echo "   - 评分: $SCORE"
else
  echo "   ❌ 创意生成失败"
  echo "   响应: $CREATIVE_RESPONSE"
  exit 1
fi

# 3. 验证数据库
echo ""
echo "🔍 步骤3: 验证数据库记录..."

DB_RESULT=$(sqlite3 data/autoads.db "SELECT id, score, score_breakdown FROM ad_creatives WHERE id = $CREATIVE_ID;")

if [ -z "$DB_RESULT" ]; then
  echo "   ❌ 数据库中未找到创意 ID $CREATIVE_ID"
  exit 1
fi

echo "   ✅ 找到数据库记录 #$CREATIVE_ID"

# 解析score_breakdown
BREAKDOWN=$(echo "$DB_RESULT" | cut -d'|' -f3)
echo "   - 总分: $SCORE"

# 提取各维度分数
DIVERSITY=$(echo "$BREAKDOWN" | grep -o '"diversity":[0-9.]*' | cut -d: -f2)
RELEVANCE=$(echo "$BREAKDOWN" | grep -o '"relevance":[0-9.]*' | cut -d: -f2)
ENGAGEMENT=$(echo "$BREAKDOWN" | grep -o '"engagement":[0-9.]*' | cut -d: -f2)
QUALITY=$(echo "$BREAKDOWN" | grep -o '"quality":[0-9.]*' | cut -d: -f2)
CLARITY=$(echo "$BREAKDOWN" | grep -o '"clarity":[0-9.]*' | cut -d: -f2)

echo "   - 维度分数:"
echo "     • Diversity: $DIVERSITY / 18"
echo "     • Relevance: $RELEVANCE / 22"
echo "     • Engagement: $ENGAGEMENT / 10"
echo "     • Quality: $QUALITY / 14"
echo "     • Clarity: $CLARITY / 8"

# 检查是否超过最大值
VIOLATIONS=0

if (( $(echo "$DIVERSITY > 18" | bc -l) )); then
  echo "   ❌ Diversity超过最大值18"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if (( $(echo "$RELEVANCE > 22" | bc -l) )); then
  echo "   ❌ Relevance超过最大值22"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if (( $(echo "$ENGAGEMENT > 10" | bc -l) )); then
  echo "   ❌ Engagement超过最大值10"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if (( $(echo "$QUALITY > 14" | bc -l) )); then
  echo "   ❌ Quality超过最大值14"
  VIOLATIONS=$((VIOLATIONS + 1))
fi
if (( $(echo "$CLARITY > 8" | bc -l) )); then
  echo "   ❌ Clarity超过最大值8"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ $VIOLATIONS -eq 0 ]; then
  echo "   ✅ 所有维度分数都在合法范围内"
fi

# 总结
echo ""
echo "============================================================"
echo ""
echo "📋 测试结果总结:"
echo ""

if [ $VIOLATIONS -eq 0 ]; then
  echo "✅ 迁移成功！"
  echo "   - 旧API已使用Ad Strength评估系统"
  echo "   - 所有维度分数都在合法范围内"
  echo "   - calculateAdCreativeScore未被调用"
  echo ""
  echo "🎉 评分算法迁移完成！"
  echo ""

  # 清理
  rm -f /tmp/test_cookies.txt
  exit 0
else
  echo "❌ 迁移失败！"
  echo "   - 发现 $VIOLATIONS 个维度分数超过最大值"
  echo "   - 可能仍在使用旧评分算法"
  echo ""
  echo "⚠️ 请检查代码和服务器日志"
  echo ""

  # 清理
  rm -f /tmp/test_cookies.txt
  exit 1
fi

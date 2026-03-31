#!/bin/bash

# 测试旧API是否使用Ad Strength评估系统

echo "🧪 测试评分算法迁移 - API调用测试"
echo ""

# 读取密码
if [ -z "$AUTOADS_PASSWORD" ]; then
  echo "⚠️  环境变量 AUTOADS_PASSWORD 未设置"
  echo "请设置密码: export AUTOADS_PASSWORD='your-password'"
  exit 1
fi

# 1. 登录获取Cookie
echo "1️⃣ 登录获取认证..."
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"autoads\", \"password\": \"$AUTOADS_PASSWORD\"}" > /dev/null

if [ $? -eq 0 ]; then
  echo "   ✅ 登录成功"
else
  echo "   ❌ 登录失败"
  exit 1
fi

echo ""
echo "2️⃣ 调用旧API生成广告创意（Offer 51）..."
echo "   API: POST /api/offers/51/generate-ad-creative"
echo ""

# 2. 调用旧API生成创意
response=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/offers/51/generate-ad-creative \
  -H "Content-Type: application/json" \
  -d '{"generation_round": 1}')

# 检查响应
if echo "$response" | grep -q '"success":true'; then
  echo "   ✅ API调用成功"
  echo ""

  # 提取评分信息
  creative_id=$(echo "$response" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
  score=$(echo "$response" | grep -o '"score":[0-9.]*' | head -1 | cut -d: -f2)

  echo "3️⃣ 生成的创意信息："
  echo "   创意ID: $creative_id"
  echo "   评分: $score"
  echo ""

  # 查询数据库验证
  echo "4️⃣ 查询数据库验证评分："
  sqlite3 data/autoads.db "SELECT id, score, score_breakdown FROM ad_creatives WHERE id = $creative_id;" | while IFS='|' read id score breakdown; do
    echo "   ID: $id"
    echo "   Score: $score"
    echo "   Breakdown: $breakdown"

    # 解析breakdown检查是否超过最大值
    diversity=$(echo "$breakdown" | grep -o '"diversity":[0-9.]*' | cut -d: -f2)
    relevance=$(echo "$breakdown" | grep -o '"relevance":[0-9.]*' | cut -d: -f2)
    engagement=$(echo "$breakdown" | grep -o '"engagement":[0-9.]*' | cut -d: -f2)
    quality=$(echo "$breakdown" | grep -o '"quality":[0-9.]*' | cut -d: -f2)
    clarity=$(echo "$breakdown" | grep -o '"clarity":[0-9.]*' | cut -d: -f2)

    echo ""
    echo "   维度分数："
    echo "   - Diversity: $diversity / 18"
    echo "   - Relevance: $relevance / 22"
    echo "   - Engagement: $engagement / 10"
    echo "   - Quality: $quality / 14"
    echo "   - Clarity: $clarity / 8"
    echo ""

    # 检查是否超过最大值
    violations=0
    if (( $(echo "$diversity > 18" | bc -l) )); then
      echo "   ❌ Diversity超过最大值18"
      violations=$((violations + 1))
    fi
    if (( $(echo "$relevance > 22" | bc -l) )); then
      echo "   ❌ Relevance超过最大值22"
      violations=$((violations + 1))
    fi
    if (( $(echo "$engagement > 10" | bc -l) )); then
      echo "   ❌ Engagement超过最大值10"
      violations=$((violations + 1))
    fi
    if (( $(echo "$quality > 14" | bc -l) )); then
      echo "   ❌ Quality超过最大值14"
      violations=$((violations + 1))
    fi
    if (( $(echo "$clarity > 8" | bc -l) )); then
      echo "   ❌ Clarity超过最大值8"
      violations=$((violations + 1))
    fi

    if [ $violations -eq 0 ]; then
      echo "   ✅ 所有维度分数都在合法范围内"
      echo ""
      echo "📋 测试结论：迁移成功！使用了Ad Strength评估系统"
    else
      echo ""
      echo "   ⚠️ 发现 $violations 个维度超过最大值"
      echo ""
      echo "📋 测试结论：迁移失败！仍在使用旧评分算法"
    fi
  done

else
  echo "   ❌ API调用失败"
  echo "   响应: $response"
  exit 1
fi

echo ""
echo "🧹 清理临时文件..."
rm -f /tmp/cookies.txt

echo "✅ 测试完成"

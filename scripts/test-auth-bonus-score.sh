#!/bin/bash

# Test Login and Bonus Score System
# 使用autoads用户登录并测试bonus score功能

echo "🔐 Testing Login with autoads user..."
echo "=================================="

# 读取密码
if [ -z "$AUTOADS_PASSWORD" ]; then
  echo "⚠️  环境变量 AUTOADS_PASSWORD 未设置"
  echo "请设置密码: export AUTOADS_PASSWORD='your-password'"
  exit 1
fi

# Step 1: Login
echo ""
echo "Step 1: Login with autoads user"
LOGIN_RESPONSE=$(curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"autoads\", \"password\": \"$AUTOADS_PASSWORD\"}")

echo "Login Response:"
echo "$LOGIN_RESPONSE" | jq '.'

# Check if login was successful
SUCCESS=$(echo "$LOGIN_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  echo "✅ Login successful! Session cookie acquired."
else
  echo "❌ Login failed!"
  exit 1
fi

# Step 2: Test Bonus Score API
echo ""
echo "Step 2: Test Bonus Score API for Creative 76"
BONUS_RESPONSE=$(curl -s -b /tmp/cookies.txt http://localhost:3000/api/ad-creatives/76/bonus-score)

echo "Bonus Score Response:"
echo "$BONUS_RESPONSE" | jq '.'

# Step 3: Test Conversion Feedback Submission
echo ""
echo "Step 3: Submit Conversion Feedback"
FEEDBACK_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST \
  http://localhost:3000/api/ad-creatives/76/conversion-feedback \
  -H "Content-Type: application/json" \
  -d '{
    "conversions": 25,
    "conversionValue": 2000,
    "periodStart": "2025-11-01",
    "periodEnd": "2025-11-23",
    "feedbackNote": "Test feedback from curl"
  }')

echo "Feedback Response:"
echo "$FEEDBACK_RESPONSE" | jq '.'

if echo "$FEEDBACK_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo "✅ Conversion feedback submitted successfully!"

  # Check updated bonus score
  echo ""
  echo "Step 4: Verify Updated Bonus Score"
  UPDATED_BONUS=$(curl -s -b /tmp/cookies.txt http://localhost:3000/api/ad-creatives/76/bonus-score)
  echo "$UPDATED_BONUS" | jq '.'
else
  echo "⚠️  Feedback submission response: $(echo "$FEEDBACK_RESPONSE" | jq -r '.message // .error')"
fi

echo ""
echo "=================================="
echo "✅ Authentication & Bonus Score Test Complete!"
echo ""
echo "Next: Open http://localhost:3000/offers/49/launch in browser"
echo "      Login with autoads user (password from environment variable)"

# Cleanup
rm -f /tmp/cookies.txt

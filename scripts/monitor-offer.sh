#!/bin/bash
# Offer抓取状态实时监控脚本

OFFER_ID=$1

if [ -z "$OFFER_ID" ]; then
  echo "用法: $0 <offer_id>"
  echo "示例: $0 49"
  exit 1
fi

DB_PATH="./data/autoads.db"

if [ ! -f "$DB_PATH" ]; then
  echo "错误: 数据库文件不存在: $DB_PATH"
  exit 1
fi

echo "========================================"
echo "监控 Offer #$OFFER_ID 抓取状态"
echo "========================================"
echo "按 Ctrl+C 停止监控"
echo ""

LAST_STATUS=""

while true; do
  # 查询Offer状态
  RESULT=$(sqlite3 "$DB_PATH" "SELECT
    scrape_status,
    CASE WHEN brand_description IS NOT NULL THEN '✅' ELSE '❌' END,
    CASE WHEN product_highlights IS NOT NULL THEN '✅' ELSE '❌' END,
    CASE WHEN target_audience IS NOT NULL THEN '✅' ELSE '❌' END,
    CASE WHEN unique_selling_points IS NOT NULL THEN '✅' ELSE '❌' END,
    scrape_error
  FROM offers WHERE id = $OFFER_ID;")

  if [ -z "$RESULT" ]; then
    echo "错误: Offer #$OFFER_ID 不存在"
    exit 1
  fi

  # 解析结果
  STATUS=$(echo "$RESULT" | cut -d'|' -f1)
  BRAND_DESC=$(echo "$RESULT" | cut -d'|' -f2)
  PRODUCT_HL=$(echo "$RESULT" | cut -d'|' -f3)
  TARGET_AUD=$(echo "$RESULT" | cut -d'|' -f4)
  USP=$(echo "$RESULT" | cut -d'|' -f5)
  ERROR=$(echo "$RESULT" | cut -d'|' -f6)

  # 只在状态变化时打印
  if [ "$STATUS" != "$LAST_STATUS" ]; then
    TIMESTAMP=$(date '+%H:%M:%S')
    echo "[$TIMESTAMP] 状态变化: $LAST_STATUS → $STATUS"
    LAST_STATUS=$STATUS
  fi

  # 清屏并显示当前状态
  clear
  echo "========================================"
  echo "Offer #$OFFER_ID 抓取监控"
  echo "========================================"
  echo "当前时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  echo "抓取状态: $STATUS"
  echo ""
  echo "数据完整度:"
  echo "  品牌描述: $BRAND_DESC"
  echo "  产品亮点: $PRODUCT_HL"
  echo "  目标受众: $TARGET_AUD"
  echo "  USP:      $USP"
  echo ""

  if [ ! -z "$ERROR" ]; then
    echo "错误信息:"
    echo "  $ERROR"
    echo ""
  fi

  # 完成或失败则退出
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "========================================"
    echo "抓取已结束，最终状态: $STATUS"
    echo "========================================"
    exit 0
  fi

  echo "刷新间隔: 2秒 (按Ctrl+C停止)"
  sleep 2
done

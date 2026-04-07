#!/bin/bash

# Google Ads 广告系列自动同步配置脚本
# 用法：./setup-auto-sync.sh

set -e

echo "🔧 Google Ads 广告系列自动同步配置"
echo "=================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
  echo "❌ 错误：请在项目根目录运行此脚本"
  exit 1
fi

# 生成 CRON_SECRET
echo "📝 生成 CRON_SECRET..."
CRON_SECRET=$(openssl rand -hex 32)
echo "✅ CRON_SECRET 已生成"
echo ""

# 创建或更新 .env.local
echo "📝 配置环境变量..."
if [ -f ".env.local" ]; then
  # 检查是否已存在 CRON_SECRET
  if grep -q "^CRON_SECRET=" ".env.local"; then
    echo "⚠️  .env.local 中已存在 CRON_SECRET"
    read -p "是否覆盖？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      sed -i.bak "/^CRON_SECRET=/d" ".env.local"
      echo "CRON_SECRET=$CRON_SECRET" >> .env.local
      echo "✅ CRON_SECRET 已更新"
    else
      echo "⏭️  跳过 CRON_SECRET 配置"
    fi
  else
    echo "CRON_SECRET=$CRON_SECRET" >> .env.local
    echo "✅ CRON_SECRET 已添加到 .env.local"
  fi
else
  echo "CRON_SECRET=$CRON_SECRET" > .env.local
  echo "✅ .env.local 已创建"
fi
echo ""

# 创建 vercel.json（如果不存在）
echo "📝 配置 Vercel Cron..."
if [ -f "vercel.json" ]; then
  echo "⚠️  vercel.json 已存在"
  read -p "是否添加 cron 配置？(y/N): " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    # 备份原文件
    cp vercel.json vercel.json.bak
    
    # 使用 Node.js 脚本添加 cron 配置（更可靠的 JSON 处理）
    node -e "
      const fs = require('fs');
      const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
      
      if (!vercel.crons) {
        vercel.crons = [];
      }
      
      const exists = vercel.crons.some(c => c.path === '/api/cron/sync-google-ads-campaigns');
      if (!exists) {
        vercel.crons.push({
          path: '/api/cron/sync-google-ads-campaigns',
          schedule: '0 */6 * * *'
        });
        fs.writeFileSync('vercel.json', JSON.stringify(vercel, null, 2));
        console.log('✅ Cron 配置已添加到 vercel.json');
      } else {
        console.log('⚠️  Cron 配置已存在');
      }
    "
  else
    echo "⏭️  跳过 vercel.json 配置"
  fi
else
  cat > vercel.json << 'EOF'
{
  "crons": [
    {
      "path": "/api/cron/sync-google-ads-campaigns",
      "schedule": "0 */6 * * *"
    }
  ]
}
EOF
  echo "✅ vercel.json 已创建"
fi
echo ""

# 显示配置摘要
echo "📊 配置摘要"
echo "============"
echo ""
echo "环境变量:"
echo "  CRON_SECRET=$CRON_SECRET"
echo ""
echo "Cron 配置:"
echo "  路径：/api/cron/sync-google-ads-campaigns"
echo "  频率：每 6 小时执行一次 (0 */6 * * *)"
echo "  时间：00:00, 06:00, 12:00, 18:00 (北京时间)"
echo ""

# 提示下一步操作
echo "📋 下一步操作"
echo "============"
echo ""
echo "1. 验证配置:"
echo "   cat .env.local | grep CRON_SECRET"
echo "   cat vercel.json | grep -A2 crons"
echo ""
echo "2. 部署到 Vercel:"
echo "   vercel --prod"
echo ""
echo "3. 验证 Cron 状态:"
echo "   vercel cron ls"
echo ""
echo "4. 测试手动触发:"
echo "   curl -X POST https://your-domain.vercel.app/api/cron/sync-google-ads-campaigns \\"
echo "     -H \"Authorization: Bearer \$CRON_SECRET\""
echo ""
echo "5. 查看同步日志:"
echo "   访问数据库，查询 sync_logs 表"
echo ""

echo "🎉 配置完成！"
echo ""

# 保存配置到文件
cat > temp/auto-sync-config-summary.txt << EOF
Google Ads 广告系列自动同步配置摘要
====================================

配置时间：$(date -Iseconds)

环境变量:
  CRON_SECRET=$CRON_SECRET

Cron 配置:
  路径：/api/cron/sync-google-ads-campaigns
  频率：每 6 小时执行一次 (0 */6 * * *)
  时间：00:00, 06:00, 12:00, 18:00 (北京时间)

部署命令:
  vercel --prod

验证命令:
  vercel cron ls
  curl -X POST https://your-domain.vercel.app/api/cron/sync-google-ads-campaigns \\
    -H "Authorization: Bearer $CRON_SECRET"

详细文档:
  temp/AUTO_SYNC_CONFIG_GUIDE.md
EOF

echo "💾 配置摘要已保存到：temp/auto-sync-config-summary.txt"
echo ""

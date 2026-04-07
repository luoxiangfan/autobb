#!/bin/bash

# Docker 部署 - Google Ads 广告系列自动同步配置脚本
# 用法：./docker-deploy-sync.sh

set -e

echo "🔧 Docker 部署 - Google Ads 广告系列自动同步配置"
echo "================================================"
echo ""

# 检查是否在正确的目录
if [ ! -f "docker-compose.prod.yml" ]; then
  echo "❌ 错误：请在项目根目录运行此脚本"
  exit 1
fi

# 检查 Docker 是否运行
if ! command -v docker &> /dev/null; then
  echo "❌ 错误：Docker 未安装"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "❌ 错误：Docker 未运行或无权限"
  exit 1
fi

# 选择配置方式
echo "请选择配置方式:"
echo "1. Scheduler 进程集成（推荐 - 需要修改代码）"
echo "2. Host Crontab（简单 - 无需修改代码）"
echo "3. 独立 Cron 容器（隔离 - 需要额外容器）"
echo ""
read -p "请选择 [1-3]: " choice

case $choice in
  1)
    echo ""
    echo "📝 方案 1: Scheduler 进程集成"
    echo "================================"
    echo ""
    
    # 检查代码是否已修改
    if grep -q "syncAllUsersCampaigns" src/scheduler.ts; then
      echo "✅ Scheduler 代码已包含 Google Ads 同步"
    else
      echo "⚠️  Scheduler 代码未包含 Google Ads 同步"
      echo ""
      echo "需要手动修改 src/scheduler.ts，添加以下内容："
      echo ""
      echo "1. 在文件顶部添加导入:"
      echo "   import { syncAllUsersCampaigns } from './lib/google-ads-campaign-sync'"
      echo ""
      echo "2. 添加同步任务函数（约第 1100 行）:"
      echo "   async function googleAdsCampaignSyncTask() {"
      echo "     log('🔄 开始执行 Google Ads 广告系列同步任务...')"
      echo "     try {"
      echo "       const result = await syncAllUsersCampaigns()"
      echo "       log(\`🔄 Google Ads 广告系列同步完成:\`, result)"
      echo "     } catch (error) {"
      echo "       logError('❌ Google Ads 广告系列同步失败:', error)"
      echo "     }"
      echo "   }"
      echo ""
      echo "3. 在 main() 中添加定时任务（约第 1250 行）:"
      echo "   const googleAdsSyncCron = process.env.GOOGLE_ADS_SYNC_CRON || '0 */6 * * *'"
      echo "   cron.schedule(googleAdsSyncCron, async () => {"
      echo "     await googleAdsCampaignSyncTask()"
      echo "   }, { scheduled: true, timezone: 'Asia/Shanghai' })"
      echo ""
      read -p "是否继续配置环境变量？(y/N): " confirm
      if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "⏭️  跳过配置"
        exit 0
      fi
    fi
    
    # 生成 CRON_SECRET
    echo ""
    echo "📝 生成环境变量..."
    if [ ! -f ".env" ]; then
      touch .env
      echo "✅ .env 文件已创建"
    fi
    
    if ! grep -q "^CRON_SECRET=" .env; then
      CRON_SECRET=$(openssl rand -hex 32)
      echo "CRON_SECRET=$CRON_SECRET" >> .env
      echo "✅ CRON_SECRET 已生成并添加到 .env"
    else
      echo "⚠️  .env 中已存在 CRON_SECRET"
    fi
    
    if ! grep -q "^GOOGLE_ADS_SYNC_CRON=" .env; then
      echo "GOOGLE_ADS_SYNC_CRON=0 */6 * * *" >> .env
      echo "✅ GOOGLE_ADS_SYNC_CRON 已添加到 .env"
    else
      echo "⚠️  .env 中已存在 GOOGLE_ADS_SYNC_CRON"
    fi
    
    # 更新 docker-compose.prod.yml
    echo ""
    echo "📝 检查 docker-compose.prod.yml..."
    if ! grep -q "GOOGLE_ADS_SYNC_CRON" docker-compose.prod.yml; then
      echo "⚠️  docker-compose.prod.yml 需要手动添加环境变量"
      echo ""
      echo "在 app 服务的 environment 部分添加:"
      echo "  - GOOGLE_ADS_SYNC_CRON=\${GOOGLE_ADS_SYNC_CRON}"
      echo "  - CRON_SECRET=\${CRON_SECRET}"
      echo ""
      read -p "是否自动备份并提示修改？(y/N): " confirm
      if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        cp docker-compose.prod.yml docker-compose.prod.yml.bak
        echo "✅ 已备份 docker-compose.prod.yml"
        echo ""
        echo "请手动修改 docker-compose.prod.yml，然后按回车继续..."
        read
      fi
    else
      echo "✅ docker-compose.prod.yml 已配置"
    fi
    
    # 构建和部署
    echo ""
    echo "📦 开始构建和部署..."
    read -p "是否现在构建并重启容器？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "🔨 构建 Docker 镜像..."
      docker-compose -f docker-compose.prod.yml build
      
      echo ""
      echo "⏹️  停止现有容器..."
      docker-compose -f docker-compose.prod.yml down
      
      echo ""
      echo "▶️  启动新容器..."
      docker-compose -f docker-compose.prod.yml up -d
      
      echo ""
      echo "⏳ 等待服务启动..."
      sleep 15
      
      echo ""
      echo "📊 查看 scheduler 日志..."
      docker-compose -f docker-compose.prod.yml logs scheduler | grep -i "google\|sync" || echo "⏳ 等待同步任务启动..."
      
      echo ""
      echo "✅ 部署完成！"
    else
      echo "⏭️  跳过构建和部署"
    fi
    ;;
    
  2)
    echo ""
    echo "📝 方案 2: Host Crontab"
    echo "======================="
    echo ""
    
    # 生成 CRON_SECRET
    if [ ! -f ".env" ]; then
      touch .env
    fi
    
    if ! grep -q "^CRON_SECRET=" .env; then
      CRON_SECRET=$(openssl rand -hex 32)
      echo "CRON_SECRET=$CRON_SECRET" >> .env
      echo "✅ CRON_SECRET 已生成并添加到 .env"
    else
      CRON_SECRET=$(grep "^CRON_SECRET=" .env | cut -d'=' -f2)
      echo "✅ 使用现有的 CRON_SECRET"
    fi
    
    echo ""
    echo "📝 配置 Host Crontab..."
    echo ""
    echo "以下命令将添加到你的 crontab:"
    echo ""
    echo "0 */6 * * * docker exec autoads-app curl -s -X POST \\"
    echo "  -H \"Authorization: Bearer $CRON_SECRET\" \\"
    echo "  http://localhost:3000/api/cron/sync-google-ads-campaigns \\"
    echo "  >> /var/log/google-ads-sync.log 2>&1"
    echo ""
    
    read -p "是否添加到 crontab？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      # 创建临时 cron 文件
      CRON_FILE=$(mktemp)
      echo "0 */6 * * * docker exec autoads-app curl -s -X POST -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/cron/sync-google-ads-campaigns >> /var/log/google-ads-sync.log 2>&1" > $CRON_FILE
      
      # 安装 cron 任务
      crontab $CRON_FILE
      rm $CRON_FILE
      
      echo "✅ Cron 任务已添加"
      echo ""
      echo "📊 验证:"
      echo "crontab -l"
      echo ""
      
      echo "🧪 手动触发测试..."
      docker exec autoads-app curl -s -X POST \
        -H "Authorization: Bearer $CRON_SECRET" \
        http://localhost:3000/api/cron/sync-google-ads-campaigns | head -20
      
      echo ""
      echo "✅ 配置完成！"
    else
      echo "⏭️  跳过 crontab 配置"
      echo ""
      echo "手动执行以下命令添加:"
      echo "crontab -e"
      echo ""
      echo "添加以下行:"
      echo "0 */6 * * * docker exec autoads-app curl -s -X POST -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/cron/sync-google-ads-campaigns >> /var/log/google-ads-sync.log 2>&1"
    fi
    ;;
    
  3)
    echo ""
    echo "📝 方案 3: 独立 Cron 容器"
    echo "========================="
    echo ""
    
    # 创建 docker-compose.cron.yml
    echo "📝 创建 docker-compose.cron.yml..."
    cat > docker-compose.cron.yml << 'EOF'
version: '3.9'

services:
  cron:
    image: alpine:latest
    container_name: autoads-cron
    restart: unless-stopped
    environment:
      - CRON_SECRET=${CRON_SECRET}
      - APP_URL=http://autoads-app:3000
    volumes:
      - ./cron-scripts:/etc/cron.d
    command: >
      sh -c '
        echo "Installing cron jobs..." &&
        crontab /etc/cron.d/google-ads-sync &&
        echo "Starting crond..." &&
        crond -f -L /dev/stdout
      '
    networks:
      - autoads-network

networks:
  autoads-network:
    external: true
EOF
    echo "✅ docker-compose.cron.yml 已创建"
    
    # 创建 cron-scripts 目录
    mkdir -p cron-scripts
    
    # 生成 CRON_SECRET
    if [ ! -f ".env" ]; then
      touch .env
    fi
    
    if ! grep -q "^CRON_SECRET=" .env; then
      CRON_SECRET=$(openssl rand -hex 32)
      echo "CRON_SECRET=$CRON_SECRET" >> .env
      echo "✅ CRON_SECRET 已生成"
    else
      CRON_SECRET=$(grep "^CRON_SECRET=" .env | cut -d'=' -f2)
    fi
    
    # 创建 cron 任务文件
    echo ""
    echo "📝 创建 cron 任务文件..."
    cat > cron-scripts/google-ads-sync << EOF
# Google Ads 广告系列同步任务
# 每 6 小时执行一次
0 */6 * * * wget --quiet --header="Authorization: Bearer ${CRON_SECRET}" --post-data='' -O - \${APP_URL}/api/cron/sync-google-ads-campaigns >> /proc/1/fd/1 2>&1
EOF
    echo "✅ cron-scripts/google-ads-sync 已创建"
    
    echo ""
    echo "📝 创建 .env.cron..."
    cat > .env.cron << EOF
CRON_SECRET=$CRON_SECRET
APP_URL=http://autoads-app:3000
EOF
    echo "✅ .env.cron 已创建"
    
    echo ""
    read -p "是否现在启动 cron 容器？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      echo ""
      echo "▶️  启动 cron 容器..."
      docker-compose -f docker-compose.cron.yml --env-file .env.cron up -d
      
      echo ""
      echo "📊 查看日志..."
      docker-compose -f docker-compose.cron.yml logs -f
      
      echo ""
      echo "✅ 配置完成！"
    else
      echo "⏭️  跳过容器启动"
      echo ""
      echo "手动启动命令:"
      echo "docker-compose -f docker-compose.cron.yml --env-file .env.cron up -d"
    fi
    ;;
    
  *)
    echo "❌ 无效选择"
    exit 1
    ;;
esac

echo ""
echo "📋 下一步操作"
echo "============"
echo ""
echo "1. 验证配置:"
echo "   docker-compose -f docker-compose.prod.yml logs scheduler | grep -i google"
echo ""
echo "2. 查看同步日志:"
echo "   docker-compose -f docker-compose.prod.yml exec app sqlite3 /app/autoads.db \\"
echo "     'SELECT * FROM sync_logs WHERE sync_type = \\\"google_ads_campaign_sync\\\" ORDER BY started_at DESC LIMIT 5;'"
echo ""
echo "3. 手动触发测试:"
echo "   docker-compose -f docker-compose.prod.yml exec app curl -s -X POST \\"
echo "     -H \"Authorization: Bearer \$(grep CRON_SECRET .env | cut -d'=' -f2)\" \\"
echo "     http://localhost:3000/api/cron/sync-google-ads-campaigns"
echo ""

echo "💾 配置摘要已保存到：temp/docker-sync-config-summary.txt"
mkdir -p temp
cat > temp/docker-sync-config-summary.txt << EOF
Google Ads 广告系列自动同步配置摘要（Docker 部署）
================================================

配置时间：$(date -Iseconds)
配置方案：方案 $choice

环境变量:
  CRON_SECRET=$CRON_SECRET
  GOOGLE_ADS_SYNC_CRON=0 */6 * * *

部署命令:
  docker-compose -f docker-compose.prod.yml build
  docker-compose -f docker-compose.prod.yml up -d

验证命令:
  docker-compose -f docker-compose.prod.yml logs scheduler | grep -i google
  docker-compose -f docker-compose.prod.yml exec app sqlite3 /app/autoads.db "SELECT * FROM sync_logs WHERE sync_type = 'google_ads_campaign_sync' ORDER BY started_at DESC LIMIT 5;"

详细文档:
  temp/DOCKER_SYNC_CONFIG_GUIDE.md
EOF

echo ""
echo "🎉 配置完成！"
echo ""

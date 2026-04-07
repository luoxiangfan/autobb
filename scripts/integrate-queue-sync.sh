#!/bin/bash

# 任务队列实现 - Google Ads 广告系列同步快速集成脚本
# 用法：./integrate-queue-sync.sh

set -e

echo "🔧 任务队列实现 - Google Ads 广告系列同步集成"
echo "=============================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
  echo "❌ 错误：请在项目根目录运行此脚本"
  exit 1
fi

# 检查文件是否存在
if [ ! -f "src/lib/queue/schedulers/google-ads-campaign-sync-scheduler.ts" ]; then
  echo "❌ 错误：调度器文件不存在"
  echo "   请先创建：src/lib/queue/schedulers/google-ads-campaign-sync-scheduler.ts"
  exit 1
fi

if [ ! -f "src/lib/queue/executors/google-ads-campaign-sync-executor.ts" ]; then
  echo "❌ 错误：执行器文件不存在"
  echo "   请先创建：src/lib/queue/executors/google-ads-campaign-sync-executor.ts"
  exit 1
fi

echo "✅ 调度器和执行器文件已存在"
echo ""

# 步骤 1: 修改 scheduler.ts
echo "📝 步骤 1: 修改 scheduler.ts"
echo "=============================="
echo ""

if grep -q "getGoogleAdsCampaignSyncScheduler" src/scheduler.ts; then
  echo "✅ scheduler.ts 已包含 Google Ads 同步调度器"
else
  echo "⚠️  需要手动修改 src/scheduler.ts"
  echo ""
  echo "请在 startScheduler() 函数中添加以下代码："
  echo ""
  echo "// 在文件顶部添加导入:"
  echo "import { getGoogleAdsCampaignSyncScheduler } from './lib/queue/schedulers/google-ads-campaign-sync-scheduler'"
  echo ""
  echo "// 在 startScheduler() 函数中（约第 1340 行）添加:"
  echo "const googleAdsSyncScheduler = getGoogleAdsCampaignSyncScheduler()"
  echo "googleAdsSyncScheduler.start()"
  echo ""
  
  read -p "是否自动添加？(y/N): " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    # 添加导入
    if ! grep -q "import.*google-ads-campaign-sync-scheduler" src/scheduler.ts; then
      sed -i.bak "/import.*queue\/schedulers/a\\import { getGoogleAdsCampaignSyncScheduler } from './lib/queue/schedulers/google-ads-campaign-sync-scheduler'" src/scheduler.ts
      echo "✅ 导入语句已添加"
    fi
    
    # 添加启动代码
    if ! grep -q "googleAdsSyncScheduler.start" src/scheduler.ts; then
      sed -i.bak "/startScheduler()/a\\  const googleAdsSyncScheduler = getGoogleAdsCampaignSyncScheduler()\\n  googleAdsSyncScheduler.start()" src/scheduler.ts
      echo "✅ 启动代码已添加"
    fi
    
    echo "✅ scheduler.ts 修改完成"
  else
    echo "⏭️  跳过 scheduler.ts 修改"
  fi
fi

echo ""

# 步骤 2: 注册执行器
echo "📝 步骤 2: 注册队列执行器"
echo "=========================="
echo ""

if [ -f "src/lib/queue/executors/background-executors.ts" ]; then
  if grep -q "executeGoogleAdsCampaignSyncTask" src/lib/queue/executors/background-executors.ts; then
    echo "✅ 执行器已注册"
  else
    echo "⚠️  需要注册执行器"
    echo ""
    echo "请在 src/lib/queue/executors/background-executors.ts 中添加:"
    echo ""
    echo "import { executeGoogleAdsCampaignSyncTask } from './google-ads-campaign-sync-executor'"
    echo ""
    echo "// 在 registerBackgroundExecutors 函数中添加:"
    echo "queue.registerExecutor('google-ads-campaign-sync', executeGoogleAdsCampaignSyncTask)"
    echo ""
    
    read -p "是否自动添加？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      # 添加导入
      if ! grep -q "import.*google-ads-campaign-sync-executor" src/lib/queue/executors/background-executors.ts; then
        sed -i.bak "/import.*executors/a\\import { executeGoogleAdsCampaignSyncTask } from './google-ads-campaign-sync-executor'" src/lib/queue/executors/background-executors.ts
        echo "✅ 导入语句已添加"
      fi
      
      # 添加注册代码
      if ! grep -q "registerExecutor.*google-ads-campaign-sync" src/lib/queue/executors/background-executors.ts; then
        sed -i.bak "/registerBackgroundExecutors/a\\  queue.registerExecutor('google-ads-campaign-sync', executeGoogleAdsCampaignSyncTask)" src/lib/queue/executors/background-executors.ts
        echo "✅ 注册代码已添加"
      fi
      
      echo "✅ 执行器已注册"
    else
      echo "⏭️  跳过执行器注册"
    fi
  fi
else
  echo "⚠️  background-executors.ts 不存在，需要手动注册执行器"
  echo ""
  echo "请在队列初始化代码中添加:"
  echo "queue.registerExecutor('google-ads-campaign-sync', executeGoogleAdsCampaignSyncTask)"
fi

echo ""

# 步骤 3: 配置环境变量
echo "📝 步骤 3: 配置环境变量"
echo "========================"
echo ""

if [ ! -f ".env" ]; then
  touch .env
  echo "✅ .env 文件已创建"
fi

# 检查是否已配置
if grep -q "QUEUE_GOOGLE_ADS_SYNC" .env; then
  echo "⚠️  .env 中已存在 Google Ads 同步配置"
else
  cat >> .env << 'EOF'

# Google Ads 广告系列同步配置
QUEUE_GOOGLE_ADS_SYNC_RUN_ON_START=true
QUEUE_GOOGLE_ADS_SYNC_STARTUP_DELAY_MS=30000
QUEUE_GOOGLE_ADS_SYNC_INTERVAL_HOURS=6
EOF
  echo "✅ 环境变量已添加到 .env"
fi

echo ""

# 步骤 4: 更新 docker-compose（如果存在）
echo "📝 步骤 4: 检查 Docker 配置"
echo "============================"
echo ""

if [ -f "docker-compose.prod.yml" ]; then
  if grep -q "QUEUE_GOOGLE_ADS_SYNC" docker-compose.prod.yml; then
    echo "✅ docker-compose.prod.yml 已配置"
  else
    echo "⚠️  docker-compose.prod.yml 需要添加环境变量"
    echo ""
    echo "请在 app 服务的 environment 部分添加:"
    echo "  - QUEUE_GOOGLE_ADS_SYNC_RUN_ON_START=true"
    echo "  - QUEUE_GOOGLE_ADS_SYNC_STARTUP_DELAY_MS=30000"
    echo "  - QUEUE_GOOGLE_ADS_SYNC_INTERVAL_HOURS=6"
    echo ""
    
    read -p "是否自动备份并提示修改？(y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
      cp docker-compose.prod.yml docker-compose.prod.yml.bak
      echo "✅ 已备份 docker-compose.prod.yml"
      echo ""
      echo "请手动修改 docker-compose.prod.yml，然后按回车继续..."
      read
    fi
  fi
else
  echo "ℹ️  未找到 docker-compose.prod.yml，跳过 Docker 配置"
fi

echo ""

# 步骤 5: 构建和部署
echo "📦 步骤 5: 构建和部署"
echo "======================"
echo ""

read -p "是否现在构建并重启？(y/N): " confirm
if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
  if [ -f "docker-compose.prod.yml" ]; then
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
    docker-compose -f docker-compose.prod.yml logs scheduler | grep -i "google.*sync" || echo "⏳ 等待调度器启动..."
    
    echo ""
    echo "✅ 部署完成！"
  else
    echo ""
    echo "🔨 构建项目..."
    npm run build
    
    echo ""
    echo "⚠️  请手动重启 scheduler 进程"
    echo "npm run scheduler"
  fi
else
  echo "⏭️  跳过构建和部署"
fi

echo ""
echo "📋 下一步操作"
echo "============"
echo ""
echo "1. 验证调度器启动:"
echo "   docker-compose -f docker-compose.prod.yml logs scheduler | grep -i 'google.*sync'"
echo ""
echo "2. 查看队列状态:"
echo "   curl http://localhost:3000/api/queue/scheduler"
echo ""
echo "3. 查看同步日志:"
echo "   docker-compose -f docker-compose.prod.yml exec app sqlite3 /app/autoads.db \\"
echo "     'SELECT * FROM sync_logs WHERE sync_type = \"google_ads_campaign_sync\" ORDER BY started_at DESC LIMIT 5;'"
echo ""
echo "4. 手动触发测试:"
echo "   使用 API 或直接在代码中调用 scheduler.triggerManualSync(userId)"
echo ""

echo "💾 配置摘要已保存到：temp/queue-sync-integration-summary.txt"
mkdir -p temp
cat > temp/queue-sync-integration-summary.txt << EOF
Google Ads 广告系列同步 - 任务队列集成摘要
==========================================

集成时间：$(date -Iseconds)

已创建文件:
  - src/lib/queue/schedulers/google-ads-campaign-sync-scheduler.ts
  - src/lib/queue/executors/google-ads-campaign-sync-executor.ts

已修改文件:
  - src/scheduler.ts (如已自动修改)
  - src/lib/queue/executors/background-executors.ts (如已自动修改)

环境变量:
  QUEUE_GOOGLE_ADS_SYNC_RUN_ON_START=true
  QUEUE_GOOGLE_ADS_SYNC_STARTUP_DELAY_MS=30000
  QUEUE_GOOGLE_ADS_SYNC_INTERVAL_HOURS=6

部署命令:
  docker-compose -f docker-compose.prod.yml build
  docker-compose -f docker-compose.prod.yml up -d

验证命令:
  docker-compose -f docker-compose.prod.yml logs scheduler | grep -i 'google.*sync'
  curl http://localhost:3000/api/queue/scheduler

详细文档:
  temp/QUEUE_BASED_SYNC_IMPLEMENTATION.md
EOF

echo ""
echo "🎉 集成完成！"
echo ""

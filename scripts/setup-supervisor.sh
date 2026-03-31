#!/bin/bash
# Supervisord自动化部署脚本
# 用途：一键配置supervisord并启动所有服务

set -e  # 遇到错误立即退出

echo "🚀 AutoAds Supervisord 自动化部署脚本"
echo "======================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📁 项目目录: $PROJECT_ROOT"

# ==========================================
# 步骤1: 检查系统依赖
# ==========================================
echo ""
echo "📦 步骤1: 检查系统依赖..."

# 检查supervisord
if ! command -v supervisord &> /dev/null; then
    echo -e "${YELLOW}⚠️  supervisord 未安装${NC}"
    echo "正在安装 supervisord..."

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Ubuntu/Debian
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y supervisor
        # CentOS/RHEL
        elif command -v yum &> /dev/null; then
            sudo yum install -y supervisor
        else
            echo -e "${RED}❌ 无法自动安装supervisord，请手动安装${NC}"
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install supervisor
        else
            echo -e "${RED}❌ 请先安装Homebrew: https://brew.sh/${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ 不支持的操作系统: $OSTYPE${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ supervisord 已安装${NC}"
else
    echo -e "${GREEN}✅ supervisord 已存在${NC}"
fi

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装，请先安装 Node.js 18+${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# 检查npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm $(npm -v)${NC}"

# ==========================================
# 步骤2: 创建必要的目录
# ==========================================
echo ""
echo "📂 步骤2: 创建必要的目录..."

mkdir -p logs
mkdir -p tmp
mkdir -p data/backups

echo -e "${GREEN}✅ 目录创建完成${NC}"

# ==========================================
# 步骤3: 安装npm依赖
# ==========================================
echo ""
echo "📦 步骤3: 检查npm依赖..."

if [ ! -d "node_modules" ]; then
    echo "正在安装npm依赖..."
    npm install
    echo -e "${GREEN}✅ npm依赖安装完成${NC}"
else
    echo -e "${GREEN}✅ npm依赖已存在${NC}"
fi

# ==========================================
# 步骤4: 构建Next.js应用
# ==========================================
echo ""
echo "🏗️  步骤4: 构建Next.js应用..."

if [ ! -d ".next" ]; then
    echo "正在构建应用..."
    npm run build
    echo -e "${GREEN}✅ 应用构建完成${NC}"
else
    echo -e "${YELLOW}⚠️  .next目录已存在，跳过构建（如需重新构建请运行: npm run build）${NC}"
fi

# ==========================================
# 步骤5: 配置环境变量
# ==========================================
echo ""
echo "⚙️  步骤5: 配置环境变量..."

# 替换supervisord.conf中的用户变量
export USER=$(whoami)
echo "当前用户: $USER"

# 创建配置文件副本并替换变量
envsubst < supervisord.conf > supervisord-generated.conf
echo -e "${GREEN}✅ supervisord配置已生成${NC}"

# ==========================================
# 步骤6: 停止现有的supervisord进程
# ==========================================
echo ""
echo "🛑 步骤6: 停止现有进程..."

if [ -f "tmp/supervisord.pid" ]; then
    if supervisorctl -c supervisord-generated.conf shutdown 2>/dev/null; then
        echo -e "${GREEN}✅ 已停止现有supervisord进程${NC}"
    else
        echo -e "${YELLOW}⚠️  无法正常停止，尝试强制停止...${NC}"
        if [ -f "tmp/supervisord.pid" ]; then
            kill $(cat tmp/supervisord.pid) 2>/dev/null || true
            rm -f tmp/supervisord.pid
        fi
    fi
    sleep 2
else
    echo -e "${GREEN}✅ 无现有进程${NC}"
fi

# ==========================================
# 步骤7: 启动supervisord
# ==========================================
echo ""
echo "🚀 步骤7: 启动supervisord..."

supervisord -c supervisord-generated.conf

# 等待启动
sleep 3

# 检查状态
if supervisorctl -c supervisord-generated.conf status > /dev/null 2>&1; then
    echo -e "${GREEN}✅ supervisord 启动成功${NC}"
else
    echo -e "${RED}❌ supervisord 启动失败${NC}"
    echo "查看日志: tail -f logs/supervisord.log"
    exit 1
fi

# ==========================================
# 步骤8: 显示进程状态
# ==========================================
echo ""
echo "📊 步骤8: 进程状态"
echo "======================================"
supervisorctl -c supervisord-generated.conf status

# ==========================================
# 完成提示
# ==========================================
echo ""
echo -e "${GREEN}======================================"
echo "✅ AutoAds 部署完成！"
echo "======================================${NC}"
echo ""
echo "📝 常用命令:"
echo "  查看状态:   supervisorctl -c supervisord-generated.conf status"
echo "  查看日志:   supervisorctl -c supervisord-generated.conf tail -f autoads-web"
echo "  重启应用:   supervisorctl -c supervisord-generated.conf restart autoads-web"
echo "  重启调度器: supervisorctl -c supervisord-generated.conf restart autoads-scheduler"
echo "  停止所有:   supervisorctl -c supervisord-generated.conf shutdown"
echo ""
echo "📊 访问应用:"
echo "  Web应用: http://localhost:3000"
echo ""
echo "📁 日志文件:"
echo "  Web应用:    logs/web-output.log"
echo "  调度器:     logs/scheduler-output.log"
echo "  Supervisor: logs/supervisord.log"
echo ""
echo -e "${YELLOW}💡 提示: 服务器重启后supervisord不会自动启动${NC}"
echo -e "${YELLOW}   如需开机自启动，请参考: docs/SUPERVISOR_DEPLOYMENT.md${NC}"
echo ""

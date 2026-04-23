# AutoAds 阿里云 ECS 部署指南

## 📋 目录

1. [部署方案选择](#部署方案选择)
2. [ECS 实例配置建议](#ecs 实例配置建议)
3. [方案一：Docker 单容器部署（推荐）](#方案一 docker 单容器部署推荐)
4. [方案二：Docker Compose 部署](#方案二 docker-compose 部署)
5. [方案三：手动部署](#方案三手动部署)
6. [SSL 证书配置](#ssl 证书配置)
7. [域名配置](#域名配置)
8. [监控与运维](#监控与运维)
9. [常见问题](#常见问题)

---

## 🎯 部署方案选择

### 方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| **Docker 单容器** | 中小规模、快速部署 | 简单、隔离性好、易维护 | 灵活性较低 |
| **Docker Compose** | 生产环境、多服务 | 服务分离、易扩展 | 配置复杂 |
| **手动部署** | 特殊需求、深度定制 | 完全控制 | 维护成本高 |

**推荐**: 使用 **Docker 单容器部署**，项目已提供完整的 Dockerfile 和配置。

---

## 💻 ECS 实例配置建议

### 最低配置（测试/开发）
- **CPU**: 2 核
- **内存**: 4GB
- **存储**: 40GB SSD
- **带宽**: 1-5 Mbps
- **系统**: Ubuntu 22.04 LTS / Alibaba Cloud Linux 3

### 推荐配置（生产环境）
- **CPU**: 4-8 核
- **内存**: 8-16GB
- **存储**: 80-100GB SSD
- **带宽**: 5-10 Mbps（或按使用量计费）
- **系统**: Ubuntu 22.04 LTS / Alibaba Cloud Linux 3

### 高配配置（大规模使用）
- **CPU**: 8-16 核
- **内存**: 16-32GB
- **存储**: 200GB+ ESSD
- **带宽**: 10+ Mbps
- **系统**: Ubuntu 22.04 LTS

### 安全组配置

| 端口 | 协议 | 用途 | 开放范围 |
|------|------|------|----------|
| 80 | TCP | HTTP | 0.0.0.0/0 |
| 443 | TCP | HTTPS | 0.0.0.0/0 |
| 22 | TCP | SSH | 仅限管理 IP |

---

## 🐳 方案一：Docker 单容器部署（推荐）

### 步骤 1: 连接 ECS 服务器

```bash
# 使用 SSH 连接到 ECS
ssh root@your-ecs-public-ip
```

### 步骤 2: 安装 Docker

```bash
# 更新系统包
sudo apt update && sudo apt upgrade -y

# 安装 Docker（使用官方脚本）
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 将当前用户添加到 docker 组（可选，避免每次使用 sudo）
sudo usermod -aG docker $USER
newgrp docker

# 验证 Docker 安装
docker --version
docker run hello-world
```

### 步骤 3: 准备项目文件

#### 方式 A: 从 Git 仓库克隆（推荐）

```bash
# 安装 Git
sudo apt install -y git

# 克隆项目（替换为你的仓库地址）
cd /opt
git clone https://github.com/your-org/autobb.git
cd autobb

# 或者使用阿里云 Code
# git clone https://code.aliyun.com/your-org/autobb.git
```

#### 方式 B: 本地构建后上传

```bash
# 在本地构建 Docker 镜像
docker build -t autoads:latest .

# 保存镜像为 tar 文件
docker save autoads:latest > autoads.tar

# 上传到 ECS（使用 scp）
scp autoads.tar root@your-ecs-ip:/opt/

# 在 ECS 上加载镜像
docker load < autoads.tar
```

### 步骤 4: 配置环境变量

```bash
# 创建 .env 文件
cd /opt/autobb
cp .env.example .env

# 编辑环境变量
nano .env
```

**必要配置项**:

```bash
# ==========================================
# 应用配置
# ==========================================
NEXT_PUBLIC_APP_URL=https://your-domain.com
INTERNAL_APP_URL=http://127.0.0.1:3000
NODE_ENV=production

# ==========================================
# JWT 配置（生成随机密钥）
# ==========================================
# 使用 openssl 生成随机密钥
# openssl rand -hex 32
JWT_SECRET=your_random_64_char_hex_secret_here

# ==========================================
# 数据库配置（使用 SQLite）
# ==========================================
DATABASE_PATH=/app/data/autoads.db
BACKUP_DIR=/app/data/backups
MAX_BACKUP_DAYS=30

# 或使用 PostgreSQL（推荐生产环境）
# DATABASE_URL=postgresql://autoads:password@localhost:5432/autoads

# ==========================================
# 默认管理员密码
# ==========================================
DEFAULT_ADMIN_PASSWORD=your-strong-password-here

# ==========================================
# Google Ads API 配置
# ==========================================
GOOGLE_ADS_CLIENT_ID=your_google_ads_client_id
GOOGLE_ADS_CLIENT_SECRET=your_google_ads_client_secret
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token
GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_mcc_account_id

# ==========================================
# AI API 配置
# ==========================================
GEMINI_API_KEY=your_gemini_api_key

# ==========================================
# 数据加密配置
# ==========================================
# 使用 openssl 生成加密密钥
# openssl rand -hex 32
ENCRYPTION_KEY=your_32_byte_hex_encryption_key

# ==========================================
# Redis 配置（队列系统需要）
# ==========================================
REDIS_URL=redis://localhost:6379
QUEUE_SPLIT_BACKGROUND=true

# ==========================================
# 时区设置
# ==========================================
TZ=Asia/Shanghai
```

### 步骤 5: 创建数据目录

```bash
# 创建必要的目录
mkdir -p /opt/autobb/data/backups
mkdir -p /opt/autobb/.playwright
mkdir -p /opt/autobb/.openclaw/workspace

# 设置权限
chmod -R 755 /opt/autobb/data
chmod -R 755 /opt/autobb/.playwright
chmod -R 755 /opt/autobb/.openclaw
```

### 步骤 6: 启动 Docker 容器

#### 使用 docker run（简单方式）

```bash
cd /opt/autobb

docker run -d \
  --name autoads \
  --restart unless-stopped \
  -p 80:80 \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_APP_URL=https://your-domain.com \
  -e JWT_SECRET=your_jwt_secret \
  -e ENCRYPTION_KEY=your_encryption_key \
  -e DEFAULT_ADMIN_PASSWORD=your_admin_password \
  -e GOOGLE_ADS_CLIENT_ID=your_client_id \
  -e GOOGLE_ADS_CLIENT_SECRET=your_client_secret \
  -e GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token \
  -e GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token \
  -e GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_login_customer_id \
  -e GEMINI_API_KEY=your_gemini_api_key \
  -e REDIS_URL=redis://localhost:6379 \
  -e QUEUE_SPLIT_BACKGROUND=true \
  -e TZ=Asia/Shanghai \
  -v /opt/autobb/data:/app/data \
  -v /opt/autobb/.playwright:/app/.playwright \
  -v /opt/autobb/.openclaw:/app/.openclaw \
  --env-file .env \
  autoads:latest
```

#### 使用 docker-compose（推荐）

```bash
# 创建 docker-compose.yml
cat > /opt/autobb/docker-compose.yml << 'EOF'
version: '3.8'

services:
  autoads:
    image: autoads:latest
    container_name: autoads
    restart: unless-stopped
    ports:
      - "80:80"
    env_file:
      - .env
    environment:
      - TZ=Asia/Shanghai
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
      - ./.playwright:/app/.playwright
      - ./.openclaw:/app/.openclaw
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start-period: 40s
EOF

# 启动容器
docker-compose up -d
```

### 步骤 7: 验证部署

```bash
# 查看容器状态
docker ps

# 查看容器日志
docker logs -f autoads

# 测试健康检查
curl http://localhost/api/health

# 查看应用日志
docker exec autoads tail -f /var/log/supervisor/*.log
```

### 步骤 8: 初始化数据库

```bash
# 进入容器执行数据库初始化
docker exec -it autoads npm run db:init

# 或者手动执行
docker exec -it autoads sh -c "
  mkdir -p /app/data && \
  node scripts/db-init-smart.ts
"
```

---

## 🐙 方案二：Docker Compose 部署（含 PostgreSQL 和 Redis）

### 步骤 1: 创建完整的 docker-compose.yml

```bash
cat > /opt/autobb/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # AutoAds 应用
  autoads:
    image: autoads:latest
    container_name: autoads
    restart: unless-stopped
    ports:
      - "80:80"
    env_file:
      - .env
    environment:
      - TZ=Asia/Shanghai
      - NODE_ENV=production
      - DATABASE_URL=postgresql://autoads:postgres_password@postgres:5432/autoads
      - REDIS_URL=redis://redis:6379
      - QUEUE_SPLIT_BACKGROUND=true
      - NODE_MAX_OLD_SPACE_SIZE_WEB=5120
      - NODE_MAX_OLD_SPACE_SIZE_SCHEDULER=2048
      - NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER=4096
    volumes:
      - ./data:/app/data
      - ./.playwright:/app/.playwright
      - ./.openclaw:/app/.openclaw
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start-period: 40s
    networks:
      - autoads-network

  # PostgreSQL 数据库
  postgres:
    image: postgres:16-alpine
    container_name: autoads_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: autoads
      POSTGRES_USER: autoads
      POSTGRES_PASSWORD: postgres_password
      POSTGRES_INITDB_ARGS: "-E UTF8 --locale=C"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - autoads-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U autoads"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis 缓存（队列系统需要）
  redis:
    image: redis:7-alpine
    container_name: autoads_redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    networks:
      - autoads-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  autoads-network:
    driver: bridge
EOF
```

### 步骤 2: 启动所有服务

```bash
cd /opt/autobb

# 构建并启动
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 步骤 3: 初始化数据库

```bash
# 等待 PostgreSQL 启动完成
sleep 10

# 执行数据库迁移
docker-compose exec autoads npm run db:migrate

# 创建管理员账户
docker-compose exec autoads npm run admin:ensure
```

---

## 🔧 方案三：手动部署（不推荐）

### 步骤 1: 安装 Node.js 和依赖

```bash
# 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version  # 应显示 v20.x
npm --version   # 应显示 10.x

# 安装系统依赖
sudo apt install -y \
  python3 \
  python3-pip \
  python3-venv \
  git \
  build-essential \
  nginx \
  supervisor
```

### 步骤 2: 克隆项目并安装依赖

```bash
cd /opt
git clone https://github.com/your-org/autobb.git
cd autobb

# 安装 Node.js 依赖
npm ci --only=production

# 安装 Python 依赖
pip3 install -r python-service/requirements.txt --break-system-packages

# 安装 Playwright 浏览器
npx playwright install chromium --with-deps
```

### 步骤 3: 构建应用

```bash
# 构建 Next.js
npm run build

# 构建调度器
node build-scheduler.js
```

### 步骤 4: 配置 Nginx

```bash
# 创建 Nginx 配置文件
cat > /etc/nginx/sites-available/autoads << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

# 启用配置
sudo ln -s /etc/nginx/sites-available/autoads /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 步骤 5: 配置 Supervisor

```bash
# 创建 Supervisor 配置
cat > /etc/supervisor/conf.d/autoads.conf << 'EOF'
[program:autoads-web]
command=/usr/bin/node /opt/autobb/.next/standalone/server.js
directory=/opt/autobb
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=root
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/autoads/web.log
stopwaitsecs=30
environment=NODE_ENV="production",PORT="3000",HOSTNAME="0.0.0.0"

[program:autoads-scheduler]
command=/usr/bin/node /opt/autobb/dist/scheduler.js
directory=/opt/autobb
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=root
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/autoads/scheduler.log
stopwaitsecs=30
environment=NODE_ENV="production"
EOF

# 启动服务
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start all
```

---

## 🔒 SSL 证书配置

### 使用阿里云 SSL 证书

1. **购买/申请证书**
   - 登录阿里云控制台
   - 访问「SSL 证书服务」
   - 申请免费证书或购买付费证书

2. **下载证书**
   - 下载 Nginx 格式的证书文件
   - 包含 `.key` 和 `.pem` 文件

3. **上传到 ECS**

```bash
# 创建证书目录
sudo mkdir -p /etc/nginx/ssl

# 上传证书文件（使用 scp）
scp cert.key root@your-ecs-ip:/etc/nginx/ssl/
scp cert.pem root@your-ecs-ip:/etc/nginx/ssl/
```

4. **配置 Nginx HTTPS**

```bash
cat > /etc/nginx/sites-available/autoads-ssl << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/cert.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

# 启用配置
sudo ln -s /etc/nginx/sites-available/autoads-ssl /etc/nginx/sites-enabled/autoads-ssl
sudo rm /etc/nginx/sites-enabled/autoads
sudo nginx -t
sudo systemctl restart nginx
```

### 使用 Let's Encrypt（免费）

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期（已自动配置）
sudo certbot renew --dry-run
```

---

## 🌐 域名配置

### 阿里云 DNS 配置

1. **登录阿里云控制台**
2. **访问「云解析 DNS」**
3. **添加解析记录**

| 记录类型 | 主机记录 | 记录值 | TTL |
|----------|----------|--------|-----|
| A | @ | ECS 公网 IP | 10 分钟 |
| A | www | ECS 公网 IP | 10 分钟 |

### 验证域名解析

```bash
# 等待 DNS 生效后验证
ping your-domain.com
nslookup your-domain.com
```

---

## 📊 监控与运维

### 容器管理命令

```bash
# 查看容器状态
docker ps
docker stats autoads

# 查看日志
docker logs -f autoads
docker logs --tail 100 autoads

# 重启容器
docker restart autoads

# 停止容器
docker stop autoads

# 删除容器（数据保留）
docker rm autoads

# 进入容器
docker exec -it autoads /bin/bash

# 查看磁盘使用
docker system df
```

### Docker Compose 管理命令

```bash
# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f
docker-compose logs autoads

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 停止并删除数据卷（⚠️ 谨慎使用）
docker-compose down -v

# 更新镜像
docker-compose pull
docker-compose up -d --build
```

### 日志管理

```bash
# 查看应用日志
docker exec autoads tail -f /var/log/supervisor/autoads-web.log
docker exec autoads tail -f /var/log/supervisor/autoads-scheduler.log

# 查看 Nginx 日志
docker exec autoads tail -f /var/log/nginx/access.log
docker exec autoads tail -f /var/log/nginx/error.log

# 清理旧日志
docker exec autoads find /var/log -name "*.log" -mtime +30 -delete
```

### 数据库备份

```bash
# SQLite 备份（Docker 卷已持久化）
docker exec autoads ls -la /app/data/backups/

# PostgreSQL 备份
docker exec autoads_postgres pg_dump -U autoads autoads > backup.sql

# 恢复 PostgreSQL
docker exec -i autoads_postgres psql -U autoads autoads < backup.sql
```

### 监控脚本

```bash
# 创建监控脚本
cat > /opt/autobb/health-check.sh << 'EOF'
#!/bin/bash

echo "=== AutoAds 健康检查 ==="
echo "时间：$(date)"

# 检查容器状态
echo -e "\n[容器状态]"
docker ps --filter name=autoads --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 检查健康状态
echo -e "\n[健康检查]"
curl -s http://localhost/api/health | jq .

# 检查磁盘空间
echo -e "\n[磁盘使用]"
df -h /opt/autobb

# 检查内存使用
echo -e "\n[内存使用]"
free -h

# 检查最近日志错误
echo -e "\n[最近错误日志]"
docker logs --tail 50 autoads 2>&1 | grep -i error | tail -10

echo -e "\n=== 检查完成 ==="
EOF

chmod +x /opt/autobb/health-check.sh

# 运行健康检查
/opt/autobb/health-check.sh
```

### 设置定时任务（Cron）

```bash
# 编辑 crontab
crontab -e

# 添加定时任务
# 每天凌晨 2 点备份数据库
0 2 * * * docker exec autoads npm run db:backup

# 每小时检查健康状态
0 * * * * /opt/autobb/health-check.sh >> /var/log/autoads-health.log 2>&1

# 每天清理 Docker 系统垃圾
0 3 * * * docker system prune -f
```

---

## ❓ 常见问题

### 1. 容器启动失败

```bash
# 查看详细日志
docker logs autoads

# 检查端口占用
netstat -tlnp | grep :80

# 检查内存是否足够
free -h

# 重新启动
docker restart autoads
```

### 2. 数据库连接失败

```bash
# 检查数据库文件权限
ls -la /opt/autobb/data/

# 修复权限
chmod -R 755 /opt/autobb/data

# 重新初始化数据库
docker exec autoads npm run db:init
```

### 3. 内存不足

```bash
# 调整 Node.js 内存限制
docker update --memory 8g autoads

# 或修改环境变量
NODE_MAX_OLD_SPACE_SIZE_WEB=5120
```

### 4. Playwright 浏览器下载失败

```bash
# 手动安装浏览器
docker exec autoads npx playwright install chromium

# 使用国内镜像
docker exec autoads sh -c "
  export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
  npx playwright install chromium
"
```

### 5. Google Ads API 连接失败

```bash
# 检查代理配置
docker exec autoads env | grep PROXY

# 检查凭证配置
docker exec autoads npm run verify:google-ads

# 检查网络连通性
docker exec autoads curl -I https://googleads.googleapis.com
```

### 6. 队列任务不执行

```bash
# 检查 Redis 连接
docker exec autoads redis-cli -h localhost ping

# 检查队列状态
docker exec autoads node -e "
  const { getQueueManager } = require('./dist/lib/queue/queue-manager');
  const q = getQueueManager('background');
  console.log('Queue status:', q.getStatus());
"

# 重启调度器
docker restart autoads
```

### 7. Nginx 502 错误

```bash
# 检查后端服务
docker exec autoads curl http://localhost:3000/api/health

# 检查 Nginx 配置
docker exec autoads nginx -t

# 查看 Nginx 错误日志
docker exec autoads tail -f /var/log/nginx/error.log
```

### 8. 磁盘空间不足

```bash
# 清理 Docker 系统
docker system prune -a --volumes

# 清理旧日志
docker exec autoads find /var/log -name "*.log" -mtime +30 -delete

# 清理备份文件（保留最近 7 天）
docker exec autoads find /app/data/backups -name "*.db" -mtime +7 -delete
```

---

## 📞 技术支持

### 阿里云资源

- [ECS 文档中心](https://help.aliyun.com/product/25362.html)
- [容器服务 ACK](https://www.aliyun.com/product/kubernetes)
- [云数据库 RDS PostgreSQL](https://www.aliyun.com/product/rds/postgresql)
- [云数据库 Redis 版](https://www.aliyun.com/product/kvstore)

### 项目相关

- 查看项目 README.md
- 检查 `.env.example` 配置说明
- 查看 Dockerfile 了解构建细节

---

## 🎯 部署检查清单

- [ ] ECS 实例已创建并配置安全组
- [ ] Docker 已安装并验证
- [ ] 项目文件已上传/克隆
- [ ] 环境变量已配置（.env 文件）
- [ ] 数据目录已创建并设置权限
- [ ] Docker 容器已启动
- [ ] 健康检查通过（`/api/health`）
- [ ] 数据库已初始化
- [ ] 管理员账户已创建
- [ ] 域名已解析（如使用域名）
- [ ] SSL 证书已配置（如使用 HTTPS）
- [ ] 监控脚本已设置
- [ ] 备份策略已配置

---

**部署完成后，访问 `http://your-ecs-ip` 或 `https://your-domain.com` 即可使用 AutoAds 平台！**

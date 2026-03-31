#!/bin/bash

# Prompt版本批量更新自动化脚本（自动递增版本号）
# 用法: ./scripts/update-prompt.sh [major|minor]
# 示例: ./scripts/update-prompt.sh          # 自动minor递增 v2.0 → v2.1
#       ./scripts/update-prompt.sh minor    # minor递增 v2.0 → v2.1
#       ./scripts/update-prompt.sh major    # major递增 v2.0 → v3.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 解析版本号并递增
increment_version() {
    local version=$1
    local increment_type=${2:-minor}  # 默认minor递增

    # 去除v前缀
    version=${version#v}

    # 解析主版本号和次版本号
    local major=$(echo "$version" | cut -d'.' -f1)
    local minor=$(echo "$version" | cut -d'.' -f2)

    if [ "$increment_type" = "major" ]; then
        # major递增：v2.0 → v3.0
        major=$((major + 1))
        minor=0
    else
        # minor递增：v2.0 → v2.1
        minor=$((minor + 1))
    fi

    echo "v${major}.${minor}"
}

# 检查参数
INCREMENT_TYPE=${1:-minor}
if [ "$INCREMENT_TYPE" != "major" ] && [ "$INCREMENT_TYPE" != "minor" ]; then
    print_error "参数错误"
    echo ""
    echo "用法: $0 [major|minor]"
    echo ""
    echo "参数说明:"
    echo "  major  - 主版本号递增（如: v2.0 → v3.0）"
    echo "  minor  - 次版本号递增（如: v2.0 → v2.1，默认）"
    echo ""
    echo "示例:"
    echo "  $0           # 自动minor递增"
    echo "  $0 minor     # minor递增 v2.0 → v2.1"
    echo "  $0 major     # major递增 v2.0 → v3.0"
    echo ""
    echo "工作流程:"
    echo "  1. 查询当前所有Prompt的版本号"
    echo "  2. 自动计算下一个版本号"
    echo "  3. 从开发环境数据库读取所有Prompt内容"
    echo "  4. 生成包含所有Prompt的迁移文件"
    echo "  5. Git提交迁移文件"
    echo "  6. 生产环境部署后自动执行迁移"
    exit 1
fi

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PATH="${PROJECT_ROOT}/data/autoads.db"
MIGRATIONS_DIR="${PROJECT_ROOT}/migrations"
PG_MIGRATIONS_DIR="${PROJECT_ROOT}/pg-migrations"

print_info "开始批量Prompt迁移文件生成流程..."
echo ""

# 检查数据库是否存在
if [ ! -f "$DB_PATH" ]; then
    print_error "数据库文件不存在: $DB_PATH"
    exit 1
fi

# 检查SQLite是否安装
if ! command -v sqlite3 &> /dev/null; then
    print_error "sqlite3 未安装，请先安装: brew install sqlite3"
    exit 1
fi

print_success "环境检查通过"
echo ""

# 1. 查询当前版本号并自动递增
print_info "步骤1: 查询当前版本号并自动计算下一版本"

# 获取当前所有活跃Prompt的版本号（去重）
CURRENT_VERSIONS=$(sqlite3 "$DB_PATH" "
SELECT DISTINCT version
FROM prompt_versions
WHERE is_active = 1
ORDER BY version DESC;
")

if [ -z "$CURRENT_VERSIONS" ]; then
    print_error "数据库中没有找到活跃的Prompt"
    exit 1
fi

# 获取最高版本号
CURRENT_VERSION=$(echo "$CURRENT_VERSIONS" | head -1)

# 检查是否所有Prompt版本号一致
VERSION_COUNT=$(echo "$CURRENT_VERSIONS" | wc -l | tr -d ' ')
if [ "$VERSION_COUNT" -gt 1 ]; then
    print_warning "当前Prompt版本号不一致:"
    echo "$CURRENT_VERSIONS" | while read ver; do
        count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prompt_versions WHERE is_active = 1 AND version = '$ver';")
        echo "  ${ver}: ${count} 个Prompt"
    done
    echo ""
    print_info "将基于最高版本号 ${CURRENT_VERSION} 进行递增"
fi

# 自动递增版本号
NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$INCREMENT_TYPE")

print_success "当前版本: ${CURRENT_VERSION}"
print_success "新版本: ${NEW_VERSION} (${INCREMENT_TYPE}递增)"
echo ""

# 验证新版本号是否已存在
EXISTING_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prompt_versions WHERE version = '$NEW_VERSION';")
if [ "$EXISTING_COUNT" -gt 0 ]; then
    print_error "版本号 ${NEW_VERSION} 已存在于数据库中"
    echo ""
    echo "建议:"
    if [ "$INCREMENT_TYPE" = "minor" ]; then
        SUGGESTED_VERSION=$(increment_version "$NEW_VERSION" "minor")
        echo "  1. 使用下一个minor版本: ./scripts/update-prompt.sh minor"
        echo "     (将生成 ${SUGGESTED_VERSION})"
    else
        SUGGESTED_VERSION=$(increment_version "$NEW_VERSION" "major")
        echo "  1. 使用下一个major版本: ./scripts/update-prompt.sh major"
        echo "     (将生成 ${SUGGESTED_VERSION})"
    fi
    echo "  2. 手动清理数据库中的 ${NEW_VERSION} 版本"
    exit 1
fi

# 2. 从数据库读取所有活跃的Prompt列表
print_info "步骤2: 从数据库读取所有活跃Prompt"
PROMPT_LIST=$(sqlite3 "$DB_PATH" "
SELECT prompt_id, version, name
FROM prompt_versions
WHERE is_active = 1
ORDER BY prompt_id;
")

if [ -z "$PROMPT_LIST" ]; then
    print_error "数据库中没有找到活跃的Prompt"
    exit 1
fi

# 统计Prompt数量
PROMPT_COUNT=$(echo "$PROMPT_LIST" | wc -l | tr -d ' ')
print_success "找到 ${PROMPT_COUNT} 个活跃的Prompt"
echo ""
echo "$PROMPT_LIST" | while IFS='|' read -r pid ver name; do
    echo "  - ${pid} (${ver}): ${name}"
done
echo ""

# 3. 自动生成变更说明
print_info "步骤3: 生成变更说明"
CHANGE_NOTES="1. 批量更新所有Prompt到${NEW_VERSION}\n2. 从开发环境数据库导出最新Prompt内容\n"
print_success "使用默认变更说明"
echo ""

# 4. 获取下一个迁移文件编号
print_info "步骤4: 生成迁移文件"
LAST_MIGRATION=$(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{3}_.*\.sql$' | grep -v '\.pg\.sql$' | tail -1)
if [ -z "$LAST_MIGRATION" ]; then
    NEXT_NUMBER="001"
else
    LAST_NUMBER=$(echo "$LAST_MIGRATION" | sed 's/^\([0-9]*\).*/\1/')
    NEXT_NUMBER=$(printf "%03d" $((10#$LAST_NUMBER + 1)))
fi

MIGRATION_FILENAME="${NEXT_NUMBER}_update_all_prompts_${NEW_VERSION}.sql"
MIGRATION_PATH="${MIGRATIONS_DIR}/${MIGRATION_FILENAME}"
PG_MIGRATION_FILENAME="${NEXT_NUMBER}_update_all_prompts_${NEW_VERSION}.pg.sql"
PG_MIGRATION_PATH="${PG_MIGRATIONS_DIR}/${PG_MIGRATION_FILENAME}"

print_success "SQLite迁移文件: $MIGRATION_FILENAME"
print_success "PostgreSQL迁移文件: $PG_MIGRATION_FILENAME"
echo ""

# 5. 生成迁移文件内容
print_info "步骤5: 生成迁移SQL（从数据库导出所有Prompt内容）"

# 初始化SQLite迁移文件
cat > "$MIGRATION_PATH" << EOF
-- Migration: ${NEXT_NUMBER}_update_all_prompts_${NEW_VERSION}
-- Description: 批量更新所有Prompt到 ${NEW_VERSION} 版本
-- Created: $(date +%Y-%m-%d)
-- Version: ${CURRENT_VERSION} → ${NEW_VERSION}
-- Prompts: ${PROMPT_COUNT} 个
-- Database: SQLite

EOF

# 初始化PostgreSQL迁移文件
cat > "$PG_MIGRATION_PATH" << EOF
-- Migration: ${NEXT_NUMBER}_update_all_prompts_${NEW_VERSION}
-- Description: 批量更新所有Prompt到 ${NEW_VERSION} 版本
-- Created: $(date +%Y-%m-%d)
-- Version: ${CURRENT_VERSION} → ${NEW_VERSION}
-- Prompts: ${PROMPT_COUNT} 个
-- Database: PostgreSQL

EOF

# 遍历所有Prompt，生成UPDATE和INSERT语句
echo "$PROMPT_LIST" | while IFS='|' read -r prompt_id current_version current_name; do
    print_info "  处理 ${prompt_id}..."

    # 从数据库分别读取每个字段（避免prompt_content中的|干扰解析）
    CATEGORY=$(sqlite3 "$DB_PATH" "SELECT category FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")
    CURRENT_NAME=$(sqlite3 "$DB_PATH" "SELECT name FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")
    FILE_PATH=$(sqlite3 "$DB_PATH" "SELECT file_path FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")
    FUNCTION_NAME=$(sqlite3 "$DB_PATH" "SELECT function_name FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")
    PROMPT_CONTENT=$(sqlite3 "$DB_PATH" "SELECT prompt_content FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")
    DESCRIPTION=$(sqlite3 "$DB_PATH" "SELECT description FROM prompt_versions WHERE prompt_id = '$prompt_id' AND is_active = 1;")

    if [ -z "$CATEGORY" ]; then
        print_warning "跳过 ${prompt_id}（未找到活跃版本）"
        continue
    fi

    # 转义单引号
    ESCAPED_CONTENT=$(echo "$PROMPT_CONTENT" | sed "s/'/''/g")

    # 生成新名称
    NEW_NAME="${CURRENT_NAME%%v*}${NEW_VERSION}"

    # 追加到SQLite迁移文件
    cat >> "$MIGRATION_PATH" << EOF

-- ========================================
-- ${prompt_id}: ${current_version} → ${NEW_VERSION}
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = '$prompt_id' AND is_active = 1;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  '$prompt_id',
  '$NEW_VERSION',
  '$CATEGORY',
  '$NEW_NAME',
  '$DESCRIPTION',
  '$FILE_PATH',
  '$FUNCTION_NAME',
  '$ESCAPED_CONTENT',
  'Chinese',
  1,
  '
$NEW_VERSION 更新内容:
$(echo -e "$CHANGE_NOTES")
'
);

EOF

    # 追加到PostgreSQL迁移文件（is_active使用TRUE/FALSE）
    cat >> "$PG_MIGRATION_PATH" << EOF

-- ========================================
-- ${prompt_id}: ${current_version} → ${NEW_VERSION}
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = '$prompt_id' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  '$prompt_id',
  '$NEW_VERSION',
  '$CATEGORY',
  '$NEW_NAME',
  '$DESCRIPTION',
  '$FILE_PATH',
  '$FUNCTION_NAME',
  '$ESCAPED_CONTENT',
  'Chinese',
  TRUE,
  '
$NEW_VERSION 更新内容:
$(echo -e "$CHANGE_NOTES")
'
);

EOF
done

print_success "SQLite迁移文件已生成: $MIGRATION_PATH"
print_success "PostgreSQL迁移文件已生成: $PG_MIGRATION_PATH"
echo ""

# 6. 显示迁移文件统计
print_info "步骤6: 迁移文件统计"
MIGRATION_LINES=$(wc -l < "$MIGRATION_PATH" | tr -d ' ')
MIGRATION_SIZE=$(ls -lh "$MIGRATION_PATH" | awk '{print $5}')
PG_MIGRATION_LINES=$(wc -l < "$PG_MIGRATION_PATH" | tr -d ' ')
PG_MIGRATION_SIZE=$(ls -lh "$PG_MIGRATION_PATH" | awk '{print $5}')
echo "  版本变更: ${CURRENT_VERSION} → ${NEW_VERSION}"
echo "  Prompt数量: ${PROMPT_COUNT}"
echo ""
echo "  SQLite迁移:"
echo "    总行数: ${MIGRATION_LINES}"
echo "    文件大小: ${MIGRATION_SIZE}"
echo ""
echo "  PostgreSQL迁移:"
echo "    总行数: ${PG_MIGRATION_LINES}"
echo "    文件大小: ${PG_MIGRATION_SIZE}"
echo ""

# 7. 预览迁移文件
print_info "步骤7: 预览迁移文件（前50行）"
echo "----------------------------------------"
head -50 "$MIGRATION_PATH"
echo "..."
echo "----------------------------------------"
echo ""

# 8. 询问是否Git提交
read -p "是否Git提交此迁移文件？(y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "步骤8: Git提交"

    cd "$PROJECT_ROOT"
    git add "$MIGRATION_PATH" "$PG_MIGRATION_PATH"

    COMMIT_MESSAGE="feat: 批量更新所有Prompt到${NEW_VERSION}

版本变更: ${CURRENT_VERSION} → ${NEW_VERSION}

更新的Prompt:
$(echo "$PROMPT_LIST" | while IFS='|' read -r pid ver name; do echo "  - ${pid} (${ver} → ${NEW_VERSION})"; done)

变更说明:
$(echo -e "$CHANGE_NOTES")

文件:
  - SQLite: ${MIGRATION_FILENAME}
  - PostgreSQL: ${PG_MIGRATION_FILENAME}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

    git commit -m "$COMMIT_MESSAGE"
    print_success "Git提交完成"

    echo ""
    read -p "是否推送到远程仓库？(y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin main
        print_success "已推送到远程仓库"
    else
        print_warning "跳过推送，请手动执行: git push origin main"
    fi
else
    print_warning "跳过Git提交"
    print_info "手动提交命令:"
    echo "  cd $PROJECT_ROOT"
    echo "  git add $MIGRATION_PATH $PG_MIGRATION_PATH"
    echo "  git commit -m \"feat: 批量更新所有Prompt到${NEW_VERSION}\""
fi

echo ""
echo "======================================"
print_success "🎉 批量迁移文件生成完成！"
echo "======================================"
echo ""
echo "下一步:"
echo "1. 如果已推送到远程，生产环境部署后会自动应用迁移"
echo "2. 如果未推送，执行: git push origin main"
echo "3. 生产环境验证: docker logs autoads-prod | grep '$MIGRATION_FILENAME'"
echo ""
echo "工作原理:"
echo "  ✅ 版本自动递增: ${CURRENT_VERSION} → ${NEW_VERSION}"
echo "  ✅ 开发环境: 数据库中的所有Prompt已是最新版本"
echo "  ✅ SQLite迁移: ${MIGRATION_FILENAME}"
echo "  ✅ PostgreSQL迁移: ${PG_MIGRATION_FILENAME}"
echo "  ✅ 生产环境: 应用启动时自动执行对应数据库的迁移"
echo ""

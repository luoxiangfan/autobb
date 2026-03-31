#!/bin/bash

echo "🔒 AutoAds 提交前安全检查..."
echo ""

# 1. 检查是否有敏感文件被追踪
echo "1️⃣  检查敏感文件..."
SENSITIVE_FILES=$(git ls-files | grep -E "\.(env|db|sqlite|key|log)$" | grep -v ".env.example")
if [ -n "$SENSITIVE_FILES" ]; then
    echo "❌ 错误：发现敏感文件被Git追踪！"
    echo "$SENSITIVE_FILES"
    exit 1
else
    echo "✅ 没有敏感文件被追踪"
fi

# 2. 检查代码中是否有硬编码的API密钥
echo ""
echo "2️⃣  扫描硬编码密钥..."
if git diff --cached | grep -E "(AIza[0-9A-Za-z_-]{35}|sk-ant-[a-zA-Z0-9]{48})" > /dev/null; then
    echo "❌ 错误：检测到可能的API密钥！"
    echo "请检查提交内容，确保没有硬编码密钥。"
    exit 1
else
    echo "✅ 没有检测到硬编码密钥"
fi

# 3. 检查是否有.env文件在暂存区
echo ""
echo "3️⃣  检查环境变量文件..."
if git diff --cached --name-only | grep -E "^\.env$" > /dev/null; then
    echo "❌ 错误：不能提交.env文件！"
    exit 1
else
    echo "✅ 环境变量文件检查通过"
fi

# 4. 检查是否有数据库文件
echo ""
echo "4️⃣  检查数据库文件..."
if git diff --cached --name-only | grep -E "\.db$|\.sqlite$" > /dev/null; then
    echo "❌ 错误：不能提交数据库文件！"
    exit 1
else
    echo "✅ 数据库文件检查通过"
fi

# 5. 列出即将提交的文件
echo ""
echo "5️⃣  即将提交的文件："
git diff --cached --name-only | head -20
echo ""

# 6. 最终确认
echo "✅ 所有安全检查通过！"
echo ""
echo "📋 提交前最后确认："
echo "  - 确认没有敏感信息"
echo "  - 确认commit message有意义"
echo "  - 确认代码已测试"
echo ""
read -p "确认提交？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 取消提交"
    exit 1
fi

echo "✅ 继续提交..."
exit 0

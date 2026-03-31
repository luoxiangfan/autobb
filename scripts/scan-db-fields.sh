#!/bin/bash

# 扫描所有代码中使用的数据库字段
# 输出格式：表名 | 字段名 | 文件位置

echo "=== 扫描 INSERT 语句中的字段 ==="
grep -rn "INSERT INTO" /Users/jason/Documents/Kiro/autobb/src --include="*.ts" | \
  grep -v node_modules | \
  sed 's/.*INSERT INTO \([a-z_]*\) (\([^)]*\)).*/\1|\2/g' | \
  head -50

echo ""
echo "=== 扫描 SELECT 语句中的字段（带表名前缀）==="
grep -rn "SELECT.*FROM" /Users/jason/Documents/Kiro/autobb/src --include="*.ts" | \
  grep -v node_modules | \
  grep -E "\w+\.\w+" | \
  head -50

echo ""
echo "=== 扫描对象映射中的字段 ==="
grep -rn "a\.\w\+\|row\.\w\+\|user\.\w\+" /Users/jason/Documents/Kiro/autobb/src/lib --include="*.ts" | \
  grep -v "//" | \
  head -50

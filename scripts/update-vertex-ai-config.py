#!/usr/bin/env python3
"""
更新autoads用户的Vertex AI配置
"""
import sqlite3
import json

# 读取服务账号JSON
with open('/var/folders/j0/f3_21gkd6pn_qp60dkh3m6pm0000gn/T/gcp-sa-user-1.json', 'r') as f:
    service_account_json = f.read()

# 连接数据库
conn = sqlite3.connect('/Users/jason/Documents/Kiro/autobb/data/autoads.db')
cursor = conn.cursor()

# 更新配置
cursor.execute("""
    UPDATE system_settings
    SET config_value = ?
    WHERE user_id = 1 AND category = 'ai' AND config_key = 'gcp_service_account_json'
""", (service_account_json,))

conn.commit()

# 验证
cursor.execute("""
    SELECT config_key,
           CASE
               WHEN config_value IS NULL THEN 'NULL'
               WHEN config_value = '' THEN 'EMPTY'
               ELSE 'OK (' || LENGTH(config_value) || ' chars)'
           END as status
    FROM system_settings
    WHERE user_id = 1 AND category = 'ai'
    ORDER BY config_key
""")

print("✅ Vertex AI配置已更新")
print("\n当前配置状态:")
for row in cursor.fetchall():
    print(f"  {row[0]}: {row[1]}")

conn.close()

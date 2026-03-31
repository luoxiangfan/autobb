/**
 * 检查生产环境用户的代理配置
 */
import pkg from 'pg'
const { Client } = pkg
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function checkUserProxyConfig() {
  const client = new Client({
    connectionString: DATABASE_URL,
  })

  try {
    await client.connect()
    console.log('✅ 已连接到生产环境数据库\n')

    // 1. 查找用户
    console.log('🔍 查找用户 liangzhongxin9200...')
    const userResult = await client.query(
      `SELECT id, username, email FROM users
       WHERE username LIKE '%liangzhongxin%' OR email LIKE '%liangzhongxin%'
       LIMIT 5`
    )

    if (userResult.rows.length === 0) {
      console.log('❌ 未找到用户 liangzhongxin9200')

      // 尝试查询日志中提到的用户ID
      console.log('\n🔍 查询日志中提到的用户ID (36, 51)...')
      const idResult = await client.query(
        `SELECT id, username, email FROM users WHERE id IN (36, 51) ORDER BY id`
      )

      if (idResult.rows.length > 0) {
        console.log(`找到${idResult.rows.length}个用户:`)
        idResult.rows.forEach(user => {
          console.log(`  - ID: ${user.id}, 用户名: ${user.username}, 邮箱: ${user.email}`)
        })
      }
      return
    }

    console.log(`找到${userResult.rows.length}个用户:`)
    userResult.rows.forEach(user => {
      console.log(`  - ID: ${user.id}, 用户名: ${user.username}, 邮箱: ${user.email}`)
    })

    // 2. 查询代理配置
    for (const user of userResult.rows) {
      console.log(`\n========================================`)
      console.log(`用户: ${user.username} (ID: ${user.id})`)
      console.log(`========================================\n`)

      // 查询该用户的所有代理相关配置
      const proxySettings = await client.query(
        `SELECT key, value, encrypted_value, category, data_type, description, is_sensitive
         FROM system_settings
         WHERE user_id = $1 AND (
           key LIKE '%proxy%' OR
           key LIKE '%iprocket%' OR
           key LIKE '%oxylabs%' OR
           key LIKE '%abcproxy%' OR
           category LIKE '%proxy%' OR
           category LIKE '%代理%'
         )
         ORDER BY category, key`,
        [user.id]
      )

      if (proxySettings.rows.length === 0) {
        console.log('📭 该用户没有配置任何代理设置')

        // 查看该用户所有配置
        console.log('\n📋 该用户的所有配置项:')
        const allSettings = await client.query(
          `SELECT key, category, data_type, description
           FROM system_settings
           WHERE user_id = $1
           ORDER BY category, key`,
          [user.id]
        )

        if (allSettings.rows.length === 0) {
          console.log('  (无配置)')
        } else {
          allSettings.rows.forEach(setting => {
            console.log(`  - [${setting.category}] ${setting.key}: ${setting.description || '(无描述)'}`)
          })
        }
      } else {
        console.log(`📦 找到 ${proxySettings.rows.length} 个代理相关配置:\n`)

        proxySettings.rows.forEach(setting => {
          console.log(`配置项: ${setting.key}`)
          console.log(`  分类: ${setting.category}`)
          console.log(`  类型: ${setting.data_type}`)
          console.log(`  描述: ${setting.description || '(无)'}`)
          console.log(`  敏感: ${setting.is_sensitive ? '是' : '否'}`)

          if (setting.is_sensitive) {
            console.log(`  值: [加密] (encrypted_value存在: ${!!setting.encrypted_value})`)
          } else {
            const value = setting.value
            if (!value) {
              console.log(`  值: (空)`)
            } else {
              try {
                const parsed = JSON.parse(value)
                console.log(`  值: ${JSON.stringify(parsed, null, 2)}`)
              } catch {
                console.log(`  值: ${value}`)
              }
            }
          }
          console.log('')
        })

        // 特别检查代理URL配置
        const proxyUrlSettings = proxySettings.rows.filter(s =>
          s.key.includes('url') || s.key.includes('URL') || s.key === 'PROXY_URL'
        )

        if (proxyUrlSettings.length > 0) {
          console.log('\n🔍 代理URL配置详情:\n')

          for (const setting of proxyUrlSettings) {
            console.log(`配置: ${setting.key}`)

            if (setting.encrypted_value) {
              console.log('  ⚠️ 该配置已加密，需要解密查看')
            } else if (setting.value) {
              try {
                const value = JSON.parse(setting.value)
                const url = typeof value === 'string' ? value : value.url || value.value

                if (url) {
                  // 脱敏显示URL
                  const maskedUrl = url
                    .replace(/username=[^&]+/, 'username=***')
                    .replace(/password=[^&]+/, 'password=***')
                    .replace(/\/\/[^:]+:[^@]+@/, '//*****:*****@')

                  console.log(`  URL (脱敏): ${maskedUrl}`)

                  // 识别代理服务商
                  if (url.includes('iprocket.io')) {
                    console.log(`  🎯 服务商: IPRocket`)

                    // 提取关键参数
                    const urlObj = new URL(url)
                    const cc = urlObj.searchParams.get('cc')
                    const type = urlObj.searchParams.get('type')
                    const ips = urlObj.searchParams.get('ips')
                    const proxyType = urlObj.searchParams.get('proxyType')
                    const responseType = urlObj.searchParams.get('responseType')

                    console.log(`  参数:`)
                    console.log(`    - cc (国家): ${cc}`)
                    console.log(`    - type: ${type}`)
                    console.log(`    - ips: ${ips}`)
                    console.log(`    - proxyType: ${proxyType}`)
                    console.log(`    - responseType: ${responseType}`)
                  } else if (url.includes('oxylabs.io')) {
                    console.log(`  🎯 服务商: Oxylabs`)
                  } else if (url.includes('abcproxy')) {
                    console.log(`  🎯 服务商: ABCProxy`)
                  } else if (url.includes(':')) {
                    // 可能是通用格式 host:port:username:password
                    const parts = url.split(':')
                    console.log(`  🎯 服务商: 通用格式 (${parts.length}个字段)`)
                    if (parts.length === 4) {
                      console.log(`  格式: host:port:username:password ✅`)
                    } else {
                      console.log(`  ⚠️ 格式异常: 期望4个字段，实际${parts.length}个字段`)
                      console.log(`  字段内容: ${JSON.stringify(parts)}`)
                    }
                  } else {
                    console.log(`  ⚠️ 未识别的代理服务商`)
                  }
                } else {
                  console.log(`  值: ${JSON.stringify(value)}`)
                }
              } catch (e) {
                console.log(`  值: ${setting.value}`)
              }
            } else {
              console.log('  值: (空)')
            }
            console.log('')
          }
        }
      }
    }

  } catch (error: any) {
    console.error('❌ 错误:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
  } finally {
    await client.end()
    console.log('\n✅ 数据库连接已关闭')
  }
}

checkUserProxyConfig()

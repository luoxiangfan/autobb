#!/usr/bin/env tsx
/**
 * 测试服务账号访问Google Ads账户层级关系
 *
 * 目的：排查为何服务账号使用MCC模式无法访问子账户
 *
 * 测试场景：
 * 1. 验证MCC账户1971320874和子账户6260947444的层级关系
 * 2. 检查服务账号在MCC账户中的权限配置
 * 3. 检查服务账号在子账户中的权限配置
 * 4. 测试不同login_customer_id的访问结果
 */

import { JWT } from 'google-auth-library'
import { GoogleAds, Customer } from '@htdangkhoa/google-ads'

// 从环境变量或secrets文件读取配置
const SERVICE_ACCOUNT_EMAIL = process.env.SERVICE_ACCOUNT_EMAIL || ''
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.SERVICE_ACCOUNT_PRIVATE_KEY || ''
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
const MCC_CUSTOMER_ID = '1971320874'
const SUB_CUSTOMER_ID = '6260947444'

console.log('🔍 Google Ads 服务账号层级关系测试')
console.log('=' .repeat(60))

async function test1_ListAccessibleCustomers() {
  console.log('\n📋 测试1: 列出可访问的账户')
  console.log('-'.repeat(60))

  try {
    const authClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: SERVICE_ACCOUNT_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    })

    const customer = new Customer({
      auth: authClient as any,
      developer_token: DEVELOPER_TOKEN,
      customer_id: MCC_CUSTOMER_ID,
      login_customer_id: MCC_CUSTOMER_ID,
    })

    const response = await customer.listAccessibleCustomers()
    console.log('✅ 可访问账户列表:')
    console.log('   Resource Names:', response.resource_names)

    const customerIds = response.resource_names.map((rn: string) => rn.split('/').pop())
    console.log('   Customer IDs:', customerIds)

    return customerIds
  } catch (error: any) {
    console.error('❌ 测试1失败:', error.message)
    return []
  }
}

async function test2_QueryAccountHierarchy() {
  console.log('\n🌳 测试2: 查询MCC账户的层级关系')
  console.log('-'.repeat(60))

  try {
    const authClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: SERVICE_ACCOUNT_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    })

    const googleAds = new GoogleAds({
      auth: authClient as any,
      developer_token: DEVELOPER_TOKEN,
    }, {
      customer_id: MCC_CUSTOMER_ID,
      login_customer_id: MCC_CUSTOMER_ID,
    })

    const query = `
      SELECT
        customer_client.client_customer,
        customer_client.level,
        customer_client.manager,
        customer_client.descriptive_name,
        customer_client.id
      FROM customer_client
      WHERE customer_client.level <= 1
    `

    console.log(`   查询MCC账户: ${MCC_CUSTOMER_ID}`)
    const results = await googleAds.search({ query })

    console.log(`✅ 找到 ${results.length} 个账户:`)
    for (const row of results) {
      const client = row.customer_client
      console.log(`   - ID: ${client.id}`)
      console.log(`     名称: ${client.descriptive_name}`)
      console.log(`     层级: ${client.level}`)
      console.log(`     是否MCC: ${client.manager}`)
      console.log(`     客户资源: ${client.client_customer}`)
    }

    return results
  } catch (error: any) {
    console.error('❌ 测试2失败:', error.message)
    if (error.response) {
      console.error('   详细错误:', error.response.data)
    }
    return []
  }
}

async function test3_AccessSubAccountWithDifferentLoginIds() {
  console.log('\n🔐 测试3: 使用不同login_customer_id访问子账户')
  console.log('-'.repeat(60))

  const testCases = [
    { name: 'MCC ID', loginCustomerId: MCC_CUSTOMER_ID },
    { name: '子账户ID', loginCustomerId: SUB_CUSTOMER_ID },
    { name: 'null(省略)', loginCustomerId: undefined },
  ]

  for (const testCase of testCases) {
    console.log(`\n   尝试 ${testCase.name}: login_customer_id=${testCase.loginCustomerId || 'null'}`)

    try {
      const authClient = new JWT({
        email: SERVICE_ACCOUNT_EMAIL,
        key: SERVICE_ACCOUNT_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/adwords'],
      })

      const googleAds = new GoogleAds({
        auth: authClient as any,
        developer_token: DEVELOPER_TOKEN,
      }, {
        customer_id: SUB_CUSTOMER_ID,
        login_customer_id: testCase.loginCustomerId,
      })

      // 简单查询测试权限
      const query = `SELECT customer.id, customer.descriptive_name FROM customer WHERE customer.id = ${SUB_CUSTOMER_ID}`
      const results = await googleAds.search({ query })

      if (results.length > 0) {
        console.log(`   ✅ 成功! 账户信息:`)
        console.log(`      ID: ${results[0].customer.id}`)
        console.log(`      名称: ${results[0].customer.descriptive_name}`)
      }
    } catch (error: any) {
      console.log(`   ❌ 失败: ${error.message}`)
    }
  }
}

async function test4_CheckServiceAccountPermissions() {
  console.log('\n🔍 测试4: 检查服务账号权限配置')
  console.log('-'.repeat(60))

  console.log(`\n   服务账号邮箱: ${SERVICE_ACCOUNT_EMAIL}`)
  console.log(`   MCC账户ID: ${MCC_CUSTOMER_ID}`)
  console.log(`   子账户ID: ${SUB_CUSTOMER_ID}`)

  console.log('\n   ⚠️  请手动检查以下配置:')
  console.log('   1. 登录 Google Ads UI: https://ads.google.com')
  console.log(`   2. 切换到MCC账户 ${MCC_CUSTOMER_ID}`)
  console.log('   3. 进入"管理" → "访问权限和安全"')
  console.log(`   4. 检查服务账号 ${SERVICE_ACCOUNT_EMAIL} 是否在用户列表中`)
  console.log('   5. 检查权限级别(标准访问/管理员)')
  console.log()
  console.log(`   6. 切换到子账户 ${SUB_CUSTOMER_ID}`)
  console.log('   7. 进入"管理" → "访问权限和安全"')
  console.log(`   8. 检查服务账号 ${SERVICE_ACCOUNT_EMAIL} 是否在用户列表中`)
  console.log('   9. 检查权限级别')
}

async function main() {
  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY || !DEVELOPER_TOKEN) {
    console.error('❌ 缺少必要的环境变量:')
    console.error('   SERVICE_ACCOUNT_EMAIL')
    console.error('   SERVICE_ACCOUNT_PRIVATE_KEY')
    console.error('   GOOGLE_ADS_DEVELOPER_TOKEN')
    process.exit(1)
  }

  // 运行所有测试
  await test1_ListAccessibleCustomers()
  await test2_QueryAccountHierarchy()
  await test3_AccessSubAccountWithDifferentLoginIds()
  await test4_CheckServiceAccountPermissions()

  console.log('\n' + '='.repeat(60))
  console.log('📊 测试总结')
  console.log('='.repeat(60))
  console.log('\n根据Google Ads API文档,服务账号使用MCC模式的要求:')
  console.log('1. 服务账号必须在MCC账户的"用户"列表中')
  console.log('2. 权限级别必须是"标准访问"或"管理员"(不支持Email/Admin)')
  console.log('3. MCC必须是子账户的直接父账户')
  console.log('4. 如果服务账号只在子账户中,需要省略login_customer_id或使用子账户ID')
  console.log()
}

main().catch(console.error)

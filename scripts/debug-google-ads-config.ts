/**
 * 调试脚本：检查用户 Google Ads API 配置
 * 用于排查 "Developer token is not allowed with project" 错误
 */

import postgres from 'postgres';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL 环境变量未设置');
    process.exit(1);
  }

  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  try {
    console.log('=== 1. 查询用户信息 ===');
    const users = await sql`
      SELECT id, username, email
      FROM users
      WHERE username = 'liangzhongxin9200'
    `;
    console.log('用户信息:', users);

    if (users.length === 0) {
      console.error('❌ 未找到用户 liangzhongxin9200');
      return;
    }

    const userId = users[0].id;
    console.log(`\n用户 ID: ${userId}`);

    console.log('\n=== 2. 查询 Ads 账号信息 (ID: 329, 账号: 1028955905) ===');
    const adsAccounts = await sql`
      SELECT
        id,
        user_id,
        customer_id,
        account_name,
        auth_type,
        service_account_id,
        access_token,
        refresh_token,
        token_expires_at,
        last_sync_at,
        created_at,
        updated_at
      FROM google_ads_accounts
      WHERE id = 329 OR customer_id = '1028955905'
    `;
    console.log(`找到 ${adsAccounts.length} 个账号配置:`);
    adsAccounts.forEach((acc: any) => {
      console.log(`\n账号 ID: ${acc.id}`);
      console.log(`  - customer_id: ${acc.customer_id}`);
      console.log(`  - account_name: ${acc.account_name}`);
      console.log(`  - user_id: ${acc.user_id}`);
      console.log(`  - auth_type: ${acc.auth_type || 'oauth'}`);
      console.log(`  - service_account_id: ${acc.service_account_id || '未关联'}`);
      console.log(`  - access_token: ${acc.access_token ? '✅ 已设置' : '❌ 未设置'}`);
      console.log(`  - refresh_token: ${acc.refresh_token ? '✅ 已设置' : '❌ 未设置'}`);
      console.log(`  - token_expires_at: ${acc.token_expires_at || '未设置'}`);
    });

    console.log('\n=== 3. 查询用户的所有 Ads 账号 ===');
    const userAdsAccounts = await sql`
      SELECT id, customer_id, account_name, auth_type
      FROM google_ads_accounts
      WHERE user_id = ${userId}
      ORDER BY id
    `;
    console.log(`用户共有 ${userAdsAccounts.length} 个 Ads 账号:`);
    userAdsAccounts.forEach((acc: any) => {
      console.log(`  - ID ${acc.id}: ${acc.customer_id} (${acc.account_name}) - ${acc.auth_type}`);
    });

    console.log('\n=== 4. 查询 Offer #885 信息 ===');
    try {
      const offers = await sql`
        SELECT id, brand, product_name, user_id
        FROM offers
        WHERE id = 885
      `;
      if (offers.length > 0) {
        console.log('Offer 信息:', offers[0]);
      } else {
        console.log('❌ 未找到 Offer #885');
      }
    } catch (error: any) {
      console.log('查询 Offer 失败:', error.message);
    }

    console.log('\n=== 5. 检查 google_ads_credentials 表中的用户配置 ===');
    const googleAdsCredentials = await sql`
      SELECT
        id,
        user_id,
        client_id,
        client_secret,
        refresh_token,
        access_token,
        developer_token,
        login_customer_id,
        access_token_expires_at,
        is_active,
        last_verified_at,
        created_at
      FROM google_ads_credentials
      WHERE user_id = ${userId}
    `;

    if (googleAdsCredentials.length > 0) {
      const cred = googleAdsCredentials[0];
      console.log('找到 Google Ads OAuth 凭证配置:');
      console.log(`  - client_id: ${cred.client_id ? cred.client_id.substring(0, 30) + '...' : '❌ 未设置'}`);
      console.log(`  - client_secret: ${cred.client_secret ? '✅ 已设置' : '❌ 未设置'}`);
      console.log(`  - developer_token: ${cred.developer_token ? cred.developer_token.substring(0, 10) + '...' : '❌ 未设置'}`);
      console.log(`  - login_customer_id: ${cred.login_customer_id || '❌ 未设置'}`);
      console.log(`  - refresh_token: ${cred.refresh_token ? '✅ 已设置' : '❌ 未设置'}`);
      console.log(`  - access_token: ${cred.access_token ? '✅ 已设置' : '❌ 未设置'}`);
      console.log(`  - access_token_expires_at: ${cred.access_token_expires_at || '未设置'}`);
      console.log(`  - is_active: ${cred.is_active}`);
      console.log(`  - last_verified_at: ${cred.last_verified_at || '从未验证'}`);

      // 提取 client_id 中的 project number
      if (cred.client_id) {
        const match = cred.client_id.match(/^(\d+)-/);
        if (match) {
          const projectNumber = match[1];
          console.log(`\n  📋 从 client_id 提取的 Project Number: ${projectNumber}`);
        }
      }
    } else {
      console.log('❌ 用户没有配置 Google Ads OAuth 凭证（google_ads_credentials 表为空）');
    }

    console.log('\n=== 6. 检查 system_settings 中的全局配置（已废弃） ===');
    const globalSettings = await sql`
      SELECT key, value, description, is_sensitive
      FROM system_settings
      WHERE user_id IS NULL
        AND category = 'google_ads'
        AND key IN ('developer_token', 'client_id', 'client_secret')
    `;
    if (globalSettings.length > 0) {
      console.log('全局配置（已废弃，仅供参考）:');
      globalSettings.forEach((setting: any) => {
        console.log(`  - ${setting.key}: ${setting.value || 'NULL'}`);
      });
    } else {
      console.log('无全局配置（系统现在使用 google_ads_credentials 表）');
    }

    console.log('\n=== 7. 检查用户的个性化配置（已废弃） ===');
    const userSettings = await sql`
      SELECT key, value
      FROM system_settings
      WHERE user_id = ${userId}
        AND category = 'google_ads'
        AND key IN ('developer_token', 'client_id', 'client_secret')
    `;
    if (userSettings.length > 0) {
      console.log('用户配置（已废弃，仅供参考）:');
      userSettings.forEach((setting: any) => {
        console.log(`  - ${setting.key}: ${setting.value || 'NULL'}`);
      });
    } else {
      console.log('无用户配置（系统现在使用 google_ads_credentials 表）');
    }

    // 查询 Service Account 配置
    console.log('\n=== 8. 检查 Service Account 配置 ===');
    const serviceAccounts = await sql`
      SELECT
        id,
        user_id,
        name,
        mcc_customer_id,
        developer_token,
        service_account_email,
        project_id,
        is_active
      FROM google_ads_service_accounts
      WHERE user_id = ${userId}
    `;
    if (serviceAccounts.length > 0) {
      console.log(`找到 ${serviceAccounts.length} 个 Service Account 配置:`);
      serviceAccounts.forEach((sa: any) => {
        console.log(`\nService Account ID: ${sa.id}`);
        console.log(`  - name: ${sa.name}`);
        console.log(`  - mcc_customer_id: ${sa.mcc_customer_id}`);
        console.log(`  - developer_token: ${sa.developer_token ? sa.developer_token.substring(0, 10) + '...' : 'NULL'}`);
        console.log(`  - service_account_email: ${sa.service_account_email}`);
        console.log(`  - project_id: ${sa.project_id || 'NULL'}`);
        console.log(`  - is_active: ${sa.is_active}`);
      });

      // 如果 ads_account 关联了 service_account，展示关联信息
      const linkedAccount = adsAccounts.find((acc: any) => acc.service_account_id);
      if (linkedAccount) {
        console.log(`\n✅ Ads账号 ${linkedAccount.customer_id} 使用 Service Account: ${linkedAccount.service_account_id}`);
      }
    } else {
    console.log('❌ 用户没有配置 Service Account');
    }

    console.log('\n=== 诊断结果 ===');
    console.log('错误信息: Developer token is not allowed with project \'PROJECT_NUMBER\'');
    console.log('\n可能原因：');
    console.log('1. Developer Token 与 OAuth Client ID 所属的 GCP Project 不匹配');
    console.log('2. Developer Token 是从其他 GCP Project 申请的');
    console.log('3. OAuth Client ID (client_id) 属于 Project PROJECT_NUMBER，但 Developer Token 不属于该项目');
    console.log('\n解决方案：');
    console.log('1. 确认 Developer Token 和 OAuth Client ID 来自同一个 GCP Project');
    console.log('2. 或者重新申请与 Client ID 匹配的 Developer Token');
    console.log('3. 检查 client_id 的格式（应该是 xxx.apps.googleusercontent.com）');

  } catch (error) {
    console.error('查询失败:', error);
  } finally {
    await sql.end();
  }
}

main().catch(console.error);

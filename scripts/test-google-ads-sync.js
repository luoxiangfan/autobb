/**
 * 手动触发 Google Ads 广告系列同步测试脚本
 * 
 * 用法：
 * 1. 确保数据库已配置
 * 2. 确保环境变量已设置（GOOGLE_ADS_CLIENT_ID 等）
 * 3. 运行：node scripts/test-google-ads-sync.js
 */

const { getDatabase } = require('../dist/lib/db')
const { syncAllUsersCampaigns } = require('../dist/lib/google-ads-campaign-sync')

async function main() {
  console.log('🚀 开始手动触发 Google Ads 广告系列同步...\n')
  
  const startTime = Date.now()
  
  try {
    // 执行同步
    const result = await syncAllUsersCampaigns()
    
    const duration = Date.now() - startTime
    
    console.log('\n✅ 同步完成！')
    console.log('================')
    console.log(`⏱️  耗时：${duration}ms`)
    console.log(`👥 用户数：${result.totalUsers}`)
    console.log(`📊 同步数：${result.totalSynced}`)
    console.log(`✨ 新建 Offer：${result.totalCreated}`)
    console.log(`⏭️  跳过：${result.totalSkipped}`)
    console.log(`❌ 错误：${result.totalErrors}`)
    
    if (result.totalErrors === 0) {
      console.log('\n🎉 同步成功！')
    } else {
      console.log(`\n⚠️  有 ${result.totalErrors} 个错误，请查看日志`)
    }
    
    process.exit(0)
  } catch (error) {
    console.error('\n❌ 同步失败:', error.message)
    console.error(error)
    process.exit(1)
  }
}

main()

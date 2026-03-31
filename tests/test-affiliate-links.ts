/**
 * 测试推广链接解析功能
 * 确保Crawlee迁移不破坏原有业务逻辑
 */
import { resolveAffiliateLink, scrapeAmazonProduct } from '../src/lib/scraper-stealth';

const TEST_LINKS = [
  'https://pboost.me/UKTs4I6',
  'https://pboost.me/xEAgQ8ec',
  'https://pboost.me/RKWwEZR9',
  'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=',
];

// 使用用户配置的代理（从环境变量获取）
const PROXY_URL = process.env.PROXY_URL || '';

async function testAffiliateLink(url: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔗 测试链接: ${url}`);
  console.log('='.repeat(60));

  try {
    const result = await resolveAffiliateLink(url, PROXY_URL);

    console.log('\n✅ 解析结果:');
    console.log(`  Final URL: ${result.finalUrl}`);
    console.log(`  Final URL Suffix: ${result.finalUrlSuffix.substring(0, 100)}${result.finalUrlSuffix.length > 100 ? '...' : ''}`);
    console.log(`  重定向次数: ${result.redirectCount}`);
    console.log(`  重定向链: ${result.redirectChain.length} 个URL`);

    // 如果是Amazon产品链接，尝试提取产品信息
    if (result.finalUrl.includes('amazon.com') && result.finalUrl.includes('/dp/')) {
      console.log('\n📦 检测到Amazon产品链接，提取产品信息...');
      try {
        const productUrl = result.finalUrl + (result.finalUrlSuffix ? '?' + result.finalUrlSuffix : '');
        const productData = await scrapeAmazonProduct(productUrl, PROXY_URL);

        console.log('\n✅ 产品信息:');
        console.log(`  产品名称: ${productData.productName?.substring(0, 80)}...`);
        console.log(`  品牌名: ${productData.brandName}`);
        console.log(`  价格: ${productData.productPrice}`);
        console.log(`  评分: ${productData.rating}`);
        console.log(`  评论数: ${productData.reviewCount}`);
        console.log(`  ASIN: ${productData.asin}`);
        console.log(`  Prime: ${productData.primeEligible ? '是' : '否'}`);
        console.log(`  特点数量: ${productData.features.length}`);
        console.log(`  图片数量: ${productData.imageUrls.length}`);
      } catch (productError: any) {
        console.log(`\n⚠️ 产品信息提取失败: ${productError.message}`);
      }
    } else if (result.finalUrl.includes('amazon.com/stores')) {
      console.log('\n📦 检测到Amazon Store链接');
    }

    return { success: true, result };
  } catch (error: any) {
    console.log(`\n❌ 解析失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🧪 推广链接解析测试');
  console.log('目标: 验证Crawlee迁移不破坏原有业务逻辑\n');

  const results: { url: string; success: boolean; finalUrl?: string }[] = [];

  for (const url of TEST_LINKS) {
    const { success, result } = await testAffiliateLink(url);
    results.push({
      url,
      success,
      finalUrl: result?.finalUrl,
    });

    // 每个链接之间等待3秒，避免频率限制
    if (TEST_LINKS.indexOf(url) < TEST_LINKS.length - 1) {
      console.log('\n⏳ 等待3秒后测试下一个链接...\n');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // 打印总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试总结');
  console.log('='.repeat(60));

  const successCount = results.filter((r) => r.success).length;
  console.log(`\n成功: ${successCount}/${results.length}`);

  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${i + 1}. ${r.url.substring(0, 40)}...`);
    if (r.finalUrl) {
      console.log(`   → ${r.finalUrl.substring(0, 60)}...`);
    }
  });
}

main().catch(console.error);

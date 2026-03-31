/**
 * 真实推广链接 + Crawlee抓取综合测试
 *
 * 使用系统已有的API接口进行测试，不重复实现业务逻辑
 */

import { getCrawleePersistence } from '../src/lib/crawlee-db-persistence';

// 测试链接及其关联的推广国家（模拟Offer信息）
const TEST_OFFERS = [
  { link: 'https://pboost.me/UKTs4I6', targetCountry: 'US' },
  { link: 'https://pboost.me/xEAgQ8ec', targetCountry: 'DE' },
  { link: 'https://pboost.me/RKWwEZR9', targetCountry: 'US' },
  { link: 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=', targetCountry: 'US' },
];

const USER_ID = 1;
const BASE_URL = 'http://localhost:3000';

/**
 * 登录获取认证Cookie
 */
async function getAuthCookie(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'autoads', password: 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk=' }),
  });

  if (!response.ok) {
    throw new Error(`登录失败: ${response.status}`);
  }

  // 获取Set-Cookie头
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('未获取到认证Cookie');
  }

  // 提取auth_token
  const match = setCookie.match(/auth_token=([^;]+)/);
  return match ? `auth_token=${match[1]}` : setCookie;
}

/**
 * 测试1: 使用 /api/offers/extract 接口解析推广链接
 */
async function test1_ExtractOfferInfo(authCookie: string) {
  console.log('\n📝 测试1: 使用 /api/offers/extract 接口解析推广链接');
  console.log('='.repeat(60));

  const results: Array<{
    original: string;
    finalUrl: string;
    isAmazon: boolean;
    targetCountry: string;
    brand?: string;
  }> = [];

  for (const offer of TEST_OFFERS) {
    console.log(`\n🔗 解析: ${offer.link}`);
    console.log(`   🌍 推广国家: ${offer.targetCountry}`);

    try {
      const response = await fetch(`${BASE_URL}/api/offers/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({
          affiliate_link: offer.link,
          target_country: offer.targetCountry,
          skipCache: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`   ❌ API错误: ${errorData.message || response.status}`);
        continue;
      }

      const data = await response.json();
      const d = data.data || data; // API返回 { success: true, data: {...} }

      console.log(`   ✅ Final URL: ${d.finalUrl?.slice(0, 80)}...`);
      console.log(`   📊 Final URL Suffix: ${d.finalUrlSuffix || '无'}`);
      console.log(`   🏷️ 品牌名: ${d.brand || 'Unknown'}`);
      console.log(`   🔄 重定向次数: ${d.redirectCount || 0}`);
      console.log(`   🔧 解析方式: ${d.resolveMethod || 'unknown'}`);
      console.log(`   🌐 使用代理: ${d.proxyUsed || '无'}`);

      const isAmazon = d.finalUrl?.includes('amazon.com');
      const isStore = d.finalUrl?.includes('/stores/');

      if (isAmazon) {
        console.log(`   📦 类型: ${isStore ? 'Amazon Store' : 'Amazon Product/其他'}`);
        if (d.productCount) {
          console.log(`   🛒 产品数: ${d.productCount}`);
        }
      } else {
        console.log(`   🌐 类型: 独立站`);
      }

      results.push({
        original: offer.link,
        finalUrl: d.finalUrl,
        isAmazon,
        targetCountry: offer.targetCountry,
        brand: d.brand,
      });

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`   ❌ 请求失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n✅ 测试1完成');
  return results;
}

/**
 * 测试2: 使用 /api/offers/[id]/scrape 接口抓取（如果有Offer ID）
 * 或直接调用Crawlee抓取函数测试反封禁优化
 */
async function test2_ScrapeAmazonStores(
  resolvedLinks: Array<{ finalUrl: string; isAmazon: boolean; targetCountry: string }>,
  authCookie: string
) {
  console.log('\n📝 测试2: 抓取Amazon Store（优化反封禁）');
  console.log('='.repeat(60));

  const amazonStoreLinks = resolvedLinks.filter(
    link => link.isAmazon && link.finalUrl.includes('/stores/')
  );

  if (amazonStoreLinks.length === 0) {
    console.log('   ⚠️ 没有Amazon Store链接，跳过测试');
    return;
  }

  // 由于没有创建Offer，这里使用Crawlee直接抓取（测试反封禁优化）
  const { scrapeAmazonStoreWithCrawlee } = await import('../src/lib/crawlee-scraper');

  const results = [];

  for (const link of amazonStoreLinks) {
    console.log(`\n🛒 抓取Store: ${link.finalUrl.slice(0, 80)}...`);

    try {
      // 增加随机延迟（3-8秒）
      const randomDelay = Math.floor(Math.random() * 5000) + 3000;
      console.log(`   ⏳ 随机延迟 ${(randomDelay / 1000).toFixed(1)}秒...`);
      await new Promise(resolve => setTimeout(resolve, randomDelay));

      console.log(`   🌍 推广国家: ${link.targetCountry}`);

      const startTime = Date.now();
      // 使用推广国家选择代理
      const result = await scrapeAmazonStoreWithCrawlee(link.finalUrl, USER_ID, link.targetCountry);
      const duration = Date.now() - startTime;

      console.log(`   ✅ 抓取成功！`);
      console.log(`      Store: ${result.storeName}`);
      console.log(`      Brand: ${result.brandName}`);
      console.log(`      产品数: ${result.totalProducts}`);
      console.log(`      耗时: ${(duration / 1000).toFixed(2)}秒`);

      results.push({
        url: link.finalUrl,
        success: true,
        storeName: result.storeName,
        productCount: result.totalProducts,
      });

      // Store抓取之间增加更长的间隔（10-15秒）
      const longerDelay = Math.floor(Math.random() * 5000) + 10000;
      console.log(`   ⏳ 等待 ${(longerDelay / 1000).toFixed(1)}秒后继续...`);
      await new Promise(resolve => setTimeout(resolve, longerDelay));

    } catch (error) {
      console.error(`   ❌ 抓取失败: ${error instanceof Error ? error.message.slice(0, 100) : String(error)}`);

      results.push({
        url: link.finalUrl,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('\n📊 抓取结果汇总:');
  results.forEach((r, i) => {
    if (r.success) {
      console.log(`   ${i + 1}. ✅ ${r.storeName} - ${r.productCount}个产品`);
    } else {
      console.log(`   ${i + 1}. ❌ 失败 - ${r.error?.slice(0, 50)}`);
    }
  });

  console.log('\n✅ 测试2完成');
}

/**
 * 测试3: 检查数据库记录
 */
async function test3_CheckDatabaseRecords() {
  console.log('\n📝 测试3: 检查数据库记录');
  console.log('='.repeat(60));

  const dbPersistence = getCrawleePersistence();

  // 获取最近的抓取历史
  const history = await dbPersistence.getHistory({ userId: USER_ID, limit: 10 });
  console.log(`\n📊 数据库中最近${Math.min(history.length, 5)}条记录:`);

  history.slice(0, 5).forEach((record, i) => {
    console.log(`\n${i + 1}. ${record.status === 'success' ? '✅' : '❌'} ${record.store_name}`);
    console.log(`   URL: ${record.url.slice(0, 70)}...`);
    console.log(`   品牌: ${record.brand_name}`);
    console.log(`   产品数: ${record.product_count}`);
    console.log(`   状态: ${record.status}`);
    console.log(`   时间: ${record.created_at}`);
  });

  // 获取统计数据
  const stats = await dbPersistence.getStatistics(USER_ID);
  console.log('\n📈 用户统计:');
  console.log(`   总抓取: ${stats.totalScrapes}`);
  console.log(`   成功: ${stats.successfulScrapes}`);
  console.log(`   失败: ${stats.failedScrapes}`);
  console.log(`   成功率: ${stats.successRate.toFixed(2)}%`);
  console.log(`   总产品数: ${stats.totalProducts}`);

  console.log('\n✅ 测试3完成');
}

/**
 * 主测试函数
 */
async function main() {
  console.log('\n🧪 真实推广链接 + Crawlee综合测试（使用系统API）');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toISOString()}`);
  console.log(`用户ID: ${USER_ID}`);
  console.log(`测试链接数: ${TEST_OFFERS.length}`);
  console.log(`API服务: ${BASE_URL}`);

  try {
    // 登录获取认证
    console.log('\n🔐 正在登录...');
    const authCookie = await getAuthCookie();
    console.log('✅ 登录成功');

    // 测试1: 使用API解析推广链接
    const resolvedLinks = await test1_ExtractOfferInfo(authCookie);

    // 测试2: 抓取Amazon Store
    await test2_ScrapeAmazonStores(resolvedLinks, authCookie);

    // 测试3: 检查数据库记录
    await test3_CheckDatabaseRecords();

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有测试完成！');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

main();

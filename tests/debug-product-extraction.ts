/**
 * 调试产品提取问题
 *
 * 目标：保存页面HTML并分析选择器问题
 */

import { scrapeAmazonStore } from '../src/lib/scraper-stealth';
import fs from 'fs/promises';
import path from 'path';

const TEST_URL = 'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02';
const TEST_USER_ID = 1;

async function main() {
  console.log('🔍 调试产品提取问题...\n');

  // 测试3次，收集HTML
  for (let i = 1; i <= 3; i++) {
    console.log(`\n━━━━ 测试 ${i}/3 ━━━━`);

    try {
      // 启用HTML保存
      process.env.SAVE_HTML_DEBUG = 'true';

      const result = await scrapeAmazonStore(TEST_URL);

      console.log(`✅ 测试${i}完成:`);
      console.log(`   产品数: ${result.productCount}`);
      console.log(`   Store名: ${result.storeName}`);
      console.log(`   Brand名: ${result.brandName}`);

      // 如果有产品，显示前3个
      if (result.products && result.products.length > 0) {
        console.log('\n   前3个产品:');
        result.products.slice(0, 3).forEach((p, idx) => {
          console.log(`   ${idx + 1}. ${p.name} (${p.asin})`);
        });
      }

    } catch (error) {
      console.error(`❌ 测试${i}失败:`, error);
    }

    // 等待5秒再进行下一次测试
    if (i < 3) {
      console.log('\n⏳ 等待5秒...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 调试总结');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('HTML文件已保存到 claudedocs/ 目录');
  console.log('请检查HTML文件以分析选择器问题');
}

main().catch(console.error);

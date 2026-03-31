/**
 * 调试脚本：测试Amazon单品页面品牌提取
 */

import axios from 'axios';
import { load } from 'cheerio';

const url = 'https://www.amazon.com/dp/B0B8HLXC8Y';

async function test() {
  console.log('🔍 测试Amazon单品页面品牌提取...\n');
  console.log(`URL: ${url}\n`);

  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = load(response.data);

    console.log('📋 尝试各种品牌选择器：\n');

    // 1. 标准选择器
    console.log('1. #bylineInfo:', $('#bylineInfo').text().trim() || '(空)');
    console.log('2. [data-brand]:', $('[data-brand]').attr('data-brand') || '(空)');
    console.log('3. #productTitle:', $('#productTitle').text().trim().slice(0, 60) || '(空)');

    // 2. 备用选择器
    console.log('\n📋 备用选择器：');
    console.log('4. .po-brand .a-size-base:', $('.po-brand .a-size-base').text().trim() || '(空)');
    console.log('5. a#bylineInfo:', $('a#bylineInfo').text().trim() || '(空)');
    console.log('6. #brand:', $('#brand').text().trim() || '(空)');
    console.log('7. [itemprop="brand"]:', $('[itemprop="brand"]').text().trim() || '(空)');
    console.log('8. #bylineInfo_feature_div:', $('#bylineInfo_feature_div').text().trim() || '(空)');

    // 3. 检查JSON-LD结构化数据
    console.log('\n📋 JSON-LD结构化数据：');
    const jsonLdScripts = $('script[type="application/ld+json"]');
    console.log(`   找到 ${jsonLdScripts.length} 个JSON-LD脚本`);
    jsonLdScripts.each((i, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}');
        if (json.brand) {
          console.log(`   Script ${i+1} brand:`, json.brand.name || json.brand);
        }
        if (json['@type'] === 'Product') {
          console.log(`   Script ${i+1} Product brand:`, json.brand?.name || '(无)');
        }
      } catch {}
    });

    // 4. 检查页面标题
    console.log('\n📋 页面标题：');
    console.log('   title:', $('title').text().trim().slice(0, 100));

    // 5. 检查HTML中是否有品牌关键字（正则搜索）
    console.log('\n📋 搜索HTML中的品牌信息（正则）：');
    const html = response.data;
    const brandPatterns = [
      { name: '"brand":', pattern: /"brand":\s*"([^"]+)"/ },
      { name: 'Visit the ... Store', pattern: /Visit the ([^<]+) Store/ },
      { name: 'Brand:', pattern: /Brand:\s*<[^>]*>([^<]+)</ },
      { name: '"brandName":', pattern: /"brandName":\s*"([^"]+)"/ },
    ];

    brandPatterns.forEach(({ name, pattern }) => {
      const match = html.match(pattern);
      if (match) {
        console.log(`   ✅ ${name} → "${match[1]}"`);
      } else {
        console.log(`   ❌ ${name} → 未找到`);
      }
    });

    // 6. 检查是否被Amazon拦截
    console.log('\n📋 页面状态检查：');
    const isBlocked = html.includes('Robot Check') || html.includes('Enter the characters');
    const isCaptcha = html.includes('captcha');
    console.log('   被拦截:', isBlocked ? '❌ 是' : '✅ 否');
    console.log('   验证码:', isCaptcha ? '❌ 是' : '✅ 否');
    console.log('   HTML长度:', html.length, '字符');

  } catch (error: any) {
    console.error('❌ 错误:', error.message);
  }
}

test();

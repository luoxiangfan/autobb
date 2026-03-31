/**
 * 调试脚本：通过API追踪品牌提取流程
 */

const BASE_URL = 'http://localhost:3000';
const TEST_URL = 'https://pboost.me/RKWwEZR9';

async function getAuthCookie(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'autoads',
      password: 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='
    }),
  });

  if (!response.ok) {
    throw new Error(`登录失败: ${response.status}`);
  }

  const setCookie = response.headers.get('set-cookie');
  const match = setCookie?.match(/auth_token=([^;]+)/);
  return match ? `auth_token=${match[1]}` : setCookie || '';
}

async function main() {
  console.log('🔍 调试API品牌提取流程\n');
  console.log(`测试链接: ${TEST_URL}\n`);

  const authCookie = await getAuthCookie();
  console.log('✅ 登录成功\n');

  console.log('📡 调用 /api/offers/extract ...\n');

  const response = await fetch(`${BASE_URL}/api/offers/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie,
    },
    body: JSON.stringify({
      affiliate_link: TEST_URL,
      target_country: 'US',
      skipCache: true,
    }),
  });

  const data = await response.json();
  const d = data.data || data;

  console.log('📋 API返回结果：\n');
  console.log('Final URL:', d.finalUrl);
  console.log('品牌名:', d.brand || '(null/undefined)');
  console.log('产品名:', d.productName || '(null/undefined)');
  console.log('产品描述:', d.productDescription?.slice(0, 100) || '(null/undefined)');
  console.log('价格:', d.price || '(null/undefined)');
  console.log('图片数:', d.imageUrls?.length || 0);
  console.log('\n调试信息:', JSON.stringify(d.debug, null, 2));
}

main().catch(console.error);

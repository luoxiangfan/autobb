// API测试：验证Offer删除功能
const http = require('http');

const baseUrl = 'http://localhost:3000';

// 辅助函数：发送HTTP请求
function request(method, path, data = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: jsonBody
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testOfferDelete() {
  console.log('🧪 测试Offer删除功能（API接口）\n');

  try {
    // 1. 登录获取token
    console.log('步骤1: 登录获取认证token...');
    const loginRes = await request('POST', '/api/auth/login', {
      username: 'autoads',
      password: '***REMOVED***'
    });

    if (loginRes.status !== 200) {
      console.error('❌ 登录失败:', loginRes.body);
      process.exit(1);
    }

    // 提取cookie
    const setCookie = loginRes.headers['set-cookie'];
    const authCookie = setCookie ? setCookie[0].split(';')[0] : '';
    console.log('✅ 登录成功');

    // 2. 获取offer列表
    console.log('\n步骤2: 获取Offer列表...');
    const listRes = await request('GET', '/api/offers', null, authCookie);

    if (listRes.status !== 200) {
      console.error('❌ 获取列表失败:', listRes.body);
      process.exit(1);
    }

    const offers = listRes.body.offers || listRes.body;
    const beforeCount = offers.length;
    console.log(`✅ 当前共有 ${beforeCount} 个Offer`);

    if (beforeCount === 0) {
      console.log('⚠️  列表为空，无法测试删除功能');
      process.exit(0);
    }

    // 3. 删除第一个offer
    const offerId = offers[0].id;
    console.log(`\n步骤3: 删除Offer (ID: ${offerId})...`);
    const deleteRes = await request('DELETE', `/api/offers/${offerId}`, null, authCookie);

    if (deleteRes.status !== 200) {
      console.error('❌ 删除失败:', deleteRes.body);
      process.exit(1);
    }

    console.log('✅ 删除成功');

    // 4. 验证删除结果
    console.log('\n步骤4: 验证删除结果...');
    const verifyRes = await request('GET', '/api/offers', null, authCookie);

    if (verifyRes.status !== 200) {
      console.error('❌ 验证失败:', verifyRes.body);
      process.exit(1);
    }

    const afterOffers = verifyRes.body.offers || verifyRes.body;
    const afterCount = afterOffers.length;
    console.log(`✅ 删除后共有 ${afterCount} 个Offer`);

    // 5. 断言验证
    console.log('\n步骤5: 结果验证...');
    if (afterCount === beforeCount - 1) {
      console.log('✅ 测试通过：Offer数量减少1');
      const deletedStillExists = afterOffers.some(o => o.id === offerId);
      if (deletedStillExists) {
        console.error('❌ 测试失败：已删除的Offer仍存在于列表中');
        process.exit(1);
      }
      console.log('✅ 测试通过：已删除的Offer不在列表中');
      console.log('\n🎉 所有测试通过！');
      process.exit(0);
    } else {
      console.error(`❌ 测试失败：期望数量 ${beforeCount - 1}，实际数量 ${afterCount}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ 测试执行出错:', error.message);
    process.exit(1);
  }
}

testOfferDelete();

#!/usr/bin/env node
/**
 * IPRocket API 高频测试
 * 模拟换链接任务的请求频率，检查是否会触发风控
 */

const https = require('https');

const IPROCKET_CONFIG = {
  username: process.env.IPROCKET_USERNAME || 'your_username',
  password: process.env.IPROCKET_PASSWORD || 'your_password',
  country: 'DE'
};

function testIPRocketAPI() {
  return new Promise((resolve) => {
    const url = `https://api.iprocket.io/api?username=${IPROCKET_CONFIG.username}&password=${IPROCKET_CONFIG.password}&cc=${IPROCKET_CONFIG.country}&ips=1&type=-res-&proxyType=http&responseType=txt`;

    const startTime = Date.now();

    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/plain,*/*'
      }
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const duration = Date.now() - startTime;
        const response = data.trim();

        // 检查是否是错误响应
        if (response.startsWith('{') && response.includes('"code"')) {
          try {
            const json = JSON.parse(response);
            resolve({
              success: false,
              error: json.msg || json.message,
              code: json.code,
              duration,
              statusCode: res.statusCode
            });
            return;
          } catch (e) {
            // JSON 解析失败，继续处理
          }
        }

        // 检查是否是正常的代理响应
        if (response.includes(':')) {
          const parts = response.split(':');
          resolve({
            success: true,
            proxy: `${parts[0]}:${parts[1]}`,
            duration,
            statusCode: res.statusCode
          });
        } else {
          resolve({
            success: false,
            error: 'Invalid response format',
            response: response.substring(0, 100),
            duration,
            statusCode: res.statusCode
          });
        }
      });
    }).on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        duration: Date.now() - startTime
      });
    });
  });
}

async function runTest() {
  console.log('🔍 IPRocket API 高频测试');
  console.log(`配置: username=${IPROCKET_CONFIG.username}, country=${IPROCKET_CONFIG.country}\n`);

  const testCases = [
    { name: '正常频率', count: 5, interval: 1000 },
    { name: '高频请求', count: 10, interval: 100 },
    { name: '极高频', count: 20, interval: 50 }
  ];

  for (const testCase of testCases) {
    console.log(`\n📊 测试场景: ${testCase.name} (${testCase.count}次请求, 间隔${testCase.interval}ms)`);
    console.log('─'.repeat(80));

    const results = [];

    for (let i = 0; i < testCase.count; i++) {
      const result = await testIPRocketAPI();
      results.push(result);

      const status = result.success ? '✅' : '❌';
      const info = result.success
        ? `${result.proxy} (${result.duration}ms)`
        : `${result.error} (${result.duration}ms)`;

      console.log(`  ${i + 1}/${testCase.count} ${status} ${info}`);

      // 如果遇到错误，立即停止并报告
      if (!result.success && result.error && result.error.includes('abnormality')) {
        console.log(`\n🔴 触发风控！在第 ${i + 1} 次请求时收到业务异常错误`);
        console.log(`   错误信息: ${result.error}`);
        console.log(`   错误代码: ${result.code}`);
        break;
      }

      if (i < testCase.count - 1) {
        await new Promise(resolve => setTimeout(resolve, testCase.interval));
      }
    }

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log(`\n📈 结果: ${successCount}/${results.length} 成功, 平均耗时: ${Math.round(avgDuration)}ms`);

    if (failCount > 0) {
      console.log(`⚠️  失败 ${failCount} 次`);
      const errors = results.filter(r => !r.success).map(r => r.error);
      console.log(`   错误类型: ${[...new Set(errors)].join(', ')}`);
    }

    // 等待一段时间再进行下一个测试
    if (testCase !== testCases[testCases.length - 1]) {
      console.log('\n⏳ 等待 5 秒后继续下一个测试...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('\n\n✅ 测试完成');
  console.log('\n结论:');
  console.log('- 如果所有测试都成功，说明 IPRocket API 当前工作正常');
  console.log('- 如果高频测试失败，说明可能触发了频率限制');
  console.log('- 如果出现 "Business abnormality" 错误，说明账户或服务有问题');
}

runTest().catch(console.error);

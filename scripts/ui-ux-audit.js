/**
 * UI/UX Audit Script
 * 系统性地访问所有页面，截图并评估UI/UX问题
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(__dirname, '../claudedocs/ui-ux-audit');
const SCREENSHOT_DIR = path.join(AUDIT_DIR, 'screenshots');

// 创建目录
if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// 要测试的路由列表
const routes = [
  { path: '/', name: '首页营销页面', requiresAuth: false },
  { path: '/login', name: '登录页面', requiresAuth: false },
  { path: '/register', name: '注册页面', requiresAuth: false },
  { path: '/dashboard', name: '仪表盘', requiresAuth: true },
  { path: '/offers', name: 'Offer列表', requiresAuth: true },
  { path: '/campaigns', name: '广告系列列表', requiresAuth: true },
  { path: '/creatives', name: '创意管理', requiresAuth: true },
  { path: '/launch-score', name: '投放评分', requiresAuth: true },
  { path: '/data-management', name: '数据管理', requiresAuth: true },
  { path: '/settings', name: '系统设置', requiresAuth: true },
  { path: '/admin/users', name: '用户管理（管理员）', requiresAuth: true },
  { path: '/change-password', name: '修改密码', requiresAuth: true },
];

async function login(page) {
  console.log('  🔐 正在登录...');
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="username"]', 'autoads');
  await page.fill('input[name="password"]', '***REMOVED***');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  console.log('  ✅ 登录成功');
}

async function auditPage(page, route) {
  try {
    console.log(`\n📄 正在访问: ${route.name} (${route.path})`);

    await page.goto(`http://localhost:3000${route.path}`, {
      waitUntil: 'networkidle',
      timeout: 15000
    });

    // 等待页面加载
    await page.waitForTimeout(2000);

    // 截图
    const screenshotPath = path.join(SCREENSHOT_DIR, `${route.name.replace(/[\/\s()（）]/g, '-')}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });
    console.log(`  📸 截图保存: ${screenshotPath}`);

    // 收集页面信息
    const pageInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
        text: btn.textContent?.trim() || '',
        visible: btn.offsetParent !== null
      }));

      const links = Array.from(document.querySelectorAll('a')).map(link => ({
        text: link.textContent?.trim() || '',
        href: link.getAttribute('href')
      }));

      const forms = Array.from(document.querySelectorAll('form')).map(form => ({
        action: form.action,
        inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(input => ({
          type: input.type,
          name: input.name,
          placeholder: input.placeholder
        }))
      }));

      const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')).map(modal => ({
        visible: modal.offsetParent !== null,
        content: modal.textContent?.substring(0, 100) || ''
      }));

      return {
        title: document.title,
        buttons: buttons.filter(b => b.visible),
        links: links.filter(l => l.text),
        forms,
        modals: modals.filter(m => m.visible),
        hasErrors: !!document.querySelector('.error, [class*="error"]'),
        hasLoadingSpinners: !!document.querySelector('.loading, .spinner, [class*="loading"]')
      };
    });

    console.log(`  ✅ 页面信息收集完成`);
    console.log(`     - 按钮数量: ${pageInfo.buttons.length}`);
    console.log(`     - 链接数量: ${pageInfo.links.length}`);
    console.log(`     - 表单数量: ${pageInfo.forms.length}`);

    return {
      route,
      pageInfo,
      status: 'success'
    };
  } catch (error) {
    console.log(`  ❌ 访问失败: ${error.message}`);
    return {
      route,
      status: 'error',
      error: error.message
    };
  }
}

async function runAudit() {
  console.log('🚀 开始UI/UX审查...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  const results = [];

  // 先访问公开页面
  for (const route of routes.filter(r => !r.requiresAuth)) {
    const result = await auditPage(page, route);
    results.push(result);
  }

  // 登录
  await login(page);

  // 访问需要认证的页面
  for (const route of routes.filter(r => r.requiresAuth)) {
    const result = await auditPage(page, route);
    results.push(result);
  }

  // 生成报告
  const reportPath = path.join(AUDIT_DIR, 'audit-results.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ 审查完成！结果保存到: ${reportPath}`);

  await browser.close();

  return results;
}

runAudit().catch(console.error);

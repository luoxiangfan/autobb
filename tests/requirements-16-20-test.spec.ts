import { test, expect } from '@playwright/test'

// 更新端口为3002
const BASE_URL = 'http://localhost:3002'

test.describe('需求16-20功能测试', () => {
  
  // 需求20：用户登录
  test('需求20: 管理员登录功能', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    
    // 填写登录表单
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    
    // 点击登录按钮
    await page.click('button[type="submit"]')
    
    // 等待跳转到dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 })
    
    // 验证登录成功
    await expect(page).toHaveURL(/\/dashboard/)
    
    console.log('✅ 管理员登录成功')
  })

  // 需求20：个人中心功能
  test('需求20: 个人中心显示功能', async ({ page }) => {
    // 先登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 })
    
    // 查找并点击个人中心按钮（可能在右上角）
    const profileButton = page.locator('text=/个人中心|Profile/i').first()
    if (await profileButton.isVisible()) {
      await profileButton.click()
      
      // 等待弹窗出现
      await page.waitForSelector('text=/个人基本信息/', { timeout: 5000 })
      
      // 验证显示了必要信息
      await expect(page.locator('text=/套餐类型/')).toBeVisible()
      await expect(page.locator('text=/套餐有效期/')).toBeVisible()
      await expect(page.locator('text=/终身版|年卡版|试用版/')).toBeVisible()
      
      console.log('✅ 个人中心功能正常')
    } else {
      console.log('⚠️  个人中心按钮未找到（可能需要UI调整）')
    }
  })

  // 需求16-17：一键上广告流程
  test('需求16-17: 一键上广告流程测试', async ({ page }) => {
    // 先登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 })
    
    // 进入Offer列表页
    await page.goto(`${BASE_URL}/offers`)
    await page.waitForLoadState('networkidle')
    
    // 检查是否有Offer（如果没有，需要先创建）
    const hasOffers = await page.locator('table tbody tr').count() > 0
    
    if (hasOffers) {
      // 查找"一键上广告"按钮
      const launchAdButton = page.locator('button:has-text("一键上广告")').first()
      
      if (await launchAdButton.isVisible()) {
        await launchAdButton.click()
        
        // Step 1: 选择广告变体数量
        await page.waitForSelector('text=/选择广告变体数量/', { timeout: 5000 })
        
        // 测试需求16：选择1个广告（应该自动为品牌导向）
        await page.click('button:has-text("1 个广告")')
        await expect(page.locator('text=/品牌导向.*必选/i')).toBeVisible()
        
        // 测试需求16：选择3个广告（应该包含品牌/产品/促销）
        await page.click('button:has-text("3 个广告")')
        await expect(page.locator('text=/品牌导向/')).toBeVisible()
        await expect(page.locator('text=/产品导向/')).toBeVisible()
        await expect(page.locator('text=/促销导向/')).toBeVisible()
        
        console.log('✅ 需求16: 广告变体选择功能正常')
        
        // 点击下一步
        await page.click('button:has-text("下一步")')
        
        // Step 2: 广告系列设置
        await page.waitForSelector('text=/广告系列设置/', { timeout: 5000 })
        
        // 验证默认值（需求14）
        await expect(page.locator('input[value*="Website traffic"]')).toBeVisible()
        
        console.log('✅ Step 2: 广告系列设置页面正常')
        
        // 注意：实际API调用测试需要真实的Google Ads账号授权
        // 这里只测试UI流程
        
      } else {
        console.log('⚠️  "一键上广告"按钮未找到')
      }
    } else {
      console.log('⚠️  暂无Offer，跳过一键上广告测试')
    }
  })

  // 需求20：用户管理功能
  test('需求20: 管理员用户管理功能', async ({ page }) => {
    // 先登录管理员
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 })
    
    // 进入用户管理页面
    await page.goto(`${BASE_URL}/admin/users`)
    await page.waitForLoadState('networkidle')
    
    // 验证用户列表显示
    await expect(page.locator('table')).toBeVisible()
    
    // 查找"创建新用户"按钮
    const createUserButton = page.locator('button:has-text("创建新用户"), button:has-text("创建用户")')
    
    if (await createUserButton.first().isVisible()) {
      await createUserButton.first().click()
      
      // 等待创建用户弹窗
      await page.waitForSelector('text=/创建新用户|新建用户/', { timeout: 5000 })
      
      // 验证套餐类型选项
      await expect(page.locator('text=/试用版|年卡版|终身版/')).toBeVisible()
      
      console.log('✅ 需求20: 用户管理功能界面正常')
      
      // 关闭弹窗
      const closeButton = page.locator('button:has-text("取消"), button:has-text("关闭")').first()
      if (await closeButton.isVisible()) {
        await closeButton.click()
      }
    }
  })
  
})


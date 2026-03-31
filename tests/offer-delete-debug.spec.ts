import { test, expect } from '@playwright/test'

/**
 * Offer删除功能调试测试
 * 验证UI元素和删除按钮
 */

test.describe('Offer删除UI调试', () => {
  test('检查Offer页面UI元素', async ({ page }) => {
    // 设置大屏幕viewport（确保显示PC端表格）
    await page.setViewportSize({ width: 1920, height: 1080 })

    // 登录
    await page.goto('http://localhost:3000/login')
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard', { timeout: 10000 })

    // 导航到offers页面
    await page.goto('http://localhost:3000/offers')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // 截图
    await page.screenshot({ path: 'test-screenshots/offers-page-full.png', fullPage: true })
    console.log('✅ 已保存完整页面截图: test-screenshots/offers-page-full.png')

    // 检查总数显示
    const totalText = await page.locator('text=/共 \\d+ 条/').textContent()
    console.log(`📊 页面显示总数: ${totalText}`)

    // 检查表格行数
    const tableRows = page.locator('table tbody tr')
    const rowCount = await tableRows.count()
    console.log(`📋 表格行数: ${rowCount}`)

    // 检查删除按钮
    const deleteButtons = page.locator('button:has-text("删除")')
    const deleteButtonCount = await deleteButtons.count()
    console.log(`🗑️ 删除按钮数量: ${deleteButtonCount}`)

    // 检查批量删除按钮
    const batchDeleteButton = page.locator('button:has-text("删除选中")')
    const hasBatchDelete = await batchDeleteButton.isVisible()
    console.log(`📦 批量删除按钮可见: ${hasBatchDelete}`)

    // 检查checkbox
    const checkboxes = page.locator('input[type="checkbox"]')
    const checkboxCount = await checkboxes.count()
    console.log(`☑️ Checkbox数量: ${checkboxCount}`)

    // 检查是否有"操作"列
    const actionHeaders = page.locator('th:has-text("操作")')
    const hasActionColumn = await actionHeaders.count() > 0
    console.log(`🔧 是否有"操作"列: ${hasActionColumn}`)

    // 如果有删除按钮，截图第一行
    if (deleteButtonCount > 0) {
      const firstRow = tableRows.first()
      await firstRow.screenshot({ path: 'test-screenshots/first-row-with-delete.png' })
      console.log('✅ 已保存第一行截图: test-screenshots/first-row-with-delete.png')
    }

    // 检查所有按钮文本
    const allButtons = page.locator('button')
    const buttonCount = await allButtons.count()
    console.log(`🔘 页面总按钮数: ${buttonCount}`)

    for (let i = 0; i < Math.min(buttonCount, 20); i++) {
      const buttonText = await allButtons.nth(i).textContent()
      console.log(`  按钮${i + 1}: "${buttonText}"`)
    }
  })
})

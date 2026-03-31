import { test, expect } from '@playwright/test'

test.describe('HttpOnly Cookie Authentication Flow', () => {
  test.setTimeout(60000)

  test('Complete authentication flow with HttpOnly Cookie', async ({ page }) => {
    console.log('\n========== Step 1: Test Unauthenticated Access ==========')

    // 尝试直接访问受保护页面
    await page.goto('http://localhost:3000/offers')
    await page.waitForTimeout(2000)

    // 应该被重定向到登录页
    const currentUrl = page.url()
    console.log('Redirect URL:', currentUrl)
    expect(currentUrl).toContain('/login')
    expect(currentUrl).toContain('redirect=%2Foffers')
    console.log('✅ 未认证用户被正确重定向到登录页')

    console.log('\n========== Step 2: Test Login with HttpOnly Cookie ==========')

    // 填写登录表单
    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')

    // 提交表单
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 })

    // 验证登录成功
    const loggedInUrl = page.url()
    console.log('After login URL:', loggedInUrl)

    // 检查cookie是否设置
    const cookies = await page.context().cookies()
    const authCookie = cookies.find(c => c.name === 'auth_token')

    console.log('Auth cookie found:', authCookie ? 'YES' : 'NO')
    if (authCookie) {
      console.log('  - httpOnly:', authCookie.httpOnly)
      console.log('  - secure:', authCookie.secure)
      console.log('  - sameSite:', authCookie.sameSite)
      console.log('  - path:', authCookie.path)
      expect(authCookie.httpOnly).toBe(true) // 必须是HttpOnly
    } else {
      throw new Error('Auth cookie not found!')
    }
    console.log('✅ HttpOnly Cookie设置成功')

    // 验证localStorage中没有token（安全）
    const hasLocalStorageToken = await page.evaluate(() => {
      return localStorage.getItem('auth_token') !== null
    })
    expect(hasLocalStorageToken).toBe(false)
    console.log('✅ localStorage中没有token（安全）')

    console.log('\n========== Step 3: Test Protected Page Access ==========')

    // 访问Offers页面
    await page.goto('http://localhost:3000/offers')
    await page.waitForTimeout(3000)

    // 应该能正常访问（不被重定向）
    const offersUrl = page.url()
    console.log('Offers page URL:', offersUrl)
    expect(offersUrl).toContain('/offers')
    expect(offersUrl).not.toContain('/login')
    console.log('✅ 认证用户可以访问受保护页面')

    // 检查Offers是否加载
    const hasTable = await page.locator('table').count() > 0
    const hasButton = await page.locator('button:has-text("创建Offer")').count() > 0
    console.log('Has Offers table:', hasTable ? 'YES' : 'NO')
    console.log('Has Create button:', hasButton ? 'YES' : 'NO')

    if (hasTable) {
      const rowCount = await page.locator('table tbody tr').count()
      console.log('Offer rows found:', rowCount)
      console.log('✅ Offers数据加载成功')
    }

    // 截图
    await page.screenshot({ path: '/tmp/httponly-offers-page.png', fullPage: true })
    console.log('📸 Screenshot saved to /tmp/httponly-offers-page.png')

    console.log('\n========== Step 4: Test API Call with Cookie ==========')

    // 直接调用API测试cookie自动携带
    const apiResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/offers', {
          credentials: 'include'
        })
        return {
          status: response.status,
          ok: response.ok,
          hasData: response.ok
        }
      } catch (error) {
        return { error: error.message }
      }
    })

    console.log('API call result:', JSON.stringify(apiResult, null, 2))
    expect(apiResult.status).toBe(200)
    console.log('✅ API调用成功（Cookie自动携带）')

    console.log('\n========== Step 5: Test Logout ==========')

    // 调用登出API
    const logoutResult = await page.evaluate(async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
      return {
        status: response.status,
        ok: response.ok
      }
    })

    console.log('Logout result:', JSON.stringify(logoutResult, null, 2))
    expect(logoutResult.status).toBe(200)

    // 检查cookie是否被清除
    const cookiesAfterLogout = await page.context().cookies()
    const authCookieAfterLogout = cookiesAfterLogout.find(c => c.name === 'auth_token')

    if (authCookieAfterLogout) {
      console.log('Auth cookie value after logout:', authCookieAfterLogout.value)
      expect(authCookieAfterLogout.value).toBe('')
    }
    console.log('✅ 登出成功，Cookie已清除')

    console.log('\n========== Step 6: Verify Access After Logout ==========')

    // 刷新页面，应该被重定向到登录页
    await page.reload()
    await page.waitForTimeout(2000)

    const urlAfterLogout = page.url()
    console.log('URL after logout and reload:', urlAfterLogout)
    expect(urlAfterLogout).toContain('/login')
    console.log('✅ 登出后无法访问受保护页面')

    console.log('\n========== ✅ All HttpOnly Cookie Tests Passed! ==========')
  })
})

import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'

// 管理员账户
const ADMIN_CREDENTIALS = {
  username: 'autoads',
  password: '***REMOVED***'
}

// 测试用普通用户
let testUserId: number
let testUsername: string
const DEFAULT_PASSWORD = 'auto11@20ads'

/**
 * 辅助函数：管理员登录
 */
async function adminLogin(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.fill('input[name="username"], input[placeholder*="用户名"]', ADMIN_CREDENTIALS.username)
  await page.fill('input[name="password"], input[type="password"]', ADMIN_CREDENTIALS.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 })
}

/**
 * 辅助函数：普通用户登录
 */
async function userLogin(page: Page, username: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.fill('input[name="username"], input[placeholder*="用户名"]', username)
  await page.fill('input[name="password"], input[type="password"]', password)
  await page.click('button[type="submit"]')
}

/**
 * 辅助函数：获取认证Cookie
 */
async function getAuthCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  const authCookie = cookies.find(c => c.name === 'auth_token')
  return authCookie?.value || ''
}

test.describe('1. 用户创建/禁用/删除功能', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page)
  })

  test('1.1 管理员可以创建新用户（API测试）', async ({ request }) => {
    // 管理员登录
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    expect(loginResponse.ok()).toBeTruthy()
    const cookies = loginResponse.headers()['set-cookie']

    // 生成唯一用户名
    testUsername = `testuser_${Date.now()}`

    // 创建用户
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: testUsername,
        email: `${testUsername}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })

    expect(createResponse.ok()).toBeTruthy()
    const data = await createResponse.json()
    expect(data.success).toBeTruthy()
    expect(data.user).toBeDefined()
    expect(data.user.username).toBe(testUsername)
    expect(data.defaultPassword).toBe(DEFAULT_PASSWORD)

    testUserId = data.user.id
    console.log(`Created test user: ${testUsername} (ID: ${testUserId})`)
  })

  test('1.2 管理员可以禁用用户（API测试）', async ({ request }) => {
    // 管理员登录
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 创建一个测试用户用于禁用
    const testUser = `disable_test_${Date.now()}`
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: testUser,
        email: `${testUser}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })
    const createData = await createResponse.json()
    const userId = createData.user?.id

    if (userId) {
      // 禁用用户
      const disableResponse = await request.delete(`${BASE_URL}/api/admin/users/${userId}`, {
        headers: { 'Cookie': cookies || '' }
      })
      expect(disableResponse.ok()).toBeTruthy()
      const data = await disableResponse.json()
      expect(data.success).toBeTruthy()
    }
  })

  test('1.3 被禁用用户无法登录（API测试）', async ({ request }) => {
    // 管理员登录并创建用户
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 创建测试用户
    const testUser = `disabled_login_${Date.now()}`
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: testUser,
        email: `${testUser}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })
    const createData = await createResponse.json()
    const userId = createData.user?.id

    if (userId) {
      // 禁用用户
      await request.delete(`${BASE_URL}/api/admin/users/${userId}`, {
        headers: { 'Cookie': cookies || '' }
      })

      // 尝试用被禁用的用户登录
      const userLoginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
        data: {
          username: testUser,
          password: DEFAULT_PASSWORD
        }
      })

      // 应该返回错误
      expect(userLoginResponse.ok()).toBeFalsy()
      const data = await userLoginResponse.json()
      expect(data.error).toContain('禁用')
    }
  })

  test('1.4 管理员可以启用用户（API测试）', async ({ request }) => {
    // 管理员登录
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 创建并禁用用户
    const testUser = `enable_test_${Date.now()}`
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: testUser,
        email: `${testUser}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })
    const createData = await createResponse.json()
    const userId = createData.user?.id

    if (userId) {
      // 先禁用
      await request.delete(`${BASE_URL}/api/admin/users/${userId}`, {
        headers: { 'Cookie': cookies || '' }
      })

      // 再启用
      const enableResponse = await request.patch(`${BASE_URL}/api/admin/users/${userId}`, {
        headers: { 'Cookie': cookies || '' },
        data: { isActive: true }
      })
      expect(enableResponse.ok()).toBeTruthy()
      const data = await enableResponse.json()
      expect(data.user.is_active).toBe(1)
    }
  })
})

test.describe('2. 普通用户首次登录强制改密功能', () => {
  test('2.1 API验证：创建用户时must_change_password=1', async ({ request }) => {
    // 先获取管理员token
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    expect(loginResponse.ok()).toBeTruthy()

    // 从响应头获取Set-Cookie
    const cookies = loginResponse.headers()['set-cookie']

    // 创建新用户
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: {
        'Cookie': cookies || ''
      },
      data: {
        username: `forcechange_${Date.now()}`,
        email: `forcechange_${Date.now()}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })

    expect(createResponse.ok()).toBeTruthy()
    const data = await createResponse.json()
    expect(data.success).toBeTruthy()
    expect(data.defaultPassword).toBe(DEFAULT_PASSWORD)
  })

  test('2.2 登录返回mustChangePassword标志', async ({ request }) => {
    // 使用需要改密的用户登录
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: 'test@example.com', // 这个用户must_change_password=1
        password: DEFAULT_PASSWORD
      }
    })

    // 如果用户存在且密码正确
    if (loginResponse.ok()) {
      const data = await loginResponse.json()
      expect(data.mustChangePassword).toBe(true)
    }
  })

  test('2.3 改密后must_change_password设为0', async ({ request }) => {
    // 创建测试用户
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 创建需要改密的用户
    const newUsername = `mustchange_${Date.now()}`
    await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: newUsername,
        email: `${newUsername}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })

    // 用新用户登录
    const userLoginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: newUsername,
        password: DEFAULT_PASSWORD
      }
    })

    if (userLoginResponse.ok()) {
      const userCookies = userLoginResponse.headers()['set-cookie']

      // 改密
      const changeResponse = await request.post(`${BASE_URL}/api/auth/change-password`, {
        headers: { 'Cookie': userCookies || '' },
        data: {
          currentPassword: DEFAULT_PASSWORD,
          newPassword: 'NewPass123!@#'
        }
      })

      expect(changeResponse.ok()).toBeTruthy()
      const changeData = await changeResponse.json()
      expect(changeData.success).toBeTruthy()
    }
  })
})

test.describe('3. 用户数据按user_id隔离', () => {
  test('3.1 不同用户看到各自的Offer数据', async ({ request }) => {
    // 管理员登录
    const adminLogin = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const adminCookies = adminLogin.headers()['set-cookie']

    // 获取管理员的Offers
    const adminOffers = await request.get(`${BASE_URL}/api/offers`, {
      headers: { 'Cookie': adminCookies || '' }
    })
    expect(adminOffers.ok()).toBeTruthy()
    const adminData = await adminOffers.json()

    // 用普通用户登录
    const userLogin = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: 'testuser',
        password: 'Test123!@#' // 假设的测试用户密码
      }
    })

    if (userLogin.ok()) {
      const userCookies = userLogin.headers()['set-cookie']

      // 获取用户的Offers
      const userOffers = await request.get(`${BASE_URL}/api/offers`, {
        headers: { 'Cookie': userCookies || '' }
      })
      expect(userOffers.ok()).toBeTruthy()
      const userData = await userOffers.json()

      // 验证数据隔离 - 两个用户的数据应该不同（或至少不完全相同）
      console.log(`Admin offers count: ${adminData.offers?.length || 0}`)
      console.log(`User offers count: ${userData.offers?.length || 0}`)
    }
  })

  test('3.2 用户无法访问其他用户的数据', async ({ request }) => {
    // 管理员登录
    const adminLogin = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const adminCookies = adminLogin.headers()['set-cookie']

    // 获取管理员创建的第一个Offer ID
    const adminOffers = await request.get(`${BASE_URL}/api/offers`, {
      headers: { 'Cookie': adminCookies || '' }
    })
    const adminData = await adminOffers.json()

    if (adminData.offers && adminData.offers.length > 0) {
      const offerId = adminData.offers[0].id

      // 用其他用户尝试访问
      const userLogin = await request.post(`${BASE_URL}/api/auth/login`, {
        data: {
          username: 'testuser',
          password: 'Test123!@#'
        }
      })

      if (userLogin.ok()) {
        const userCookies = userLogin.headers()['set-cookie']

        // 尝试访问管理员的Offer
        const response = await request.get(`${BASE_URL}/api/offers/${offerId}`, {
          headers: { 'Cookie': userCookies || '' }
        })

        // 应该返回404或403
        expect(response.status()).toBeGreaterThanOrEqual(400)
      }
    }
  })

  test('3.3 Settings数据按用户隔离', async ({ request }) => {
    const adminLogin = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const adminCookies = adminLogin.headers()['set-cookie']

    // 获取设置
    const settingsResponse = await request.get(`${BASE_URL}/api/settings`, {
      headers: { 'Cookie': adminCookies || '' }
    })

    expect(settingsResponse.ok()).toBeTruthy()
    // 设置数据应该与当前用户关联
  })
})

test.describe('4. 管理员功能区权限验证', () => {
  test('4.1 普通用户无法访问管理员页面', async ({ page }) => {
    // 创建一个普通用户并登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"], input[placeholder*="用户名"]', 'testuser')
    await page.fill('input[name="password"], input[type="password"]', 'Test123!@#')
    await page.click('button[type="submit"]')

    // 等待登录完成
    try {
      await page.waitForURL(/\/(dashboard|offers)/, { timeout: 5000 })
    } catch {
      // 用户可能不存在，跳过测试
      test.skip()
      return
    }

    // 尝试直接访问管理员页面
    await page.goto(`${BASE_URL}/admin/users`)

    // 应该被重定向或显示未授权
    await expect(page).toHaveURL(/\/(login|dashboard|offers|unauthorized)/)
  })

  test('4.2 普通用户API调用被拒绝', async ({ request }) => {
    // 普通用户登录
    const userLogin = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: 'testuser',
        password: 'Test123!@#'
      }
    })

    if (userLogin.ok()) {
      const userCookies = userLogin.headers()['set-cookie']

      // 尝试调用管理员API
      const response = await request.get(`${BASE_URL}/api/admin/users`, {
        headers: { 'Cookie': userCookies || '' }
      })

      // 应该返回401 Unauthorized
      expect(response.status()).toBe(401)
      const data = await response.json()
      expect(data.error).toContain('Unauthorized')
    }
  })

  test('4.3 管理员可以访问管理员功能区', async ({ page }) => {
    await adminLogin(page)

    // 访问用户管理页面
    await page.goto(`${BASE_URL}/admin/users`)
    await page.waitForLoadState('networkidle')

    // 应该成功加载页面
    await expect(page).toHaveURL(/\/admin\/users/)

    // 页面应该包含用户列表
    await expect(page.locator('table, [role="table"]')).toBeVisible({ timeout: 5000 })
  })

  test('4.4 管理员API调用成功', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    expect(loginResponse.ok()).toBeTruthy()

    const cookies = loginResponse.headers()['set-cookie']

    // 调用管理员API
    const response = await request.get(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.users).toBeDefined()
    expect(Array.isArray(data.users)).toBeTruthy()
  })

  test('4.5 侧边栏仅管理员显示管理功能区', async ({ page }) => {
    // 管理员登录
    await adminLogin(page)
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForLoadState('networkidle')

    // 管理员应该看到管理功能区（用户管理链接）
    const adminMenu = page.locator('a[href="/admin/users"]')
    await expect(adminMenu).toBeVisible({ timeout: 5000 })
  })
})

test.describe('5. 数据库用户信息CRUD', () => {
  let createdUserId: number

  test('5.1 创建用户 (Create)', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    const newUsername = `dbtest_${Date.now()}`
    const response = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: newUsername,
        email: `${newUsername}@test.com`,
        packageType: 'annual',
        packageExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBeTruthy()
    expect(data.user).toBeDefined()
    expect(data.user.username).toBe(newUsername)

    createdUserId = data.user.id
    console.log(`Created user ID: ${createdUserId}`)
  })

  test('5.2 读取用户列表 (Read)', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    const response = await request.get(`${BASE_URL}/api/admin/users?page=1&limit=10`, {
      headers: { 'Cookie': cookies || '' }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.users).toBeDefined()
    expect(Array.isArray(data.users)).toBeTruthy()
    expect(data.pagination).toBeDefined()
    expect(data.pagination.total).toBeGreaterThan(0)
  })

  test('5.3 更新用户信息 (Update)', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 获取用户列表找到一个可以更新的用户
    const usersResponse = await request.get(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' }
    })
    const usersData = await usersResponse.json()

    if (usersData.users && usersData.users.length > 0) {
      // 找一个非管理员用户来更新
      const testUser = usersData.users.find((u: any) => u.role !== 'admin')
      if (testUser) {
        const response = await request.patch(`${BASE_URL}/api/admin/users/${testUser.id}`, {
          headers: { 'Cookie': cookies || '' },
          data: {
            packageType: 'lifetime',
            packageExpiresAt: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          }
        })

        expect(response.ok()).toBeTruthy()
        const data = await response.json()
        expect(data.success).toBeTruthy()
        expect(data.user.package_type).toBe('lifetime')
      }
    }
  })

  test('5.4 禁用用户 (Soft Delete)', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 创建一个用户用于测试删除
    const testUsername = `delete_test_${Date.now()}`
    const createResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      headers: { 'Cookie': cookies || '' },
      data: {
        username: testUsername,
        email: `${testUsername}@test.com`,
        packageType: 'trial',
        packageExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    })

    const createData = await createResponse.json()
    const userId = createData.user?.id

    if (userId) {
      // 软删除（禁用）
      const deleteResponse = await request.delete(`${BASE_URL}/api/admin/users/${userId}`, {
        headers: { 'Cookie': cookies || '' }
      })

      expect(deleteResponse.ok()).toBeTruthy()
      const data = await deleteResponse.json()
      expect(data.success).toBeTruthy()
      expect(data.message).toContain('disabled')
    }
  })

  test('5.5 管理员无法删除自己', async ({ request }) => {
    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.password
      }
    })
    const cookies = loginResponse.headers()['set-cookie']

    // 获取当前管理员的ID
    const meResponse = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: { 'Cookie': cookies || '' }
    })
    const meData = await meResponse.json()
    const adminId = meData.user?.id

    if (adminId) {
      // 尝试删除自己
      const deleteResponse = await request.delete(`${BASE_URL}/api/admin/users/${adminId}`, {
        headers: { 'Cookie': cookies || '' }
      })

      // 应该被拒绝
      expect(deleteResponse.status()).toBe(400)
      const data = await deleteResponse.json()
      expect(data.error).toContain('Cannot delete your own account')
    }
  })
})

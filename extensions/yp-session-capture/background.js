function normalizeCookieHeader(cookies) {
  const map = new Map()

  for (const cookie of cookies || []) {
    const name = String(cookie?.name || '').trim()
    if (!name || map.has(name)) continue
    map.set(name, String(cookie?.value || ''))
  }

  return Array.from(map.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function collectYeahPromosCookies() {
  const queryList = [
    { url: 'https://yeahpromos.com/' },
    { url: 'https://www.yeahpromos.com/' },
    { domain: 'yeahpromos.com' },
    { domain: 'www.yeahpromos.com' },
  ]

  const allCookies = []
  const seen = new Set()

  for (const query of queryList) {
    let cookies = []
    try {
      cookies = await chrome.cookies.getAll(query)
      console.log('[YP Debug] query:', JSON.stringify(query), '→ cookies:', cookies.length, cookies.map(c => `${c.name}=${c.value.slice(0, 8)}… (domain=${c.domain}, path=${c.path})`))
    } catch (err) {
      console.warn('[YP Debug] query:', JSON.stringify(query), '→ error:', err)
      cookies = []
    }

    for (const cookie of cookies || []) {
      const name = String(cookie?.name || '').trim()
      const value = String(cookie?.value || '')
      const domain = String(cookie?.domain || '').trim().toLowerCase()
      const path = String(cookie?.path || '/')
      if (!name) continue
      const key = `${name}@@${value}@@${domain}@@${path}`
      if (seen.has(key)) continue
      seen.add(key)
      allCookies.push(cookie)
    }
  }

  console.log('[YP Debug] collectYeahPromosCookies → total unique cookies:', allCookies.length)
  return allCookies
}

async function getYeahPromosCookieHeader() {
  const cookies = await collectYeahPromosCookies()
  const header = normalizeCookieHeader(cookies)
  console.log('[YP Debug] getYeahPromosCookieHeader → header length:', header.length, header ? '(has value)' : '(EMPTY)')
  if (!header) {
    throw new Error('未读取到 YeahPromos Cookie，请先在 yeahpromos.com 或 www.yeahpromos.com 完成登录。')
  }
  return header
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs?.[0]
  if (!tab?.id) {
    throw new Error('未检测到当前标签页，请切换到 AutoAds /products 页面。')
  }
  return tab.id
}

async function executeCaptureOnActiveTab(tabId, cookieHeader) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    args: [cookieHeader],
    func: async (capturedCookie) => {
      const ensureJson = async (response) => {
        try {
          return await response.json()
        } catch {
          return {}
        }
      }

      try {
        const probe = await fetch('/api/products/yeahpromos/session/status', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        if (probe.status === 401) {
          return {
            success: false,
            error: '请先在当前 AutoAds 页面完成登录后再执行扩展回传。',
          }
        }
        if (probe.status === 404) {
          return {
            success: false,
            error: '当前页面不是 AutoAds 系统页，请切换到 /products 后重试。',
          }
        }

        const captureResponse = await fetch('/api/products/yeahpromos/session/capture-extension', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cookie: capturedCookie }),
        })
        const captureData = await ensureJson(captureResponse)

        if (!captureResponse.ok || !captureData?.success) {
          return {
            success: false,
            error: captureData?.error || '回传接口调用失败。',
          }
        }

        return {
          success: true,
          session: captureData.session || null,
        }
      } catch (error) {
        return {
          success: false,
          error: error?.message || '扩展回传失败。',
        }
      }
    },
  })

  return result?.[0]?.result || { success: false, error: '扩展执行失败。' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'capture_yp_session') {
    return false
  }

  ;(async () => {
    try {
      const cookieHeader = await getYeahPromosCookieHeader()
      const tabId = await getActiveTabId()
      const captureResult = await executeCaptureOnActiveTab(tabId, cookieHeader)
      sendResponse(captureResult)
    } catch (error) {
      sendResponse({
        success: false,
        error: error?.message || '扩展回传失败。',
      })
    }
  })()

  return true
})

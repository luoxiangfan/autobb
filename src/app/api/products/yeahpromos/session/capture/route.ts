import { NextRequest, NextResponse } from 'next/server'
import {
  consumeYeahPromosCaptureChallenge,
  saveYeahPromosSessionCookie,
  validateYeahPromosCaptureToken,
} from '@/lib/yeahpromos-session'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildHtmlResponse(params: { success: boolean; title: string; message: string }): NextResponse {
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(params.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06); }
    .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: ${params.success ? '#166534' : '#b91c1c'}; }
    .msg { font-size: 14px; line-height: 1.6; color: #334155; }
    .hint { margin-top: 12px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${escapeHtml(params.title)}</div>
    <div class="msg">${escapeHtml(params.message)}</div>
    <div class="hint">窗口将在 1.5 秒后自动关闭。</div>
  </div>
  <script>
    setTimeout(function () { window.close(); }, 1500);
  </script>
</body>
</html>`

  return new NextResponse(body, {
    status: params.success ? 200 : 400,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}

async function parseCapturePayload(request: NextRequest): Promise<{
  captureToken: string
  cookie: string
}> {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    return {
      captureToken: String(body.capture_token || body.captureToken || '').trim(),
      cookie: String(body.cookie || '').trim(),
    }
  }

  const formData = await request.formData()
  return {
    captureToken: String(formData.get('capture_token') || '').trim(),
    cookie: String(formData.get('cookie') || '').trim(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await parseCapturePayload(request)
    if (!payload.captureToken) {
      return buildHtmlResponse({
        success: false,
        title: '回传失败',
        message: '缺少 capture_token，请回到 /products 重新生成。',
      })
    }
    if (!payload.cookie) {
      return buildHtmlResponse({
        success: false,
        title: '回传失败',
        message: '未检测到 Cookie，请先在 YeahPromos 完成登录后再点击书签。',
      })
    }

    const validation = await validateYeahPromosCaptureToken(payload.captureToken)
    if (!validation.valid || !validation.userId) {
      return buildHtmlResponse({
        success: false,
        title: '回传失败',
        message: validation.error || 'capture_token 无效，请重新生成。',
      })
    }

    await saveYeahPromosSessionCookie({
      userId: validation.userId,
      rawCookie: payload.cookie,
    })
    await consumeYeahPromosCaptureChallenge(validation.userId)

    return buildHtmlResponse({
      success: true,
      title: '回传成功',
      message: 'YP 登录态已保存，回到商品管理页即可执行 YP 手动同步。',
    })
  } catch (error: any) {
    return buildHtmlResponse({
      success: false,
      title: '回传失败',
      message: error?.message || '保存登录态失败，请稍后重试。',
    })
  }
}

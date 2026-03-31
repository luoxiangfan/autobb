import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'

function parsePossiblyNestedJson(value: unknown, maxDepth = 2): unknown {
  let current = value
  for (let i = 0; i < maxDepth; i++) {
    if (typeof current !== 'string') break
    const trimmed = current.trim()
    if (!trimmed) return undefined
    try {
      current = JSON.parse(trimmed)
    } catch {
      return current
    }
  }
  return current
}

function normalizeArrayField(value: unknown): any[] | undefined {
  const parsed = parsePossiblyNestedJson(value)
  return Array.isArray(parsed) ? parsed : undefined
}

function normalizeObjectField(value: unknown): Record<string, any> | undefined {
  const parsed = parsePossiblyNestedJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed as Record<string, any>
}

/**
 * GET /api/ad-creatives/:id
 * 获取单个广告创意详情
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()
    const creative = await db.queryOne(
      `
      SELECT
        id, offer_id, user_id,
        headlines, descriptions, keywords, keywords_with_volume, negative_keywords,
        callouts, sitelinks, final_url, final_url_suffix,
        score, score_breakdown, ad_strength, launch_score,
        theme, ai_model, generation_round,
        ad_group_id, ad_id, creation_status, creation_error, last_sync_at,
        created_at, updated_at
      FROM ad_creatives
      WHERE id = ? AND user_id = ?
    `,
      [parseInt(id, 10), parseInt(userId, 10)]
    )

    if (!creative) {
      return NextResponse.json(
        {
          error: '广告创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      creative,
    })
  } catch (error: any) {
    console.error('获取广告创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告创意失败',
      },
      { status: 500 }
    )
  }
}

const updateCreativeSchema = z.object({
  headlines: z.array(z.string()).min(3).max(15).optional(),
  descriptions: z.array(z.string()).min(2).max(4).optional(),
  keywords: z.array(z.string()).optional(),
  keywords_with_volume: z.union([z.string(), z.array(z.any())]).optional(),
  negative_keywords: z.array(z.string()).optional(),
  callouts: z.array(z.string()).optional(),
  sitelinks: z
    .array(
      z.object({
        text: z.string(),
        url: z.string().url(),
        description: z.string().optional(),
      })
    )
    .optional(),
  final_url: z.string().url().optional(),
  final_url_suffix: z.string().optional(),
  score: z.number().min(0).max(100).optional(),
  score_breakdown: z.union([z.string(), z.record(z.any())]).optional(),
  ad_strength: z.union([z.string(), z.record(z.any())]).optional(),
  theme: z.string().optional(),
})

/**
 * PUT /api/ad-creatives/:id
 * 更新广告创意
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()

    // 验证输入
    const validationResult = updateCreativeSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.errors[0].message,
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const data = validationResult.data
    const normalizedKeywordsWithVolume = normalizeArrayField(data.keywords_with_volume)
    const normalizedScoreBreakdown = normalizeObjectField(data.score_breakdown)
    const normalizedAdStrength = normalizeObjectField(data.ad_strength)

    // 验证广告创意是否存在且属于该用户
    const db = await getDatabase()
    const creative = await db.queryOne(
      'SELECT id, creation_status FROM ad_creatives WHERE id = ? AND user_id = ?',
      [parseInt(id, 10), parseInt(userId, 10)]
    )

    if (!creative) {
      return NextResponse.json(
        { error: '广告创意不存在或无权访问' },
        { status: 404 }
      )
    }

    // 检查是否已同步到Google Ads
    if ((creative as any).creation_status === 'synced') {
      return NextResponse.json(
        {
          error: '广告创意已同步到Google Ads，无法修改。请创建新的创意或在Google Ads后台修改。',
        },
        { status: 409 }
      )
    }

    // 构建更新SQL
    const updates: string[] = []
    const sqlParams: any[] = []

    if (data.headlines !== undefined) {
      updates.push('headlines = ?')
      sqlParams.push(JSON.stringify(data.headlines))
    }
    if (data.descriptions !== undefined) {
      updates.push('descriptions = ?')
      sqlParams.push(JSON.stringify(data.descriptions))
    }
    if (data.keywords !== undefined) {
      updates.push('keywords = ?')
      sqlParams.push(JSON.stringify(data.keywords))
    }
    if (data.keywords_with_volume !== undefined) {
      updates.push('keywords_with_volume = ?')
      sqlParams.push(normalizedKeywordsWithVolume ? JSON.stringify(normalizedKeywordsWithVolume) : null)
    }
    if (data.negative_keywords !== undefined) {
      updates.push('negative_keywords = ?')
      sqlParams.push(JSON.stringify(data.negative_keywords))
    }
    if (data.callouts !== undefined) {
      updates.push('callouts = ?')
      sqlParams.push(JSON.stringify(data.callouts))
    }
    if (data.sitelinks !== undefined) {
      updates.push('sitelinks = ?')
      sqlParams.push(JSON.stringify(data.sitelinks))
    }
    if (data.final_url !== undefined) {
      updates.push('final_url = ?')
      sqlParams.push(data.final_url)
    }
    if (data.final_url_suffix !== undefined) {
      updates.push('final_url_suffix = ?')
      sqlParams.push(data.final_url_suffix)
    }
    if (data.score !== undefined) {
      updates.push('score = ?')
      sqlParams.push(data.score)
    }
    if (data.score_breakdown !== undefined) {
      updates.push('score_breakdown = ?')
      sqlParams.push(normalizedScoreBreakdown ? JSON.stringify(normalizedScoreBreakdown) : null)
    }
    if (data.ad_strength !== undefined) {
      updates.push('ad_strength = ?')
      sqlParams.push(normalizedAdStrength ? JSON.stringify(normalizedAdStrength) : null)
    }
    if (data.theme !== undefined) {
      updates.push('theme = ?')
      sqlParams.push(data.theme)
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400 }
      )
    }

    updates.push('updated_at = ?')
    sqlParams.push(new Date().toISOString())
    sqlParams.push(parseInt(id, 10))

    // 执行更新
    await db.exec(
      `UPDATE ad_creatives SET ${updates.join(', ')} WHERE id = ?`,
      sqlParams
    )

    // 查询更新后的记录
    const updatedCreative = await db.queryOne(
      `
      SELECT
        id, offer_id, user_id,
        headlines, descriptions, keywords, keywords_with_volume, negative_keywords,
        callouts, sitelinks, final_url, final_url_suffix,
        score, score_breakdown, ad_strength, launch_score,
        theme, ai_model, generation_round,
        ad_group_id, ad_id, creation_status, creation_error, last_sync_at,
        created_at, updated_at
      FROM ad_creatives
      WHERE id = ?
    `,
      [parseInt(id, 10)]
    )

    return NextResponse.json({
      success: true,
      creative: updatedCreative,
    })
  } catch (error: any) {
    console.error('更新广告创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新广告创意失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/ad-creatives/:id
 * 删除广告创意
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()

    // 验证广告创意是否存在且属于该用户
    const creative = await db.queryOne(
      'SELECT id, creation_status FROM ad_creatives WHERE id = ? AND user_id = ?',
      [parseInt(id, 10), parseInt(userId, 10)]
    )

    if (!creative) {
      return NextResponse.json(
        { error: '广告创意不存在或无权访问' },
        { status: 404 }
      )
    }

    // 检查是否已同步到Google Ads
    if ((creative as any).creation_status === 'synced') {
      return NextResponse.json(
        {
          error:
            '广告创意已同步到Google Ads，无法删除。请在Google Ads后台暂停或删除该广告。',
        },
        { status: 409 }
      )
    }

    // 检查是否有关联的Campaign
    const campaigns = await db.query(
      'SELECT id FROM campaigns WHERE ad_creative_id = ? AND user_id = ?',
      [parseInt(id, 10), parseInt(userId, 10)]
    )

    if ((campaigns as any[]).length > 0) {
      return NextResponse.json(
        {
          error: `无法删除广告创意：该创意关联了${(campaigns as any[]).length}个Campaign`,
        },
        { status: 409 }
      )
    }

    // 删除广告创意
    await db.exec('DELETE FROM ad_creatives WHERE id = ?', [parseInt(id, 10)])

    return NextResponse.json({
      success: true,
      message: '广告创意删除成功',
    })
  } catch (error: any) {
    console.error('删除广告创意失败:', error)

    // 区分不同类型的错误
    const errorMessage = error.message || '删除广告创意失败'

    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 }
    )
  }
}

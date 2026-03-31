import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'

/**
 * GET /api/creatives/:id/versions
 * 获取Creative的所有版本历史
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const creativeId = parseInt(params.id, 10)
    if (isNaN(creativeId)) {
      return NextResponse.json({ error: '无效的Creative ID' }, { status: 400 })
    }

    const db = await getDatabase()
    const userId = authResult.user.userId

    // 验证Creative所有权
    const creative = await db.queryOne<{ user_id: number }>(
      'SELECT user_id FROM ad_creatives WHERE id = ?',
      [creativeId]
    )

    if (!creative) {
      return NextResponse.json({ error: 'Creative不存在' }, { status: 404 })
    }

    if (creative.user_id !== userId) {
      return NextResponse.json({ error: '无权访问此Creative' }, { status: 403 })
    }

    // 获取所有版本（按版本号降序）
    const versions = await db.query<{
      id: number
      creativeId: number
      versionNumber: number
      headlines: string
      descriptions: string
      finalUrl: string
      path1: string | null
      path2: string | null
      qualityScore: number | null
      qualityDetails: string | null
      createdBy: string
      creationMethod: string
      changeSummary: string | null
      createdAt: string
    }>(
      `
      SELECT
        id,
        creative_id as creativeId,
        version_number as versionNumber,
        headlines,
        descriptions,
        final_url as finalUrl,
        path_1 as path1,
        path_2 as path2,
        quality_score as qualityScore,
        quality_details as qualityDetails,
        created_by as createdBy,
        creation_method as creationMethod,
        change_summary as changeSummary,
        created_at as createdAt
      FROM creative_versions
      WHERE creative_id = ?
      ORDER BY version_number DESC
      `,
      [creativeId]
    )

    // 解析JSON字段
    const parsedVersions = versions.map((v) => ({
      ...v,
      headlines: JSON.parse(v.headlines),
      descriptions: JSON.parse(v.descriptions),
      qualityDetails: v.qualityDetails ? JSON.parse(v.qualityDetails) : null,
    }))

    return NextResponse.json({
      success: true,
      data: {
        creativeId,
        versions: parsedVersions,
        total: versions.length,
      },
    })
  } catch (error) {
    console.error('获取版本历史失败:', error)
    return NextResponse.json(
      {
        error: '获取版本历史失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/creatives/:id/versions
 * 创建新版本（保存编辑后的内容）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const creativeId = parseInt(params.id, 10)
    if (isNaN(creativeId)) {
      return NextResponse.json({ error: '无效的Creative ID' }, { status: 400 })
    }

    const body = await request.json()
    const {
      headlines,
      descriptions,
      finalUrl,
      path1,
      path2,
      qualityScore,
      qualityDetails,
      changeSummary,
      creationMethod = 'inline_edit',
    } = body

    // 验证必填字段
    if (!headlines || !descriptions || !finalUrl) {
      return NextResponse.json(
        { error: 'headlines, descriptions, finalUrl 为必填项' },
        { status: 400 }
      )
    }

    // 验证headlines和descriptions格式
    if (!Array.isArray(headlines) || !Array.isArray(descriptions)) {
      return NextResponse.json(
        { error: 'headlines和descriptions必须是数组' },
        { status: 400 }
      )
    }

    // 验证headlines数量（3-15个）
    if (headlines.length < 3 || headlines.length > 15) {
      return NextResponse.json(
        { error: 'Headlines数量必须在3-15个之间' },
        { status: 400 }
      )
    }

    // 验证descriptions数量（2-4个）
    if (descriptions.length < 2 || descriptions.length > 4) {
      return NextResponse.json(
        { error: 'Descriptions数量必须在2-4个之间' },
        { status: 400 }
      )
    }

    // 验证headlines长度（每个最多30字符）
    for (const headline of headlines) {
      if (headline.length > 30) {
        return NextResponse.json(
          { error: `Headline "${headline}" 超过30字符限制` },
          { status: 400 }
        )
      }
    }

    // 验证descriptions长度（每个最多90字符）
    for (const description of descriptions) {
      if (description.length > 90) {
        return NextResponse.json(
          { error: `Description "${description}" 超过90字符限制` },
          { status: 400 }
        )
      }
    }

    const db = await getDatabase()
    const userId = authResult.user.userId

    // 验证Creative所有权
    const creative = await db.queryOne<{ user_id: number }>(
      'SELECT user_id FROM ad_creatives WHERE id = ?',
      [creativeId]
    )

    if (!creative) {
      return NextResponse.json({ error: 'Creative不存在' }, { status: 404 })
    }

    if (creative.user_id !== userId) {
      return NextResponse.json({ error: '无权修改此Creative' }, { status: 403 })
    }

    // 获取当前最大版本号
    const maxVersionRow = await db.queryOne<{ max_version: number | null }>(
      'SELECT MAX(version_number) as max_version FROM creative_versions WHERE creative_id = ?',
      [creativeId]
    )

    const newVersionNumber = (maxVersionRow?.max_version || 0) + 1

    // 插入新版本
    const result = await db.exec(
      `
      INSERT INTO creative_versions (
        creative_id,
        version_number,
        headlines,
        descriptions,
        final_url,
        path_1,
        path_2,
        quality_score,
        quality_details,
        created_by,
        creation_method,
        change_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        creativeId,
        newVersionNumber,
        JSON.stringify(headlines),
        JSON.stringify(descriptions),
        finalUrl,
        path1 || null,
        path2 || null,
        qualityScore || null,
        qualityDetails ? JSON.stringify(qualityDetails) : null,
        userId.toString(),
        creationMethod,
        changeSummary || null
      ]
    )

    const versionId = getInsertedId(result, db.type)

    // 获取新创建的版本
    const newVersion = await db.queryOne<any>(
      `SELECT
        id,
        creative_id as creativeId,
        version_number as versionNumber,
        headlines,
        descriptions,
        final_url as finalUrl,
        path_1 as path1,
        path_2 as path2,
        quality_score as qualityScore,
        quality_details as qualityDetails,
        created_by as createdBy,
        creation_method as creationMethod,
        change_summary as changeSummary,
        created_at as createdAt
      FROM creative_versions WHERE id = ?`,
      [versionId]
    )

    return NextResponse.json({
      success: true,
      data: {
        version: {
          ...newVersion,
          headlines: JSON.parse(newVersion.headlines),
          descriptions: JSON.parse(newVersion.descriptions),
          qualityDetails: newVersion.qualityDetails
            ? JSON.parse(newVersion.qualityDetails)
            : null,
        },
      },
      message: `成功创建版本 ${newVersionNumber}`,
    })
  } catch (error) {
    console.error('创建版本失败:', error)
    return NextResponse.json(
      {
        error: '创建版本失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

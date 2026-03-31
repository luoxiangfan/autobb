import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'

/**
 * POST /api/creatives/:id/versions/:versionNumber/rollback
 * 回滚到指定版本
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; versionNumber: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const creativeId = parseInt(params.id, 10)
    const versionNumber = parseInt(params.versionNumber, 10)

    if (isNaN(creativeId) || isNaN(versionNumber)) {
      return NextResponse.json(
        { error: '无效的Creative ID或版本号' },
        { status: 400 }
      )
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

    // 获取目标版本
    const targetVersion = await db.queryOne<{
      headlines: string
      descriptions: string
      final_url: string
      path_1: string | null
      path_2: string | null
      quality_score: number | null
      quality_details: string | null
    }>(`
      SELECT
        headlines,
        descriptions,
        final_url,
        path_1,
        path_2,
        quality_score,
        quality_details
      FROM creative_versions
      WHERE creative_id = ? AND version_number = ?
    `, [creativeId, versionNumber])

    if (!targetVersion) {
      return NextResponse.json({ error: '目标版本不存在' }, { status: 404 })
    }

    // 解析JSON
    const headlines = JSON.parse(targetVersion.headlines)
    const descriptions = JSON.parse(targetVersion.descriptions)

    // 获取当前最大版本号
    const maxVersionRow = await db.queryOne<{ max_version: number | null }>(
      'SELECT MAX(version_number) as max_version FROM creative_versions WHERE creative_id = ?',
      [creativeId]
    )

    const newVersionNumber = (maxVersionRow?.max_version || 0) + 1

    // 创建新版本（回滚版本）
    const result = await db.exec(`
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
    `, [
      creativeId,
      newVersionNumber,
      JSON.stringify(headlines),
      JSON.stringify(descriptions),
      targetVersion.final_url,
      targetVersion.path_1,
      targetVersion.path_2,
      targetVersion.quality_score,
      targetVersion.quality_details,
      userId.toString(),
      'rollback',
      `回滚到版本 ${versionNumber}`
    ])

    const versionId = getInsertedId(result, db.type)

    // 同时更新ad_creatives表的当前内容
    await db.exec(`
      UPDATE ad_creatives
      SET
        headlines = ?,
        descriptions = ?,
        final_url = ?,
        final_url_suffix = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      JSON.stringify(headlines),
      JSON.stringify(descriptions),
      targetVersion.final_url,
      targetVersion.path_1 && targetVersion.path_2
        ? `${targetVersion.path_1}/${targetVersion.path_2}`
        : (targetVersion.path_1 || null),
      creativeId
    ])

    // 获取新创建的版本
    const newVersion = await db.queryOne<any>(
      'SELECT * FROM creative_versions WHERE id = ?',
      [versionId]
    )

    return NextResponse.json({
      success: true,
      data: {
        version: {
          id: newVersion.id,
          creativeId: newVersion.creative_id,
          versionNumber: newVersion.version_number,
          headlines: JSON.parse(newVersion.headlines),
          descriptions: JSON.parse(newVersion.descriptions),
          finalUrl: newVersion.final_url,
          path1: newVersion.path_1,
          path2: newVersion.path_2,
          qualityScore: newVersion.quality_score,
          qualityDetails: newVersion.quality_details
            ? JSON.parse(newVersion.quality_details)
            : null,
          createdBy: newVersion.created_by,
          creationMethod: newVersion.creation_method,
          changeSummary: newVersion.change_summary,
          createdAt: newVersion.created_at,
        },
      },
      message: `成功回滚到版本 ${versionNumber}（新版本号: ${newVersionNumber}）`,
    })
  } catch (error) {
    console.error('回滚版本失败:', error)
    return NextResponse.json(
      {
        error: '回滚版本失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/prompts/[promptId]
 * 获取指定Prompt的完整信息和所有版本历史
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const db = getDatabase()

    // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
    const isActiveValue = db.type === 'postgres' ? true : 1

    // 获取当前激活版本
    const activeVersion = await db.queryOne<any>(
      `SELECT
        pv.*,
        u.username as created_by_name
       FROM prompt_versions pv
       LEFT JOIN users u ON pv.created_by = u.id
       WHERE pv.prompt_id = ? AND pv.is_active = ?`,
      [promptId, isActiveValue]
    )

    if (!activeVersion) {
      return NextResponse.json(
        { success: false, error: 'Prompt不存在' },
        { status: 404 }
      )
    }

    // 获取所有版本历史
    const versions = await db.query<any>(
      `SELECT
        pv.id,
        pv.version,
        pv.prompt_content,
        pv.language,
        pv.created_at,
        pv.is_active,
        pv.change_notes,
        u.username as created_by_name
       FROM prompt_versions pv
       LEFT JOIN users u ON pv.created_by = u.id
       WHERE pv.prompt_id = ?
       ORDER BY pv.created_at DESC`,
      [promptId]
    )

    // Usage stats feature offline (prompt_usage_stats table removed)
    const usageStats: any[] = []

    return NextResponse.json({
      success: true,
      data: {
        promptId: activeVersion.prompt_id,
        category: activeVersion.category,
        name: activeVersion.name,
        description: activeVersion.description,
        filePath: activeVersion.file_path,
        functionName: activeVersion.function_name,
        currentVersion: {
          version: activeVersion.version,
          promptContent: activeVersion.prompt_content,
          language: activeVersion.language,
          createdBy: activeVersion.created_by_name,
          createdAt: activeVersion.created_at,
          changeNotes: activeVersion.change_notes,
        },
        versions: versions.map(v => ({
          id: v.id,
          version: v.version,
          promptContent: v.prompt_content,
          language: v.language,
          createdBy: v.created_by_name,
          createdAt: v.created_at,
          isActive: v.is_active === 1,
          changeNotes: v.change_notes,
          totalCalls: 0,  // Feature offline: prompt_usage_stats table removed
          totalCost: 0,   // Feature offline: prompt_usage_stats table removed
        })),
        usageStats: [],  // Feature offline: prompt_usage_stats table removed
      }
    })
  } catch (error: any) {
    console.error('获取Prompt详情失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/prompts/[promptId]
 * 激活指定版本
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const body = await request.json()
    const { version } = body

    if (!version) {
      return NextResponse.json(
        { success: false, error: '缺少版本号' },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 检查版本是否存在
    const versionExists = await db.queryOne<any>(
      'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
      [promptId, version]
    )

    if (!versionExists) {
      return NextResponse.json(
        { success: false, error: '版本不存在' },
        { status: 404 }
      )
    }

    // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
    const isActiveFalse = db.type === 'postgres' ? false : 0
    const isActiveTrue = db.type === 'postgres' ? true : 1

    // 取消其他版本的激活状态
    await db.exec(
      'UPDATE prompt_versions SET is_active = ? WHERE prompt_id = ?',
      [isActiveFalse, promptId]
    )

    // 激活指定版本
    await db.exec(
      'UPDATE prompt_versions SET is_active = ? WHERE prompt_id = ? AND version = ?',
      [isActiveTrue, promptId, version]
    )

    return NextResponse.json({
      success: true,
      message: `版本 ${version} 已激活`
    })
  } catch (error: any) {
    console.error('激活版本失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'

/**
 * GET /api/admin/prompts
 * 获取所有Prompt配置及其版本信息
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDatabase()

    // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
    const isActiveValue = db.type === 'postgres' ? true : 1

    // 获取所有激活的Prompt版本
    const activePrompts = await db.query<any>(`
      SELECT
        pv.*,
        u.username as created_by_name,
        (
          SELECT COUNT(*)
          FROM prompt_versions pv2
          WHERE pv2.prompt_id = pv.prompt_id
        ) as version_count
      FROM prompt_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.is_active = ?
      ORDER BY pv.category, pv.name
    `, [isActiveValue])

    // 按分类分组
    const promptsByCategory: Record<string, any[]> = {}
    const categories = new Set<string>()

    for (const prompt of activePrompts) {
      categories.add(prompt.category)
      if (!promptsByCategory[prompt.category]) {
        promptsByCategory[prompt.category] = []
      }

      // Convert Buffer to string if needed
      const promptContent = typeof prompt.prompt_content === 'string'
        ? prompt.prompt_content
        : prompt.prompt_content?.toString('utf-8') || ''

      promptsByCategory[prompt.category].push({
        id: prompt.id,
        promptId: prompt.prompt_id,
        version: prompt.version,
        category: prompt.category,
        name: prompt.name,
        description: prompt.description,
        filePath: prompt.file_path,
        functionName: prompt.function_name,
        promptPreview: promptContent.substring(0, 200) + '...',
        language: prompt.language,
        createdBy: prompt.created_by_name,
        createdAt: prompt.created_at,
        versionCount: prompt.version_count || 0,
        totalCalls: 0,  // Feature offline: prompt_usage_stats table removed
        totalCost: 0,   // Feature offline: prompt_usage_stats table removed
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        prompts: activePrompts.map(p => {
          // Convert Buffer to string if needed
          const promptContent = typeof p.prompt_content === 'string'
            ? p.prompt_content
            : p.prompt_content?.toString('utf-8') || ''

          return {
            id: p.id,
            promptId: p.prompt_id,
            version: p.version,
            category: p.category,
            name: p.name,
            description: p.description,
            filePath: p.file_path,
            functionName: p.function_name,
            promptPreview: promptContent.substring(0, 200) + '...',
            language: p.language,
            createdBy: p.created_by_name,
            createdAt: p.created_at,
            versionCount: p.version_count || 0,
            totalCalls: 0,  // Feature offline: prompt_usage_stats table removed
            totalCost: 0,   // Feature offline: prompt_usage_stats table removed
          }
        }),
        promptsByCategory,
        categories: Array.from(categories),
        totalPrompts: activePrompts.length,
      }
    })
  } catch (error: any) {
    console.error('获取Prompt列表失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/prompts
 * 创建新的Prompt版本
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      promptId,
      version,
      category,
      name,
      description,
      filePath,
      functionName,
      promptContent,
      language = 'English',
      changeNotes,
      userId
    } = body

    // 验证必需字段
    if (!promptId || !version || !category || !name || !filePath || !functionName || !promptContent) {
      return NextResponse.json(
        { success: false, error: '缺少必需字段' },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 检查版本是否已存在
    const existing = await db.queryOne<any>(
      'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
      [promptId, version]
    )

    if (existing) {
      return NextResponse.json(
        { success: false, error: '该版本已存在' },
        { status: 409 }
      )
    }

    // 如果是第一个版本，或者请求激活此版本，则取消其他版本的激活状态
    const isActive = body.isActive !== undefined ? body.isActive : true

    // 🔧 PostgreSQL兼容性：布尔字段兼容性处理
    const isActiveFalse = db.type === 'postgres' ? false : 0

    if (isActive) {
      await db.exec(
        'UPDATE prompt_versions SET is_active = ? WHERE prompt_id = ?',
        [isActiveFalse, promptId]
      )
    }

    // 插入新版本
    const result = await db.exec(
      `INSERT INTO prompt_versions
       (prompt_id, version, category, name, description, file_path, function_name,
        prompt_content, language, created_by, is_active, change_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        promptId,
        version,
        category,
        name,
        description,
        filePath,
        functionName,
        promptContent,
        language,
        userId,
        isActive ? 1 : 0,
        changeNotes
      ]
    )

    const versionId = getInsertedId(result, db.type)

    return NextResponse.json({
      success: true,
      data: {
        id: versionId,
        promptId,
        version,
        message: '新版本创建成功'
      }
    })
  } catch (error: any) {
    console.error('创建Prompt版本失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/prompts/[promptId]
 * 获取指定 Prompt 的完整信息和所有版本历史
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const db = getDatabase()

    // 🔧 PostgreSQL 兼容性：布尔字段兼容性处理
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
        { success: false, error: 'Prompt 不存在' },
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
    console.error('获取 Prompt 详情失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/prompts/[promptId]
 * 支持两种操作：
 * 1. 激活指定版本（当只传入 version 字段时）
 * 2. 编辑并创建新版本（当传入 promptContent 字段时）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const body = await request.json()
    const db = getDatabase()

    // 🔧 PostgreSQL 兼容性：布尔字段兼容性处理
    const isActiveFalse = db.type === 'postgres' ? false : 0
    const isActiveTrue = db.type === 'postgres' ? true : 1

    // 判断是激活版本还是编辑创建新版本
    const isEditOperation = body.promptContent !== undefined

    if (isEditOperation) {
      // ============ 编辑并创建新版本 ============
      const {
        version,           // 可选：自定义版本号（如 v5.0），不传则自动递增
        promptContent,     // 编辑后的内容
        changeNotes,       // 变更说明
        category,          // 可选：修改分类
        name,              // 可选：修改名称
        description,       // 可选：修改描述
        isActive = true,   // 是否自动激活新版本
        userId             // 用户 ID
      } = body

      // 验证必需字段
      if (!promptContent) {
        return NextResponse.json(
          { success: false, error: '缺少必需字段：promptContent' },
          { status: 400 }
        )
      }

      // 1. 获取当前版本信息作为基础
      const currentVersion = await db.queryOne<any>(
        'SELECT * FROM prompt_versions WHERE prompt_id = ? AND is_active = ?',
        [promptId, isActiveTrue]
      )

      if (!currentVersion) {
        return NextResponse.json(
          { success: false, error: 'Prompt 不存在' },
          { status: 404 }
        )
      }

      // 2. 获取所有版本，用于计算下一个版本号
      const allVersions = await db.query<any>(
        'SELECT version FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC',
        [promptId]
      )

      // 3. 计算新版本号
      let newVersion: string
      if (version && version.trim()) {
        // 用户自定义版本号
        newVersion = version.trim()
        
        // 验证自定义版本号是否已存在
        const existing = await db.queryOne<any>(
          'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
          [promptId, newVersion]
        )

        if (existing) {
          return NextResponse.json(
            { success: false, error: `版本 ${newVersion} 已存在，请使用其他版本号` },
            { status: 409 }
          )
        }
      } else {
        // 自动递增版本号
        newVersion = calculateNextVersion(currentVersion.version, allVersions.map((v: any) => v.version))
      }

      // 4. 如果激活新版本，先取消其他版本的激活状态
      if (isActive) {
        await db.exec(
          'UPDATE prompt_versions SET is_active = ? WHERE prompt_id = ?',
          [isActiveFalse, promptId]
        )
      }

      // 5. 插入新版本（其他版本自动成为历史版本）
      // 自动更新 name 字段中的版本号（如 "广告创意生成 v4.0" → "广告创意生成 v4.1"）
      const newName = name || currentVersion.name.replace(/v\d+(\.\d+)*$/i, newVersion)
      const result = await db.exec(
        `INSERT INTO prompt_versions
         (prompt_id, version, category, name, description, file_path, function_name,
          prompt_content, language, created_by, is_active, change_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          promptId,
          newVersion,
          category || currentVersion.category,
          newName,
          description || currentVersion.description,
          currentVersion.file_path,
          currentVersion.function_name,
          promptContent,
          currentVersion.language,
          userId || null,
          isActive ? 1 : 0,
          changeNotes || ''
        ]
      )

      const versionId = db.type === 'postgres' 
        ? (result as any).rows?.[0]?.id 
        : (result as any).lastInsertRowid

      return NextResponse.json({
        success: true,
        data: {
          message: '新版本创建成功',
          version: newVersion,
          previousVersion: currentVersion.version,
          isActive,
          versionId
        }
      })
    } else {
      // ============ 激活指定版本（原有逻辑） ============
      const { version } = body

      if (!version) {
        return NextResponse.json(
          { success: false, error: '缺少版本号' },
          { status: 400 }
        )
      }

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
    }
  } catch (error: any) {
    console.error('操作失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * 计算下一个版本号
 * 策略：
 * 1. 解析当前版本号的数字部分（如 v4.8 → 4.8）
 * 2. 递增最后一位（如 4.8 → 4.9）
 * 3. 如果生成的版本号已存在，继续递增直到找到未使用的版本
 */
function calculateNextVersion(currentVersion: string, existingVersions: string[]): string {
  // 解析当前版本号
  const versionMatch = currentVersion.match(/^v?(\d+(?:\.\d+)*)/i)
  if (!versionMatch) {
    // 无法解析，使用默认 v1.0
    return 'v1.0'
  }

  const parts = versionMatch[1].split('.').map(Number)
  
  // 尝试递增，直到找到未使用的版本号
  let attempts = 0
  const maxAttempts = 100  // 防止无限循环
  
  while (attempts < maxAttempts) {
    // 递增最后一位
    parts[parts.length - 1] += 1
    
    // 处理进位（如 4.9 → 5.0）
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] >= 10 && i > 0) {
        parts[i] = 0
        parts[i - 1] += 1
      }
    }
    
    // 生成新版本号字符串
    const newVersion = `v${parts.join('.')}`
    
    // 检查是否已存在
    const exists = existingVersions.some(v => {
      const match = v.match(/^v?(\d+(?:\.\d+)*)/i)
      return match && match[1] === parts.join('.')
    })
    
    if (!exists) {
      return newVersion
    }
    
    attempts++
  }
  
  // 极端情况：尝试了 100 次都没找到，使用时间戳
  return `v${Date.now()}`
}

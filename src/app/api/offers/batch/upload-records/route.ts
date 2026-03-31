/**
 * GET /api/offers/batch/upload-records
 *
 * 获取当前用户的上传文件记录列表
 *
 * 功能：
 * 1. 验证用户身份
 * 2. 查询用户的上传记录（按上传时间降序）
 * 3. 返回文件名、上传时间、有效数量、处理数量、成功率等信息
 *
 * 查询参数：
 * - page: 页码（默认1）
 * - limit: 每页数量（默认10，最大50）
 * - status: 状态筛选（可选：pending, processing, completed, failed, partial）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface UploadRecord {
  id: string
  batch_id: string
  file_name: string
  file_size: number | null
  uploaded_at: string
  valid_count: number
  processed_count: number
  skipped_count: number
  failed_count: number
  success_rate: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial'
  completed_at: string | null
}

export async function GET(req: NextRequest) {
  const db = getDatabase()

  try {
    // 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 获取查询参数
    const searchParams = req.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10')))
    const statusFilter = searchParams.get('status') as string | null
    const offset = (page - 1) * limit

    // 构建查询条件
    let whereClause = 'user_id = ?'
    const queryParams: any[] = [userIdNum]

    if (statusFilter && ['pending', 'processing', 'completed', 'failed', 'partial'].includes(statusFilter)) {
      whereClause += ' AND status = ?'
      queryParams.push(statusFilter)
    }

    // 查询上传记录（分页）
    const records = await db.query<UploadRecord>(`
      SELECT
        id,
        batch_id,
        file_name,
        file_size,
        uploaded_at,
        valid_count,
        processed_count,
        skipped_count,
        failed_count,
        success_rate,
        status,
        completed_at
      FROM upload_records
      WHERE ${whereClause}
      ORDER BY uploaded_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset])

    // 确保 success_rate 是数字类型（处理 SQLite/PostgreSQL 差异）
    // 同时转换为 camelCase
    const normalizedRecords = records.map(record => ({
      id: record.id,
      batchId: record.batch_id,
      fileName: record.file_name,
      fileSize: record.file_size,
      uploadedAt: record.uploaded_at,
      validCount: record.valid_count,
      processedCount: record.processed_count,
      skippedCount: record.skipped_count,
      failedCount: record.failed_count,
      successRate: Number(record.success_rate) || 0,
      status: record.status,
      completedAt: record.completed_at,
    }))

    // 查询总数
    const countResult = await db.query<{ total: number }>(`
      SELECT COUNT(*) as total
      FROM upload_records
      WHERE ${whereClause}
    `, queryParams)

    const total = countResult[0]?.total || 0
    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      success: true,
      data: normalizedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages
      }
    })

  } catch (error: any) {
    console.error('❌ 获取上传记录失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '获取上传记录失败'
      },
      { status: 500 }
    )
  }
}

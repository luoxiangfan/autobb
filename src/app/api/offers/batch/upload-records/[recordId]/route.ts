/**
 * GET /api/offers/batch/upload-records/[recordId]
 *
 * 获取特定上传记录的详细信息
 *
 * 功能：
 * 1. 验证用户身份和记录所有权
 * 2. 返回上传记录详细信息
 * 3. 包括关联的batch_tasks信息
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'

export const dynamic = 'force-dynamic'

interface UploadRecordDetail {
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
  metadata: unknown
  batch_status: string
  batch_total_count: number
  batch_completed_count: number
  batch_failed_count: number
}

export async function GET(
  req: NextRequest,
  { params }: { params: { recordId: string } }
) {
  const db = getDatabase()
  const { recordId } = params

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

    // 查询上传记录详情（联表查询batch_tasks）
    const records = await db.query<UploadRecordDetail>(`
      SELECT
        ur.id,
        ur.batch_id,
        ur.file_name,
        ur.file_size,
        ur.uploaded_at,
        ur.valid_count,
        ur.processed_count,
        ur.skipped_count,
        ur.failed_count,
        ur.success_rate,
        ur.status,
        ur.completed_at,
        ur.metadata,
        bt.status as batch_status,
        bt.total_count as batch_total_count,
        bt.completed_count as batch_completed_count,
        bt.failed_count as batch_failed_count
      FROM upload_records ur
      INNER JOIN batch_tasks bt ON ur.batch_id = bt.id
      WHERE ur.id = ? AND ur.user_id = ?
    `, [recordId, userIdNum])

    if (!records || records.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '上传记录不存在' },
        { status: 404 }
      )
    }

    const record = records[0]

    const metadataObj = parseJsonField(record.metadata, null)

    return NextResponse.json({
      success: true,
      data: {
        ...record,
        metadata: metadataObj
      }
    })

  } catch (error: any) {
    console.error('❌ 获取上传记录详情失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '获取上传记录详情失败'
      },
      { status: 500 }
    )
  }
}

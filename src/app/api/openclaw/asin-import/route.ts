import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { importAsinFile } from '@/lib/openclaw/asin-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE_MB = 20
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

function parseJsonValue(value: unknown): Record<string, any> | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, any>
  } catch {
    return undefined
  }
}

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: '请上传ASIN文件' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `文件过大，最大支持 ${MAX_FILE_SIZE_MB}MB` }, { status: 400 })
  }

  const source = String(formData.get('source') || 'manual').trim() || 'manual'
  const defaultCountry = String(formData.get('defaultCountry') || '').trim() || undefined
  const metadata = parseJsonValue(formData.get('metadata'))

  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const result = await importAsinFile({
      userId: auth.userId,
      source,
      filename: file.name,
      fileType: file.type,
      fileSize: file.size,
      buffer,
      defaultCountry,
      metadata,
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'ASIN导入失败' },
      { status: 500 }
    )
  }
}

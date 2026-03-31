import { NextRequest, NextResponse } from 'next/server'

/**
 * ⚠️ DEPRECATED API - 此接口已废弃
 *
 * 原因：此接口不创建本地campaigns记录，无法维护完整的关联链路
 *
 * 迁移路径：请使用 POST /api/campaigns/publish 替代
 *
 * 新接口优势：
 * 1. 完整的Offer → Creative → Campaign关联
 * 2. 支持A/B测试和智能优化
 * 3. 完整的本地数据追溯
 * 4. 符合1:1:1广告架构规范
 *
 * 迁移时间：2025-11-22
 * 删除计划：2025-12-31
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    {
      error: 'API已废弃',
      message: '此接口已于2025-11-22废弃，请使用 POST /api/campaigns/publish',
      deprecated: true,
      migration: {
        newEndpoint: '/api/campaigns/publish',
        documentation: '/docs/api/campaigns-publish',
        reason: '不维护本地campaigns记录，无法追溯创意关联',
      },
      scheduledRemoval: '2025-12-31',
    },
    {
      status: 410, // 410 Gone - 资源已永久不可用
      headers: {
        'X-Deprecated': 'true',
        'X-Deprecated-Since': '2025-11-22',
        'X-Migration-Guide': '/api/campaigns/publish',
      }
    }
  )
}

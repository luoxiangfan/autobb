/**
 * Offer拉黑投放API
 * POST /api/offers/[id]/blacklist - 拉黑投放
 * DELETE /api/offers/[id]/blacklist - 取消拉黑
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { verifyAuth } from '@/lib/auth'
import { invalidateOfferCache } from '@/lib/api-cache'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { id } = await params
    const offerId = parseInt(id)
    if (isNaN(offerId)) {
      return NextResponse.json({ error: '无效的Offer ID' }, { status: 400 })
    }

    const db = await getDatabase()

    // 获取Offer信息
    const offer = await db.queryOne(
      'SELECT id, brand, target_country FROM offers WHERE id = ? AND user_id = ?',
      [offerId, userId]
    ) as { id: number; brand: string; target_country: string } | undefined

    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在' }, { status: 404 })
    }

    // 检查是否已存在黑名单记录
    const existing = await db.queryOne(
      'SELECT id FROM offer_blacklist WHERE user_id = ? AND brand = ? AND target_country = ?',
      [userId, offer.brand, offer.target_country]
    )

    if (existing) {
      return NextResponse.json({ error: '该品牌+国家组合已在黑名单中' }, { status: 409 })
    }

    // 添加到黑名单
    await db.exec(
      'INSERT INTO offer_blacklist (user_id, brand, target_country, offer_id) VALUES (?, ?, ?, ?)',
      [userId, offer.brand, offer.target_country, offerId]
    )

    // 使缓存失效
    invalidateOfferCache(userId)

    return NextResponse.json({
      success: true,
      message: '已拉黑投放',
      blacklist: {
        brand: offer.brand,
        targetCountry: offer.target_country
      }
    })
  } catch (error: any) {
    console.error('拉黑投放失败:', error)
    return NextResponse.json(
      { error: error.message || '拉黑投放失败' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { id } = await params
    const offerId = parseInt(id)
    if (isNaN(offerId)) {
      return NextResponse.json({ error: '无效的Offer ID' }, { status: 400 })
    }

    const db = await getDatabase()

    // 获取Offer信息
    const offer = await db.queryOne(
      'SELECT id, brand, target_country FROM offers WHERE id = ? AND user_id = ?',
      [offerId, userId]
    ) as { id: number; brand: string; target_country: string } | undefined

    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在' }, { status: 404 })
    }

    // 从黑名单中删除
    const result = await db.exec(
      'DELETE FROM offer_blacklist WHERE user_id = ? AND brand = ? AND target_country = ?',
      [userId, offer.brand, offer.target_country]
    )

    // 兼容SQLite和PostgreSQL
    const deletedCount = (result.changes !== undefined ? result.changes : (result as any).rowCount) || 0
    if (deletedCount === 0) {
      return NextResponse.json({ error: '该品牌+国家组合不在黑名单中' }, { status: 404 })
    }

    // 使缓存失效
    invalidateOfferCache(userId)

    return NextResponse.json({
      success: true,
      message: '已取消拉黑'
    })
  } catch (error: any) {
    console.error('取消拉黑失败:', error)
    return NextResponse.json(
      { error: error.message || '取消拉黑失败' },
      { status: 500 }
    )
  }
}

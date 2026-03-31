/**
 * POST /api/offers/batch/create
 *
 * 批量创建Offer任务
 *
 * 流程：
 * 1. 接收CSV文件上传（FormData）
 * 2. 解析CSV，校验必填列（推广链接、推广国家）
 * 3. 跳过缺少必填参数的行，只处理有效数据
 * 4. 创建batch_tasks记录
 * 5. 创建batch-offer-creation任务并加入队列
 * 6. 返回batchId供前端订阅
 *
 * CSV格式要求：
 * - 必需列：推广链接/affiliate_link, 推广国家/target_country（支持中英文表头）
 * - 可选列：链接类型/page_type（store/product）
 * - 可选列：品牌名/brand_name（或brand）
 * - 可选列：产品价格/product_price（店铺类型可填平均产品价格）
 * - 可选列：佣金比例/commission_payout（兼容旧列）
 * - 可选列：commission_type + commission_value（推荐），可附带 commission_currency
 * - 店铺类型可选列：单品推广链接 product_link_1~3（最多3个）
 * - 编码：UTF-8
 * - 最大有效行数：500行
 * - 缺少必填参数的行会被自动跳过
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { BatchCreationTaskData } from '@/lib/queue/executors/batch-creation-executor'
import { canonicalizeOfferBatchCsvHeader, decodeCsvTextSmart, normalizeCsvHeaderCell } from '@/lib/offers/batch-offer-csv'
import { toDbJsonObjectField } from '@/lib/json-field'
import { normalizeOfferCommissionInput } from '@/lib/offer-monetization'
import Papa from 'papaparse'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = req.headers.get('x-request-id') || undefined

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    // 1. 验证用户身份
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    // 2. 解析FormData
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'Invalid request', message: '请上传CSV文件' },
        { status: 400 }
      )
    }

    // 3. 读取并解析CSV
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = decodeCsvTextSmart(bytes)

    // 使用papaparse解析CSV，正确处理带逗号的值
    const parseResult = Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
    })

    if (parseResult.errors.length > 0) {
      console.error('CSV解析错误:', parseResult.errors)
    }

    const lines = parseResult.data as string[][]

    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'Invalid CSV', message: 'CSV文件至少需要包含标题行和一行数据' },
        { status: 400 }
      )
    }

    // 解析标题行（支持中英文表头）
    const rawHeaders = lines[0].map(h => normalizeCsvHeaderCell(h))

    // 映射后的英文字段名（兼容：中文/英文/带括号说明/带BOM等）
    const headers = rawHeaders.map(h => canonicalizeOfferBatchCsvHeader(h))

    // 查找必填列索引
    const affiliateLinkIdx = headers.indexOf('affiliate_link')
    const targetCountryIdx = headers.indexOf('target_country')

    const headersPreview = rawHeaders.filter(Boolean).slice(0, 20).join(', ')
    const headersPreviewSuffix = rawHeaders.filter(Boolean).length > 20 ? ' ...' : ''

    // 校验必填列存在
    if (affiliateLinkIdx === -1) {
      return NextResponse.json(
        {
          error: 'Invalid CSV',
          message: `CSV文件缺少必需列：推广链接 (affiliate_link)${headersPreview ? `；检测到的列：${headersPreview}${headersPreviewSuffix}` : ''}`,
        },
        { status: 400 }
      )
    }

    if (targetCountryIdx === -1) {
      return NextResponse.json(
        {
          error: 'Invalid CSV',
          message: `CSV文件缺少必需列：推广国家 (target_country)${headersPreview ? `；检测到的列：${headersPreview}${headersPreviewSuffix}` : ''}`,
        },
        { status: 400 }
      )
    }

    // 查找可选列索引
    const brandNameIdx = headers.indexOf('brand_name')
    const productPriceIdx = headers.indexOf('product_price')
    const commissionPayoutIdx = headers.indexOf('commission_payout')
    const commissionTypeIdx = headers.indexOf('commission_type')
    const commissionValueIdx = headers.indexOf('commission_value')
    const commissionCurrencyIdx = headers.indexOf('commission_currency')
    const pageTypeIdx = headers.indexOf('page_type')
    const productLink1Idx = headers.indexOf('product_link_1')
    const productLink2Idx = headers.indexOf('product_link_2')
    const productLink3Idx = headers.indexOf('product_link_3')

    // 解析数据行，只保留必填参数完整的行
    const rows: Array<{
      affiliate_link: string
      target_country: string
      brand_name?: string
      product_price?: string
      commission_payout?: string
      commission_type?: 'percent' | 'amount'
      commission_value?: string
      commission_currency?: string
      page_type?: 'store' | 'product'
      store_product_links?: string[]
    }> = []

    let skippedCount = 0
    const commissionValidationErrors: Array<{ row: number; message: string }> = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].map(v => v.trim())
      const affiliateLink = values[affiliateLinkIdx]
      const targetCountry = values[targetCountryIdx]

      // 校验必填参数
      // 🔥 2025-12-12修复：加强验证，确保不是空字符串，target_country至少2个字符
      if (!affiliateLink || affiliateLink.trim() === '' || !targetCountry || targetCountry.trim().length < 2) {
        skippedCount++
        console.warn(`⚠️ 跳过第${i + 1}行：缺少必填参数 (推广链接=${affiliateLink}, 推广国家=${targetCountry})`)
        continue // 跳过参数不全的行
      }

      // 🔧 修复：检测无效的推广链接值（如 'null/', 'null' 等）
      const normalizedAffiliateLink = affiliateLink.trim()
      if (normalizedAffiliateLink === 'null' || normalizedAffiliateLink === 'null/' || normalizedAffiliateLink === 'undefined') {
        skippedCount++
        console.warn(`⚠️ 跳过第${i + 1}行：推广链接无效 (${normalizedAffiliateLink})`)
        continue
      }

      const row: any = {
        affiliate_link: affiliateLink,
        target_country: targetCountry,
      }

      const rawPageType = pageTypeIdx !== -1 ? (values[pageTypeIdx] || '').trim() : ''
      const normalizedPageType = rawPageType.toLowerCase()
      const parsedPageType: 'store' | 'product' | undefined = (() => {
        if (!normalizedPageType) return undefined
        if (['store', 'shop', 'shopify', 'storefront', '店铺', '店铺页', '店铺类型'].includes(normalizedPageType)) {
          return 'store'
        }
        if (['product', 'item', 'single', '单品', '产品', '商品', '单品页'].includes(normalizedPageType)) {
          return 'product'
        }
        return undefined
      })()

      // 添加可选参数
      if (brandNameIdx !== -1 && values[brandNameIdx]) {
        const brandName = values[brandNameIdx].trim()
        if (brandName.length > 120) {
          skippedCount++
          console.warn(`⚠️ 跳过第${i + 1}行：品牌名过长（>120）`)
          continue
        }
        if (brandName) row.brand_name = brandName
      }
      if (productPriceIdx !== -1 && values[productPriceIdx]) {
        row.product_price = values[productPriceIdx]
      }

      const rawCommissionPayout = commissionPayoutIdx !== -1 ? values[commissionPayoutIdx] : undefined
      const rawCommissionType = commissionTypeIdx !== -1 ? values[commissionTypeIdx] : undefined
      const rawCommissionValue = commissionValueIdx !== -1 ? values[commissionValueIdx] : undefined
      const rawCommissionCurrency = commissionCurrencyIdx !== -1 ? values[commissionCurrencyIdx] : undefined

      const hasCommissionInput = [rawCommissionPayout, rawCommissionType, rawCommissionValue, rawCommissionCurrency]
        .some((value) => value !== undefined && String(value).trim() !== '')

      if (hasCommissionInput) {
        try {
          const normalizedCommission = normalizeOfferCommissionInput({
            targetCountry,
            commissionPayout: rawCommissionPayout,
            commissionType: rawCommissionType,
            commissionValue: rawCommissionValue,
            commissionCurrency: rawCommissionCurrency,
          })

          if (normalizedCommission.commissionPayout) {
            row.commission_payout = normalizedCommission.commissionPayout
          }
          if (normalizedCommission.commissionType) {
            row.commission_type = normalizedCommission.commissionType
          }
          if (normalizedCommission.commissionValue) {
            row.commission_value = normalizedCommission.commissionValue
          }
          if (normalizedCommission.commissionCurrency) {
            row.commission_currency = normalizedCommission.commissionCurrency
          }
        } catch (error: any) {
          commissionValidationErrors.push({
            row: i + 1,
            message: error?.message || '佣金字段格式错误',
          })
          continue
        }
      }

      const productLinkCandidates = [
        productLink1Idx !== -1 ? values[productLink1Idx] : '',
        productLink2Idx !== -1 ? values[productLink2Idx] : '',
        productLink3Idx !== -1 ? values[productLink3Idx] : '',
      ]
      const normalizedProductLinks = productLinkCandidates
        .map((v) => (v || '').trim())
        .filter((v) => Boolean(v))
      const uniqueProductLinks = Array.from(new Set(normalizedProductLinks)).slice(0, 3)

      let resolvedPageType = parsedPageType
      if (!resolvedPageType && uniqueProductLinks.length > 0) {
        resolvedPageType = 'store'
      }

      if (resolvedPageType === 'store') {
        const invalidLink = uniqueProductLinks.find((link) => {
          try {
            // eslint-disable-next-line no-new
            new URL(link)
            return false
          } catch {
            return true
          }
        })
        if (invalidLink) {
          skippedCount++
          console.warn(`⚠️ 跳过第${i + 1}行：单品推广链接无效 (${invalidLink})`)
          continue
        }
        row.page_type = 'store'
        if (uniqueProductLinks.length > 0) {
          row.store_product_links = uniqueProductLinks
        }
      } else if (resolvedPageType === 'product') {
        row.page_type = 'product'
      } else if (rawPageType) {
        skippedCount++
        console.warn(`⚠️ 跳过第${i + 1}行：无法识别链接类型 (${rawPageType})`)
        continue
      }

      rows.push(row)
    }

    if (commissionValidationErrors.length > 0) {
      const preview = commissionValidationErrors.slice(0, 10)
      return NextResponse.json(
        {
          error: 'Invalid CSV',
          message: `发现 ${commissionValidationErrors.length} 行佣金参数冲突或格式错误，请修正后重试`,
          commissionErrors: preview,
        },
        { status: 400 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: 'Invalid CSV',
          message: skippedCount > 0
            ? `CSV文件中所有${skippedCount}行数据都缺少必填参数（推广链接、推广国家）`
            : 'CSV文件中没有有效数据'
        },
        { status: 400 }
      )
    }

    if (rows.length > 500) {
      return NextResponse.json(
        { error: 'Too many rows', message: `CSV文件最多支持500行，当前有效数据${rows.length}行` },
        { status: 400 }
      )
    }

    console.log(`📁 CSV解析完成: ${rows.length} 行有效数据${skippedCount > 0 ? ` (跳过${skippedCount}行)` : ''}`)

    // 4. 创建batch_tasks记录
    const batchId = crypto.randomUUID()

    await db.exec(`
      INSERT INTO batch_tasks (
        id,
        user_id,
        task_type,
        status,
        total_count,
        source_file,
        metadata,
        created_at,
        updated_at
      ) VALUES (?, ?, 'offer-creation', 'pending', ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [
      batchId,
      userIdNum,
      rows.length,
      file.name,
      toDbJsonObjectField(
        {
          skipped_rows: skippedCount,
          valid_rows: rows.length,
        },
        db.type,
        { skipped_rows: skippedCount, valid_rows: rows.length }
      )
    ])

    console.log(`📝 批量任务已创建: ${batchId} (${rows.length} 个Offer${skippedCount > 0 ? `，跳过${skippedCount}行` : ''})`)

    // 4.5 创建upload_records记录
    const uploadRecordId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO upload_records (
        id,
        user_id,
        batch_id,
        file_name,
        file_size,
        valid_count,
        skipped_count,
        status,
        metadata,
        uploaded_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ${nowFunc}, ${nowFunc}, ${nowFunc})
    `, [
      uploadRecordId,
      userIdNum,
      batchId,
      file.name,
      file.size,
      rows.length,
      skippedCount,
      toDbJsonObjectField(
        {
          skipped_rows: skippedCount,
          valid_rows: rows.length,
        },
        db.type,
        { skipped_rows: skippedCount, valid_rows: rows.length }
      )
    ])

    console.log(`📋 上传记录已创建: ${uploadRecordId}`)

    // 5. 将batch-offer-creation任务加入队列
    const taskData: BatchCreationTaskData = {
      batchId,
      rows
    }

    await queue.enqueue(
      'batch-offer-creation',
      taskData,
      userIdNum,
      {
        parentRequestId,
        priority: 'normal',
        maxRetries: 1 // 批量任务本身不重试，由子任务重试
      }
    )

    console.log(`🚀 批量任务已加入队列: ${batchId}`)

    // 6. 返回batchId
    return NextResponse.json({
      success: true,
      batchId,
      totalCount: rows.length,
      skippedCount: skippedCount,
      message: `批量任务已创建，共${rows.length}个Offer`
    })

  } catch (error: any) {
    console.error('❌ 批量创建任务失败:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || '创建批量任务失败'
      },
      { status: 500 }
    )
  }
}

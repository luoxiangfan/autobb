/**
 * GET /api/offers/batch-template
 * 提供批量导入CSV模板下载
 *
 * 调用方式：
 * - 浏览器直接访问：触发文件下载
 * - 前端按钮：window.open('/api/offers/batch-template')
 *
 * 模板字段说明：
 * - 必填：affiliate_link（推广链接）, target_country（推广国家）
 * - 选填：page_type（链接类型：product/store）, brand_name（品牌名）
 * - 选填：product_price（产品价格/平均产品价格）
 * - 选填（新）：commission_type + commission_value（可选 commission_currency）
 * - 选填（兼容）：commission_payout（佣金比例/平均佣金比例）
 * - 店铺类型可选填：product_link_1~3（单品推广链接，最多3个）
 * - 说明：Final URL、评论分析、竞品分析等信息会通过自动抓取获得
 */

import { NextResponse } from 'next/server'

export async function GET() {
  // Excel 兼容：在部分 Mac 版 Microsoft Excel 中，UTF-8 CSV 如果没有 BOM 会出现中文列名乱码
  // 这里主动添加 UTF-8 BOM（\uFEFF），并使用 CRLF 换行，提升跨平台兼容性
  const csv = `\uFEFF${[
    '推广链接,推广国家,链接类型,品牌名,产品价格/平均产品价格,佣金类型,佣金值,佣金币种,佣金比例/平均佣金比例(兼容旧列),单品推广链接1,单品推广链接2,单品推广链接3',
    'https://pboost.me/UKTs4I6,US,product,kaspersky,$699.00,percent,6.75,,6.75%,,,',
    'https://pboost.me/xEAgQ8ec,DE,product,,€299.00,percent,8,,8.00%,,,',
    'https://pboost.me/RKWwEZR9,UK,product,,£499.00,amount,22.5,GBP,£22.5,,,',
    'https://example-affiliate-store.com,US,store,BrandX,$59.00,percent,12,,12%,https://example.com/item-a,https://example.com/item-b,https://example.com/item-c',
    '',
  ].join('\r\n')}`

  // 返回CSV文件响应
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="offer-import-template.csv"',
      'Cache-Control': 'no-cache, no-store, must-revalidate', // 禁用缓存，确保始终获取最新模板
    },
  })
}

// 健康检查（可选）
export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const params = await request.json()

    // 保存到临时文件
    const filePath = '/tmp/campaign-params-test.json'
    fs.writeFileSync(filePath, JSON.stringify(params, null, 2))

    // 分析参数并返回总结
    const summary = {
      required: [
        'campaignName',
        'budgetAmount',
        'budgetType',
        'targetCountry',
        'targetLanguage',
        'adGroupName',
        'keywords',
        'headlines',
        'descriptions',
        'finalUrls',
      ],
      withDefaults: [
        { param: 'status', default: 'PAUSED', reason: 'Google推荐创建时暂停' },
        { param: 'biddingStrategy', default: 'manual_cpc', reason: 'Node.js库标准策略' },
        { param: 'adGroupStatus', default: 'ENABLED', reason: 'Ad Group默认启用' },
      ],
      optional: [
        { param: 'startDate', description: '广告开始日期' },
        { param: 'endDate', description: '广告结束日期' },
        { param: 'cpcBidMicros', description: 'CPC手动出价' },
        { param: 'path1', description: '显示路径1' },
        { param: 'path2', description: '显示路径2' },
      ],
      validation: {
        headlines: {
          min: 3,
          max: 15,
          maxLength: 30,
          actual: params.headlines.length,
        },
        descriptions: {
          min: 2,
          max: 4,
          maxLength: 90,
          actual: params.descriptions.length,
        },
        keywords: {
          min: 1,
          actual: params.keywords.length,
        },
      },
    }

    return NextResponse.json({
      success: true,
      message: '参数已保存',
      filePath,
      summary,
      params,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

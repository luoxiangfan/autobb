'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface CampaignParams {
  // Campaign Level
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  status: 'ENABLED' | 'PAUSED'
  biddingStrategy: 'manual_cpc' | 'target_spend' | 'maximize_conversions'
  targetCountry: string
  targetLanguage: string
  startDate?: string
  endDate?: string

  // Ad Group Level
  adGroupName: string
  cpcBidMicros?: number
  adGroupStatus: 'ENABLED' | 'PAUSED'

  // Keywords Level
  keywords: Array<{
    text: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    status: 'ENABLED' | 'PAUSED'
  }>

  // Ad Level (Responsive Search Ad)
  headlines: string[]  // 3-15 headlines
  descriptions: string[]  // 2-4 descriptions
  finalUrls: string[]
  path1?: string
  path2?: string
}

export default function CampaignParamsTestPage() {
  const [params, setParams] = useState<CampaignParams>({
    // Campaign Level - 必需参数
    campaignName: 'Test Campaign 2025',
    budgetAmount: 50,
    budgetType: 'DAILY',
    status: 'PAUSED',
    biddingStrategy: 'manual_cpc',
    targetCountry: 'US',
    targetLanguage: 'en',

    // Ad Group Level - 必需参数
    adGroupName: 'Ad Group 1',
    adGroupStatus: 'ENABLED',

    // Keywords - 必需参数
    keywords: [
      { text: 'security camera', matchType: 'PHRASE', status: 'ENABLED' },
      { text: 'home security', matchType: 'BROAD', status: 'ENABLED' },
      { text: 'wireless camera', matchType: 'EXACT', status: 'ENABLED' },
    ],

    // Ad - 必需参数
    headlines: [
      'Best Security Cameras',
      'Wireless Home Security',
      'Smart Home Protection',
    ],
    descriptions: [
      'Protect your home with advanced security cameras. Easy installation.',
      'Get real-time alerts and HD video. Shop now!',
    ],
    finalUrls: ['https://example.com'],
  })

  const [savedParams, setSavedParams] = useState<CampaignParams | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/test/campaign-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      const result = await response.json()
      if (response.ok) {
        setSavedParams(params)
        alert('参数保存成功！')
      } else {
        alert(`保存失败: ${result.error}`)
      }
    } catch (error) {
      alert(`保存失败: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Google Ads 广告发布参数测试</h1>
        <p className="text-muted-foreground mt-2">
          填写完整的广告发布参数，保存后可以看到哪些参数是必需的，哪些有默认值
        </p>
      </div>

      {/* Campaign Level Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            1. Campaign 广告系列参数
            <Badge variant="destructive">必需</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>
                Campaign Name <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Input
                value={params.campaignName}
                onChange={(e) => setParams({ ...params, campaignName: e.target.value })}
                placeholder="广告系列名称"
              />
            </div>

            <div>
              <Label>
                Budget Amount (USD) <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Input
                type="number"
                value={params.budgetAmount}
                onChange={(e) => setParams({ ...params, budgetAmount: parseFloat(e.target.value) })}
                placeholder="预算金额"
              />
            </div>

            <div>
              <Label>
                Budget Type <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Select
                value={params.budgetType}
                onValueChange={(value) => setParams({ ...params, budgetType: value as 'DAILY' | 'TOTAL' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">每日预算</SelectItem>
                  <SelectItem value="TOTAL">总预算</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>
                Status <Badge className="ml-1">默认: PAUSED</Badge>
              </Label>
              <Select
                value={params.status}
                onValueChange={(value) => setParams({ ...params, status: value as 'ENABLED' | 'PAUSED' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAUSED">暂停（推荐）</SelectItem>
                  <SelectItem value="ENABLED">启用</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>
                Bidding Strategy <Badge className="ml-1">默认: manual_cpc</Badge>
              </Label>
              <Select
                value={params.biddingStrategy}
                onValueChange={(value: any) => setParams({ ...params, biddingStrategy: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_cpc">Manual CPC</SelectItem>
                  <SelectItem value="target_spend">Maximize Clicks</SelectItem>
                  <SelectItem value="maximize_conversions">Maximize Conversions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>
                Target Country <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Select
                value={params.targetCountry}
                onValueChange={(value) => setParams({ ...params, targetCountry: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="AU">Australia</SelectItem>
                  <SelectItem value="DE">Germany</SelectItem>
                  <SelectItem value="FR">France</SelectItem>
                  <SelectItem value="JP">Japan</SelectItem>
                  <SelectItem value="CN">China</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>
                Target Language <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Select
                value={params.targetLanguage}
                onValueChange={(value) => setParams({ ...params, targetLanguage: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">Chinese (Simplified)</SelectItem>
                  <SelectItem value="zh-TW">Chinese (Traditional)</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>
                Start Date <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                type="date"
                value={params.startDate || ''}
                onChange={(e) => setParams({ ...params, startDate: e.target.value })}
              />
            </div>

            <div>
              <Label>
                End Date <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                type="date"
                value={params.endDate || ''}
                onChange={(e) => setParams({ ...params, endDate: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ad Group Level Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            2. Ad Group 广告组参数
            <Badge variant="destructive">必需</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>
                Ad Group Name <Badge variant="destructive" className="ml-1">必需</Badge>
              </Label>
              <Input
                value={params.adGroupName}
                onChange={(e) => setParams({ ...params, adGroupName: e.target.value })}
                placeholder="广告组名称"
              />
            </div>

            <div>
              <Label>
                CPC Bid (Micros) <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                type="number"
                value={params.cpcBidMicros || ''}
                onChange={(e) => setParams({ ...params, cpcBidMicros: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="例如: 1000000 = $1.00"
              />
              <p className="text-xs text-muted-foreground mt-1">1 USD = 1,000,000 micros</p>
            </div>

            <div>
              <Label>
                Status <Badge className="ml-1">默认: ENABLED</Badge>
              </Label>
              <Select
                value={params.adGroupStatus}
                onValueChange={(value) => setParams({ ...params, adGroupStatus: value as 'ENABLED' | 'PAUSED' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENABLED">启用</SelectItem>
                  <SelectItem value="PAUSED">暂停</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Keywords Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            3. Keywords 关键词参数
            <Badge variant="destructive">必需</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {params.keywords.map((keyword, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  value={keyword.text}
                  onChange={(e) => {
                    const newKeywords = [...params.keywords]
                    newKeywords[index].text = e.target.value
                    setParams({ ...params, keywords: newKeywords })
                  }}
                  placeholder="关键词"
                  className="flex-1"
                />
                <Select
                  value={keyword.matchType}
                  onValueChange={(value: any) => {
                    const newKeywords = [...params.keywords]
                    newKeywords[index].matchType = value
                    setParams({ ...params, keywords: newKeywords })
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BROAD">广泛匹配</SelectItem>
                    <SelectItem value="PHRASE">词组匹配</SelectItem>
                    <SelectItem value="EXACT">精确匹配</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={keyword.status}
                  onValueChange={(value: any) => {
                    const newKeywords = [...params.keywords]
                    newKeywords[index].status = value
                    setParams({ ...params, keywords: newKeywords })
                  }}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENABLED">启用</SelectItem>
                    <SelectItem value="PAUSED">暂停</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const newKeywords = params.keywords.filter((_, i) => i !== index)
                    setParams({ ...params, keywords: newKeywords })
                  }}
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                setParams({
                  ...params,
                  keywords: [...params.keywords, { text: '', matchType: 'PHRASE', status: 'ENABLED' }]
                })
              }}
            >
              + 添加关键词
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Ad Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            4. Responsive Search Ad 响应式搜索广告参数
            <Badge variant="destructive">必需</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>
              Headlines 标题 (3-15个，每个最多30字符) <Badge variant="destructive" className="ml-1">必需</Badge>
            </Label>
            <div className="space-y-2 mt-2">
              {params.headlines.map((headline, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={headline}
                    onChange={(e) => {
                      const newHeadlines = [...params.headlines]
                      newHeadlines[index] = e.target.value
                      setParams({ ...params, headlines: newHeadlines })
                    }}
                    placeholder={`标题 ${index + 1}`}
                    maxLength={30}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {headline.length}/30
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      const newHeadlines = params.headlines.filter((_, i) => i !== index)
                      setParams({ ...params, headlines: newHeadlines })
                    }}
                    disabled={params.headlines.length <= 3}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => setParams({ ...params, headlines: [...params.headlines, ''] })}
                disabled={params.headlines.length >= 15}
              >
                + 添加标题
              </Button>
            </div>
          </div>

          <div>
            <Label>
              Descriptions 描述 (2-4个，每个最多90字符) <Badge variant="destructive" className="ml-1">必需</Badge>
            </Label>
            <div className="space-y-2 mt-2">
              {params.descriptions.map((desc, index) => (
                <div key={index} className="flex gap-2">
                  <Textarea
                    value={desc}
                    onChange={(e) => {
                      const newDescriptions = [...params.descriptions]
                      newDescriptions[index] = e.target.value
                      setParams({ ...params, descriptions: newDescriptions })
                    }}
                    placeholder={`描述 ${index + 1}`}
                    maxLength={90}
                    rows={2}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {desc.length}/90
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      const newDescriptions = params.descriptions.filter((_, i) => i !== index)
                      setParams({ ...params, descriptions: newDescriptions })
                    }}
                    disabled={params.descriptions.length <= 2}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => setParams({ ...params, descriptions: [...params.descriptions, ''] })}
                disabled={params.descriptions.length >= 4}
              >
                + 添加描述
              </Button>
            </div>
          </div>

          <div>
            <Label>
              Final URLs 最终链接 <Badge variant="destructive" className="ml-1">必需</Badge>
            </Label>
            <Input
              value={params.finalUrls[0]}
              onChange={(e) => setParams({ ...params, finalUrls: [e.target.value] })}
              placeholder="https://example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>
                Path 1 <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                value={params.path1 || ''}
                onChange={(e) => setParams({ ...params, path1: e.target.value })}
                placeholder="例如: sale"
                maxLength={15}
              />
            </div>

            <div>
              <Label>
                Path 2 <Badge variant="secondary" className="ml-1">可选</Badge>
              </Label>
              <Input
                value={params.path2 || ''}
                onChange={(e) => setParams({ ...params, path2: e.target.value })}
                placeholder="例如: 2025"
                maxLength={15}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex gap-4">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? '保存中...' : '保存参数配置'}
        </Button>

        {savedParams && (
          <div className="flex items-center text-green-600">
            ✓ 参数已保存到 /tmp/campaign-params-test.json
          </div>
        )}
      </div>

      {/* Parameter Summary */}
      {savedParams && (
        <Card>
          <CardHeader>
            <CardTitle>参数总结</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <h3 className="font-semibold">必需参数 (8个):</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>campaignName - 广告系列名称</li>
                <li>budgetAmount - 预算金额</li>
                <li>budgetType - 预算类型 (DAILY/TOTAL)</li>
                <li>targetCountry - 目标国家 (2字母代码)</li>
                <li>targetLanguage - 目标语言 (2字母代码)</li>
                <li>adGroupName - 广告组名称</li>
                <li>keywords - 关键词列表 (至少1个)</li>
                <li>finalUrls - 最终链接</li>
              </ul>

              <h3 className="font-semibold mt-4">默认值参数 (3个):</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>status - Campaign状态 (默认: PAUSED)</li>
                <li>biddingStrategy - 出价策略 (默认: manual_cpc)</li>
                <li>adGroupStatus - Ad Group状态 (默认: ENABLED)</li>
              </ul>

              <h3 className="font-semibold mt-4">可选参数 (5个):</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>startDate - 开始日期</li>
                <li>endDate - 结束日期</li>
                <li>cpcBidMicros - CPC出价</li>
                <li>path1 - 显示路径1</li>
                <li>path2 - 显示路径2</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

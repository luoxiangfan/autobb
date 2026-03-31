'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Loader2, Search, Wand2, ThumbsUp, ThumbsDown, Info, ChevronDown, ChevronUp, AlertTriangle, Settings } from 'lucide-react'
import Link from 'next/link'
import { getCountryOptionsForUI } from '@/lib/language-country-codes'

// 使用全局统一的国家列表（支持69个国家）
const COUNTRIES = getCountryOptionsForUI()

interface ScrapeResult {
  cached: boolean
  cachedAt?: string
  title: string
  description: string
  text: string
  seo?: {
    metaTitle: string
    metaDescription: string
    metaKeywords: string
    ogTitle: string
    ogDescription: string
    ogImage: string
    canonicalUrl: string
    h1: string[]
    imageAlts: string[]
  }
  url?: string
  language?: string
}

interface CreativeResult {
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
  callouts?: string[]
  sitelinks?: Array<{ title: string; description: string; url: string }>
  finalUrl: string
  qualityScore: number
  prompt?: string
  timestamp: string
  modelUsed: string
  orientation: string
}

export default function ScrapeTestPage() {
  // 配置状态
  const [url, setUrl] = useState('')
  const [country, setCountry] = useState('US')
  const [proxyUrl, setProxyUrl] = useState('')

  // AI配置状态检查
  const [aiConfigStatus, setAiConfigStatus] = useState<{
    configured: boolean
    mode: 'direct-api' | 'none'
    message: string
    checking: boolean
  }>({
    configured: false,
    mode: 'none',
    message: '检查中...',
    checking: true
  })

  // 操作状态
  const [scraping, setScraping] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [testOfferId, setTestOfferId] = useState<number | null>(null)

  // 结果状态
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)
  const [creativeResult, setCreativeResult] = useState<CreativeResult | null>(null)

  // 反馈与AI分析
  const [feedbackComment, setFeedbackComment] = useState('')
  const [analysisConversation, setAnalysisConversation] = useState<Array<{role: 'user' | 'assistant', content: string}>>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [userQuestion, setUserQuestion] = useState('')

  // 展开/收起状态
  const [showPrompt, setShowPrompt] = useState(false)
  const [showSeoDetails, setShowSeoDetails] = useState(false)

  // 检查AI配置
  useEffect(() => {
    const checkAIConfig = async () => {
      try {
        const response = await fetch('/api/settings?category=ai')
        if (!response.ok) {
          throw new Error('无法获取AI配置')
        }

        const { settings } = await response.json()

        // settings是按分类分组的对象，格式: { ai: [...] }
        const aiSettings = settings.ai || []

        const provider = aiSettings.find((s: any) => s.key === 'gemini_provider')?.value || 'official'
        const geminiApiKey = aiSettings.find((s: any) => s.key === 'gemini_api_key')?.value
        const geminiRelayApiKey = aiSettings.find((s: any) => s.key === 'gemini_relay_api_key')?.value

        console.log('🔍 AI配置检查:', {
          provider,
          hasGeminiApiKey: !!geminiApiKey,
          hasGeminiRelayApiKey: !!geminiRelayApiKey,
        })

        const hasActiveProviderKey = provider === 'relay'
          ? Boolean(geminiRelayApiKey)
          : Boolean(geminiApiKey)

        if (hasActiveProviderKey) {
          setAiConfigStatus({
            configured: true,
            mode: 'direct-api',
            message: `✅ 当前系统配置: Gemini API（${provider === 'relay' ? '第三方中转' : '官方'}）`,
            checking: false
          })
        } else {
          // 未配置
          setAiConfigStatus({
            configured: false,
            mode: 'none',
            message: '⚠️ AI未配置，请先到设置页面配置',
            checking: false
          })
        }
      } catch (error) {
        console.error('检查AI配置失败:', error)
        setAiConfigStatus({
          configured: false,
          mode: 'none',
          message: '❌ 无法检查AI配置',
          checking: false
        })
      }
    }

    checkAIConfig()
  }, [])

  // 数据抓取
  const handleScrape = async () => {
    if (!url) {
      toast.error('请输入推广链接')
      return
    }

    // 检查AI配置
    if (!aiConfigStatus.configured) {
      toast.error('⚠️ AI未配置！请先到设置页面配置 Gemini API', {
        duration: 5000,
      })
      return
    }

    setScraping(true)
    setScrapeResult(null)
    setCreativeResult(null)
    setAnalysisConversation([])

    try {
      // 1. 创建提取任务（替代已下线的 POST /api/offers）
      const createResponse = await fetch('/api/offers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_link: url,
          target_country: country,
          brand_name: 'Test Brand',
        }),
      })

      if (!createResponse.ok) {
        throw new Error('创建Offer失败')
      }

      const { taskId } = await createResponse.json()
      if (!taskId) {
        throw new Error('创建任务失败，未返回taskId')
      }
      toast.success('已创建测试任务，开始抓取...')

      // 2. 轮询等待提取完成
      let completed = false
      let attempts = 0
      const maxAttempts = 60

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000))

        const taskResponse = await fetch(`/api/offers/extract/status/${taskId}`)
        const taskData = await taskResponse.json()
        if (!taskResponse.ok) {
          throw new Error(taskData.error || '查询任务状态失败')
        }

        if (taskData.status === 'failed') {
          throw new Error(taskData.error?.message || taskData.message || '抓取失败')
        }

        if (taskData.status === 'completed') {
          const offerId = Number(taskData.result?.offerId)
          if (!Number.isFinite(offerId) || offerId <= 0) {
            throw new Error('任务完成但未返回offerId')
          }
          setTestOfferId(offerId)

          const statusResponse = await fetch(`/api/offers/${offerId}`)
          const { offer: updatedOffer } = await statusResponse.json()

          completed = true

          console.log('🔍 Offer数据:', {
            brand: updatedOffer.brand,
            category: updatedOffer.category,
            url: updatedOffer.url,
            brandDescription_length: updatedOffer.brandDescription?.length || 0,
            brandDescription_preview: updatedOffer.brandDescription?.substring(0, 100),
            uniqueSellingPoints_length: updatedOffer.uniqueSellingPoints?.length || 0,
            productHighlights_length: updatedOffer.productHighlights?.length || 0,
            targetAudience_length: updatedOffer.targetAudience?.length || 0,
          })

          // 4. 使用Offer中的抓取数据（已包含AI分析结果）
          // 品牌名已经由后端提取并存储，直接使用即可
          const brandName = updatedOffer.brand || 'Unknown Brand'
          console.log('✅ 使用后端提取的品牌名:', brandName)

          const finalUrl = updatedOffer.url || url
          const category = updatedOffer.category || 'Product'

          console.log('📊 最终显示数据:', {
            brandName,
            category,
            finalUrl,
            descriptionLength: (updatedOffer.brandDescription || '').length
          })

          setScrapeResult({
            cached: false, // 标记为非缓存，表示来自数据库
            title: `${brandName} - ${category}`,
            description: updatedOffer.brandDescription || '无品牌描述',
            text: `品牌: ${brandName}\n类别: ${category}\n\n品牌描述:\n${updatedOffer.brandDescription || '无'}\n\n独特卖点:\n${updatedOffer.uniqueSellingPoints || '无'}\n\n产品亮点:\n${updatedOffer.productHighlights || '无'}\n\n目标受众:\n${updatedOffer.targetAudience || '无'}`,
            url: finalUrl,
            seo: {
              metaTitle: `${brandName} - ${category}`,
              metaDescription: updatedOffer.brandDescription || '',
              metaKeywords: category,
              ogTitle: brandName,
              ogDescription: updatedOffer.brandDescription || '',
              ogImage: '',
              canonicalUrl: finalUrl,
              h1: [brandName],
              imageAlts: [],
            }
          })

          toast.success(`✅ 抓取完成！识别品牌: ${brandName}`)
        }

        attempts++
      }

      if (!completed) {
        throw new Error('抓取超时，请稍后重试')
      }
    } catch (error: any) {
      console.error('抓取失败:', error)
      toast.error(error.message || '抓取失败')
    } finally {
      setScraping(false)
    }
  }

  // AI创意生成
  const handleGenerate = async () => {
    if (!testOfferId) {
      toast.error('请先完成数据抓取')
      return
    }

    // 检查AI配置
    if (!aiConfigStatus.configured) {
      toast.error('⚠️ AI未配置！请先到设置页面配置 Gemini API', {
        duration: 5000,
      })
      return
    }

    setGenerating(true)
    setCreativeResult(null)

    try {
      const response = await fetch(`/api/offers/${testOfferId}/generate-creatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orientations: ['product'], // 只生成产品导向的创意
        }),
      })

      if (!response.ok) {
        throw new Error('AI创意生成失败')
      }

      const responseData = await response.json()
      const { variants } = responseData

      if (variants && variants.length > 0) {
        const creative = variants[0]

        const result: CreativeResult = {
          headline1: creative.headline1,
          headline2: creative.headline2,
          headline3: creative.headline3,
          description1: creative.description1,
          description2: creative.description2,
          callouts: creative.callouts || [],
          sitelinks: creative.sitelinks || [],
          finalUrl: creative.finalUrl || url,
          qualityScore: creative.qualityScore || 0,
          prompt: creative.prompt || '未获取到Prompt',
          timestamp: new Date().toISOString(),
          modelUsed: 'Gemini API - Gemini 2.5 Pro',
          orientation: creative.orientation,
        }

        setCreativeResult(result)
        toast.success('✅ 创意生成成功！')
      }
    } catch (error: any) {
      console.error('生成失败:', error)
      toast.error(error.message || 'AI创意生成失败')
    } finally {
      setGenerating(false)
    }
  }

  // 提交反馈
  const handleFeedback = async (rating: 'good' | 'bad') => {
    if (!creativeResult || !feedbackComment.trim()) {
      toast.error('请输入反馈意见')
      return
    }

    const feedback = {
      rating,
      comment: feedbackComment,
      timestamp: new Date().toISOString(),
    }

    toast.success(`已提交${rating === 'good' ? '正面' : '负面'}反馈，AI分析中...`)

    // 触发AI分析
    await analyzeWithAI(feedback)

    setFeedbackComment('')
  }

  // AI分析反馈
  const analyzeWithAI = async (feedback: { rating: string; comment: string }) => {
    setAnalyzing(true)
    try {
      const response = await fetch('/api/admin/feedback-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback,
          scrapeData: scrapeResult,
          creativeData: creativeResult,
          conversationHistory: analysisConversation
        })
      })

      if (!response.ok) {
        throw new Error('AI分析失败')
      }

      const { analysis } = await response.json()

      // 添加到对话历史
      const newConversation = [
        ...analysisConversation,
        { role: 'user' as const, content: feedback.comment },
        { role: 'assistant' as const, content: analysis }
      ]
      setAnalysisConversation(newConversation)

      toast.success('✅ AI分析完成！')
    } catch (error: any) {
      console.error('AI分析失败:', error)
      toast.error(error.message || 'AI分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  // 继续与AI对话
  const continueConversation = async () => {
    if (!userQuestion.trim()) {
      toast.error('请输入您的问题')
      return
    }

    setAnalyzing(true)
    try {
      const newConversation = [
        ...analysisConversation,
        { role: 'user' as const, content: userQuestion }
      ]

      const response = await fetch('/api/admin/feedback-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: {
            rating: 'neutral',
            comment: '继续对话'
          },
          scrapeData: scrapeResult,
          creativeData: creativeResult,
          conversationHistory: newConversation
        })
      })

      if (!response.ok) {
        throw new Error('AI对话失败')
      }

      const { analysis } = await response.json()

      setAnalysisConversation([
        ...newConversation,
        { role: 'assistant' as const, content: analysis }
      ])

      setUserQuestion('')
      toast.success('✅ AI回复完成！')
    } catch (error: any) {
      console.error('AI对话失败:', error)
      toast.error(error.message || 'AI对话失败')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="page-title">数据抓取与AI创意生成测试</h1>
          <p className="page-subtitle">管理员功能 - 测试和优化系统功能</p>
        </div>

        <div className="space-y-6">
          {/* AI配置警告 */}
          {!aiConfigStatus.configured && !aiConfigStatus.checking && (
            <Card className="p-4 bg-yellow-50 border-yellow-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-900 mb-1">⚠️ AI未配置</h3>
                  <p className="text-sm text-yellow-800 mb-3">
                    系统检测到AI引擎（Gemini API）尚未配置。数据抓取和创意生成功能需要AI支持才能正常工作。
                  </p>
                  <Link href="/settings">
                    <Button size="sm" variant="outline" className="bg-white hover:bg-yellow-50 border-yellow-300">
                      <Settings className="w-4 h-4 mr-2" />
                      前往设置页面配置
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}

          {/* 第一部分：配置区 */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6 text-gray-900">📋 配置区</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 推广链接 */}
              <div className="md:col-span-2">
                <Label>推广链接 *</Label>
                <Input
                  type="url"
                  placeholder="https://example.com/product"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* 推广国家 */}
              <div>
                <Label>推广国家</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 代理URL */}
              <div>
                <Label>代理URL（可选）</Label>
                <Input
                  type="url"
                  placeholder="http://proxy.example.com:8080"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* AI配置状态（只读显示） */}
              <div className="md:col-span-2">
                <Label>AI引擎配置状态</Label>
                <div className={`mt-1 p-3 rounded-md border ${
                  aiConfigStatus.checking ? 'bg-gray-50 border-gray-200' :
                  aiConfigStatus.configured ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {aiConfigStatus.checking ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                    ) : aiConfigStatus.configured ? (
                      <Info className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    )}
                    <span className={`text-sm font-medium ${
                      aiConfigStatus.checking ? 'text-gray-700' :
                      aiConfigStatus.configured ? 'text-green-700' : 'text-yellow-700'
                    }`}>
                      {aiConfigStatus.message}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    实际使用的AI引擎由系统设置决定。配置路径：设置页面 → AI配置
                  </p>
                </div>
              </div>

            </div>
          </Card>

          {/* 第二部分：操作区 */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6 text-gray-900">⚡ 操作区</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 数据抓取按钮 */}
              <Button
                onClick={handleScrape}
                disabled={scraping || !url || !aiConfigStatus.configured}
                size="lg"
                className="h-14"
              >
                {scraping ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    抓取中...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5 mr-2" />
                    1. 数据抓取
                  </>
                )}
              </Button>

              {/* AI创意生成按钮 */}
              <Button
                onClick={handleGenerate}
                disabled={generating || !scrapeResult || !aiConfigStatus.configured}
                size="lg"
                className="h-14"
                variant={scrapeResult && aiConfigStatus.configured ? 'default' : 'secondary'}
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5 mr-2" />
                    2. AI创意生成
                  </>
                )}
              </Button>
            </div>

            {scraping && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700">
                  ⏳ 正在抓取网页数据，请稍候...（预计需要10-30秒）
                </p>
              </div>
            )}

            {generating && (
              <div className="mt-4 p-3 bg-purple-50 rounded-lg">
                <p className="text-sm text-purple-700">
                  🤖 AI正在生成创意内容，请稍候...
                </p>
              </div>
            )}
          </Card>

          {/* 第三部分：结果区 */}
          {(scrapeResult || creativeResult) && (
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-6 text-gray-900">📊 结果区</h2>

              <div className="space-y-6">
                {/* 数据抓取结果 */}
                {scrapeResult && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">1️⃣ 数据抓取结果</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <Info className="w-4 h-4 text-blue-500" />
                        <span className={scrapeResult.cached ? 'text-blue-600' : 'text-gray-600'}>
                          {scrapeResult.cached
                            ? `Redis缓存 (${scrapeResult.cachedAt ? new Date(scrapeResult.cachedAt).toLocaleString('zh-CN') : '未知时间'})`
                            : '实时抓取（未缓存）'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-gray-500">页面标题</Label>
                          <p className="text-sm font-medium mt-1">{scrapeResult.title}</p>
                        </div>
                        {scrapeResult.url && (
                          <div>
                            <Label className="text-xs text-gray-500">Final URL</Label>
                            <p className="text-sm mt-1 break-all text-blue-600">{scrapeResult.url}</p>
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-xs text-gray-500">页面描述</Label>
                        <p className="text-sm mt-1">{scrapeResult.description || '无'}</p>
                      </div>

                      {/* SEO详情（可展开） */}
                      {scrapeResult.seo && (
                        <div className="border-t pt-3">
                          <button
                            onClick={() => setShowSeoDetails(!showSeoDetails)}
                            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                          >
                            {showSeoDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            SEO信息详情
                          </button>

                          {showSeoDetails && (
                            <div className="mt-3 space-y-2 text-sm">
                              {scrapeResult.seo.metaTitle && (
                                <div>
                                  <span className="font-medium">Meta Title:</span> {scrapeResult.seo.metaTitle}
                                </div>
                              )}
                              {scrapeResult.seo.metaDescription && (
                                <div>
                                  <span className="font-medium">Meta Description:</span> {scrapeResult.seo.metaDescription}
                                </div>
                              )}
                              {scrapeResult.seo.h1 && scrapeResult.seo.h1.length > 0 && (
                                <div>
                                  <span className="font-medium">H1标签 ({scrapeResult.seo.h1.length}):</span>
                                  <ul className="ml-4 list-disc">
                                    {scrapeResult.seo.h1.slice(0, 5).map((h, i) => (
                                      <li key={i}>{h}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {scrapeResult.seo.imageAlts && scrapeResult.seo.imageAlts.length > 0 && (
                                <div>
                                  <span className="font-medium">图片Alt文本 ({scrapeResult.seo.imageAlts.length}):</span>
                                  <div className="text-xs text-gray-600 mt-1">
                                    {scrapeResult.seo.imageAlts.slice(0, 10).join(', ')}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* AI创意生成结果 */}
                {creativeResult && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">2️⃣ AI创意生成结果</h3>
                      <div className="text-sm">
                        <span className="font-semibold text-green-600">质量评分: {creativeResult.qualityScore}/100</span>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <Label className="text-xs text-gray-500">使用模型</Label>
                          <p className="font-medium mt-1">{creativeResult.modelUsed}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">导向类型</Label>
                          <p className="font-medium mt-1">{creativeResult.orientation}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-gray-500">标题1</Label>
                          <p className="text-sm font-medium mt-1 bg-white p-2 rounded">{creativeResult.headline1}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">标题2</Label>
                          <p className="text-sm font-medium mt-1 bg-white p-2 rounded">{creativeResult.headline2}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">标题3</Label>
                          <p className="text-sm font-medium mt-1 bg-white p-2 rounded">{creativeResult.headline3}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">描述1</Label>
                          <p className="text-sm mt-1 bg-white p-2 rounded">{creativeResult.description1}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">描述2</Label>
                          <p className="text-sm mt-1 bg-white p-2 rounded">{creativeResult.description2}</p>
                        </div>

                        {/* Callouts */}
                        {creativeResult.callouts && creativeResult.callouts.length > 0 && (
                          <div>
                            <Label className="text-xs text-gray-500">宣传语 (Callouts)</Label>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {creativeResult.callouts.map((callout, idx) => (
                                <span key={idx} className="bg-white px-3 py-1 rounded text-sm border border-gray-200">
                                  {callout}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Sitelinks */}
                        {creativeResult.sitelinks && creativeResult.sitelinks.length > 0 && (
                          <div>
                            <Label className="text-xs text-gray-500">站点链接 (Sitelinks)</Label>
                            <div className="mt-1 space-y-2">
                              {creativeResult.sitelinks.map((sitelink, idx) => (
                                <div key={idx} className="bg-white p-3 rounded border border-gray-200">
                                  <p className="text-sm font-medium text-blue-600">{sitelink.title}</p>
                                  <p className="text-xs text-gray-600 mt-1">{sitelink.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* AI Prompt（可展开） */}
                      {creativeResult.prompt && (
                        <div className="border-t pt-3">
                          <button
                            onClick={() => setShowPrompt(!showPrompt)}
                            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                          >
                            {showPrompt ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            查看完整AI Prompt
                          </button>

                          {showPrompt && (
                            <pre className="mt-3 text-xs p-4 bg-white rounded overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                              {creativeResult.prompt}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* AI反馈分析 */}
                {creativeResult && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">3️⃣ AI反馈分析</h3>

                    {analysisConversation.length === 0 ? (
                      <div className="bg-yellow-50 rounded-lg p-4">
                        <Label className="text-sm font-medium text-gray-700 mb-2 block">提供反馈意见</Label>
                        <Textarea
                          placeholder="请描述您的反馈意见，例如：标题太长了、描述不够吸引人、缺少优惠信息等..."
                          value={feedbackComment}
                          onChange={(e) => setFeedbackComment(e.target.value)}
                          rows={3}
                          className="mb-3"
                        />

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleFeedback('good')}
                            disabled={analyzing || !feedbackComment.trim()}
                            className="bg-green-50 hover:bg-green-100 border-green-200"
                          >
                            <ThumbsUp className="w-4 h-4 mr-1" />
                            好评
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleFeedback('bad')}
                            disabled={analyzing || !feedbackComment.trim()}
                            className="bg-red-50 hover:bg-red-100 border-red-200"
                          >
                            <ThumbsDown className="w-4 h-4 mr-1" />
                            差评
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-lg p-4">
                        <Label className="text-sm font-medium text-gray-700 mb-3 block">💬 AI优化顾问对话</Label>

                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                          {analysisConversation.map((msg, index) => (
                            <div key={index} className={`p-3 rounded-lg ${
                              msg.role === 'user'
                                ? 'bg-blue-100 ml-8'
                                : 'bg-white mr-8 shadow-sm'
                            }`}>
                              <div className="flex items-start gap-2">
                                <div className="font-medium text-sm">
                                  {msg.role === 'user' ? '👤 您' : '🤖 AI顾问'}
                                </div>
                              </div>
                              <div className="text-sm mt-1 whitespace-pre-wrap">
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 继续对话 */}
                        <div className="mt-4 pt-4 border-t">
                          <Label className="text-xs text-gray-600 mb-2 block">继续提问</Label>
                          <div className="flex gap-2">
                            <Input
                              placeholder="有其他问题吗？例如：具体应该如何优化Prompt？"
                              value={userQuestion}
                              onChange={(e) => setUserQuestion(e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter' && !analyzing) {
                                  continueConversation()
                                }
                              }}
                            />
                            <Button
                              onClick={continueConversation}
                              disabled={analyzing || !userQuestion.trim()}
                              size="sm"
                            >
                              {analyzing ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                  分析中...
                                </>
                              ) : (
                                '发送'
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

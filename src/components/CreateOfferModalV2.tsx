'use client'

/**
 * 新版Offer创建流程（多步骤）
 * 步骤1: 用户输入（推广链接+国家+可选参数）
 * 步骤2: 自动提取（Final URL + 品牌名称）
 * 步骤3: 用户确认（可修正品牌名称）
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, Trash2 } from 'lucide-react'
import ProgressTracker from '@/components/ProgressTracker'
import { useOfferExtractionV2 } from '@/hooks/useOfferExtractionV2'
import { getCountryOptionsForUI } from '@/lib/language-country-codes'

interface CreateOfferModalV2Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

// 使用全局统一的国家列表
const countries = getCountryOptionsForUI()

type Step = 'input' | 'extracting' | 'confirm'

interface ExtractedData {
  finalUrl: string
  finalUrlSuffix: string
  brand: string | null
  productDescription: string | null
  targetLanguage: string
  redirectCount: number
  resolveMethod: string
  // 🔥 页面类型标识（店铺/单品）
  pageType: 'store' | 'product'
  pageTypeDetected?: 'store' | 'product'
  pageTypeAdjusted?: boolean
  warnings?: string[] | null
  supplementalSummary?: {
    requested: number
    succeeded: number
    failed: number
  } | null
  // AI分析结果
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
  category: string | null
  // P0评论深度分析
  reviewAnalysis: any | null
  // P0竞品对比分析
  competitorAnalysis: any | null
  // 广告元素提取
  extractedKeywords: any[] | null
  extractedHeadlines: any[] | null
  extractedDescriptions: any[] | null
  extractionMetadata: any | null
  // 🔥 2025-12-16新增：后端自动创建的Offer ID
  offerId: number | null
}

export default function CreateOfferModalV2({
  open,
  onOpenChange,
  onSuccess,
}: CreateOfferModalV2Props) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 步骤1：用户输入
  const [affiliateLink, setAffiliateLink] = useState('')
  const [linkType, setLinkType] = useState<'product' | 'store'>('product')
  const [storeProductLinks, setStoreProductLinks] = useState<string[]>([''])
  const [targetCountry, setTargetCountry] = useState('US')
  const [productPrice, setProductPrice] = useState('')
  const [commissionType, setCommissionType] = useState<'percent' | 'amount'>('percent')
  const [commissionValue, setCommissionValue] = useState('')
  const [commissionCurrency, setCommissionCurrency] = useState('')

  // 步骤2：自动提取的数据
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null)

  // 步骤3：用户可修正的字段
  const [brandName, setBrandName] = useState('')

  // 🔥 任务队列 + SSE进度跟踪
  const {
    isExtracting,
    taskId,
    currentStage,
    currentStatus,
    currentMessage,
    progress,
    result: extractionResult,
    error: extractionError,
    currentDuration,
    stageDurations, // 🔥 获取已完成阶段的耗时Map
    connectionType,
    startExtraction,
    reconnect,
    reset: resetExtraction,
  } = useOfferExtractionV2()

  // 🔥 监听提取完成，自动进入确认步骤
  useEffect(() => {
    console.log('🔍 useEffect triggered:', { extractionResult, currentStage, currentStep })

    if (extractionResult && currentStage === 'completed') {
      console.log('✅ Extraction completed, switching to confirm step')
      console.log('🆔 Offer ID from backend:', extractionResult.offerId)
      // 保存提取的数据（包含所有AI分析结果和后端自动创建的offerId）
      setExtractedData({
        finalUrl: extractionResult.finalUrl,
        finalUrlSuffix: extractionResult.finalUrlSuffix || '',
        brand: extractionResult.brand,
        productDescription: extractionResult.productDescription || null,
        targetLanguage: extractionResult.targetLanguage || 'English',
        redirectCount: extractionResult.redirectCount || 0,
        resolveMethod: 'sse-stream',
        // 🔥 页面类型标识（店铺/单品）
        pageType: extractionResult.pageType || 'product',
        pageTypeDetected: extractionResult.pageTypeDetected || null,
        pageTypeAdjusted: extractionResult.pageTypeAdjusted || false,
        warnings: extractionResult.warnings || null,
        supplementalSummary: extractionResult.supplementalSummary || null,
        // AI分析结果
        brandDescription: extractionResult.brandDescription || null,
        uniqueSellingPoints: extractionResult.uniqueSellingPoints || null,
        productHighlights: extractionResult.productHighlights || null,
        targetAudience: extractionResult.targetAudience || null,
        category: extractionResult.category || null,
        // P0评论深度分析
        reviewAnalysis: extractionResult.reviewAnalysis || null,
        // P0竞品对比分析
        competitorAnalysis: extractionResult.competitorAnalysis || null,
        // 广告元素提取
        extractedKeywords: extractionResult.extractedKeywords || null,
        extractedHeadlines: extractionResult.extractedHeadlines || null,
        extractedDescriptions: extractionResult.extractedDescriptions || null,
        extractionMetadata: extractionResult.extractionMetadata || null,
        // 🔥 2025-12-16新增：后端自动创建的Offer ID
        offerId: extractionResult.offerId || null,
      })
      // 🔥 如果用户已提前填写品牌名，优先保留用户输入；否则使用自动识别结果
      setBrandName((prev) => prev || extractionResult.brand || '')
      setCurrentStep('confirm')
    }
  }, [extractionResult, currentStage])

  // 🔥 监听提取错误
  useEffect(() => {
    if (extractionError) {
      // 检查是否为代理连接问题
      if (
        extractionError.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
        extractionError.includes('代理连接问题') ||
        extractionError.includes('代理失败') ||
        extractionError.includes('代理标记为不健康') ||
        extractionError.includes('代理不健康')
      ) {
        setError(
          '代理连接失败，推广链接解析中断。可能原因：\n' +
          '1. 代理服务器不可用或响应超时\n' +
          '2. 代理配置错误（IP、端口、账号密码）\n' +
          '3. 目标国家代理IP池耗尽\n\n' +
          '请检查设置页面的代理配置，确保代理服务可用后重试。'
        )
      }
      // 检查是否为代理配置缺失
      else if (extractionError.includes('PROXY_NOT_CONFIGURED') || extractionError.includes('代理配置缺失')) {
        setError('代理配置缺失。请先在设置页面配置代理IP才能创建Offer。')
      }
      // 其他错误
      else {
        setError(extractionError)
      }
      setCurrentStep('input')
    }
  }, [extractionError])

  const updateStoreProductLink = (index: number, value: string) => {
    setStoreProductLinks((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const addStoreProductLink = () => {
    setStoreProductLinks((prev) => {
      if (prev.length >= 3) return prev
      return [...prev, '']
    })
  }

  const removeStoreProductLink = (index: number) => {
    setStoreProductLinks((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : ['']
    })
  }

  const normalizeStoreProductLinks = () => {
    const normalized = storeProductLinks
      .map((link) => link.trim())
      .filter((link) => Boolean(link))
    return Array.from(new Set(normalized)).slice(0, 3)
  }

  // ========== 步骤1: 提交用户输入，开始自动提取 ==========
  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    resetExtraction() // 重置之前的提取状态
    setCurrentStep('extracting')

    let normalizedLinks: string[] = []
    if (linkType === 'store') {
      normalizedLinks = normalizeStoreProductLinks()
      for (const link of normalizedLinks) {
        try {
          // eslint-disable-next-line no-new
          new URL(link)
        } catch {
          setError(`单品推广链接无效：${link}`)
          setCurrentStep('input')
          return
        }
      }
    }

    // 🔥 启动SSE流式提取
    startExtraction(
      affiliateLink,
      targetCountry,
      productPrice,
      commissionValue ? commissionType : undefined,
      commissionValue || undefined,
      commissionType === 'amount' && commissionValue ? (commissionCurrency || undefined) : undefined,
      brandName,
      linkType,
      normalizedLinks
    )
  }

  // ========== 步骤3: 用户确认后跳转到Offer详情页 ==========
  // 🔥 2025-12-16重构：Offer已在后端自动创建，用户确认只是跳转到详情页
  const handleConfirm = async () => {
    if (!extractedData?.offerId) {
      setError('Offer创建失败，请重试')
      return
    }

    const finalBrandName = brandName.trim()
    if (!finalBrandName) {
      setError('请输入品牌名称')
      return
    }

    setLoading(true)
    try {
      // 🔥 将用户确认/修正后的品牌名持久化到Offer
      const res = await fetch(`/api/offers/${extractedData.offerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: finalBrandName }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      setError(`保存品牌名失败：${e?.message || String(e)}`)
      setLoading(false)
      return
    }

    // 成功后重置表单并关闭弹窗
    resetForm()
    onOpenChange(false)
    if (onSuccess) onSuccess()

    // 跳转到Offer详情页
    router.push(`/offers/${extractedData.offerId}`)
  }

  const resetForm = () => {
    setAffiliateLink('')
    setLinkType('product')
    setStoreProductLinks([''])
    setTargetCountry('US')
    setProductPrice('')
    setCommissionType('percent')
    setCommissionValue('')
    setCommissionCurrency('')
    setBrandName('')
    setExtractedData(null)
    setCurrentStep('input')
    setError('')
    setLoading(false)
    resetExtraction() // 🔥 重置SSE提取状态
  }

  const handleClose = () => {
    if (!loading && !isExtracting) {
      resetForm()
      onOpenChange(false)
    }
  }

  const handleBack = () => {
    setCurrentStep('input')
    setExtractedData(null)
    setError('')
    resetExtraction() // 🔥 重置SSE提取状态
  }

  // ========== 渲染不同步骤 ==========
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建Offer</DialogTitle>
          <DialogDescription>
            {currentStep === 'input' && '输入推广链接和国家，系统将自动提取Offer信息'}
            {currentStep === 'extracting' && '实时跟踪提取进度，了解每个步骤的执行情况'}
            {currentStep === 'confirm' && 'Offer已创建成功，请确认信息后查看详情'}
          </DialogDescription>
        </DialogHeader>

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-medium mb-1">创建失败</div>
                <div className="whitespace-pre-line text-red-600">{error}</div>
                {/* 如果是代理相关错误，显示前往设置按钮 */}
                {(error.includes('代理') || error.includes('proxy')) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                    onClick={() => {
                      router.push('/settings')
                      onOpenChange(false)
                    }}
                  >
                    前往设置页面
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========== 步骤1: 用户输入 ========== */}
        {currentStep === 'input' && (
          <form onSubmit={handleExtract} className="space-y-4 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="linkType">
                  链接类型 <span className="text-red-500">*</span>
                </Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([
                    { value: 'product', label: '单品' },
                    { value: 'store', label: '店铺' },
                  ] as const).map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        linkType === option.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        id={`linkType-${option.value}`}
                        name="linkType"
                        type="radio"
                        value={option.value}
                        checked={linkType === option.value}
                        onChange={() => setLinkType(option.value)}
                        className="sr-only"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  店铺类型可选填写最多3个单品推广链接，用于补充单品数据
                </p>
              </div>

              <div>
                <Label htmlFor="affiliateLink">
                  {linkType === 'store' ? '店铺推广链接' : '推广链接'} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="affiliateLink"
                  type="url"
                  value={affiliateLink}
                  onChange={(e) => setAffiliateLink(e.target.value)}
                  placeholder="https://pboost.me/example"
                  required
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">
                  {linkType === 'store'
                    ? '店铺的Affiliate推广链接，系统将自动解析最终落地页'
                    : '您的Affiliate推广链接，系统将自动解析最终落地页'}
                </p>
              </div>

              {linkType === 'store' && (
                <div className="space-y-2">
                  <Label>单品推广链接（最多3个）</Label>
                  <div className="space-y-2">
                    {storeProductLinks.map((link, idx) => (
                      <div key={`store-product-link-${idx}`} className="flex items-center gap-2">
                        <Input
                          type="url"
                          value={link}
                          onChange={(e) => updateStoreProductLink(idx, e.target.value)}
                          placeholder={`单品推广链接 ${idx + 1}`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => removeStoreProductLink(idx)}
                          disabled={storeProductLinks.length === 1}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addStoreProductLink}
                      disabled={storeProductLinks.length >= 3}
                    >
                      添加单品链接
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    仅用于补充单品数据，最多3个
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="targetCountry">
                  推广国家 <span className="text-red-500">*</span>
                </Label>
                <Select value={targetCountry} onValueChange={setTargetCountry} required>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="选择国家" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {countries.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {country.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 可选字段 */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <p className="text-sm font-medium text-slate-700">可选信息（用于CPC计算/独立站补充）</p>

                <div>
                  <Label htmlFor="brandNameOptional">品牌名（可选）</Label>
                  <Input
                    id="brandNameOptional"
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="如 kaspersky"
                    className="mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    若推广链接为独立站，系统会优先使用你填写的品牌名进行Google搜索，补充官方信息与广告元素
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="productPrice">
                      {linkType === 'store' ? '平均产品价格' : '产品价格'}
                    </Label>
                    <Input
                      id="productPrice"
                      type="text"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      placeholder="$99.99"
                      className="mt-1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{linkType === 'store' ? '平均佣金设置' : '佣金设置'}</Label>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <Select
                        value={commissionType}
                        onValueChange={(value) => {
                          if (value === 'percent' || value === 'amount') {
                            setCommissionType(value)
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="佣金类型" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percent">佣金比例 (%)</SelectItem>
                          <SelectItem value="amount">绝对佣金</SelectItem>
                        </SelectContent>
                      </Select>

                      <Input
                        id="commissionValue"
                        type="text"
                        value={commissionValue}
                        onChange={(e) => setCommissionValue(e.target.value)}
                        placeholder={commissionType === 'percent' ? '如 7.5（按%）' : '如 22.5'}
                      />

                      <Input
                        id="commissionCurrency"
                        type="text"
                        value={commissionCurrency}
                        onChange={(e) => setCommissionCurrency(e.target.value.toUpperCase())}
                        placeholder={commissionType === 'amount' ? '币种，如 USD（可选）' : 'percent模式无需币种'}
                        disabled={commissionType !== 'amount'}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      裸数字默认按佣金比例处理；仅当选择“绝对佣金”时按金额处理。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading || isExtracting}
              >
                取消
              </Button>
              <Button type="submit" disabled={loading || isExtracting}>
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    提取中...
                  </>
                ) : (
                  '下一步：自动提取'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ========== 步骤2: 自动提取中（任务队列 + SSE实时进度） ========== */}
        {currentStep === 'extracting' && (
          <div className="py-6">
            {/* 显示连接类型 */}
            {connectionType && (
              <div className="mb-2 text-xs text-gray-500 flex items-center gap-1">
                {connectionType === 'sse' ? '🔴 SSE实时推送' : '🔵 轮询模式'}
                {taskId && <span className="ml-2 font-mono text-[10px]">任务ID: {taskId.substring(0, 8)}...</span>}
              </div>
            )}
            <ProgressTracker
              currentStage={currentStage}
              currentStatus={currentStatus}
              currentMessage={currentMessage}
              events={[]} // V2不再提供详细events
              details={undefined} // V2不再提供details
              currentDuration={currentDuration} // 🔥 传递前端计算的当前阶段实时耗时
              stageDurations={stageDurations} // 🔥 传递已完成阶段的耗时Map
            />
          </div>
        )}

        {/* ========== 步骤3: 用户确认 ========== */}
        {currentStep === 'confirm' && extractedData && (
          <div className="space-y-4 py-4">
            {/* 成功提示 */}
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">自动提取成功！</p>
                <p className="text-xs mt-1">
                  经过 {extractedData.redirectCount} 次重定向，已成功解析Offer信息
                </p>
              </div>
            </div>

            {(extractedData.warnings && extractedData.warnings.length > 0) && (
              <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">需要确认的信息</p>
                  <ul className="list-disc list-inside text-xs space-y-0.5">
                    {extractedData.warnings.map((warning, idx) => (
                      <li key={`offer-warning-${idx}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {extractedData.supplementalSummary && extractedData.supplementalSummary.requested > 0 && (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded text-sm flex items-start gap-2">
                <Badge variant="outline" className="mt-0.5">店铺补充单品</Badge>
                <div className="text-xs">
                  已处理 {extractedData.supplementalSummary.requested} 个单品链接，成功 {extractedData.supplementalSummary.succeeded} 个，
                  失败 {extractedData.supplementalSummary.failed} 个。
                </div>
              </div>
            )}

            {/* 自动提取的数据展示 */}
            <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h4 className="font-semibold text-sm text-gray-900">自动提取的信息</h4>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Final URL:</span>
                  <a
                    href={extractedData.finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1 max-w-xs truncate"
                    title={extractedData.finalUrl}
                  >
                    {extractedData.finalUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">推广语言:</span>
                  <span className="font-mono text-gray-900">{extractedData.targetLanguage}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">解析方式:</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {extractedData.resolveMethod}
                  </Badge>
                </div>
              </div>
            </div>

            {/* 品牌名称（可修正） */}
            <div>
              <Label htmlFor="brandName">
                品牌名称 <span className="text-red-500">*</span>
                {extractedData.brand && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    AI自动识别
                  </Badge>
                )}
              </Label>
              <Input
                id="brandName"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="请输入或修正品牌名称"
                required
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">
                {extractedData.brand
                  ? '系统已自动识别品牌名称，请检查是否正确'
                  : '系统未能识别品牌名称，请手动输入'}
              </p>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleBack} disabled={loading}>
                返回修改
              </Button>
              <Button onClick={handleConfirm} disabled={loading || !extractedData?.offerId}>
                {extractedData?.offerId ? (
                  <>
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        保存中...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        查看Offer详情
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    创建中...
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

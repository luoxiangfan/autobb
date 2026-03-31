'use client'

/**
 * One-Click Ad Launch Page - 一键上广告
 *
 * 🔧 修复(2025-12-13): 调整流程顺序，先绑定账号再配置预算
 * 四步流程：
 * 1. 生成广告创意并评分
 * 2. 关联Google Ads账号（提前到第二步，获取货币信息）
 * 3. 配置广告系列参数（移到第三步，此时已知账号货币）
 * 4. 发布广告
 */

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Stepper, type Step } from '@/components/ui/stepper'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { showError } from '@/lib/toast-utils'
import Step1CreativeGeneration from './steps/Step1CreativeGeneration'
import Step3CampaignConfig from './steps/Step3CampaignConfig'
import Step2AccountLinking from './steps/Step2AccountLinking'
import Step4PublishSummary from './steps/Step4PublishSummary'

// 定义步骤 - 🔧 修复(2025-12-13): 调整顺序，先绑定账号再配置预算
const STEPS: Step[] = [
  { id: 1, label: '生成创意', description: 'AI生成广告创意' },
  { id: 2, label: '关联账号', description: '绑定Google Ads' },
  { id: 3, label: '配置广告', description: '设置广告系列参数' },
  { id: 4, label: '发布上线', description: '确认并发布' }
]

/**
 * 🔧 修复(2025-12-11): 统一使用 camelCase 与 API 响应匹配
 */
interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  offerName: string | null
  targetCountry: string
  targetLanguage: string | null
  scrapeStatus: string
  enhancedData?: any
}

interface SelectedCreative {
  id: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  finalUrl: string
  finalUrlSuffix?: string
  score: number
  scoreBreakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  theme: string
}

interface CampaignConfig {
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  targetCountry: string
  targetLanguage: string
  biddingStrategy: string
  finalUrlSuffix: string
  adGroupName: string
  maxCpcBid: number
  keywords: string[]
  negativeKeywords: string[]
  negativeKeywordMatchType?: Record<string, 'EXACT' | 'PHRASE' | 'BROAD'>
  negativeKeywordsMatchType?: Record<string, 'EXACT' | 'PHRASE' | 'BROAD'>
}

interface GoogleAdsAccount {
  id: number
  customerId: string
  accountName?: string
  isActive: boolean
  currencyCode?: string  // 🔧 修复(2025-12-13): 新增货币代码字段
  status?: string
}

export default function LaunchAdPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = parseInt((params?.id as string) || '0')

  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [offer, setOffer] = useState<Offer | null>(null)

  // Step data
  const [selectedCreative, setSelectedCreative] = useState<SelectedCreative | null>(null)
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig | null>(null)
  const [selectedAccounts, setSelectedAccounts] = useState<GoogleAdsAccount[]>([])

  // Navigation state
  const [canProceed, setCanProceed] = useState(false)

  useEffect(() => {
    fetchOffer()
  }, [offerId])

  const fetchOffer = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('获取Offer失败')
      }

      const data = await response.json()

      // 检查抓取状态 - 🔧 修复(2025-12-11): 使用camelCase
      if (data.offer.scrapeStatus !== 'completed') {
        showError('无法生成广告', '请先完成网页抓取后再生成广告创意')
        router.push('/offers')
        return
      }

      setOffer(data.offer)
    } catch (error: any) {
      showError('加载失败', error.message)
      router.push('/offers')
    } finally {
      setLoading(false)
    }
  }

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1)
      setCanProceed(false)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      // Re-enable proceed for previous step
      setCanProceed(true)
    }
  }

  // 🔥 新增：返回第3步（用于发布失败时的"返回修改"）
  const handleGoBackToStep3 = () => {
    setCurrentStep(3)
    setCanProceed(true)  // 重新启用下一步，因为用户在第3步可以配置广告
  }

  const handleCreativeSelected = (creative: SelectedCreative) => {
    setSelectedCreative(creative)
    setCanProceed(true)
  }

  const handleCampaignConfigured = (config: CampaignConfig) => {
    setCampaignConfig(config)
    setCanProceed(true)
  }

  const handleAccountsLinked = (accounts: GoogleAdsAccount[]) => {
    setSelectedAccounts(accounts)
    setCanProceed(accounts.length > 0)
  }

  const primarySelectedAccount = selectedAccounts.length > 0 ? selectedAccounts[0] : null

  const handlePublishComplete = () => {
    // 🔥 修复(2025-12-18): 发布成功后不跳转，就留在发布页面
    // 而不是跳转到 /offers/${offerId}
    // 用户可以通过顶部的"返回Offers"按钮或其他方式离开此页面
    console.log('[LaunchAdPage] 发布成功！用户留在发布页面')
  }

  if (loading || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/offers')}
                className="-ml-2 text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回Offers
              </Button>
              <div className="h-6 w-px bg-gray-200 mx-2" />
              <div>
                <h1 className="text-lg font-bold text-gray-900">一键上广告</h1>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  {offer.offerName || offer.brand}
                  <span className="w-1 h-1 rounded-full bg-gray-300" />
                  {offer.targetCountry}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto w-full py-8 px-4 sm:px-6 lg:px-8 pb-24">
        {/* Stepper */}
        <div className="mb-6">
          <div className="py-4">
            <Stepper steps={STEPS} currentStep={currentStep} />
          </div>
        </div>

        {/* Step Content - 🔧 修复(2025-12-13): 调整顺序，Step2和Step3互换 */}
        <div className="mb-6 min-h-[400px]">
          {currentStep === 1 && (
            <Step1CreativeGeneration
              offer={offer}
              onCreativeSelected={handleCreativeSelected}
              selectedCreative={selectedCreative}
            />
          )}

          {currentStep === 2 && (
            <Step2AccountLinking
              offer={offer}
              onAccountsLinked={handleAccountsLinked}
              selectedAccounts={selectedAccounts}
            />
          )}

          {currentStep === 3 && (
            <Step3CampaignConfig
              offer={offer}
              selectedCreative={selectedCreative!}
              selectedAccount={primarySelectedAccount!}
              onConfigured={handleCampaignConfigured}
              initialConfig={campaignConfig}
            />
          )}

          {currentStep === 4 && (
            <Step4PublishSummary
              offer={offer}
              selectedCreative={selectedCreative!}
              campaignConfig={campaignConfig!}
              selectedAccount={primarySelectedAccount!}
              selectedAccounts={selectedAccounts}
              onPublishComplete={handlePublishComplete}
              onGoBackToStep3={handleGoBackToStep3}  // 🔥 新增：传递返回第3步的回调
            />
          )}
        </div>
      </main>

      {/* Sticky Navigation Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 z-20 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-center items-center">
          <div className="flex items-center gap-4">
            {currentStep > 1 ? (
              <Button
                variant="outline"
                onClick={handleBack}
                className="min-w-[100px]"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                上一步
              </Button>
            ) : (
              <div className="min-w-[100px]" />
            )}

            <div className="text-sm text-gray-500 min-w-[80px] text-center">
              步骤 {currentStep} / {STEPS.length}
            </div>

            {currentStep < 4 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed}
                className="min-w-[120px] shadow-md shadow-blue-500/20"
              >
                下一步
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <div className="min-w-[120px]" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

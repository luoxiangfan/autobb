'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getLanguageNameForCountry, getCountryOptionsForUI } from '@/lib/language-country-codes'
import { normalizeOfferCommissionInput, parseCommissionPayoutValue } from '@/lib/offer-monetization'

export default function EditOfferPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = params?.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 表单状态
  const [url, setUrl] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [targetCountry, setTargetCountry] = useState('US')
  const [affiliateLink, setAffiliateLink] = useState('')
  const [linkType, setLinkType] = useState<'product' | 'store'>('product')
  const [storeProductLinks, setStoreProductLinks] = useState<string[]>([''])
  const [finalUrl, setFinalUrl] = useState('')
  const [finalUrlSuffix, setFinalUrlSuffix] = useState('')
  const [brandDescription, setBrandDescription] = useState('')
  const [uniqueSellingPoints, setUniqueSellingPoints] = useState('')
  const [productHighlights, setProductHighlights] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [commissionType, setCommissionType] = useState<'percent' | 'amount'>('percent')
  const [commissionValue, setCommissionValue] = useState('')
  const [commissionCurrency, setCommissionCurrency] = useState('')
  const [offerNameSequence, setOfferNameSequence] = useState('01')

  // 加载Offer数据
  useEffect(() => {
    const fetchOffer = async () => {
      try {
        const response = await fetch(`/api/offers/${offerId}`, {
          credentials: 'include',
        })

        if (!response.ok) {
          throw new Error('加载Offer失败')
        }

        const data = await response.json()
        const offer = data.offer

        // 填充表单 - 🔧 修复(2025-12-11): 使用camelCase匹配API返回的字段名
        setUrl(offer.url || '')
        setLinkType((offer.pageType === 'store' || offer.pageType === 'product') ? offer.pageType : 'product')
        setFinalUrl(offer.finalUrl || '')
        setFinalUrlSuffix(offer.finalUrlSuffix || '')
        setBrand(offer.brand || '')
        setCategory(offer.category || '')
        setTargetCountry(offer.targetCountry || 'US')
        setAffiliateLink(offer.affiliateLink || '')
        const normalizedStoreLinks = Array.isArray(offer.storeProductLinks)
          ? offer.storeProductLinks.map((link: string) => link.trim()).filter((link: string) => Boolean(link))
          : []
        setStoreProductLinks(normalizedStoreLinks.length > 0 ? normalizedStoreLinks : [''])
        setBrandDescription(offer.brandDescription || '')
        setUniqueSellingPoints(offer.uniqueSellingPoints || '')
        setProductHighlights(offer.productHighlights || '')
        setTargetAudience(offer.targetAudience || '')
        setProductPrice(offer.productPrice || '')
        if (offer.commissionType && offer.commissionValue) {
          setCommissionType(offer.commissionType)
          setCommissionValue(offer.commissionValue)
          setCommissionCurrency(offer.commissionCurrency || '')
        } else if (offer.commissionPayout) {
          const parsed = parseCommissionPayoutValue(offer.commissionPayout, {
            targetCountry: offer.targetCountry || 'US',
          })
          if (parsed?.mode === 'amount') {
            setCommissionType('amount')
            setCommissionValue(String(parsed.amount))
            setCommissionCurrency(parsed.currency)
          } else if (parsed?.mode === 'percent') {
            setCommissionType('percent')
            setCommissionValue(String(parsed.displayRate))
            setCommissionCurrency('')
          } else {
            setCommissionType('percent')
            setCommissionValue('')
            setCommissionCurrency('')
          }
        } else {
          setCommissionType('percent')
          setCommissionValue('')
          setCommissionCurrency('')
        }
        if (typeof offer.offerName === 'string' && offer.offerName.trim()) {
          const parts = offer.offerName.split('_')
          const sequence = parts.length >= 3 ? (parts[parts.length - 1] || '01') : '01'
          setOfferNameSequence(sequence)
        }
      } catch (err: any) {
        setError(err.message || '加载Offer失败')
      } finally {
        setLoading(false)
      }
    }

    fetchOffer()
  }, [offerId])

  // 国家到语言的映射（使用全局统一映射，支持80+国家）
  const getTargetLanguage = (countryCode: string): string => {
    return getLanguageNameForCountry(countryCode)
  }

  // 自动生成Offer预览名称
  const offerNamePreview = useMemo(() => {
    if (!brand.trim() || !targetCountry) return '请先填写品牌名称和国家'
    return `${brand.trim()}_${targetCountry}_${offerNameSequence}`
  }, [brand, targetCountry, offerNameSequence])

  // 自动推导推广语言
  const targetLanguagePreview = useMemo(() => {
    return getTargetLanguage(targetCountry)
  }, [targetCountry])

  const commissionNormalization = useMemo(() => {
    const normalizedValue = commissionValue.trim()
    const normalizedCurrency = commissionCurrency.trim().toUpperCase()
    if (!normalizedValue) {
      return {
        normalized: null as ReturnType<typeof normalizeOfferCommissionInput> | null,
        error: null as string | null,
      }
    }

    try {
      const normalized = normalizeOfferCommissionInput({
        targetCountry,
        commissionType,
        commissionValue: normalizedValue,
        commissionCurrency: commissionType === 'amount'
          ? (normalizedCurrency || undefined)
          : undefined,
      })
      return {
        normalized,
        error: null as string | null,
      }
    } catch (err: any) {
      return {
        normalized: null as ReturnType<typeof normalizeOfferCommissionInput> | null,
        error: err?.message || '佣金参数格式错误',
      }
    }
  }, [commissionValue, commissionCurrency, commissionType, targetCountry])

  const suggestedCpcHint = useMemo(() => {
    if (commissionNormalization.error || !commissionNormalization.normalized?.commissionType) {
      return null
    }

    if (commissionNormalization.normalized.commissionType === 'amount') {
      return {
        formula: '绝对佣金 ÷ 50',
        detail: '示例：$22.5 ÷ 50 = $0.45（假设50个点击出一单）',
      }
    }

    return {
      formula: '产品价格 × 佣金比例 ÷ 50',
      detail: '示例：$699.00 × 7.5% ÷ 50 = $1.05（假设50个点击出一单）',
    }
  }, [commissionNormalization])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      let uniqueLinks: string[] = []
      if (linkType === 'store') {
        const normalizedLinks = storeProductLinks
          .map((link) => link.trim())
          .filter((link) => Boolean(link))
        uniqueLinks = Array.from(new Set(normalizedLinks)).slice(0, 3)
        for (const link of uniqueLinks) {
          try {
            // eslint-disable-next-line no-new
            new URL(link)
          } catch {
            throw new Error(`单品推广链接无效: ${link}`)
          }
        }
      }

      const normalizedCommissionValue = commissionValue.trim()
      const normalizedCommissionCurrency = commissionCurrency.trim().toUpperCase()
      const normalizedCommission = normalizedCommissionValue
        ? normalizeOfferCommissionInput({
          targetCountry,
          commissionType,
          commissionValue: normalizedCommissionValue,
          commissionCurrency: commissionType === 'amount'
            ? (normalizedCommissionCurrency || undefined)
            : undefined,
        })
        : null

      const response = await fetch(`/api/offers/${offerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          url,
          brand,
          category: category || undefined,
          target_country: targetCountry,
          affiliate_link: affiliateLink || undefined,
          page_type: linkType,
          store_product_links: linkType === 'store' ? uniqueLinks : undefined,
          brand_description: brandDescription || undefined,
          unique_selling_points: uniqueSellingPoints || undefined,
          product_highlights: productHighlights || undefined,
          target_audience: targetAudience || undefined,
          product_price: productPrice || undefined,
          commission_payout: normalizedCommission?.commissionPayout || undefined,
          commission_type: normalizedCommission?.commissionType || undefined,
          commission_value: normalizedCommission?.commissionValue || undefined,
          commission_currency: normalizedCommission?.commissionCurrency || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '更新Offer失败')
      }

      // 跳转回Offer详情页
      router.push(`/offers/${offerId}`)
    } catch (err: any) {
      setError(err.message || '更新Offer失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  // 使用全局统一的国家列表（支持69个国家）
  const countries = getCountryOptionsForUI()

  const updateStoreProductLink = (index: number, value: string) => {
    setStoreProductLinks((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const addStoreProductLink = () => {
    setStoreProductLinks((prev) => (prev.length >= 3 ? prev : [...prev, '']))
  }

  const removeStoreProductLink = (index: number) => {
    setStoreProductLinks((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : ['']
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href={`/offers/${offerId}`} className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回详情
              </a>
              <h1 className="text-xl font-bold text-gray-900">编辑Offer</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="bg-white shadow rounded-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 基础信息 */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">基础信息</h3>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="linkType" className="block text-sm font-medium text-gray-700">
                      链接类型 *
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([
                        { value: 'product', label: '单品' },
                        { value: 'store', label: '店铺' },
                      ] as const).map((option) => (
                        <label
                          key={option.value}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                            linkType === option.value
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
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
                    <p className="mt-1 text-sm text-gray-500">店铺类型可选填写单品推广链接（最多3个）</p>
                  </div>

                  <div>
                    <label htmlFor="url" className="block text-sm font-medium text-gray-700">
                      原始URL（商品/店铺） *
                    </label>
                    <input
                      type="url"
                      id="url"
                      required
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="https://www.amazon.com/stores/page/..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      这是您保存的商品/店铺URL，广告投放将优先使用解析出的Final URL
                    </p>
                    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="text-xs text-gray-500">Final URL（解析结果）</div>
                      <div className={`mt-1 text-sm break-all ${finalUrl ? 'text-gray-900' : 'text-gray-400'}`}>
                        {finalUrl || '未提取'}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">Final URL Suffix</div>
                      <div className={`mt-1 text-sm break-all font-mono ${finalUrlSuffix ? 'text-gray-900' : 'text-gray-400'}`}>
                        {finalUrlSuffix || '未提取'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="brand" className="block text-sm font-medium text-gray-700">
                      品牌名称 *
                    </label>
                    <input
                      type="text"
                      id="brand"
                      required
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Reolink"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                        产品分类
                      </label>
                      <input
                        type="text"
                        id="category"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        placeholder="安防监控"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      />
                    </div>

                    <div>
                      <label htmlFor="targetCountry" className="block text-sm font-medium text-gray-700">
                        目标国家 *
                      </label>
                      <select
                        id="targetCountry"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        value={targetCountry}
                        onChange={(e) => setTargetCountry(e.target.value)}
                      >
                        {countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="affiliateLink" className="block text-sm font-medium text-gray-700">
                      {linkType === 'store' ? '店铺推广链接' : '联盟推广链接'}
                    </label>
                    <input
                      type="url"
                      id="affiliateLink"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="https://pboost.me/UKTs4I6"
                      value={affiliateLink}
                      onChange={(e) => setAffiliateLink(e.target.value)}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      {linkType === 'store'
                        ? '店铺类型建议填写推广链接用于追踪'
                        : '如果有联盟链接，可以在这里填写（可选）'}
                    </p>
                  </div>

                  {linkType === 'store' && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">
                        单品推广链接（最多3个）
                      </label>
                      <div className="space-y-2">
                        {storeProductLinks.map((link, idx) => (
                          <div key={`store-product-link-${idx}`} className="flex items-center gap-2">
                            <input
                              type="url"
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              placeholder={`单品推广链接 ${idx + 1}`}
                              value={link}
                              onChange={(e) => updateStoreProductLink(idx, e.target.value)}
                            />
                            <button
                              type="button"
                              className="mt-1 inline-flex items-center whitespace-nowrap shrink-0 px-2 py-1 text-sm border border-red-200 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50"
                              onClick={() => removeStoreProductLink(idx)}
                              disabled={storeProductLinks.length === 1}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="text-sm text-indigo-600 hover:text-indigo-500"
                        onClick={addStoreProductLink}
                        disabled={storeProductLinks.length >= 3}
                      >
                        + 添加单品链接
                      </button>
                      <p className="text-xs text-gray-500">仅用于补充单品数据，最多3个</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 定价信息 */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  定价信息
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （可选，用于计算建议CPC）
                  </span>
                </h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="productPrice" className="block text-sm font-medium text-gray-700">
                      产品价格 (Product Price)
                    </label>
                    <input
                      type="text"
                      id="productPrice"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="$699.00 或 ¥5999.00"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      产品的售价，包含货币符号
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="commissionType" className="block text-sm font-medium text-gray-700">
                      佣金设置
                    </label>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <select
                        id="commissionType"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        value={commissionType}
                        onChange={(e) => setCommissionType(e.target.value as 'percent' | 'amount')}
                      >
                        <option value="percent">佣金比例 (%)</option>
                        <option value="amount">绝对佣金</option>
                      </select>
                      <input
                        type="text"
                        id="commissionValue"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        placeholder={commissionType === 'percent' ? '如 7.5（按%）' : '如 22.5'}
                        value={commissionValue}
                        onChange={(e) => setCommissionValue(e.target.value)}
                      />
                      <input
                        type="text"
                        id="commissionCurrency"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-400"
                        placeholder={commissionType === 'amount' ? '币种，如 USD（可选）' : 'percent模式无需币种'}
                        value={commissionCurrency}
                        onChange={(e) => setCommissionCurrency(e.target.value.toUpperCase())}
                        disabled={commissionType !== 'amount'}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      与 OpenClaw 佣金规则一致：佣金比例保存为
                      <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5">x%</code>
                      ，绝对佣金保存为
                      <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5">货币+金额</code>
                    </p>
                    {commissionNormalization.error && (
                      <p className="mt-1 text-xs text-red-600">{commissionNormalization.error}</p>
                    )}
                    {!commissionNormalization.error && commissionNormalization.normalized?.commissionPayout && (
                      <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        <div className="font-medium">发送给 OpenClaw / Offer API 的佣金字段</div>
                        <div className="mt-1 font-mono break-all">
                          commission_payout={commissionNormalization.normalized.commissionPayout}
                          , commission_type={commissionNormalization.normalized.commissionType}
                          , commission_value={commissionNormalization.normalized.commissionValue}
                          {commissionNormalization.normalized.commissionCurrency
                            ? `, commission_currency=${commissionNormalization.normalized.commissionCurrency}`
                            : ''}
                        </div>
                      </div>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      OpenClaw 侧规则：<code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5">commission_payout</code>
                      带 <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5">%</code> 视为比例，不带则视为金额。
                    </p>
                  </div>
                </div>

                {suggestedCpcHint && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-sm text-blue-800">
                      <strong>💡 建议CPC</strong>: 在"一键上广告"流程中，系统将根据
                      <code className="mx-1 px-1.5 py-0.5 bg-blue-100 rounded">{suggestedCpcHint.formula}</code>
                      公式计算建议的CPC出价
                    </p>
                    <p className="mt-1 text-xs text-blue-600">
                      {suggestedCpcHint.detail}
                    </p>
                  </div>
                )}
              </div>

              {/* 自动生成信息 */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  自动生成信息
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （系统自动生成，无需手动输入）
                  </span>
                </h3>

                <div className="space-y-4 bg-gray-50 p-4 rounded-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Offer标识 (Offer Name)
                    </label>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-gray-900 font-mono">
                        {offerNamePreview}
                      </div>
                      <span className="text-xs text-gray-500">自动生成</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      格式：[品牌名称]_[推广国家]_[序号]，用于唯一标识此Offer
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      推广语言 (Target Language)
                    </label>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-gray-900">
                        {targetLanguagePreview}
                      </div>
                      <span className="text-xs text-gray-500">根据国家自动映射</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      广告文案将使用此语言生成，确保符合目标市场
                    </p>
                  </div>

                  {/* 验证提示 */}
                  {brand && brand.length > 25 && (
                    <div className="flex items-start space-x-2 text-sm text-red-600">
                      <svg className="w-5 h-5 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span>品牌名称过长（当前{brand.length}字符，最多25字符），请缩短</span>
                    </div>
                  )}

                  {brand && targetCountry && brand.length <= 25 && (
                    <div className="flex items-start space-x-2 text-sm text-green-600">
                      <svg className="w-5 h-5 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>将自动生成Offer标识：{offerNamePreview}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 产品描述 */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  产品描述
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （可选）
                  </span>
                </h3>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="brandDescription" className="block text-sm font-medium text-gray-700">
                      品牌描述
                    </label>
                    <textarea
                      id="brandDescription"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="品牌的整体介绍和定位..."
                      value={brandDescription}
                      onChange={(e) => setBrandDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="uniqueSellingPoints" className="block text-sm font-medium text-gray-700">
                      独特卖点
                    </label>
                    <textarea
                      id="uniqueSellingPoints"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="产品的核心优势和差异化特点..."
                      value={uniqueSellingPoints}
                      onChange={(e) => setUniqueSellingPoints(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="productHighlights" className="block text-sm font-medium text-gray-700">
                      产品亮点
                    </label>
                    <textarea
                      id="productHighlights"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="关键功能和特性..."
                      value={productHighlights}
                      onChange={(e) => setProductHighlights(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="targetAudience" className="block text-sm font-medium text-gray-700">
                      目标受众
                    </label>
                    <textarea
                      id="targetAudience"
                      rows={2}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="目标客户群体特征..."
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* 提交按钮 */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => router.push(`/offers/${offerId}`)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}

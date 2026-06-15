'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  Info,
  ExternalLink,
  Shield,
  Zap,
  Globe,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Key,
  CheckCircle2,
  AlertCircle,
  BookOpen,
} from 'lucide-react'
import { getCountryOptionsForUI } from '@/lib/common'
import {
  GEMINI_ACTIVE_MODEL,
  RELAY_GPT_52_MODEL,
  isModelSupportedByProvider,
  normalizeModelForProvider,
} from '@/lib/ai'
import { getGeminiEndpoint, type GeminiProvider } from '@/lib/ai'
import {
  DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
  DEFAULT_PARTNERBOOST_BASE_URL,
  getFixedAffiliateSyncSettingValue,
} from '@/lib/affiliate'
import {
  GOOGLE_ADS_CATEGORY_FIELDS,
  GOOGLE_ADS_SETTING_METADATA,
  GoogleAdsAuthSettingsActions,
  GoogleAdsAuthSettingsSection,
  GoogleAdsDeleteConfirmDialog,
  formatGoogleAdsAuthSaveError,
  useGoogleAdsAuthSettings,
  validateGoogleAdsOAuthFormForSave,
} from './google-ads'

// 代理URL配置项接口
interface ProxyUrlConfig {
  country: string
  url: string
  error?: string // 验证错误信息
}

// 简单的客户端代理URL格式验证
function validateProxyUrlFormat(url: string): { isValid: boolean; error?: string } {
  if (!url.trim()) {
    return { isValid: true } // 空值在保存时处理
  }

  // IPRocket 格式
  if (url.includes('api.iprocket.io')) {
    return { isValid: true }
  }

  // Oxylabs 格式 (https://username:password@pr.oxylabs.io:port)
  if (url.includes('pr.oxylabs.io')) {
    return { isValid: true }
  }

  // Kookeey 格式 (host:port:username:password 或 http(s)://host:port:username:password)
  if (/^(https?:\/\/)?[a-zA-Z0-9.-]*kookeey\.info:\d+:[^:]+:[^:]+$/.test(url)) {
    return { isValid: true }
  }

  // Cliproxy 格式 (host:port:username:password 或 http(s)://host:port:username:password)
  if (/^(https?:\/\/)?[a-zA-Z0-9.-]*cliproxy\.io:\d+:[^:]+:[^:]+$/.test(url)) {
    return { isValid: true }
  }

  return {
    isValid: false,
    error: '不支持的代理URL格式。当前仅支持：IPRocket、Oxylabs、Kookeey、Cliproxy',
  }
}

// 代理配置支持的国家列表（使用全局映射 + ROW其他地区选项）
const SUPPORTED_COUNTRIES = [
  ...getCountryOptionsForUI(),
  { code: 'ROW', name: '其他地区 (ROW)' }, // 代理配置专用的"其他地区"选项
]

interface Setting {
  key: string
  value: string | null
  dataType: string
  isSensitive: boolean
  isRequired: boolean
  validationStatus?: string | null
  validationMessage?: string | null
  description?: string | null
}

interface SettingsGroup {
  [key: string]: Setting[]
}

function resolveGeminiEndpoint(providerValue?: string, modelValue?: string): string {
  const provider = (providerValue || 'official') as GeminiProvider
  const normalizedModel = normalizeModelForProvider(modelValue || GEMINI_ACTIVE_MODEL, provider)
  return getGeminiEndpoint(provider, normalizedModel)
}

// 设置项的详细说明和配置
const SETTING_METADATA: Record<
  string,
  {
    label: string
    description: string
    placeholder?: string
    helpLink?: string
    options?: { value: string; label: string }[]
    defaultValue?: string
  }
> = {
  ...GOOGLE_ADS_SETTING_METADATA,

  // AI - Gemini 服务商选择
  'ai.gemini_provider': {
    label: '服务商',
    description: '第1步：先选择服务商。官方适合海外网络；第三方中转适合国内网络',
    options: [
      { value: 'official', label: '🌐 Gemini 官方' },
      { value: 'relay', label: '⚡ 第三方中转' },
    ],
    defaultValue: 'official',
  },
  // AI - Gemini API端点（只读）
  'ai.gemini_endpoint': {
    label: 'API端点',
    description: '根据当前服务商 + AI模型自动计算，不可手动修改',
    placeholder: '系统自动设置',
  },
  // AI - Gemini API配置
  'ai.gemini_api_key': {
    label: 'Gemini 官方 API Key',
    description: 'Google Gemini 官方 API 密钥，用于 AI 创意生成',
    placeholder: '输入官方 API Key',
    helpLink: 'https://aistudio.google.com/app/api-keys',
  },
  'ai.gemini_relay_api_key': {
    label: '第三方中转 API Key',
    description: '第三方中转服务 API 密钥，适合国内用户访问',
    placeholder: '输入中转服务 API Key',
    helpLink: 'https://aicode.cat/register?ref=T6S73C2U',
  },
  'ai.gemini_model': {
    label: 'AI模型',
    description: '第2步：服务商确定后，再选择该服务商支持的模型',
    options: [
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（最新，高效）' },
      { value: RELAY_GPT_52_MODEL, label: 'GPT-5.2（第三方中转专用）' },
    ],
    defaultValue: GEMINI_ACTIVE_MODEL,
  },

  // Proxy - 新的多URL配置
  'proxy.urls': {
    label: '代理URL配置',
    description: '配置不同国家的代理URL，第一个URL将作为未配置国家的默认兜底值',
    placeholder: '输入代理URL（例如：https://api.iprocket.io/api?username=...）',
  },

  // Affiliate Sync
  'affiliate_sync.yeahpromos_token': {
    label: 'YeahPromos Token',
    description: '用于拉取 YeahPromos 联盟商品与佣金数据',
    placeholder: '输入 YeahPromos Token',
  },
  'affiliate_sync.yeahpromos_site_id': {
    label: 'YeahPromos Site ID',
    description: 'YeahPromos 站点标识，与 Token 配对使用',
    placeholder: '输入 Site ID',
  },
  'affiliate_sync.partnerboost_token': {
    label: 'PartnerBoost Token',
    description: '用于拉取 PartnerBoost 联盟商品与佣金数据',
    placeholder: '输入 PartnerBoost Token',
  },
  'affiliate_sync.partnerboost_base_url': {
    label: 'PartnerBoost Base URL',
    description: 'PartnerBoost API 地址，系统固定使用默认值，不支持修改',
    placeholder: DEFAULT_PARTNERBOOST_BASE_URL,
    defaultValue: DEFAULT_PARTNERBOOST_BASE_URL,
  },
  'affiliate_sync.openclaw_affiliate_sync_interval_hours': {
    label: '佣金同步间隔（小时）',
    description: '联盟佣金同步已固定为默认间隔，当前不支持修改',
    placeholder: DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
    defaultValue: DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
  },
  'affiliate_sync.openclaw_affiliate_sync_mode': {
    label: '佣金同步模式',
    description: 'incremental 使用快照缓存；realtime 优先实时刷新佣金数据',
    options: [
      { value: 'incremental', label: 'incremental（快照缓存，推荐）' },
      { value: 'realtime', label: 'realtime（飞书查询优先实时）' },
    ],
    defaultValue: 'incremental',
  },

  // System
  'system.currency': {
    label: '默认货币',
    description: '系统中显示金额的默认货币单位',
    options: [
      { value: 'CNY', label: '人民币 (CNY)' },
      { value: 'USD', label: '美元 (USD)' },
      { value: 'EUR', label: '欧元 (EUR)' },
      { value: 'JPY', label: '日元 (JPY)' },
    ],
    defaultValue: 'CNY',
  },
  'system.language': {
    label: '系统语言',
    description: '界面显示的语言',
    options: [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'en-US', label: 'English' },
    ],
    defaultValue: 'zh-CN',
  },
  'system.link_check_enabled': {
    label: '启用链接检查',
    description: '是否每日自动检查Offer链接的有效性',
    options: [
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' },
    ],
    defaultValue: 'true',
  },
  'system.link_check_time': {
    label: '链接检查时间',
    description: '每日链接检查的执行时间（24小时制）',
    placeholder: '例如: 02:00',
    defaultValue: '02:00',
  },
  'system.data_sync_enabled': {
    label: '启用广告数据自动同步',
    description: '是否自动从Google Ads同步广告投放数据（展示、点击、转化等）',
    options: [
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' },
    ],
    defaultValue: 'true',
  },
  'system.data_sync_interval_hours': {
    label: '数据同步间隔（小时）',
    description: '自动同步的时间间隔，默认4小时，建议4-24小时',
    placeholder: '例如: 4',
    defaultValue: '4',
  },
  'system.data_sync_mode': {
    label: '默认同步模式',
    description: '手动触发同步时使用的默认模式',
    options: [
      { value: 'incremental', label: '快速刷新（仅今天）' },
      { value: 'full', label: '全量补齐（过去7天）' },
    ],
    defaultValue: 'incremental',
  },
}

// 定义每个分类包含的字段及其属性
// 这确保即使数据库中没有数据，前端仍能显示所有配置字段
const CATEGORY_FIELDS: Record<
  string,
  {
    key: string
    dataType: string
    isSensitive: boolean
    isRequired: boolean
  }[]
> = {
  google_ads: GOOGLE_ADS_CATEGORY_FIELDS,
  ai: [
    { key: 'gemini_provider', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gemini_model', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gemini_endpoint', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'gemini_api_key', dataType: 'string', isSensitive: true, isRequired: false },
    { key: 'gemini_relay_api_key', dataType: 'string', isSensitive: true, isRequired: false },
  ],
  proxy: [{ key: 'urls', dataType: 'json', isSensitive: false, isRequired: false }],
  affiliate_sync: [
    { key: 'yeahpromos_token', dataType: 'string', isSensitive: true, isRequired: false },
    { key: 'yeahpromos_site_id', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'partnerboost_token', dataType: 'string', isSensitive: true, isRequired: false },
    { key: 'partnerboost_base_url', dataType: 'string', isSensitive: false, isRequired: false },
    {
      key: 'openclaw_affiliate_sync_interval_hours',
      dataType: 'number',
      isSensitive: false,
      isRequired: false,
    },
    {
      key: 'openclaw_affiliate_sync_mode',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
    },
  ],
  system: [
    { key: 'currency', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'language', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'link_check_enabled', dataType: 'boolean', isSensitive: false, isRequired: false },
    { key: 'link_check_time', dataType: 'string', isSensitive: false, isRequired: false },
    { key: 'data_sync_enabled', dataType: 'boolean', isSensitive: false, isRequired: false },
    { key: 'data_sync_interval_hours', dataType: 'number', isSensitive: false, isRequired: false },
    { key: 'data_sync_mode', dataType: 'string', isSensitive: false, isRequired: false },
  ],
}

const AFFILIATE_SYNC_DELETABLE_KEYS = [
  'yeahpromos_token',
  'yeahpromos_site_id',
  'partnerboost_token',
  'partnerboost_base_url',
  'openclaw_affiliate_sync_interval_hours',
  'openclaw_affiliate_sync_mode',
] as const

// 合并后端数据和前端定义的字段，确保所有字段都能显示
const getMergedCategorySettings = (category: string, backendSettings: Setting[]): Setting[] => {
  const definedFields = CATEGORY_FIELDS[category] || []
  const backendMap = new Map(backendSettings.map((s) => [s.key, s]))

  return definedFields.map((field) => {
    const backendSetting = backendMap.get(field.key)
    return {
      key: field.key,
      value: backendSetting?.value || null,
      dataType: field.dataType,
      isSensitive: field.isSensitive,
      isRequired: field.isRequired,
      validationStatus: backendSetting?.validationStatus || null,
      validationMessage: backendSetting?.validationMessage || null,
      description: backendSetting?.description || null,
    }
  })
}

// 分类配置
const CATEGORY_CONFIG: Record<
  string,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    description: string
    color: string
  }
> = {
  google_ads: {
    label: 'Google Ads API',
    icon: Shield,
    description: '配置Google Ads API凭证，用于广告系列管理和数据同步',
    color: 'text-blue-600',
  },
  ai: {
    label: 'AI引擎',
    icon: Zap,
    description: '配置AI模型API密钥，用于智能创意生成',
    color: 'text-purple-600',
  },
  proxy: {
    label: '代理设置',
    icon: Globe,
    description: '配置网络代理，解决API访问受限问题',
    color: 'text-green-600',
  },
  affiliate_sync: {
    label: '联盟同步',
    icon: Key,
    description: '配置联盟平台凭证与佣金同步策略',
    color: 'text-amber-600',
  },
  system: {
    label: '系统设置',
    icon: SettingsIcon,
    description: '系统基础配置和自动化任务设置',
    color: 'text-slate-600',
  },
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<SettingsGroup>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState<string | null>(null)
  const [deletingAIConfig, setDeletingAIConfig] = useState(false)
  const [deletingAffiliateSyncConfig, setDeletingAffiliateSyncConfig] = useState(false)
  const [aiDeleteConfirmTarget, setAiDeleteConfirmTarget] = useState<
    'gemini-official' | 'gemini-relay' | null
  >(null)
  const [affiliateSyncDeleteConfirmOpen, setAffiliateSyncDeleteConfirmOpen] = useState(false)

  // 表单状态
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})
  const [savedFormData, setSavedFormData] = useState<Record<string, Record<string, string>>>({})

  // 正在编辑的敏感字段（用于控制显示真实值还是固定占位符）
  const [editingField, setEditingField] = useState<string | null>(null)

  // 代理URL配置状态
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig[]>([])
  const [savedProxyUrls, setSavedProxyUrls] = useState<ProxyUrlConfig[]>([])

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = useCallback(() => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }, [router])

  const buildCategoryFormValues = (
    category: string,
    backendSettings: Setting[]
  ): Record<string, string> => {
    const categoryFormValues: Record<string, string> = {}
    const backendMap = new Map<string, Setting>(backendSettings.map((s: Setting) => [s.key, s]))

    const definedFields = CATEGORY_FIELDS[category] || []
    for (const field of definedFields) {
      const metaKey = `${category}.${field.key}`
      const metadata = SETTING_METADATA[metaKey]
      const backendSetting = backendMap.get(field.key)
      categoryFormValues[field.key] = backendSetting?.value || metadata?.defaultValue || ''
    }

    if (category === 'ai') {
      const provider = categoryFormValues.gemini_provider || 'official'
      const currentModel = categoryFormValues.gemini_model || GEMINI_ACTIVE_MODEL
      const normalizedModel = normalizeModelForProvider(currentModel, provider)
      categoryFormValues.gemini_model = normalizedModel
      categoryFormValues.gemini_endpoint = resolveGeminiEndpoint(provider, normalizedModel)
    }

    return categoryFormValues
  }

  const applyCategorySettings = (category: string, backendSettings: Setting[]) => {
    setSettings((prev) => ({
      ...prev,
      [category]: backendSettings,
    }))

    if (category === 'proxy') {
      const proxySetting = backendSettings.find((item) => item.key === 'urls')
      try {
        const urls = proxySetting?.value ? JSON.parse(proxySetting.value) : []
        const normalizedUrls = Array.isArray(urls) ? urls : []
        setProxyUrls(normalizedUrls)
        setSavedProxyUrls(normalizedUrls)
      } catch {
        setProxyUrls([])
        setSavedProxyUrls([])
      }
    }

    const categoryFormValues = buildCategoryFormValues(category, backendSettings)
    setFormData((prev) => ({ ...prev, [category]: categoryFormValues }))
    setSavedFormData((prev) => ({ ...prev, [category]: categoryFormValues }))
  }

  const refreshCategorySettings = async (category: string) => {
    const response = await fetch(`/api/settings?category=${encodeURIComponent(category)}`, {
      credentials: 'include',
    })

    if (response.status === 401) {
      handleUnauthorized()
      return
    }

    if (!response.ok) {
      throw new Error('获取最新配置失败')
    }

    const data = await response.json()
    applyCategorySettings(category, (data.settings?.[category] as Setting[]) || [])
  }

  const refreshCategorySettingsRef = useRef(refreshCategorySettings)
  refreshCategorySettingsRef.current = refreshCategorySettings

  const refreshGoogleAdsCategorySettings = useCallback(async () => {
    await refreshCategorySettingsRef.current('google_ads')
  }, [])

  const clearGoogleAdsFormFields = useCallback((keys: string[]) => {
    setFormData((prev) => {
      const next = { ...prev }
      next.google_ads = { ...(next.google_ads || {}) }
      for (const key of keys) {
        next.google_ads[key] = ''
      }
      return next
    })
  }, [])

  const googleAdsAuth = useGoogleAdsAuthSettings({
    oauthFormData: formData.google_ads,
    savedOAuthFormData: savedFormData.google_ads,
    onRefreshCategory: refreshGoogleAdsCategorySettings,
    onClearOAuthFormFields: clearGoogleAdsFormFields,
    onOAuthSaveComplete: () => setEditingField(null),
  })

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings', {
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取配置失败')
      }

      const data = await response.json()
      setSettings(data.settings)

      // 初始化表单数据，基于CATEGORY_FIELDS定义，确保所有字段都能显示
      const initialFormData: Record<string, Record<string, string>> = {}

      for (const category of ['google_ads', 'ai', 'proxy', 'affiliate_sync', 'system']) {
        const backendSettings = (data.settings[category] as Setting[]) || []

        if (category === 'proxy') {
          const proxySetting = backendSettings.find((item: Setting) => item.key === 'urls')
          try {
            const urls = proxySetting?.value ? JSON.parse(proxySetting.value) : []
            const normalizedUrls = Array.isArray(urls) ? urls : []
            setProxyUrls(normalizedUrls)
            setSavedProxyUrls(normalizedUrls)
          } catch {
            setProxyUrls([])
            setSavedProxyUrls([])
          }
        }

        initialFormData[category] = buildCategoryFormValues(category, backendSettings)
      }

      setFormData(initialFormData)
      setSavedFormData(initialFormData)
    } catch (err: any) {
      toast.error(err.message || '获取配置失败')
    } finally {
      setLoading(false)
    }
  }, [handleUnauthorized])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const handleInputChange = (category: string, key: string, value: string) => {
    setFormData((prev) => {
      const updated = {
        ...prev,
        [category]: {
          ...prev[category],
          [key]: value,
        },
      }

      // 🆕 当 gemini_provider 改变时，自动更新 gemini_model / gemini_endpoint
      if (category === 'ai' && key === 'gemini_provider') {
        // 🔧 修复(2025-12-30): 切换服务商时，清空另一个服务商的API Key显示值
        // 避免用户困惑（虽然两个API Key可能都已配置，但只会使用当前选中的）
        if (value === 'official') {
          // 切换到官方：清空中转API Key的显示（不影响数据库，只是前端显示）
          updated.ai.gemini_relay_api_key = ''
        } else if (value === 'relay') {
          // 切换到中转：清空官方API Key的显示（不影响数据库，只是前端显示）
          updated.ai.gemini_api_key = ''
        }

        const currentModel = updated.ai.gemini_model || GEMINI_ACTIVE_MODEL
        const normalizedModel = normalizeModelForProvider(currentModel, value)
        updated.ai.gemini_model = normalizedModel
        updated.ai.gemini_endpoint = resolveGeminiEndpoint(value, normalizedModel)
      }

      // 🆕 当 gemini_model 改变时，自动更新 gemini_endpoint
      if (category === 'ai' && key === 'gemini_model') {
        const provider = updated.ai.gemini_provider || 'official'
        const normalizedModel = normalizeModelForProvider(value, provider)
        updated.ai.gemini_model = normalizedModel
        updated.ai.gemini_endpoint = resolveGeminiEndpoint(provider, normalizedModel)
      }

      return updated
    })
  }

  // 代理URL操作函数
  const addProxyUrl = () => {
    // 🔥 检查是否所有支持的国家都已配置
    const usedCountries = new Set(proxyUrls.map((p) => p.country))
    const availableCountries = SUPPORTED_COUNTRIES.filter((c) => !usedCountries.has(c.code))

    if (availableCountries.length === 0) {
      toast.error('所有支持的国家都已配置代理URL，无法添加更多')
      return
    }

    // 使用第一个未配置的国家
    setProxyUrls((prev) => [...prev, { country: availableCountries[0].code, url: '' }])
  }

  const removeProxyUrl = (index: number) => {
    setProxyUrls((prev) => prev.filter((_, i) => i !== index))
  }

  const updateProxyUrl = (index: number, field: 'country' | 'url', value: string) => {
    // 🔥 如果是修改国家，检查该国家是否已被其他配置使用
    if (field === 'country') {
      const isDuplicate = proxyUrls.some((item, i) => i !== index && item.country === value)
      if (isDuplicate) {
        toast.error(`国家 ${value} 已经配置过代理URL，一个国家只能配置一个代理`)
        return
      }
    }

    // 🔥 验证代理URL格式（使用简单客户端验证，避免打包playwright）
    if (field === 'url' && value.trim()) {
      const validation = validateProxyUrlFormat(value)
      setProxyUrls((prev) =>
        prev.map((item, i) => (i === index ? { ...item, error: validation.error } : item))
      )
    }

    setProxyUrls((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const handleSave = async (category: string) => {
    setSaving(true)

    try {
      // 🔧 修复(2025-12-12): Google Ads 所有参数必填验证
      if (category === 'google_ads') {
        const oauthValidationError = validateGoogleAdsOAuthFormForSave(
          formData.google_ads,
          googleAdsAuth.googleAdsCredentialStatus
        )
        if (oauthValidationError) {
          toast.error(oauthValidationError)
          setSaving(false)
          return
        }
      }

      // AI配置验证
      if (category === 'ai') {
        const geminiProvider = formData.ai?.['gemini_provider']
        if (!geminiProvider || geminiProvider.trim() === '') {
          toast.error('请先选择服务商')
          setSaving(false)
          return
        }

        const selectedModel = formData.ai?.['gemini_model'] || GEMINI_ACTIVE_MODEL
        if (!isModelSupportedByProvider(selectedModel, geminiProvider)) {
          toast.error(`当前服务商不支持模型 ${selectedModel}，请调整服务商或模型`)
          setSaving(false)
          return
        }

        if (geminiProvider === 'official') {
          const geminiApiKey = formData.ai?.['gemini_api_key']
          if (!geminiApiKey || geminiApiKey.trim() === '' || geminiApiKey === '············') {
            toast.error('使用 Gemini 官方服务商时，必须填写官方 API Key')
            setSaving(false)
            return
          }
        } else if (geminiProvider === 'relay') {
          const geminiRelayApiKey = formData.ai?.['gemini_relay_api_key']
          if (
            !geminiRelayApiKey ||
            geminiRelayApiKey.trim() === '' ||
            geminiRelayApiKey === '············'
          ) {
            toast.error('使用第三方中转服务商时，必须填写中转 API Key')
            setSaving(false)
            return
          }
        }
      }

      // 代理配置验证
      if (category === 'proxy') {
        const validProxyUrls = proxyUrls.filter(
          (item) =>
            item &&
            typeof item.url === 'string' &&
            typeof item.country === 'string' &&
            item.url.trim() !== '' &&
            item.country.trim() !== ''
        )

        if (validProxyUrls.length === 0) {
          toast.error('代理设置至少需要配置一个代理URL')
          setSaving(false)
          return
        }

        // 🔥 检查是否有验证错误
        const proxyWithErrors = proxyUrls.filter((item) => item.error)
        if (proxyWithErrors.length > 0) {
          toast.error(`存在不支持的代理URL格式，请修改后保存`)
          setSaving(false)
          return
        }
      }

      let updates: Array<{ category: string; key: string; value: string }>

      // 特殊处理代理配置
      if (category === 'proxy') {
        // 过滤掉空URL或空国家的配置，添加安全检查避免undefined
        const validProxyUrls = proxyUrls.filter(
          (item) =>
            item &&
            typeof item.url === 'string' &&
            typeof item.country === 'string' &&
            item.url.trim() !== '' &&
            item.country.trim() !== ''
        )
        updates = [
          {
            category: 'proxy',
            key: 'urls',
            value: JSON.stringify(validProxyUrls),
          },
        ]
      } else {
        // 过滤掉空值字段，避免提交未填写的配置项
        // 但需要保留占位符（············）的字段，因为这些是已配置的敏感字段
        updates = Object.entries(formData[category] || {})
          .filter(([_, value]) => {
            if (value === undefined || value === null || value.trim() === '') {
              return false
            }
            // 如果是占位符（············），说明用户没有修改，不需要提交
            if (value === '············') {
              return false
            }
            return true
          })
          .map(([key, value]) => ({
            category,
            key,
            value,
          }))
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(formatGoogleAdsAuthSaveError(response.status, data.error))
      }

      const saveResult = await response.json()

      const categoryLabel = CATEGORY_CONFIG[category]?.label || category
      toast.success(`${categoryLabel} 配置保存成功`)

      if (category === 'google_ads' && saveResult.oauthReauthRequired) {
        toast.message(
          'OAuth Client ID 或 Client Secret 已变更，请重新启动 OAuth 授权以使 Refresh Token 生效',
          { duration: 8000 }
        )
      }

      // 仅刷新当前分类，避免覆盖其他分类未保存修改
      await refreshCategorySettings(category)

      if (category === 'google_ads') {
        await googleAdsAuth.notifyOAuthSaveComplete()
      }

      // 🔥 重要：刷新后清除编辑状态，让敏感字段重新显示为占位符
      setEditingField(null)
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async (category: string) => {
    const disabledReason = getValidateDisabledReason(category)
    if (disabledReason) {
      if (disabledReason.includes('未保存')) {
        toast.error(disabledReason)
      }
      return
    }

    setValidating(category)

    try {
      let config = formData[category] || {}

      // 代理分类需要从 proxyUrls 状态获取数据
      if (category === 'proxy') {
        // 过滤掉空URL或空国家的配置，添加安全检查避免undefined
        const validProxyUrls = proxyUrls.filter(
          (item) =>
            item &&
            typeof item.url === 'string' &&
            typeof item.country === 'string' &&
            item.url.trim() !== '' &&
            item.country.trim() !== ''
        )

        if (validProxyUrls.length === 0 && proxyUrls.length > 0) {
          toast.error('请填写完整的代理URL和国家后再验证')
          setValidating(null)
          return
        }

        config = {
          urls: JSON.stringify(validProxyUrls),
        }
      }

      const response = await fetch('/api/settings/validate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          config,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '验证失败')
      }

      if (data.valid) {
        toast.success(data.message)
      } else {
        toast.error(data.message)
      }

      // 🔧 修复(2025-12-24): 验证后不刷新整个配置，避免覆盖用户未保存的修改
      // 只需要显示验证成功的toast即可，验证状态会在下次保存后自动更新
      // await fetchSettings()
    } catch (err: any) {
      toast.error(err.message || '验证失败')
    } finally {
      setValidating(null)
    }
  }

  const getAIConfigDeleteTarget = (): 'gemini-official' | 'gemini-relay' => {
    const provider = formData.ai?.gemini_provider || 'official'
    return provider === 'relay' ? 'gemini-relay' : 'gemini-official'
  }

  const hasAIConfigToDelete = (() => {
    const aiSettings = settings.ai || []
    const getBackendValue = (key: string): string | null | undefined =>
      aiSettings.find((s) => s.key === key)?.value

    const target = getAIConfigDeleteTarget()
    if (target === 'gemini-relay') {
      return Boolean(getBackendValue('gemini_relay_api_key'))
    }
    return Boolean(getBackendValue('gemini_api_key'))
  })()

  const requestDeleteCurrentAIConfig = () => {
    const target = getAIConfigDeleteTarget()

    if (!hasAIConfigToDelete) {
      toast.error('当前模式未检测到可删除的配置')
      return
    }

    setAiDeleteConfirmTarget(target)
  }

  const deleteCurrentAIConfigNow = async (target: 'gemini-official' | 'gemini-relay') => {
    const targetLabel = (() => {
      switch (target) {
        case 'gemini-relay':
          return 'Gemini 第三方中转'
        case 'gemini-official':
          return 'Gemini 官方'
      }
    })()

    setDeletingAIConfig(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'ai', target }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || data.message || '删除失败')
      }

      toast.success(`已删除「${targetLabel}」配置`)
      await refreshCategorySettings('ai')
      setEditingField(null)
      setAiDeleteConfirmTarget(null)
    } catch (err: any) {
      toast.error(err.message || '删除失败')
    } finally {
      setDeletingAIConfig(false)
    }
  }

  const hasAffiliateSyncConfigToDelete = (() => {
    const affiliateSettings = settings.affiliate_sync || []
    const getBackendValue = (key: string): string | null | undefined =>
      affiliateSettings.find((s) => s.key === key)?.value

    return AFFILIATE_SYNC_DELETABLE_KEYS.some((key) => {
      const raw = getBackendValue(key)
      if (typeof raw !== 'string') return Boolean(raw)
      return raw.trim().length > 0
    })
  })()

  const requestDeleteCurrentAffiliateSyncConfig = () => {
    if (!hasAffiliateSyncConfigToDelete) {
      toast.error('当前未检测到可删除的联盟同步配置')
      return
    }

    setAffiliateSyncDeleteConfirmOpen(true)
  }

  const deleteCurrentAffiliateSyncConfigNow = async () => {
    setDeletingAffiliateSyncConfig(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'affiliate_sync' }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || data.message || '删除失败')
      }

      toast.success('联盟同步配置已删除')
      await refreshCategorySettings('affiliate_sync')
      setEditingField(null)
      setAffiliateSyncDeleteConfirmOpen(false)
    } catch (err: any) {
      toast.error(err.message || '删除失败')
    } finally {
      setDeletingAffiliateSyncConfig(false)
    }
  }

  const isReadOnlySetting = (category: string, key: string): boolean => {
    if (category === 'google_ads' && googleAdsAuth.googleAdsAuthReadOnly) return true
    if (category === 'ai' && key === 'gemini_endpoint') return true
    return category === 'affiliate_sync' && getFixedAffiliateSyncSettingValue(key) !== undefined
  }

  const normalizeComparableRecord = (
    record: Record<string, string> | undefined
  ): Record<string, string> => {
    const normalized: Record<string, string> = {}
    for (const [key, rawValue] of Object.entries(record || {})) {
      normalized[key] = String(rawValue || '')
    }
    return normalized
  }

  const normalizeComparableProxyUrls = (
    items: ProxyUrlConfig[]
  ): Array<{ country: string; url: string }> => {
    return items.map((item) => ({
      country: String(item?.country || ''),
      url: String(item?.url || ''),
    }))
  }

  const hasUnsavedChanges = (category: string): boolean => {
    if (category === 'proxy') {
      return (
        JSON.stringify(normalizeComparableProxyUrls(proxyUrls)) !==
        JSON.stringify(normalizeComparableProxyUrls(savedProxyUrls))
      )
    }

    return (
      JSON.stringify(normalizeComparableRecord(formData[category])) !==
      JSON.stringify(normalizeComparableRecord(savedFormData[category]))
    )
  }

  const getValidateDisabledReason = (category: string): string | null => {
    if (validating === category) return '正在验证中'
    if (saving || googleAdsAuth.savingServiceAccount) return '正在保存中'
    if (hasUnsavedChanges(category)) return '有未保存的修改，请先保存配置'
    return null
  }

  const canValidateCategory = (category: string): boolean =>
    getValidateDisabledReason(category) === null

  const renderInput = (category: string, setting: Setting) => {
    const metaKey = `${category}.${setting.key}`
    const metadata = SETTING_METADATA[metaKey]
    const value = formData[category]?.[setting.key] || ''

    // 🆕 gemini_endpoint 只读显示
    if (isReadOnlySetting(category, setting.key)) {
      return (
        <Input
          type="text"
          value={value || metadata?.defaultValue || ''}
          readOnly
          disabled
          className="bg-gray-100 cursor-not-allowed"
          placeholder={metadata?.placeholder}
        />
      )
    }

    // 布尔类型 - 使用Select
    if (setting.dataType === 'boolean' || metadata?.options) {
      let options = metadata?.options || [
        { value: 'true', label: '是' },
        { value: 'false', label: '否' },
      ]

      if (category === 'ai' && setting.key === 'gemini_model') {
        const provider = formData.ai?.gemini_provider || 'official'
        const shouldShowRelayOnlyModel = provider === 'relay' || value === RELAY_GPT_52_MODEL
        if (!shouldShowRelayOnlyModel) {
          options = options.filter((opt) => opt.value !== RELAY_GPT_52_MODEL)
        }
      }

      return (
        <Select
          value={value || metadata?.defaultValue || ''}
          onValueChange={(v) => handleInputChange(category, setting.key, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    // 数字类型
    if (setting.dataType === 'number') {
      const readOnly = isReadOnlySetting(category, setting.key)
      return (
        <Input
          type="number"
          value={value || metadata?.defaultValue || ''}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder}
          min={0}
          readOnly={readOnly}
          disabled={readOnly}
          className={readOnly ? 'bg-gray-100 cursor-not-allowed' : undefined}
        />
      )
    }

    // 时间类型（如 02:00）
    if (setting.key.includes('time')) {
      return (
        <Input
          type="time"
          value={value}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
        />
      )
    }

    // text类型 - 大文本输入（如Service Account JSON）
    if (setting.dataType === 'text') {
      const displayValue = setting.isSensitive && value ? '***已配置***' : value

      return (
        <Textarea
          value={displayValue}
          onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
          placeholder={metadata?.placeholder}
          rows={6}
          className="font-mono text-sm"
          onFocus={(e) => {
            if (setting.isSensitive && value && e.target.value === '***已配置***') {
              e.target.value = ''
              handleInputChange(category, setting.key, '')
            }
          }}
        />
      )
    }

    if (setting.isSensitive) {
      const fieldKey = `${category}.${setting.key}`
      const isEditing = editingField === fieldKey
      const sharedAdminHidden =
        category === 'google_ads' &&
        googleAdsAuth.isGoogleAdsSharedAdminHiddenSecret(setting.key, value)
      const hasValue = Boolean(value?.trim()) || sharedAdminHidden
      const displayValue = isEditing ? value : hasValue ? '············' : ''
      const sensitiveReadOnly =
        (category === 'google_ads' && googleAdsAuth.googleAdsAuthReadOnly) ||
        isReadOnlySetting(category, setting.key)

      return (
        <div className="space-y-1">
          <Input
            type="password"
            value={displayValue}
            onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
            placeholder={metadata?.placeholder || ''}
            className={hasValue ? 'border-green-300' : ''}
            readOnly={sensitiveReadOnly}
            disabled={sensitiveReadOnly}
            onFocus={() => {
              if (sensitiveReadOnly) return
              setEditingField(fieldKey)
              if (hasValue && !isEditing) {
                handleInputChange(category, setting.key, '')
              }
            }}
            onBlur={() => {
              setEditingField(null)
            }}
          />
          {hasValue && !isEditing && (
            <p className="text-caption text-green-600 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {sharedAdminHidden ? '已由管理员配置（不可见）' : '已配置（点击输入框可修改）'}
            </p>
          )}
        </div>
      )
    }

    return (
      <Input
        type="text"
        value={value || metadata?.defaultValue || ''}
        onChange={(e) => handleInputChange(category, setting.key, e.target.value)}
        placeholder={metadata?.placeholder}
        readOnly={isReadOnlySetting(category, setting.key)}
        disabled={isReadOnlySetting(category, setting.key)}
        className={
          isReadOnlySetting(category, setting.key) ? 'bg-gray-100 cursor-not-allowed' : undefined
        }
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-body text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <GoogleAdsDeleteConfirmDialog
          deleteConfirmState={googleAdsAuth.deleteConfirmState}
          setDeleteConfirmState={googleAdsAuth.setDeleteConfirmState}
          deletingOAuthConfig={googleAdsAuth.deletingOAuthConfig}
          deletingServiceAccountId={googleAdsAuth.deletingServiceAccountId}
          handleDeleteConfirm={googleAdsAuth.handleDeleteConfirm}
        />

        {/* AI 引擎删除配置：二次确认弹窗 */}
        <AlertDialog
          open={aiDeleteConfirmTarget !== null}
          onOpenChange={(open) => {
            if (!open) setAiDeleteConfirmTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除 AI 配置？</AlertDialogTitle>
              <AlertDialogDescription>
                {aiDeleteConfirmTarget === 'gemini-official' && (
                  <>将清空 Gemini 官方 API Key。删除后需要重新填写才能继续使用官方服务。</>
                )}
                {aiDeleteConfirmTarget === 'gemini-relay' && (
                  <>将清空 Gemini 第三方中转 API Key。删除后需要重新填写才能继续使用中转服务。</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingAIConfig}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deletingAIConfig || !aiDeleteConfirmTarget}
                onClick={async (e) => {
                  e.preventDefault()
                  if (!aiDeleteConfirmTarget) return
                  await deleteCurrentAIConfigNow(aiDeleteConfirmTarget)
                }}
              >
                {deletingAIConfig ? '删除中...' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 联盟同步删除配置：二次确认弹窗 */}
        <AlertDialog
          open={affiliateSyncDeleteConfirmOpen}
          onOpenChange={(open) => {
            if (!deletingAffiliateSyncConfig) {
              setAffiliateSyncDeleteConfirmOpen(open)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除联盟同步配置？</AlertDialogTitle>
              <AlertDialogDescription>
                将清空 PartnerBoost / YeahPromos
                的凭证与同步参数。删除后需要重新填写并保存，才能继续进行联盟同步与配置验证。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingAffiliateSyncConfig}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deletingAffiliateSyncConfig}
                onClick={async (e) => {
                  e.preventDefault()
                  await deleteCurrentAffiliateSyncConfigNow()
                }}
              >
                {deletingAffiliateSyncConfig ? '删除中...' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mb-8">
          <h1 className="page-title">系统配置</h1>
          <p className="page-subtitle">管理 API 密钥、代理设置和系统偏好</p>
        </div>

        {/* 配置说明 */}
        <Card className="mb-6 p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-body-sm text-blue-800">
              <p className="text-body-sm font-semibold mb-2">配置说明</p>
              <ul className="space-y-1 text-body-sm text-blue-700">
                <li>• 敏感数据（如 API 密钥、服务账号 JSON）使用 AES-256-GCM 加密存储</li>
                <li>• 标记为"必填"的配置项需要填写完整才能使用对应功能</li>
                <li>
                  • <strong>Google Ads</strong>：支持 OAuth
                  用户授权和服务账号认证两种方式，配置完成后可使用广告管理功能
                </li>
                <li>
                  • <strong>AI 引擎</strong>：统一使用 Gemini API，按"服务商 → 模型 → API
                  Key"完成配置
                </li>
                <li>• 如遇 API 访问问题，可尝试启用代理设置或检查配置是否正确</li>
              </ul>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {/* 定义分类显示顺序：Google Ads → AI引擎 → 代理设置 → 联盟同步 → 系统设置 */}
          {['google_ads', 'ai', 'proxy', 'affiliate_sync', 'system'].map((category) => {
            // 使用getMergedCategorySettings合并后端数据和前端定义的字段
            // 即使数据库中没有数据，也能显示所有配置字段
            const backendSettings = settings[category] || []
            const categorySettings = getMergedCategorySettings(category, backendSettings)
            if (!categorySettings || categorySettings.length === 0) return null

            const config = CATEGORY_CONFIG[category] || {
              label: category,
              icon: SettingsIcon,
              description: '',
              color: 'text-slate-600',
            }
            const IconComponent = config.icon

            return (
              <Card key={category} className="p-6">
                <div className="flex items-start justify-between gap-3 mb-6">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg bg-slate-100 ${config.color}`}>
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="card-title">{config.label}</h2>
                      <p className="text-body-sm text-muted-foreground mt-1">
                        {config.description}
                      </p>
                    </div>
                  </div>
                  {category === 'google_ads' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/help/google-ads-setup')}
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      配置指南
                    </Button>
                  )}
                </div>

                {/* 特殊处理 Google Ads 配置分类 */}
                {category === 'google_ads' ? (
                  <GoogleAdsAuthSettingsSection
                    auth={googleAdsAuth}
                    categorySettings={categorySettings}
                    renderOAuthField={(setting) => renderInput(category, setting)}
                  />
                ) : category === 'proxy' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="label-text flex items-center gap-2">
                        代理URL配置
                        <span className="text-caption text-red-500">*必填</span>
                      </Label>
                      <p className="helper-text flex items-start gap-1">
                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                        配置不同国家的代理URL，第一个URL将作为未配置国家的默认兜底值。必须至少配置一个有效的代理URL。
                      </p>
                      <p className="text-xs text-blue-600 flex items-center gap-1">
                        <Info className="w-3 h-3 shrink-0" />
                        当前已支持 IPRocket、Oxylabs、Kookeey、Cliproxy 四种代理格式
                      </p>

                      {/* IPRocket推荐说明 - 简洁版 */}
                      <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-400 rounded px-3 py-2 flex items-center gap-1">
                        <span>
                          💡 <strong>推荐使用IPRocket</strong>（稳定便宜），请联系管理员购买，
                          <span className="text-red-700 font-semibold">千万不要买官网套餐</span>
                        </span>
                      </p>

                      {/* 代理URL格式说明 */}
                      <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-caption font-semibold text-slate-700 mb-3 flex items-center gap-1">
                          <Info className="w-4 h-4" />
                          代理URL格式说明
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {/* IPRocket格式 */}
                          <div className="bg-white p-3 rounded border border-blue-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                IPRocket
                              </span>
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                                推荐
                              </span>
                              <span className="text-slate-600">API格式 - 需调用API获取代理IP</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              https://api.iprocket.io/api?username=...&password=...&cc=...&ips=1&proxyType=...
                            </div>
                          </div>

                          {/* Oxylabs格式 */}
                          <div className="bg-white p-3 rounded border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                                Oxylabs
                              </span>
                              <span className="text-slate-600">直接格式 - 直接代理服务器地址</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              https://用户名:密码@pr.oxylabs.io:端口
                            </div>
                          </div>

                          {/* Kookeey / Cliproxy 直连格式 */}
                          <div className="bg-white p-3 rounded border border-violet-200">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded">
                                Kookeey
                              </span>
                              <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs font-medium rounded">
                                Cliproxy
                              </span>
                              <span className="text-slate-600">直连格式 - 无需调用API</span>
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded break-all">
                              host:port:username:password
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              建议统一不带 <span className="font-mono">http(s)://</span>{' '}
                              前缀，直接填写上述格式
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-xs text-amber-700 flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>
                              <strong>处理策略：</strong>
                              <br />• IPRocket：API格式（系统会先调用 API 获取代理IP）
                              <br />• 直连格式：直接解析并使用代理（Oxylabs、Kookeey、Cliproxy）
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {proxyUrls.length === 0 ? (
                      <div className="text-center py-8 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                        <Globe className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <p className="text-body-sm text-muted-foreground mb-3">暂未配置代理URL</p>
                        <Button variant="outline" size="sm" onClick={addProxyUrl}>
                          <Plus className="w-4 h-4 mr-1" />
                          添加代理URL
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proxyUrls.map((item, index) => (
                          <div
                            key={index}
                            className="flex gap-3 items-start p-3 bg-slate-50 rounded-lg"
                          >
                            <div className="shrink-0 w-40">
                              <Label className="text-caption text-muted-foreground mb-1.5 block">
                                国家/地区{' '}
                                {index === 0 && <span className="text-amber-600">(默认)</span>}
                              </Label>
                              <Select
                                value={item.country}
                                onValueChange={(v) => updateProxyUrl(index, 'country', v)}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SUPPORTED_COUNTRIES.map((country) => (
                                    <SelectItem key={country.code} value={country.code}>
                                      {country.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1">
                              <Label className="text-caption text-muted-foreground mb-1.5 block">
                                代理URL
                              </Label>
                              <Input
                                value={item.url}
                                onChange={(e) => updateProxyUrl(index, 'url', e.target.value)}
                                placeholder="https://api.iprocket.io/api?username=xxx&password=xxx&cc=ROW&ips=1&proxyType=http&responseType=txt"
                                className={item.error ? 'border-red-500' : ''}
                              />
                              {item.error && (
                                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  {item.error}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 pt-6">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeProxyUrl(index)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={addProxyUrl}>
                          <Plus className="w-4 h-4 mr-1" />
                          添加更多代理URL
                        </Button>
                      </div>
                    )}

                    {proxyUrls.length > 0 && (
                      <p className="text-caption text-amber-600 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        提示：第一个配置的代理URL将作为默认兜底，当请求的国家没有专门配置代理时会使用它。
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* AI配置说明 */}
                    {category === 'ai' && (
                      <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-3">
                          <Info className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
                          <p className="font-semibold text-body-sm text-purple-800">AI配置顺序</p>
                        </div>
                        <div className="space-y-2 text-body-sm text-purple-700">
                          <p>
                            1. 先选服务商 2. 再选AI模型 3. 系统自动计算API端点 4.
                            填写当前服务商对应的API Key
                          </p>
                          <p className="text-purple-600">仅当前服务商对应的 API Key 会生效。</p>
                        </div>
                      </div>
                    )}

                    {category === 'affiliate_sync' && (
                      <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-2">
                          <Info className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                          <p className="font-semibold text-body-sm text-emerald-800">
                            联盟同步配置说明
                          </p>
                        </div>
                        <div className="space-y-1 text-body-sm text-emerald-700">
                          <p>支持只配置一个联盟，也支持同时配置 PartnerBoost 与 YeahPromos。</p>
                          <p>
                            点击"验证配置"会分别实调已配置联盟的真实 API，确认 Token / Site ID
                            是否可用。
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                      {(category === 'ai'
                        ? [...categorySettings].sort((a, b) => {
                            const aiOrder = [
                              'gemini_provider',
                              'gemini_model',
                              'gemini_endpoint',
                              'gemini_api_key',
                              'gemini_relay_api_key',
                            ]
                            return aiOrder.indexOf(a.key) - aiOrder.indexOf(b.key)
                          })
                        : categorySettings
                      ).map((setting: Setting) => {
                        const metaKey = `${category}.${setting.key}`
                        const metadata = SETTING_METADATA[metaKey]

                        // AI配置按服务商显示对应 API Key
                        if (category === 'ai') {
                          const provider = formData.ai?.gemini_provider || 'official'
                          const allowedKeys =
                            provider === 'relay'
                              ? [
                                  'gemini_provider',
                                  'gemini_model',
                                  'gemini_endpoint',
                                  'gemini_relay_api_key',
                                ]
                              : [
                                  'gemini_provider',
                                  'gemini_model',
                                  'gemini_endpoint',
                                  'gemini_api_key',
                                ]

                          if (!allowedKeys.includes(setting.key)) {
                            return null
                          }
                        }

                        // 动态必填逻辑
                        const isRequired = (() => {
                          if (category === 'ai') {
                            if (setting.key === 'gemini_provider' || setting.key === 'gemini_model')
                              return true
                            const provider = formData.ai?.gemini_provider || 'official'
                            if (provider === 'official' && setting.key === 'gemini_api_key')
                              return true
                            if (provider === 'relay' && setting.key === 'gemini_relay_api_key')
                              return true
                          }
                          return setting.isRequired
                        })()

                        return (
                          <div key={setting.key} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="label-text flex items-center gap-2">
                                {metadata?.label || setting.key}
                                {category === 'affiliate_sync' &&
                                  isReadOnlySetting(category, setting.key) && (
                                    <Badge
                                      variant="outline"
                                      className="bg-slate-100 text-slate-600 border-slate-300"
                                    >
                                      固定默认
                                    </Badge>
                                  )}
                                {isRequired && (
                                  <span className="text-caption text-red-500">*必填</span>
                                )}
                                {/* 🔧 修复(2025-12-30): 移除持久化验证状态图标
                                  验证结果应该是临时反馈（通过toast），不应该在刷新页面、切换模型后仍然显示
                                  {setting.validationStatus && (
                                    <span>{getValidationIcon(setting.validationStatus)}</span>
                                  )}
                              */}
                              </Label>
                              {metadata?.helpLink && (
                                <a
                                  href={metadata.helpLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                >
                                  获取方式
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>

                            <p className="helper-text flex items-start gap-1">
                              <Info className="w-3 h-3 mt-0.5 shrink-0" />
                              {metadata?.description || setting.description || '无描述'}
                            </p>

                            {renderInput(category, setting)}

                            {/* 🔧 修复(2025-12-30): 移除持久化验证消息的显示
                              验证结果应该是临时反馈（通过toast），不应该在刷新页面、切换模型后仍然显示
                              {setting.validationMessage && (
                                <p className={`text-caption ${setting.validationStatus === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                                  {setting.validationMessage}
                                </p>
                              )}
                          */}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                <div className="mt-6 pt-4 border-t border-slate-200 flex gap-3 flex-wrap">
                  {category === 'google_ads' ? (
                    <GoogleAdsAuthSettingsActions
                      auth={googleAdsAuth}
                      saving={saving}
                      onSaveOAuth={() => void handleSave(category)}
                    />
                  ) : (
                    <Button onClick={() => handleSave(category)} disabled={saving}>
                      {saving ? '保存中...' : '保存配置'}
                    </Button>
                  )}

                  {category === 'ai' && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => handleValidate(category)}
                        disabled={!canValidateCategory(category)}
                      >
                        {validating === category ? '验证中...' : '验证配置'}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={requestDeleteCurrentAIConfig}
                        disabled={deletingAIConfig || !hasAIConfigToDelete}
                      >
                        {deletingAIConfig ? '删除中...' : '删除配置'}
                      </Button>
                    </>
                  )}

                  {category === 'proxy' && (
                    <Button
                      variant="outline"
                      onClick={() => handleValidate(category)}
                      disabled={!canValidateCategory(category)}
                    >
                      {validating === category ? '验证中...' : '验证配置'}
                    </Button>
                  )}

                  {category === 'affiliate_sync' && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => handleValidate(category)}
                        disabled={!canValidateCategory(category)}
                      >
                        {validating === category ? '验证中...' : '验证配置'}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={requestDeleteCurrentAffiliateSyncConfig}
                        disabled={deletingAffiliateSyncConfig || !hasAffiliateSyncConfigToDelete}
                      >
                        {deletingAffiliateSyncConfig ? '删除中...' : '删除配置'}
                      </Button>
                    </>
                  )}
                </div>

                {['ai', 'proxy', 'affiliate_sync'].includes(category) &&
                  getValidateDisabledReason(category)?.includes('未保存') && (
                    <p className="mt-2 text-caption text-amber-600 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      {getValidateDisabledReason(category)}
                    </p>
                  )}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FileText,
  Search,
  Code2,
  Copy,
  Check,
  Eye,
  History,
  TrendingUp,
  Calendar,
  User,
  GitBranch,
  DollarSign,
  Loader2,
  Edit2,
  Save,
  X,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Info
} from 'lucide-react'
import { toast } from 'sonner'

interface PromptData {
  id: number
  promptId: string
  version: string
  category: string
  name: string
  description: string
  filePath: string
  functionName: string
  promptPreview: string
  language: string
  createdBy?: string
  createdAt: string
  versionCount: number
  totalCalls: number
  totalCost: number
}

interface PromptDetail {
  promptId: string
  category: string
  name: string
  description: string
  filePath: string
  functionName: string
  currentVersion: {
    version: string
    promptContent: string
    language: string
    createdBy?: string
    createdAt: string
    changeNotes?: string
  }
  versions: Array<{
    id: number
    version: string
    promptContent: string
    language: string
    createdBy?: string
    createdAt: string
    isActive: boolean
    changeNotes?: string
    totalCalls: number
    totalCost: number
  }>
  usageStats: Array<{
    date: string
    calls: number
    tokens: number
    cost: number
  }>
}

export default function PromptsManagementPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<PromptData[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDetail | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // 编辑模式相关状态（弹窗内）
  const [editMode, setEditMode] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [newVersion, setNewVersion] = useState('')
  const [changeNotes, setChangeNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [predictedNextVersion, setPredictedNextVersion] = useState('')  // 预测的下一个版本号

  // 列表内联编辑状态
  const [inlineEditId, setInlineEditId] = useState<number | null>(null)
  const [inlineEditContent, setInlineEditContent] = useState('')
  const [inlineChangeNotes, setInlineChangeNotes] = useState('')
  const [inlineSaving, setInlineSaving] = useState(false)

  // 变量验证相关状态
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<any>(null)
  const [showValidation, setShowValidation] = useState(false)

  // 加载 Prompts 列表
  useEffect(() => {
    loadPrompts()
  }, [])

  const loadPrompts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/prompts')
      const result = await response.json()

      if (result.success) {
        setPrompts(result.data.prompts)
        setCategories(result.data.categories)
      } else {
        toast.error('加载 Prompt 列表失败')
      }
    } catch (error) {
      console.error('加载 Prompt 列表失败:', error)
      toast.error('加载 Prompt 列表失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载 Prompt 详情
  const loadPromptDetail = async (promptId: string) => {
    try {
      setLoadingDetail(true)
      const response = await fetch(`/api/admin/prompts/${promptId}`)
      const result = await response.json()

      if (result.success) {
        setSelectedPrompt(result.data)
        setDetailModalOpen(true)
        setEditMode(false)
      } else {
        toast.error('加载 Prompt 详情失败')
      }
    } catch (error) {
      console.error('加载 Prompt 详情失败:', error)
      toast.error('加载 Prompt 详情失败')
    } finally {
      setLoadingDetail(false)
    }
  }

  // 激活指定版本
  const activateVersion = async (promptId: string, version: string) => {
    try {
      const response = await fetch(`/api/admin/prompts/${promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      })

      const result = await response.json()

      if (result.success) {
        toast.success(`版本 ${version} 已激活`)
        await loadPromptDetail(promptId)
        await loadPrompts()
      } else {
        toast.error(result.error || '激活版本失败')
      }
    } catch (error) {
      console.error('激活版本失败:', error)
      toast.error('激活版本失败')
    }
  }

  // 保存编辑的新版本
  const saveEditedPrompt = async () => {
    if (!selectedPrompt) return

    // 验证输入
    if (!editedContent.trim()) {
      toast.error('Prompt 内容不能为空')
      return
    }

    try {
      setSaving(true)
      // 计算新 name（更新版本号部分）
      const currentVer = selectedPrompt.currentVersion.version
      const nextVer = predictedNextVersion || currentVer
      const newName = selectedPrompt.name.replace(
        new RegExp(currentVer.replace(/\./g, '\\.') + '$'),
        nextVer
      )
      
      const response = await fetch(`/api/admin/prompts/${selectedPrompt.promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 不传 version，由后端自动计算
          name: newName,  // 传入更新后的 name
          promptContent: editedContent,
          changeNotes: changeNotes,
          isActive: true,  // 自动激活新版本
        })
      })

      const result = await response.json()

      if (result.success) {
        toast.success(`新版本 ${result.data.version} 创建成功`)
        setEditMode(false)
        setNewVersion('')
        setChangeNotes('')
        setPredictedNextVersion('')
        await loadPromptDetail(selectedPrompt.promptId)
        await loadPrompts()
      } else {
        toast.error(result.error || '保存失败')
      }
    } catch (error) {
      console.error('保存失败:', error)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 进入编辑模式
  const enterEditMode = () => {
    if (!selectedPrompt) return
    setEditedContent(selectedPrompt.currentVersion.promptContent)
    
    // 从所有版本中提取版本号，计算下一个版本号
    const versions = selectedPrompt.versions.map(v => v.version)
    const currentVersion = selectedPrompt.currentVersion.version
    
    // 解析当前版本号
    const versionMatch = currentVersion.match(/^v?(\d+(?:\.\d+)*)/i)
    if (versionMatch) {
      const parts = versionMatch[1].split('.').map(Number)
      // 递增最后一位
      parts[parts.length - 1] += 1
      
      // 处理进位
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i] >= 10 && i > 0) {
          parts[i] = 0
          parts[i - 1] += 1
        }
      }
      
      // 检查是否与现有版本冲突，冲突则继续递增
      let attempts = 0
      while (attempts < 100) {
        const testVersion = `v${parts.join('.')}`
        const exists = versions.some(v => {
          const m = v.match(/^v?(\d+(?:\.\d+)*)/i)
          return m && m[1] === parts.join('.')
        })
        
        if (!exists) {
          setPredictedNextVersion(testVersion)
          break
        }
        
        // 递增
        parts[parts.length - 1] += 1
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i] >= 10 && i > 0) {
            parts[i] = 0
            parts[i - 1] += 1
          }
        }
        attempts++
      }
      
      if (attempts >= 100) {
        setPredictedNextVersion(`v${Date.now()}`)
      }
    } else {
      setPredictedNextVersion('v1.0')
    }
    
    setChangeNotes('')
    setEditMode(true)
  }

  // 取消编辑
  const cancelEdit = () => {
    setEditMode(false)
    setEditedContent('')
    setNewVersion('')
    setChangeNotes('')
    setPredictedNextVersion('')
  }

  // ========== 内联编辑功能 ==========

  // 开始内联编辑
  const startInlineEdit = async (prompt: PromptData) => {
    setShowValidation(false)
    setValidationResult(null)
    try {
      setLoadingDetail(true)
      // 加载完整 Prompt 内容
      const response = await fetch(`/api/admin/prompts/${prompt.promptId}`)
      const result = await response.json()

      if (result.success) {
        setInlineEditId(prompt.id)
        setInlineEditContent(result.data.currentVersion.promptContent)
        setInlineChangeNotes('')
      } else {
        toast.error('加载 Prompt 内容失败')
      }
    } catch (error) {
      console.error('加载 Prompt 内容失败:', error)
      toast.error('加载 Prompt 内容失败')
    } finally {
      setLoadingDetail(false)
    }
  }

  // 取消内联编辑
  const cancelInlineEdit = () => {
    setInlineEditId(null)
    setInlineEditContent('')
    setInlineChangeNotes('')
  }

  // ========== 变量验证功能 ==========

  // 验证 Prompt 变量
  const validatePromptVariables = async (content: string) => {
    try {
      setValidating(true)
      const response = await fetch('/api/admin/prompts/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptContent: content })
      })

      const result = await response.json()

      if (result.success) {
        setValidationResult(result.data)
        setShowValidation(true)
      } else {
        toast.error(result.error || '验证失败')
      }
    } catch (error) {
      console.error('验证失败:', error)
      toast.error('验证失败')
    } finally {
      setValidating(false)
    }
  }

  // 清空验证结果
  const clearValidation = () => {
    setValidationResult(null)
    setShowValidation(false)
  }

  // 保存内联编辑
  const saveInlineEdit = async (prompt: PromptData) => {
    if (!inlineEditContent.trim()) {
      toast.error('Prompt 内容不能为空')
      return
    }

    try {
      setInlineSaving(true)
      // 计算新 name（更新版本号部分）
      // 从 prompt.version 计算下一个版本号
      const versionMatch = prompt.version.match(/^v?(\d+(?:\.\d+)*)/i)
      let nextVersion = prompt.version
      if (versionMatch) {
        const parts = versionMatch[1].split('.').map(Number)
        parts[parts.length - 1] += 1
        // 处理进位
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i] >= 10 && i > 0) {
            parts[i] = 0
            parts[i - 1] += 1
          }
        }
        nextVersion = `v${parts.join('.')}`
      }
      
      const newName = prompt.name.replace(
        new RegExp(prompt.version.replace(/\./g, '\\.') + '$'),
        nextVersion
      )
      
      const response = await fetch(`/api/admin/prompts/${prompt.promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,  // 传入更新后的 name
          promptContent: inlineEditContent,
          changeNotes: inlineChangeNotes,
          isActive: true,
        })
      })

      const result = await response.json()

      if (result.success) {
        toast.success(`新版本 ${result.data.version} 创建成功，名称已更新为：${newName}`)
        cancelInlineEdit()
        await loadPrompts()
      } else {
        toast.error(result.error || '保存失败')
      }
    } catch (error) {
      console.error('保存失败:', error)
      toast.error('保存失败')
    } finally {
      setInlineSaving(false)
    }
  }

  // 复制内容
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('已复制到剪贴板')
    setTimeout(() => setCopiedId(null), 2000)
  }

  // 过滤 Prompts
  const filteredPrompts = prompts.filter(prompt => {
    const matchesSearch = searchQuery === '' ||
      prompt.promptId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.filePath.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory = selectedCategory === null || prompt.category === selectedCategory

    return matchesSearch && matchesCategory
  })

  // 分类统计
  const categoryStats = categories.map(cat => ({
    name: cat,
    count: prompts.filter(p => p.category === cat).length
  }))

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Prompt 管理</h1>
            <p className="text-slate-600 mt-1">系统不同业务场景使用的 AI Prompt 配置与版本管理</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-slate-200 shadow-sm">
            <FileText className="w-5 h-5 text-indigo-600" />
            <div className="text-sm">
              <span className="font-semibold text-slate-900">{prompts.length}</span>
              <span className="text-slate-500 ml-1">个 Prompt</span>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {categoryStats.map(stat => (
            <Card
              key={stat.name}
              className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                selectedCategory === stat.name
                  ? 'border-indigo-500 bg-indigo-50/50'
                  : 'border-slate-200 hover:border-indigo-300'
              }`}
              onClick={() => setSelectedCategory(selectedCategory === stat.name ? null : stat.name)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">{stat.name}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stat.count}</p>
                </div>
                <Code2 className={`w-8 h-8 ${
                  selectedCategory === stat.name ? 'text-indigo-600' : 'text-slate-400'
                }`} />
              </div>
            </Card>
          ))}
        </div>

        {/* Search Bar */}
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-slate-400" />
            <Input
              placeholder="搜索 Prompt ID、名称、描述或文件路径..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border-0 shadow-none focus-visible:ring-0"
            />
            {selectedCategory && (
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => setSelectedCategory(null)}
              >
                {selectedCategory} ×
              </Badge>
            )}
          </div>
        </Card>

        {/* Prompts List */}
        <div className="space-y-4">
          {filteredPrompts.length === 0 ? (
            <Card className="p-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">未找到匹配的 Prompt</p>
            </Card>
          ) : (
            filteredPrompts.map(prompt => (
              <Card key={prompt.id} className="p-6 hover:shadow-md transition-shadow">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-slate-900">{prompt.name}</h3>
                        <Badge variant="outline" className="text-xs font-mono bg-slate-50 text-slate-700">
                          {prompt.promptId}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {prompt.category}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {prompt.version}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600">{prompt.description}</p>
                    </div>
                  </div>

                  {/* File Info & Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Code2 className="w-4 h-4" />
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded">{prompt.filePath}</code>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="text-xs">函数:</span>
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded font-mono">{prompt.functionName}()</code>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>{prompt.versionCount} 版本</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>{prompt.totalCalls.toLocaleString()} 调用</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>¥{(Number(prompt.totalCost) || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Prompt Preview / Edit */}
                  <div className="relative">
                    {inlineEditId === prompt.id ? (
                      /* 编辑模式 */
                      <div className="space-y-3">
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="w-4 h-4 text-amber-600" />
                            <p className="text-sm font-medium text-amber-800">正在编辑：{prompt.name}</p>
                          </div>
                          <div className="text-xs text-amber-700">
                            当前版本：<span className="font-mono">{prompt.version}</span></div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700 mb-1 block">变更说明</label>
                          <Input
                            value={inlineChangeNotes}
                            onChange={(e) => setInlineChangeNotes(e.target.value)}
                            placeholder="描述本次修改的主要内容..."
                            className="text-sm"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-slate-700">Prompt 内容</label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => validatePromptVariables(inlineEditContent)}
                              disabled={validating}
                              className="h-7 text-xs"
                            >
                              {validating ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              ) : (
                                <Code2 className="w-3 h-3 mr-1" />
                              )}
                              验证变量
                            </Button>
                          </div>
                          <Textarea
                            value={inlineEditContent}
                            onChange={(e) => setInlineEditContent(e.target.value)}
                            className="font-mono text-xs min-h-[300px] whitespace-pre"
                          />
                        </div>

                        {/* 变量验证结果面板 */}
                        {showValidation && validationResult && (
                          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                                <Code2 className="w-4 h-4 text-indigo-600" />
                                模板变量分析
                              </h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearValidation}
                                className="h-7"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>

                            {/* 统计信息 */}
                            <div className="grid grid-cols-4 gap-3 mb-4">
                              <div className="bg-white p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500">总变量数</div>
                                <div className="text-lg font-bold text-slate-900">
                                  {validationResult?.analysis?.stats?.total}
                                </div>
                              </div>
                              <div className="bg-white p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500">唯一变量</div>
                                <div className="text-lg font-bold text-slate-900">
                                  {validationResult?.analysis?.stats?.unique}
                                </div>
                              </div>
                              <div className="bg-white p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500">必需变量</div>
                                <div className="text-lg font-bold text-indigo-600">
                                  {validationResult?.analysis?.stats?.required}
                                </div>
                              </div>
                              <div className="bg-white p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500">可选变量</div>
                                <div className="text-lg font-bold text-emerald-600">
                                  {validationResult?.analysis?.stats?.optional}
                                </div>
                              </div>
                            </div>

                            {/* 问题提示 */}
                            {validationResult.analysis.issues.length > 0 && (
                              <div className="mb-4 space-y-2">
                                {validationResult.analysis.issues.map((issue: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className={`flex items-start gap-2 p-2 rounded text-xs ${
                                      issue.type === 'error'
                                        ? 'bg-red-50 text-red-800 border border-red-200'
                                        : issue.type === 'warning'
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                        : 'bg-blue-50 text-blue-800 border border-blue-200'
                                    }`}
                                  >
                                    {issue.type === 'error' ? (
                                      <ShieldAlert className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    ) : issue.type === 'warning' ? (
                                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    ) : (
                                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    )}
                                    <span>{issue.message}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* 变量列表 */}
                            <div className="space-y-3">
                              <div>
                                <h5 className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3 text-indigo-600" />
                                  必需变量 ({validationResult.analysis.required.length})
                                </h5>
                                <div className="flex flex-wrap gap-2">
                                  {validationResult.analysis.required.map((varName: string) => (
                                    <Badge
                                      key={varName}
                                      variant="outline"
                                      className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200"
                                    >
                                      {varName}
                                    </Badge>
                                  ))}
                                </div>
                              </div>

                              {validationResult.analysis.optional.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    可选变量 ({validationResult.analysis.optional.length})
                                  </h5>
                                  <div className="flex flex-wrap gap-2">
                                    {validationResult.analysis.optional.map((varName: string) => (
                                      <Badge
                                        key={varName}
                                        variant="outline"
                                        className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200"
                                      >
                                        {varName}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 只读模式 */
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500 uppercase">Prompt 预览</span>
                          <button
                            onClick={() => handleCopy(prompt.promptPreview, `preview-${prompt.id}`)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
                          >
                            {copiedId === `preview-${prompt.id}` ? (
                              <>
                                <Check className="w-3 h-3" />
                                已复制
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                复制
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-sm text-slate-700 font-mono leading-relaxed line-clamp-3">
                          {prompt.promptPreview}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadPromptDetail(prompt.promptId)}
                      disabled={loadingDetail}
                      className="flex items-center gap-2"
                    >
                      {loadingDetail ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                      查看完整 Prompt
                    </Button>
                    {inlineEditId === prompt.id ? (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => saveInlineEdit(prompt)}
                          disabled={inlineSaving}
                          className="flex items-center gap-2"
                        >
                          {inlineSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          保存
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={cancelInlineEdit}
                          disabled={inlineSaving}
                          className="flex items-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startInlineEdit(prompt)}
                        disabled={loadingDetail}
                        className="flex items-center gap-2"
                      >
                        <Edit2 className="w-4 h-4" />
                        编辑
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadPromptDetail(prompt.promptId)}
                      className="flex items-center gap-2"
                    >
                      <History className="w-4 h-4" />
                      版本历史
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Footer Info */}
        <Card className="p-4 bg-blue-50/50 border-blue-200">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">关于 Prompt 管理</p>
              <p className="text-sm text-blue-700 mt-1">
                此页面展示 AutoAds 系统中所有 AI 业务场景使用的 Prompt 配置。支持版本管理、使用统计和完整 Prompt 查看。
              </p>
              <p className="text-sm text-blue-700 mt-2">
                <strong>注意:</strong> 修改 Prompt 需要通过创建新版本的方式进行，确保历史版本可追溯和回滚。
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Prompt Detail Modal */}
      <Dialog open={detailModalOpen} onOpenChange={(open) => {
        setDetailModalOpen(open)
        if (!open) {
          setEditMode(false)
          setEditedContent('')
          setNewVersion('')
          setChangeNotes('')
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-indigo-600" />
              {selectedPrompt?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedPrompt?.description}
            </DialogDescription>
          </DialogHeader>

          {selectedPrompt && (
            <Tabs defaultValue="current" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="current">当前版本</TabsTrigger>
                <TabsTrigger value="versions">版本历史</TabsTrigger>
                <TabsTrigger value="stats">使用统计</TabsTrigger>
              </TabsList>

              {/* Current Version Tab */}
              <TabsContent value="current" className="space-y-4 mt-4">
                {/* 编辑模式下显示编辑界面 */}
                {editMode ? (
                  <div className="space-y-4">
                    {/* 编辑提示 */}
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <p className="text-sm text-amber-800">
                        编辑将创建新版本 <strong>{predictedNextVersion}</strong>，当前版本 <strong>{selectedPrompt.currentVersion.version}</strong> 将保留为历史版本
                      </p>
                    </div>

                    {/* 变更说明输入 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <GitBranch className="w-4 h-4 text-indigo-600" />
                        <div className="flex-1">
                          <span className="text-sm text-slate-600">新版本号：</span>
                          <span className="text-sm font-semibold text-indigo-600 font-mono">{predictedNextVersion}</span>
                          <span className="text-xs text-slate-500 ml-2">（自动计算，基于当前版本 {selectedPrompt.currentVersion.version}）</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700 mb-1 block">变更说明</label>
                        <Input
                          value={changeNotes}
                          onChange={(e) => setChangeNotes(e.target.value)}
                          placeholder="描述本次修改的主要内容..."
                        />
                      </div>
                    </div>

                    {/* Prompt 内容编辑区 */}
                    <div>
                      <label className="text-sm font-medium text-slate-700 mb-1 block">Prompt 内容</label>
                      <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="font-mono text-xs min-h-[400px] whitespace-pre"
                      />
                    </div>

                    {/* 操作按钮 */}
                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        取消
                      </Button>
                      <Button
                        onClick={saveEditedPrompt}
                        disabled={saving}
                        className="flex items-center gap-2"
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {saving ? '保存中...' : '保存为新版本'}
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  /* 只读模式 */
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                        <GitBranch className="w-4 h-4" />
                        <span>版本：{selectedPrompt.currentVersion.version}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <User className="w-4 h-4" />
                        <span>创建者：{selectedPrompt.currentVersion.createdBy || '系统'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Calendar className="w-4 h-4" />
                        <span>创建时间：{new Date(selectedPrompt.currentVersion.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Code2 className="w-4 h-4" />
                        <span>语言：{selectedPrompt.currentVersion.language}</span>
                      </div>
                    </div>

                    {selectedPrompt.currentVersion.changeNotes && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm font-medium text-blue-900 mb-1">版本说明</p>
                        <p className="text-sm text-blue-700">{selectedPrompt.currentVersion.changeNotes}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">完整 Prompt 内容</span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={enterEditMode}
                          className="flex items-center gap-2"
                        >
                          <Edit2 className="w-3 h-3" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(selectedPrompt.currentVersion.promptContent, 'current-prompt')}
                          className="h-7"
                        >
                          {copiedId === 'current-prompt' ? (
                            <>
                              <Check className="w-3 h-3 mr-1" />
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              复制
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {selectedPrompt.currentVersion.promptContent}
                      </pre>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Versions History Tab */}
              <TabsContent value="versions" className="space-y-3 mt-4">
                {selectedPrompt.versions.map(version => (
                  <Card key={version.id} className={`p-4 ${version.isActive ? 'border-indigo-500 bg-indigo-50/30' : ''}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-900">{version.version}</span>
                          {version.isActive && (
                            <Badge variant="default" className="text-xs">当前激活</Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>创建者：{version.createdBy || '系统'}</div>
                          <div>创建时间：{new Date(version.createdAt).toLocaleString('zh-CN')}</div>
                          <div>调用次数：{version.totalCalls.toLocaleString()} | 成本：¥{(Number(version.totalCost) || 0).toFixed(2)}</div>
                        </div>
                        {version.changeNotes && (
                          <p className="text-sm text-slate-700 mt-2">{version.changeNotes}</p>
                        )}
                      </div>
                      {!version.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => activateVersion(selectedPrompt.promptId, version.version)}
                        >
                          激活此版本
                        </Button>
                      )}
                    </div>
                    <div className="bg-slate-100 p-3 rounded text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto">
                      <pre className="whitespace-pre-wrap">{version.promptContent}</pre>
                    </div>
                  </Card>
                ))}
              </TabsContent>

              {/* Usage Stats Tab */}
              <TabsContent value="stats" className="space-y-4 mt-4">
                <div className="grid grid-cols-3 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-slate-600 mb-2">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-sm">总调用次数</span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                      {selectedPrompt.usageStats.reduce((sum, s) => sum + s.calls, 0).toLocaleString()}
                    </p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-slate-600 mb-2">
                      <Code2 className="w-4 h-4" />
                      <span className="text-sm">总 Token 消耗</span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                      {selectedPrompt.usageStats.reduce((sum, s) => sum + s.tokens, 0).toLocaleString()}
                    </p>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-2 text-slate-600 mb-2">
                      <DollarSign className="w-4 h-4" />
                      <span className="text-sm">总成本</span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                      ¥{selectedPrompt.usageStats.reduce((sum, s) => sum + (Number(s.cost) || 0), 0).toFixed(2)}
                    </p>
                  </Card>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-3">最近 30 天使用趋势</h4>
                  <div className="space-y-2">
                    {selectedPrompt.usageStats.slice(0, 10).map(stat => (
                      <div key={stat.date} className="flex items-center justify-between text-sm p-2 bg-slate-50 rounded">
                        <span className="text-slate-600">{stat.date}</span>
                        <div className="flex items-center gap-4 text-slate-700">
                          <span>{stat.calls} 次</span>
                          <span>{stat.tokens.toLocaleString()} tokens</span>
                          <span className="font-medium">¥{(Number(stat.cost) || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  Loader2
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

  // 加载Prompts列表
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
        toast.error('加载Prompt列表失败')
      }
    } catch (error) {
      console.error('加载Prompt列表失败:', error)
      toast.error('加载Prompt列表失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载Prompt详情
  const loadPromptDetail = async (promptId: string) => {
    try {
      setLoadingDetail(true)
      const response = await fetch(`/api/admin/prompts/${promptId}`)
      const result = await response.json()

      if (result.success) {
        setSelectedPrompt(result.data)
        setDetailModalOpen(true)
      } else {
        toast.error('加载Prompt详情失败')
      }
    } catch (error) {
      console.error('加载Prompt详情失败:', error)
      toast.error('加载Prompt详情失败')
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

  // 过滤Prompts
  const filteredPrompts = prompts.filter(prompt => {
    const matchesSearch = searchQuery === '' ||
      prompt.promptId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.filePath.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory = selectedCategory === null || prompt.category === selectedCategory

    return matchesSearch && matchesCategory
  })

  // 复制内容
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('已复制到剪贴板')
    setTimeout(() => setCopiedId(null), 2000)
  }

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
            <h1 className="text-3xl font-bold text-slate-900">Prompt管理</h1>
            <p className="text-slate-600 mt-1">系统不同业务场景使用的AI Prompt配置与版本管理</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-slate-200 shadow-sm">
            <FileText className="w-5 h-5 text-indigo-600" />
            <div className="text-sm">
              <span className="font-semibold text-slate-900">{prompts.length}</span>
              <span className="text-slate-500 ml-1">个Prompt</span>
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
              placeholder="搜索Prompt ID、名称、描述或文件路径..."
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
              <p className="text-slate-500">未找到匹配的Prompt</p>
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

                  {/* Prompt Preview */}
                  <div className="relative">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-xs font-medium text-slate-500 uppercase">Prompt预览</span>
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
                      查看完整Prompt
                    </Button>
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
              <p className="text-sm font-medium text-blue-900">关于Prompt管理</p>
              <p className="text-sm text-blue-700 mt-1">
                此页面展示AutoAds系统中所有AI业务场景使用的Prompt配置。支持版本管理、使用统计和完整Prompt查看。
              </p>
              <p className="text-sm text-blue-700 mt-2">
                <strong>注意:</strong> 修改Prompt需要通过创建新版本的方式进行,确保历史版本可追溯和回滚。
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Prompt Detail Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
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
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <GitBranch className="w-4 h-4" />
                    <span>版本: {selectedPrompt.currentVersion.version}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <User className="w-4 h-4" />
                    <span>创建者: {selectedPrompt.currentVersion.createdBy || '系统'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Calendar className="w-4 h-4" />
                    <span>创建时间: {new Date(selectedPrompt.currentVersion.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Code2 className="w-4 h-4" />
                    <span>语言: {selectedPrompt.currentVersion.language}</span>
                  </div>
                </div>

                {selectedPrompt.currentVersion.changeNotes && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-900 mb-1">版本说明</p>
                    <p className="text-sm text-blue-700">{selectedPrompt.currentVersion.changeNotes}</p>
                  </div>
                )}

                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">完整Prompt内容</span>
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
                  <div className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {selectedPrompt.currentVersion.promptContent}
                    </pre>
                  </div>
                </div>
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
                          <div>创建者: {version.createdBy || '系统'}</div>
                          <div>创建时间: {new Date(version.createdAt).toLocaleString('zh-CN')}</div>
                          <div>调用次数: {version.totalCalls.toLocaleString()} | 成本: ¥{(Number(version.totalCost) || 0).toFixed(2)}</div>
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
                      <span className="text-sm">总Token消耗</span>
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
                  <h4 className="text-sm font-medium text-slate-700 mb-3">最近30天使用趋势</h4>
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

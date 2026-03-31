'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle, ExternalLink, HelpCircle, Settings } from 'lucide-react'

export default function GoogleAdsSetupGuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Google Ads API 配置指南</h1>
          <p className="text-gray-600 mt-2">
            选择适合您的配置方式，按照步骤完成 Google Ads API 接入
          </p>
        </div>

        {/* 方式对比 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              两种配置方式对比
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border-2 border-blue-200 rounded-lg p-4 bg-blue-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <Badge>方式一</Badge>
                  <h3 className="font-semibold">OAuth 用户授权</h3>
                  <Badge variant="outline" className="text-xs bg-blue-100">推荐</Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>通过浏览器授权，安全可靠</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>支持 Keyword Planner API（需 Basic 或 Standard 访问权限）</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>适合单个账号或 MCC 账号</span>
                  </li>
                </ul>
              </div>

              <div className="border rounded-lg p-4 hover:border-gray-300 transition-colors bg-gray-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="secondary">方式二</Badge>
                  <h3 className="font-semibold">服务账号认证</h3>
                  <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300">即将下线</Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>服务器到服务器认证，无需用户交互</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>适合自动化场景和后台任务</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>支持 Keyword Planner API（需 Basic 或 Standard 访问权限）</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="oauth" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="oauth">方式一：OAuth授权</TabsTrigger>
            <TabsTrigger value="service-account">方式二：服务账号</TabsTrigger>
          </TabsList>

          {/* 方式一：OAuth */}
          <TabsContent value="oauth" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>配置步骤</CardTitle>
                <CardDescription>通过用户授权访问 Google Ads 账号。Keyword Planner API 需要 Developer Token 具有 Basic 或 Standard 访问权限。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-sm font-semibold">0</div>
                    <div className="flex-1">
                      <h4 className="font-medium">建议先使用测试权限（Test Access）进行功能测试</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在向 Google 申请<strong>基本访问权限（Basic Access）</strong>之前，建议先使用"测试权限（Test Access）"的 Developer Token 完成 OAuth 配置并测试产品功能。这样既能验证配置无误，也能通过真实调用记录提高后续审批通过率。
                      </p>
                      <div className="text-sm text-gray-600 mt-2 space-y-2">
                        <p className="font-medium text-blue-700">使用测试权限的优势：</p>
                        <ul className="ml-4 list-disc space-y-1">
                          <li>立即可用，无需等待审核</li>
                          <li>可以验证 OAuth 配置是否正确</li>
                          <li>可以测试产品的核心功能（使用测试账号）</li>
                          <li>真实的 API 调用记录有助于提高权限申请通过率</li>
                          <li>权限升级后无需重新配置，自动生效</li>
                        </ul>
                        <p className="text-xs text-gray-500 mt-2">
                          <strong>提示：</strong>使用测试权限时，只能访问测试账号。完成配置验证和功能测试后，可以同时向 Google 申请 Basic/Standard 权限，无需等待审批结果。
                        </p>
                        <p className="text-xs text-amber-600 mt-2">
                          <strong>注意：</strong>Test Access 和 Explorer Access 权限无法使用 Keyword Planner API 获取搜索量数据，需要申请 Basic Access 或 Standard Access 才能使用该功能。
                        </p>
                      </div>
                    </div>
                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">1</div>
	                    <div>
	                      <h4 className="font-medium">创建 GCP 项目并启用 API</h4>
	                      <p className="text-sm text-gray-600 mt-1">
	                        访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 创建项目，然后在"API和服务"→"库"中搜索并启用 <strong>Google Ads API</strong>
	                      </p>
	                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">2</div>
	                    <div>
	                      <h4 className="font-medium">配置 OAuth 同意屏幕（目标对象：测试版 + OAuth 用户）</h4>
	                      <div className="text-sm text-gray-600 mt-1 space-y-2">
	                        <p>
	                          进入 Cloud Console 的 <strong>API和服务</strong>→<strong>OAuth权限请求</strong>页面，在"目标对象"中确认"发布状态"为<strong>测试版</strong>，"用户类型"为<strong>外部</strong>。
	                        </p>
	                        <p className="text-red-600">
	                          并将<strong>MCC 所属的 Gmail 邮箱</strong>加入到"OAuth 用户列表/测试用户"中，否则授权时可能无法通过。
	                        </p>
	                      </div>
	                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">3</div>
	                    <div className="flex-1">
	                      <h4 className="font-medium" id="oauth-client-id">创建 OAuth 客户端</h4>
	                      <p className="text-sm text-gray-600 mt-1">
	                        进入<a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-600 hover:underline">凭据</a>页面，点击"创建凭据"→"OAuth 2.0 客户端 ID"，选择"Web 应用"类型
	                      </p>
                      <Alert className="mt-3 bg-blue-50 border-blue-300">
                        <HelpCircle className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-blue-800 text-sm">
                          <strong>重要提示：</strong>记住当前 GCP Project 的项目编号（Project Number），后续申请 Developer Token 时必须在同一个 Project 中进行，即注册MCC和GCP的Gmail邮箱需要保持同一个。
                        </AlertDescription>
                      </Alert>
                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">4</div>
	                    <div>
	                      <h4 className="font-medium">配置授权 URI</h4>
	                      <div className="text-sm text-gray-600 mt-1 space-y-2">
	                        <p>
	                          在"已授权的重定向 URI"中添加：<code className="bg-gray-100 px-2 py-0.5 rounded text-xs">https://www.autoads.dev/api/google-ads/oauth/callback</code>
                        </p>
                        <p>
                          在"已获授权的 JavaScript 来源"中添加：<code className="bg-gray-100 px-2 py-0.5 rounded text-xs">https://www.autoads.dev</code>
                        </p>
                      </div>
                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">5</div>
	                    <div className="flex-1">
	                      <h4 className="font-medium">获取 Client ID 和 Client Secret</h4>
	                      <div className="text-sm text-gray-600 mt-1 space-y-2">
	                        <p>创建完成后，点击客户端名称查看 <strong>客户端 ID</strong>和<strong>客户端密钥</strong></p>
                        <div className="p-3 bg-gray-50 border rounded-lg">
                          <p className="font-medium text-gray-900 mb-1">Client ID 格式示例：</p>
                          <code className="text-xs bg-white px-2 py-1 rounded border">123456789012-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com</code>
                          <p className="mt-2 text-xs text-gray-600">其中开头的数字 <code className="bg-white px-1 rounded border">123456789012</code> 就是 GCP Project Number</p>
                        </div>
                      </div>
                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">6</div>
	                    <div className="flex-1">
	                      <h4 className="font-medium" id="oauth-developer-token">申请 Developer Token</h4>
	                      <p className="text-sm text-gray-600 mt-1">
	                        访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a> 申请 Token，OAuth 方式需要 <strong>基本访问权限</strong>（审核1-3个工作日）
                      </p>

                      {/* 重要警告：Project 匹配 */}
                      <Alert className="mt-3 bg-red-50 border-red-300" id="project-matching">
	                        <AlertCircle className="h-5 w-5 text-red-600" />
	                        <AlertDescription className="text-red-800">
	                          <div className="font-semibold mb-2">关键要求：Developer Token 必须与 OAuth Client ID 来自同一个 GCP Project</div>
	                          <ul className="text-sm space-y-1 ml-4 list-disc">
	                            <li>在申请 Developer Token 时，确保选择的 GCP Project 与步骤3创建 OAuth Client 的 Project 相同</li>
	                            <li>Client ID 格式为 <code className="bg-red-100 px-1 rounded">项目编号-xxx.apps.googleusercontent.com</code>，其中"项目编号"就是 Project Number</li>
	                            <li>如果配置不匹配，API 调用会报错：<code className="bg-red-100 px-1 rounded">Developer token is not allowed with project 'xxx'</code></li>
	                            <li><strong>解决方法</strong>：要么在 Client ID 所属的 Project 重新申请 Developer Token，要么在 Developer Token 所属的 Project 重新创建 OAuth Client</li>
	                          </ul>
	                        </AlertDescription>
	                      </Alert>
                    </div>
	                  </div>

	                  <div className="flex items-start gap-3">
	                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">7</div>
	                    <div>
	                      <h4 className="font-medium">完成配置</h4>
	                      <p className="text-sm text-gray-600 mt-1">
	                        在系统设置页面配置 Client ID、Client Secret、Developer Token，然后点击"启动 OAuth 授权"
                      </p>
                    </div>
                  </div>
                </div>

                <Alert className="mt-4 bg-blue-50 border-blue-200">
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription>
                    <strong>提示：</strong>OAuth 方式正式使用需要"基本访问权限"或更高级别的 Developer Token。建议先使用测试权限进行配置验证，同时向 Google 申请更高权限（审核 1-3 个工作日）。权限升级后自动生效，无需重新配置。
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 方式二：服务账号 */}
          <TabsContent value="service-account" className="space-y-4 mt-4">
            {/* 配置步骤 */}
            <Card>
              <CardHeader>
                <CardTitle>配置步骤</CardTitle>
                <CardDescription>服务器到服务器认证，适合自动化场景</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">1</div>
                    <div>
                      <h4 className="font-medium">启用 Google Ads API</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 中创建项目，然后在"API和服务"→"库"中启用 <strong>Google Ads API</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">2</div>
                    <div>
                      <h4 className="font-medium">创建服务账号并下载 JSON</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在" IAM 和管理"→"服务账号"中创建服务账号，选择"JSON"密钥类型并下载
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">3</div>
                    <div>
                      <h4 className="font-medium">获取 MCC Customer ID</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 Google Ads API Center 中获取您的 MCC 账号 ID（10位数字，不带连字符）
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">4</div>
                    <div>
                      <h4 className="font-medium">申请 Developer Token</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a> 申请 Token（初始为测试权限，仅能访问测试账号）
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">5</div>
                    <div>
                      <h4 className="font-medium">添加服务账号到 MCC</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 Google Ads MCC 的"访问权限和安全"中添加服务账号邮箱，分配<strong>标准角色</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">6</div>
                    <div>
                      <h4 className="font-medium">完成配置</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在系统设置页面上传 JSON 文件，配置 MCC Customer ID 和 Developer Token
                      </p>
                    </div>
                  </div>
                </div>

                <Alert className="mt-4 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>提示：</strong>初次申请会获得测试权限的 Developer Token，仅能访问测试账号。如需访问真实账号，需要申请 Basic Access 或更高级别，或使用 OAuth 授权方式。
                  </AlertDescription>
                </Alert>

                <Alert className="mt-4 bg-amber-50 border-amber-200">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <AlertDescription>
                    <strong>功能限制：</strong>服务账号模式无法使用 Keyword Planner API（需要 Basic Access 权限）。关键词搜索量查询将返回默认值，不影响广告创建和投放等核心功能。如需精确搜索量数据，请使用 OAuth 授权模式。
                  </AlertDescription>
                </Alert>

                <Alert className="mt-4 bg-orange-50 border-orange-200">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  <AlertDescription>
                    <strong>即将下线：</strong>服务账号认证方式将在未来版本中逐步下线，建议新用户优先使用 OAuth 授权方式。
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Developer Token 访问级别说明 */}
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-blue-600" />
                  Developer Token 访问级别说明
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm space-y-3">
                  <p className="text-gray-700">
                    Developer Token 有多个访问级别，影响可访问的账号类型和每日操作限制：
                  </p>

                  <div className="space-y-3">
                    {/* Test Account Access */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start gap-2 mb-2">
                        <Badge variant="outline" className="bg-gray-100">Test Account Access</Badge>
                        <span className="text-xs text-gray-500">（初始级别）</span>
                      </div>
                      <ul className="text-sm text-gray-600 space-y-1 ml-2">
                        <li className="flex items-start gap-2">
                          <span className="text-red-500 mt-0.5">⚠️</span>
                          <span><strong>仅限测试账号</strong>：无法访问真实的 Google Ads 账号</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span>无需审核，立即可用</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-500 mt-0.5">ℹ️</span>
                          <span>限制：0 operations/day（仅测试账号可调用）</span>
                        </li>
                      </ul>
                    </div>

                    {/* Explorer Access */}
                    <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-3 border-2 border-blue-200">
                      <div className="flex items-start gap-2 mb-2">
                        <Badge className="bg-blue-600">Explorer Access</Badge>
                      </div>
                      <ul className="text-sm text-gray-700 space-y-1 ml-2">
                        <li className="flex items-start gap-2">
                          <span className="text-green-500 mt-0.5 font-bold">✓</span>
                          <span><strong>可访问真实账号</strong></span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-orange-500 mt-0.5">⏱</span>
                          <span>需要申请或等待 Google 审核</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-500 mt-0.5">ℹ️</span>
                          <span>限制：2,880 operations/day（足够日常使用）</span>
                        </li>
                      </ul>
                    </div>

                    {/* Basic Access */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-100">Basic Access</Badge>
                        <span className="text-xs text-gray-500">（需申请）</span>
                      </div>
                      <ul className="text-sm text-gray-600 space-y-1 ml-2">
                        <li className="flex items-start gap-2">
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span>可访问真实账号 + Keyword Planner API</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-orange-500 mt-0.5">⏱</span>
                          <span>需审核 1-3 个工作日</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-blue-500 mt-0.5">ℹ️</span>
                          <span>限制：15,000 operations/day</span>
                        </li>
                      </ul>
                    </div>

                    {/* Standard Access */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start gap-2 mb-2">
                        <Badge variant="outline" className="bg-purple-100">Standard Access</Badge>
                        <span className="text-xs text-gray-500">（需申请）</span>
                      </div>
                      <ul className="text-sm text-gray-600 space-y-1 ml-2">
                        <li className="flex items-start gap-2">
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span>每天无限次操作</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-orange-500 mt-0.5">⏱</span>
                          <span>需审核，通常需要更长时间</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-sm">
                      <strong>推荐策略：</strong>如需访问真实账号，建议直接申请 Basic/Standard Access 或使用 OAuth 授权方式，避免测试权限的限制。
                    </AlertDescription>
                  </Alert>

                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                    <p className="font-semibold mb-1">如何检查当前访问级别？</p>
                    <p>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a>，查看 Developer Token 状态。如显示"Test - Ready to use"表示测试权限，升级后会显示为其他级别。</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 详细指南：获取服务账号 JSON */}
            <Card id="service-account-json">
              <CardHeader>
                <CardTitle className="text-base">详细指南：如何获取服务账号 JSON</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-3">
                  <li>
                    访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a>，选择或创建项目
                  </li>
                  <li>
                    启用 <strong>Google Ads API</strong>（"API和服务"→"库"中搜索启用）
                  </li>
                  <li>
                    进入" IAM 和管理"→"<a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" className="text-blue-600 hover:underline">服务账号</a>"
                  </li>
                  <li>
                    点击"创建服务账号"，填写名称和描述后点击"创建"
                  </li>
                  <li>
                    在<strong>"授予此服务账号的权限"</strong>步骤中：
                    <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                      <li>展开"基本"角色列表</li>
                      <li>选择<strong>"所有者"</strong>（Owner）或根据需求选择自定义权限</li>
                    </ul>
                  </li>
                  <li>
                    点击"创建密钥"，选择"JSON"类型，点击"创建"下载文件
                  </li>
                  <li>
                    用文本编辑器打开下载的文件，复制完整内容
                  </li>
                </ol>
                <Alert className="mt-3 bg-amber-50 border-amber-200">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <AlertDescription>
                    <strong>重要：</strong>服务账号邮箱必须添加到 Google Ads MCC 的"访问权限和安全"中，否则无法访问 API
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* 常见问题 */}
            <Card id="faq">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  常见问题
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Q: 我应该选择哪种配置方式？</h4>
                  <p className="text-sm text-gray-600">
                    <strong>推荐使用 OAuth 方式</strong>。无论是管理自己的账号还是 MCC 账号，OAuth 都能提供更稳定的功能支持（包括 Keyword Planner API）。服务账号方式将在未来版本中逐步下线。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: Developer Token 审核需要多久？</h4>
                  <p className="text-sm text-gray-600">
                    <strong>测试权限</strong>（Test Access）立即可用，但仅能访问测试账号；<strong>Basic/Standard Access</strong> 需要申请审核（1-3 个工作日），可访问真实账号。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: 服务账号密钥丢失怎么办？</h4>
                  <p className="text-sm text-gray-600">
                    在 Google Cloud Console 中删除旧密钥，重新创建新密钥并更新系统配置即可。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: 如何确认服务账号已正确配置？</h4>
                  <p className="text-sm text-gray-600">
                    请检查以下三项：
                    <ul className="list-disc list-inside ml-2 mt-1">
                      <li>Google Ads API 在 GCP 项目中已启用</li>
                      <li>Developer Token 状态为 "Enabled" 或 "Test - Ready to use"</li>
                      <li>服务账号邮箱已在 MCC 的 "Access and security" 中添加</li>
                    </ul>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 故障排除 */}
            <Card className="border-orange-200 bg-orange-50/50" id="troubleshooting">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-800">
                  <AlertCircle className="w-5 h-5" />
                  故障排除
                </CardTitle>
                <CardDescription className="text-orange-700">
                  如果遇到 API 错误，请按以下步骤排查
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 错误1：配置不完整 */}
                <div className="bg-white rounded-lg p-4 border border-orange-200">
                  <h5 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 bg-orange-100 rounded flex items-center justify-center text-xs">!</span>
                    错误：服务账号配置不完整
                  </h5>
                  <p className="text-sm text-gray-600 mb-3">
                    如果遇到 API 验证错误，请按以下步骤检查：
                  </p>
                  <div className="space-y-3 ml-2">
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                      <div>
                        <strong className="text-sm">检查 Google Ads API 是否已启用</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          确认 GCP 项目中 Google Ads API 状态为 "Enabled"
                          <a href="https://console.cloud.google.com/apis/library/googleads.googleapis.com" target="_blank" className="text-blue-600 hover:underline ml-1">检查</a>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                      <div>
                        <strong className="text-sm">验证 Developer Token 有效性</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          Token 必须为 "Enabled" 或 "Test - Ready to use"，格式为 22 位字符
                          <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline ml-1">检查</a>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                      <div>
                        <strong className="text-sm">确认服务账号已添加到 MCC</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          在 "Tools & Settings → Access and security" 中添加服务账号邮箱
                        </p>
                      </div>
                    </div>
                  </div>
                  <Alert className="mt-3 bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm">
                      <strong>注意：</strong>添加服务账号后，可能需要等待 5-10 分钟才能生效
                    </AlertDescription>
                  </Alert>
                </div>

                {/* 错误2：DEVELOPER_TOKEN_NOT_APPROVED */}
                <div className="bg-white rounded-lg p-4 border-2 border-yellow-300">
                  <h5 className="font-semibold text-yellow-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 bg-yellow-100 rounded flex items-center justify-center text-xs">!</span>
                    错误：DEVELOPER_TOKEN_NOT_APPROVED
                  </h5>
                  <p className="text-sm text-gray-600 mb-3">
                    如果日志中出现 <code className="bg-yellow-50 px-1 rounded">DEVELOPER_TOKEN_NOT_APPROVED: The developer token is only approved for use with test accounts</code> 错误，说明您的 Developer Token 还是 <strong>Test Account Access</strong> 级别，只能访问测试账号。
                  </p>

                  <div className="bg-blue-50 rounded p-3 mb-3">
                    <p className="text-sm text-gray-700 font-semibold mb-2">这是正常的！原因：</p>
                    <ul className="text-sm text-gray-600 space-y-1 ml-2">
                      <li>• 新创建的 Developer Token 默认是 Test Account Access 级别</li>
                      <li>• Test Account Access 仅能访问测试账号，无法访问真实账号</li>
                      <li>• 需要申请 Basic Access 或更高级别才能访问真实账号</li>
                    </ul>
                  </div>

                  <p className="text-sm text-gray-600 mb-2">
                    <strong>解决方法（2 种选择）：</strong>
                  </p>
                  <div className="space-y-3 ml-2">
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold">推荐</span>
                      <div>
                        <strong className="text-sm text-green-700">申请 Basic/Standard Access</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">API Center</a>，点击"Apply for Basic Access"或"Apply for Standard Access"。审核通常需要 1-3 个工作日。
                        </p>
                        <ul className="text-xs text-gray-500 mt-1 ml-3 space-y-0.5">
                          <li>• Basic: 15,000 operations/day + Keyword Planner API</li>
                          <li>• Standard: 每天无限次操作</li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                      <div>
                        <strong className="text-sm">使用测试 MCC 账号</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          创建 <a href="https://developers.google.com/google-ads/api/docs/best-practices/test-accounts" target="_blank" className="text-blue-600 hover:underline">Test Manager Account</a>，Test Account Access Token 可以立即使用（但只能测试，无法投放真实广告）。
                        </p>
                      </div>
                    </div>
                  </div>

                  <Alert className="mt-3 bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-sm">
                      <strong>推荐策略：</strong>如需访问真实账号，建议直接申请 Basic/Standard Access 或使用 OAuth 授权方式。<br/>
                      详见上方 <a href="#" className="text-blue-600 hover:underline" onClick={(e) => { e.preventDefault(); document.querySelector('.border-blue-200.bg-blue-50\\/30')?.scrollIntoView({ behavior: 'smooth' }); }}>Developer Token 访问级别说明</a>
                    </AlertDescription>
                  </Alert>
                </div>

                {/* 错误3：PERMISSION_DENIED */}
                <div className="bg-white rounded-lg p-4 border border-red-200">
                  <h5 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 bg-red-100 rounded flex items-center justify-center text-xs">!</span>
                    错误：PERMISSION_DENIED
                  </h5>
                  <p className="text-sm text-gray-600 mb-3">
                    如果日志中出现 <code className="bg-red-50 px-1 rounded">PERMISSION_DENIED: The caller does not have permission</code> 错误，说明服务账号没有被添加到 Google Ads MCC 账户中。
                  </p>
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>解决方法：</strong>
                  </p>
                  <ol className="text-sm text-gray-600 list-decimal list-inside space-y-2 ml-1">
                    <li>
                      <strong>登录 Google Ads MCC 账号</strong>
                      <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline ml-1">访问</a>
                    </li>
                    <li>
                      <strong>添加服务账号</strong>：
                      <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                        <li>点击 <strong>"Tools & Settings" → "Access and security"</strong></li>
                        <li>点击 <strong>"Add Access"</strong> 或 <strong>"Link Account"</strong></li>
                        <li>输入服务账号邮箱（如 <code className="bg-gray-100 px-1 rounded">xxx@project-id.iam.gserviceaccount.com</code>）</li>
                        <li>分配角色：<strong>"Admin access"</strong> 或 <strong>"Standard access"</strong></li>
                      </ul>
                    </li>
                    <li>
                      <strong>等待 5-30 分钟</strong>让权限生效
                    </li>
                  </ol>
                  <Alert className="mt-3 bg-amber-50 border-amber-200">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <AlertDescription className="text-sm">
                      <strong>重要：</strong>服务账号必须被添加到 Google Ads MCC 账户中，即使它在 Google Cloud 有完全权限。
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 帮助资源 - 页面底部 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>帮助资源</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <a href="https://developers.google.com/google-ads/api/docs/start" target="_blank" className="flex items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <ExternalLink className="w-4 h-4 text-blue-500" />
                <span className="text-blue-600 hover:underline">Google Ads API 官方文档</span>
              </a>
              <a href="https://developers.google.com/google-ads/api/docs/oauth/service-accounts" target="_blank" className="flex items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <ExternalLink className="w-4 h-4 text-blue-500" />
                <span className="text-blue-600 hover:underline">服务账号认证指南</span>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

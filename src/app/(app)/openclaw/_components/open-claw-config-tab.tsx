'use client'

import { toast } from 'sonner'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InputWithLabel, SwitchWithLabel } from './form-controls'
import {
  AI_GLOBAL_KEYS,
  AI_MINIMAL_PLACEHOLDER,
  FEISHU_BASIC_EXAMPLE_VALUES,
  FEISHU_CHAT_USER_KEYS,
  HIGH_RISK_COMMAND_LOOKBACK_DAYS,
} from '../constants'
import {
  formatCountdown,
  formatDuration,
  formatFeishuRunIdShort,
  formatTimestamp,
  hasText,
  isTruthy,
  renderTriState,
  resolveCommandConfirmStatusText,
  resolveCommandRiskBadge,
} from '../utils'
import { Switch } from '@/components/ui/switch'

import { useOpenClawPageContext } from '../openclaw-page-context'

export function OpenClawConfigTab() {
  const {
  userValues,
  tokens,
  newToken,
  savingUser,
  gatewayStatus,
  gatewayLoading,
  gatewayReloading,
  gatewaySkillsCollapsed,
  setGatewaySkillsCollapsed,
  gatewayShowAvailableOnly,
  setGatewayShowAvailableOnly,
  workspaceStatus,
  workspaceLoading,
  workspaceBootstrapping,
  feishuTestLoading,
  feishuTestResult,
  feishuVerifyLoading,
  feishuVerifyChecking,
  feishuVerifySenderOpenId,
  setFeishuVerifySenderOpenId,
  feishuVerifySession,
  feishuVerifyResult,
  showFeishuAdvanced,
  setShowFeishuAdvanced,
  aiJsonError,
  setAiJsonError,
  pendingCommandRuns,
  pendingCommandRunsLoading,
  pendingCommandRunsError,
  pendingCommandRunsPage,
  setPendingCommandRunsPage,
  pendingCommandRunsTotal,
  pendingCommandRunsTotalPages,
  loadGatewayStatus,
  loadWorkspaceStatus,
  setUserValue,
  loadPendingCommandRuns,
  handleWorkspaceBootstrap,
  handleWorkspaceBootstrapAndReload,
  handleGatewayHotReload,
  saveSettings,
  handleCreateToken,
  handleRevokeToken,
  handleFeishuTestConnection,
  handleFeishuStartVerify,
  handleFeishuCheckVerify,
  handleFormatAiJson,
  validateAiJson,
  aiModelsInfo,
  aiModelOptions,
  aiSelectedModelRef,
  handleAiModelChange,
  gatewayHealth,
  gatewaySkillsList,
  gatewaySkillsSummary,
  gatewayVisibleSkills,
  workspaceFiles,
  workspaceMissingFiles,
  workspaceReady,
  workspaceSourceLabel,
  canReloadFromWorkspace,
  canEditAiSettings,
  aiConfigured,
  aiModelLabel,
  canRunFeishuConnectionTest,
  canRunFeishuVerifyStart,
  feishuVerifyNeedsSenderOpenId,
  feishuVerifyExpiresInMs,
  setupCards,
  setupCompletedCount,
  setupProgressPercent,
  aiSectionDirty,
  feishuChatDirty,
  pendingCommandCount,
  } = useOpenClawPageContext()

  return (
    <>
          <div className="text-sm text-slate-500">完成以下配置以启用 OpenClaw 全部功能</div>

          <Card>
            <CardHeader>
              <CardTitle>配置向导</CardTitle>
              <CardDescription>按步骤完成核心参数，降低首次配置复杂度</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border bg-slate-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>完成度</span>
                  <span className="font-medium">{setupCompletedCount}/{setupCards.length}（{setupProgressPercent}%）</span>
                </div>
                <div className="mt-2 h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-slate-900 transition-all" style={{ width: `${setupProgressPercent}%` }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {setupCards.map(card => (
                  <div key={card.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{card.label}</span>
                      <Badge variant={card.done ? 'default' : 'secondary'}>{card.done ? '已完成' : '待配置'}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{card.note}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>建议顺序：Gateway → AI引擎 → 自动分析。飞书账号已迁移到策略中心独立配置。</span>
                <Link href="/strategy-center" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  去策略中心配置飞书账号
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>高风险命令确认</CardTitle>
                <CardDescription>
                  已启用自动确认执行；本区域仅展示最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天高风险命令记录。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={pendingCommandCount > 0 ? 'destructive' : 'secondary'}>
                  近{HIGH_RISK_COMMAND_LOOKBACK_DAYS}天 {pendingCommandCount}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadPendingCommandRuns({
                    page: pendingCommandRunsPage })}
                  disabled={pendingCommandRunsLoading}
                >
                  {pendingCommandRunsLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingCommandRunsError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {pendingCommandRunsError}
                </div>
              )}
              {pendingCommandRunsLoading && pendingCommandRuns.length === 0 && (
                <div className="text-sm text-slate-500">高风险命令记录加载中...</div>
              )}
              {!pendingCommandRunsLoading && pendingCommandRuns.length === 0 && (
                <div className="text-sm text-slate-500">
                  最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天暂无高风险命令记录。
                </div>
              )}
              {pendingCommandRuns.length > 0 && (
                <>
                  <Table className="[&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead>创建时间</TableHead>
                        <TableHead>请求</TableHead>
                        <TableHead>风险</TableHead>
                        <TableHead>运行状态</TableHead>
                        <TableHead>确认状态</TableHead>
                        <TableHead>最近更新时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingCommandRuns.map((run) => {
                        const riskBadge = resolveCommandRiskBadge(run.riskLevel)
                        const runPath = `${run.request.method} ${run.request.path}`
                        return (
                          <TableRow key={run.runId}>
                            <TableCell className="text-xs">{formatTimestamp(run.createdAt)}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium">{runPath}</div>
                              <div className="text-slate-500">run: {formatFeishuRunIdShort(run.runId)}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={riskBadge.variant}>{riskBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{run.status}</TableCell>
                            <TableCell className="text-xs">{resolveCommandConfirmStatusText(run.confirmStatus)}</TableCell>
                            <TableCell className="text-xs">
                              {run.updatedAt ? formatTimestamp(run.updatedAt) : '-'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <div className="flex flex-col gap-2 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
                    <div>
                      最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天共 {pendingCommandRunsTotal} 条，
                      第 {pendingCommandRunsPage} / {pendingCommandRunsTotalPages} 页
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingCommandRunsPage((prev) => Math.max(1, prev - 1))}
                        disabled={pendingCommandRunsLoading || pendingCommandRunsPage <= 1}
                      >
                        上一页
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingCommandRunsPage((prev) => Math.min(pendingCommandRunsTotalPages, prev + 1))}
                        disabled={pendingCommandRunsLoading || pendingCommandRunsPage >= pendingCommandRunsTotalPages}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Gateway / 技能状态</CardTitle>
                <CardDescription>实时查看 OpenClaw Gateway 健康度与技能依赖</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canEditAiSettings && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleGatewayHotReload}
                    disabled={gatewayLoading || gatewayReloading}
                  >
                    {gatewayReloading ? '热加载中...' : '配置热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadGatewayStatus(true)}
                  disabled={gatewayLoading || gatewayReloading}
                >
                  {gatewayLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!gatewayStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {gatewayStatus && !gatewayStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {gatewayStatus.error || 'Gateway 状态获取失败'}
                </div>
              )}
              {gatewayStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Gateway</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={gatewayHealth?.ok ? 'default' : 'destructive'}>
                          {gatewayHealth?.ok ? '在线' : '离线'}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {gatewayStatus?.fetchedAt ? formatTimestamp(gatewayStatus.fetchedAt) : '未知'}
                        </span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Channels</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.channelOrder?.length ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Sessions</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.sessions?.count ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">技能可用/总数</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                      </div>
                    </div>
                  </div>

                  {gatewayStatus?.errors && gatewayStatus.errors.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-3">
                      {gatewayStatus.errors.join(' / ')}
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Gateway 健康检查</div>
                    {gatewayHealth ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">耗时</div>
                          <div className="mt-2 text-sm font-medium">
                            {formatDuration(gatewayHealth?.durationMs)}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">默认Agent</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.defaultAgentId || '未知'}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">最近会话数</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.sessions?.recent?.length ?? 0}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无健康检查数据</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Channel 状态</div>
                    {gatewayHealth?.channelOrder?.length ? (
                      <Table className="[&_thead_th]:bg-white">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Channel</TableHead>
                            <TableHead>配置</TableHead>
                            <TableHead>绑定</TableHead>
                            <TableHead>探测</TableHead>
                            <TableHead>上次探测</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gatewayHealth.channelOrder.map((channelKey: string) => {
                            const channel = gatewayHealth.channels?.[channelKey] || {}
                            const label =
                              gatewayHealth.channelLabels?.[channelKey] || channelKey
                            const probeOk = channel?.probe?.ok
                            return (
                              <TableRow key={channelKey}>
                                <TableCell className="font-medium">{label}</TableCell>
                                <TableCell>{renderTriState(channel?.configured)}</TableCell>
                                <TableCell>{renderTriState(channel?.linked)}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      probeOk === true
                                        ? 'default'
                                        : probeOk === false
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    {probeOk === true ? 'OK' : probeOk === false ? 'Fail' : '未知'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {formatTimestamp(channel?.lastProbeAt || channel?.lastProbeAtMs)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-sm text-slate-500">暂无 Channel 数据</div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-700">技能状态</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="whitespace-nowrap">
                          可用 {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setGatewaySkillsCollapsed((prev) => !prev)}
                        >
                          {gatewaySkillsCollapsed ? '展开列表' : '收起列表'}
                        </Button>
                      </div>
                    </div>
                    {gatewaySkillsCollapsed ? (
                      <div className="text-sm text-slate-500">
                        默认仅展示“可用”技能，点击“展开列表”查看明细。
                      </div>
                    ) : gatewaySkillsList.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span>仅看可用</span>
                            <Switch
                              checked={gatewayShowAvailableOnly}
                              onCheckedChange={setGatewayShowAvailableOnly}
                              aria-label="仅显示可用技能"
                            />
                          </label>
                        </div>
                        {gatewayVisibleSkills.length > 0 ? (
                          <Table className="table-fixed [&_thead_th]:bg-white">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[34%]">技能</TableHead>
                                <TableHead className="w-[110px] whitespace-nowrap">状态</TableHead>
                                <TableHead className="w-[34%]">缺失项</TableHead>
                                <TableHead className="w-[22%]">安装建议</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {gatewayVisibleSkills.map((item) => (
                                <TableRow key={item.skill?.skillKey || item.skill?.name}>
                                  <TableCell className="align-top">
                                    <div className="font-medium">{item.skill?.name || item.skill?.skillKey}</div>
                                    <div className="text-xs text-slate-500">{item.skill?.description}</div>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap align-top">
                                    <Badge variant={item.status.variant} className="whitespace-nowrap">
                                      {item.status.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.missingItems.length > 0 ? item.missingItems.join(', ') : '—'}
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.installHint || '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <div className="text-sm text-slate-500">暂无可用技能，点击“显示全部状态”查看其他状态。</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无技能数据</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  SOUL 工作区
                  <Badge variant={workspaceReady ? 'default' : 'secondary'} className="text-[11px]">{workspaceReady ? '已就绪' : '待补齐'}</Badge>
                </CardTitle>
                <CardDescription>检查并补齐 AGENTS/SOUL/USER/MEMORY 与每日记忆文件</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canReloadFromWorkspace && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleWorkspaceBootstrapAndReload}
                    disabled={workspaceLoading || workspaceBootstrapping || gatewayReloading}
                  >
                    {(workspaceBootstrapping || gatewayReloading) ? '处理中...' : '补齐并热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadWorkspaceStatus(true)}
                  disabled={workspaceLoading || workspaceBootstrapping}
                >
                  {workspaceLoading ? '刷新中...' : '刷新'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleWorkspaceBootstrap()}
                  disabled={workspaceBootstrapping || gatewayReloading}
                >
                  {workspaceBootstrapping ? '补齐中...' : '一键补齐'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!workspaceStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {workspaceStatus && !workspaceStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {workspaceStatus.error || 'SOUL 工作区状态获取失败'}
                </div>
              )}
              {workspaceStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">工作区目录</div>
                      <div className="mt-2 text-xs break-all">{workspaceStatus.workspaceDir || '未知'}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">路径来源</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="outline">{workspaceSourceLabel}</Badge>
                        <span className="text-xs text-slate-500">{workspaceStatus.runtimeWorkspaceDir ? 'runtime 生效' : '按规则推导'}</span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">缺失模板文件</div>
                      <div className="mt-2 text-lg font-semibold">{workspaceMissingFiles.length}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">今日记忆文件</div>
                      <div className="mt-2">
                        <Badge variant={workspaceStatus.dailyMemoryExists ? 'default' : 'secondary'}>
                          {workspaceStatus.dailyMemoryExists ? '已生成' : '未生成'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {workspaceStatus.dailyMemoryPath && (
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600 break-all">
                      每日记忆路径：{workspaceStatus.dailyMemoryPath}
                    </div>
                  )}

                  <Table className="[&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[20%]">文件</TableHead>
                        <TableHead className="w-[16%]">状态</TableHead>
                        <TableHead className="w-[44%]">路径</TableHead>
                        <TableHead className="w-[20%]">更新时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workspaceFiles.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">暂无文件状态</TableCell>
                        </TableRow>
                      )}
                      {workspaceFiles.map((file) => (
                        <TableRow key={file.path}>
                          <TableCell className="font-medium">{file.name}</TableCell>
                          <TableCell>
                            <Badge variant={file.exists ? 'default' : 'destructive'}>{file.exists ? '已存在' : '缺失'}</Badge>
                          </TableCell>
                          <TableCell className="text-xs break-all text-slate-600">{file.path}</TableCell>
                          <TableCell className="text-xs text-slate-500">{formatTimestamp(file.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {workspaceMissingFiles.length > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      缺失文件：{workspaceMissingFiles.join(', ')}。点击“一键补齐”自动创建。
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                AI 引擎
                <Badge variant="secondary" className="text-[11px]">全局配置</Badge>
                <Badge variant={canEditAiSettings ? 'default' : 'outline'} className="text-[11px]">
                  {canEditAiSettings ? '管理员可编辑' : '成员只读'}
                </Badge>
                {aiSectionDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="AI 配置未保存" />}
              </CardTitle>
              <CardDescription>
                全局配置：仅管理员可修改；普通成员只读查看当前生效模型
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditAiSettings && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前账号为普通成员，仅可查看 AI 引擎配置。请联系管理员修改。
                </div>
              )}
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                JSON 格式：顶层 providers 对象，每个 provider 包含 baseUrl、apiKey、api 和 models 数组。详见配置指南。
              </div>
              <div className="grid gap-4 rounded-md border px-3 py-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">当前给 OpenClaw 使用的模型</div>
                  <div className="truncate text-sm font-medium" title={aiModelLabel || '未识别'}>
                    {aiModelLabel || '未识别（请检查 Providers JSON）'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">切换模型</label>
                  <Select
                    value={aiSelectedModelRef || undefined}
                    onValueChange={handleAiModelChange}
                    disabled={!canEditAiSettings || Boolean(aiModelsInfo.parseError) || aiModelOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={aiModelOptions.length > 0 ? '选择可用模型' : '暂无可用模型'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {aiModelOptions.map((option) => (
                        <SelectItem key={option.modelRef} value={option.modelRef}>
                          {option.modelName} ({option.modelRef})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!aiModelsInfo.parseError && aiConfigured && aiModelOptions.length === 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前 JSON 中未解析到可用模型，请确认 models.providers.[provider].models 配置。
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Providers JSON
                  <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFormatAiJson}
                    disabled={!canEditAiSettings}
                  >
                    格式化JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUserValue('ai_models_json', AI_MINIMAL_PLACEHOLDER)
                      setAiJsonError(null)
                    }}
                    disabled={!canEditAiSettings}
                  >
                    最小模板
                  </Button>
                </div>
              </div>
              {aiJsonError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  JSON 格式错误：{aiJsonError}
                </div>
              )}
              <Textarea
                value={userValues.ai_models_json || ''}
                onChange={(e) => {
                  setUserValue('ai_models_json', e.target.value)
                  setAiJsonError(validateAiJson(e.target.value))
                }}
                placeholder={AI_MINIMAL_PLACEHOLDER}
                rows={10}
                disabled={!canEditAiSettings}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    const jsonErr = validateAiJson(userValues.ai_models_json || '')
                    if (jsonErr) {
                      setAiJsonError(jsonErr)
                      toast.error('AI Providers JSON 格式错误，请修正后再保存')
                      return
                    }
                    setAiJsonError(null)
                    saveSettings({ scope: 'global', keys: [...AI_GLOBAL_KEYS], successMessage: 'AI 配置已保存（全局）' })
                  }}
                  disabled={savingUser || !canEditAiSettings}
                >
                  {savingUser ? '保存中...' : aiSectionDirty ? '保存 AI 配置 *' : '保存 AI 配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>功能拆分提示</CardTitle>
              <CardDescription>
                联盟平台配置已迁移到「Settings / 联盟同步」，策略中心与飞书相关配置已迁移到「策略中心」。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/settings?category=affiliate_sync" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                前往联盟同步设置
              </Link>
              <Link href="/strategy-center" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                前往策略中心
              </Link>
            </CardContent>
          </Card>

          <Card className="hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                飞书聊天
                {feishuChatDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="飞书配置未保存" />}
              </CardTitle>
              <CardDescription>最小必填：App ID / App Secret / 推送目标</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 text-xs">
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-600 space-y-1">
                  <div className="font-medium text-slate-800">聊天参数（* 为必需）</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App ID</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App Secret</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书推送目标（open_id / union_id / chat_id）</div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">高级参数（通信鉴权）默认已预置，按需展开</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFeishuAdvanced((prev) => !prev)}
                >
                  {showFeishuAdvanced ? '收起高级参数' : '展开高级参数'}
                </Button>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                高风险命令已启用自动确认执行；控制面仅保留近 7 天审计记录展示。
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InputWithLabel
                  label="飞书 App ID"
                  required
                  value={userValues.feishu_app_id || ''}
                  onChange={(v) => setUserValue('feishu_app_id', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_id}
                />
                <InputWithLabel
                  label="飞书推送目标（open_id / union_id / chat_id）"
                  required
                  value={userValues.feishu_target || ''}
                  onChange={(v) => setUserValue('feishu_target', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_target}
                />
                <InputWithLabel
                  label="飞书 App Secret"
                  required
                  type="password"
                  value={userValues.feishu_app_secret || ''}
                  onChange={(v) => setUserValue('feishu_app_secret', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_secret}
                />
              </div>

              {showFeishuAdvanced && (
                <>
                  <div className="rounded-md border px-4 py-3 space-y-4">
                    <div className="text-sm font-medium">通信与鉴权（建议配置，已预置默认值）</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">飞书域名</label>
                        <Select
                          value={userValues.feishu_domain || 'feishu'}
                          onValueChange={(v) => setUserValue('feishu_domain', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择域名" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="feishu">feishu</SelectItem>
                            <SelectItem value="lark">lark</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <InputWithLabel
                        label="Bot 展示名（可选）"
                        value={userValues.feishu_bot_name || ''}
                        onChange={(v) => setUserValue('feishu_bot_name', v)}
                        placeholder="OpenClaw 助手"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">鉴权模式</label>
                        <Select
                          value={userValues.feishu_auth_mode || 'strict'}
                          onValueChange={(v) => setUserValue('feishu_auth_mode', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择模式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">strict（推荐）</SelectItem>
                            <SelectItem value="compat">compat（兼容）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <SwitchWithLabel
                        label="Require Tenant Key"
                        checked={isTruthy(userValues.feishu_require_tenant_key, true)}
                        onChange={(val) => setUserValue('feishu_require_tenant_key', val ? 'true' : 'false')}
                      />
                      <SwitchWithLabel
                        label="Strict Auto Bind"
                        checked={isTruthy(userValues.feishu_strict_auto_bind, true)}
                        onChange={(val) => setUserValue('feishu_strict_auto_bind', val ? 'true' : 'false')}
                      />
                    </div>

                    <p className="text-xs text-slate-500">
                      默认已自动填写：domain=feishu、authMode=strict、Require Tenant Key=true、Strict Auto Bind=true。仅在迁移历史账号时短暂使用 compat。
                    </p>
                  </div>
                </>
              )}

              <div className="grid gap-2 md:grid-cols-3 text-xs">
                <div className={hasText(userValues.feishu_app_id) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_id) ? '✓ App ID 已填写' : '• App ID 未填写'}
                </div>
                <div className={hasText(userValues.feishu_app_secret) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_secret)
                    ? '✓ Secret 已填写'
                    : '• Secret 未填写'}
                </div>
                <div className={hasText(userValues.feishu_target) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_target) ? '✓ 推送目标已填写' : '• 推送目标未填写'}
                </div>
                {showFeishuAdvanced && (
                  <>
                    <div className={isTruthy(userValues.feishu_require_tenant_key, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_require_tenant_key, true)
                        ? '✓ Tenant Key 校验已启用'
                        : '• Tenant Key 校验未启用（兼容模式）'}
                    </div>
                    <div className={isTruthy(userValues.feishu_strict_auto_bind, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_strict_auto_bind, true)
                        ? '✓ Strict Auto Bind 已启用'
                        : '• Strict Auto Bind 未启用'}
                    </div>
                    <div className={(userValues.feishu_auth_mode || 'strict') === 'strict' ? 'text-emerald-600' : 'text-amber-600'}>
                      {(userValues.feishu_auth_mode || 'strict') === 'strict'
                        ? '✓ 鉴权模式 strict'
                        : '• 鉴权模式 compat（迁移用）'}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-md border bg-slate-50 px-3 py-3 space-y-3">
                <div className="text-sm font-medium text-slate-800">双向通信验证（半自动）</div>
                <p className="text-xs text-slate-600">
                  点击“验证双向通信”后，系统会向当前 target 发送随机验证码（5分钟有效）；请在同一会话用指定 open_id 回复后，再点击“校验回执”。
                </p>

                {feishuVerifyNeedsSenderOpenId && (
                  <InputWithLabel
                    label="验证发送者 open_id（target 非 open_id 时建议填写）"
                    value={feishuVerifySenderOpenId}
                    onChange={setFeishuVerifySenderOpenId}
                    placeholder="ou_xxx"
                  />
                )}

                {feishuVerifySession && (
                  <div className="grid gap-2 md:grid-cols-2 text-xs text-slate-600">
                    <div>验证码：<code>{feishuVerifySession.code}</code></div>
                    <div>有效期：{formatCountdown(feishuVerifyExpiresInMs)}</div>
                    <div>验证发送者：<code>{feishuVerifySession.expectedSenderOpenId}</code></div>
                    <div>会话ID：<code>{feishuVerifySession.verificationId}</code></div>
                    <div className="md:col-span-2">过期时间：{formatTimestamp(feishuVerifySession.expiresAt)}</div>
                  </div>
                )}

                {feishuVerifyResult && (
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      feishuVerifyResult.verified
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : feishuVerifyResult.pending
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-red-300 bg-red-50 text-red-700'
                    }`}
                  >
                    {feishuVerifyResult.message}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuTestConnection}
                    disabled={feishuTestLoading || !canRunFeishuConnectionTest}
                    title={canRunFeishuConnectionTest ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                  >
                    {feishuTestLoading ? '测试中...' : '测试连接'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuStartVerify}
                    disabled={feishuVerifyLoading || !canRunFeishuVerifyStart}
                    title={canRunFeishuVerifyStart ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                  >
                    {feishuVerifyLoading ? '发送中...' : '验证双向通信'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuCheckVerify}
                    disabled={feishuVerifyChecking || !feishuVerifySession?.verificationId}
                    title={feishuVerifySession?.verificationId ? undefined : '请先发送验证码'}
                  >
                    {feishuVerifyChecking ? '校验中...' : '校验回执'}
                  </Button>
                  {feishuTestResult && (
                    <Badge variant={feishuTestResult.ok ? 'default' : 'destructive'}>
                      {feishuTestResult.ok ? '连接成功' : feishuTestResult.message}
                    </Badge>
                  )}
                </div>
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: [...FEISHU_CHAT_USER_KEYS], successMessage: '飞书配置已保存' })}
                  disabled={savingUser || !canRunFeishuConnectionTest}
                  title={canRunFeishuConnectionTest ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                >
                  {savingUser ? '保存中...' : feishuChatDirty ? '保存飞书配置 *' : '保存飞书配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>联盟平台</CardTitle>
              <CardDescription>联盟配置已迁移到系统设置页，OpenClaw 页面仅保留只读入口。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-800">
                请前往 <span className="font-mono">/settings?category=affiliate_sync</span> 维护联盟凭证与佣金同步参数。
              </div>
              <div className="flex justify-end gap-2">
                <Link
                  href="/openclaw/affiliate-commission"
                  className={buttonVariants({ variant: 'outline' })}
                >
                  查看佣金原始数据
                </Link>
                <Link
                  href="/settings?category=affiliate_sync"
                  className={buttonVariants({ variant: 'outline' })}
                >
                  前往 Settings 配置
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>OpenClaw Access Tokens</CardTitle>
              <CardDescription>用于 OpenClaw 调用 AutoAds API（用户级隔离）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {newToken && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm">
                  新Token：<span className="font-mono break-all">{newToken}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <Button onClick={handleCreateToken}>生成新Token</Button>
              </div>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        暂无Token
                      </TableCell>
                    </TableRow>
                  )}
                  {tokens.map(token => (
                    <TableRow key={token.id}>
                      <TableCell>{token.name || 'OpenClaw Token'}</TableCell>
                      <TableCell>
                        <Badge variant={token.status === 'active' ? 'default' : 'secondary'}>
                          {token.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{token.created_at}</TableCell>
                      <TableCell>{token.last_used_at || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" onClick={() => handleRevokeToken(token.id)}>
                          撤销
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
    </>
  )
}

'use client'

import { Eye } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'


import {
  formatAgeSeconds,
  formatFeishuRunIdShort,
  formatTimestamp,
  formatTimestampCompactLines,
  hasText,
  resolveFeishuExecutionBadge,
  resolveFeishuHealthDecisionBadge,
  resolveFeishuHealthSenderText,
  resolveFeishuWorkflowBadge,
} from '../utils'

import { useOpenClawPageContext } from '../openclaw-page-context'

export function OpenClawFeishuHealthTab() {
  const {
  feishuHealthLoading,
  feishuHealthError,
  feishuHealthDialogItem,
  setFeishuHealthDialogItem,
  loadFeishuHealthData,
  feishuHealthRows,
  feishuHealthStats,
  feishuHealthExecutionStats,
  feishuHealthWorkflowStats,
  feishuHealthWindowDays,
  feishuHealthRetentionDays,
  feishuHealthExcerptLimit,
  feishuHealthExecutionMissingSeconds,
  } = useOpenClawPageContext()

  return (
    <>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>飞书聊天链路健康页</CardTitle>
                  <CardDescription>
                    最近 {feishuHealthWindowDays} 天消息链路诊断（保留 {feishuHealthRetentionDays} 天，列表片段最多 {feishuHealthExcerptLimit} 字，放行后超过 {feishuHealthExecutionMissingSeconds}s 无执行记录标记为断链）
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={feishuHealthLoading}
                  onClick={() => {
                    void loadFeishuHealthData()
                  }}
                >
                  {feishuHealthLoading ? '刷新中...' : '刷新'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {feishuHealthError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {feishuHealthError}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">总消息</div>
                    <div className="mt-1 text-xl font-semibold">{feishuHealthStats.total}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">放行</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthStats.allowed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">拦截</div>
                    <div className="mt-1 text-xl font-semibold text-amber-600">{feishuHealthStats.blocked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">错误</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthStats.error}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">已关联执行</div>
                    <div className="mt-1 text-xl font-semibold text-sky-600">{feishuHealthExecutionStats.linked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">已完成</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthExecutionStats.completed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">执行中</div>
                    <div className="mt-1 text-xl font-semibold text-indigo-600">{feishuHealthExecutionStats.inProgress}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">等待落库</div>
                    <div className="mt-1 text-xl font-semibold text-amber-600">{feishuHealthExecutionStats.waiting}</div>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <div className="text-xs text-red-600">断链</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthExecutionStats.missing}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">执行失败</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthExecutionStats.failed}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务跟踪</div>
                    <div className="mt-1 text-xl font-semibold text-sky-600">{feishuHealthWorkflowStats.tracked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务完成</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthWorkflowStats.completed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务执行中</div>
                    <div className="mt-1 text-xl font-semibold text-indigo-600">{feishuHealthWorkflowStats.running}</div>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <div className="text-xs text-red-600">业务未完成</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthWorkflowStats.incomplete}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务失败</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthWorkflowStats.failed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">无需跟踪</div>
                    <div className="mt-1 text-xl font-semibold text-slate-600">{feishuHealthWorkflowStats.notRequired}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>链路明细</CardTitle>
                <CardDescription>每条消息显示放行/拦截原因，默认展示原文前 {feishuHealthExcerptLimit} 字片段</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="table-fixed min-w-[1460px] [&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 w-[86px] whitespace-nowrap">时间</TableHead>
                        <TableHead className="h-8 w-[88px] whitespace-nowrap">记录ID</TableHead>
                        <TableHead className="h-8 w-[78px] whitespace-nowrap">决策</TableHead>
                        <TableHead className="h-8 w-[88px] whitespace-nowrap">执行状态</TableHead>
                        <TableHead className="h-8 w-[96px] whitespace-nowrap">业务状态</TableHead>
                        <TableHead className="h-8 w-[21%] whitespace-nowrap">链路详情</TableHead>
                        <TableHead className="h-8 w-[18%] whitespace-nowrap">原因</TableHead>
                        <TableHead className="h-8 w-[11%] whitespace-nowrap">发送者</TableHead>
                        <TableHead className="h-8 w-[11%] whitespace-nowrap">会话</TableHead>
                        <TableHead className="h-8 w-[20%] whitespace-nowrap">消息片段</TableHead>
                        <TableHead className="h-8 w-[56px] whitespace-nowrap text-center">原文</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feishuHealthRows.map((row) => {
                        const decisionBadge = resolveFeishuHealthDecisionBadge(row.decision)
                        const executionBadge = resolveFeishuExecutionBadge(row.executionState)
                        const workflowBadge = resolveFeishuWorkflowBadge(row.workflowState)
                        const senderText = resolveFeishuHealthSenderText(row)
                        const chatText = row.chatId || '-'
                        const excerpt = row.messageExcerpt || '-'
                        const reasonText = row.reasonMessage ? `${row.reasonCode || '-'} · ${row.reasonMessage}` : row.reasonCode || '-'
                        const executionRunId = row.executionRunId || ''
                        const executionRunStatus = row.executionRunStatus || '-'
                        const executionRunCreatedAt = row.executionRunCreatedAt ? formatTimestamp(row.executionRunCreatedAt) : '-'
                        const executionRunCount = Number.isFinite(row.executionRunCount) ? row.executionRunCount : 0
                        const executionAgeText = row.decision === 'allowed' ? formatAgeSeconds(row.ageSeconds) : '-'
                        const workflowProgress = Number.isFinite(row.workflowProgress) ? Math.max(0, Math.min(100, Math.floor(row.workflowProgress))) : 0
                        const workflowProgressText = row.workflowState === 'not_required' ? '-' : `${workflowProgress}%`
                        const timestampLines = formatTimestampCompactLines(row.createdAt)
                        const canViewFullText = hasText(row.messageText || '')
                        const isMissing = row.executionState === 'missing'
                        const isWorkflowRisk = row.workflowState === 'incomplete' || row.workflowState === 'failed'

                        return (
                          <TableRow key={row.id} className={isMissing || isWorkflowRisk ? 'bg-red-50/70' : undefined}>
                            <TableCell className="whitespace-nowrap py-1.5 text-[11px] leading-4 text-slate-600">
                              <div>{timestampLines.date}</div>
                              <div className="text-slate-500">{timestampLines.time}</div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 font-mono text-xs text-slate-700">
                              {row.id}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={decisionBadge.variant}>{decisionBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={executionBadge.variant}>{executionBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={workflowBadge.variant}>{workflowBadge.label}</Badge>
                              <div className="mt-1 text-[11px] text-slate-500">{workflowProgressText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top text-xs">
                              <div className="line-clamp-2 break-all font-medium leading-4" title={row.workflowDetail || '-'}>
                                {row.workflowDetail || '-'}
                              </div>
                              <div className="mt-1 line-clamp-2 break-all leading-4 text-slate-600" title={row.executionDetail || '-'}>
                                {row.executionDetail || '-'}
                              </div>
                              <div
                                className="mt-1 line-clamp-2 break-all font-mono text-[11px] leading-4 text-slate-500"
                                title={`run:${executionRunId || '-'} · status:${executionRunStatus} · created:${executionRunCreatedAt} · count:${executionRunCount} · age:${executionAgeText}`}
                              >
                                {`run:${formatFeishuRunIdShort(executionRunId)}`} · {executionRunStatus} · {executionRunCount}条 · {executionAgeText}
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top">
                              <div className="line-clamp-2 break-all text-xs font-medium leading-4" title={reasonText}>{reasonText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top font-mono text-xs">
                              <div className="line-clamp-2 break-all leading-4" title={senderText}>{senderText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top font-mono text-xs">
                              <div className="line-clamp-2 break-all leading-4" title={chatText}>{chatText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top text-xs text-slate-700">
                              <div className="line-clamp-2 break-all leading-4" title={excerpt}>{excerpt}</div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 text-center">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label={canViewFullText ? '查看原文' : '无原文可查看'}
                                title={canViewFullText ? '查看原文' : '无原文可查看'}
                                disabled={!canViewFullText}
                                onClick={() => setFeishuHealthDialogItem(row)}
                              >
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}

                      {feishuHealthRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-slate-500">
                            最近 {feishuHealthWindowDays} 天暂无飞书链路日志
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Dialog
              open={Boolean(feishuHealthDialogItem)}
              onOpenChange={(open) => {
                if (!open) {
                  setFeishuHealthDialogItem(null)
                }
              }}
            >
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>飞书消息原文</DialogTitle>
                  <DialogDescription>
                    {feishuHealthDialogItem
                      ? `${formatTimestamp(feishuHealthDialogItem.createdAt)} · ${feishuHealthDialogItem.reasonCode || '-'} · ${resolveFeishuHealthSenderText(feishuHealthDialogItem)}`
                      : '消息详情'}
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto rounded-md border bg-slate-50 p-3 text-xs whitespace-pre-wrap break-all">
                  {feishuHealthDialogItem?.messageText || '-'}
                </div>
              </DialogContent>
            </Dialog>
    </>
  )
}

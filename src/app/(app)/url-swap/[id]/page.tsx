'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  RefreshCw,
  Play,
  Pause,
  Calendar,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import type { UrlSwapTask, UrlSwapTaskTarget } from '@/lib/url-swap-types';
import UrlSwapHistory from '@/components/UrlSwapHistory';

function groupTargetsByAccount(targets: UrlSwapTaskTarget[]) {
  const groups = new Map<string, { accountId: number; customerId: string; targets: UrlSwapTaskTarget[] }>();
  targets.forEach((target) => {
    const key = `${target.google_ads_account_id}-${target.google_customer_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        accountId: target.google_ads_account_id,
        customerId: target.google_customer_id,
        targets: []
      });
    }
    groups.get(key)!.targets.push(target);
  });
  return Array.from(groups.values());
}

export default function UrlSwapTaskDetailPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = typeof params?.id === 'string' ? params.id : '';

  // Data states
  const [task, setTask] = useState<UrlSwapTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (taskId) {
      loadTask();
    }
  }, [taskId]);

  const loadTask = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/url-swap/tasks/${taskId}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '获取任务失败');
      }

      const data = await response.json();
      setTask(data.data);
    } catch (error: any) {
      console.error('加载任务失败:', error);
      toast.error(error.message || '加载任务失败');
      router.push('/url-swap');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateValue: string | null): string => {
    if (!dateValue) return '-';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) {
        return '-';
      }
      return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (error) {
      console.error('日期格式化失败:', dateValue, error);
      return '-';
    }
  };

  const formatDate = (dateValue: string | null): string => {
    if (!dateValue) return '-';
    return dateValue.split('T')[0];
  };

  const handleSwapNow = async () => {
    try {
      setActionLoading('swap-now');
      const response = await fetch(`/api/url-swap/tasks/${taskId}/swap-now`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || '立即执行失败');
      }

      toast.success(data.message || '任务已加入队列');
      await loadTask();
    } catch (error: any) {
      toast.error(error.message || '立即执行失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisableTask = async () => {
    try {
      setActionLoading('disable');
      const response = await fetch(`/api/url-swap/tasks/${taskId}/disable`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '暂停任务失败');
      }

      toast.success('任务已暂停');
      await loadTask();
    } catch (error: any) {
      toast.error(error.message || '暂停任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnableTask = async () => {
    try {
      setActionLoading('enable');
      const response = await fetch(`/api/url-swap/tasks/${taskId}/enable`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '恢复任务失败');
      }

      toast.success('任务已恢复');
      await loadTask();
    } catch (error: any) {
      toast.error(error.message || '恢复任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      enabled: { label: '运行中', variant: 'default', className: 'bg-green-600' },
      disabled: { label: '已暂停', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
      error: { label: '异常', variant: 'destructive', className: '' },
      completed: { label: '已完成', variant: 'default', className: 'bg-blue-600' },
    };
    const config = configs[status] || { label: status, variant: 'outline' as const, className: '' };

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getTargetStatusBadge = (status: UrlSwapTaskTarget['status']) => {
    const configs: Record<UrlSwapTaskTarget['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      active: { label: '启用', variant: 'default', className: 'bg-green-600' },
      paused: { label: '暂停', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
      removed: { label: '已移除', variant: 'outline', className: 'text-gray-500' },
      invalid: { label: '无效', variant: 'destructive', className: '' },
    };

    const config = configs[status] || { label: status, variant: 'outline' as const, className: '' };

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const rawTargets = task?.targets ?? [];
  const legacyTargets: UrlSwapTaskTarget[] =
    task && rawTargets.length === 0 && task.google_customer_id && task.google_campaign_id
      ? [{
          id: 'legacy',
          task_id: task.id,
          offer_id: task.offer_id,
          google_ads_account_id: 0,
          google_customer_id: task.google_customer_id,
          google_campaign_id: task.google_campaign_id,
          status: 'active',
          consecutive_failures: 0,
          last_success_at: null,
          last_error: null,
          created_at: '',
          updated_at: ''
        }]
      : [];

  const targets = rawTargets.length > 0 ? rawTargets : legacyTargets;
  const isLegacyTargets = rawTargets.length === 0 && legacyTargets.length > 0;

  const groupedTargets = targets.length > 0 ? groupTargetsByAccount(targets) : [];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!task) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/url-swap')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                返回列表
              </Button>
              <Separator orientation="vertical" className="h-6" />
              <h1 className="text-xl font-bold text-gray-900">换链任务详情</h1>
              {getStatusBadge(task.status)}
            </div>
            <div className="flex items-center gap-3">
              {task.status === 'enabled' && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleSwapNow}
                    disabled={actionLoading === 'swap-now'}
                    className="flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    立即执行
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDisableTask}
                    disabled={actionLoading === 'disable'}
                    className="flex items-center gap-2"
                  >
                    <Pause className="w-4 h-4" />
                    暂停
                  </Button>
                </>
              )}
              {task.status === 'disabled' && (
                <Button
                  variant="default"
                  onClick={handleEnableTask}
                  disabled={actionLoading === 'enable'}
                  className="flex items-center gap-2"
                >
                  <Play className="w-4 h-4" />
                    恢复
                </Button>
              )}
              <Button
                variant="outline"
                onClick={loadTask}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">基本信息</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">任务ID</p>
                  <p className="font-mono text-sm">{task.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Offer ID</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-blue-600"
                    onClick={() => router.push(`/offers/${task.offer_id}`)}
                  >
                    #{task.offer_id}
                  </Button>
                </div>
                <div>
                  <p className="text-sm text-gray-500">换链间隔</p>
                  <p className="font-medium">{task.swap_interval_minutes} 分钟</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">持续天数</p>
                  <p className="font-medium">{task.duration_days} 天</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">执行状态</p>
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusBadge(task.status)}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500">完成进度</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <span className="text-sm">{task.progress}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">执行统计</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">总执行次数</span>
                <span className="font-bold text-lg">{task.total_swaps}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">成功次数</span>
                <span className="font-bold text-green-600">{task.success_swaps}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">失败次数</span>
                <span className="font-bold text-red-600">{task.failed_swaps}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">链接变更次数</span>
                <span className="font-bold text-purple-600">{task.url_changed_count}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">成功率</span>
                <span className="font-bold">
                  {task.total_swaps > 0
                    ? ((task.success_swaps / task.total_swaps) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* URLs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LinkIcon className="w-5 h-5" />
                当前追踪链接
              </CardTitle>
            </CardHeader>
            <CardContent>
              {task.current_final_url ? (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-50 rounded-lg break-all text-sm">
                    {task.current_final_url}
                  </div>
                  <a
                    href={task.current_final_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                  >
                    <ExternalLink className="w-3 h-3" />
                    访问链接
                  </a>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">暂无链接</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LinkIcon className="w-5 h-5" />
                当前 URL Suffix
              </CardTitle>
            </CardHeader>
            <CardContent>
              {task.current_final_url_suffix ? (
                <div className="p-3 bg-gray-50 rounded-lg break-all text-sm">
                  {task.current_final_url_suffix}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">暂无 URL Suffix</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Google Ads Config */}
        {(task.google_customer_id || task.google_campaign_id) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Google Ads 配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Customer ID</p>
                  <p className="font-mono">{task.google_customer_id || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Campaign ID</p>
                  <p className="font-mono">{task.google_campaign_id || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Targets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">换链目标列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {targets.length === 0 ? (
              <p className="text-sm text-gray-500">暂无目标（请先发布 Campaign 或刷新任务）</p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>目标数：{targets.length}</span>
                  {isLegacyTargets && (
                    <span className="text-amber-600">旧任务兼容模式（仅单目标）</span>
                  )}
                </div>
                <div className="space-y-4">
                  {groupedTargets.map((group) => (
                    <div key={`${group.accountId}-${group.customerId}`} className="border rounded-lg bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          Ads账号 {group.accountId || '未知'} · Customer {group.customerId}
                        </div>
                        <div className="text-xs text-gray-500">
                          Campaign 数量：{group.targets.length}
                        </div>
                      </div>
                      <div className="divide-y">
                        {group.targets.map((target) => (
                          <div key={target.id} className="grid grid-cols-1 md:grid-cols-6 gap-3 px-4 py-3 text-sm">
                            <div className="md:col-span-2">
                              <p className="text-xs text-gray-500">Campaign ID</p>
                              <p className="font-mono break-all">{target.google_campaign_id}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">状态</p>
                              <div className="mt-1">{getTargetStatusBadge(target.status)}</div>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">连续失败</p>
                              <p className="font-medium">{target.consecutive_failures}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">最近成功</p>
                              <p className="font-medium">{formatDateTime(target.last_success_at)}</p>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-xs text-gray-500">最近错误</p>
                              <p className="text-xs text-gray-600 break-all">
                                {target.last_error || '-'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Error Info */}
        {task.status === 'error' && task.error_message && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-lg text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                错误信息
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-red-600">{task.error_message}</p>
              {task.error_at && (
                <p className="text-sm text-red-500 mt-2">
                  发生时间: {formatDateTime(task.error_at)}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">创建时间</p>
                <p className="font-medium">{formatDateTime(task.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">开始时间</p>
                <p className="font-medium">{formatDateTime(task.started_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">完成时间</p>
                <p className="font-medium">{formatDateTime(task.completed_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">下次执行</p>
                <p className="font-medium">{formatDateTime(task.next_swap_at)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Button
            variant="outline"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            查看历史记录
          </Button>
        </div>
      </main>

      {/* History Dialog */}
      <UrlSwapHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        taskId={taskId}
      />
    </div>
  );
}

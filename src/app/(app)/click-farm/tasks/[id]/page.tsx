'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  Clock,
  TrendingUp,
  CheckCircle,
  Activity,
  Play,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { getDateInTimezone } from '@/lib/timezone-utils';

const TaskDetailAnalyticsSection = dynamic(() => import('./TaskDetailAnalyticsSection'), {
  ssr: false,
  loading: () => <TaskDetailAnalyticsSectionSkeleton />,
});

interface TaskDetails {
  task: any;
  statistics: {
    success_rate: number;
    total_traffic: number;
    duration_days: number;
    duration_hours: number;
    avg_daily_clicks: number;
    best_day: any;
    worst_day: any;
  };
  offer: {
    id: number;
    name: string;
    brand: string;
    target_country: string;
    affiliate_link: string;
  };
}

function TaskDetailAnalyticsSectionSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-52 rounded bg-gray-100" />
            <div className="h-[300px] rounded bg-gray-100" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="h-6 w-40 rounded bg-gray-100" />
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params?.id as string;

  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsSectionMounted, setAnalyticsSectionMounted] = useState(false);

  const getTodayProgressInfo = (task: any): { percent: number; actual: number; target: number } | null => {
    try {
      if (!task?.timezone) return null;
      const today = getDateInTimezone(new Date(), task.timezone);
      const entry = Array.isArray(task.daily_history)
        ? task.daily_history.find((e: any) => e?.date === today)
        : null;
      const target = Number(entry?.target ?? task.daily_click_count ?? 0) || 0;
      const actual = Number(entry?.actual ?? 0) || 0;
      const percent = target > 0 ? Math.min(100, Math.floor((actual / target) * 100)) : 0;
      return { percent, actual, target };
    } catch {
      return null;
    }
  };
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadTaskDetails();
  }, [taskId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnalyticsSectionMounted(true);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const loadTaskDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/details`);

      if (!response.ok) {
        throw new Error('Failed to load task details');
      }

      const data = await response.json();
      setDetails(data.data);
    } catch (error: any) {
      console.error('Failed to load task details:', error);
      toast.error(error.message || '加载任务详情失败');
      router.push('/click-farm');
    } finally {
      setLoading(false);
    }
  };

  const handleStopTask = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '暂停任务失败');
      }

      toast.success('任务已暂停');
      await loadTaskDetails();
    } catch (error: any) {
      console.error('暂停任务失败:', error);
      toast.error(error.message || '暂停任务失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestartTask = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/restart`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '重启任务失败');
      }

      toast.success('任务已重启');
      await loadTaskDetails();
    } catch (error: any) {
      console.error('重启任务失败:', error);
      toast.error(error.message || '重启任务失败');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      running: 'default',
      pending: 'secondary',
      paused: 'secondary',
      stopped: 'secondary',
      completed: 'success',
    };

    const labels: Record<string, string> = {
      running: '运行中',
      pending: '等待中',
      paused: '已暂停',
      stopped: '已暂停',
      completed: '已完成',
    };

    return (
      <Badge variant={variants[status] || 'default'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 🆕 格式化日期显示（处理Date对象和ISO字符串）
  const formatDate = (dateValue: any): string => {
    if (!dateValue) return '-';
    if (dateValue instanceof Date) {
      return dateValue.toISOString().split('T')[0];
    }
    if (typeof dateValue === 'string') {
      return dateValue.split('T')[0];
    }
    return String(dateValue);
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!details) {
    return null;
  }

  const { task, statistics, offer } = details;

  // Prepare distribution chart data
  // hourly_breakdown 格式: [{actual, success, failed}, ...] (24小时)
  const todayInTaskTimezone = task?.timezone
    ? getDateInTimezone(new Date(), task.timezone)
    : new Date().toISOString().split('T')[0];

  const lastExecutedDay = (() => {
    if (!Array.isArray(task?.daily_history) || task.daily_history.length === 0) return null;

    const todayEntry = task.daily_history.find((d: any) => d?.date === todayInTaskTimezone);
    if (todayEntry) return todayEntry;

    // daily_history 通常包含未来日期（初始化时会填满 duration_days），这里选择“<= 今天”的最近一天
    const candidates = task.daily_history
      .filter((d: any) => typeof d?.date === 'string' && d.date <= todayInTaskTimezone)
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));

    if (candidates.length > 0) return candidates[candidates.length - 1];
    return task.daily_history[0];
  })();

  const hourlyActual = Array.isArray(lastExecutedDay?.hourly_breakdown)
    ? lastExecutedDay.hourly_breakdown.map((h: any) => h?.actual || 0)
    : Array(24).fill(0);

  const distributionData = {
    date: lastExecutedDay?.date || todayInTaskTimezone,
    hourlyActual,
    hourlyConfigured: Array.isArray(task.hourly_distribution) ? task.hourly_distribution : Array(24).fill(0),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - Fixed Top Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.push('/click-farm')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">补点击任务详情</h1>
              </div>
              {getStatusBadge(task.status)}
            </div>
            <div className="flex gap-2">
              {task.status === 'running' && (
                <Button variant="outline" onClick={handleStopTask} disabled={actionLoading}>
                  <Square className="mr-2 h-4 w-4" />
                  暂停任务
                </Button>
              )}
              {(task.status === 'stopped' || task.status === 'paused') && (
                <Button variant="outline" onClick={handleRestartTask} disabled={actionLoading}>
                  <Play className="mr-2 h-4 w-4" />
                  重启任务
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">

      {/* Offer Info Card - Compact Style */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600">
            关联 Offer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Offer ID</p>
              <p className="font-medium">#{offer.id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">品牌名称</p>
              <p className="font-medium">{offer.brand || offer.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">目标国家</p>
              <Badge variant="outline" className="mt-1">{offer.target_country}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">时区</p>
              <p className="font-medium text-xs">{task.timezone}</p>
            </div>
          </div>
          {offer.affiliate_link && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">联盟推广链接</p>
              <a
                href={offer.affiliate_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm break-all"
              >
                {offer.affiliate_link}
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Cards - Compact Style */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="py-4">
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">总点击数</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {task.total_clicks.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  成功 {task.success_clicks} / 失败 {task.failed_clicks}
                </p>
              </div>
              <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">成功率</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {statistics.success_rate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  成功 {task.success_clicks.toLocaleString()} 次
                </p>
              </div>
              <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">总流量</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {formatBytes(statistics.total_traffic)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  基于点击数推算
                </p>
              </div>
              <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">运行时长</p>
                <p className="text-xl font-bold text-gray-900 mt-1">
                  {statistics.duration_days > 0
                    ? `${statistics.duration_days}天`
                    : statistics.duration_hours > 0
                    ? `${statistics.duration_hours}小时`
                    : '未开始'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {task.duration_days === -1
                    ? (() => {
                        const info = getTodayProgressInfo(task);
                        return info
                          ? `今日完成度 ${info.percent}%（${info.actual}/${info.target}）`
                          : '今日完成度 -';
                      })()
                    : `进度 ${task.progress}%`}
                </p>
              </div>
              <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-gray-600">
            任务配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">每日点击数</p>
              <p className="font-medium text-lg">{task.daily_click_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">执行时间段</p>
              <p className="font-medium">{task.start_time} - {task.end_time}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">持续时长</p>
              <p className="font-medium">
                {task.duration_days === -1 ? '不限期' : `${task.duration_days}天`}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">开始日期</p>
              <p className="font-medium">{formatDate(task.scheduled_start_date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">创建时间</p>
              <p className="font-medium text-xs">{new Date(task.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            {task.started_at && (
              <div>
                <p className="text-xs text-muted-foreground">开始时间</p>
                <p className="font-medium text-xs">{new Date(task.started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {analyticsSectionMounted ? (
        <TaskDetailAnalyticsSection
          task={task}
          statistics={statistics}
          distributionData={distributionData}
        />
      ) : (
        <TaskDetailAnalyticsSectionSkeleton />
      )}
      </main>
    </div>
  );
}

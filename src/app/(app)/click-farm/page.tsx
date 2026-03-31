'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Search,
  RefreshCw,
  Play,
  Pause,
  Eye,
  Edit2,
  Trash2,
  Zap,
  FileText,
  TrendingUp,
  AlertCircle,
  Trash,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { toast } from 'sonner';
import { getDateInTimezone } from '@/lib/timezone-utils';
import ClickFarmTaskModal from '@/components/ClickFarmTaskModal';
import { ResponsivePagination } from '@/components/ui/responsive-pagination';
import type { ClickFarmTaskListItem, ClickFarmStats } from '@/lib/click-farm-types';
import { safeJsonParse } from '@/lib/api-error-handler';

export default function ClickFarmPage() {
  const router = useRouter();

  // Data states
  const [tasks, setTasks] = useState<ClickFarmTaskListItem[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<ClickFarmTaskListItem[]>([]);
  const [stats, setStats] = useState<ClickFarmStats | null>(null);
  const [loading, setLoading] = useState(true);

  // UI states
  const [modalOpen, setModalOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // 🆕 批量选择状态
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting states
  type SortField = 'id' | 'offer' | 'status' | 'country' | 'dailyClicks' | 'progress' | 'successRate' | 'startDate';
  type SortDirection = 'asc' | 'desc' | null;
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const filterKeyRef = useRef<string>('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterTasks();
  }, [tasks, searchQuery, statusFilter, sortField, sortDirection]);

  useEffect(() => {
    setSelectedTaskIds((prev) => {
      const allowedIds = new Set(tasks.filter((task) => !task.is_deleted).map((task) => task.id));
      const nextSelected = new Set(Array.from(prev).filter((id) => allowedIds.has(id)));
      return nextSelected.size === prev.size ? prev : nextSelected;
    });
  }, [tasks]);

  const fetchAllTasks = async (): Promise<ClickFarmTaskListItem[]> => {
    const pageSize = 200;
    const maxPages = 200;
    const allTasks: ClickFarmTaskListItem[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const response = await fetch(`/api/click-farm/tasks?page=${page}&limit=${pageSize}`);
      if (!response.ok) {
        throw new Error(`获取补点击任务失败: page=${page}`);
      }

      const payload = await response.json();
      const pageTasks = payload?.data?.tasks || [];
      const total = Number(payload?.data?.total || 0);

      allTasks.push(...pageTasks);

      if (pageTasks.length < pageSize || (total > 0 && allTasks.length >= total)) {
        break;
      }
    }

    return allTasks;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [allTasks, statsRes] = await Promise.all([
        fetchAllTasks(),
        fetch('/api/click-farm/stats'),
      ]);
      setTasks(allTasks);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTasks = () => {
    let result = tasks.filter((task) => !task.is_deleted);

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.id.toLowerCase().includes(query) ||
        t.offer_id.toString().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'paused') {
        result = result.filter(t => t.status === 'paused' || t.status === 'stopped');
      } else {
        result = result.filter(t => t.status === statusFilter);
      }
    }

    // Sorting
    if (sortField && sortDirection) {
      const statusOrder: Record<string, number> = {
        pending: 1,
        running: 2,
        paused: 3,
        stopped: 3,
        completed: 5,
      };

      const getSortableValue = (task: ClickFarmTaskListItem): string | number | null => {
        switch (sortField) {
          case 'id':
            return task.id || null;
          case 'offer': {
            const offerName = String(task.offer_name || '').trim();
            return offerName ? offerName.toLowerCase() : task.offer_id;
          }
          case 'status':
            return statusOrder[task.status] ?? 999;
          case 'country': {
            const country = String(task.target_country || '').trim();
            return country ? country.toUpperCase() : null;
          }
          case 'dailyClicks':
            return Number.isFinite(task.daily_click_count) ? task.daily_click_count : null;
          case 'progress': {
            if (task.duration_days === -1) {
              const todayInfo = getTodayProgressInfo(task);
              return Number.isFinite(todayInfo?.percent) ? todayInfo!.percent : null;
            }
            return Number.isFinite(task.progress) ? task.progress : null;
          }
          case 'successRate': {
            if (task.total_clicks > 0) {
              const rate = task.success_clicks / task.total_clicks;
              return Number.isFinite(rate) ? rate : null;
            }
            return null;
          }
          case 'startDate': {
            const dateValue: any = (task as any).scheduled_start_date;
            if (dateValue instanceof Date) return dateValue.getTime();
            if (typeof dateValue === 'string') {
              const ts = Date.parse(dateValue);
              return Number.isFinite(ts) ? ts : null;
            }
            return null;
          }
          default:
            return null;
        }
      };

      const isMissing = (value: string | number | null | undefined): boolean => {
        if (value === null || value === undefined) return true;
        if (typeof value === 'number') return !Number.isFinite(value);
        return value.trim().length === 0;
      };

      const compareValues = (a: string | number | null, b: string | number | null): number => {
        const aMissing = isMissing(a);
        const bMissing = isMissing(b);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1; // missing always last
        if (bMissing) return -1;

        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
      };

      const items = result.map((task) => ({ task, key: getSortableValue(task) }));
      items.sort((a, b) => {
        const base = compareValues(a.key, b.key);
        return sortDirection === 'asc' ? base : -base;
      });
      result = items.map((item) => item.task);
    }

    setFilteredTasks(result);

    const filterKey = JSON.stringify({ searchQuery, statusFilter, sortField, sortDirection });
    const filtersChanged = filterKeyRef.current !== filterKey;
    filterKeyRef.current = filterKey;

    const totalPages = Math.max(1, Math.ceil(result.length / pageSize));
    setCurrentPage((prev) => {
      const nextPage = filtersChanged ? 1 : prev;
      return nextPage > totalPages ? totalPages : nextPage;
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 🆕 安全格式化百分比（处理NaN、undefined等）
  const formatPercent = (value: number | undefined | null): string => {
    if (value === undefined || value === null || isNaN(value)) return '0%';
    return `${value.toFixed(1)}%`;
  };

  // 🆕 格式化日期显示（处理 Date 对象和字符串格式）
  const formatDate = (dateValue: any): string => {
    if (!dateValue) return '-';
    // 如果是 Date 对象
    if (dateValue instanceof Date) {
      return dateValue.toISOString().split('T')[0];
    }
    // 如果是字符串
    if (typeof dateValue === 'string') {
      // 处理 "2025-12-31T00:00:00.000Z" 格式
      return dateValue.split('T')[0];
    }
    return String(dateValue);
  };

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

  const handleStopTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/stop`, {
        method: 'POST',
      });
      const result = await safeJsonParse<{ message?: string }>(response);
      if (!result.success) {
        throw new Error(result.userMessage || '暂停任务失败');
      }

      toast.success('任务已暂停');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '暂停任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestartTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/restart`, {
        method: 'POST',
      });
      const result = await safeJsonParse<{ message?: string }>(response);
      if (!result.success) {
        throw new Error(result.userMessage || '重启任务失败');
      }

      toast.success('任务已重启');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '重启任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleTriggerTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/click-farm/tasks/${taskId}/trigger`, {
        method: 'POST',
      });
      const result = await safeJsonParse<{ message?: string; error?: string; success?: boolean }>(response);
      if (!result.success) {
        throw new Error(result.userMessage || '触发任务失败');
      }
      const data = result.data;
      if (data?.success === false) {
        throw new Error(data.error || data.message || '触发任务失败');
      }

      toast.success(data.message || '任务已触发');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '触发任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTaskId) return;

    try {
      setActionLoading(deleteTaskId);
      const response = await fetch(`/api/click-farm/tasks/${deleteTaskId}`, {
        method: 'DELETE',
      });
      const result = await safeJsonParse<{ message?: string }>(response);
      if (!result.success) {
        throw new Error(result.userMessage || '删除任务失败');
      }

      toast.success('任务已删除，历史数据已保留');
      setDeleteDialogOpen(false);
      setDeleteTaskId(null);
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '删除任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  // 🆕 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedTasks.filter((task) => !task.is_deleted).map((t) => t.id));
      setSelectedTaskIds(allIds);
    } else {
      setSelectedTaskIds(new Set());
    }
  };

  // 🆕 单选切换
  const handleSelectTask = (taskId: string, checked: boolean) => {
    const newSelected = new Set(selectedTaskIds);
    if (checked) {
      newSelected.add(taskId);
    } else {
      newSelected.delete(taskId);
    }
    setSelectedTaskIds(newSelected);
  };

  // 🆕 批量删除处理函数
  const handleBatchDelete = async () => {
    if (selectedTaskIds.size === 0) return;

    try {
      setBatchDeleting(true);
      setBatchDeleteError(null);

      // 并行删除所有选中的任务
      const deletePromises = Array.from(selectedTaskIds).map(async (taskId) => {
        const response = await fetch(`/api/click-farm/tasks/${taskId}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        const data = await response.json();
        return { taskId, response, data };
      });

      const results = await Promise.allSettled(deletePromises);

      // 收集所有错误
      const errors: string[] = [];

      results.forEach((result) => {
        if (result.status === 'rejected') {
          errors.push(result.reason?.message || '网络错误');
        } else if (result.status === 'fulfilled') {
          const { response, data, taskId } = result.value;
          if (!response.ok) {
            const taskInfo = `#${taskId.slice(0, 8)}`;
            errors.push(`${taskInfo}: ${data.error || '删除失败'}`);
          }
        }
      });

      if (errors.length > 0) {
        // 在对话框内显示错误，不关闭对话框
        setBatchDeleteError(`${errors.length}/${selectedTaskIds.size} 个任务删除失败：\n${errors.join('\n')}`);
        // 刷新列表以显示成功删除的结果
        await loadData();
        return;
      }

      // 全部删除成功
      await loadData();

      // 清空选中状态
      setSelectedTaskIds(new Set());

      // 关闭对话框
      setIsBatchDeleteDialogOpen(false);
      setBatchDeleteError(null);
      toast.success(`已删除 ${selectedTaskIds.size} 个任务`);
    } catch (err: any) {
      setBatchDeleteError(err.message || '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      running: { label: '运行中', variant: 'default', className: 'bg-green-600' },
      pending: { label: '等待中', variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
      paused: { label: '已暂停', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
      stopped: { label: '已暂停', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
      completed: { label: '已完成', variant: 'default', className: 'bg-purple-600' },
    };
    const config = configs[status] || { label: status, variant: 'outline' as const, className: '' };

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortField(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 可排序表头组件
  const SortableHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field;
    return (
      <TableHead className={`cursor-pointer select-none hover:bg-gray-50 ${className}`} onClick={() => handleSort(field)}>
        <div className="flex items-center gap-1">
          {children}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
          ) : (
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </TableHead>
    );
  };

  const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectablePaginatedTasks = paginatedTasks.filter((task) => !task.is_deleted);
  const selectedSelectableCount = selectablePaginatedTasks.filter((task) => selectedTaskIds.has(task.id)).length;

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">补点击任务</h1>
              <Badge variant="outline" className="text-sm">
                {tasks.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              {/* 🆕 批量删除按钮 - 有选中项时显示 */}
              {selectedTaskIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsBatchDeleteDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Trash className="w-4 h-4" />
                  删除选中 ({selectedTaskIds.size})
                </Button>
              )}
              <Button
                variant="outline"
                onClick={loadData}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics - 一行6列布局 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日点击</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.today.clicks.toLocaleString()}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日成功率</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatPercent(stats.today.successRate)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日流量</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatBytes(stats.today.traffic)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计点击</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.cumulative.clicks.toLocaleString()}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计成功率</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatPercent(stats.cumulative.successRate)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">累计流量</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatBytes(stats.cumulative.traffic)}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Task Status Distribution */}
        {stats && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                任务状态分布
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{stats.taskStatusDistribution.pending}</div>
                  <div className="text-xs text-muted-foreground">等待开始</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{stats.taskStatusDistribution.running}</div>
                  <div className="text-xs text-muted-foreground">运行中</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">
                    {stats.taskStatusDistribution.paused + stats.taskStatusDistribution.stopped}
                  </div>
                  <div className="text-xs text-muted-foreground">已暂停</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-purple-600">{stats.taskStatusDistribution.completed}</div>
                  <div className="text-xs text-muted-foreground">已完成</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{stats.taskStatusDistribution.total}</div>
                  <div className="text-xs text-muted-foreground">总任务数</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索任务ID或Offer ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">所有状态</option>
                <option value="running">运行中</option>
                <option value="pending">等待中</option>
                <option value="paused">已暂停</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Zap className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到任务</h3>
            <p className="mt-2 text-sm text-gray-500">
              {tasks.length === 0
                ? '您还没有创建任何补点击任务，请前往 /offers 页面为特定 Offer 创建任务。'
                : '没有找到符合筛选条件的任务。'}
            </p>
            {tasks.length === 0 && (
              <div className="mt-6">
                <p className="text-sm text-muted-foreground">暂无补点击任务</p>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    {/* 🆕 全选复选框 */}
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={selectablePaginatedTasks.length > 0 && selectedSelectableCount === selectablePaginatedTasks.length}
                        onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                        disabled={selectablePaginatedTasks.length === 0}
                        aria-label="全选"
                      />
                    </TableHead>
                    <SortableHeader field="id" className="w-[60px]">ID</SortableHeader>
                    <SortableHeader field="offer" className="w-[180px]">Offer</SortableHeader>
                    <SortableHeader field="status" className="w-[100px]">状态</SortableHeader>
                    <SortableHeader field="country" className="w-[108px]">国家/时区</SortableHeader>
                    <SortableHeader field="dailyClicks" className="w-[96px]">每日点击</SortableHeader>
                    <SortableHeader field="progress" className="w-[80px]">进度</SortableHeader>
                    <SortableHeader field="successRate" className="w-[92px]">成功率</SortableHeader>
                    <SortableHeader field="startDate" className="w-[112px]">开始日期</SortableHeader>
                    <TableHead className="w-[120px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTasks.map((task) => (
                    <TableRow key={task.id} className="hover:bg-gray-50/50">
                      {/* 🆕 行选择复选框 */}
                      <TableCell>
                        <Checkbox
                          checked={selectedTaskIds.has(task.id)}
                          onCheckedChange={(checked) => handleSelectTask(task.id, checked as boolean)}
                          disabled={task.is_deleted}
                          aria-label={`选择任务 ${task.id.slice(0, 8)}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        #{task.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-blue-600 font-medium"
                            onClick={() => router.push(`/offers/${task.offer_id}`)}
                          >
                            {task.offer_name || `#${task.offer_id}`}
                          </Button>
                          <span className="text-xs text-gray-400">ID: #{task.offer_id}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(task.status)}
                          {task.is_deleted && (
                            <Badge variant="outline" className="border-gray-300 text-gray-500">
                              已删除
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            {task.target_country || '-'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{task.daily_click_count}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {(() => {
                            const todayInfo = task.duration_days === -1 ? getTodayProgressInfo(task) : null;
                            const progressValue =
                              task.duration_days === -1
                                ? (todayInfo?.percent ?? 0)
                                : (Number(task.progress) || 0);
                            const progressLabel =
                              task.duration_days === -1
                                ? `今日 ${progressValue}%`
                                : `${progressValue}%`;
                            const title =
                              task.duration_days === -1 && todayInfo
                                ? `不限期任务：显示今日完成度（${todayInfo.actual}/${todayInfo.target}）`
                                : undefined;

                            return (
                              <>
                                <div className="w-12 bg-gray-200 rounded-full h-1.5" title={title}>
                                  <div
                                    className="bg-blue-600 h-1.5 rounded-full"
                                    style={{ width: `${progressValue}%` }}
                                  />
                                </div>
                                <span className="text-xs" title={title}>{progressLabel}</span>
                              </>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        {task.total_clicks > 0
                          ? `${((task.success_clicks / task.total_clicks) * 100).toFixed(1)}%`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {formatDate(task.scheduled_start_date)}
                      </TableCell>
                      <TableCell>
                        {task.is_deleted ? (
                          <span className="text-xs text-gray-400">已删除</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => router.push(`/click-farm/tasks/${task.id}`)}
                              className="text-blue-600 hover:text-blue-800"
                              title="查看详情"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {(task.status === 'pending' || task.status === 'running') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditTaskId(task.id);
                                  setModalOpen(true);
                                }}
                                className="text-gray-600"
                                title="编辑任务"
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                            )}
                            {task.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleTriggerTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                title="立即触发"
                              >
                                <Zap className="w-4 h-4" />
                              </Button>
                            )}
                            {task.status === 'running' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleStopTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-yellow-600"
                                title="暂停任务"
                              >
                                <Pause className="w-4 h-4" />
                              </Button>
                            )}
                            {(task.status === 'stopped' || task.status === 'paused') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRestartTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-green-600"
                                title="重启任务"
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDeleteTaskId(task.id);
                                setDeleteDialogOpen(true);
                              }}
                              disabled={actionLoading === task.id}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="删除任务"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {filteredTasks.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredTasks.length / pageSize)}
                    totalItems={filteredTasks.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                    pageSizeOptions={[10, 20, 50, 100]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Task Modal */}
      <ClickFarmTaskModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditTaskId(null);
        }}
        onSuccess={loadData}
        editTaskId={editTaskId || undefined}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除该补点击任务。任务将被标记为已删除，但历史统计数据会被保留。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTaskId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              className="bg-red-600 hover:bg-red-700"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 🆕 Batch Delete Confirmation Dialog */}
      <AlertDialog open={isBatchDeleteDialogOpen} onOpenChange={setIsBatchDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedTaskIds.size} 个任务吗？这些任务将被标记为已删除，但历史统计数据会被保留。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 🆕 显示批量删除错误信息 */}
          {batchDeleteError && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {batchDeleteError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleting}>取消</AlertDialogCancel>
            <Button
              onClick={handleBatchDelete}
              disabled={batchDeleting}
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
            >
              {batchDeleting ? '删除中...' : `确认删除 (${selectedTaskIds.size})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

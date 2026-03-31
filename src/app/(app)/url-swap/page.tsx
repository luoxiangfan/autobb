'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  Trash2,
  Link,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { ResponsivePagination } from '@/components/ui/responsive-pagination';
import type { UrlSwapTaskListItem, UrlSwapGlobalStats } from '@/lib/url-swap-types';
import UrlSwapTaskModal from '@/components/UrlSwapTaskModal';
import UrlSwapHistory from '@/components/UrlSwapHistory';

export default function UrlSwapPage() {
  const router = useRouter();

  // Data states
  const [tasks, setTasks] = useState<UrlSwapTaskListItem[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<UrlSwapTaskListItem[]>([]);
  const [stats, setStats] = useState<UrlSwapGlobalStats | null>(null);
  const [loading, setLoading] = useState(true);

  // UI states
  const [modalOpen, setModalOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting states
  type SortField = 'id' | 'offer' | 'status' | 'interval' | 'nextRun' | 'successRate' | 'createdAt';
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

  const fetchAllTasks = async (): Promise<UrlSwapTaskListItem[]> => {
    const pageSize = 200;
    const maxPages = 200;
    const allTasks: UrlSwapTaskListItem[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const response = await fetch(`/api/url-swap/tasks?page=${page}&limit=${pageSize}`);
      if (!response.ok) {
        throw new Error(`获取换链任务失败: page=${page}`);
      }

      const payload = await response.json();
      const pageTasks = payload?.data?.tasks || [];
      const total = Number(payload?.data?.pagination?.total || pageTasks.length);

      allTasks.push(...pageTasks);

      if (pageTasks.length < pageSize || allTasks.length >= total) {
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
        fetch('/api/url-swap/stats'),
      ]);
      setTasks(allTasks);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
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
      result = result.filter(t => t.status === statusFilter);
    }

    // Sorting
    if (sortField && sortDirection) {
      const statusOrder: Record<string, number> = {
        enabled: 1,
        disabled: 2,
        error: 3,
        completed: 4,
      };

      const getSortableValue = (task: UrlSwapTaskListItem): string | number | null => {
        switch (sortField) {
          case 'id':
            return task.id || null;
          case 'offer': {
            const offerName = String(task.offer_name || '').trim();
            return offerName ? offerName.toLowerCase() : task.offer_id;
          }
          case 'status':
            return statusOrder[task.status] ?? 999;
          case 'interval':
            return Number.isFinite(task.swap_interval_minutes) ? task.swap_interval_minutes : null;
          case 'nextRun': {
            if (!task.next_swap_at) return null;
            const ts = Date.parse(task.next_swap_at);
            return Number.isFinite(ts) ? ts : null;
          }
          case 'successRate': {
            if (task.total_swaps > 0) {
              const rate = task.success_swaps / task.total_swaps;
              return Number.isFinite(rate) ? rate : null;
            }
            return null;
          }
          case 'createdAt': {
            const ts = Date.parse(task.created_at);
            return Number.isFinite(ts) ? ts : null;
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

  const formatDate = (dateValue: string | null): string => {
    if (!dateValue) return '-';
    return dateValue.split('T')[0];
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

  const handleSwapNow = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/url-swap/tasks/${taskId}/swap-now`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || '立即执行失败');
      }

      toast.success(data.message || '任务已加入队列');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '立即执行失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisableTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/url-swap/tasks/${taskId}/disable`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '暂停任务失败');
      }

      toast.success('任务已暂停');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '暂停任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnableTask = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const response = await fetch(`/api/url-swap/tasks/${taskId}/enable`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '恢复任务失败');
      }

      toast.success('任务已恢复');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '恢复任务失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTaskId) return;

    try {
      setActionLoading(deleteTaskId);
      const response = await fetch(`/api/url-swap/tasks/${deleteTaskId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '删除任务失败');
      }

      toast.success('任务已删除');
      setDeleteDialogOpen(false);
      setDeleteTaskId(null);
      await loadData();
    } catch (error: any) {
      toast.error(error.message || '删除任务失败');
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
              <h1 className="text-2xl font-bold text-gray-900">换链任务</h1>
              <Badge variant="outline" className="text-sm">
                {tasks.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
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
        {/* Summary Statistics */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">总任务</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.total_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <Link className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">运行中</p>
                    <p className="text-xl font-bold text-green-600 mt-1">
                      {stats.active_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                    <Play className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">已暂停</p>
                    <p className="text-xl font-bold text-yellow-600 mt-1">
                      {stats.disabled_tasks}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-yellow-100 rounded-full flex items-center justify-center shrink-0">
                    <Pause className="w-4 h-4 text-yellow-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">链接变更</p>
                    <p className="text-xl font-bold text-purple-600 mt-1">
                      {stats.url_changed_count}
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                    <Link className="w-4 h-4 text-purple-600" />
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
                      {stats.total_swaps > 0
                        ? ((stats.success_swaps / stats.total_swaps) * 100).toFixed(1)
                        : '0'}%
                    </p>
                  </div>
                  <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                    <CheckCircle className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
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
                <option value="enabled">运行中</option>
                <option value="disabled">已暂停</option>
                <option value="error">异常</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Link className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到任务</h3>
            <p className="mt-2 text-sm text-gray-500">
              {tasks.length === 0
                ? '您还没有创建任何换链任务，请前往 /offers 页面为特定 Offer 创建任务。'
                : '没有找到符合筛选条件的任务。'}
            </p>
            {tasks.length === 0 && (
              <div className="mt-6 flex justify-center">
                <Button
                  onClick={() => router.push('/offers')}
                  className="flex items-center gap-2"
                >
                  <Link className="w-4 h-4" />
                  前往 Offers 页面
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <SortableHeader field="id" className="w-[60px]">ID</SortableHeader>
                    <SortableHeader field="offer" className="w-[80px]">Offer</SortableHeader>
                    <SortableHeader field="status" className="w-[100px]">状态</SortableHeader>
                    <SortableHeader field="interval" className="w-[100px]">间隔(分钟)</SortableHeader>
                    <SortableHeader field="nextRun" className="w-[120px]">下次执行</SortableHeader>
                    <SortableHeader field="successRate" className="w-[100px]">成功/总计</SortableHeader>
                    <SortableHeader field="createdAt" className="w-[120px]">创建时间</SortableHeader>
                    <TableHead className="w-[160px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTasks.map((task) => (
                    <TableRow key={task.id} className="hover:bg-gray-50/50">
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
                          {task.status === 'error' && task.error_message && (
                            <span className="text-xs text-red-600" title={task.error_message}>
                              {task.error_message.slice(0, 20)}...
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{task.swap_interval_minutes}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="w-3 h-3 text-gray-400" />
                          {formatDateTime(task.next_swap_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span className="text-green-600">{task.success_swaps}</span>
                          <span className="text-gray-400">/</span>
                          <span>{task.total_swaps}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {formatDate(task.created_at)}
                      </TableCell>
                      <TableCell>
                        {task.is_deleted ? (
                          <span className="text-xs text-gray-400">已删除</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => router.push(`/url-swap/${task.id}`)}
                              className="text-blue-600 hover:text-blue-800"
                              title="查看详情"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setHistoryTaskId(task.id);
                                setHistoryOpen(true);
                              }}
                              className="text-gray-600"
                              title="查看历史"
                            >
                              <Calendar className="w-4 h-4" />
                            </Button>
                            {task.status === 'enabled' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleSwapNow(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-purple-600 hover:text-purple-700"
                                title="立即执行"
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            {task.status === 'disabled' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEnableTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-green-600"
                                title="恢复任务"
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            {task.status === 'enabled' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDisableTask(task.id)}
                                disabled={actionLoading === task.id}
                                className="text-yellow-600"
                                title="暂停任务"
                              >
                                <Pause className="w-4 h-4" />
                              </Button>
                            )}
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
                              <RefreshCw className="w-4 h-4" />
                            </Button>
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

      {/* Create/Edit Task Modal */}
      <UrlSwapTaskModal
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
              此操作将删除该换链任务。任务将被标记为已删除，但历史记录会被保留。此操作无法撤销。
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

      {/* History Dialog */}
      <UrlSwapHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        taskId={historyTaskId || undefined}
      />
    </div>
  );
}

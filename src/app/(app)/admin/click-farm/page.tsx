'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  Zap,
  FileText,
  TrendingUp,
  AlertCircle,
  Users,
} from 'lucide-react';

interface GlobalStats {
  total_tasks: number;
  active_tasks: number;
  total_clicks: number;
  success_clicks: number;
  success_rate: number;
  today_clicks: number;
  today_success_clicks: number;  // 🆕 今日成功点击数
  today_success_rate: number;    // 🆕 今日成功率
  today_traffic: number;
  total_traffic: number;
  taskStatusDistribution: {
    pending: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    total: number;
  };
}

interface TopUser {
  userId: number;
  username: string;
  totalClicks: number;
  successRate: number;
  traffic: number;
}

export default function AdminClickFarmPage() {
  // Data states
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsRes, topUsersRes] = await Promise.all([
        fetch('/api/admin/click-farm/stats'),
        fetch('/api/admin/click-farm/top-users'),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }

      if (topUsersRes.ok) {
        const data = await topUsersRes.json();
        setTopUsers(data.data || []);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

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
              <h1 className="text-2xl font-bold text-gray-900">补点击管理</h1>
              <Badge variant="outline" className="text-sm">
                管理员视图
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
        {/* Summary Statistics - 今日与累计数据 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Card className="py-4">
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-600">今日点击</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {stats.today_clicks.toLocaleString()}
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
                      {stats.today_success_rate.toFixed(1)}%
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
                      {formatBytes(stats.today_traffic)}
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
                      {stats.total_clicks.toLocaleString()}
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
                      {stats.success_rate.toFixed(1)}%
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
                      {formatBytes(stats.total_traffic)}
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
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center justify-between">
                <span>任务状态分布</span>
                <span className="text-xs font-normal text-gray-500">
                  总任务: {stats.total_tasks.toLocaleString()} | 活跃: {stats.active_tasks}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{stats.taskStatusDistribution.pending}</div>
                  <div className="text-xs text-gray-500">等待开始</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{stats.taskStatusDistribution.running}</div>
                  <div className="text-xs text-gray-500">运行中</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">
                    {stats.taskStatusDistribution.paused + stats.taskStatusDistribution.stopped}
                  </div>
                  <div className="text-xs text-gray-500">已暂停</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-purple-600">{stats.taskStatusDistribution.completed}</div>
                  <div className="text-xs text-gray-500">已完成</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{stats.taskStatusDistribution.total}</div>
                  <div className="text-xs text-gray-500">总任务数</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top 10 Users */}
        {topUsers.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-4 h-4" />
                Top 10 用户（按点击量排序）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">排名</TableHead>
                    <TableHead>用户ID</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead className="text-right">总点击数</TableHead>
                    <TableHead className="text-right">成功率</TableHead>
                    <TableHead className="text-right">总流量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topUsers.map((user, index) => (
                    <TableRow key={user.userId}>
                      <TableCell className="font-medium">#{index + 1}</TableCell>
                      <TableCell className="font-mono text-sm">{user.userId}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell className="text-right font-medium">
                        {user.totalClicks.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={user.successRate >= 95 ? 'text-green-600 font-medium' : ''}>
                          {user.successRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatBytes(user.traffic)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

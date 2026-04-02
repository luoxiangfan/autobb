'use client';

import { Calendar } from 'lucide-react';
import ClickFarmDistributionChart from '@/components/ClickFarmDistributionChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DailyHistoryEntry {
  date: string;
  target: number;
  actual: number;
  success: number;
  failed: number;
}

interface TaskAnalyticsTask {
  daily_history: DailyHistoryEntry[];
}

interface TaskAnalyticsStatistics {
  avg_daily_clicks: number;
  best_day: { actual: number; date: string } | null;
  worst_day: { actual: number; date: string } | null;
}

interface DistributionData {
  date: string;
  hourlyActual: number[];
  hourlyConfigured: number[];
}

interface TaskDetailAnalyticsSectionProps {
  task: TaskAnalyticsTask;
  statistics: TaskAnalyticsStatistics;
  distributionData: DistributionData;
}

export default function TaskDetailAnalyticsSection({
  task,
  statistics,
  distributionData,
}: TaskDetailAnalyticsSectionProps) {
  return (
    <div className="space-y-6">
      <ClickFarmDistributionChart
        data={distributionData}
        title="时间分布（配置 vs 最近执行）"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            每日执行记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          {task.daily_history.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">暂无执行记录</p>
          ) : (
            <Table className="[&_thead_th]:bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead className="text-right">目标</TableHead>
                  <TableHead className="text-right">实际</TableHead>
                  <TableHead className="text-right">成功</TableHead>
                  <TableHead className="text-right">失败</TableHead>
                  <TableHead className="text-right">完成率</TableHead>
                  <TableHead className="text-right">成功率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {task.daily_history
                  .slice()
                  .reverse()
                  .map((day) => {
                    const completionRate = day.target > 0 ? (day.actual / day.target) * 100 : 0;
                    const daySuccessRate = day.actual > 0 ? (day.success / day.actual) * 100 : 0;

                    return (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{day.date}</TableCell>
                        <TableCell className="text-right">{day.target}</TableCell>
                        <TableCell className="text-right font-medium">{day.actual}</TableCell>
                        <TableCell className="text-right text-green-600">{day.success}</TableCell>
                        <TableCell className="text-right text-red-600">{day.failed}</TableCell>
                        <TableCell className="text-right">
                          <span className={completionRate >= 90 ? 'font-medium text-green-600' : ''}>
                            {completionRate.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={daySuccessRate >= 95 ? 'font-medium text-green-600' : ''}>
                            {daySuccessRate.toFixed(1)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}

          {statistics.avg_daily_clicks > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 text-sm md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">平均每日点击</p>
                <p className="text-lg font-medium">{statistics.avg_daily_clicks}</p>
              </div>
              {statistics.best_day && (
                <div>
                  <p className="text-muted-foreground">最佳表现</p>
                  <p className="text-lg font-medium text-green-600">
                    {statistics.best_day.actual} ({statistics.best_day.date})
                  </p>
                </div>
              )}
              {statistics.worst_day && (
                <div>
                  <p className="text-muted-foreground">最低表现</p>
                  <p className="text-lg font-medium text-orange-600">
                    {statistics.worst_day.actual} ({statistics.worst_day.date})
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

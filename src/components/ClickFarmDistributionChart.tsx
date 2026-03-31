'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';

interface HourlyDistribution {
  date: string;
  hourlyActual: number[];
  hourlyConfigured: number[];
  matchRate?: number;
}

interface ClickFarmDistributionChartProps {
  data: HourlyDistribution | null;
  title?: string;
  showLegend?: boolean;
}

export default function ClickFarmDistributionChart({
  data,
  title = '今日时间分布',
  showLegend = true,
}: ClickFarmDistributionChartProps) {
  const chartData = useMemo(() => {
    if (!data) return [];

    return Array.from({ length: 24 }, (_, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      配置分布: data.hourlyConfigured[hour] || 0,
      实际执行: data.hourlyActual[hour] || 0,
    }));
  }, [data]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            暂无数据
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalActual = data.hourlyActual.reduce((sum, n) => sum + n, 0);
  const totalConfigured = data.hourlyConfigured.reduce((sum, n) => sum + n, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {title}
          </div>
          <div className="flex items-center gap-4 text-sm font-normal">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">配置: {totalConfigured}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-muted-foreground">实际: {totalActual}</span>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorConfigured" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              label={{ value: '点击次数', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            />
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: '12px' }}
                iconType="line"
              />
            )}
            <Area
              type="monotone"
              dataKey="配置分布"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorConfigured)"
              activeDot={{ r: 6 }}
            />
            <Area
              type="monotone"
              dataKey="实际执行"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#colorActual)"
              activeDot={{ r: 6 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {data.matchRate !== undefined && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            匹配度: {data.matchRate.toFixed(1)}%
          </div>
        )}
      </CardContent>
    </Card>
  );
}

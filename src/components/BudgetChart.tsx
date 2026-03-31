'use client'

import { useMemo, memo } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { CURRENCY_SYMBOLS, formatCurrency } from '@/lib/currency'

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#14b8a6', '#f97316']

export const BudgetTrendChart = memo(function BudgetTrendChart({
  data,
  currency = 'CNY',
  height = 300
}: { data: any[]; currency?: string; height?: number }) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      date: new Date(item.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    }))
  }, [data])

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <defs>
          <linearGradient id="colorDaily" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis label={{ value: `花费 (${currencySymbol})`, angle: -90, position: 'insideLeft' }} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-2">{payload[0].payload.date}</p>
                  {payload.map((entry, index) => (
                    <p key={index} className="text-sm" style={{ color: entry.color }}>
                      {entry.name}: {formatCurrency(Number(entry.value) || 0, currency)}
                    </p>
                  ))}
                </div>
              )
            }
            return null
          }}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="dailySpent"
          name="每日花费"
          stroke="#6366f1"
          fillOpacity={1}
          fill="url(#colorDaily)"
        />
        <Area
          type="monotone"
          dataKey="cumulativeSpent"
          name="累计花费"
          stroke="#f59e0b"
          fillOpacity={1}
          fill="url(#colorCumulative)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
})

export const CampaignBudgetChart = memo(function CampaignBudgetChart({
  data,
  currency = 'CNY',
  height = 400
}: { data: any[]; currency?: string; height?: number }) {
  const sortedData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        name: item.campaignName.length > 20
          ? item.campaignName.substring(0, 20) + '...'
          : item.campaignName,
      }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={sortedData} margin={{ top: 5, right: 30, left: 20, bottom: 80 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
        <YAxis label={{ value: `金额 (${CURRENCY_SYMBOLS[currency] || currency})`, angle: -90, position: 'insideLeft' }} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-2">{data.campaignName}</p>
                  <p className="text-sm text-gray-600 mb-2">{data.offerBrand}</p>
                  <div className="space-y-1 text-sm">
                    <p>
                      预算: <span className="font-semibold">{formatCurrency(Number(data.budget) || 0, currency)}</span>
                    </p>
                    <p>
                      已花费: <span className="font-semibold">{formatCurrency(Number(data.spent) || 0, currency)}</span>
                    </p>
                    <p>
                      剩余: <span className="font-semibold">{formatCurrency(Number(data.remaining) || 0, currency)}</span>
                    </p>
                    <p>
                      使用率:{' '}
                      <span
                        className={`font-semibold ${
                          data.isOverBudget
                            ? 'text-red-600'
                            : data.isNearBudget
                            ? 'text-amber-600'
                            : 'text-green-600'
                        }`}
                      >
                        {data.utilizationRate.toFixed(1)}%
                      </span>
                    </p>
                    {data.daysRemaining > 0 && data.daysRemaining < 999 && (
                      <p className="text-xs text-gray-500 mt-2">
                        预计剩余 {data.daysRemaining.toFixed(0)} 天
                      </p>
                    )}
                  </div>
                </div>
              )
            }
            return null
          }}
        />
        <Legend />
        <Bar dataKey="budget" name="预算" fill="#93c5fd" />
        <Bar dataKey="spent" name="已花费" fill="#6366f1" />
      </BarChart>
    </ResponsiveContainer>
  )
})

export const BudgetUtilizationChart = memo(function BudgetUtilizationChart({ data, height = 350 }: { data: any[]; height?: number }) {
  const chartData = useMemo(() => {
    const utilizationGroups = {
      'over_budget': { name: '超预算', value: 0, color: '#ef4444' },
      'near_budget': { name: '接近预算 (80-100%)', value: 0, color: '#f59e0b' },
      'on_track': { name: '正常 (<80%)', value: 0, color: '#10b981' },
    }

    data.forEach((item: any) => {
      utilizationGroups[item.status as keyof typeof utilizationGroups].value++
    })

    return Object.values(utilizationGroups).filter((item) => item.value > 0)
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
          outerRadius={120}
          fill="#8884d8"
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold">{data.name}</p>
                  <p className="text-sm mt-1">Campaign数量: {data.value}</p>
                </div>
              )
            }
            return null
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
})

export const OfferBudgetChart = memo(function OfferBudgetChart({
  data,
  currency = 'CNY',
  height = 350
}: { data: any[]; currency?: string; height?: number }) {
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 8)
      .map((item, index) => ({
        ...item,
        name: `${item.brand}`.length > 15 ? `${item.brand}`.substring(0, 15) + '...' : item.brand,
        color: COLORS[index % COLORS.length],
      }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="horizontal" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" label={{ value: `花费 (${CURRENCY_SYMBOLS[currency] || currency})`, position: 'insideBottom', offset: -5 }} />
        <YAxis type="category" dataKey="name" width={90} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-1">{data.brand}</p>
                  <p className="text-sm text-gray-600 mb-2">{data.offerName}</p>
                  <div className="space-y-1 text-sm">
                    <p>
                      预算分配: <span className="font-semibold">{formatCurrency(Number(data.allocatedBudget) || 0, currency)}</span>
                    </p>
                    <p>
                      已花费: <span className="font-semibold">{formatCurrency(Number(data.spent) || 0, currency)}</span>
                    </p>
                    <p>
                      使用率: <span className="font-semibold">{data.utilizationRate.toFixed(1)}%</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      {data.campaignCount} 个Campaign · {data.conversions} 次转化
                    </p>
                  </div>
                </div>
              )
            }
            return null
          }}
        />
        <Bar dataKey="spent" name="花费">
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
})

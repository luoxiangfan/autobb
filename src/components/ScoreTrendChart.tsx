'use client'

interface ScoreTrendChartProps {
  data: {
    date: string
    score: number
  }[]
  width?: number
  height?: number
}

export default function ScoreTrendChart({ data, width = 600, height = 200 }: ScoreTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        暂无历史数据
      </div>
    )
  }

  const padding = { top: 20, right: 30, bottom: 40, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // 计算最大最小值
  const maxScore = Math.max(...data.map(d => d.score), 100)
  const minScore = Math.min(...data.map(d => d.score), 0)
  const scoreRange = maxScore - minScore || 1

  // 计算点的坐标
  const points = data.map((item, index) => {
    const x = padding.left + (chartWidth * index) / (data.length - 1 || 1)
    const y = padding.top + chartHeight - ((item.score - minScore) / scoreRange) * chartHeight
    return { x, y, ...item }
  })

  // 生成路径
  const pathData = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
  ).join(' ')

  // Y轴刻度
  const yTicks = [0, 25, 50, 75, 100]

  return (
    <div className="flex flex-col items-center">
      <svg width={width} height={height} className="overflow-visible">
        {/* 网格线 */}
        {yTicks.map(tick => {
          const y = padding.top + chartHeight - ((tick - minScore) / scoreRange) * chartHeight
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="1"
                strokeDasharray="4,4"
              />
              <text
                x={padding.left - 10}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="text-xs fill-gray-600"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* X轴和Y轴 */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#9ca3af"
          strokeWidth="2"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#9ca3af"
          strokeWidth="2"
        />

        {/* 趋势线 */}
        <path
          d={pathData}
          fill="none"
          stroke="#4f46e5"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 数据点 */}
        {points.map((point, index) => {
          const isLatest = index === points.length - 1
          return (
            <g key={`point-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isLatest ? 6 : 4}
                fill={isLatest ? '#ef4444' : '#4f46e5'}
                stroke="white"
                strokeWidth="2"
              />
              {/* 显示分数标签 */}
              <text
                x={point.x}
                y={point.y - 12}
                textAnchor="middle"
                className="text-xs font-bold fill-gray-700"
              >
                {point.score}
              </text>
            </g>
          )
        })}

        {/* X轴日期标签 */}
        {points.map((point, index) => {
          // 只显示部分日期标签，避免拥挤
          const showLabel = data.length <= 5 || index % Math.ceil(data.length / 5) === 0 || index === data.length - 1
          if (!showLabel) return null

          const dateStr = new Date(point.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
          return (
            <text
              key={`label-${index}`}
              x={point.x}
              y={height - padding.bottom + 20}
              textAnchor="middle"
              className="text-xs fill-gray-600"
            >
              {dateStr}
            </text>
          )
        })}
      </svg>

      {/* 图例 */}
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-600">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-indigo-600"></div>
          <span>历史评分</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span>当前评分</span>
        </div>
      </div>
    </div>
  )
}

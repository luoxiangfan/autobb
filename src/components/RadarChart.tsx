'use client'

interface RadarChartProps {
  data: {
    label: string
    value: number
    max: number
  }[]
  size?: number
}

export default function RadarChart({ data, size = 300 }: RadarChartProps) {
  const center = size / 2
  const radius = size / 2 - 40
  const levels = 5 // 5个同心圆层级

  // 计算每个点的坐标
  const calculatePoint = (index: number, value: number, max: number) => {
    const angle = (Math.PI * 2 * index) / data.length - Math.PI / 2
    const ratio = value / max
    const x = center + radius * ratio * Math.cos(angle)
    const y = center + radius * ratio * Math.sin(angle)
    return { x, y }
  }

  // 计算标签位置
  const calculateLabelPoint = (index: number) => {
    const angle = (Math.PI * 2 * index) / data.length - Math.PI / 2
    const labelRadius = radius + 25
    const x = center + labelRadius * Math.cos(angle)
    const y = center + labelRadius * Math.sin(angle)
    return { x, y }
  }

  // 生成背景网格线（同心圆）
  const gridCircles = Array.from({ length: levels }, (_, i) => {
    const r = (radius * (i + 1)) / levels
    return (
      <circle
        key={`circle-${i}`}
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth="1"
      />
    )
  })

  // 生成从中心到各个顶点的轴线
  const axisLines = data.map((_, index) => {
    const { x, y } = calculateLabelPoint(index)
    return (
      <line
        key={`axis-${index}`}
        x1={center}
        y1={center}
        x2={x}
        y2={y}
        stroke="#e5e7eb"
        strokeWidth="1"
      />
    )
  })

  // 生成数据多边形路径
  const dataPoints = data.map((item, index) => calculatePoint(index, item.value, item.max))
  const pathData = dataPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ') + ' Z'

  // 根据总分计算颜色
  const totalValue = data.reduce((sum, item) => sum + item.value, 0)
  const totalMax = data.reduce((sum, item) => sum + item.max, 0)
  const percentage = (totalValue / totalMax) * 100

  let fillColor = '#ef4444' // 红色 (低分)
  let strokeColor = '#dc2626'

  if (percentage >= 80) {
    fillColor = '#22c55e' // 绿色 (高分)
    strokeColor = '#16a34a'
  } else if (percentage >= 60) {
    fillColor = '#3b82f6' // 蓝色 (中高分)
    strokeColor = '#2563eb'
  } else if (percentage >= 40) {
    fillColor = '#f59e0b' // 橙色 (中分)
    strokeColor = '#d97706'
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* 背景同心圆 */}
        {gridCircles}

        {/* 轴线 */}
        {axisLines}

        {/* 数据区域 */}
        <path
          d={pathData}
          fill={fillColor}
          fillOpacity="0.25"
          stroke={strokeColor}
          strokeWidth="2"
        />

        {/* 数据点 */}
        {dataPoints.map((point, index) => (
          <circle
            key={`point-${index}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill={strokeColor}
          />
        ))}

        {/* 标签 */}
        {data.map((item, index) => {
          const labelPoint = calculateLabelPoint(index)
          return (
            <g key={`label-${index}`}>
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xs font-medium fill-gray-700"
              >
                {item.label}
              </text>
              <text
                x={labelPoint.x}
                y={labelPoint.y + 12}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xs font-bold"
                fill={strokeColor}
              >
                {item.value}/{item.max}
              </text>
            </g>
          )
        })}
      </svg>

      {/* 图例说明 */}
      <div className="mt-4 text-xs text-gray-600 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: strokeColor }}></div>
            <span>当前得分: {totalValue}/{totalMax} ({percentage.toFixed(1)}%)</span>
          </div>
        </div>
        <div className="text-gray-500">
          外圈为满分，数据点越靠近外圈表示该维度得分越高
        </div>
      </div>
    </div>
  )
}

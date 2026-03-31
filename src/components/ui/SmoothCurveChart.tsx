'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';

interface SmoothCurveChartProps {
  data: number[];
  timePeriod?: string;  // 格式: "HH:MM-HH:MM"
  isEditing?: boolean;
  onHourChange?: (hour: number, value: number) => void;
}

/**
 * 平滑曲线图表 - 显示24小时点击分布
 * 使用SVG绘制平滑贝塞尔曲线，支持拖拽编辑
 */
export default function SmoothCurveChart({
  data,
  timePeriod = '00:00-24:00',
  isEditing = false,
  onHourChange
}: SmoothCurveChartProps) {
  const [draggingHour, setDraggingHour] = useState<number | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  // 解析时间段
  const { startHour, endHour, hoursInRange } = useMemo(() => {
    const [start, end] = timePeriod.split('-');
    const startH = parseInt(start.split(':')[0], 10);
    const endH = parseInt(end.split(':')[0], 10);
    const hoursInRange = endH > startH ? endH - startH : 24 - startH + endH;
    return { startHour: startH, endHour: endH, hoursInRange };
  }, [timePeriod]);

  const { points, areaPoints, maxValue, chartCoords } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: '', areaPoints: '', maxValue: 1, chartCoords: [] };
    }

    const width = 100;
    const height = 80;
    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxValue = Math.max(...data, 1);
    const stepX = chartWidth / 23;  // 24个点，23个间隔

    // 计算所有点的坐标
    const coords = data.map((value, index) => {
      const x = padding + index * stepX;
      const y = padding + chartHeight - (value / maxValue) * chartHeight;
      return { x, y };
    });

    // 生成平滑曲线路径
    let path = `M ${coords[0].x},${coords[0].y}`;

    for (let i = 0; i < coords.length - 1; i++) {
      const current = coords[i];
      const next = coords[i + 1];
      const cp1x = current.x + stepX * 0.5;
      const cp1y = current.y;
      const cp2x = next.x - stepX * 0.5;
      const cp2y = next.y;
      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
    }

    // 生成填充区域路径
    const lastCoord = coords[coords.length - 1];
    const areaPath = `${path} L ${lastCoord.x},${padding + chartHeight} L ${padding},${padding + chartHeight} Z`;

    return {
      points: path,
      areaPoints: areaPath,
      maxValue,
      chartCoords: coords
    };
  }, [data]);

  // 生成X轴标签（根据时间段）
  const xLabels = useMemo(() => {
    const labels: { hour: number; label: string }[] = [];
    for (let i = 0; i < 24; i++) {
      // 只显示时间段范围内的整点
      if (timePeriod === '00:00-24:00' || i % 3 === 0) {
        labels.push({ hour: i, label: `${i.toString().padStart(2, '0')}` });
      }
    }
    return labels;
  }, [timePeriod]);

  // 计算小时标签位置
  const hourLabelPositions = useMemo(() => {
    return xLabels.map(label => {
      const x = 4 + (label.hour / 23) * 92;
      return { hour: label.hour, x, label: label.label };
    });
  }, [xLabels]);

  // 拖拽处理
  const handleMouseDown = useCallback((hour: number, e: React.MouseEvent) => {
    if (!isEditing || !onHourChange) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingHour(hour);
  }, [isEditing, onHourChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingHour === null || !onHourChange) return;

    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 将像素坐标转换为图表内的相对坐标
    const svgWidth = 100;
    const svgHeight = 80;
    const padding = 4;
    const chartHeight = svgHeight - padding * 2;

    // 计算相对Y值 (0-1)
    const relY = Math.max(0, Math.min(1, 1 - (y - padding) / chartHeight));
    const newValue = Math.round(relY * maxValue);

    onHourChange(draggingHour, newValue);
  }, [draggingHour, onHourChange, maxValue]);

  const handleMouseUp = useCallback(() => {
    setDraggingHour(null);
  }, []);

  // 全局鼠标事件监听
  useEffect(() => {
    if (draggingHour === null) return;

    const handleGlobalMouseUp = () => {
      setDraggingHour(null);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleMouseMove as any);

    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.removeEventListener('mousemove', handleMouseMove as any);
    };
  }, [draggingHour, handleMouseMove]);

  if (data.length === 0) {
    return (
      <div className="h-24 bg-muted/50 rounded-md flex items-center justify-center text-muted-foreground text-sm">
        暂无分布数据
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      {/* SVG Chart */}
      <svg
        viewBox="0 0 100 80"
        className={`w-full h-20 ${isEditing ? 'cursor-crosshair' : ''}`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id="curveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="editGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Filled area */}
        <path
          d={areaPoints}
          fill={isEditing ? "url(#editGradient)" : "url(#curveGradient)"}
          stroke="none"
        />

        {/* Smooth curve line */}
        <path
          d={points}
          fill="none"
          stroke={isEditing ? "rgb(34, 197, 94)" : "rgb(59, 130, 246)"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((value, index) => {
          const x = 4 + (index / 23) * 92;
          const y = 76 - (value / maxValue) * 72;
          const isActive = isEditing;
          const isHovered = hoveredHour === index;
          const isDragging = draggingHour === index;
          const hourInRange = timePeriod === '00:00-24:00' ||
            (index >= startHour && index < endHour) ||
            (startHour > endHour && (index >= startHour || index < endHour));

          return (
            <g key={index}>
              {/* 小时数据标签（悬停时显示） */}
              {(isHovered || isDragging) && (
                <g>
                  <rect
                    x={x - 8}
                    y={y - 12}
                    width="16"
                    height="8"
                    rx="2"
                    fill="rgba(0,0,0,0.7)"
                  />
                  <text
                    x={x}
                    y={y - 6}
                    textAnchor="middle"
                    fill="white"
                    fontSize="5"
                  >
                    {value}
                  </text>
                </g>
              )}

              {/* 数据点 */}
              <circle
                cx={x}
                cy={y}
                r={isActive ? (isHovered || isDragging ? 2.5 : 2) : 1.5}
                fill={isActive ? (isDragging ? "rgb(249, 115, 22)" : "rgb(34, 197, 94)") : "rgb(59, 130, 246)"}
                className={`${isActive ? 'cursor-ns-resize' : ''} transition-all duration-150`}
                onMouseEnter={() => setHoveredHour(index)}
                onMouseLeave={() => setHoveredHour(null)}
                onMouseDown={(e) => handleMouseDown(index, e)}
              />

              {/* 拖拽时的垂直线 */}
              {isDragging && (
                <line
                  x1={x}
                  y1={4}
                  x2={x}
                  y2={76}
                  stroke="rgba(249, 115, 22, 0.5)"
                  strokeWidth="0.5"
                  strokeDasharray="1,1"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between mt-1 px-[2%]">
        {hourLabelPositions.map((pos) => (
          <div key={pos.hour} className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">
              {pos.label}h
            </span>
            {/* 时间段标记 */}
            {timePeriod !== '00:00-24:00' && (
              <div className={`w-0.5 h-1 mt-0.5 ${
                (pos.hour >= startHour && pos.hour < endHour) ||
                (startHour > endHour && (pos.hour >= startHour || pos.hour < endHour))
                  ? 'bg-primary/30'
                  : 'bg-muted'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* 底部时间范围说明 */}
      {timePeriod !== '00:00-24:00' && (
        <div className="flex justify-center gap-4 mt-1">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary/30" />
            <span className="text-[10px] text-muted-foreground">活跃时段</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-muted" />
            <span className="text-[10px] text-muted-foreground">休息时段</span>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { TrendingUp, GripVertical } from 'lucide-react';

interface HourlyDistributionEditorProps {
  /** 24小时分布数据 (0-23时的点击数，必须是正整数) */
  distribution: number[];
  /** 每日总点击数 */
  dailyClickCount: number;
  /** 时间段，格式: "06:00-24:00" */
  timePeriod?: string;
  /** 是否处于编辑模式 */
  isEditing?: boolean;
  /** 数据点变化回调 */
  onChange?: (hour: number, newValue: number) => void;
}

/**
 * 时间分布编辑器 - 24小时点击分布可视化 + 拖拽编辑
 *
 * 特性:
 * 1. 平滑曲线 + 清晰数据点（仅在活跃时段显示）
 * 2. 悬停显示数值
 * 3. 拖拽调整点击数（活跃时段）
 * 4. 活跃/休息时段区分（灰色背景标记休息时段）
 * 5. Y轴刻度显示（实际点击数，非百分比）
 * 6. 支持两种时间段：全天(00:00-24:00) 或 白天(06:00-24:00)
 */
export default function HourlyDistributionEditor({
  distribution,
  dailyClickCount,
  timePeriod = '00:00-24:00',
  isEditing = false,
  onChange,
}: HourlyDistributionEditorProps) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [draggedHour, setDraggedHour] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 解析时间段
  const { startHour, endHour } = useMemo(() => {
    const [start, end] = timePeriod.split('-');
    return {
      startHour: parseInt(start.split(':')[0]),
      endHour: parseInt(end.split(':')[0]),
    };
  }, [timePeriod]);

  // 判断小时是否在活跃时段
  const isActiveHour = useCallback((hour: number) => {
    if (timePeriod === '00:00-24:00') return true;
    if (startHour < endHour) {
      return hour >= startHour && hour < endHour;
    } else {
      return hour >= startHour || hour < endHour;
    }
  }, [timePeriod, startHour, endHour]);

  // 计算图表参数
  const { maxValue, yTicks, chartPoints, curvePath, areaPath } = useMemo(() => {
    const dataMax = Math.max(...distribution, 1);
    // Y轴最大值比数据最大值稍大，留出顶部空白使图表更美观
    // 向上取整到5的倍数（如 12→15, 10→10, 7→10）
    const maxValue = Math.ceil(dataMax / 5 + 0.5) * 5;

    // Y轴刻度 (0, 25%, 50%, 75%, 100%)
    // 注意：使用 ratio * 100 确保标签位置与图表点一致（0在底部，maxValue在顶部）
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
      value: Math.round(maxValue * ratio),
      yPercent: ratio * 100,
    }));

    // 计算24个数据点的坐标 (百分比)
    // 使用 (hour / 24) 而不是 (hour / 23) 来确保宽度一致性，24个小时均匀分布
    const chartPoints = distribution.map((value, hour) => ({
      hour,
      value,
      xPercent: (hour / 24) * 100, // 0h在0%, 24h在100% (但实际只到23h约96%)
      yPercent: (1 - value / maxValue) * 100, // 值越大，y越小（SVG坐标系）
      isActive: isActiveHour(hour),
    }));

    // 生成平滑贝塞尔曲线路径（Catmull-Rom样条算法获得更自然的平滑曲线）
    let curvePath = `M ${chartPoints[0].xPercent},${chartPoints[0].yPercent}`;

    for (let i = 0; i < chartPoints.length - 1; i++) {
      const p0 = chartPoints[Math.max(0, i - 1)];
      const p1 = chartPoints[i];
      const p2 = chartPoints[i + 1];
      const p3 = chartPoints[Math.min(chartPoints.length - 1, i + 2)];

      // Catmull-Rom样条控制点计算
      const tension = 0.5; // 张力系数 (0.5为标准Catmull-Rom)

      // 第一个控制点
      const cp1x = p1.xPercent + (p2.xPercent - p0.xPercent) / 6 * tension;
      const cp1y = p1.yPercent + (p2.yPercent - p0.yPercent) / 6 * tension;

      // 第二个控制点
      const cp2x = p2.xPercent - (p3.xPercent - p1.xPercent) / 6 * tension;
      const cp2y = p2.yPercent - (p3.yPercent - p1.yPercent) / 6 * tension;

      curvePath += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.xPercent},${p2.yPercent}`;
    }

    // 生成填充区域路径
    const lastPoint = chartPoints[chartPoints.length - 1];
    const areaPath = `${curvePath} L ${lastPoint.xPercent},100 L ${chartPoints[0].xPercent},100 Z`;

    return { maxValue, yTicks, chartPoints, curvePath, areaPath };
  }, [distribution, isActiveHour]);

  // 拖拽处理
  const handlePointerDown = useCallback((hour: number, e: React.PointerEvent) => {
    if (!isEditing || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggedHour(hour);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [isEditing, onChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggedHour === null || !onChange || !svgRef.current) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const relativeY = Math.max(0, Math.min(1, y / rect.height));

    // 计算新值 (确保是正整数)
    const newValue = Math.max(0, Math.round(maxValue * (1 - relativeY)));
    onChange(draggedHour, newValue);
  }, [draggedHour, maxValue, onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (draggedHour !== null) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      setDraggedHour(null);
    }
  }, [draggedHour]);

  // 计算总点击数和活跃小时数
  const { totalClicks, activeHoursCount } = useMemo(() => {
    const activeHoursCount = chartPoints.filter(p => p.isActive).length;
    return {
      totalClicks: distribution.reduce((sum, val) => sum + val, 0),
      activeHoursCount,
    };
  }, [distribution, chartPoints]);

  if (distribution.length !== 24) {
    return (
      <div className="h-48 bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground text-sm">
        数据格式错误：需要24小时数据
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      {/* 头部：统计信息 */}
      <div className="flex items-center justify-end">
        <div className="text-sm text-muted-foreground">
          总计: <span className="font-semibold text-foreground">{totalClicks}</span> 次/天
        </div>
      </div>

      {/* 图表容器 */}
      <div className="relative bg-gradient-to-b from-muted/30 to-muted/10 rounded-lg p-4 border border-border/50">
        {/* Y轴刻度 - 反转渲染顺序，使0在底部，maxValue在顶部 */}
        <div className="absolute left-0 top-4 bottom-10 w-10 flex flex-col justify-between text-right pr-2">
          {[...yTicks].reverse().map((tick, i) => (
            <span key={i} className="text-[10px] text-muted-foreground leading-none">
              {tick.value}
            </span>
          ))}
        </div>

        {/* SVG 图表 */}
        <div className="ml-10">
          <svg
            ref={svgRef}
            viewBox="0 0 100 100"
            className={`w-full h-40 ${isEditing ? 'cursor-crosshair' : ''}`}
            preserveAspectRatio="none"
          >
            {/* 定义渐变 */}
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0.05" />
              </linearGradient>
              <linearGradient id="editGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {/* Y轴网格线（水平）- 需要反转位置，因为SVG y=0在顶部 */}
            {yTicks.map((tick, i) => (
              <line
                key={`y-${i}`}
                x1="0"
                y1={100 - tick.yPercent}
                x2="100"
                y2={100 - tick.yPercent}
                stroke="currentColor"
                strokeWidth="0.2"
                className="text-border"
                strokeDasharray="2,2"
              />
            ))}

            {/* X轴网格线（垂直虚线）- 对齐每个小时，使用明显颜色 */}
            {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
              const xPercent = (hour / 24) * 100;
              return (
                <line
                  key={`x-${hour}`}
                  x1={xPercent}
                  y1="0"
                  x2={xPercent}
                  y2="100"
                  stroke="rgb(147, 197, 253)"
                  strokeWidth="0.3"
                  strokeDasharray="3,3"
                  opacity="0.6"
                />
              );
            })}

            {/* 曲线 */}
            <path
              d={curvePath}
              fill="none"
              stroke={isEditing ? 'rgb(34, 197, 94)' : 'rgb(59, 130, 246)'}
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* 活跃/休息时段背景 */}
            {chartPoints.map((point, i) => {
              if (i === 23) return null;
              const nextPoint = chartPoints[i + 1];
              return (
                <rect
                  key={`bg-${i}`}
                  x={point.xPercent}
                  y="0"
                  width={nextPoint.xPercent - point.xPercent}
                  height="100"
                  fill={point.isActive ? 'transparent' : 'rgba(0,0,0,0.05)'}
                  pointerEvents="none"
                />
              );
            })}

            {/* 数据点 - 默认隐藏，只在编辑模式或悬停时显示 */}
            {chartPoints.map((point) => {
              const isHovered = hoveredHour === point.hour;
              const isDragged = draggedHour === point.hour;
              const showLabel = isHovered || isDragged;
              // 只在编辑模式或悬停时显示数据点
              const showPoint = isEditing || isHovered || isDragged;

              return (
                <g key={point.hour}>
                  {/* 透明悬停区域 - 始终存在以便触发悬停效果 */}
                  <circle
                    cx={point.xPercent}
                    cy={point.yPercent}
                    r="3"
                    fill="transparent"
                    className={`${point.isActive && isEditing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => point.isActive && handlePointerDown(point.hour, e)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerEnter={() => setHoveredHour(point.hour)}
                    onPointerLeave={() => setHoveredHour(null)}
                  />

                  {/* 数值标签 */}
                  {showLabel && (
                    <text
                      x={point.xPercent}
                      y={point.yPercent - 6}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="700"
                      fill={
                        isDragged
                          ? 'rgb(249, 115, 22)'
                          : point.isActive
                          ? (isEditing ? 'rgb(34, 197, 94)' : 'rgb(59, 130, 246)')
                          : 'rgb(107, 114, 128)'
                      }
                      stroke="white"
                      strokeWidth="2.5"
                      paintOrder="stroke"
                      className="select-none"
                    >
                      {point.value}
                    </text>
                  )}

                  {/* 数据点圆圈 - 只在需要时显示 */}
                  {showPoint && (
                    <circle
                      cx={point.xPercent}
                      cy={point.yPercent}
                      r={isDragged ? 2.5 : isHovered ? 2 : 1.5}
                      fill={
                        isDragged
                          ? 'rgb(249, 115, 22)'
                          : point.isActive
                          ? (isEditing ? 'rgb(34, 197, 94)' : 'rgb(59, 130, 246)')
                          : 'rgb(156, 163, 175)'
                      }
                      stroke="white"
                      strokeWidth="1"
                      className="transition-all duration-150 pointer-events-none"
                    />
                  )}

                  {/* 拖拽时的垂直辅助线 */}
                  {isDragged && (
                    <line
                      x1={point.xPercent}
                      y1="0"
                      x2={point.xPercent}
                      y2="100"
                      stroke="rgba(249, 115, 22, 0.3)"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* X轴：小时标签（0-23）- 🔧 修复(2025-12-30): 使用绝对定位对齐虚线 */}
          <div className="relative mt-2 h-4">
            {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
              const xPercent = (hour / 24) * 100;
              return (
                <div
                  key={hour}
                  className="absolute -translate-x-1/2"
                  style={{ left: `${xPercent}%` }}
                >
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {hour}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 底部图例 */}
      <div className="flex items-center justify-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">
            {isEditing ? '可编辑数据点' : '活跃时段'}
          </span>
        </div>
        {timePeriod !== '00:00-24:00' && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-muted" />
            <span className="text-muted-foreground">休息时段</span>
          </div>
        )}
        {isEditing && (
          <div className="flex items-center gap-1.5">
            <GripVertical className="w-3 h-3 text-orange-500" />
            <span className="text-muted-foreground">拖拽调整数值</span>
          </div>
        )}
      </div>
    </div>
  );
}

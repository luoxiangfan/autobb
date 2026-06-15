import { formatCurrency as formatCurrencyDashboard } from '@/lib/utils'
import type { CampaignRoasRankItem, OverallRoasStatistics } from './types'
import {
  anonymizeCampaignName,
  formatPercentNumber,
  formatRoasNumber,
} from './campaign-metrics-utils'

export function buildOverallRoasImageDataUrl(
  stats: OverallRoasStatistics,
  options?: { hideBrandNames?: boolean }
): string {
  const canvasWidth = 1600
  const canvasHeight = 2000
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('浏览器不支持 Canvas 导出')
  }

  const hideNames = options?.hideBrandNames === true
  const getDisplayName = (item: CampaignRoasRankItem): string => {
    if (!hideNames) return item.campaignName
    return anonymizeCampaignName(item.campaignName)
  }

  const trimToFit = (text: string, maxWidth: number): string => {
    if (ctx.measureText(text).width <= maxWidth) return text
    let next = text
    while (next.length > 0 && ctx.measureText(`${next}...`).width > maxWidth) {
      next = next.slice(0, -1)
    }
    return next ? `${next}...` : '...'
  }

  const drawWrappedText = (
    text: string,
    x: number,
    startY: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number
  ) => {
    const chunks = text.split('')
    let current = ''
    let line = 0
    for (let i = 0; i < chunks.length; i += 1) {
      const next = `${current}${chunks[i]}`
      if (ctx.measureText(next).width <= maxWidth) {
        current = next
        continue
      }

      const render = line === maxLines - 1 ? `${current}...` : current
      ctx.fillText(render, x, startY + line * lineHeight)
      line += 1
      if (line >= maxLines) return
      current = chunks[i]
    }

    if (current && line < maxLines) {
      ctx.fillText(current, x, startY + line * lineHeight)
    }
  }

  const drawPanel = (x: number, y: number, width: number, height: number, title?: string) => {
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#dbeafe'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 18)
    ctx.fill()
    ctx.stroke()

    if (title) {
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText(title, x + 20, y + 42)
    }
  }

  const shareHeadline = (() => {
    const best = stats.bestTop3[0]
    const worst = stats.worstBottom3[0]
    if (best && best.roas !== null) {
      const bestName = getDisplayName(best)
      const bestRoas = formatRoasNumber(best.roas)
      const totalRoas = formatRoasNumber(stats.totalRoas)
      if (worst && worst.roas !== null) {
        return `亮点：${bestName} ROAS 达 ${bestRoas}，显著领先尾部系列，拉动整体 ROAS 至 ${totalRoas}。`
      }
      return `亮点：${bestName} ROAS 达 ${bestRoas}，整体 ROAS 为 ${totalRoas}。`
    }
    return `本周期覆盖 ${stats.campaignCount} 个广告系列，总花费 ${formatCurrencyDashboard(stats.totalSpend, stats.currency)}。`
  })()

  const headerGradient = ctx.createLinearGradient(0, 0, canvasWidth, 0)
  headerGradient.addColorStop(0, '#0b1220')
  headerGradient.addColorStop(0.5, '#1d4ed8')
  headerGradient.addColorStop(1, '#0369a1')
  ctx.fillStyle = '#eef5ff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.fillStyle = headerGradient
  ctx.fillRect(0, 0, canvasWidth, 210)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 58px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('广告系列整体 ROAS 社交战报', 48, 96)
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(`${stats.timeRangeLabel} | ${stats.generatedAt}`, 48, 146)
  ctx.fillText(`统计币种：${stats.currency}`, 48, 182)
  if (hideNames) {
    ctx.fillStyle = '#dbeafe'
    ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('已隐藏品牌名', canvasWidth - 190, 182)
  }

  drawPanel(48, 236, 1504, 120)
  ctx.fillStyle = '#1e3a8a'
  ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('一句话结论', 78, 284)
  ctx.fillStyle = '#334155'
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif'
  drawWrappedText(shareHeadline, 78, 324, 1440, 34, 2)

  const metricCards = [
    {
      title: `总花费(${stats.currency})`,
      value: formatCurrencyDashboard(stats.totalSpend, stats.currency),
    },
    {
      title: `总佣金(${stats.currency})`,
      value: formatCurrencyDashboard(stats.totalCommission, stats.currency),
    },
    { title: '总 ROAS', value: formatRoasNumber(stats.totalRoas) },
    {
      title: `平均实际 CPC(${stats.currency})`,
      value:
        stats.avgActualCpc === null
          ? '--'
          : formatCurrencyDashboard(stats.avgActualCpc, stats.currency),
    },
    { title: '总展示', value: stats.totalImpressions.toLocaleString('zh-CN') },
    { title: '总点击', value: stats.totalClicks.toLocaleString('zh-CN') },
    { title: '平均点击率', value: formatPercentNumber(stats.averageCtr) },
    { title: '广告系列数量', value: `${stats.campaignCount}` },
  ]
  const metricsTop = 380
  const metricsColumns = 4
  const metricWidth = 364
  const metricHeight = 116
  const metricGapX = 16
  const metricGapY = 16
  metricCards.forEach((card, index) => {
    const col = index % metricsColumns
    const row = Math.floor(index / metricsColumns)
    const x = 48 + col * (metricWidth + metricGapX)
    const y = metricsTop + row * (metricHeight + metricGapY)
    drawPanel(x, y, metricWidth, metricHeight)
    ctx.fillStyle = '#64748b'
    ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(card.title, x + 20, y + 42)
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 31px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(card.value, x + 20, y + 86)
  })

  const trendPanelX = 48
  const trendPanelY = 644
  const trendPanelWidth = 1504
  const trendPanelHeight = 376
  drawPanel(trendPanelX, trendPanelY, trendPanelWidth, trendPanelHeight, 'ROAS 排名趋势（Top 8）')
  const roasSeries = [...stats.campaigns]
    .filter((item) => item.roas !== null)
    .sort((a, b) => Number(b.roas) - Number(a.roas))
    .slice(0, 8)

  if (roasSeries.length > 0) {
    const chartX = trendPanelX + 52
    const chartY = trendPanelY + 102
    const chartWidth = trendPanelWidth - 104
    const chartHeight = 216
    const maxRoas = Math.max(...roasSeries.map((item) => Number(item.roas || 0)), 1)
    const minRoas = Math.min(...roasSeries.map((item) => Number(item.roas || 0)), 0)
    const span = Math.max(0.2, maxRoas - minRoas)

    ctx.strokeStyle = '#dbeafe'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i += 1) {
      const y = chartY + (chartHeight / 4) * i
      ctx.beginPath()
      ctx.moveTo(chartX, y)
      ctx.lineTo(chartX + chartWidth, y)
      ctx.stroke()
    }

    const points = roasSeries.map((item, index) => {
      const x = chartX + (index * chartWidth) / Math.max(1, roasSeries.length - 1)
      const roas = Number(item.roas || 0)
      const y = chartY + chartHeight - ((roas - minRoas) / span) * chartHeight
      return { x, y, roas, item, rank: index + 1 }
    })

    const gradient = ctx.createLinearGradient(chartX, chartY, chartX, chartY + chartHeight)
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.24)')
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)')
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.lineTo(chartX + chartWidth, chartY + chartHeight)
    ctx.lineTo(chartX, chartY + chartHeight)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 4
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()

    points.forEach((point) => {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1d4ed8'
      ctx.lineWidth = 3
      ctx.stroke()

      ctx.fillStyle = '#1e3a8a'
      ctx.font = 'bold 18px "PingFang SC", "Microsoft YaHei", sans-serif'
      const roasLabel = `${point.roas.toFixed(2)}x`
      ctx.fillText(roasLabel, point.x - ctx.measureText(roasLabel).width / 2, point.y - 14)

      ctx.fillStyle = '#475569'
      ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif'
      const rankLabel = `#${point.rank}`
      ctx.fillText(
        rankLabel,
        point.x - ctx.measureText(rankLabel).width / 2,
        chartY + chartHeight + 26
      )
    })
  } else {
    ctx.fillStyle = '#64748b'
    ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('暂无可绘制的 ROAS 趋势数据', trendPanelX + 62, trendPanelY + 188)
  }

  const insightPanelY = 1044
  const spendPanelX = 48
  const spendPanelY = insightPanelY
  const spendPanelWidth = 1018
  const spendPanelHeight = 360
  drawPanel(
    spendPanelX,
    spendPanelY,
    spendPanelWidth,
    spendPanelHeight,
    '花费占比结构（Top 5 + 其他）'
  )
  const spendSeries = [...stats.campaigns].sort((a, b) => b.spend - a.spend)
  const spendEntries = spendSeries.slice(0, 5).map((item) => ({
    name: getDisplayName(item),
    value: item.spend,
  }))
  const spendOthers = spendSeries.slice(5).reduce((sum, item) => sum + item.spend, 0)
  if (spendOthers > 0) {
    spendEntries.push({
      name: hideNames ? '其他品牌' : '其他广告系列',
      value: spendOthers,
    })
  }

  const pieCx = spendPanelX + 246
  const pieCy = spendPanelY + 214
  const pieOuter = 126
  const pieInner = 72
  const pieColors = ['#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']
  const pieTotal = spendEntries.reduce((sum, entry) => sum + entry.value, 0)
  const spendPanelRight = spendPanelX + spendPanelWidth
  const legendDotX = Math.max(spendPanelX + 354, pieCx + pieOuter + 36)
  const legendTextX = legendDotX + 28
  const legendTextMaxWidth = Math.max(120, spendPanelRight - legendTextX - 24)
  let pieAngle = -Math.PI / 2

  if (pieTotal > 0) {
    spendEntries.forEach((entry, index) => {
      const ratio = entry.value / pieTotal
      const next = pieAngle + Math.PI * 2 * ratio
      ctx.beginPath()
      ctx.moveTo(pieCx, pieCy)
      ctx.arc(pieCx, pieCy, pieOuter, pieAngle, next)
      ctx.closePath()
      ctx.fillStyle = pieColors[index % pieColors.length]
      ctx.fill()
      pieAngle = next
    })

    ctx.beginPath()
    ctx.arc(pieCx, pieCy, pieInner, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  } else {
    ctx.fillStyle = '#64748b'
    ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('暂无花费占比数据', spendPanelX + 92, spendPanelY + 220)
  }

  spendEntries.forEach((entry, index) => {
    const y = spendPanelY + 108 + index * 38
    ctx.fillStyle = pieColors[index % pieColors.length]
    ctx.fillRect(legendDotX, y - 14, 16, 16)
    ctx.fillStyle = '#334155'
    ctx.font = '18px "PingFang SC", "Microsoft YaHei", sans-serif'
    const pct = pieTotal > 0 ? `${((entry.value / pieTotal) * 100).toFixed(1)}%` : '0%'
    const label = trimToFit(entry.name, legendTextMaxWidth)
    ctx.fillText(`${label} ${pct}`, legendTextX, y)
  })

  const cpcPanelX = 1088
  const cpcPanelY = insightPanelY
  const cpcPanelWidth = 464
  const cpcPanelHeight = 360
  drawPanel(cpcPanelX, cpcPanelY, cpcPanelWidth, cpcPanelHeight, 'CPC 极值洞察')
  ctx.fillStyle = '#475569'
  ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('最高实际 CPC', cpcPanelX + 32, cpcPanelY + 78)
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif'
  const highestName = stats.highestActualCpc
    ? trimToFit(getDisplayName(stats.highestActualCpc), 360)
    : '--'
  ctx.fillText(highestName, cpcPanelX + 32, cpcPanelY + 116)
  ctx.fillStyle = '#1d4ed8'
  ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(
    stats.highestActualCpc
      ? formatCurrencyDashboard(Number(stats.highestActualCpc.actualCpc || 0), stats.currency)
      : '--',
    cpcPanelX + 32,
    cpcPanelY + 150
  )

  ctx.fillStyle = '#475569'
  ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('最低实际 CPC', cpcPanelX + 32, cpcPanelY + 214)
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif'
  const lowestName = stats.lowestActualCpc
    ? trimToFit(getDisplayName(stats.lowestActualCpc), 360)
    : '--'
  ctx.fillText(lowestName, cpcPanelX + 32, cpcPanelY + 252)
  ctx.fillStyle = '#059669'
  ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(
    stats.lowestActualCpc
      ? formatCurrencyDashboard(Number(stats.lowestActualCpc.actualCpc || 0), stats.currency)
      : '--',
    cpcPanelX + 32,
    cpcPanelY + 286
  )

  const drawCampaignList = (
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    list: CampaignRoasRankItem[]
  ) => {
    drawPanel(x, y, width, height, title)
    if (list.length === 0) {
      ctx.fillStyle = '#64748b'
      ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('暂无可计算 ROAS 的广告系列', x + 22, y + 92)
      return
    }

    list.forEach((item, index) => {
      const rowY = y + 86 + index * 64
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(x + 18, rowY - 30, width - 36, 52)

      ctx.fillStyle = '#334155'
      ctx.font = 'bold 19px "PingFang SC", "Microsoft YaHei", sans-serif'
      const titleText = `${index + 1}. ${trimToFit(getDisplayName(item), width - 320)}`
      ctx.fillText(titleText, x + 28, rowY)

      ctx.fillStyle = '#1d4ed8'
      ctx.font = '18px "PingFang SC", "Microsoft YaHei", sans-serif'
      const metricsText = trimToFit(
        `ROAS ${formatRoasNumber(item.roas)} | 花费 ${formatCurrencyDashboard(item.spend, stats.currency)} | 佣金 ${formatCurrencyDashboard(item.commission, stats.currency)}`,
        width - 56
      )
      ctx.fillText(metricsText, x + 28, rowY + 26)
    })
  }

  drawCampaignList(48, 1430, 742, 300, 'Top 3 优秀广告系列', stats.bestTop3)
  drawCampaignList(810, 1430, 742, 300, 'Bottom 3 待优化广告系列', stats.worstBottom3)

  ctx.fillStyle = '#64748b'
  ctx.font = '18px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('提示：该战报用于分享决策参考，建议结合归因口径与预算目标复核。', 48, 1770)

  return canvas.toDataURL('image/png')
}

import os from 'os'
import fs from 'fs/promises'

export type HostMetricsSnapshot = {
  timestamp: string
  intervalSec: number | null
  available: boolean
  source: 'cgroup-v2' | 'fallback' | 'unavailable'
  cpu: {
    usagePct: number | null
    throttledPct: number | null
    quotaCores: number | null
  }
  memory: {
    usedBytes: number | null
    limitBytes: number | null
    usagePct: number | null
  }
  diskIo: {
    readBps: number | null
    writeBps: number | null
    readOpsPerSec: number | null
    writeOpsPerSec: number | null
  }
  network: {
    rxBps: number | null
    txBps: number | null
  }
}

export type HostMetricsHistoryPoint = {
  timestamp: string
  cpuUsagePct: number | null
  cpuThrottledPct: number | null
  memUsagePct: number | null
  diskReadBps: number | null
  diskWriteBps: number | null
  netRxBps: number | null
  netTxBps: number | null
}

export type HostMetricsPayload = {
  snapshot: HostMetricsSnapshot
  history: HostMetricsHistoryPoint[]
  windowSec: number
  sampleIntervalSec: number
}

type RawSample = {
  tsMs: number
  cpuUsageUsec: number | null
  cpuThrottledUsec: number | null
  cpuQuotaCores: number | null
  memCurrentBytes: number | null
  memMaxBytes: number | null
  ioReadBytes: number | null
  ioWriteBytes: number | null
  ioReadOps: number | null
  ioWriteOps: number | null
  netRxBytes: number | null
  netTxBytes: number | null
  source: HostMetricsSnapshot['source']
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

async function readFileText(path: string) {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

function parseKeyValueStat(text: string) {
  const out: Record<string, number> = {}
  for (const line of text.trim().split('\n')) {
    const [k, v] = line.trim().split(/\s+/, 2)
    if (!k || v === undefined) continue
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

function parseCgroupMax(text: string | null) {
  if (!text) return null
  const parts = text.trim().split(/\s+/)
  if (parts.length < 2) return null
  const [quotaRaw, periodRaw] = parts
  if (quotaRaw === 'max') return os.cpus().length || null
  const quota = Number(quotaRaw)
  const period = Number(periodRaw)
  if (!Number.isFinite(quota) || !Number.isFinite(period) || quota <= 0 || period <= 0) return null
  return quota / period
}

function parseCgroupByteLimit(text: string | null) {
  if (!text) return null
  const t = text.trim()
  if (t === 'max') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseCgroupIoStat(text: string | null) {
  if (!text) {
    return { rbytes: null, wbytes: null, rios: null, wios: null }
  }
  let rbytes = 0
  let wbytes = 0
  let rios = 0
  let wios = 0
  for (const line of text.trim().split('\n')) {
    const parts = line.trim().split(/\s+/)
    for (const p of parts) {
      const [k, v] = p.split('=')
      if (!k || v === undefined) continue
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      if (k === 'rbytes') rbytes += n
      if (k === 'wbytes') wbytes += n
      if (k === 'rios') rios += n
      if (k === 'wios') wios += n
    }
  }
  return { rbytes, wbytes, rios, wios }
}

function parseProcNetDev(text: string | null) {
  if (!text) return { rxBytes: null, txBytes: null }
  const lines = text.trim().split('\n')
  if (lines.length < 3) return { rxBytes: null, txBytes: null }
  let rxBytes = 0
  let txBytes = 0
  for (const line of lines.slice(2)) {
    const [ifaceRaw, rest] = line.split(':', 2)
    if (!rest) continue
    const iface = ifaceRaw.trim()
    if (!iface || iface === 'lo') continue
    const cols = rest.trim().split(/\s+/)
    if (cols.length < 16) continue
    const rx = Number(cols[0])
    const tx = Number(cols[8])
    if (Number.isFinite(rx)) rxBytes += rx
    if (Number.isFinite(tx)) txBytes += tx
  }
  return { rxBytes, txBytes }
}

async function readCgroupV2Sample(): Promise<RawSample | null> {
  const [cpuStatText, cpuMaxText, memCurrentText, memMaxText, ioStatText, netDevText] = await Promise.all([
    readFileText('/sys/fs/cgroup/cpu.stat'),
    readFileText('/sys/fs/cgroup/cpu.max'),
    readFileText('/sys/fs/cgroup/memory.current'),
    readFileText('/sys/fs/cgroup/memory.max'),
    readFileText('/sys/fs/cgroup/io.stat'),
    readFileText('/proc/net/dev'),
  ])

  if (!cpuStatText || !memCurrentText) return null

  const cpuStat = parseKeyValueStat(cpuStatText)
  const cpuUsageUsec = Number.isFinite(cpuStat.usage_usec) ? cpuStat.usage_usec : null
  const cpuThrottledUsec = Number.isFinite(cpuStat.throttled_usec) ? cpuStat.throttled_usec : null

  const cpuQuotaCores = parseCgroupMax(cpuMaxText)
  const memCurrentBytes = parseCgroupByteLimit(memCurrentText)
  const memMaxBytes = parseCgroupByteLimit(memMaxText)
  const io = parseCgroupIoStat(ioStatText)
  const net = parseProcNetDev(netDevText)

  return {
    tsMs: Date.now(),
    cpuUsageUsec,
    cpuThrottledUsec,
    cpuQuotaCores,
    memCurrentBytes,
    memMaxBytes,
    ioReadBytes: io.rbytes,
    ioWriteBytes: io.wbytes,
    ioReadOps: io.rios,
    ioWriteOps: io.wios,
    netRxBytes: net.rxBytes,
    netTxBytes: net.txBytes,
    source: 'cgroup-v2',
  }
}

async function readRawSample(): Promise<RawSample> {
  const v2 = await readCgroupV2Sample()
  if (v2) return v2

  // fallback：只返回可用的总内存（无法做到严格容器口径），用于开发环境不报错
  return {
    tsMs: Date.now(),
    cpuUsageUsec: null,
    cpuThrottledUsec: null,
    cpuQuotaCores: null,
    memCurrentBytes: os.totalmem() - os.freemem(),
    memMaxBytes: os.totalmem(),
    ioReadBytes: null,
    ioWriteBytes: null,
    ioReadOps: null,
    ioWriteOps: null,
    netRxBytes: null,
    netTxBytes: null,
    source: 'fallback',
  }
}

function computeSnapshot(prev: RawSample | null, curr: RawSample): HostMetricsSnapshot {
  const intervalSec = prev ? Math.max(0.001, (curr.tsMs - prev.tsMs) / 1000) : null

  let cpuUsagePct: number | null = null
  let throttledPct: number | null = null
  if (prev && curr.cpuUsageUsec !== null && prev.cpuUsageUsec !== null && intervalSec !== null) {
    const deltaUsec = Math.max(0, curr.cpuUsageUsec - prev.cpuUsageUsec)
    const quotaCores = curr.cpuQuotaCores || 1
    cpuUsagePct = clampPct((deltaUsec / (intervalSec * 1_000_000 * quotaCores)) * 100)
  }
  if (prev && curr.cpuThrottledUsec !== null && prev.cpuThrottledUsec !== null && intervalSec !== null) {
    const deltaUsec = Math.max(0, curr.cpuThrottledUsec - prev.cpuThrottledUsec)
    throttledPct = clampPct((deltaUsec / (intervalSec * 1_000_000)) * 100)
  }

  const usedBytes = curr.memCurrentBytes
  const limitBytes = curr.memMaxBytes
  const memUsagePct =
    usedBytes !== null && limitBytes !== null && limitBytes > 0
      ? clampPct((usedBytes / limitBytes) * 100)
      : null

  const readBps =
    prev && curr.ioReadBytes !== null && prev.ioReadBytes !== null && intervalSec
      ? Math.max(0, (curr.ioReadBytes - prev.ioReadBytes) / intervalSec)
      : null
  const writeBps =
    prev && curr.ioWriteBytes !== null && prev.ioWriteBytes !== null && intervalSec
      ? Math.max(0, (curr.ioWriteBytes - prev.ioWriteBytes) / intervalSec)
      : null
  const readOpsPerSec =
    prev && curr.ioReadOps !== null && prev.ioReadOps !== null && intervalSec
      ? Math.max(0, (curr.ioReadOps - prev.ioReadOps) / intervalSec)
      : null
  const writeOpsPerSec =
    prev && curr.ioWriteOps !== null && prev.ioWriteOps !== null && intervalSec
      ? Math.max(0, (curr.ioWriteOps - prev.ioWriteOps) / intervalSec)
      : null

  const rxBps =
    prev && curr.netRxBytes !== null && prev.netRxBytes !== null && intervalSec
      ? Math.max(0, (curr.netRxBytes - prev.netRxBytes) / intervalSec)
      : null
  const txBps =
    prev && curr.netTxBytes !== null && prev.netTxBytes !== null && intervalSec
      ? Math.max(0, (curr.netTxBytes - prev.netTxBytes) / intervalSec)
      : null

  const available =
    curr.source !== 'unavailable' &&
    (curr.source === 'fallback' || (curr.cpuUsageUsec !== null && curr.memCurrentBytes !== null))

  return {
    timestamp: new Date(curr.tsMs).toISOString(),
    intervalSec,
    available,
    source: available ? curr.source : 'unavailable',
    cpu: {
      usagePct: cpuUsagePct,
      throttledPct,
      quotaCores: curr.cpuQuotaCores,
    },
    memory: {
      usedBytes,
      limitBytes,
      usagePct: memUsagePct,
    },
    diskIo: {
      readBps,
      writeBps,
      readOpsPerSec,
      writeOpsPerSec,
    },
    network: {
      rxBps,
      txBps,
    },
  }
}

class HostMetricsCollector {
  private timer: NodeJS.Timeout | null = null
  private prev: RawSample | null = null
  private curr: RawSample | null = null
  private snapshot: HostMetricsSnapshot | null = null
  private history: HostMetricsHistoryPoint[] = []
  private lastAccessMs: number = 0

  private readonly sampleIntervalMs = 10_000
  private readonly idleStopMs = 60_000
  private readonly historyWindowMs = 5 * 60_000

  touch() {
    this.lastAccessMs = Date.now()
  }

  async startIfNeeded() {
    this.touch()
    if (this.timer) return

    // 首次立即采样一次
    await this.sampleOnce()

    this.timer = setInterval(() => {
      void (async () => {
        if (Date.now() - this.lastAccessMs > this.idleStopMs) {
          this.stop()
          return
        }
        await this.sampleOnce()
      })()
    }, this.sampleIntervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async sampleOnce() {
    const next = await readRawSample()
    this.prev = this.curr
    this.curr = next
    this.snapshot = computeSnapshot(this.prev, next)

    if (this.snapshot) {
      const point: HostMetricsHistoryPoint = {
        timestamp: this.snapshot.timestamp,
        cpuUsagePct: this.snapshot.cpu.usagePct,
        cpuThrottledPct: this.snapshot.cpu.throttledPct,
        memUsagePct: this.snapshot.memory.usagePct,
        diskReadBps: this.snapshot.diskIo.readBps,
        diskWriteBps: this.snapshot.diskIo.writeBps,
        netRxBps: this.snapshot.network.rxBps,
        netTxBps: this.snapshot.network.txBps,
      }
      this.history.push(point)

      const cutoffMs = Date.now() - this.historyWindowMs
      while (this.history.length > 0 && Date.parse(this.history[0].timestamp) < cutoffMs) {
        this.history.shift()
      }
    }
  }

  async getPayload(): Promise<HostMetricsPayload> {
    await this.startIfNeeded()
    this.touch()

    if (!this.snapshot) {
      const next = await readRawSample()
      this.prev = this.curr
      this.curr = next
      this.snapshot = computeSnapshot(this.prev, next)
    }

    // 防御：history为空时至少包含当前点，便于前端画图
    if (this.snapshot && this.history.length === 0) {
      this.history.push({
        timestamp: this.snapshot.timestamp,
        cpuUsagePct: this.snapshot.cpu.usagePct,
        cpuThrottledPct: this.snapshot.cpu.throttledPct,
        memUsagePct: this.snapshot.memory.usagePct,
        diskReadBps: this.snapshot.diskIo.readBps,
        diskWriteBps: this.snapshot.diskIo.writeBps,
        netRxBps: this.snapshot.network.rxBps,
        netTxBps: this.snapshot.network.txBps,
      })
    }

    return {
      snapshot: this.snapshot!,
      history: this.history.slice(),
      windowSec: this.historyWindowMs / 1000,
      sampleIntervalSec: this.sampleIntervalMs / 1000,
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __hostMetricsCollector: HostMetricsCollector | undefined
}

export async function getHostMetricsSnapshot(): Promise<HostMetricsSnapshot> {
  if (!globalThis.__hostMetricsCollector) {
    globalThis.__hostMetricsCollector = new HostMetricsCollector()
  }
  const payload = await globalThis.__hostMetricsCollector.getPayload()
  return payload.snapshot
}

export async function getHostMetricsPayload(): Promise<HostMetricsPayload> {
  if (!globalThis.__hostMetricsCollector) {
    globalThis.__hostMetricsCollector = new HostMetricsCollector()
  }
  return await globalThis.__hostMetricsCollector.getPayload()
}

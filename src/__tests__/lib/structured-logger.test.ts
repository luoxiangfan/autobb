import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('structured-logger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('respects LOG_LEVEL=warn and drops info', async () => {
    vi.stubEnv('LOG_LEVEL', 'warn')
    vi.stubEnv('NODE_ENV', 'production')

    const { log } = await import('@/lib/common/structured-logger')

    log('info', 'hidden')
    log('warn', 'visible')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(writeSpy.mock.calls[0][0]))
    expect(payload.level).toBe('warn')
    expect(payload.msg).toBe('visible')
  })

  it('defaults production to warn when LOG_LEVEL is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.LOG_LEVEL

    const { shouldLogLevel } = await import('@/lib/common/structured-logger')
    expect(shouldLogLevel('info')).toBe(false)
    expect(shouldLogLevel('warn')).toBe(true)
  })
})

describe('queue-log', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses debug by default for queue verbose events', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug')
    vi.stubEnv('QUEUE_VERBOSE_LOG', 'false')

    const { queueVerboseLog } = await import('@/lib/queue/queue-log')

    queueVerboseLog('queue_task_started', { taskId: 't1' })

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(writeSpy.mock.calls[0][0]))
    expect(payload.level).toBe('debug')
    expect(payload.msg).toBe('queue_task_started')
  })

  it('promotes queue verbose events to info when QUEUE_VERBOSE_LOG=true', async () => {
    vi.stubEnv('LOG_LEVEL', 'info')
    vi.stubEnv('QUEUE_VERBOSE_LOG', 'true')

    const { queueVerboseLog } = await import('@/lib/queue/queue-log')

    queueVerboseLog('queue_task_started', { taskId: 't1' })

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(writeSpy.mock.calls[0][0]))
    expect(payload.level).toBe('info')
  })
})

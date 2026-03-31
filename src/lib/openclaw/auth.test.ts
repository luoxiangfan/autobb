import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSettingMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSetting: getSettingMock,
  updateSettings: updateSettingsMock,
}))

import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'

describe('openclaw auth gateway token', () => {
  const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH
  let tempDir = ''
  let configPath = ''

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-auth-'))
    configPath = path.join(tempDir, 'openclaw.json')
    process.env.OPENCLAW_CONFIG_PATH = configPath

    getSettingMock.mockReset()
    updateSettingsMock.mockReset()
    updateSettingsMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns token from settings when available', async () => {
    getSettingMock.mockResolvedValue({ value: 'db-token-123' })

    const token = await getOpenclawGatewayToken()

    expect(token).toBe('db-token-123')
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('falls back to config file token and persists it when settings token missing', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { auth: { token: 'cfg-token-456' } } }), 'utf-8')
    getSettingMock.mockResolvedValue({ value: '' })

    const token = await getOpenclawGatewayToken()

    expect(token).toBe('cfg-token-456')
    expect(updateSettingsMock).toHaveBeenCalledWith([
      { category: 'openclaw', key: 'gateway_token', value: 'cfg-token-456' },
    ])
  })

  it('generates and persists random token when both settings and config are missing', async () => {
    getSettingMock.mockResolvedValue({ value: '' })

    const token = await getOpenclawGatewayToken()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(updateSettingsMock).toHaveBeenCalledWith([
      { category: 'openclaw', key: 'gateway_token', value: token },
    ])
  })
})


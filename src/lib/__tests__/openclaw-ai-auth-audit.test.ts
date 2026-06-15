import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  auditOpenclawAiAuthOverrides,
  syncOpenclawManagedAiAuthProfiles,
} from '@/lib/openclaw/ai-auth-audit'

describe('auditOpenclawAiAuthOverrides', () => {
  const envBackup = {
    OPENCLAW_AGENT_DIR: process.env.OPENCLAW_AGENT_DIR,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
  }

  const tempDirs: string[] = []

  beforeEach(() => {
    delete process.env.OPENCLAW_AGENT_DIR
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.OPENCLAW_CONFIG_PATH
    delete process.env.OPENCLAW_STATE_DIR
  })

  afterEach(() => {
    process.env.OPENCLAW_AGENT_DIR = envBackup.OPENCLAW_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = envBackup.PI_CODING_AGENT_DIR
    process.env.OPENCLAW_CONFIG_PATH = envBackup.OPENCLAW_CONFIG_PATH
    process.env.OPENCLAW_STATE_DIR = envBackup.OPENCLAW_STATE_DIR

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (!dir) continue
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors in tests
      }
    }
  })

  function createTempStateDir(): { stateDir: string; configPath: string } {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-audit-'))
    tempDirs.push(stateDir)
    return { stateDir, configPath: path.join(stateDir, 'openclaw.json') }
  }

  function buildConfig() {
    return {
      models: {
        providers: {
          openai: {
            apiKey: 'sk-new',
            models: ['gpt-5'],
          },
        },
      },
    }
  }

  it('flags auth-profile as higher-priority source than Providers JSON apiKey', () => {
    const { stateDir, configPath } = createTempStateDir()
    const authPath = path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json')
    fs.mkdirSync(path.dirname(authPath), { recursive: true })
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        version: 1,
        profiles: {
          'openai:default': {
            type: 'api_key',
            provider: 'openai',
            key: 'sk-old',
          },
        },
      }),
      'utf-8'
    )

    const warnings = auditOpenclawAiAuthOverrides({
      config: buildConfig(),
      configPath,
      env: {} as unknown as NodeJS.ProcessEnv,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        providerId: 'openai',
        source: 'auth-profile',
        authProfilesPath: authPath,
      })
    )
  })

  it('flags environment variable as higher-priority source than Providers JSON apiKey', () => {
    const { configPath } = createTempStateDir()

    const warnings = auditOpenclawAiAuthOverrides({
      config: buildConfig(),
      configPath,
      env: { OPENAI_API_KEY: 'sk-env' } as unknown as NodeJS.ProcessEnv,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        providerId: 'openai',
        source: 'env',
        envVar: 'OPENAI_API_KEY',
      })
    )
  })

  it('returns empty warnings when Providers JSON apiKey is the effective source', () => {
    const { configPath } = createTempStateDir()

    const warnings = auditOpenclawAiAuthOverrides({
      config: buildConfig(),
      configPath,
      env: {} as unknown as NodeJS.ProcessEnv,
    })

    expect(warnings).toEqual([])
  })

  it('syncs managed auth profile so updated Providers JSON apiKey becomes effective', () => {
    const { stateDir, configPath } = createTempStateDir()
    const authPath = path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json')
    fs.mkdirSync(path.dirname(authPath), { recursive: true })
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        version: 1,
        profiles: {
          'openai:default': {
            type: 'api_key',
            provider: 'openai',
            key: 'sk-old',
          },
        },
      }),
      'utf-8'
    )

    const syncResult = syncOpenclawManagedAiAuthProfiles({
      config: buildConfig(),
      configPath,
    })

    expect(syncResult.updated).toBe(true)
    expect(syncResult.authProfilesPath).toBe(authPath)

    const savedStore = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    expect(savedStore.profiles['autoads-managed:openai']).toEqual(
      expect.objectContaining({
        type: 'api_key',
        provider: 'openai',
        key: 'sk-new',
      })
    )
    expect(savedStore.order.openai?.[0]).toBe('autoads-managed:openai')

    const warnings = auditOpenclawAiAuthOverrides({
      config: buildConfig(),
      configPath,
      env: { OPENAI_API_KEY: 'sk-env-old' } as unknown as NodeJS.ProcessEnv,
    })
    expect(warnings).toEqual([])
  })
})

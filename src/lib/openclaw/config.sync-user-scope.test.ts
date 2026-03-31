import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSettingsByCategoryMock,
  getOpenclawGatewayTokenMock,
  collectUserFeishuAccountsMock,
} = vi.hoisted(() => ({
  getSettingsByCategoryMock: vi.fn(),
  getOpenclawGatewayTokenMock: vi.fn(),
  collectUserFeishuAccountsMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettingsByCategory: getSettingsByCategoryMock,
}))

vi.mock('@/lib/openclaw/auth', () => ({
  getOpenclawGatewayToken: getOpenclawGatewayTokenMock,
}))

vi.mock('@/lib/openclaw/feishu-accounts', () => ({
  collectUserFeishuAccounts: collectUserFeishuAccountsMock,
}))

import { syncOpenclawConfig } from '@/lib/openclaw/config'

describe('syncOpenclawConfig user scope', () => {
  let tempDir = ''
  let configPath = ''
  const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH
  const previousStateDir = process.env.OPENCLAW_STATE_DIR
  const previousGatewayEnvToken = process.env.OPENCLAW_GATEWAY_TOKEN
  const previousLegacyEnvToken = process.env.OPENCLAW_TOKEN

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-sync-'))
    configPath = path.join(tempDir, 'openclaw.json')
    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    getSettingsByCategoryMock.mockReset()
    getOpenclawGatewayTokenMock.mockReset()
    collectUserFeishuAccountsMock.mockReset()

    getOpenclawGatewayTokenMock.mockResolvedValue('gateway-test-token')
    collectUserFeishuAccountsMock.mockResolvedValue({})
  })

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath
    }

    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir
    }

    if (previousGatewayEnvToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = previousGatewayEnvToken
    }

    if (previousLegacyEnvToken === undefined) {
      delete process.env.OPENCLAW_TOKEN
    } else {
      process.env.OPENCLAW_TOKEN = previousLegacyEnvToken
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses global AI settings during actor user sync', async () => {
    const userAiModelsJson = JSON.stringify({
      providers: {
        openai: {
          api: 'openai-responses',
          apiKey: 'sk-user',
          models: [{ id: 'gpt-5' }],
        },
      },
      selectedModel: 'openai/gpt-5',
    })

    const globalAiModelsJson = JSON.stringify({
      providers: {
        anthropic: {
          api: 'anthropic',
          apiKey: 'sk-global',
          models: [{ id: 'claude-opus-4-5' }],
        },
      },
      selectedModel: 'anthropic/claude-opus-4-5',
    })

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: userAiModelsJson },
      ])
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: globalAiModelsJson },
      ])

    await syncOpenclawConfig({ reason: 'test-user-sync', actorUserId: 42 })

    expect(getSettingsByCategoryMock).toHaveBeenNthCalledWith(1, 'openclaw', 42)
    expect(getSettingsByCategoryMock).toHaveBeenNthCalledWith(2, 'openclaw')

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.models.providers.anthropic).toBeDefined()
    expect(written.models.providers.openai).toBeUndefined()
  })

  it('keeps existing model config on startup sync without actor user', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    getSettingsByCategoryMock.mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'startup-sync' })

    expect(getSettingsByCategoryMock).toHaveBeenCalledWith('openclaw')

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('openai/gpt-5.2')
    expect(written.models.providers.openai).toBeDefined()
  })

  it('hydrates runtime gateway token env aliases from setting token', async () => {
    getSettingsByCategoryMock.mockResolvedValueOnce([])
    delete process.env.OPENCLAW_GATEWAY_TOKEN
    delete process.env.OPENCLAW_TOKEN

    await syncOpenclawConfig({ reason: 'test-token-env-alias' })

    expect(process.env.OPENCLAW_GATEWAY_TOKEN).toBe('gateway-test-token')
    expect(process.env.OPENCLAW_TOKEN).toBe('gateway-test-token')
  })

  it('syncs optional gateway rate-limit and tools config when JSON settings are valid', async () => {
    getSettingsByCategoryMock.mockResolvedValueOnce([
      {
        key: 'gateway_auth_rate_limit_json',
        value: JSON.stringify({
          maxAttempts: 8,
          windowMs: 60000,
          lockoutMs: 300000,
          exemptLoopback: false,
        }),
      },
      {
        key: 'gateway_tools_json',
        value: JSON.stringify({
          allow: ['message'],
          deny: ['sessions_spawn'],
        }),
      },
    ])

    await syncOpenclawConfig({ reason: 'test-gateway-extended-settings' })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.gateway.auth.rateLimit).toEqual({
      maxAttempts: 8,
      windowMs: 60000,
      lockoutMs: 300000,
      exemptLoopback: false,
    })
    expect(written.gateway.tools).toEqual({
      allow: ['message'],
      deny: ['sessions_spawn'],
    })
  })

  it('prefers global AI settings when startup sync has global rows', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    const globalAiModelsJson = JSON.stringify({
      providers: {
        anthropic: {
          api: 'anthropic',
          apiKey: 'sk-global',
          models: [{ id: 'claude-opus-4-5' }],
        },
      },
      selectedModel: 'anthropic/claude-opus-4-5',
    })

    getSettingsByCategoryMock.mockResolvedValueOnce([
      { key: 'ai_models_json', value: globalAiModelsJson },
      { key: 'openclaw_models_mode', value: 'replace' },
    ])

    await syncOpenclawConfig({ reason: 'startup-sync' })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.models.mode).toBe('replace')
    expect(written.models.providers.anthropic).toBeDefined()
  })

  it('keeps existing AI config when global AI settings are missing', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    const userAiModelsJson = JSON.stringify({
      providers: {
        openai: {
          api: 'openai-responses',
          apiKey: 'sk-user',
          models: [{ id: 'gpt-5' }],
        },
      },
      selectedModel: 'openai/gpt-5',
    })

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: userAiModelsJson },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-user-sync-missing-global-ai', actorUserId: 42 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('openai/gpt-5.2')
    expect(written.models.providers.openai).toBeDefined()
  })

  it('keeps main Feishu account and maps legacy card key names to runtime keys', async () => {
    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'feishu_accounts_json',
          value: JSON.stringify({
            main: {
              appId: 'cli_actor',
              appSecret: 'sec_actor',
              cardVerificationToken: 'v1_legacy_main',
              cardEncryptKey: 'enc_legacy_main',
            },
          }),
        },
        { key: 'feishu_app_id', value: 'cli_actor' },
        { key: 'feishu_app_secret', value: 'sec_actor' },
      ])
      .mockResolvedValueOnce([])

    collectUserFeishuAccountsMock.mockResolvedValueOnce({
      'user-42': {
        appId: 'cli_actor',
        appSecret: 'sec_actor',
        dmPolicy: 'allowlist',
        cardVerificationToken: 'v1_legacy_user',
        cardEncryptKey: 'enc_legacy_user',
      },
    })

    await syncOpenclawConfig({ reason: 'test-user-feishu-compat', actorUserId: 42 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts['user-42']).toBeDefined()
    expect(written.channels.feishu.accounts.main).toBeDefined()
    expect(written.channels.feishu.accounts.main.verificationToken).toBe('v1_legacy_main')
    expect(written.channels.feishu.accounts.main.encryptKey).toBe('enc_legacy_main')
    expect(written.channels.feishu.accounts.main.cardVerificationToken).toBeUndefined()
    expect(written.channels.feishu.accounts.main.cardEncryptKey).toBeUndefined()
    expect(written.channels.feishu.accounts['user-42'].verificationToken).toBe('v1_legacy_user')
    expect(written.channels.feishu.accounts['user-42'].encryptKey).toBe('enc_legacy_user')
    expect(written.channels.feishu.accounts['user-42'].cardVerificationToken).toBeUndefined()
    expect(written.channels.feishu.accounts['user-42'].cardEncryptKey).toBeUndefined()
  })

  it('does not auto-fill legacy card confirm fields', async () => {
    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'feishu_app_id', value: 'cli_main' },
        { key: 'feishu_app_secret', value: 'sec_main' },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-feishu-no-card-confirm-autofill' })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts.main.cardConfirmUrl).toBeUndefined()
    expect(written.channels.feishu.accounts.main.cardConfirmAuthToken).toBeUndefined()
    expect(written.channels.feishu.accounts.main.cardConfirmTimeoutMs).toBeUndefined()
  })

  it('falls back to existing Feishu account credentials when settings decrypt fails', async () => {
    const existingConfig = {
      channels: {
        feishu: {
          accounts: {
            main: {
              appId: 'cli_existing',
              appSecret: 'sec_existing',
              allowFrom: ['ou_existing'],
              cardCallbackPath: '/feishu/card-action',
            },
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'feishu_app_id', value: '' },
        { key: 'feishu_app_secret', value: '' },
        { key: 'feishu_accounts_json', value: '' },
      ])
      .mockResolvedValueOnce([])

    collectUserFeishuAccountsMock.mockResolvedValueOnce({})

    await syncOpenclawConfig({ reason: 'test-feishu-credentials-fallback' })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts.main).toBeDefined()
    expect(written.channels.feishu.accounts.main.appId).toBe('cli_existing')
    expect(written.channels.feishu.accounts.main.appSecret).toBe('sec_existing')
  })

  it('keeps user Feishu account credentials from existing config when user aggregate is empty', async () => {
    const existingConfig = {
      channels: {
        feishu: {
          accounts: {
            'user-1': {
              appId: 'cli_user_existing',
              appSecret: 'sec_user_existing',
              allowFrom: ['ou_user_existing'],
              cardCallbackPath: '/feishu/user-1/card-action',
            },
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    collectUserFeishuAccountsMock.mockResolvedValueOnce({})

    await syncOpenclawConfig({ reason: 'test-feishu-user-fallback', actorUserId: 1 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts['user-1']).toBeDefined()
    expect(written.channels.feishu.accounts['user-1'].appId).toBe('cli_user_existing')
    expect(written.channels.feishu.accounts['user-1'].appSecret).toBe('sec_user_existing')
  })
  it('bootstraps SOUL workspace files and binds default workspace', async () => {
    getSettingsByCategoryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-workspace-bootstrap', actorUserId: 7 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const workspaceDir = path.join(tempDir, 'workspace', 'user-7')

    expect(written.agents.defaults.workspace).toBe(workspaceDir)
    expect(fs.existsSync(path.join(workspaceDir, 'AGENTS.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'SOUL.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'USER.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'MEMORY.md'))).toBe(true)

    const agentsContent = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8')
    expect(agentsContent).toContain('## AutoAds Runtime Rule (Managed by AutoAds)')

    const soulContent = fs.readFileSync(path.join(workspaceDir, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('Never open with Great question, I\'d be happy to help, or Absolutely. Just answer.')
    expect(soulContent).toContain('Be the assistant you\'d actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good.')
    expect(soulContent).toContain('仅当任务需要广告能力时，才调用 AutoAds API。')

    const memoryDir = path.join(workspaceDir, 'memory')
    const dailyFiles = fs.readdirSync(memoryDir).filter((name) => name.endsWith('.md'))
    expect(dailyFiles.length).toBeGreaterThan(0)
  })

  it('respects preferred workspace from agent defaults', async () => {
    const preferredWorkspace = path.join(tempDir, 'custom-workspace')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-preferred-workspace', actorUserId: 9 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.workspace).toBe(preferredWorkspace)
    expect(fs.existsSync(path.join(preferredWorkspace, 'SOUL.md'))).toBe(true)
  })

  it('upgrades legacy autogenerated SOUL content to managed template', async () => {
    const preferredWorkspace = path.join(tempDir, 'legacy-workspace')
    fs.mkdirSync(preferredWorkspace, { recursive: true })

    fs.writeFileSync(
      path.join(preferredWorkspace, 'SOUL.md'),
      `# SOUL.md

你是 OpenClaw，全能智能助手。你通过 Feishu 与用户沟通。

## OpenClaw 增强条款（v1）
- 旧规则
`,
      'utf-8'
    )

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-upgrade-legacy-soul', actorUserId: 12 })

    const soulContent = fs.readFileSync(path.join(preferredWorkspace, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('<!-- autoads-openclaw-soul-managed:start -->')
    expect(soulContent).toContain('Never open with Great question, I\'d be happy to help, or Absolutely. Just answer.')
    expect(soulContent).not.toContain('## OpenClaw 增强条款（v1）')
  })

  it('keeps custom SOUL text and appends managed runtime section', async () => {
    const preferredWorkspace = path.join(tempDir, 'custom-soul-workspace')
    fs.mkdirSync(preferredWorkspace, { recursive: true })

    const customSoul = `# SOUL.md

## My Custom Rule
- Keep this line`
    fs.writeFileSync(path.join(preferredWorkspace, 'SOUL.md'), customSoul, 'utf-8')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-append-managed-soul', actorUserId: 13 })

    const soulContent = fs.readFileSync(path.join(preferredWorkspace, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('## My Custom Rule')
    expect(soulContent).toContain('<!-- autoads-openclaw-soul-managed:start -->')
    expect(soulContent).toContain('仅当任务需要广告能力时，才调用 AutoAds API。')
  })

})

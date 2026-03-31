import { describe, expect, it } from 'vitest'
import { parseAiModelsJson, setAiModelsSelectedModel } from './ai-models'

describe('parseAiModelsJson', () => {
  it('reads models.providers and resolves current model from agents.defaults.model.primary', () => {
    const raw = JSON.stringify({
      models: {
        providers: {
          'aicodecat-gpt': {
            baseUrl: 'https://aicode.cat/v1',
            models: [
              { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
              { id: 'gpt-5.2', name: 'GPT-5.2' },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'aicodecat-gpt/gpt-5.2',
          },
        },
      },
    })

    const parsed = parseAiModelsJson(raw)

    expect(parsed.parseError).toBeNull()
    expect(parsed.jsonShape).toBe('models.providers')
    expect(parsed.modelOptions.map((item) => item.modelRef)).toEqual([
      'aicodecat-gpt/gpt-5.2-codex',
      'aicodecat-gpt/gpt-5.2',
    ])
    expect(parsed.selectedModelRef).toBe('aicodecat-gpt/gpt-5.2')
  })

  it('normalizes selected model when configured by model id only', () => {
    const raw = JSON.stringify({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          models: [
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
          ],
        },
      },
      selectedModel: 'gpt-5-mini',
    })

    const parsed = parseAiModelsJson(raw)

    expect(parsed.selectedModelRef).toBe('openai/gpt-5-mini')
  })
})

describe('setAiModelsSelectedModel', () => {
  it('updates models.selectedModel and agents.defaults.model.primary', () => {
    const raw = JSON.stringify({
      models: {
        mode: 'merge',
        providers: {
          'aicodecat-claude': {
            baseUrl: 'https://aicode.cat/v1',
            models: [
              { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
              { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'aicodecat-claude/claude-sonnet-4-5-20250929',
            fallbacks: ['aicodecat-claude/claude-sonnet-4-5-20250929'],
          },
        },
      },
    })

    const updated = setAiModelsSelectedModel(raw, 'aicodecat-claude/claude-opus-4-5-20251101')

    expect(updated.error).toBeNull()
    const next = JSON.parse(updated.json)
    expect(next.models.selectedModel).toBe('aicodecat-claude/claude-opus-4-5-20251101')
    expect(next.agents.defaults.model.primary).toBe('aicodecat-claude/claude-opus-4-5-20251101')
    expect(next.agents.defaults.model.fallbacks).toEqual(['aicodecat-claude/claude-sonnet-4-5-20250929'])
  })

  it('returns error when selected model does not exist in providers', () => {
    const raw = JSON.stringify({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          models: [{ id: 'gpt-5-mini', name: 'GPT-5 Mini' }],
        },
      },
    })

    const updated = setAiModelsSelectedModel(raw, 'openai/gpt-5')

    expect(updated.error).toBe('所选模型不在 Providers JSON 中')
    expect(updated.json).toBe(raw)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryOneMock = vi.fn()
const getDatabaseMock = vi.fn(async () => ({
  type: 'postgres',
  queryOne: queryOneMock,
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

import { clearPromptCache, loadPrompt } from '../prompt-loader'

describe('prompt-loader fallback behavior', () => {
  beforeEach(() => {
    clearPromptCache()
    queryOneMock.mockReset()
    getDatabaseMock.mockClear()
  })

  it('loads active prompt when active version exists', async () => {
    queryOneMock.mockResolvedValueOnce({
      prompt_content: 'active prompt content',
      version: 'v4.48',
      name: '广告创意生成v4.48',
    })

    const prompt = await loadPrompt('ad_creative_generation')

    expect(prompt).toBe('active prompt content')
    expect(queryOneMock).toHaveBeenCalledTimes(1)
    expect(queryOneMock.mock.calls[0]?.[0]).toContain('is_active = true')
  })

  it('falls back to latest prompt when no active version exists', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    queryOneMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        prompt_content: 'latest prompt content',
        version: 'v4.48',
        name: '广告创意生成v4.48',
      })

    const prompt = await loadPrompt('ad_creative_generation')

    expect(prompt).toBe('latest prompt content')
    expect(queryOneMock).toHaveBeenCalledTimes(2)
    expect(queryOneMock.mock.calls[1]?.[0]).toContain('ORDER BY created_at DESC, id DESC')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('没有激活版本，已回退使用最新版本')
    )

    warnSpy.mockRestore()
  })

  it('throws when both active and latest prompt are missing', async () => {
    queryOneMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    await expect(loadPrompt('ad_creative_generation')).rejects.toThrow(
      '找不到可用的Prompt版本(激活或最新): ad_creative_generation'
    )
  })
})

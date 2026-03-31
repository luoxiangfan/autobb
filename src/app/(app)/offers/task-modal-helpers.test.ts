import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveClickFarmTaskMode, resolveUrlSwapTaskMode } from './task-modal-helpers'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('task-modal-helpers', () => {
  it('returns editable click-farm task with hint when paused', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: 123,
          status: 'paused',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveClickFarmTaskMode(7)

    expect(fetchMock).toHaveBeenCalledWith('/api/offers/7/click-farm-task', {
      credentials: 'include',
    })
    expect(result.editTaskId).toBe(123)
    expect(result.infoMessage).toContain('已暂停')
  })

  it('returns create-mode hint for non-editable click-farm status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 456,
            status: 'completed',
          },
        }),
      })
    )

    const result = await resolveClickFarmTaskMode(9)

    expect(result.editTaskId).toBeUndefined()
    expect(result.infoMessage).toContain('已进入创建新任务')
  })

  it('returns empty mode when click-farm fetch is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      })
    )

    const result = await resolveClickFarmTaskMode(11)

    expect(result).toEqual({})
  })

  it('supports numeric url-swap task id and preserves edit mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 999,
            status: 'enabled',
          },
        }),
      })
    )

    const result = await resolveUrlSwapTaskMode(12)

    expect(result.editTaskId).toBe(999)
    expect(result.infoMessage).toBeUndefined()
  })

  it('returns create-mode hint for non-editable url-swap status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 'task-1',
            status: 'completed',
          },
        }),
      })
    )

    const result = await resolveUrlSwapTaskMode(13)

    expect(result.editTaskId).toBeUndefined()
    expect(result.infoMessage).toContain('已进入创建新任务')
  })
})

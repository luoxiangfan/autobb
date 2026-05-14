// @vitest-environment jsdom

import React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BatchTasksDialog from '@/components/BatchTasksDialog'

const toastFns = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    warning: toastFns.warning,
    error: toastFns.error,
    success: toastFns.success,
  },
}))

describe('BatchTasksDialog', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    ;(globalThis as any).ResizeObserver =
      (globalThis as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows warning toast when batch start is partially successful', async () => {
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: '批量任务处理完成',
        data: {
          selectionIdKind: 'offer',
          requestedCount: 2,
          requestedIdsCount: 2,
          matchedOfferCount: 2,
          failedOfferCount: 1,
          clickFarmTasksCreated: 1,
          clickFarmTasksUpdated: 0,
          urlSwapTasksCreated: 0,
          urlSwapTasksUpdated: 0,
          failedItemsByType: {
            clickFarm: 0,
            urlSwap: 1,
            general: 0,
          },
          errors: [
            { offerId: 102, type: 'urlSwap', error: '缺少 Campaign 关联' },
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={onOpenChange}
        variant="offers"
        offerIds={[101, 102]}
        onSuccess={onSuccess}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.warning).toHaveBeenCalledTimes(1)
    })

    expect(toastFns.warning).toHaveBeenCalledWith(
      '批量任务处理完成',
      expect.objectContaining({
        description: expect.stringMatching(/已选 2 个 Offer ID.*实际处理 2 个 Offer.*换链接 1 项/s),
      })
    )
    expect(toastFns.success).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const sent = JSON.parse(init.body as string)
    expect(sent).not.toHaveProperty('campaignIds')
    expect(sent.offerIds).toEqual([101, 102])
  })

  it('shows error toast when API returns structured full failure', async () => {
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          success: false,
          message: '批量开启任务失败',
          data: {
            requestedCount: 2,
            failedOfferCount: 2,
            errors: [
              { offerId: 101, type: 'clickFarm', error: '代理不可用' },
              { offerId: 102, type: 'urlSwap', error: '缺少 Campaign 关联' },
            ],
          },
        }),
      })
    )

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={onOpenChange}
        variant="offers"
        offerIds={[101, 102]}
        onSuccess={onSuccess}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.error).toHaveBeenCalledTimes(1)
    })

    expect(toastFns.error).toHaveBeenCalledWith(
      '批量开启任务失败',
      expect.objectContaining({
        description: expect.stringMatching(
          /已选 2 个 Offer ID，实际处理 2 个 Offer。Offer 101\(clickFarm\): 代理不可用；Offer 102\(urlSwap\): 缺少 Campaign 关联/s
        ),
        duration: 6000,
      })
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('treats empty campaignIds array as Offer mode (fetch offers API)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '请选择至少一个 Offer' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        campaignIds={[]}
        offerIds={[101]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/offers/batch-start-tasks')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const sent = JSON.parse(init.body as string)
    expect(sent).not.toHaveProperty('campaignIds')
    expect(sent.offerIds).toEqual([101])
  })

  it('disables primary button when there is no valid selection (deduped positive ids)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        offerIds={[0, -1, NaN as unknown as number]}
      />
    )

    const startBtn = screen.getByRole('button', { name: '一键开启' }) as HTMLButtonElement
    expect(startBtn.disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not duplicate unmatched hint in error toast when server message already mentions 未命中', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          success: false,
          message: '批量开启任务失败（已跳过 2 个未命中的 Offer ID）',
          data: {
            selectionIdKind: 'offer',
            requestedIdsCount: 2,
            matchedOfferCount: 0,
            unmatchedIdsCount: 2,
            errors: [{ offerId: 101, type: 'clickFarm', error: '代理不可用' }],
          },
        }),
      })
    )

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        offerIds={[101, 102]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.error).toHaveBeenCalledTimes(1)
    })

    const desc = (toastFns.error.mock.calls[0][1] as { description?: string }).description ?? ''
    expect(desc).not.toMatch(/另有 2 个请求 ID 未命中/)
    expect(desc).toMatch(/已选 2 个 Offer ID/)
    expect(desc).toMatch(/Offer 101/)
  })

  it('does not duplicate unmatched hint when only error field mentions 未命中', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: '校验失败：2 个 ID 未命中库',
          data: {
            selectionIdKind: 'offer',
            requestedIdsCount: 2,
            matchedOfferCount: 0,
            unmatchedIdsCount: 2,
            errors: [{ offerId: 101, type: 'clickFarm', error: 'x' }],
          },
        }),
      })
    )

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        offerIds={[101, 102]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.error).toHaveBeenCalledTimes(1)
    })

    expect(toastFns.error.mock.calls[0][0]).toBe('校验失败：2 个 ID 未命中库')
    const desc = (toastFns.error.mock.calls[0][1] as { description?: string }).description ?? ''
    expect(desc).not.toMatch(/另有 2 个请求 ID 未命中/)
    expect(desc).toMatch(/已选 2 个 Offer ID/)
  })

  it('success toast uses default title when message is not a string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: 12345,
          data: {
            selectionIdKind: 'offer',
            requestedIdsCount: 1,
            matchedOfferCount: 1,
            errors: [],
            clickFarmTasksCreated: 1,
            clickFarmTasksUpdated: 0,
            urlSwapTasksCreated: 0,
            urlSwapTasksUpdated: 0,
            failedOfferCount: 0,
          },
        }),
      })
    )

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        offerIds={[101]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.success).toHaveBeenCalledTimes(1)
    })

    expect(toastFns.success.mock.calls[0][0]).toBe('批量开启任务成功')
  })

  it('shows zero-selection guidance in dialog description', () => {
    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="offers"
        offerIds={[]}
      />
    )

    expect(document.body.textContent).toMatch(/请先在列表中勾选至少一项有效数据/)
  })

  it('uses campaigns endpoint when variant is campaigns even if offerIds is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'bad' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={vi.fn()}
        variant="campaigns"
        campaignIds={[301]}
        offerIds={[101]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/campaigns/batch-start-tasks')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const sent = JSON.parse(init.body as string)
    expect(sent).not.toHaveProperty('offerIds')
    expect(sent.campaignIds).toEqual([301])
  })
})

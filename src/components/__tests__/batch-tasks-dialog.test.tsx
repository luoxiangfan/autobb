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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: '批量任务处理完成',
          data: {
            requestedCount: 2,
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
    )

    render(
      <BatchTasksDialog
        open={true}
        onOpenChange={onOpenChange}
        offerIds={[101, 102]}
        onSuccess={onSuccess}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '一键开启' }))

    await waitFor(() => {
      expect(toastFns.warning).toHaveBeenCalledTimes(1)
    })

    expect(toastFns.warning).toHaveBeenCalledWith(
      '批量开启任务部分成功',
      expect.objectContaining({
        description: expect.stringContaining('换链接 1 项'),
      })
    )
    expect(toastFns.success).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
        description: '批量开启任务失败',
      })
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

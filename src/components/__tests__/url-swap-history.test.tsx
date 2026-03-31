// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UrlSwapHistory from '@/components/UrlSwapHistory'

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

  // Radix UI uses ResizeObserver in some environments
  ;(globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ||
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UrlSwapHistory', () => {
  it('renders swapped_at as a valid minute-precision datetime', async () => {
    const swappedAt = '2026-01-08T05:39:27.000Z'
    const pad2 = (value: number) => String(value).padStart(2, '0')
    const date = new Date(swappedAt)
    const expected = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
      date.getDate()
    )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          taskId: 'task-1',
          total: 1,
          history: [
            {
              swapped_at: swappedAt,
              previous_final_url: 'https://example.com/old',
              previous_final_url_suffix: 'a=1',
              new_final_url: 'https://example.com/new',
              new_final_url_suffix: 'b=2',
              success: true,
            },
          ],
        }),
      })
    )

    render(
      <UrlSwapHistory open={true} onOpenChange={() => {}} taskId="task-1" />
    )

    expect(await screen.findByText(expected)).toBeTruthy()
    expect(screen.queryByText('Invalid Date')).toBeNull()
  })
})

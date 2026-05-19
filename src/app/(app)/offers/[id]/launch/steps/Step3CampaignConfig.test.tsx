// @vitest-environment jsdom

import React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Step3CampaignConfig from './Step3CampaignConfig'

vi.mock('@/lib/toast-utils', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

const offer = {
  id: 1,
  brand: 'TestBrand',
  offerName: 'Test Offer',
  category: 'Electronics',
  targetCountry: 'US',
  targetLanguage: 'en',
  url: 'https://example.com',
}

const selectedCreative = {
  id: 100,
  headlines: Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`),
  descriptions: Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`),
  keywords: ['keyword one'],
  finalUrl: 'https://example.com/landing',
  finalUrlSuffix: 'utm_source=test',
  theme: 'Default',
  callouts: ['Free shipping'],
  sitelinks: [{ text: 'Shop', url: 'https://example.com/shop', description: 'Shop now' }],
}

const selectedAccount = {
  id: 1,
  customerId: '1234567890',
  currencyCode: 'USD',
  isActive: true,
}

function buildSavedConfig(overrides: Record<string, unknown> = {}) {
  return {
    campaignName: 'Saved_Campaign',
    budgetAmount: 99,
    budgetType: 'DAILY' as const,
    targetCountry: 'US',
    targetLanguage: 'en',
    biddingStrategy: 'MAXIMIZE_CLICKS',
    marketingObjective: 'WEB_TRAFFIC' as const,
    finalUrlSuffix: 'utm=test',
    adGroupName: 'Saved_AG',
    maxCpcBid: 0.5,
    keywords: [{ text: 'keyword one', matchType: 'EXACT' as const }],
    negativeKeywords: [] as string[],
    negativeKeywordMatchType: {},
    adName: 'RSA_Saved',
    headlines: Array.from({ length: 15 }, (_, i) => `Saved H${i + 1}`),
    descriptions: Array.from({ length: 4 }, (_, i) => `Saved D${i + 1}`),
    finalUrls: ['https://example.com/landing'],
    callouts: ['Free shipping'],
    sitelinks: [{ text: 'Shop', description: 'Shop now', url: 'https://example.com/shop' }],
    ...overrides,
  }
}

describe('Step3CampaignConfig', () => {
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

    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps initialConfig after remount (returning from step 4)', async () => {
    const onConfigured = vi.fn()
    const savedConfig = buildSavedConfig()
    const baseProps = {
      offer,
      selectedCreative,
      selectedAccount,
      onConfigured,
      initialConfig: savedConfig,
    }

    const { unmount } = render(<Step3CampaignConfig key="mount-1" {...baseProps} />)

    await waitFor(() => {
      expect(onConfigured).toHaveBeenCalled()
    })

    const lastConfigured = () => onConfigured.mock.calls.at(-1)?.[0]
    expect(lastConfigured()?.budgetAmount).toBe(99)
    expect(lastConfigured()?.campaignName).toBe('Saved_Campaign')

    unmount()
    onConfigured.mockClear()

    render(<Step3CampaignConfig key="mount-2" {...baseProps} />)

    await waitFor(() => {
      expect(onConfigured).toHaveBeenCalled()
    })

    expect(lastConfigured()?.budgetAmount).toBe(99)
    expect(lastConfigured()?.campaignName).toBe('Saved_Campaign')
    expect(screen.getByDisplayValue('99')).toBeTruthy()
  })

  it('resets config when selected creative changes while mounted', async () => {
    const onConfigured = vi.fn()
    const creativeB = {
      ...selectedCreative,
      id: 200,
      headlines: Array.from({ length: 15 }, (_, i) => `Creative B H${i + 1}`),
    }

    const { rerender } = render(
      <Step3CampaignConfig
        offer={offer}
        selectedCreative={selectedCreative}
        selectedAccount={selectedAccount}
        onConfigured={onConfigured}
        initialConfig={null}
      />
    )

    await waitFor(() => {
      expect(onConfigured).toHaveBeenCalled()
    })

    const defaultBudget = 10
    expect(onConfigured.mock.calls.at(-1)?.[0].budgetAmount).toBe(defaultBudget)

    onConfigured.mockClear()

    rerender(
      <Step3CampaignConfig
        offer={offer}
        selectedCreative={creativeB}
        selectedAccount={selectedAccount}
        onConfigured={onConfigured}
        initialConfig={null}
      />
    )

    await waitFor(() => {
      const latest = onConfigured.mock.calls.at(-1)?.[0]
      expect(latest?.headlines?.[0]).toBe('Creative B H1')
    })
  })
})

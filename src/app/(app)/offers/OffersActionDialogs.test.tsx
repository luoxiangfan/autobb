// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import OffersActionDialogs from './OffersActionDialogs'

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
})

afterEach(() => {
  vi.restoreAllMocks()
})

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    isUnlinkDialogOpen: false,
    onUnlinkDialogOpenChange: vi.fn(),
    offerToUnlink: null,
    removeGoogleAdsCampaignsOnUnlink: false,
    onRemoveGoogleAdsCampaignsOnUnlinkChange: vi.fn(),
    unlinking: false,
    onConfirmUnlink: vi.fn(),
    isDeleteDialogOpen: false,
    onDeleteDialogOpenChange: vi.fn(),
    offerToDelete: { id: 1, brand: 'Brand A', targetCountry: 'US', isBlacklisted: false } as any,
    deleteError: null,
    onDeleteErrorReset: vi.fn(),
    removeGoogleAdsCampaignsOnDelete: false,
    onRemoveGoogleAdsCampaignsOnDeleteChange: vi.fn(),
    deleting: false,
    onConfirmDeleteSimple: vi.fn(),
    isBatchDeleteDialogOpen: false,
    onBatchDeleteDialogOpenChange: vi.fn(),
    batchDeleteError: null,
    onBatchDeleteErrorReset: vi.fn(),
    selectedOfferCount: 1,
    batchDeleting: false,
    onConfirmBatchDelete: vi.fn(),
    isBatchCreativeDialogOpen: false,
    onBatchCreativeDialogOpenChange: vi.fn(),
    batchCreatingCreatives: false,
    maxBatchCreativeOffers: 50,
    onConfirmBatchCreateCreatives: vi.fn(),
    isBatchRebuildDialogOpen: false,
    onBatchRebuildDialogOpenChange: vi.fn(),
    batchRebuilding: false,
    maxBatchRebuildOffers: 50,
    onConfirmBatchRebuild: vi.fn(),
    isBlacklistDialogOpen: false,
    onBlacklistDialogOpenChange: vi.fn(),
    offerToBlacklist: { id: 1, brand: 'Brand A', targetCountry: 'US', isBlacklisted: false } as any,
    blacklisting: false,
    onConfirmToggleBlacklist: vi.fn(),
    ...overrides,
  }
}

describe('OffersActionDialogs', () => {
  it('keeps delete confirm action callable in delete dialog', () => {
    const props = createProps({ isDeleteDialogOpen: true })
    render(<OffersActionDialogs {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(props.onConfirmDeleteSimple).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(props.onDeleteErrorReset).toHaveBeenCalledTimes(1)
  })

  it('applies batch creative max guard', () => {
    const props = createProps({
      isBatchCreativeDialogOpen: true,
      selectedOfferCount: 51,
      maxBatchCreativeOffers: 50,
    })
    render(<OffersActionDialogs {...props} />)

    const confirmButton = screen.getByRole('button', { name: '确认提交' }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)
  })

  it('keeps unlink confirm action callable', () => {
    const props = createProps({
      isUnlinkDialogOpen: true,
      offerToUnlink: {
        offer: { id: 1, brand: 'Brand A', targetCountry: 'US' },
        accountId: 99,
        accountName: '123-456-7890',
      } as any,
    })
    render(<OffersActionDialogs {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '确认解除' }))
    expect(props.onConfirmUnlink).toHaveBeenCalledTimes(1)
  })

  it('keeps blacklist confirm action callable for unblacklist flow', () => {
    const props = createProps({
      isBlacklistDialogOpen: true,
      offerToBlacklist: {
        id: 1,
        brand: 'Brand A',
        targetCountry: 'US',
        isBlacklisted: true,
      } as any,
    })
    render(<OffersActionDialogs {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '确认取消拉黑' }))
    expect(props.onConfirmToggleBlacklist).toHaveBeenCalledTimes(1)
  })
})

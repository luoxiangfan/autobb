import { describe, expect, it } from 'vitest'
import {
  campaignHasBoundOffer,
  clickFarmTaskNeedsPause,
  clickFarmTaskNeedsStart,
  getOfferTasksMenuLabel,
  isCampaignEnabled,
  resolveOfferTasksToggleAction,
  shouldShowIndividualOfferTaskMenuItems,
  shouldShowOfferTasksMenuItem,
  urlSwapTaskNeedsPause,
  urlSwapTaskNeedsStart,
} from '@/lib/offer-tasks-toggle'

describe('resolveOfferTasksToggleAction', () => {
  it('prefers pause when click-farm is pending or running', () => {
    expect(resolveOfferTasksToggleAction('running', 'disabled')).toBe('pause')
    expect(resolveOfferTasksToggleAction('pending', null)).toBe('pause')
  })

  it('prefers pause when url-swap is enabled', () => {
    expect(resolveOfferTasksToggleAction('stopped', 'enabled')).toBe('pause')
  })

  it('uses start when tasks are inactive or terminal', () => {
    expect(resolveOfferTasksToggleAction('stopped', 'disabled')).toBe('start')
    expect(resolveOfferTasksToggleAction('completed', 'error')).toBe('start')
    expect(resolveOfferTasksToggleAction(null, null)).toBe('start')
    expect(resolveOfferTasksToggleAction('paused', 'disabled')).toBe('start')
  })

  it('does not treat paused click-farm or error url-swap as pause targets', () => {
    expect(clickFarmTaskNeedsPause('paused')).toBe(false)
    expect(urlSwapTaskNeedsPause('error')).toBe(false)
    expect(clickFarmTaskNeedsStart('paused')).toBe(true)
    expect(urlSwapTaskNeedsStart('error')).toBe(true)
  })
})

describe('getOfferTasksMenuLabel', () => {
  it('returns action-specific labels', () => {
    expect(getOfferTasksMenuLabel('pause')).toBe('暂停关联 Offer 任务')
    expect(getOfferTasksMenuLabel('start')).toBe('开启关联 Offer 任务')
  })
})

describe('shouldShowIndividualOfferTaskMenuItems', () => {
  it('hides CLK/URL entries when campaign is paused', () => {
    expect(shouldShowIndividualOfferTaskMenuItems('PAUSED')).toBe(false)
    expect(shouldShowIndividualOfferTaskMenuItems('paused')).toBe(false)
  })

  it('shows CLK/URL entries when campaign is enabled', () => {
    expect(shouldShowIndividualOfferTaskMenuItems('ENABLED')).toBe(true)
  })
})

describe('shouldShowOfferTasksMenuItem', () => {
  it('hides menu when offer is not bound', () => {
    expect(
      shouldShowOfferTasksMenuItem({
        offerId: 0,
        campaignStatus: 'ENABLED',
        action: 'pause',
      })
    ).toBe(false)
    expect(campaignHasBoundOffer(null)).toBe(false)
  })

  it('hides start menu when campaign is not enabled', () => {
    expect(
      shouldShowOfferTasksMenuItem({
        offerId: 101,
        campaignStatus: 'PAUSED',
        action: 'start',
      })
    ).toBe(false)
    expect(isCampaignEnabled('PAUSED')).toBe(false)
  })

  it('shows pause menu for paused campaign with active tasks', () => {
    expect(
      shouldShowOfferTasksMenuItem({
        offerId: 101,
        campaignStatus: 'PAUSED',
        action: 'pause',
      })
    ).toBe(true)
  })

  it('shows start menu when campaign is enabled', () => {
    expect(
      shouldShowOfferTasksMenuItem({
        offerId: 101,
        campaignStatus: 'ENABLED',
        action: 'start',
      })
    ).toBe(true)
  })
})

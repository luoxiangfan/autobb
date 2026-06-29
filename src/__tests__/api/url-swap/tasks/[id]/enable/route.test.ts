import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authUser = {
  userId: 1,
  email: 'test@example.com',
  role: 'user',
  packageType: 'pro',
}

const urlSwapFns = vi.hoisted(() => ({
  getUrlSwapTaskById: vi.fn(),
  enableUrlSwapTask: vi.fn(),
}))

const campaignFns = vi.hoisted(() => ({
  hasEnabledCampaignForOffer: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => {
    return async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> }
    ) => {
      const resolvedParams = routeContext?.params ? await routeContext.params : undefined
      const context = resolvedParams ? { params: resolvedParams } : undefined
      return handler(request, authUser, context)
    }
  },
}))

vi.mock('@/lib/url-swap', () => ({
  getUrlSwapTaskById: urlSwapFns.getUrlSwapTaskById,
  enableUrlSwapTask: urlSwapFns.enableUrlSwapTask,
}))

vi.mock('@/lib/url-swap/url-swap-scheduler', () => ({
  triggerUrlSwapScheduling: vi.fn(async () => ({ taskId: 'us-1', status: 'queued' })),
}))

vi.mock('@/lib/campaign/campaign-health-guard', () => ({
  ENABLED_CAMPAIGN_REQUIRED_MESSAGE: 'campaign required',
  ENABLED_CAMPAIGN_REQUIRED_SUGGESTION: 'enable campaign first',
  hasEnabledCampaignForOffer: campaignFns.hasEnabledCampaignForOffer,
}))

import { POST } from '@/app/api/url-swap/tasks/[id]/enable/route'

describe('POST /api/url-swap/tasks/[id]/enable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlSwapFns.getUrlSwapTaskById.mockResolvedValue({
      id: 'us-1',
      user_id: 1,
      offer_id: 101,
      status: 'disabled',
    })
    campaignFns.hasEnabledCampaignForOffer.mockResolvedValue(true)
    urlSwapFns.enableUrlSwapTask.mockResolvedValue(undefined)
  })

  it('returns 400 when no enabled campaign exists for offer', async () => {
    campaignFns.hasEnabledCampaignForOffer.mockResolvedValue(false)

    const req = new NextRequest('http://localhost/api/url-swap/tasks/us-1/enable', {
      method: 'POST',
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'us-1' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('campaign_required')
    expect(urlSwapFns.enableUrlSwapTask).not.toHaveBeenCalled()
  })

  it('enables task when enabled campaign exists', async () => {
    const req = new NextRequest('http://localhost/api/url-swap/tasks/us-1/enable', {
      method: 'POST',
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'us-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(urlSwapFns.enableUrlSwapTask).toHaveBeenCalledWith('us-1', 1)
  })
})

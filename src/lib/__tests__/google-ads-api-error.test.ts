import { describe, expect, it } from 'vitest'

import { formatGoogleAdsApiError } from '@/lib/google-ads-api-error'

describe('formatGoogleAdsApiError', () => {
  it('formats policy_violation_details with actionable context', () => {
    const error = {
      request_id: 'nlyd5wqRrXgcCgAlvLur0Q',
      errors: [
        {
          message: 'A policy was violated. See PolicyViolationDetails for more detail.',
          trigger: { string_value: 'kahi' },
          location: {
            field_path_elements: [
              { field_name: 'operations', index: 0 },
              { field_name: 'create' },
              { field_name: 'keyword' },
              { field_name: 'text' },
            ],
          },
          details: {
            policy_violation_details: {
              external_policy_description:
                "Your account must have a copyright certificate for the domain on which you're promoting the streaming or downloading of copyrighted content.",
              key: { policy_name: 'COPYRIGHTED_CONTENT', violating_text: 'kahi' },
              external_policy_name: 'Copyrighted content',
              is_exemptible: true,
            },
          },
        },
        {
          message: 'A policy was violated. See PolicyViolationDetails for more detail.',
          trigger: { string_value: 'Kahi' },
          location: {
            field_path_elements: [
              { field_name: 'operations', index: 1 },
              { field_name: 'create' },
              { field_name: 'keyword' },
              { field_name: 'text' },
            ],
          },
          details: {
            policy_violation_details: {
              external_policy_description:
                "Your account must have a copyright certificate for the domain on which you're promoting the streaming or downloading of copyrighted content.",
              key: { policy_name: 'COPYRIGHTED_CONTENT', violating_text: 'Kahi' },
              external_policy_name: 'Copyrighted content',
              is_exemptible: true,
            },
          },
        },
      ],
    }

    const message = formatGoogleAdsApiError(error)
    expect(message).toContain('Google Ads 政策违规')
    expect(message).toContain('Copyrighted content / COPYRIGHTED_CONTENT')
    expect(message).toContain('关键词: kahi, Kahi')
    expect(message).toContain('可申请豁免: 是')
    expect(message).toContain('RequestId=nlyd5wqRrXgcCgAlvLur0Q')
  })

  it('maps account-not-enabled errors to a friendly message', () => {
    const message = formatGoogleAdsApiError({
      request_id: 'req-acc-001',
      errors: [
        {
          message: "The customer account can't be accessed because it is not yet enabled or has been deactivated.",
          error_code: { authorization_error: 'CUSTOMER_NOT_ENABLED' },
        },
      ],
    })

    expect(message).toContain('账号状态异常（未启用/已停用），请联系管理员或在 Google Ads 中恢复后重试。')
    expect(message).toContain('RequestId=req-acc-001')
  })

  it('falls back to joined error messages when no policy details exist', () => {
    const message = formatGoogleAdsApiError({
      request_id: 'req-123',
      errors: [{ message: 'Some error' }, { message: 'Some error' }, { message: 'Another error' }],
    })

    expect(message).toContain('Some error')
    expect(message).toContain('Another error')
    expect(message).toContain('RequestId=req-123')
  })

  it('formats policy_finding_details with policy topics', () => {
    const message = formatGoogleAdsApiError({
      request_id: 'Yp-jcEUbWe0fuQvm-GceSA',
      errors: [
        {
          message:
            'The resource has been disapproved since the policy summary includes policy topics of type PROHIBITED.',
          error_code: { policy_finding_error: 2 },
          location: {
            field_path_elements: [
              { field_name: 'operations', index: 0 },
              { field_name: 'create' },
              { field_name: 'ad' },
            ],
          },
          details: {
            policy_finding_details: {
              policy_topic_entries: [
                {
                  topic: 'Misrepresentation',
                  type: 'PROHIBITED',
                  evidences: [{ text_list: { texts: ['dr mercola liposomal vitamin c'] } }],
                },
              ],
            },
          },
        },
      ],
    })

    expect(message).toContain('Google Ads 政策审核未通过')
    expect(message).toContain('Misrepresentation')
    expect(message).toContain('类型: PROHIBITED')
    expect(message).toContain('dr mercola liposomal vitamin c')
    expect(message).toContain('RequestId=Yp-jcEUbWe0fuQvm-GceSA')
  })

  it('handles non-object errors', () => {
    expect(formatGoogleAdsApiError('bad')).toBe('bad')
    expect(formatGoogleAdsApiError(new Error('boom'))).toBe('boom')
  })
})

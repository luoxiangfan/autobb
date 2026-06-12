import { describe, expect, it } from 'vitest'
import {
  EMPTY_IDENTITY_VERIFICATION,
  extractIdentityVerificationSnapshot,
} from '@/lib/google-ads/accounts/identity-verification'

describe('extractIdentityVerificationSnapshot', () => {
  it('returns empty snapshot when response has no identity data', () => {
    expect(extractIdentityVerificationSnapshot({})).toEqual(EMPTY_IDENTITY_VERIFICATION)
    expect(extractIdentityVerificationSnapshot(null)).toEqual(EMPTY_IDENTITY_VERIFICATION)
  })

  it('parses advertiser identity verification with overdue deadline', () => {
    const pastDeadline = new Date(Date.now() - 86_400_000).toISOString()
    const snapshot = extractIdentityVerificationSnapshot({
      identity_verification: [
        {
          verification_program: 'ADVERTISER_IDENTITY_VERIFICATION',
          identity_verification_requirement: {
            verification_completion_deadline_time: pastDeadline,
          },
          verification_progress: {
            program_status: 'PENDING',
          },
        },
      ],
    })

    expect(snapshot.programStatus).toBe('PENDING')
    expect(snapshot.verificationCompletionDeadlineTime).toBe(pastDeadline)
    expect(snapshot.overdue).toBe(true)
  })

  it('does not mark overdue when program status is SUCCESS', () => {
    const pastDeadline = new Date(Date.now() - 86_400_000).toISOString()
    const snapshot = extractIdentityVerificationSnapshot({
      identityVerifications: [
        {
          verificationProgram: 'ADVERTISER_IDENTITY_VERIFICATION',
          identityVerificationRequirement: {
            verificationCompletionDeadlineTime: pastDeadline,
          },
          verificationProgress: {
            programStatus: 'SUCCESS',
          },
        },
      ],
    })

    expect(snapshot.programStatus).toBe('SUCCESS')
    expect(snapshot.overdue).toBe(false)
  })

  it('marks overdue on FAILURE regardless of deadline', () => {
    const snapshot = extractIdentityVerificationSnapshot({
      identity_verifications: [
        {
          verification_program: 2,
          verification_progress: { program_status: 'FAILURE' },
        },
      ],
    })

    expect(snapshot.programStatus).toBe('FAILURE')
    expect(snapshot.overdue).toBe(true)
  })
})

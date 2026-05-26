import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

export type IdentityVerificationSnapshot = {
  programStatus: string | null
  verificationStartDeadlineTime: string | null
  verificationCompletionDeadlineTime: string | null
  overdue: boolean
}

export const EMPTY_IDENTITY_VERIFICATION: IdentityVerificationSnapshot = {
  programStatus: null,
  verificationStartDeadlineTime: null,
  verificationCompletionDeadlineTime: null,
  overdue: false,
}

export function extractIdentityVerificationSnapshot(rawResponse: any): IdentityVerificationSnapshot {
  const identityVerificationList =
    rawResponse?.identity_verification ||
    rawResponse?.identityVerification ||
    rawResponse?.identity_verifications ||
    rawResponse?.identityVerifications ||
    []

  if (!Array.isArray(identityVerificationList) || identityVerificationList.length === 0) {
    return { ...EMPTY_IDENTITY_VERIFICATION }
  }

  const advertiserIdentity = identityVerificationList.find((item: any) => {
    const program = item?.verification_program ?? item?.verificationProgram
    return program === 'ADVERTISER_IDENTITY_VERIFICATION' || program === 2 || program === '2'
  }) ?? identityVerificationList[0]

  const requirement = advertiserIdentity?.identity_verification_requirement ?? advertiserIdentity?.identityVerificationRequirement
  const progress = advertiserIdentity?.verification_progress ?? advertiserIdentity?.verificationProgress

  const programStatusRaw = progress?.program_status ?? progress?.programStatus ?? null
  const programStatus = programStatusRaw ? String(programStatusRaw).toUpperCase() : null

  const verificationStartDeadlineTime =
    requirement?.verification_start_deadline_time ??
    requirement?.verificationStartDeadlineTime ??
    null
  const verificationCompletionDeadlineTime =
    requirement?.verification_completion_deadline_time ??
    requirement?.verificationCompletionDeadlineTime ??
    null

  const completionDeadlineMs = verificationCompletionDeadlineTime ? Date.parse(String(verificationCompletionDeadlineTime)) : NaN
  const deadlinePassed = !Number.isNaN(completionDeadlineMs) && completionDeadlineMs < Date.now()

  const overdue =
    programStatus !== null &&
    programStatus !== 'SUCCESS' &&
    (programStatus === 'FAILURE' || deadlinePassed)

  return {
    programStatus,
    verificationStartDeadlineTime: verificationStartDeadlineTime ? String(verificationStartDeadlineTime) : null,
    verificationCompletionDeadlineTime: verificationCompletionDeadlineTime ? String(verificationCompletionDeadlineTime) : null,
    overdue,
  }
}

export async function fetchIdentityVerificationSnapshot(params: {
  userId: number
  customerId: string
  customer?: any
  authType: 'oauth' | 'service_account'
  serviceAccountConfig?: any
}): Promise<IdentityVerificationSnapshot> {
  const startTime = Date.now()
  try {
    if (params.authType === 'service_account') {
      const { getIdentityVerificationPython } = await import('@/lib/python-ads-client')
      const resp = await getIdentityVerificationPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountConfig?.id?.toString(),
        customerId: params.customerId,
      })

      await trackApiUsage({
        userId: params.userId,
        operationType: ApiOperationType.SEARCH,
        endpoint: 'getIdentityVerification',
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: true,
      })

      return extractIdentityVerificationSnapshot(resp)
    }

    const identityVerificationService =
      params.customer?.identityVerifications ||
      params.customer?.identityVerification ||
      params.customer?.identity_verifications ||
      params.customer?.identity_verification ||
      null

    const getIdentityVerificationFn = identityVerificationService?.getIdentityVerification

    if (typeof getIdentityVerificationFn !== 'function') {
      return { ...EMPTY_IDENTITY_VERIFICATION }
    }

    const resp = await getIdentityVerificationFn.call(identityVerificationService, {
      customer_id: params.customerId,
    })

    await trackApiUsage({
      userId: params.userId,
      operationType: ApiOperationType.SEARCH,
      endpoint: 'getIdentityVerification',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })

    return extractIdentityVerificationSnapshot(resp)
  } catch (error: any) {
    await trackApiUsage({
      userId: params.userId,
      operationType: ApiOperationType.SEARCH,
      endpoint: 'getIdentityVerification',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: error?.message || String(error),
    }).catch(() => {})

    return { ...EMPTY_IDENTITY_VERIFICATION }
  }
}

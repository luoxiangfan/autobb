'use client'

import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ServiceAccountPermissionError } from '@/components/ServiceAccountPermissionError'
import {
  buildDefaultServiceAccountPermissionSteps,
  hasServiceAccountPermissionDetails,
  type ServiceAccountPermissionDetails,
} from '@/lib/google-ads/accounts/fetch'

type GoogleAdsServiceAccountPermissionAlertProps = {
  details: ServiceAccountPermissionDetails | null | undefined
  onDismiss?: () => void
  className?: string
}

export function GoogleAdsServiceAccountPermissionAlert({
  details,
  onDismiss,
  className,
}: GoogleAdsServiceAccountPermissionAlertProps) {
  if (!hasServiceAccountPermissionDetails(details)) {
    return null
  }

  const steps =
    details.solution?.steps?.length && details.solution.steps.length > 0
      ? details.solution.steps
      : buildDefaultServiceAccountPermissionSteps(details)

  if (steps.length > 0) {
    return (
      <div className={className}>
        <ServiceAccountPermissionError
          serviceAccountEmail={details.serviceAccountEmail ?? ''}
          mccCustomerId={details.mccCustomerId ?? ''}
          steps={steps}
          docsUrl={details.solution?.docsUrl}
          onDismiss={onDismiss}
        />
      </div>
    )
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-5 w-5" />
      <AlertTitle className="text-lg font-semibold">服务账号权限不足</AlertTitle>
      <AlertDescription className="mt-2 space-y-2 text-sm">
        {details.serviceAccountEmail ? (
          <p>
            服务账号：<span className="font-mono">{details.serviceAccountEmail}</span>
          </p>
        ) : null}
        {details.mccCustomerId ? (
          <p>
            MCC 账户 ID：<span className="font-mono">{details.mccCustomerId}</span>
          </p>
        ) : null}
        <p>请将该服务账号添加到 MCC 并授予足够权限，然后刷新页面。</p>
      </AlertDescription>
    </Alert>
  )
}

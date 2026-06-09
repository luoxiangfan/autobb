'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { GoogleAdsAuthSettings } from './useGoogleAdsAuthSettings'

type Props = Pick<
  GoogleAdsAuthSettings,
  | 'deleteConfirmState'
  | 'setDeleteConfirmState'
  | 'deletingOAuthConfig'
  | 'deletingServiceAccountId'
  | 'handleDeleteConfirm'
>

export function GoogleAdsDeleteConfirmDialog({
  deleteConfirmState,
  setDeleteConfirmState,
  deletingOAuthConfig,
  deletingServiceAccountId,
  handleDeleteConfirm,
}: Props) {
  return (
    <AlertDialog
      open={deleteConfirmState !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteConfirmState(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteConfirmState?.kind === 'oauth'
              ? '确认删除 OAuth 配置？'
              : '确认删除服务账号配置？'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleteConfirmState?.kind === 'oauth'
              ? '将清除 OAuth 基础配置（Client ID / Secret / Developer Token / Login Customer ID）以及 Refresh Token。删除后需要重新填写并重新授权才能继续使用 OAuth 模式。'
              : '将删除当前服务账号配置（包含私钥等敏感信息）。删除后需要重新上传服务账号 JSON 才能继续使用服务账号模式。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={
              deletingOAuthConfig ||
              (deleteConfirmState?.kind === 'service_account' &&
                deletingServiceAccountId === deleteConfirmState.serviceAccountId)
            }
          >
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={
              deletingOAuthConfig ||
              (deleteConfirmState?.kind === 'service_account' &&
                deletingServiceAccountId === deleteConfirmState.serviceAccountId)
            }
            onClick={async (e) => {
              e.preventDefault()
              await handleDeleteConfirm()
            }}
          >
            {deleteConfirmState?.kind === 'oauth'
              ? deletingOAuthConfig
                ? '删除中...'
                : '确认删除'
              : deleteConfirmState?.kind === 'service_account' &&
                  deletingServiceAccountId === deleteConfirmState.serviceAccountId
                ? '删除中...'
                : '确认删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'src/app/(app)/campaigns/CampaignsClientPage.tsx')
const dest = path.join(root, 'src/app/(app)/campaigns/CampaignsActionDialogs.tsx')

const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/)
const dialogLines = lines.slice(5461, 6074) // 1-based 5462-6074

const header = `'use client'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { getCampaignStatusLabel } from '@/lib/i18n-constants'
import {
  ENABLE_CAMPAIGN_OFFER_TASK_HINTS,
  PAUSE_CAMPAIGN_OFFER_TASK_HINTS,
} from './toggle-status-warning'
import {
  buildBatchAccountIssueSampleNames,
  buildBatchAccountStatusSummary,
} from './batch-dialog-utils'
import type { BatchOfflinePendingState, Campaign } from './types'

export type CampaignsActionDialogsProps = {
  isToggleStatusDialogOpen: boolean
  setIsToggleStatusDialogOpen: (open: boolean) => void
  toggleStatusTarget: Campaign | null
  setToggleStatusTarget: (campaign: Campaign | null) => void
  toggleStatusNextStatus: string | null
  setToggleStatusNextStatus: (status: string | null) => void
  confirmToggleStatus: () => void | Promise<void>

  isPauseOfferTasksDialogOpen: boolean
  setIsPauseOfferTasksDialogOpen: (open: boolean) => void
  pauseOfferTasksTarget: {
    id: number
    campaignName: string
    action: 'pause' | 'start'
  } | null
  setPauseOfferTasksTarget: (
    target: { id: number; campaignName: string; action: 'pause' | 'start' } | null
  ) => void
  pauseOfferTasksSubmitting: boolean
  confirmPauseOfferTasks: () => void | Promise<void>

  isBatchDeleteDialogOpen: boolean
  setIsBatchDeleteDialogOpen: (open: boolean) => void
  batchDeleteSubmitting: boolean
  selectedCampaignIds: Set<number>
  selectedRemovedCampaignCount: number
  handleBatchDeleteRemoved: () => void | Promise<void>

  isBatchOfflineDialogOpen: boolean
  setIsBatchOfflineDialogOpen: (open: boolean) => void
  batchOfflineSubmitting: boolean
  batchOfflineRemoveGoogleAds: boolean
  setBatchOfflineRemoveGoogleAds: (checked: boolean) => void
  batchOfflineBlacklistOffer: boolean
  setBatchOfflineBlacklistOffer: (checked: boolean) => void
  batchOfflinePauseClickFarm: boolean
  setBatchOfflinePauseClickFarm: (checked: boolean) => void
  batchOfflinePauseUrlSwap: boolean
  setBatchOfflinePauseUrlSwap: (checked: boolean) => void
  resetBatchOfflineState: () => void
  handleBatchOffline: () => void | Promise<void>

  isBatchOfflineAccountIssueDialogOpen: boolean
  setIsBatchOfflineAccountIssueDialogOpen: (open: boolean) => void
  batchOfflinePendingState: BatchOfflinePendingState | null
  confirmBatchOfflineLocalOnly: () => void | Promise<void>

  isDeleteRemovedDialogOpen: boolean
  setIsDeleteRemovedDialogOpen: (open: boolean) => void
  deleteRemovedTarget: Campaign | null
  setDeleteRemovedTarget: (campaign: Campaign | null) => void
  deleteRemovedSubmitting: boolean
  confirmDeleteRemoved: () => void | Promise<void>

  isDeleteDraftDialogOpen: boolean
  setIsDeleteDraftDialogOpen: (open: boolean) => void
  deleteDraftTarget: Campaign | null
  setDeleteDraftTarget: (campaign: Campaign | null) => void
  deleteDraftSubmitting: boolean
  confirmDeleteDraft: () => void | Promise<void>

  isOfflineDialogOpen: boolean
  setIsOfflineDialogOpen: (open: boolean) => void
  offlineTarget: Campaign | null
  setOfflineTarget: (campaign: Campaign | null) => void
  offlineBlacklistOffer: boolean
  setOfflineBlacklistOffer: (checked: boolean) => void
  offlinePauseClickFarm: boolean
  setOfflinePauseClickFarm: (checked: boolean) => void
  offlinePauseUrlSwap: boolean
  setOfflinePauseUrlSwap: (checked: boolean) => void
  offlineRemoveGoogleAds: boolean
  setOfflineRemoveGoogleAds: (checked: boolean) => void
  offlineSubmitting: boolean
  confirmOffline: () => void | Promise<void>

  isOfflineAccountIssueDialogOpen: boolean
  setIsOfflineAccountIssueDialogOpen: (open: boolean) => void
  offlineAccountIssueMessage: string | null
  setOfflineAccountIssueMessage: (message: string | null) => void
  offlineAccountIssueStatus: string | null
  setOfflineAccountIssueStatus: (status: string | null) => void
  confirmOfflineLocalOnly: () => void | Promise<void>
}

export function CampaignsActionDialogs(props: CampaignsActionDialogsProps) {
  const {
    isToggleStatusDialogOpen,
    setIsToggleStatusDialogOpen,
    toggleStatusTarget,
    setToggleStatusTarget,
    toggleStatusNextStatus,
    setToggleStatusNextStatus,
    confirmToggleStatus,
    isPauseOfferTasksDialogOpen,
    setIsPauseOfferTasksDialogOpen,
    pauseOfferTasksTarget,
    setPauseOfferTasksTarget,
    pauseOfferTasksSubmitting,
    confirmPauseOfferTasks,
    isBatchDeleteDialogOpen,
    setIsBatchDeleteDialogOpen,
    batchDeleteSubmitting,
    selectedCampaignIds,
    selectedRemovedCampaignCount,
    handleBatchDeleteRemoved,
    isBatchOfflineDialogOpen,
    setIsBatchOfflineDialogOpen,
    batchOfflineSubmitting,
    batchOfflineRemoveGoogleAds,
    setBatchOfflineRemoveGoogleAds,
    batchOfflineBlacklistOffer,
    setBatchOfflineBlacklistOffer,
    batchOfflinePauseClickFarm,
    setBatchOfflinePauseClickFarm,
    batchOfflinePauseUrlSwap,
    setBatchOfflinePauseUrlSwap,
    resetBatchOfflineState,
    handleBatchOffline,
    isBatchOfflineAccountIssueDialogOpen,
    setIsBatchOfflineAccountIssueDialogOpen,
    batchOfflinePendingState,
    confirmBatchOfflineLocalOnly,
    isDeleteRemovedDialogOpen,
    setIsDeleteRemovedDialogOpen,
    deleteRemovedTarget,
    setDeleteRemovedTarget,
    deleteRemovedSubmitting,
    confirmDeleteRemoved,
    isDeleteDraftDialogOpen,
    setIsDeleteDraftDialogOpen,
    deleteDraftTarget,
    setDeleteDraftTarget,
    deleteDraftSubmitting,
    confirmDeleteDraft,
    isOfflineDialogOpen,
    setIsOfflineDialogOpen,
    offlineTarget,
    setOfflineTarget,
    offlineBlacklistOffer,
    setOfflineBlacklistOffer,
    offlinePauseClickFarm,
    setOfflinePauseClickFarm,
    offlinePauseUrlSwap,
    setOfflinePauseUrlSwap,
    offlineRemoveGoogleAds,
    setOfflineRemoveGoogleAds,
    offlineSubmitting,
    confirmOffline,
    isOfflineAccountIssueDialogOpen,
    setIsOfflineAccountIssueDialogOpen,
    offlineAccountIssueMessage,
    setOfflineAccountIssueMessage,
    offlineAccountIssueStatus,
    setOfflineAccountIssueStatus,
    confirmOfflineLocalOnly,
  } = props

  return (
    <>
`

const footer = `
    </>
  )
}
`

const body = dialogLines
  .join('\n')
  .replace(
    /buildBatchAccountIssueSampleNames\(batchOfflinePendingState\.accountIssues\)/g,
    'buildBatchAccountIssueSampleNames(batchOfflinePendingState.accountIssues)'
  )
  .replace(
    /buildBatchAccountStatusSummary\(batchOfflinePendingState\.accountIssues\)/g,
    'buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues)'
  )

fs.writeFileSync(dest, `${header}${body}${footer}`)
console.log('Wrote CampaignsActionDialogs.tsx')

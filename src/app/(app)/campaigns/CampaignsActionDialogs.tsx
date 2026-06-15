'use client'

import type { Dispatch, SetStateAction } from 'react'

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
import type { OfferTasksToggleAction } from '@/lib/offer-tasks-toggle'
import type { BatchOfflinePendingState, Campaign } from './types'

export type CampaignsActionDialogsProps = {
  isToggleStatusDialogOpen: boolean
  setIsToggleStatusDialogOpen: (open: boolean) => void
  toggleStatusTarget: Campaign | null
  setToggleStatusTarget: (campaign: Campaign | null) => void
  toggleStatusNextStatus: 'PAUSED' | 'ENABLED' | null
  setToggleStatusNextStatus: (status: 'PAUSED' | 'ENABLED' | null) => void
  confirmToggleStatus: () => void | Promise<void>

  isPauseOfferTasksDialogOpen: boolean
  setIsPauseOfferTasksDialogOpen: (open: boolean) => void
  pauseOfferTasksTarget: {
    id: number
    campaignName: string
    offerId: number
    action: OfferTasksToggleAction
  } | null
  setPauseOfferTasksTarget: Dispatch<
    SetStateAction<{
      id: number
      campaignName: string
      offerId: number
      action: OfferTasksToggleAction
    } | null>
  >
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
      {/* Toggle Status Confirmation Dialog */}
      <AlertDialog
        open={isToggleStatusDialogOpen}
        onOpenChange={(open) => {
          setIsToggleStatusDialogOpen(open)
          if (!open) {
            setToggleStatusTarget(null)
            setToggleStatusNextStatus(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleStatusNextStatus === 'PAUSED' ? '确认暂停广告系列' : '确认启用广告系列'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  确认要将广告系列{' '}
                  <strong className="text-gray-900">
                    {toggleStatusTarget?.campaignName || '-'}
                  </strong>{' '}
                  {toggleStatusNextStatus
                    ? `切换为「${getCampaignStatusLabel(toggleStatusNextStatus)}」吗？`
                    : '进行状态切换吗？'}
                </p>

                {toggleStatusNextStatus === 'PAUSED' ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    <p className="font-medium mb-1">暂停后将会：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>停止在 Google Ads 的投放</li>
                      <li>避免继续产生花费</li>
                      {PAUSE_CAMPAIGN_OFFER_TASK_HINTS.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                      <li>可随时重新启用恢复投放</li>
                    </ul>
                    <p className="mt-2 text-xs text-yellow-700/90">
                      若该广告系列未绑定 Offer，将跳过关联任务暂停/禁用。
                    </p>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                    <p className="font-medium mb-1">启用后将会：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>恢复在 Google Ads 的投放</li>
                      <li>可能立即开始产生花费</li>
                      {ENABLE_CAMPAIGN_OFFER_TASK_HINTS.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                      <li>请确认预算与出价设置无误</li>
                    </ul>
                    <p className="mt-2 text-xs text-green-700/90">
                      若该广告系列未绑定 Offer，将跳过关联任务恢复/创建。
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmToggleStatus()}
              className={
                toggleStatusNextStatus === 'PAUSED'
                  ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-600'
                  : 'bg-green-600 hover:bg-green-700 focus:ring-green-600'
              }
            >
              {toggleStatusNextStatus === 'PAUSED' ? '确认暂停' : '确认启用'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Pause / Start Offer Tasks Confirmation Dialog */}
      <AlertDialog
        open={isPauseOfferTasksDialogOpen}
        onOpenChange={(open) => {
          setIsPauseOfferTasksDialogOpen(open)
          if (!open) {
            setPauseOfferTasksTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pauseOfferTasksTarget?.action === 'start'
                ? '确认开启关联 Offer 任务'
                : '确认暂停关联 Offer 任务'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  确认要为广告系列{' '}
                  <strong className="text-gray-900">
                    {pauseOfferTasksTarget?.campaignName || '-'}
                  </strong>{' '}
                  {pauseOfferTasksTarget?.action === 'start'
                    ? '关联 Offer 按默认配置恢复或新建任务吗？'
                    : '关联 Offer 暂停/禁用任务吗？'}
                </p>
                {pauseOfferTasksTarget?.action === 'start' ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                    <p className="font-medium mb-1">开启后将会：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      {ENABLE_CAMPAIGN_OFFER_TASK_HINTS.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                      <li>已处于运行中且配置已是默认参数的任务将自动跳过</li>
                    </ul>
                  </div>
                ) : (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                    <p className="font-medium mb-1">暂停后将会：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>补点击任务标记为已停止</li>
                      <li>换链接任务标记已禁用</li>
                      <li>已完成任务不会变更</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pauseOfferTasksSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmPauseOfferTasks()}
              disabled={pauseOfferTasksSubmitting}
              className={
                pauseOfferTasksTarget?.action === 'start'
                  ? 'bg-green-600 hover:bg-green-700 focus:ring-green-600'
                  : 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-600'
              }
            >
              {pauseOfferTasksSubmitting
                ? pauseOfferTasksTarget?.action === 'start'
                  ? '开启中...'
                  : '暂停中...'
                : pauseOfferTasksTarget?.action === 'start'
                  ? '确认开启'
                  : '确认暂停'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog
        open={isBatchDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsBatchDeleteDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  将永久删除选中项中状态为"已移除"或"账号已解绑"的{' '}
                  <strong className="text-gray-900">{selectedRemovedCampaignCount}</strong>{' '}
                  个广告系列。
                </p>
                {selectedCampaignIds.size > selectedRemovedCampaignCount && (
                  <p className="text-sm text-amber-700">
                    另外 {selectedCampaignIds.size - selectedRemovedCampaignCount}{' '}
                    个不可删除的广告系列会被自动跳过。
                  </p>
                )}
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">批量删除将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>永久删除这些广告系列</li>
                    <li>删除后不再显示在当前列表</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleteSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void handleBatchDeleteRemoved()}
              disabled={batchDeleteSubmitting || selectedRemovedCampaignCount === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchDeleteSubmitting
                ? '删除中...'
                : `确认批量删除 (${selectedRemovedCampaignCount})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Offline Confirmation Dialog */}
      <AlertDialog
        open={isBatchOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线选中的{' '}
                  <strong className="text-gray-900">{selectedCampaignIds.size}</strong>{' '}
                  个广告系列吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">批量下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>逐个下线选中的广告系列</li>
                    <li>在 Google Ads 中暂停这些广告系列（可选删除）</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineRemoveGoogleAds}
                    onCheckedChange={(checked) => setBatchOfflineRemoveGoogleAds(Boolean(checked))}
                    id="batch-offline-remove-google-ads"
                  />
                  <label
                    htmlFor="batch-offline-remove-google-ads"
                    className="text-sm text-gray-700"
                  >
                    同时在 Google Ads 中删除这些广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">以下选项会影响对应 Offer</div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineBlacklistOffer}
                    onCheckedChange={(checked) => setBatchOfflineBlacklistOffer(Boolean(checked))}
                    id="batch-offline-blacklist-offer"
                  />
                  <label htmlFor="batch-offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑对应 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseClickFarm}
                    onCheckedChange={(checked) => setBatchOfflinePauseClickFarm(Boolean(checked))}
                    id="batch-offline-pause-click-farm"
                  />
                  <label htmlFor="batch-offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseUrlSwap}
                    onCheckedChange={(checked) => setBatchOfflinePauseUrlSwap(Boolean(checked))}
                    id="batch-offline-pause-url-swap"
                  />
                  <label htmlFor="batch-offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void handleBatchOffline()}
              disabled={batchOfflineSubmitting || selectedCampaignIds.size === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '下线中...' : `确认批量下线 (${selectedCampaignIds.size})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Offline Account Issue Dialog */}
      <AlertDialog
        open={isBatchOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineAccountIssueDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>部分账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  有{' '}
                  <strong className="text-gray-900">
                    {batchOfflinePendingState?.accountIssues.length || 0}
                  </strong>{' '}
                  个广告系列因 Ads 账号状态异常，无法在 Google Ads 中
                  {batchOfflineRemoveGoogleAds ? '删除' : '暂停'}。
                </p>
                <p>
                  {batchOfflinePendingState?.accountIssues[0]?.message ||
                    '是否继续仅本地下线这些广告系列？'}
                </p>
                {batchOfflinePendingState && batchOfflinePendingState.accountIssues.length > 0 && (
                  <div className="text-sm text-gray-700">
                    示例广告系列：
                    <strong>
                      {buildBatchAccountIssueSampleNames(batchOfflinePendingState.accountIssues)}
                    </strong>
                  </div>
                )}
                {batchOfflinePendingState &&
                  buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues) && (
                    <div className="text-sm text-gray-700">
                      账号状态分布：
                      <strong>
                        {buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues)}
                      </strong>
                    </div>
                  )}
                {batchOfflinePendingState && batchOfflinePendingState.failures.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    已有 {batchOfflinePendingState.failures.length} 个广告系列因其他原因下线失败，
                    将在本次完成后统一汇总提示。
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记这些广告系列为已下线</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">以下选项会影响对应 Offer</div>
                <div className="text-sm text-gray-700">
                  当前选择： Google Ads 侧{batchOfflineRemoveGoogleAds ? '删除' : '暂停'}，
                  {batchOfflineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {batchOfflinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {batchOfflinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmBatchOfflineLocalOnly()}
              disabled={batchOfflineSubmitting || !batchOfflinePendingState}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '处理中...' : '仅本地下线异常项'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Removed Campaign Confirmation Dialog */}
      <AlertDialog
        open={isDeleteRemovedDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteRemovedDialogOpen(open)
          if (!open && !deleteRemovedSubmitting) {
            setDeleteRemovedTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要永久删除广告系列{' '}
                  <strong className="text-gray-900">
                    {deleteRemovedTarget?.campaignName || '-'}
                  </strong>{' '}
                  吗？
                </p>
                <p className="text-sm text-red-700">此操作会从列表中彻底移除，不可恢复。</p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>从广告系列列表中彻底移除</li>
                    <li>
                      仅删除本地记录，不会触发新的 Google Ads 操作（包含 Ads 账号已解绑的广告系列）
                    </li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRemovedSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmDeleteRemoved()}
              disabled={deleteRemovedSubmitting || !deleteRemovedTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteRemovedSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Draft Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDraftDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDraftDialogOpen(open)
          if (!open && !deleteDraftSubmitting) {
            setDeleteDraftTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除草稿广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除草稿广告系列{' '}
                  <strong className="text-gray-900">
                    {deleteDraftTarget?.campaignName || '-'}
                  </strong>{' '}
                  吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>永久删除该本地草稿广告系列</li>
                    <li>不会触发 Google Ads 侧投放变化</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDraftSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmDeleteDraft()}
              disabled={deleteDraftSubmitting || !deleteDraftTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDraftSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Confirmation Dialog */}
      <AlertDialog
        open={isOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineDialogOpen(open)
          if (!open) {
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线广告系列{' '}
                  <strong className="text-gray-900">{offlineTarget?.campaignName || '-'}</strong>{' '}
                  吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>在 Google Ads 中暂停该广告系列（可选删除）</li>
                    <li>仅下线当前广告系列，不影响同 Offer 下其他广告系列</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineRemoveGoogleAds}
                    onCheckedChange={(checked) => setOfflineRemoveGoogleAds(Boolean(checked))}
                    id="offline-remove-google-ads"
                  />
                  <label htmlFor="offline-remove-google-ads" className="text-sm text-gray-700">
                    同时在 Google Ads 中删除该广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">以下选项会影响整个 Offer</div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineBlacklistOffer}
                    onCheckedChange={(checked) => setOfflineBlacklistOffer(Boolean(checked))}
                    id="offline-blacklist-offer"
                  />
                  <label htmlFor="offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑该 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseClickFarm}
                    onCheckedChange={(checked) => setOfflinePauseClickFarm(Boolean(checked))}
                    id="offline-pause-click-farm"
                  />
                  <label htmlFor="offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseUrlSwap}
                    onCheckedChange={(checked) => setOfflinePauseUrlSwap(Boolean(checked))}
                    id="offline-pause-url-swap"
                  />
                  <label htmlFor="offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOffline()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '下线中...' : '确认下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Account Issue Dialog */}
      <AlertDialog
        open={isOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineAccountIssueDialogOpen(open)
          if (!open) {
            setOfflineAccountIssueMessage(null)
            setOfflineAccountIssueStatus(null)
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {offlineAccountIssueMessage ||
                    '当前 Ads 账号状态异常，无法在 Google Ads 中暂停/删除广告系列。'}
                </p>
                {offlineAccountIssueStatus && (
                  <div className="text-sm text-gray-700">
                    当前账号状态：<strong>{offlineAccountIssueStatus}</strong>
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记该广告系列为已下线（不影响同 Offer 下其他广告系列）</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">以下选项会影响整个 Offer</div>
                <div className="text-sm text-gray-700">
                  当前选择： Google Ads 侧{offlineRemoveGoogleAds ? '删除' : '暂停'}，
                  {offlineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {offlinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {offlinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOfflineLocalOnly()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '处理中...' : '仅本地下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import dynamic from 'next/dynamic'
import {
  Coins,
  Loader2,
  MoreHorizontal,
  Package,
  PauseCircle,
  PlayCircle,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  campaignHasBoundOffer,
  getOfferTasksMenuLabel,
  resolveOfferTasksToggleAction,
  shouldShowIndividualOfferTaskMenuItems,
  shouldShowOfferTasksMenuItem,
} from '@/lib/offers'
import { CampaignSortableHeader } from './CampaignSortableHeader'
import type { Campaign, CampaignSortDirection, CampaignSortField } from './types'

const EditableCustomName = dynamic(
  () => import('@/components/EditableCustomName').then((mod) => mod.EditableCustomName),
  { ssr: false }
)
const EditableCampaignName = dynamic(
  () => import('@/components/EditableCampaignName').then((mod) => mod.EditableCampaignName),
  { ssr: false }
)
const EditableStatusCategory = dynamic(
  () => import('@/components/EditableStatusCategory').then((mod) => mod.EditableStatusCategory),
  { ssr: false }
)

export type CampaignsTableProps = {
  paginatedCampaigns: Campaign[]
  filteredCampaigns: Campaign[]
  selectedCampaignIds: Set<number>
  sortField: CampaignSortField | null
  sortDirection: CampaignSortDirection
  onSort: (field: CampaignSortField) => void
  onSelectAll: (checked: boolean) => void
  onSelectCampaign: (campaign: Campaign, checked: boolean) => void
  totalItems: number
  totalPages: number
  currentPage: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  defaultCurrency: string
  formatMoney: (value: number, currencyCode?: string) => string
  isCampaignDeleted: (campaign: Campaign) => boolean
  isOfferDeleted: (campaign: Campaign) => boolean
  getCampaignGoogleId: (campaign: Campaign) => string | null
  getStatusBadge: (status: string, adsAccountAvailable?: boolean) => ReactNode
  statusUpdatingIds: Set<number>
  offlineSubmitting: boolean
  deleteDraftSubmitting: boolean
  deleteRemovedSubmitting: boolean
  pauseOfferTasksSubmitting: boolean
  setCampaigns: Dispatch<SetStateAction<Campaign[]>>
  onAdjustBudget: (target: {
    googleCampaignId: string
    campaignName: string
    currentBudget: number
    currentBudgetType: string
    currency: string
  }) => void
  onAdjustCpc: (target: { googleCampaignId: string; campaignName: string }) => void
  onToggleStatus: (campaign: Campaign) => void | Promise<void>
  onOffline: (campaign: Campaign) => void
  onDeleteRemoved: (campaign: Campaign) => void
  onDeleteDraft: (campaign: Campaign) => void
  onPauseOfferTasks: (campaign: Campaign) => void
  onOpenClickFarmModal: (campaign: Campaign) => void | Promise<void>
  onOpenUrlSwapModal: (campaign: Campaign) => void | Promise<void>
  clickFarmLoading: boolean
  urlSwapLoading: boolean
}

export function CampaignsTable({
  paginatedCampaigns,
  filteredCampaigns,
  selectedCampaignIds,
  sortField,
  sortDirection,
  onSort,
  onSelectAll,
  onSelectCampaign,
  totalItems,
  totalPages,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  defaultCurrency,
  formatMoney,
  isCampaignDeleted,
  isOfferDeleted,
  getCampaignGoogleId,
  getStatusBadge,
  statusUpdatingIds,
  offlineSubmitting,
  deleteDraftSubmitting,
  deleteRemovedSubmitting,
  pauseOfferTasksSubmitting,
  setCampaigns,
  onAdjustBudget,
  onAdjustCpc,
  onToggleStatus,
  onOffline,
  onDeleteRemoved,
  onDeleteDraft,
  onPauseOfferTasks,
  onOpenClickFarmModal,
  onOpenUrlSwapModal,
  clickFarmLoading,
  urlSwapLoading,
}: CampaignsTableProps) {
  const handleSort = onSort
  const handleSelectAll = (checked: boolean | 'indeterminate') => onSelectAll(checked === true)
  const handleSelectCampaign = onSelectCampaign
  const openToggleStatusConfirm = onToggleStatus
  const openOfflineDialog = onOffline
  const openPauseOfferTasksDialog = onPauseOfferTasks

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[1260px] [&_th]:h-9 [&_th]:px-1 [&_td]:px-1 [&_td]:py-1.5 [&_thead_th]:bg-white">
            <TableHeader>
              <TableRow>
                {/* 全选checkbox */}
                <TableHead className="w-[30px]">
                  <Checkbox
                    checked={
                      paginatedCampaigns.length > 0 &&
                      paginatedCampaigns.every((campaign) => selectedCampaignIds.has(campaign.id))
                    }
                    onCheckedChange={handleSelectAll}
                    aria-label="全选"
                  />
                </TableHead>
                <CampaignSortableHeader
                  field="campaignName"
                  className="w-[300px] whitespace-nowrap"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  系列名称
                </CampaignSortableHeader>
                <TableHead className="w-[200px] whitespace-nowrap">自定义名称</TableHead>
                <CampaignSortableHeader
                  field="budgetAmount"
                  className="w-[86px] whitespace-nowrap"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  预算
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="impressions"
                  className="w-[58px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  展示
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="clicks"
                  className="w-[58px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  点击
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="ctr"
                  className="w-[56px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  点击率
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="cpc"
                  className="w-[94px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  实际CPC
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="configuredMaxCpc"
                  className="w-[94px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  配置CPC
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="conversions"
                  className="w-[94px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  佣金
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="cost"
                  className="w-[94px] whitespace-nowrap px-0.5!"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  花费
                </CampaignSortableHeader>
                <TableHead className="w-[100px] whitespace-nowrap">运营状态</TableHead>
                <TableHead className="w-[100px] whitespace-nowrap">关联 Offer 任务</TableHead>
                <CampaignSortableHeader
                  field="status"
                  className="w-[78px] whitespace-nowrap"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  投放状态
                </CampaignSortableHeader>
                <CampaignSortableHeader
                  field="servingStartDate"
                  className="w-[74px] whitespace-nowrap"
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                >
                  投放日期
                </CampaignSortableHeader>
                <TableHead className="w-[48px] whitespace-nowrap text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedCampaigns.map((campaign) => {
                // 🔧 检查 is_deleted 布尔值
                const isDeleted = isCampaignDeleted(campaign)
                const offerDeleted = isOfferDeleted(campaign)
                const googleCampaignId = getCampaignGoogleId(campaign)
                const isStatusUpdating = statusUpdatingIds.has(campaign.id)
                const budgetCurrency = campaign.adsAccountCurrency || defaultCurrency
                const performanceCurrency =
                  campaign.performanceCurrency || campaign.adsAccountCurrency || defaultCurrency

                const canAdjustCpc =
                  Boolean(googleCampaignId) &&
                  !isDeleted &&
                  !offerDeleted &&
                  campaign.adsAccountAvailable !== false
                const adjustCpcDisabledReason = !googleCampaignId
                  ? '该广告系列尚未发布到Google Ads，无法调整CPC'
                  : campaign.adsAccountAvailable === false
                    ? 'Ads账号已解绑，无法调整CPC'
                    : isDeleted
                      ? '该广告系列已删除，无法调整CPC'
                      : offerDeleted
                        ? '关联Offer已删除，无法调整CPC'
                        : '调整CPC出价'
                const canAdjustBudget =
                  Boolean(googleCampaignId) &&
                  !isDeleted &&
                  !offerDeleted &&
                  campaign.adsAccountAvailable !== false
                const adjustBudgetDisabledReason = !googleCampaignId
                  ? '该广告系列尚未发布到Google Ads，无法调整每日预算'
                  : campaign.adsAccountAvailable === false
                    ? 'Ads账号已解绑，无法调整每日预算'
                    : isDeleted
                      ? '该广告系列已删除，无法调整每日预算'
                      : offerDeleted
                        ? '关联Offer已删除，无法调整每日预算'
                        : '调整每日预算'

                const canToggleStatus =
                  !isStatusUpdating &&
                  Boolean(googleCampaignId) &&
                  !isDeleted &&
                  !offerDeleted &&
                  campaign.adsAccountAvailable !== false &&
                  (campaign.status === 'ENABLED' || campaign.status === 'PAUSED')
                const toggleLabel = campaign.status === 'ENABLED' ? '暂停广告系列' : '启用广告系列'
                const toggleDisabledReason = isStatusUpdating
                  ? '操作中...'
                  : !googleCampaignId
                    ? '该广告系列尚未发布到Google Ads，无法暂停/启用'
                    : campaign.adsAccountAvailable === false
                      ? 'Ads账号已解绑，无法暂停/启用'
                      : isDeleted
                        ? '该广告系列已删除，无法暂停/启用'
                        : offerDeleted
                          ? '关联Offer已删除，无法暂停/启用'
                          : campaign.status !== 'ENABLED' && campaign.status !== 'PAUSED'
                            ? `当前状态(${campaign.status})不支持暂停/启用`
                            : toggleLabel

                const normalizedCreationStatus = String(campaign.creationStatus || '').toLowerCase()
                const canOfflineWithoutGoogleCampaign =
                  normalizedCreationStatus === 'pending' || normalizedCreationStatus === 'failed'
                const canOffline =
                  !offlineSubmitting &&
                  !isDeleted &&
                  !offerDeleted &&
                  String(campaign.status || '').toUpperCase() !== 'REMOVED' &&
                  (Boolean(googleCampaignId) || canOfflineWithoutGoogleCampaign) &&
                  (googleCampaignId ? campaign.adsAccountAvailable !== false : true)
                const offlineDisabledReason = isDeleted
                  ? '该广告系列已删除，无法下线'
                  : offerDeleted
                    ? '关联Offer已删除，无法下线'
                    : String(campaign.status || '').toUpperCase() === 'REMOVED'
                      ? '该广告系列已下线'
                      : !googleCampaignId && !canOfflineWithoutGoogleCampaign
                        ? '该广告系列尚未发布到Google Ads，且不在可下线状态（pending/failed）'
                        : googleCampaignId && campaign.adsAccountAvailable === false
                          ? 'Ads账号已解绑，无法下线'
                          : '下线广告系列（不可恢复）'

                const canDeleteDraft = campaign.creationStatus === 'draft'
                const canDeleteDraftAction = canDeleteDraft && !deleteDraftSubmitting
                const isRemovedStatus = String(campaign.status || '').toUpperCase() === 'REMOVED'
                const canDeleteRemovedAction =
                  (isRemovedStatus || campaign.adsAccountAvailable === false) &&
                  !deleteRemovedSubmitting
                const configuredMaxCpc = Number(campaign.configuredMaxCpc)
                const hasConfiguredMaxCpc =
                  Number.isFinite(configuredMaxCpc) && configuredMaxCpc > 0

                return (
                  <TableRow
                    key={campaign.id}
                    className={`hover:bg-gray-50/50 ${isDeleted || offerDeleted ? 'bg-gray-50' : ''}`}
                  >
                    {/* 选择checkbox */}
                    <TableCell>
                      <Checkbox
                        checked={selectedCampaignIds.has(campaign.id)}
                        onCheckedChange={(checked) =>
                          handleSelectCampaign(campaign, checked as boolean)
                        }
                        aria-label={`选择 ${campaign.campaignName}`}
                        title="加入批量下线"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <EditableCampaignName
                          campaignId={campaign.id}
                          initialCampaignName={campaign.campaignName}
                          disabled={isDeleted || offerDeleted}
                          onSaved={(newName) => {
                            setCampaigns((prev) =>
                              prev.map((c) =>
                                c.id === campaign.id ? { ...c, campaignName: newName } : c
                              )
                            )
                          }}
                        />
                        {isDeleted && (
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 shrink-0"
                            title="已删除"
                            aria-label="已删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </span>
                        )}
                        {offerDeleted && !isDeleted && (
                          <Badge
                            variant="outline"
                            className="text-xs whitespace-nowrap bg-orange-50 text-orange-700 border-orange-200 shrink-0"
                          >
                            Offer已删除
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="w-[200px] whitespace-nowrap">
                      <EditableCustomName
                        campaignId={campaign.id}
                        initialCustomName={campaign.customName}
                        disabled={isDeleted || offerDeleted}
                        onSaved={(newName) => {
                          // 更新本地状态
                          setCampaigns((prev) =>
                            prev.map((c) =>
                              c.id === campaign.id ? { ...c, customName: newName } : c
                            )
                          )
                        }}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="min-w-0">
                        <div
                          className="font-medium text-gray-900 truncate"
                          title={formatMoney(Number(campaign.budgetAmount) || 0, budgetCurrency)}
                        >
                          {formatMoney(Number(campaign.budgetAmount) || 0, budgetCurrency)}
                        </div>
                        <Badge
                          variant="outline"
                          className="mt-0.5 text-[10px] px-1 py-0 whitespace-nowrap border-gray-200 text-gray-600"
                        >
                          {campaign.budgetType}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {campaign.performance?.impressions?.toLocaleString() || '0'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {campaign.performance?.clicks?.toLocaleString() || '0'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {(Number(campaign.performance?.ctr) || 0).toFixed(2)}%
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {formatMoney(
                          Number(campaign.performance?.cpcLocal ?? campaign.performance?.cpcUsd) ||
                            0,
                          performanceCurrency
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {hasConfiguredMaxCpc ? formatMoney(configuredMaxCpc, budgetCurrency) : '-'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {formatMoney(
                          Number(
                            campaign.performance?.commission ?? campaign.performance?.conversions
                          ) || 0,
                          performanceCurrency
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-0.5!">
                      <div className="font-medium text-gray-900">
                        {formatMoney(
                          Number(
                            campaign.performance?.costLocal ?? campaign.performance?.costUsd
                          ) || 0,
                          performanceCurrency
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <EditableStatusCategory
                        campaignId={campaign.id}
                        initialStatusCategory={campaign.statusCategory}
                        disabled={isDeleted || offerDeleted}
                        onSaved={(newStatus) => {
                          // 更新本地状态
                          setCampaigns((prev) =>
                            prev.map((c) =>
                              c.id === campaign.id ? { ...c, statusCategory: newStatus } : c
                            )
                          )
                        }}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(() => {
                        const hasClickFarm =
                          campaign.clickFarmTaskStatus && campaign.clickFarmTaskStatus === 'running'
                        const hasUrlSwap =
                          campaign.urlSwapTaskStatus && campaign.urlSwapTaskStatus === 'enabled'

                        // 红：都未开启，黄：一个开启，绿：两个都开启
                        const taskColor =
                          hasClickFarm && hasUrlSwap
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : hasClickFarm || hasUrlSwap
                              ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                              : 'bg-red-100 text-red-800 border-red-200'

                        const taskLabel =
                          hasClickFarm && hasUrlSwap
                            ? '双任务'
                            : hasClickFarm
                              ? '补点击运行中'
                              : hasUrlSwap
                                ? '换链接已启用'
                                : '无运行中任务'

                        return (
                          <Badge variant="outline" className={`w-full justify-center ${taskColor}`}>
                            {taskLabel}
                          </Badge>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {getStatusBadge(campaign.status, campaign.adsAccountAvailable)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm text-gray-900">
                        {campaign.servingStartDate || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            aria-label="更多操作"
                            title="更多操作"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => window.open(`/offers/${campaign.offerId}`, '_blank')}
                          >
                            <Package className="w-4 h-4 text-green-600" />
                            <span>查看关联Offer</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => {
                              if (!googleCampaignId) return
                              if (campaign.adsAccountAvailable === false) return
                              onAdjustBudget({
                                googleCampaignId,
                                campaignName: campaign.campaignName,
                                currentBudget: Number(campaign.budgetAmount) || 0,
                                currentBudgetType: String(campaign.budgetType || 'DAILY'),
                                currency: budgetCurrency,
                              })
                            }}
                            disabled={!canAdjustBudget}
                            title={adjustBudgetDisabledReason}
                          >
                            <Wallet className="w-4 h-4 text-emerald-600" />
                            <span>调整每日预算</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => {
                              if (!googleCampaignId) return
                              if (campaign.adsAccountAvailable === false) return
                              onAdjustCpc({
                                googleCampaignId,
                                campaignName: campaign.campaignName,
                              })
                            }}
                            disabled={!canAdjustCpc}
                            title={adjustCpcDisabledReason}
                          >
                            <Coins className="w-4 h-4 text-indigo-600" />
                            <span>调整CPC</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => void openToggleStatusConfirm(campaign)}
                            disabled={!canToggleStatus}
                            title={toggleDisabledReason}
                          >
                            {isStatusUpdating ? (
                              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                            ) : campaign.status === 'ENABLED' ? (
                              <PauseCircle className="w-4 h-4 text-yellow-600" />
                            ) : (
                              <PlayCircle className="w-4 h-4 text-green-600" />
                            )}
                            <span>{isStatusUpdating ? '状态更新中' : toggleLabel}</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => openOfflineDialog(campaign)}
                            disabled={!canOffline}
                            title={offlineDisabledReason}
                          >
                            <XCircle className="w-4 h-4 text-red-600" />
                            <span>下线广告系列</span>
                          </DropdownMenuItem>

                          {(isRemovedStatus ||
                            campaign.adsAccountAvailable === false ||
                            canDeleteDraft) && <DropdownMenuSeparator />}

                          {(isRemovedStatus || campaign.adsAccountAvailable === false) && (
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => onDeleteRemoved(campaign)}
                              disabled={!canDeleteRemovedAction}
                              title={
                                canDeleteRemovedAction
                                  ? '永久删除广告系列（本地删除，不再调用 Google Ads）'
                                  : '删除中...'
                              }
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                              <span>删除广告系列</span>
                            </DropdownMenuItem>
                          )}

                          {canDeleteDraft && (
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => onDeleteDraft(campaign)}
                              disabled={!canDeleteDraftAction}
                              title={canDeleteDraftAction ? '删除草稿广告系列' : '删除中...'}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                              <span>删除草稿</span>
                            </DropdownMenuItem>
                          )}
                          {shouldShowIndividualOfferTaskMenuItems(campaign.status) &&
                            campaignHasBoundOffer(campaign.offerId) && (
                              <>
                                <DropdownMenuItem
                                  className="gap-2"
                                  title="补点击任务"
                                  disabled={clickFarmLoading}
                                  onClick={() => void onOpenClickFarmModal(campaign)}
                                >
                                  <span className="text-[10px] font-semibold text-gray-500">
                                    CLK
                                  </span>
                                  <span>补点击任务</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2"
                                  title="换链接任务"
                                  disabled={urlSwapLoading || !campaign.adsAccountAvailable}
                                  onClick={() => void onOpenUrlSwapModal(campaign)}
                                >
                                  <span className="text-[10px] font-semibold text-gray-500">
                                    URL
                                  </span>
                                  <span>换链接任务</span>
                                </DropdownMenuItem>
                              </>
                            )}
                          {(() => {
                            const offerTasksAction = resolveOfferTasksToggleAction(
                              campaign.clickFarmTaskStatus,
                              campaign.urlSwapTaskStatus
                            )
                            if (
                              !shouldShowOfferTasksMenuItem({
                                offerId: campaign.offerId,
                                campaignStatus: campaign.status,
                                action: offerTasksAction,
                              })
                            ) {
                              return null
                            }

                            const offerTasksLabel = getOfferTasksMenuLabel(offerTasksAction)
                            const isPauseOfferTasksAction = offerTasksAction === 'pause'
                            return (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-2"
                                  title={
                                    isPauseOfferTasksAction
                                      ? '暂停关联 Offer 任务'
                                      : '开启关联 Offer 任务'
                                  }
                                  disabled={pauseOfferTasksSubmitting}
                                  onClick={() => openPauseOfferTasksDialog(campaign)}
                                >
                                  {isPauseOfferTasksAction ? (
                                    <PauseCircle className="w-4 h-4 text-orange-600" />
                                  ) : (
                                    <PlayCircle className="w-4 h-4 text-green-600" />
                                  )}
                                  <span>{offerTasksLabel}</span>
                                </DropdownMenuItem>
                              </>
                            )
                          })()}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {/* Pagination Controls - Bottom */}
        {filteredCampaigns.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200">
            <ResponsivePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={(size) => {
                onPageSizeChange(size)
                onPageChange(1)
              }}
              pageSizeOptions={[10, 20, 50, 100, 500, 1000]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

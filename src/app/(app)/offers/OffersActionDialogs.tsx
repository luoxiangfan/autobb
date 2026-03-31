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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { OfferListItem, UnlinkTarget } from './types'

type OffersActionDialogsProps = {
  isUnlinkDialogOpen: boolean
  onUnlinkDialogOpenChange: (open: boolean) => void
  offerToUnlink: UnlinkTarget | null
  removeGoogleAdsCampaignsOnUnlink: boolean
  onRemoveGoogleAdsCampaignsOnUnlinkChange: (checked: boolean) => void
  unlinking: boolean
  onConfirmUnlink: () => void

  isDeleteDialogOpen: boolean
  onDeleteDialogOpenChange: (open: boolean) => void
  offerToDelete: OfferListItem | null
  deleteError: string | null
  onDeleteErrorReset: () => void
  removeGoogleAdsCampaignsOnDelete: boolean
  onRemoveGoogleAdsCampaignsOnDeleteChange: (checked: boolean) => void
  deleting: boolean
  onConfirmDeleteSimple: () => void

  isBatchDeleteDialogOpen: boolean
  onBatchDeleteDialogOpenChange: (open: boolean) => void
  batchDeleteError: string | null
  onBatchDeleteErrorReset: () => void
  selectedOfferCount: number
  batchDeleting: boolean
  onConfirmBatchDelete: () => void

  isBatchCreativeDialogOpen: boolean
  onBatchCreativeDialogOpenChange: (open: boolean) => void
  batchCreatingCreatives: boolean
  maxBatchCreativeOffers: number
  onConfirmBatchCreateCreatives: () => void

  isBatchRebuildDialogOpen: boolean
  onBatchRebuildDialogOpenChange: (open: boolean) => void
  batchRebuilding: boolean
  maxBatchRebuildOffers: number
  onConfirmBatchRebuild: () => void

  isBlacklistDialogOpen: boolean
  onBlacklistDialogOpenChange: (open: boolean) => void
  offerToBlacklist: OfferListItem | null
  blacklisting: boolean
  onConfirmToggleBlacklist: () => void
}

export default function OffersActionDialogs({
  isUnlinkDialogOpen,
  onUnlinkDialogOpenChange,
  offerToUnlink,
  removeGoogleAdsCampaignsOnUnlink,
  onRemoveGoogleAdsCampaignsOnUnlinkChange,
  unlinking,
  onConfirmUnlink,
  isDeleteDialogOpen,
  onDeleteDialogOpenChange,
  offerToDelete,
  deleteError,
  onDeleteErrorReset,
  removeGoogleAdsCampaignsOnDelete,
  onRemoveGoogleAdsCampaignsOnDeleteChange,
  deleting,
  onConfirmDeleteSimple,
  isBatchDeleteDialogOpen,
  onBatchDeleteDialogOpenChange,
  batchDeleteError,
  onBatchDeleteErrorReset,
  selectedOfferCount,
  batchDeleting,
  onConfirmBatchDelete,
  isBatchCreativeDialogOpen,
  onBatchCreativeDialogOpenChange,
  batchCreatingCreatives,
  maxBatchCreativeOffers,
  onConfirmBatchCreateCreatives,
  isBatchRebuildDialogOpen,
  onBatchRebuildDialogOpenChange,
  batchRebuilding,
  maxBatchRebuildOffers,
  onConfirmBatchRebuild,
  isBlacklistDialogOpen,
  onBlacklistDialogOpenChange,
  offerToBlacklist,
  blacklisting,
  onConfirmToggleBlacklist,
}: OffersActionDialogsProps) {
  return (
    <>
      <AlertDialog open={isUnlinkDialogOpen} onOpenChange={onUnlinkDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认解除关联</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要解除 <strong className="text-gray-900">{offerToUnlink?.offer.brand}</strong> 与账号 <strong className="text-gray-900">{offerToUnlink?.accountName}</strong> 的关联吗？
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-body-sm text-blue-800">
                  <p className="font-medium mb-1">ℹ️ 解除关联将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅暂停该账号下与该Offer关联的广告系列（Google Ads）</li>
                    <li>广告投放将立即停止（仅限上述广告系列）</li>
                    <li>历史数据会保留用于查看</li>
                  </ul>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-body-sm text-orange-800">
                  <Checkbox
                    id="unlink-remove-ads"
                    checked={removeGoogleAdsCampaignsOnUnlink}
                    onCheckedChange={(checked) => onRemoveGoogleAdsCampaignsOnUnlinkChange(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label htmlFor="unlink-remove-ads" className="text-sm font-medium cursor-pointer text-orange-900">
                      同时在 Ads 账号中删除对应广告系列（不可恢复）
                    </Label>
                    <p className="text-xs text-orange-700 mt-1">
                      仅删除该账号下与该Offer关联的广告系列
                    </p>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmUnlink}
              disabled={unlinking}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-600"
            >
              {unlinking ? '解除中...' : '确认解除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={onDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除Offer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除 <strong className="text-gray-900">{offerToDelete?.brand}</strong> 的Offer吗？
                </p>
                {deleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    <p className="font-medium mb-1">删除失败</p>
                    <p>{deleteError}</p>
                  </div>
                )}
                {!deleteError && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-body-sm text-yellow-800">
                    <p className="font-medium mb-1">⚠️ 重要提示：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>已删除的Offer历史数据会保留在系统中</li>
                      <li>系统会自动暂停该Offer在各关联Ads账号下的已启用广告系列（仅暂停该账号下关联的广告系列），避免继续花费</li>
                      <li>关联的Google Ads账号会自动解除关联</li>
                      <li>此操作不可撤销</li>
                    </ul>
                    <div className="mt-3 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-body-sm text-orange-800">
                      <Checkbox
                        id="delete-remove-ads-simple"
                        checked={removeGoogleAdsCampaignsOnDelete}
                        onCheckedChange={(checked) => onRemoveGoogleAdsCampaignsOnDeleteChange(checked as boolean)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="delete-remove-ads-simple" className="text-sm font-medium cursor-pointer text-orange-900">
                          同时在 Ads 账号中删除对应广告系列（不可恢复）
                        </Label>
                        <p className="text-xs text-orange-700 mt-1">
                          仅删除该账号下与该Offer关联的广告系列
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={onDeleteErrorReset}>取消</AlertDialogCancel>
            <Button
              onClick={onConfirmDeleteSimple}
              disabled={deleting}
              variant="destructive"
            >
              {deleting ? '删除中...' : deleteError ? '重试删除' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBatchDeleteDialogOpen} onOpenChange={onBatchDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>您确定要删除选中的 <strong className="text-gray-900">{selectedOfferCount}</strong> 个Offer吗？</p>
                {batchDeleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    <p className="font-medium mb-1">部分删除失败</p>
                    <p className="whitespace-pre-line">{batchDeleteError}</p>
                  </div>
                )}
                {!batchDeleteError && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-body-sm text-yellow-800">
                    <p className="font-medium mb-1">⚠️ 重要提示：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>已删除的Offer历史数据会保留在系统中</li>
                      <li>系统会自动暂停各Offer在关联Ads账号下的已启用广告系列（仅暂停该账号下关联的广告系列），避免继续花费</li>
                      <li>关联的Google Ads账号会自动解除关联</li>
                      <li>此操作不可撤销</li>
                    </ul>
                    <div className="mt-3 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-body-sm text-orange-800">
                      <Checkbox
                        id="delete-remove-ads-batch"
                        checked={removeGoogleAdsCampaignsOnDelete}
                        onCheckedChange={(checked) => onRemoveGoogleAdsCampaignsOnDeleteChange(checked as boolean)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="delete-remove-ads-batch" className="text-sm font-medium cursor-pointer text-orange-900">
                          同时在 Ads 账号中删除对应广告系列（不可恢复）
                        </Label>
                        <p className="text-xs text-orange-700 mt-1">
                          仅删除该账号下与该Offer关联的广告系列
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleting} onClick={onBatchDeleteErrorReset}>取消</AlertDialogCancel>
            <Button
              onClick={onConfirmBatchDelete}
              disabled={batchDeleting}
              variant="destructive"
            >
              {batchDeleting ? '删除中...' : batchDeleteError ? '重试删除' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBatchCreativeDialogOpen} onOpenChange={onBatchCreativeDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量创建广告创意</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  将为选中的 <strong className="text-gray-900">{selectedOfferCount}</strong> 个Offer提交创意生成任务：
                  每个Offer仅创建 <strong className="text-gray-900">1</strong> 个创意，生成下一步类型（A→B→D）。
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-body-sm text-gray-700">
                  <p className="font-medium mb-1">跳过规则：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Offer未完成抓取（pending/in_progress/failed）</li>
                    <li>该Offer已存在生成中的任务（pending/running）</li>
                    <li>该Offer已生成满3种类型创意（A/B/D）</li>
                  </ul>
                </div>
                {selectedOfferCount > maxBatchCreativeOffers && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    单次最多支持 <strong>{maxBatchCreativeOffers}</strong> 个Offer，请减少选择后再提交。
                  </div>
                )}
                <div className="text-body-sm text-gray-500">
                  提交后无需等待执行结果，可稍后进入对应Offer的发布流程查看生成进度。
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchCreatingCreatives}>取消</AlertDialogCancel>
            <Button
              onClick={onConfirmBatchCreateCreatives}
              disabled={
                batchCreatingCreatives ||
                selectedOfferCount === 0 ||
                selectedOfferCount > maxBatchCreativeOffers
              }
            >
              {batchCreatingCreatives ? '提交中...' : '确认提交'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBatchRebuildDialogOpen} onOpenChange={onBatchRebuildDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量重建Offer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  将为选中的 <strong className="text-gray-900">{selectedOfferCount}</strong> 个Offer提交重建任务：
                  重新抓取并更新所有Offer信息。
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-body-sm text-blue-800">
                  <p className="font-medium mb-1">ℹ️ 重建说明：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>将重新抓取产品页面和店铺信息</li>
                    <li>重新运行AI分析生成所有内容</li>
                    <li>更新品牌信息、产品描述、评价分析、竞品分析等所有字段</li>
                    <li>删除旧的关键词池，下次生成创意时自动重建</li>
                    <li>处理时间约2-5分钟/个，后台异步执行</li>
                    <li><strong>注意：将覆盖现有所有数据</strong></li>
                  </ul>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-body-sm text-gray-700">
                  <p className="font-medium mb-1">跳过规则：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Offer缺少推广链接（affiliate_link）</li>
                    <li>Offer缺少目标国家（target_country）</li>
                    <li>该Offer已存在进行中的重建任务（pending/in_progress）</li>
                  </ul>
                </div>
                {selectedOfferCount > maxBatchRebuildOffers && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    单次最多支持 <strong>{maxBatchRebuildOffers}</strong> 个Offer，请减少选择后再提交。
                  </div>
                )}
                <div className="text-body-sm text-gray-500">
                  提交后无需等待执行结果，可稍后查看Offer状态。
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchRebuilding}>取消</AlertDialogCancel>
            <Button
              onClick={onConfirmBatchRebuild}
              disabled={
                batchRebuilding ||
                selectedOfferCount === 0 ||
                selectedOfferCount > maxBatchRebuildOffers
              }
            >
              {batchRebuilding ? '提交中...' : '确认重建'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBlacklistDialogOpen} onOpenChange={onBlacklistDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {offerToBlacklist?.isBlacklisted ? '确认取消拉黑' : '确认拉黑投放'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要{offerToBlacklist?.isBlacklisted ? '取消拉黑' : '拉黑'} <strong className="text-gray-900">{offerToBlacklist?.brand}</strong> ({offerToBlacklist?.targetCountry}) 吗？
                </p>
                {!offerToBlacklist?.isBlacklisted && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-body-sm text-orange-800">
                    <p className="font-medium mb-1">⚠️ 拉黑后：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>该品牌+国家组合将被标记为拉黑状态</li>
                      <li>创建相同品牌+国家的新Offer时会显示风险提示</li>
                      <li>可随时取消拉黑状态</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blacklisting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmToggleBlacklist}
              disabled={blacklisting}
              className={offerToBlacklist?.isBlacklisted ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}
            >
              {blacklisting ? '处理中...' : offerToBlacklist?.isBlacklisted ? '确认取消拉黑' : '确认拉黑'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

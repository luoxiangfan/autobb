'use client'

/**
 * Delete Offer Confirm Dialog
 * 删除Offer确认对话框，显示关联账号详情
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Trash2, UnlinkIcon } from 'lucide-react'

interface LinkedAccountDetail {
  accountId: number
  customerId: string
  accountName: string | null
  campaignId: number
  campaignName: string
  status: string
  createdAt: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  offerName: string
  linkedAccounts: LinkedAccountDetail[]
  accountCount: number
  campaignCount: number
  onConfirmDelete: (autoUnlink: boolean) => void
  removeGoogleAdsCampaigns: boolean
  onRemoveGoogleAdsCampaignsChange: (value: boolean) => void
  deleting: boolean
}

export default function DeleteOfferConfirmDialog({
  open,
  onOpenChange,
  offerName,
  linkedAccounts,
  accountCount,
  campaignCount,
  onConfirmDelete,
  removeGoogleAdsCampaigns,
  onRemoveGoogleAdsCampaignsChange,
  deleting
}: Props) {
  // 按账号分组展示
  const accountGroups = linkedAccounts.reduce((groups, account) => {
    const key = account.accountId
    if (!groups[key]) {
      groups[key] = {
        accountId: account.accountId,
        customerId: account.customerId,
        accountName: account.accountName,
        campaigns: []
      }
    }
    groups[key].campaigns.push({
      campaignId: account.campaignId,
      campaignName: account.campaignName,
      status: account.status,
      createdAt: account.createdAt
    })
    return groups
  }, {} as Record<number, any>)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            确认删除Offer
          </DialogTitle>
          <DialogDescription>
            Offer "{offerName}" 关联了 {accountCount} 个Ads账号，共 {campaignCount} 个广告系列
          </DialogDescription>
        </DialogHeader>

        <Alert className="bg-orange-50 border-orange-200">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            删除此Offer需要先解除所有关联的广告系列。您可以选择：
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>解除关联并删除</strong>：自动暂停该Offer在各关联Ads账号下已启用的广告系列（仅暂停该账号下关联的广告系列，避免继续花费），再将所有关联的广告系列标记为"已移除"，然后删除Offer</li>
              <li><strong>取消</strong>：返回，手动在"关联Ads账号"列中逐个解除关联</li>
            </ul>
            <div className="mt-3 flex items-start gap-3 rounded-md border border-orange-200 bg-white p-3">
              <Checkbox
                id="delete-remove-ads"
                checked={removeGoogleAdsCampaigns}
                onCheckedChange={(checked) => onRemoveGoogleAdsCampaignsChange(checked as boolean)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <Label htmlFor="delete-remove-ads" className="text-sm font-medium cursor-pointer text-orange-900">
                  同时在 Ads 账号中删除对应广告系列（不可恢复）
                </Label>
                <p className="text-xs text-orange-700 mt-1">
                  仅删除该账号下与该Offer关联的广告系列
                </p>
              </div>
            </div>
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <h4 className="text-sm font-medium">关联的Ads账号和广告系列：</h4>

          {Object.values(accountGroups).map((group: any) => (
            <div key={group.accountId} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{group.accountName || '未命名账号'}</div>
                  <div className="text-sm text-gray-500 font-mono">{group.customerId}</div>
                </div>
                <div className="text-sm text-gray-500">
                  {group.campaigns.length} 个广告系列
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>广告系列名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.campaigns.map((campaign: any) => (
                    <TableRow key={campaign.campaignId}>
                      <TableCell className="font-medium">{campaign.campaignName}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                          campaign.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {campaign.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(campaign.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirmDelete(true)}
            disabled={deleting}
            className="gap-2"
          >
            {deleting ? (
              <>处理中...</>
            ) : (
              <>
                <UnlinkIcon className="w-4 h-4" />
                解除关联并删除
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

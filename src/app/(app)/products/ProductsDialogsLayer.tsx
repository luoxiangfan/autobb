'use client'

import { Loader2, Plus, PowerOff } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type YeahPromosSessionStatus = {
  hasSession: boolean
  isExpired: boolean
  expiresAt: string | null
  maskedPhpSessionId: string | null
}

type BatchRow = {
  productId: number
  linkType: '单品'
  promoLink: string
  targetCountry: string
  availableCountries: string[]
  productPrice: string
  commissionRate: string
}

type ProductDialogItem = {
  mid: string | null
}

interface ProductsDialogsLayerProps {
  ypCaptureDialogOpen: boolean
  onYpCaptureOpenChange: (open: boolean) => void
  ypSessionStatus: YeahPromosSessionStatus
  ypSessionStatusLoading: boolean
  ypCaptureExtensionDownloadPath: string
  onRefreshYpSessionStatus: () => void
  formatMonthDayTime: (value: string | null) => string
  createOfferDialogOpen: boolean
  onCreateOfferOpenChange: (open: boolean) => void
  pendingCreateOfferProduct: ProductDialogItem | null
  creatingOfferId: number | null
  onCreateOfferCancel: () => void
  onSubmitCreateOffer: () => void
  singleOfflineDialogOpen: boolean
  onSingleOfflineOpenChange: (open: boolean) => void
  offlineProduct: ProductDialogItem | null
  offliningProductId: number | null
  onSingleOfflineCancel: () => void
  onSubmitSingleOffline: () => void
  batchOfflineDialogOpen: boolean
  onBatchOfflineOpenChange: (open: boolean) => void
  selectedProductsCount: number
  batchOfflining: boolean
  canBatchOffline: boolean
  onSubmitBatchOffline: () => void
  batchDialogOpen: boolean
  onBatchDialogOpenChange: (open: boolean) => void
  batchRows: BatchRow[]
  batchCreating: boolean
  onUpdateBatchRowCountry: (productId: number, country: string) => void
  onSubmitBatchCreate: () => void
  calculateScoresConfirmOpen: boolean
  onCalculateScoresConfirmOpenChange: (open: boolean) => void
  scoreCalculationPaused: boolean
  calculatingScores: boolean
  onHandleCalculateScores: () => void
  clearAllConfirmOpen: boolean
  onClearAllConfirmOpenChange: (open: boolean) => void
  clearingAll: boolean
  total: number
  onSubmitClearAll: () => void
}

export default function ProductsDialogsLayer({
  ypCaptureDialogOpen,
  onYpCaptureOpenChange,
  ypSessionStatus,
  ypSessionStatusLoading,
  ypCaptureExtensionDownloadPath,
  onRefreshYpSessionStatus,
  formatMonthDayTime,
  createOfferDialogOpen,
  onCreateOfferOpenChange,
  pendingCreateOfferProduct,
  creatingOfferId,
  onCreateOfferCancel,
  onSubmitCreateOffer,
  singleOfflineDialogOpen,
  onSingleOfflineOpenChange,
  offlineProduct,
  offliningProductId,
  onSingleOfflineCancel,
  onSubmitSingleOffline,
  batchOfflineDialogOpen,
  onBatchOfflineOpenChange,
  selectedProductsCount,
  batchOfflining,
  canBatchOffline,
  onSubmitBatchOffline,
  batchDialogOpen,
  onBatchDialogOpenChange,
  batchRows,
  batchCreating,
  onUpdateBatchRowCountry,
  onSubmitBatchCreate,
  calculateScoresConfirmOpen,
  onCalculateScoresConfirmOpenChange,
  scoreCalculationPaused,
  calculatingScores,
  onHandleCalculateScores,
  clearAllConfirmOpen,
  onClearAllConfirmOpenChange,
  clearingAll,
  total,
  onSubmitClearAll,
}: ProductsDialogsLayerProps) {
  return (
    <>
      <Dialog open={ypCaptureDialogOpen} onOpenChange={onYpCaptureOpenChange}>
        <DialogContent className="max-h-[85vh] w-[96vw] max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[85vh] flex-col p-6">
            <DialogHeader className="shrink-0">
              <DialogTitle>YeahPromos 登录态采集</DialogTitle>
              <DialogDescription>使用浏览器扩展一键回传登录态</DialogDescription>
            </DialogHeader>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
              <div className="rounded-md border bg-slate-50 p-3">
                <div className="font-medium">使用步骤</div>
                <div>1. 点击"下载扩展包"，解压后得到扩展目录。</div>
                <div>2. Chrome 打开 chrome://extensions 或 Edge 打开 edge://extensions。</div>
                <div>3. 打开"开发者模式"后，点"加载已解压的扩展程序"，选择解压后的目录。</div>
                <div>4. 保持当前 AutoAds /products 页面已登录，再打开 yeahpromos.com 完成登录。</div>
                <div>5. 切回 AutoAds /products 标签页，点击浏览器右上角扩展图标，执行"回传 YeahPromos 登录态"。</div>
                <div>6. 回到本页点"刷新登录态"，状态变为"已就绪"后即可同步 YP。</div>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">当前登录态</div>
                <div className="mt-1">
                  {ypSessionStatus.hasSession
                    ? `已就绪（会话 ${ypSessionStatus.maskedPhpSessionId || '-'}，到期 ${ypSessionStatus.expiresAt ? formatMonthDayTime(ypSessionStatus.expiresAt) : '-'}）`
                    : (ypSessionStatus.isExpired ? '已过期，请重新采集' : '未采集')}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4 shrink-0 gap-2 sm:flex-row sm:flex-nowrap sm:justify-end">
              <Button
                variant="outline"
                className="shrink-0 whitespace-nowrap border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  window.open(ypCaptureExtensionDownloadPath, '_blank', 'noopener,noreferrer')
                }}
              >
                下载扩展包
              </Button>
              <Button
                variant="outline"
                className="shrink-0 whitespace-nowrap border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                onClick={onRefreshYpSessionStatus}
                disabled={ypSessionStatusLoading}
              >
                {ypSessionStatusLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                刷新登录态
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOfferDialogOpen} onOpenChange={onCreateOfferOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认创建 Offer</DialogTitle>
            <DialogDescription>
              确认为商品 <strong className="text-foreground">{pendingCreateOfferProduct?.mid || '-'}</strong> 创建 Offer？
              系统将使用当前商品推广链接生成 Offer，创建后可在 Offer 页面继续编辑。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCreateOfferCancel} disabled={creatingOfferId !== null}>
              取消
            </Button>
            <Button
              onClick={onSubmitCreateOffer}
              disabled={!pendingCreateOfferProduct || creatingOfferId !== null}
            >
              {creatingOfferId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={singleOfflineDialogOpen} onOpenChange={onSingleOfflineOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认手动下线商品</DialogTitle>
            <DialogDescription>
              确认手动下线商品 <strong className="text-foreground">{offlineProduct?.mid || '-'}</strong>？
              此操作不可撤销，系统会删除该商品所有关联Offer，并自动附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onSingleOfflineCancel} disabled={offliningProductId !== null}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={onSubmitSingleOffline}
              disabled={!offlineProduct || offliningProductId !== null}
            >
              {offliningProductId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认手动下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOfflineDialogOpen} onOpenChange={onBatchOfflineOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认批量手动下线商品</DialogTitle>
            <DialogDescription>
              已选择 <strong className="text-foreground">{selectedProductsCount}</strong> 个商品。
              确认后将手动下线这些商品并删除所有关联Offer，同时附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onBatchOfflineOpenChange(false)}
              disabled={batchOfflining}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={onSubmitBatchOffline}
              disabled={!canBatchOffline || batchOfflining}
            >
              {batchOfflining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认批量手动下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchDialogOpen} onOpenChange={onBatchDialogOpenChange}>
        <DialogContent className="w-[92vw] !max-w-[960px]">
          <DialogHeader>
            <DialogTitle>批量创建Offer</DialogTitle>
            <DialogDescription>
              已选择 {batchRows.length} 个商品。链接类型固定为“单品”，推广国家默认 US（可改）。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table className="min-w-[720px] [&_thead_th]:bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[84px] whitespace-nowrap">链接类型</TableHead>
                  <TableHead className="min-w-[260px] whitespace-nowrap">推广链接</TableHead>
                  <TableHead className="w-[116px] whitespace-nowrap">推广国家</TableHead>
                  <TableHead className="w-[108px] whitespace-nowrap">商品价格</TableHead>
                  <TableHead className="w-[108px] whitespace-nowrap">佣金比例</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => {
                  const hasCountries = row.availableCountries.length > 0
                  const fallbackCountries = hasCountries ? row.availableCountries : ['US']
                  const value = fallbackCountries.includes(row.targetCountry)
                    ? row.targetCountry
                    : fallbackCountries[0]

                  return (
                    <TableRow key={row.productId}>
                      <TableCell>{row.linkType}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={row.promoLink || '-'}>
                        {row.promoLink || '-'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={value}
                          onValueChange={(country) => onUpdateBatchRowCountry(row.productId, country)}
                        >
                          <SelectTrigger className="w-[104px]">
                            <SelectValue placeholder="国家" />
                          </SelectTrigger>
                          <SelectContent>
                            {fallbackCountries.map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.productPrice}</TableCell>
                      <TableCell>{row.commissionRate}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onBatchDialogOpenChange(false)} disabled={batchCreating}>
              取消
            </Button>
            <Button onClick={onSubmitBatchCreate} disabled={batchCreating || batchRows.length === 0}>
              {batchCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认批量创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={calculateScoresConfirmOpen} onOpenChange={onCalculateScoresConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认计算推荐指数？</AlertDialogTitle>
            <AlertDialogDescription>
              {scoreCalculationPaused && (
                <span className="mb-2 block text-amber-600">
                  全局计算已暂停：仅支持对已选中商品手动计算，不支持全量提交。
                </span>
              )}
              {selectedProductsCount > 0 ? (
                <>
                  已选择 <strong className="text-foreground">{selectedProductsCount}</strong> 个商品，将仅计算选中商品。
                  若不选择商品则会执行全量计算，全量计算耗时较长且会消耗 AI token。
                </>
              ) : (
                <>
                  当前未选择商品，确认后将执行全量推荐指数计算。全量计算耗时较长且会消耗 AI token，请确认继续。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={calculatingScores}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onHandleCalculateScores}
              disabled={calculatingScores || (scoreCalculationPaused && selectedProductsCount === 0)}
            >
              {calculatingScores ? '提交中...' : '确认计算'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAllConfirmOpen} onOpenChange={onClearAllConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空全部商品？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作会清空你在“商品管理”中已同步的全部商家/商品数据（共 <strong className="text-foreground">{total}</strong> 条）。
              不会删除已经创建的 Offer。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAll}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onSubmitClearAll}
              disabled={clearingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearingAll ? '清空中...' : '确认清空全部'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

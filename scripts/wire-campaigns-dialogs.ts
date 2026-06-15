import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pagePath = path.join(root, 'src/app/(app)/campaigns/CampaignsClientPage.tsx')
const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/)

const componentUsage = `      <CampaignsActionDialogs
        isToggleStatusDialogOpen={isToggleStatusDialogOpen}
        setIsToggleStatusDialogOpen={setIsToggleStatusDialogOpen}
        toggleStatusTarget={toggleStatusTarget}
        setToggleStatusTarget={setToggleStatusTarget}
        toggleStatusNextStatus={toggleStatusNextStatus}
        setToggleStatusNextStatus={setToggleStatusNextStatus}
        confirmToggleStatus={confirmToggleStatus}
        isPauseOfferTasksDialogOpen={isPauseOfferTasksDialogOpen}
        setIsPauseOfferTasksDialogOpen={setIsPauseOfferTasksDialogOpen}
        pauseOfferTasksTarget={pauseOfferTasksTarget}
        setPauseOfferTasksTarget={setPauseOfferTasksTarget}
        pauseOfferTasksSubmitting={pauseOfferTasksSubmitting}
        confirmPauseOfferTasks={confirmPauseOfferTasks}
        isBatchDeleteDialogOpen={isBatchDeleteDialogOpen}
        setIsBatchDeleteDialogOpen={setIsBatchDeleteDialogOpen}
        batchDeleteSubmitting={batchDeleteSubmitting}
        selectedCampaignIds={selectedCampaignIds}
        selectedRemovedCampaignCount={selectedRemovedCampaignCount}
        handleBatchDeleteRemoved={handleBatchDeleteRemoved}
        isBatchOfflineDialogOpen={isBatchOfflineDialogOpen}
        setIsBatchOfflineDialogOpen={setIsBatchOfflineDialogOpen}
        batchOfflineSubmitting={batchOfflineSubmitting}
        batchOfflineRemoveGoogleAds={batchOfflineRemoveGoogleAds}
        setBatchOfflineRemoveGoogleAds={setBatchOfflineRemoveGoogleAds}
        batchOfflineBlacklistOffer={batchOfflineBlacklistOffer}
        setBatchOfflineBlacklistOffer={setBatchOfflineBlacklistOffer}
        batchOfflinePauseClickFarm={batchOfflinePauseClickFarm}
        setBatchOfflinePauseClickFarm={setBatchOfflinePauseClickFarm}
        batchOfflinePauseUrlSwap={batchOfflinePauseUrlSwap}
        setBatchOfflinePauseUrlSwap={setBatchOfflinePauseUrlSwap}
        resetBatchOfflineState={resetBatchOfflineState}
        handleBatchOffline={handleBatchOffline}
        isBatchOfflineAccountIssueDialogOpen={isBatchOfflineAccountIssueDialogOpen}
        setIsBatchOfflineAccountIssueDialogOpen={setIsBatchOfflineAccountIssueDialogOpen}
        batchOfflinePendingState={batchOfflinePendingState}
        confirmBatchOfflineLocalOnly={confirmBatchOfflineLocalOnly}
        isDeleteRemovedDialogOpen={isDeleteRemovedDialogOpen}
        setIsDeleteRemovedDialogOpen={setIsDeleteRemovedDialogOpen}
        deleteRemovedTarget={deleteRemovedTarget}
        setDeleteRemovedTarget={setDeleteRemovedTarget}
        deleteRemovedSubmitting={deleteRemovedSubmitting}
        confirmDeleteRemoved={confirmDeleteRemoved}
        isDeleteDraftDialogOpen={isDeleteDraftDialogOpen}
        setIsDeleteDraftDialogOpen={setIsDeleteDraftDialogOpen}
        deleteDraftTarget={deleteDraftTarget}
        setDeleteDraftTarget={setDeleteDraftTarget}
        deleteDraftSubmitting={deleteDraftSubmitting}
        confirmDeleteDraft={confirmDeleteDraft}
        isOfflineDialogOpen={isOfflineDialogOpen}
        setIsOfflineDialogOpen={setIsOfflineDialogOpen}
        offlineTarget={offlineTarget}
        setOfflineTarget={setOfflineTarget}
        offlineBlacklistOffer={offlineBlacklistOffer}
        setOfflineBlacklistOffer={setOfflineBlacklistOffer}
        offlinePauseClickFarm={offlinePauseClickFarm}
        setOfflinePauseClickFarm={setOfflinePauseClickFarm}
        offlinePauseUrlSwap={offlinePauseUrlSwap}
        setOfflinePauseUrlSwap={setOfflinePauseUrlSwap}
        offlineRemoveGoogleAds={offlineRemoveGoogleAds}
        setOfflineRemoveGoogleAds={setOfflineRemoveGoogleAds}
        offlineSubmitting={offlineSubmitting}
        confirmOffline={confirmOffline}
        isOfflineAccountIssueDialogOpen={isOfflineAccountIssueDialogOpen}
        setIsOfflineAccountIssueDialogOpen={setIsOfflineAccountIssueDialogOpen}
        offlineAccountIssueMessage={offlineAccountIssueMessage}
        setOfflineAccountIssueMessage={setOfflineAccountIssueMessage}
        offlineAccountIssueStatus={offlineAccountIssueStatus}
        setOfflineAccountIssueStatus={setOfflineAccountIssueStatus}
        confirmOfflineLocalOnly={confirmOfflineLocalOnly}
      />`

const next = [...lines.slice(0, 5461), componentUsage, ...lines.slice(6074)]
let content = next.join('\n')

if (!content.includes('CampaignsActionDialogs')) {
  content = content.replace(
    "import { matchesCampaignSearch } from '@/lib/campaign-search'",
    "import { CampaignsActionDialogs } from './CampaignsActionDialogs'\nimport { matchesCampaignSearch } from '@/lib/campaign-search'"
  )
}

// Remove local batch dialog helpers
content = content.replace(
  /\n {2}const buildBatchAccountStatusSummary = \([\s\S]*?\n {2}const executeBatchOffline = async \(/,
  '\n  const executeBatchOffline = async ('
)

fs.writeFileSync(pagePath, content)
console.log('Updated CampaignsClientPage.tsx')

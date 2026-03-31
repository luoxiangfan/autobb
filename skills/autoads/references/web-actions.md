# AutoAds Web Action Matrix

Last verified: 2026-02-15 (from current Web pages + API routes in repo).

## Transport and Auth (non-negotiable)

- Write methods (`POST`/`PUT`/`PATCH`/`DELETE`) must call `POST /api/openclaw/commands/execute`.
- Business reads (`GET /api/*`) must call `POST /api/openclaw/proxy` with `{ method: "GET", path }`.
- OpenClaw control reads (`GET /api/openclaw/commands/runs`) must call direct endpoint, never through proxy.
- Always pass user scope in OpenClaw calls: `channel`, `senderId`; pass `accountId`, `tenantKey` when available.
- Do not call deprecated write paths (`/api/offers`, `/api/offers/:id/generate-ad-creative`, `/api/offers/:id/generate-creatives`, `/api/ad-creatives`).
- `POST /api/openclaw/commands/execute` 返回的 `taskId` 是 OpenClaw 命令队列 taskId，不是业务任务 taskId（`offer_tasks`/`creative_tasks`）。不能直接用于业务状态接口。
- 可通过 `GET /api/openclaw/commands/runs` 的 `items[].responsePreview` 读取写请求完成后的业务响应（例如真正的业务 `taskId`）。

## Read Actions (proxy unless noted)

### `offer.extract.status`
- Method/Path: `GET /api/offers/extract/status/:taskId`
- Query/body: none.
- 仅当你拿到真实 `offer_tasks.id` 时可调用；不要使用 OpenClaw `commands/execute` 返回的 `taskId`。

### `creative.task.get`
- Method/Path: `GET /api/creative-tasks/:taskId`
- Query/body: none.
- 仅当你拿到真实 `creative_tasks.id` 时可调用；不要使用 OpenClaw `commands/execute` 返回的 `taskId`。

### `creative.task.stream`
- Method/Path: `GET /api/creative-tasks/:taskId/stream`
- Query/body: none.

### `creative.list`
- Preferred: `GET /api/offers/:id/creatives`
- Web legacy read also uses: `GET /api/offers/:id/generate-ad-creative`

### `campaign.publish.status.poll`
- Method/Path: `GET /api/offers/:offerId/campaigns/status`
- Required query: `campaignId=<local campaign id>`

### `openclaw.runs.list` (direct)
- Method/Path: `GET /api/openclaw/commands/runs`
- Recommended query: `channel`, `senderId`, optional `accountId`, `tenantKey`, `limit`.

## Write Actions (execute)

### `offer.create`
- Method/Path: `POST /api/offers/extract`
- Required body keys: `affiliate_link`, `target_country`
- Optional body keys: `product_price`, `commission_payout`, `brand_name`, `page_type`, `store_product_links`, `skipCache`, `skipWarmup`
- Web behavior:
- `page_type` is `product` or `store`
- `store_product_links` max 3 URLs

```json
{
  "affiliate_link": "https://example.com/aff",
  "target_country": "US",
  "brand_name": "Soocas",
  "page_type": "product",
  "product_price": "199.99",
  "commission_payout": "25.00"
}
```

### `offer.update`
- Method/Path: `PUT /api/offers/:id`
- Required body keys: at least one field
- Allowed body keys only:
- `url`, `brand`, `category`, `target_country`, `affiliate_link`
- `brand_description`, `unique_selling_points`, `product_highlights`, `target_audience`
- `page_type`, `store_product_links`, `product_price`, `commission_payout`, `is_active`

### `offer.rebuild`
- Method/Path: `POST /api/offers/:id/rebuild`
- Body: empty object `{}`.

### `creative.generate.queue`
- Method/Path: `POST /api/offers/:id/generate-creatives-queue`
- Required body keys: none (object required)
- Optional body keys: `maxRetries`, `targetRating`, `synthetic`, `bucket`
- Notes:
- Bucket supports `A/B/D`; legacy `C` maps to `B`, `S` maps to `D`.
- Web default payload is:

```json
{
  "maxRetries": 3,
  "targetRating": "EXCELLENT"
}
```

### `creative.select`
- Method/Path: `POST /api/ad-creatives/:id/select`
- Body: empty object `{}`.

### `creative.batch.generate.queue`
- Method/Path: `POST /api/offers/batch/generate-creatives-queue`
- Required body keys: `offerIds`
- Constraints: 1..50 integer IDs.

```json
{
  "offerIds": [3570, 3571]
}
```

### `keyword.ideas`
- Method/Path: `POST /api/offers/:id/keyword-ideas`
- Required body keys: none (object required)
- Optional body keys: `seedKeywords`, `useUrl`, `filterOptions`

```json
{
  "seedKeywords": ["soocas toothbrush"],
  "useUrl": true,
  "filterOptions": {
    "minMonthlySearches": 100,
    "maxCompetitionIndex": 80
  }
}
```

### `keyword.pool.generate`
- Method/Path: `POST /api/offers/:id/keyword-pool`
- Optional body keys: `forceRegenerate`, `keywords`

### `keyword.pool.delete`
- Method/Path: `DELETE /api/offers/:id/keyword-pool`
- Body: empty object `{}`.

### `campaign.publish`
- Method/Path: `POST /api/campaigns/publish`
- Required top-level keys:
- `offerId`, `googleAdsAccountId`, `campaignConfig`
- `adCreativeId` is required unless `enableSmartOptimization=true`
- Optional top-level keys:
- `pauseOldCampaigns`, `enableCampaignImmediately`, `enableSmartOptimization`, `variantCount`, `forcePublish`
- `campaignConfig` used by Web includes:
- `campaignName`, `budgetAmount`, `budgetType`, `targetCountry`, `targetLanguage`
- `biddingStrategy`, `finalUrlSuffix`, `marketingObjective`
- `adGroupName`, `maxCpcBid`
- `keywords`, `negativeKeywords`, `negativeKeywordMatchType`
- `adName`, `headlines`, `descriptions`, `finalUrls`
- `callouts`, `sitelinks`

### `campaign.toggle-status`
- Method/Path: `PUT /api/campaigns/:id/toggle-status`
- Required body keys: `status`
- Allowed values: `PAUSED` or `ENABLED`

```json
{
  "status": "PAUSED"
}
```

### `campaign.update-cpc`
- Method/Path: `PUT /api/campaigns/:id/update-cpc`
- Required body keys: `newCpc`
- Constraint: positive number.

```json
{
  "newCpc": 0.56
}
```

### `campaign.offline`
- Method/Path: `POST /api/campaigns/:id/offline`
- Optional body keys:
- `blacklistOffer`, `forceLocalOffline`, `removeGoogleAdsCampaign`
- `pauseClickFarmTasks`, `pauseUrlSwapTasks`

```json
{
  "blacklistOffer": false,
  "pauseClickFarmTasks": true,
  "pauseUrlSwapTasks": true,
  "removeGoogleAdsCampaign": false
}
```

### `clickfarm.create`
- Method/Path: `POST /api/click-farm/tasks`
- Required body keys: `offer_id`, `daily_click_count`
- Optional body keys:
- `start_time`, `end_time`, `duration_days`, `scheduled_start_date`
- `hourly_distribution`, `timezone`, `referer_config`

```json
{
  "offer_id": 3570,
  "daily_click_count": 50,
  "start_time": "06:00",
  "end_time": "24:00",
  "duration_days": 7,
  "scheduled_start_date": "2026-02-16"
}
```

### `offer.unlink`
- Method/Path: `POST /api/offers/:id/unlink`
- Required body keys: `accountId`
- Optional body keys: `removeGoogleAdsCampaigns`

```json
{
  "accountId": 123,
  "removeGoogleAdsCampaigns": false
}
```

### `offer.blacklist.add`
- Method/Path: `POST /api/offers/:id/blacklist`
- Body: empty object `{}`.

### `offer.blacklist.remove`
- Method/Path: `DELETE /api/offers/:id/blacklist`
- Body: empty object `{}`.

## Error Handling Playbook

- `400`:
- Check required fields, field names, and data types against this matrix.
- Do not retry with guessed fields.
- `401`:
- Treat as auth/session issue; ask for re-auth or refresh binding context.
- `409`:
- Treat as business conflict (e.g., duplicate blacklist); report and stop.
- `422`:
- Treat as valid request but blocked by business policy (e.g., launch score, account status).
- Surface `action/details` to user and ask for confirm path if provided.
- `5xx`:
- Retry once with same idempotency key if safe; otherwise report failure and run-id.

## Idempotency Key Suggestions

- `offer.create`: `offer-extract-<hash(link)>-<yyyymmddhhmmss>`
- `creative.generate.queue`: `creative-queue-<offerId>-<bucket|auto>-<timestamp>`
- `campaign.publish`: `campaign-publish-<offerId>-<adCreativeId>-<timestamp>`
- `clickfarm.create`: `clickfarm-create-<offerId>-<date>`

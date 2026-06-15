export const REQUIRED_RSA_HEADLINE_COUNT = 15
export const REQUIRED_RSA_DESCRIPTION_COUNT = 4
export const MIN_FORCE_PUBLISH_HEADLINE_COUNT = 3
export const MIN_FORCE_PUBLISH_DESCRIPTION_COUNT = 2

export type PublishRsaCreative = {
  headlines?: unknown
  descriptions?: unknown
}

export function normalizeCreativeTextAssets(rawAssets: unknown): string[] {
  if (!Array.isArray(rawAssets)) return []
  return rawAssets.map((asset) => String(asset || '').trim()).filter((asset) => asset.length > 0)
}

export function assertRequiredRsaAssetCounts(creative: PublishRsaCreative) {
  const headlineCount = normalizeCreativeTextAssets(creative?.headlines).length
  const descriptionCount = normalizeCreativeTextAssets(creative?.descriptions).length

  if (headlineCount !== REQUIRED_RSA_HEADLINE_COUNT) {
    throw new Error(
      `Headlines必须正好${REQUIRED_RSA_HEADLINE_COUNT}个，当前提供了${headlineCount}个。如果从广告创意中获得的标题数量不足，请报错。`
    )
  }

  if (descriptionCount !== REQUIRED_RSA_DESCRIPTION_COUNT) {
    throw new Error(
      `Descriptions必须正好${REQUIRED_RSA_DESCRIPTION_COUNT}个，当前提供了${descriptionCount}个。如果从广告创意中获得的描述数量不足，请报错。`
    )
  }
}

export function resolvePublishRsaAssets(
  assets: string[],
  minimumCount: number,
  requiredCount: number,
  assetLabel: 'Headlines' | 'Descriptions',
  forcePublish: boolean
): string[] {
  const normalized = normalizeCreativeTextAssets(assets)

  if (!forcePublish) {
    if (normalized.length !== requiredCount) {
      throw new Error(
        `${assetLabel}必须正好${requiredCount}个，当前提供了${normalized.length}个。如果从广告创意中获得的${assetLabel === 'Headlines' ? '标题' : '描述'}数量不足，请报错。`
      )
    }
    return normalized
  }

  if (normalized.length < minimumCount) {
    throw new Error(
      `强制发布失败：${assetLabel === 'Headlines' ? `至少保留${minimumCount}个标题` : `至少保留${minimumCount}个描述`}，当前仅${normalized.length}个。`
    )
  }

  if (normalized.length >= requiredCount) {
    return normalized.slice(0, requiredCount)
  }

  const padded = [...normalized]
  for (let index = 0; padded.length < requiredCount; index += 1) {
    padded.push(normalized[index % normalized.length])
  }

  console.warn(`[Publish] 强制发布资产补齐: ${assetLabel} ${normalized.length} -> ${requiredCount}`)

  return padded
}

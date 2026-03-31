type PlainObject = Record<string, any>

export const CAMPAIGN_PUBLISH_FIELD_OWNERSHIP = Object.freeze({
  finalUrls: 'creative_or_offer',
  finalUrlSuffix: 'creative_or_offer',
  path1: 'creative',
  path2: 'creative',
} as const)

export interface PublishCreativeUrlContext {
  finalUrl?: string | null
  finalUrlSuffix?: string | null
}

export interface PublishOfferUrlContext {
  url?: string | null
  finalUrl?: string | null
  finalUrlSuffix?: string | null
}

export interface BuildAlignedPublishCampaignConfigParams {
  campaignConfig?: PlainObject | null
  creative?: PublishCreativeUrlContext | null
  offer?: PublishOfferUrlContext | null
}

export interface BuildAlignedPublishCampaignConfigResult {
  campaignConfig: PlainObject
  ownership: typeof CAMPAIGN_PUBLISH_FIELD_OWNERSHIP
  overridden: {
    finalUrls: boolean
    finalUrlSuffix: boolean
    inputFinalUrl: string
    appliedFinalUrl: string
    inputFinalUrlSuffix: string
    appliedFinalUrlSuffix: string
  }
}

export interface PublishCampaignConfigOwnershipViolation {
  hasInputFinalUrls: boolean
  hasInputFinalUrlSuffix: boolean
  finalUrls: boolean
  finalUrlSuffix: boolean
  inputFinalUrl: string
  expectedFinalUrl: string
  inputFinalUrlSuffix: string
  expectedFinalUrlSuffix: string
}

export interface EvaluatePublishCampaignConfigOwnershipResult extends BuildAlignedPublishCampaignConfigResult {
  violation: PublishCampaignConfigOwnershipViolation
}

function toNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFinalUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => toNonEmptyString(entry))
    .filter((entry) => entry.length > 0)
}

export function buildAlignedPublishCampaignConfig(
  params: BuildAlignedPublishCampaignConfigParams
): BuildAlignedPublishCampaignConfigResult {
  const source = (params.campaignConfig && typeof params.campaignConfig === 'object')
    ? { ...params.campaignConfig }
    : {}

  const inputFinalUrls = normalizeFinalUrls(source.finalUrls)
  const inputFinalUrl = inputFinalUrls[0] || ''
  const inputFinalUrlSuffix = toNonEmptyString(source.finalUrlSuffix)

  const creativeFinalUrl = toNonEmptyString(params.creative?.finalUrl)
  const creativeFinalUrlSuffix = toNonEmptyString(params.creative?.finalUrlSuffix)
  const offerFinalUrl = toNonEmptyString(params.offer?.finalUrl)
  const offerUrl = toNonEmptyString(params.offer?.url)
  const offerFinalUrlSuffix = toNonEmptyString(params.offer?.finalUrlSuffix)

  const appliedFinalUrl = creativeFinalUrl || offerFinalUrl || offerUrl || inputFinalUrl
  const appliedFinalUrlSuffix = creativeFinalUrlSuffix || offerFinalUrlSuffix || inputFinalUrlSuffix

  if (appliedFinalUrl) {
    source.finalUrls = [appliedFinalUrl]
  } else {
    delete source.finalUrls
  }

  if (appliedFinalUrlSuffix) {
    source.finalUrlSuffix = appliedFinalUrlSuffix
  } else {
    source.finalUrlSuffix = ''
  }

  return {
    campaignConfig: source,
    ownership: CAMPAIGN_PUBLISH_FIELD_OWNERSHIP,
    overridden: {
      finalUrls: Boolean(inputFinalUrl && inputFinalUrl !== appliedFinalUrl),
      finalUrlSuffix: Boolean(inputFinalUrlSuffix && inputFinalUrlSuffix !== appliedFinalUrlSuffix),
      inputFinalUrl,
      appliedFinalUrl,
      inputFinalUrlSuffix,
      appliedFinalUrlSuffix,
    },
  }
}

export function evaluatePublishCampaignConfigOwnership(
  params: BuildAlignedPublishCampaignConfigParams
): EvaluatePublishCampaignConfigOwnershipResult {
  const source = (params.campaignConfig && typeof params.campaignConfig === 'object')
    ? (params.campaignConfig as PlainObject)
    : {}
  const hasInputFinalUrls = (
    Object.prototype.hasOwnProperty.call(source, 'finalUrls')
    && source.finalUrls !== undefined
  )
  const hasInputFinalUrlSuffix = (
    Object.prototype.hasOwnProperty.call(source, 'finalUrlSuffix')
    && source.finalUrlSuffix !== undefined
  )
  const inputFinalUrl = normalizeFinalUrls(source.finalUrls)[0] || ''
  const inputFinalUrlSuffix = toNonEmptyString(source.finalUrlSuffix)

  const aligned = buildAlignedPublishCampaignConfig(params)
  const expectedFinalUrl = normalizeFinalUrls(aligned.campaignConfig.finalUrls)[0] || ''
  const expectedFinalUrlSuffix = toNonEmptyString(aligned.campaignConfig.finalUrlSuffix)

  return {
    ...aligned,
    violation: {
      hasInputFinalUrls,
      hasInputFinalUrlSuffix,
      finalUrls: hasInputFinalUrls && inputFinalUrl !== expectedFinalUrl,
      finalUrlSuffix: hasInputFinalUrlSuffix && inputFinalUrlSuffix !== expectedFinalUrlSuffix,
      inputFinalUrl,
      expectedFinalUrl,
      inputFinalUrlSuffix,
      expectedFinalUrlSuffix,
    },
  }
}

export function hasPublishCampaignConfigOwnershipViolation(
  violation: Pick<PublishCampaignConfigOwnershipViolation, 'finalUrls' | 'finalUrlSuffix'>
): boolean {
  return Boolean(violation.finalUrls || violation.finalUrlSuffix)
}

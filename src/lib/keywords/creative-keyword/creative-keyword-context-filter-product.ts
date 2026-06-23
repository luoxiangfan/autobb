/**
 * 创意关键词上下文过滤：商品页意图特异性
 */
import type { CanonicalCreativeType, ProductModelFamilyContext } from '../../creatives/server'
import {
  tokenizeContext,
  shouldAllowCoreSpecificAnchorToken,
  extractLeafIntentSpecificitySegments,
  extractIntentPhraseHeadTokens,
  isNumericLikeProductToken,
  CREATIVE_CONTEXT_GENERIC_TOKENS,
  PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS,
  PRODUCT_PAGE_GENERIC_DRIFT_TOKENS,
  PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS,
  PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS,
  PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS,
  PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS,
  PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN,
  PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD,
  PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD,
  PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD,
  PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD,
  type ProductPageIntentSpecificityContext,
  type ProductPageIntentSpecificityEvaluation,
} from './creative-keyword-context-filter-utils'

export function buildProductPageIntentSpecificityContext(params: {
  brandName?: string | null
  productName?: string | null
  categoryTexts?: string[]
  modelFamilyContext?: ProductModelFamilyContext | null
}): ProductPageIntentSpecificityContext | null {
  const categoryHeadTokens = new Set<string>()
  for (const categoryText of params.categoryTexts || []) {
    for (const headToken of extractIntentPhraseHeadTokens(categoryText, params.brandName)) {
      if (PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(headToken)) continue
      categoryHeadTokens.add(headToken)
    }
  }

  const specificAnchorTokens = new Set<string>()
  const coreSpecificAnchorTokens = new Set<string>()
  const lineAnchorTokens = new Set<string>()
  const specAnchorTokens = new Set<string>()
  const supportedSoftModifierTokens = new Set<string>()
  const supportedNumericVariantTokens = new Set<string>()
  const titleNumericTokens = new Set<string>()
  const supportedGenericModifierTokens = new Set<string>()
  const productCoreHeadTokens = new Set<string>(
    (params.modelFamilyContext?.productCoreTerms || [])
      .flatMap((value) => tokenizeContext(value))
      .filter((token) => token.length >= 3)
      .filter(
        (token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || categoryHeadTokens.has(token)
      )
      .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
  )
  const leadingProductTitle = (() => {
    const title = String(params.productName || '').trim()
    if (!title) return ''
    return title.split(PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN)[0] || title
  })()
  const addSpecificAnchorTokens = (
    values: string[] | null | undefined,
    ...targets: Set<string>[]
  ) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)
        .filter((token) => token.length >= 3)
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS.has(token))
        .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
        .filter((token) => !categoryHeadTokens.has(token))
        .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))) {
        for (const target of targets) {
          target.add(token)
        }
      }
    }
  }
  const pushSupportedGenericModifierTokens = (values?: string[] | null) => {
    for (const value of values || []) {
      const tokens = tokenizeContext(value)
      for (const token of tokens) {
        if (PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)) {
          supportedGenericModifierTokens.add(token)
        }
      }
      if (tokens.some((token) => PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS.has(token))) {
        supportedGenericModifierTokens.add('portable')
      }
    }
  }
  if (leadingProductTitle) {
    pushSupportedGenericModifierTokens([leadingProductTitle])
    const titleTokens = tokenizeContext(leadingProductTitle)
    const brandTokens = new Set(tokenizeContext(params.brandName || ''))
    const effectiveHeadTokens =
      categoryHeadTokens.size > 0 ? categoryHeadTokens : productCoreHeadTokens
    const headIndexes = titleTokens
      .map((token, index) => (effectiveHeadTokens.has(token) ? index : -1))
      .filter((index) => index >= 0)
    const candidateIndexes = new Set<number>()

    if (headIndexes.length > 0) {
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD)
        const end = Math.min(
          titleTokens.length - 1,
          headIndex + PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD
        )
        for (let index = start; index <= end; index += 1) {
          candidateIndexes.add(index)
        }
      }
    } else {
      for (let index = 0; index < Math.min(8, titleTokens.length); index += 1) {
        candidateIndexes.add(index)
      }
    }

    const broadTitleSpecificTokens = Array.from(candidateIndexes)
      .sort((a, b) => a - b)
      .map((index) => titleTokens[index])
      .filter((token) => !brandTokens.has(token))
    addSpecificAnchorTokens(broadTitleSpecificTokens, specificAnchorTokens)

    const coreCandidateIndexes = new Set<number>()
    if (headIndexes.length > 0) {
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD)
        const end = Math.min(
          titleTokens.length - 1,
          headIndex + PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD
        )
        for (let index = start; index <= end; index += 1) {
          coreCandidateIndexes.add(index)
        }
      }
    } else {
      for (let index = 0; index < Math.min(5, titleTokens.length); index += 1) {
        coreCandidateIndexes.add(index)
      }
    }

    addSpecificAnchorTokens(
      Array.from(coreCandidateIndexes)
        .sort((a, b) => a - b)
        .map((index) => titleTokens[index])
        .filter((token) => !brandTokens.has(token)),
      specificAnchorTokens
    )
    addSpecificAnchorTokens(
      Array.from(coreCandidateIndexes)
        .sort((a, b) => a - b)
        .map((index) => titleTokens[index])
        .filter((token) => !brandTokens.has(token))
        .filter((token) => shouldAllowCoreSpecificAnchorToken(token)),
      coreSpecificAnchorTokens
    )
    for (const index of coreCandidateIndexes) {
      const token = titleTokens[index]
      if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
        supportedSoftModifierTokens.add(token)
      }
      if (isNumericLikeProductToken(token)) {
        titleNumericTokens.add(token)
        supportedNumericVariantTokens.add(token)
      }
    }
  }
  for (const categoryText of params.categoryTexts || []) {
    pushSupportedGenericModifierTokens([categoryText])
    for (const leafSegment of extractLeafIntentSpecificitySegments(categoryText)) {
      const categoryTokens = tokenizeContext(leafSegment)
      const headIndexes = categoryTokens
        .map((token, index) => (categoryHeadTokens.has(token) ? index : -1))
        .filter((index) => index >= 0)
      const candidateIndexes = new Set<number>()
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - 3)
        const end = Math.min(categoryTokens.length - 1, headIndex + 1)
        for (let index = start; index <= end; index += 1) {
          candidateIndexes.add(index)
        }
      }
      addSpecificAnchorTokens(
        Array.from(candidateIndexes)
          .sort((a, b) => a - b)
          .map((index) => categoryTokens[index]),
        specificAnchorTokens
      )
    }
  }

  const strongAnchorTokens = new Set<string>([...categoryHeadTokens, ...specificAnchorTokens])
  const pushAnchorTokens = (values?: string[] | null) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)
        .filter((token) => token.length >= 3)
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
        .filter((token) => !PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS.has(token))
        .filter(
          (token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || categoryHeadTokens.has(token)
        )) {
        if (!categoryHeadTokens.has(token) && !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)) {
          specificAnchorTokens.add(token)
        }
        strongAnchorTokens.add(token)
      }
    }
  }

  pushAnchorTokens(params.modelFamilyContext?.lineTerms)
  pushAnchorTokens(params.modelFamilyContext?.productCoreTerms)
  pushAnchorTokens(params.modelFamilyContext?.attributeTerms)
  pushAnchorTokens(params.modelFamilyContext?.softFamilyTerms)
  const pushSupportedSoftVariantTokens = (values?: string[]) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)) {
        if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
          supportedSoftModifierTokens.add(token)
        }
        if (isNumericLikeProductToken(token)) {
          supportedNumericVariantTokens.add(token)
        }
      }
    }
  }
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.lineTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.specTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.productCoreTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.attributeTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.softFamilyTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.lineTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.productCoreTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.attributeTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.softFamilyTerms)
  for (const value of params.modelFamilyContext?.lineTerms || []) {
    for (const token of tokenizeContext(value)
      .filter((token) => token.length >= 3)
      .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
      .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))) {
      lineAnchorTokens.add(token)
    }
  }
  for (const value of params.modelFamilyContext?.specTerms || []) {
    for (const token of tokenizeContext(value).filter(isNumericLikeProductToken)) {
      specAnchorTokens.add(token)
      supportedNumericVariantTokens.add(token)
    }
  }
  if (
    supportedSoftModifierTokens.has('california') ||
    supportedSoftModifierTokens.has('full') ||
    supportedSoftModifierTokens.has('king') ||
    supportedSoftModifierTokens.has('queen') ||
    supportedSoftModifierTokens.has('twin')
  ) {
    supportedSoftModifierTokens.add('size')
  }

  if (strongAnchorTokens.size === 0 && categoryHeadTokens.size === 0) {
    return null
  }

  return {
    strongAnchorTokens,
    categoryHeadTokens,
    specificAnchorTokens,
    coreSpecificAnchorTokens,
    lineAnchorTokens,
    specAnchorTokens,
    supportedSoftModifierTokens,
    supportedNumericVariantTokens,
    titleNumericTokens,
    supportedGenericModifierTokens,
  }
}

export function evaluateProductPageIntentSpecificity(params: {
  keyword: string
  searchVolume?: number
  creativeType: CanonicalCreativeType
  brandName?: string | null
  hasBrand: boolean
  hasExplicitModelCode: boolean
  context?: ProductPageIntentSpecificityContext | null
}): ProductPageIntentSpecificityEvaluation {
  if (!params.context) {
    return {
      matchedStrongAnchorCount: 0,
      matchedCategoryHeadCount: 0,
      matchedSpecificAnchorCount: 0,
      hasWeakProductSpecificity: false,
      hasUnexpectedProductModifier: false,
      hasUnexpectedNumericVariant: false,
    }
  }

  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const rawKeywordTokens = tokenizeContext(params.keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !/^\d+$/.test(token))
  const keywordTokens = Array.from(
    new Set(
      rawKeywordTokens.filter(
        (token) =>
          !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) ||
          params.context?.strongAnchorTokens.has(token) ||
          params.context?.categoryHeadTokens.has(token)
      )
    )
  )
  const matchedStrongAnchorTokens = keywordTokens.filter((token) =>
    params.context?.strongAnchorTokens.has(token)
  )
  const matchedCategoryHeadTokens = matchedStrongAnchorTokens.filter((token) =>
    params.context?.categoryHeadTokens.has(token)
  )
  const matchedSpecificAnchorTokens = matchedStrongAnchorTokens.filter((token) =>
    params.context?.specificAnchorTokens.has(token)
  )
  const matchedCoreSpecificAnchorTokens = matchedStrongAnchorTokens.filter((token) =>
    params.context?.coreSpecificAnchorTokens.has(token)
  )
  const matchedLineAnchorTokens = matchedStrongAnchorTokens.filter((token) =>
    params.context?.lineAnchorTokens.has(token)
  )
  const matchedSpecAnchorTokens = matchedStrongAnchorTokens.filter((token) =>
    params.context?.specAnchorTokens.has(token)
  )
  const matchedStrongAnchorCount = Array.from(new Set(matchedStrongAnchorTokens)).length
  const matchedCategoryHeadCount = Array.from(new Set(matchedCategoryHeadTokens)).length
  const matchedSpecificAnchorCount = Array.from(new Set(matchedSpecificAnchorTokens)).length
  const matchedCoreSpecificAnchorCount = Array.from(new Set(matchedCoreSpecificAnchorTokens)).length
  const matchedLineAnchorCount = Array.from(new Set(matchedLineAnchorTokens)).length
  const matchedSpecAnchorCount = Array.from(new Set(matchedSpecAnchorTokens)).length
  const hasOnlyWeakSingleSpecificity =
    matchedCoreSpecificAnchorCount > 0 &&
    matchedCoreSpecificAnchorTokens.every((token) =>
      PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS.has(token)
    )
  const keywordNumericTokens = Array.from(
    new Set(tokenizeContext(params.keyword).filter((token) => isNumericLikeProductToken(token)))
  )
  const hasUnexpectedNumericVariant =
    params.context.supportedNumericVariantTokens.size > 0 &&
    keywordNumericTokens.length > 0 &&
    keywordNumericTokens.some((token) => !params.context?.supportedNumericVariantTokens.has(token))
  const unexpectedProductModifierTokens = (() => {
    const allowedTokens = new Set<string>([
      ...(params.context?.categoryHeadTokens || []),
      ...(params.context?.specificAnchorTokens || []),
    ])
    let seenAllowedBeforeFor = false
    let seenSpecificAnchorBeforeTail = false
    let seenCategoryHeadBeforeTail = false
    let allowForTail = false
    const unexpected: string[] = []
    const canStartDescriptiveTail = (token: string): boolean =>
      seenAllowedBeforeFor &&
      seenSpecificAnchorBeforeTail &&
      seenCategoryHeadBeforeTail &&
      !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token) &&
      PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)
    const markAllowedToken = (token: string) => {
      if (allowForTail) return
      seenAllowedBeforeFor = true
      if (params.context?.specificAnchorTokens.has(token)) {
        seenSpecificAnchorBeforeTail = true
      }
      if (params.context?.categoryHeadTokens.has(token)) {
        seenCategoryHeadBeforeTail = true
      }
    }

    for (const token of rawKeywordTokens) {
      if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
        if (params.context?.supportedSoftModifierTokens.has(token)) {
          markAllowedToken(token)
          continue
        }
        unexpected.push(token)
        continue
      }
      if (allowedTokens.has(token)) {
        markAllowedToken(token)
        continue
      }
      if (PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)) {
        if (params.context?.supportedGenericModifierTokens.has(token)) {
          markAllowedToken(token)
          continue
        }
        if (canStartDescriptiveTail(token)) {
          allowForTail = true
          continue
        }
        unexpected.push(token)
        continue
      }
      if (token === 'for') {
        if (!seenAllowedBeforeFor) {
          unexpected.push(token)
        }
        allowForTail = seenAllowedBeforeFor
        continue
      }
      if (
        CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) &&
        !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token)
      ) {
        continue
      }
      if (allowForTail) {
        if (PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token)) {
          unexpected.push(token)
        }
        continue
      }
      unexpected.push(token)
    }

    return Array.from(new Set(unexpected))
  })()
  const hasUnexpectedProductModifier = unexpectedProductModifierTokens.length > 0
  const supportedContextualGenericModifierTokens = Array.from(
    new Set(
      rawKeywordTokens.filter(
        (token) =>
          PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token) &&
          params.context?.supportedGenericModifierTokens.has(token)
      )
    )
  )
  const hasSupportedContextualModifierOnlyDrift =
    params.hasBrand &&
    !params.hasExplicitModelCode &&
    supportedContextualGenericModifierTokens.length > 0 &&
    matchedCategoryHeadCount === 0 &&
    matchedSpecificAnchorCount <= 1 &&
    matchedCoreSpecificAnchorCount <= 1
  const hasLineOnlyFamilyDrift =
    params.hasBrand &&
    !params.hasExplicitModelCode &&
    matchedCategoryHeadCount === 0 &&
    matchedCoreSpecificAnchorCount === 0 &&
    matchedLineAnchorCount === 1 &&
    matchedStrongAnchorCount === matchedLineAnchorCount &&
    keywordTokens.length <= 1
  const hasSpecOnlyProductDrift =
    params.hasBrand &&
    !params.hasExplicitModelCode &&
    matchedCategoryHeadCount === 0 &&
    matchedCoreSpecificAnchorCount === 0 &&
    matchedSpecAnchorCount > 0 &&
    matchedStrongAnchorCount === matchedSpecAnchorCount &&
    keywordTokens.length <= matchedSpecAnchorCount

  let hasWeakProductSpecificity = false
  if (params.creativeType === 'product_intent') {
    if (!params.hasBrand) {
      hasWeakProductSpecificity =
        matchedStrongAnchorCount === 0 ||
        (matchedStrongAnchorCount < 2 && matchedCategoryHeadCount === 0) ||
        (keywordTokens.length <= 1 && matchedStrongAnchorCount < 2)
    } else {
      hasWeakProductSpecificity =
        matchedStrongAnchorCount === 0 ||
        (!params.hasExplicitModelCode &&
          (params.searchVolume || 0) <= 0 &&
          matchedStrongAnchorCount > 0 &&
          (matchedCoreSpecificAnchorCount === 0 || hasOnlyWeakSingleSpecificity) &&
          keywordTokens.length <= 1 &&
          params.context.coreSpecificAnchorTokens.size > 0) ||
        (!params.hasExplicitModelCode &&
          matchedCategoryHeadCount === 0 &&
          matchedCoreSpecificAnchorCount === 0 &&
          matchedSpecificAnchorCount <= 1 &&
          keywordTokens.length <= 1) ||
        (hasUnexpectedProductModifier &&
          params.context.specificAnchorTokens.size > 0 &&
          matchedSpecificAnchorCount === 0) ||
        hasSupportedContextualModifierOnlyDrift ||
        hasLineOnlyFamilyDrift ||
        hasSpecOnlyProductDrift
    }
  } else if (params.creativeType === 'brand_intent' && params.hasBrand) {
    hasWeakProductSpecificity =
      matchedStrongAnchorCount === 0 ||
      (hasUnexpectedProductModifier &&
        params.context.specificAnchorTokens.size > 0 &&
        matchedSpecificAnchorCount === 0) ||
      hasSupportedContextualModifierOnlyDrift ||
      hasLineOnlyFamilyDrift ||
      hasSpecOnlyProductDrift
  } else if (params.creativeType === 'model_intent' && !params.hasExplicitModelCode) {
    if (!params.hasBrand) {
      hasWeakProductSpecificity =
        matchedStrongAnchorCount < 2 ||
        (keywordTokens.length <= 1 && matchedCategoryHeadCount === 0)
    } else {
      hasWeakProductSpecificity =
        matchedStrongAnchorCount === 0 || hasLineOnlyFamilyDrift || hasSpecOnlyProductDrift
    }
  }

  return {
    matchedStrongAnchorCount,
    matchedCategoryHeadCount,
    matchedSpecificAnchorCount,
    hasWeakProductSpecificity,
    hasUnexpectedProductModifier,
    hasUnexpectedNumericVariant,
  }
}

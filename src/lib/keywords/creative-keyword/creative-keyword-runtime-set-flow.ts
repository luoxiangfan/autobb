/**
 * 创意关键词运行时：关键词集合构建流程
 */
import {
  buildCreativeKeywordSet,
  type BuildCreativeKeywordSetInput,
  type BuildCreativeKeywordSetOutput,
} from './creative-keyword-set-builder'
import type {
  ApplyCreativeKeywordSetOptions,
  BuildPreGenerationCreativeKeywordSetOptions,
  CreateCreativeKeywordSetBuilderInputOptions,
  CreativeKeywordRuntimeCarrier,
  FinalizeCreativeKeywordSetOptions,
  KeywordSetAssignmentInput,
} from './creative-keyword-runtime-types'

export function applyCreativeKeywordSetToCreative<T extends CreativeKeywordRuntimeCarrier>(
  creative: T,
  keywordSet: KeywordSetAssignmentInput,
  options?: ApplyCreativeKeywordSetOptions
): T {
  creative.executableKeywords = keywordSet.executableKeywords
  creative.keywords = keywordSet.executableKeywords
  creative.keywordsWithVolume = keywordSet.keywordsWithVolume as any
  creative.promptKeywords = keywordSet.promptKeywords

  if (
    options?.includeKeywordSupplementation !== false &&
    keywordSet.keywordSupplementation !== undefined
  ) {
    creative.keywordSupplementation = keywordSet.keywordSupplementation
  }

  if (keywordSet.audit) {
    creative.audit = keywordSet.audit
  }

  return creative
}

export function createCreativeKeywordSetBuilderInput(
  input: CreateCreativeKeywordSetBuilderInputOptions
): BuildCreativeKeywordSetInput {
  return {
    offer: input.offer,
    userId: input.userId,
    brandName: input.offer.brand || 'Unknown',
    targetLanguage: input.offer.target_language || 'English',
    creativeType: input.creativeType,
    bucket: input.bucket,
    scopeLabel: input.scopeLabel,
    keywordsWithVolume: input.creative.keywordsWithVolume as any,
    keywords: input.creative.keywords || [],
    promptKeywords: input.creative.promptKeywords,
    seedCandidates: input.seedCandidates,
    enableSupplementation: input.enableSupplementation,
    skipSupplementAiRanking: input.skipSupplementAiRanking,
    continueOnSupplementError: input.continueOnSupplementError,
    fallbackMode: input.fallbackMode,
  }
}

export async function buildPreGenerationCreativeKeywordSet(
  input: BuildPreGenerationCreativeKeywordSetOptions
): Promise<BuildCreativeKeywordSetOutput> {
  return buildCreativeKeywordSet({
    offer: input.offer,
    userId: input.userId,
    brandName: input.offer.brand || 'Unknown',
    targetLanguage: input.offer.target_language || 'English',
    creativeType: input.creativeType,
    bucket: input.bucket,
    scopeLabel: input.scopeLabel,
    keywords: [],
    keywordsWithVolume: [],
    seedCandidates: input.seedCandidates,
    enableSupplementation: input.enableSupplementation,
    skipSupplementAiRanking: input.skipSupplementAiRanking,
    continueOnSupplementError: input.continueOnSupplementError,
    fallbackMode: input.fallbackMode,
  })
}

export async function finalizeCreativeKeywordSet<TCreative extends CreativeKeywordRuntimeCarrier>(
  input: FinalizeCreativeKeywordSetOptions<TCreative>
): Promise<TCreative> {
  const finalKeywordSet = await buildCreativeKeywordSet(
    createCreativeKeywordSetBuilderInput({
      offer: input.offer,
      userId: input.userId,
      creative: input.creative,
      creativeType: input.creativeType,
      bucket: input.bucket,
      scopeLabel: input.scopeLabel,
      seedCandidates: input.seedCandidates,
      enableSupplementation: false,
      continueOnSupplementError: true,
    })
  )

  return applyCreativeKeywordSetToCreative(
    input.creative,
    {
      executableKeywords: finalKeywordSet.executableKeywords,
      keywordsWithVolume: finalKeywordSet.keywordsWithVolume,
      promptKeywords: finalKeywordSet.promptKeywords,
      keywordSupplementation: finalKeywordSet.keywordSupplementation,
      audit: finalKeywordSet.audit,
    },
    {
      includeKeywordSupplementation: input.includeKeywordSupplementation,
    }
  )
}

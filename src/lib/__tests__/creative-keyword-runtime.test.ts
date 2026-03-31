import { describe, expect, it } from 'vitest'

import {
  applyCreativeKeywordSetToCreative,
  buildCreativeBrandKeywords,
  createCreativeAdStrengthPayload,
  createCreativeApiRetryHistory,
  createCreativeBucketSummaryPayload,
  createCreativeKeywordSetBuilderInput,
  createCreativeOptimizationPayload,
  createCreativeOfferSummaryPayload,
  createCreativePublishDecisionPayload,
  createCreativeQualityEvaluationInput,
  createCreativeQualityGatePayload,
  createCreativeResponsePayload,
  createCreativeScoreBreakdown,
  createCreativeTaskRetryHistory,
  evaluateCreativePersistenceHardGate,
  mergeUsedKeywordsExcludingBrand,
  resolveCreativeKeywordAudit,
  resolveCreativeKeywordsForRetryExclusion,
} from '../creative-keyword-runtime'

describe('creative-keyword-runtime', () => {
  it('applies keyword set fields back to generated creative payload', () => {
    const creative = {
      headlines: ['BrandX X200'],
      descriptions: ['Clean faster'],
      keywords: ['legacy keyword'],
      theme: 'test',
      explanation: 'test',
    }

    const result = applyCreativeKeywordSetToCreative(creative, {
      executableKeywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1200,
        },
      ],
      promptKeywords: ['brandx x200 vacuum', 'buy brandx x200 vacuum'],
      keywordSupplementation: {
        triggered: true,
        beforeCount: 1,
        afterCount: 2,
        addedKeywords: [{ keyword: 'buy brandx x200 vacuum', source: 'title_about' }],
        supplementCapApplied: false,
      },
      audit: {
        totalKeywords: 1,
        withSearchVolumeKeywords: 1,
        zeroVolumeKeywords: 0,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'filtered',
        sourceQuotaAudit: {} as any,
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
      },
    })

    expect(result.executableKeywords).toEqual(['brandx x200 vacuum'])
    expect(result.keywords).toEqual(['brandx x200 vacuum'])
    expect(result.promptKeywords).toEqual(['brandx x200 vacuum', 'buy brandx x200 vacuum'])
    expect(result.keywordSupplementation).toMatchObject({
      triggered: true,
      afterCount: 2,
    })
    expect(result.audit).toMatchObject({
      totalKeywords: 1,
      contextFallbackStrategy: 'filtered',
    })
  })

  it('resolves audit using direct field before compatibility aliases', () => {
    const directAudit = { totalKeywords: 1 }
    const aliasAudit = { totalKeywords: 2 }

    expect(resolveCreativeKeywordAudit({
      audit: directAudit as any,
      keywordSourceAudit: aliasAudit as any,
      adStrength: {
        audit: aliasAudit as any,
        keywordSourceAudit: aliasAudit as any,
      },
    })).toBe(directAudit)
  })

  it('builds creative keyword set input from offer + creative runtime state', () => {
    const input = createCreativeKeywordSetBuilderInput({
      offer: {
        brand: 'BrandX',
        target_language: 'de-CH',
      },
      userId: 7,
      creative: {
        keywords: ['brandx x200 vacuum'],
        keywordsWithVolume: [
          {
            keyword: 'brandx x200 vacuum',
            searchVolume: 1200,
          },
        ],
        promptKeywords: ['brandx x200 vacuum', 'buy brandx x200 vacuum'],
      },
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-runtime-input',
      seedCandidates: [{ keyword: 'brandx x200' }],
      enableSupplementation: true,
      continueOnSupplementError: true,
      fallbackMode: false,
    })

    expect(input).toEqual(expect.objectContaining({
      offer: expect.objectContaining({
        brand: 'BrandX',
        target_language: 'de-CH',
      }),
      userId: 7,
      brandName: 'BrandX',
      targetLanguage: 'de-CH',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-runtime-input',
      keywords: ['brandx x200 vacuum'],
      promptKeywords: ['brandx x200 vacuum', 'buy brandx x200 vacuum'],
      seedCandidates: [{ keyword: 'brandx x200' }],
      enableSupplementation: true,
      continueOnSupplementError: true,
      fallbackMode: false,
    }))
    expect(input.keywordsWithVolume).toEqual([
      expect.objectContaining({
        keyword: 'brandx x200 vacuum',
        searchVolume: 1200,
      }),
    ])
  })

  it('builds creative quality evaluation input from offer + creative runtime state', () => {
    const creative = {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      theme: 'test',
      explanation: 'test',
    }

    const input = createCreativeQualityEvaluationInput({
      creative: creative as any,
      minimumScore: 70,
      offer: {
        brand: 'BrandX',
        category: 'robot vacuum',
        product_name: '',
        product_title: 'BrandX X200',
        title: 'BrandX X200 Vacuum',
        name: 'BrandX Vacuum',
        brand_description: 'Smart robot vacuum',
        unique_selling_points: 'Auto-empty dock',
        product_highlights: 'Strong suction',
        target_country: 'CA',
        target_language: 'fr',
      },
      userId: 7,
      bucket: 'B',
      productNameFallback: 'BrandX X200',
      productTitleFallback: 'BrandX X200 Vacuum',
    })

    expect(input).toEqual({
      creative,
      minimumScore: 70,
      adStrengthContext: {
        brandName: 'BrandX',
        targetCountry: 'CA',
        targetLanguage: 'fr',
        bucketType: 'B',
        creativeType: 'model_intent',
        userId: 7,
      },
      ruleContext: {
        brandName: 'BrandX',
        category: 'robot vacuum',
        productName: 'BrandX X200',
        productTitle: 'BrandX X200',
        productDescription: 'Smart robot vacuum',
        uniqueSellingPoints: 'Auto-empty dock',
        keywords: ['brandx x200 vacuum'],
        targetLanguage: 'fr',
        bucket: 'B',
      },
    })
  })

  it('builds persisted ad strength payload with shared audit aliases', () => {
    const audit = { totalKeywords: 2 } as any
    const payload = createCreativeAdStrengthPayload({
      finalRating: 'GOOD',
      finalScore: 84,
      localEvaluation: {
        dimensions: {
          relevance: { score: 12 },
        },
      },
      combinedSuggestions: ['Add offer'],
      rsaQualityGate: { passed: true },
    } as any, audit, {
      includeRsaQualityGate: true,
    })

    expect(payload).toEqual({
      rating: 'GOOD',
      score: 84,
      isExcellent: false,
      rsaQualityGate: { passed: true },
      dimensions: {
        relevance: { score: 12 },
      },
      suggestions: ['Add offer'],
      audit,
      keywordSourceAudit: audit,
    })
  })

  it('builds flattened score breakdown from ad strength evaluation', () => {
    const breakdown = createCreativeScoreBreakdown({
      localEvaluation: {
        dimensions: {
          relevance: { score: 11 },
          quality: { score: 12 },
          completeness: { score: 13 },
          diversity: { score: 14 },
          compliance: { score: 15 },
          brandSearchVolume: { score: 16 },
          competitivePositioning: { score: 17 },
        },
      },
    } as any)

    expect(breakdown).toEqual({
      relevance: 11,
      quality: 12,
      engagement: 13,
      diversity: 14,
      clarity: 15,
      brandSearchVolume: 16,
      competitivePositioning: 17,
    })
  })

  it('fills optional score breakdown dimensions with zero when partial metrics are allowed', () => {
    const breakdown = createCreativeScoreBreakdown({
      localEvaluation: {
        dimensions: {
          relevance: { score: 11 },
          quality: { score: 12 },
          completeness: { score: 13 },
          diversity: { score: 14 },
          compliance: { score: 15 },
        },
      },
    } as any, {
      allowPartialMetrics: true,
    })

    expect(breakdown).toEqual({
      relevance: 11,
      quality: 12,
      engagement: 13,
      diversity: 14,
      clarity: 15,
      brandSearchVolume: 0,
      competitivePositioning: 0,
    })
  })

  it('builds api retry history with gate aliases', () => {
    const retryHistory = createCreativeApiRetryHistory([
      {
        attempt: 1,
        rating: 'GOOD',
        score: 84,
        passed: true,
        rsaPassed: true,
        rulePassed: true,
        failureType: null,
        reasons: ['ok'],
        suggestions: [],
      },
    ] as any)

    expect(retryHistory).toEqual([
      expect.objectContaining({
        attempt: 1,
        gatePassed: true,
        gateReasons: ['ok'],
      }),
    ])
  })

  it('builds task retry history without api aliases', () => {
    const retryHistory = createCreativeTaskRetryHistory([
      {
        attempt: 1,
        rating: 'GOOD',
        score: 84,
        passed: true,
        rsaPassed: true,
        rulePassed: true,
        failureType: null,
        reasons: ['ok'],
        suggestions: ['keep'],
      },
    ] as any)

    expect(retryHistory).toEqual([
      {
        attempt: 1,
        rating: 'GOOD',
        score: 84,
        suggestions: ['keep'],
        failureType: null,
        reasons: ['ok'],
        passed: true,
      },
    ])
  })

  it('builds optimization payload with optional quality gate flag', () => {
    expect(createCreativeOptimizationPayload({
      attempts: 2,
      targetRating: 'GOOD',
      achieved: true,
      qualityGatePassed: true,
      history: [{ attempt: 1 }],
    })).toEqual({
      attempts: 2,
      targetRating: 'GOOD',
      achieved: true,
      qualityGatePassed: true,
      history: [{ attempt: 1 }],
    })

    expect(createCreativeOptimizationPayload({
      attempts: 1,
      targetRating: 'GOOD',
      achieved: false,
      history: [],
    })).toEqual({
      attempts: 1,
      targetRating: 'GOOD',
      achieved: false,
      history: [],
    })
  })

  it('builds compact offer summary payload', () => {
    expect(createCreativeOfferSummaryPayload({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com',
      affiliate_link: 'https://aff.example.com',
    })).toEqual({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com',
      affiliateLink: 'https://aff.example.com',
    })
  })

  it('builds bucket summary payload', () => {
    expect(createCreativeBucketSummaryPayload({
      creativeType: 'model_intent',
      bucket: 'B',
      bucketIntent: 'Model Intent',
      generatedBuckets: ['B'],
    })).toEqual({
      creativeType: 'model_intent',
      bucket: 'B',
      bucketIntent: 'Model Intent',
      generatedBuckets: ['B'],
    })
  })

  it('builds creative response payload with optional fields', () => {
    const audit = { totalKeywords: 1 } as any
    expect(createCreativeResponsePayload({
      id: 901,
      creative: {
        headlines: ['BrandX X200'],
        descriptions: ['Clean faster'],
        keywords: ['brandx x200 vacuum'],
        keywordsWithVolume: [{ keyword: 'brandx x200 vacuum', searchVolume: 1200 }],
        negativeKeywords: ['manual'],
        callouts: ['Free Shipping'],
        sitelinks: [],
        theme: 'Model Intent',
        explanation: 'Focus on the verified model.',
        headlinesWithMetadata: [{ text: 'BrandX X200', length: 11 }],
        descriptionsWithMetadata: [{ text: 'Clean faster', length: 12 }],
        qualityMetrics: { score: 84 },
        keywordSupplementation: {
          triggered: false,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
      } as any,
      audit,
      includeNegativeKeywords: true,
      includeKeywordSupplementation: true,
    })).toEqual({
      id: 901,
      headlines: ['BrandX X200'],
      descriptions: ['Clean faster'],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [{ keyword: 'brandx x200 vacuum', searchVolume: 1200 }],
      negativeKeywords: ['manual'],
      callouts: ['Free Shipping'],
      sitelinks: [],
      theme: 'Model Intent',
      explanation: 'Focus on the verified model.',
      headlinesWithMetadata: [{ text: 'BrandX X200', length: 11 }],
      descriptionsWithMetadata: [{ text: 'Clean faster', length: 12 }],
      qualityMetrics: { score: 84 },
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
      audit,
      keywordSourceAudit: audit,
    })
  })

  it('builds quality gate payload from attempt evaluation', () => {
    const payload = createCreativeQualityGatePayload({
      passed: false,
      failureType: 'intent_fail',
      reasons: ['missing anchor'],
      rsaGate: { passed: true },
      ruleGate: { passed: false, reasons: ['missing anchor'] },
      adStrength: {
        rsaQualityGate: { passed: true, reasons: [] },
      },
    } as any)

    expect(payload).toEqual({
      passed: false,
      warning: true,
      reasons: ['missing anchor'],
      failureType: 'intent_fail',
      rsaGatePassed: true,
      ruleGatePassed: false,
      rsaQualityGate: { passed: true, reasons: [] },
      ruleGate: { passed: false, reasons: ['missing anchor'] },
    })
  })

  it('builds publish decision payload for post-generation routes', () => {
    expect(createCreativePublishDecisionPayload(true)).toEqual({
      forcePublish: false,
      forcedPublish: false,
      qualityGateBypassed: false,
      forcePublishIgnored: true,
      finalPublishDecision: {
        status: 'PENDING_LAUNCH_SCORE_CHECK',
        stage: 'campaign_publish',
        hardBlockSource: 'launch_score',
      },
    })
  })

  it('merges used keywords while excluding brand terms and duplicates', () => {
    const merged = mergeUsedKeywordsExcludingBrand({
      usedKeywords: ['brandx x100 vacuum', 'cordless vacuum deal'],
      candidateKeywords: [
        'brandx x100 vacuum',
        'brandx official store',
        'x200 vacuum deals',
        '',
        undefined,
        'cordless vacuum deal',
      ],
      brandKeywords: ['brandx'],
    })

    expect(merged).toEqual([
      'brandx x100 vacuum',
      'cordless vacuum deal',
      'x200 vacuum deals',
    ])
  })

  it('deduplicates permutation-equivalent non-brand keywords when merging used keywords', () => {
    const merged = mergeUsedKeywordsExcludingBrand({
      usedKeywords: ['vacuum x200 deal'],
      candidateKeywords: [
        'x200 vacuum deal',
        'deal x200 vacuum',
        'x300 vacuum deal',
      ],
      brandKeywords: ['brandx'],
    })

    expect(merged).toEqual([
      'vacuum x200 deal',
      'x300 vacuum deal',
    ])
  })

  it('skips low-signal single-token candidate keywords while keeping model-anchor single tokens', () => {
    const merged = mergeUsedKeywordsExcludingBrand({
      usedKeywords: ['existing keyword'],
      candidateKeywords: [
        'deal',
        'buy',
        'x10',
        'x10',
      ],
      brandKeywords: ['brandx'],
    })

    expect(merged).toEqual([
      'existing keyword',
      'x10',
    ])
  })

  it('prefers executable keywords when building retry exclusions', () => {
    expect(resolveCreativeKeywordsForRetryExclusion({
      executableKeywords: ['novilla queen mattress'],
      keywords: ['novilla official store'],
      keywordsWithVolume: [
        { keyword: 'novilla memory foam mattress', searchVolume: 320 },
      ],
    } as any)).toEqual(['novilla queen mattress'])

    expect(resolveCreativeKeywordsForRetryExclusion({
      keywords: ['novilla king mattress'],
      keywordsWithVolume: [
        { keyword: 'novilla memory foam mattress', searchVolume: 320 },
      ],
    } as any)).toEqual(['novilla king mattress'])

    expect(resolveCreativeKeywordsForRetryExclusion({
      keywordsWithVolume: [
        { keyword: 'novilla twin mattress', searchVolume: 260 },
      ],
    } as any)).toEqual(['novilla twin mattress'])
  })

  it('builds normalized brand keyword matcher list', () => {
    expect(buildCreativeBrandKeywords(' BrandX ')).toEqual(['brandx'])
    expect(buildCreativeBrandKeywords('')).toEqual([])
    expect(buildCreativeBrandKeywords(undefined)).toEqual([])
  })

  it('passes hard persistence gate when keyword/text quality meets thresholds', () => {
    const result = evaluateCreativePersistenceHardGate({
      creative: {
        headlines: ['BrandX X200 Vacuum', 'Official BrandX Support'],
        descriptions: ['Shop BrandX X200 today', 'Compare features and choose your fit'],
        keywords: [
          'brandx x200 vacuum',
          'brandx x200 robot vacuum',
          'buy brandx x200',
          'brandx x200 replacement filter',
          'brandx x200 accessories',
          'x200 robot vacuum deal',
          'brandx x200 price',
          'brandx x200 reviews',
        ],
      },
      bucket: 'B',
      targetLanguage: 'en',
      brandName: 'BrandX',
    })

    expect(result.passed).toBe(true)
    expect(result.metrics.keywordCount).toBe(8)
    expect(result.violations).toHaveLength(0)
  })

  it('fails hard persistence gate when keyword/text quality violates hard constraints', () => {
    const result = evaluateCreativePersistenceHardGate({
      creative: {
        headlines: ['BrandX Official Store'],
        descriptions: ['Buy no'],
        keywords: ['brandx x200 vacuum', 'kaufen staubsauger', 'brandx x200 vacuum', 'x200 vacuum'],
      },
      bucket: 'B',
      targetLanguage: 'en',
      brandName: 'BrandX',
    })

    expect(result.passed).toBe(false)
    expect(result.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'keyword_count_below_floor',
      'non_target_language_ratio_exceeded',
      'duplicate_ratio_exceeded',
      'truncation_anomaly_detected',
    ]))
  })
})

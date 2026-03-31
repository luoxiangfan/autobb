import { describe, expect, it } from 'vitest'

import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../ad-creative'
import { sanitizeGoogleAdsAdText } from '../google-ads-ad-text'
import {
  buildCreativeKeywordUsagePlan,
  enforceFinalCreativeContract,
  enforceHeadlineUniquenessGate,
} from '../ad-creative-generator'

function buildDraft(): GeneratedAdCreativeData {
  return {
    headlines: [
      '{KeyWord:Waterdrop} Official',
      'Waterdrop Alkalisches Wasser',
      'Waterdrop zertifiziert filter',
      'Waterdrop daily hydration',
      'waterdrop alkaline water filter',
      'waterdrop alkaline water filter',
      'waterdrop alkaline water filter',
      'waterdrop alkaline water filter',
      'waterdrop alkaline water filter 9',
    ],
    descriptions: [
      'Scopri di p',
      'Shop No',
      'Affidabile per l uso quotidiano',
      'Consegna rapida e supporto ufficiale',
    ],
    keywords: [
      'waterdrop alkaline water filter',
      'waterdrop reverse osmosis',
      'waterdrop drinking water system',
    ],
    callouts: [],
    sitelinks: [],
    theme: 'test',
    explanation: 'test',
  }
}

describe('ad-creative-generator final hard contract', () => {
  it('enforces top slots, retained slots, description keyword coverage and language purity in one pass', () => {
    const creative = buildDraft()
    const usagePlan = buildCreativeKeywordUsagePlan({
      brandName: 'Waterdrop',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'waterdrop alkaline water filter', searchVolume: 1000, contractRole: 'required' },
          { keyword: 'waterdrop reverse osmosis', searchVolume: 900, contractRole: 'required' },
          { keyword: 'waterdrop drinking water system', searchVolume: 800, contractRole: 'required' },
        ],
      },
    })

    const result = enforceFinalCreativeContract(creative, {
      bucket: 'B',
      languageCode: 'it',
      brandName: 'Waterdrop',
      brandTokensToMatch: ['waterdrop'],
      dkiHeadline: '{KeyWord:Waterdrop} Ufficiale',
      productTitle: 'Waterdrop 10,000 GPD Reverse Osmosis System for Home',
      aboutItems: ['Supporto ufficiale e filtrazione affidabile'],
      usagePlan,
    })

    expect(creative.headlines[0]).toBe('{KeyWord:Waterdrop} Ufficiale')

    for (let index = 0; index < usagePlan.headlineKeywordTargets.length; index += 1) {
      const slot = 4 + index
      expect(creative.headlines[slot].toLowerCase()).toContain(usagePlan.headlineKeywordTargets[index].split(' ')[0])
      expect(creative.headlines[slot].toLowerCase()).toContain('waterdrop')
    }

    for (let index = 0; index < usagePlan.descriptionKeywordTargets.length; index += 1) {
      const slot = index
      expect(creative.descriptions[slot].toLowerCase()).toContain(usagePlan.descriptionKeywordTargets[index].split(' ')[0])
    }

    const merged = [...creative.headlines, ...creative.descriptions].join(' ').toLowerCase()
    expect(merged).not.toMatch(/alkalisch|zertifiz/)
    expect(creative.headlines.some((headline) => /\s([1-9]|1[0-5])$/.test(headline))).toBe(false)
    expect(result.retainedFixes.headlineFixes + result.retainedFixes.descriptionFixes).toBeGreaterThan(0)
  })

  it('never falls back to numeric suffix during headline dedupe', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:BrandX} Official',
        'BrandX Smart Filter',
        'BrandX Smart Filter',
        'BrandX Smart Filter',
        'BrandX Smart Filter',
      ],
      descriptions: ['Desc 1', 'Desc 2', 'Desc 3', 'Desc 4'],
      keywords: ['brandx smart filter', 'brandx water purifier'],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test',
    }

    const dedupe = enforceHeadlineUniquenessGate(creative, 'en', 'BrandX')
    expect(dedupe.fixes).toBeGreaterThan(0)
    expect(creative.headlines.some((headline) => /\s([1-9]|1[0-5])$/.test(headline))).toBe(false)
  })

  it('filters cross-language retained keyword targets for latin locales before hard-slot enforcement', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:Waterdrop} Ufficiale',
        'Waterdrop Alkalisches Wasser',
        'Waterdrop zertifiziert filter',
        'Waterdrop daily hydration',
        'placeholder five',
        'placeholder six',
        'placeholder seven',
        'placeholder eight',
        'placeholder nine',
      ],
      descriptions: [
        'Scopri di p',
        'Shop No',
        'Descrizione tre',
        'Descrizione quattro',
      ],
      keywords: [
        'waterdrop nsf ansi 58 372 zertifiziert',
        'waterdrop x12 alkalisches mineral',
        'waterdrop',
      ],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test',
    }

    const usagePlan: CreativeKeywordUsagePlan = {
      retainedNonBrandKeywords: [
        'waterdrop nsf ansi 58 372 zertifiziert',
        'waterdrop x12 alkalisches mineral',
        'waterdrop',
      ],
      headlineKeywordTargets: [
        'waterdrop nsf ansi 58 372 zertifiziert',
        'waterdrop x12 alkalisches mineral',
        'waterdrop',
        'waterdrop nsf ansi 58 372 zertifiziert',
        'waterdrop x12 alkalisches mineral',
      ],
      descriptionKeywordTargets: [
        'waterdrop nsf ansi 58 372 zertifiziert',
        'waterdrop x12 alkalisches mineral',
      ],
      headlineCoverageMode: 'top_5',
      descriptionCoverageMode: 'prefer_uncovered_then_best_available',
    }

    enforceFinalCreativeContract(creative, {
      bucket: 'D',
      languageCode: 'it',
      brandName: 'Waterdrop',
      brandTokensToMatch: ['waterdrop'],
      dkiHeadline: '{KeyWord:Waterdrop} Ufficiale',
      productTitle: 'Waterdrop X12 reverse osmosis system',
      aboutItems: ['Supporto ufficiale Waterdrop'],
      usagePlan,
    })

    const joinedTopSlots = creative.headlines.slice(4, 9).join(' ').toLowerCase()
    const joinedDescriptions = creative.descriptions.slice(0, 2).join(' ').toLowerCase()

    expect(joinedTopSlots).not.toMatch(/alkalisch|zertifiz/)
    expect(joinedDescriptions).not.toMatch(/alkalisch|zertifiz/)
    expect(creative.headlines.slice(4, 9).every((headline) => headline.toLowerCase().includes('waterdrop'))).toBe(true)
    expect(creative.descriptions.slice(0, 2).every((description) => description.toLowerCase().includes('waterdrop'))).toBe(true)
  })

  it('cleans dangling headline tails and preserves meaningful two-digit numeric specs', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:Novilla} Official',
        'Novilla Mattress Full Size,',
        'Novilla Pressure Relieving &',
        'Novilla Medium Plush Feel with',
        'novilla mattress full',
        'novilla mattress full',
        'novilla memory foam mattress',
        'novilla full size mattress',
        'novilla mattress full',
      ],
      descriptions: ['Desc 1', 'Desc 2', 'Desc 3', 'Desc 4'],
      keywords: [
        'novilla mattress full',
        'novilla memory foam mattress',
        'novilla full size mattress',
      ],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test',
    }

    const usagePlan: CreativeKeywordUsagePlan = {
      retainedNonBrandKeywords: [
        'novilla mattress full',
        'novilla memory foam mattress',
        'novilla full size mattress',
        'novilla king size mattress 12',
      ],
      headlineKeywordTargets: [
        'novilla mattress full',
        'novilla memory foam mattress',
        'novilla full size mattress',
        'novilla king size mattress 12',
        'novilla mattress full',
      ],
      descriptionKeywordTargets: [
        'novilla mattress full',
        'novilla memory foam mattress',
      ],
      headlineCoverageMode: 'top_5',
      descriptionCoverageMode: 'prefer_uncovered_then_best_available',
    }

    enforceFinalCreativeContract(creative, {
      bucket: 'D',
      languageCode: 'en',
      brandName: 'Novilla',
      brandTokensToMatch: ['novilla'],
      dkiHeadline: '{KeyWord:Novilla} Official',
      usagePlan,
    })

    expect(creative.headlines[1]).toBe('Novilla Mattress Full Size')
    expect(creative.headlines[2]).toBe('Novilla Pressure Relieving')
    expect(creative.headlines[3]).toBe('Novilla Medium Plush Feel')
    expect(creative.headlines.join(' ').toLowerCase()).toContain('novilla king size mattress 12')
  })

  it('guarantees unique Google Ads headline assets after final contract enforcement', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:Gevi} Official',
        'Gevi Commercial Espresso',
        'Gevi Professional Espresso',
        'Gevi Stainless Steel Expresso',
        'Gevi Espresso Machine',
        'Gevi Commercial Espresso',
        'Gevi Espresso Maker',
        'Gevi Espresso Machines',
        'gevi 1500w fast heating system',
        'Want Cafe Quality at Home?',
        'Need a Space-Saving Maker?',
        'Professional Grade Extraction',
        'Integrated Manual Frother',
        'Great Value Espresso Maker',
        'Buy gevi espresso machine',
      ],
      descriptions: ['Desc 1', 'Desc 2', 'Desc 3', 'Desc 4'],
      keywords: ['gevi commercial espresso', 'gevi espresso machine'],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test',
    }

    enforceFinalCreativeContract(creative, {
      bucket: 'D',
      languageCode: 'en',
      brandName: 'Gevi',
      brandTokensToMatch: ['gevi'],
      dkiHeadline: '{KeyWord:Gevi} Official',
    })

    const assetKeys = creative.headlines.map((headline) =>
      sanitizeGoogleAdsAdText(headline, 30).trim().toLowerCase()
    )
    expect(new Set(assetKeys).size).toBe(assetKeys.length)
  })
})

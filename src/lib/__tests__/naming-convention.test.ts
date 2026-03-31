import {
  generateCampaignName,
  generateAdGroupName,
  generateAdName,
  generateAssociativeCampaignName,
  parseAssociativeCampaignName,
  parseAdGroupName,
  parseCampaignName,
  validateAdGroupName,
  validateAssociativeCampaignName,
  validateCampaignName,
  generateSmartOptimizationCampaignName,
  generateNamingScheme,
  NAMING_CONFIG
} from '../naming-convention'

describe('Google Ads Naming Convention', () => {
  describe('generateCampaignName', () => {
    it('should generate standard campaign name with all parameters', () => {
      const date = new Date(2025, 10, 27, 13, 14, 15, 234)
      const name = generateCampaignName({
        offerName: 'Ecomobi_US_01',
        creativeId: 121,
        date,
        randomSuffix: 'ABC'
      })

      expect(name).toBe('Ecomobi_US_01_CMP_121_20251127131415_234_ABC')
    })

    it('should sanitize special characters in offer name', () => {
      const date = new Date(2025, 10, 27, 0, 0, 0, 5)
      const name = generateCampaignName({
        offerName: 'Brand-Name & Co._US_01',
        creativeId: 9,
        date,
        randomSuffix: 'XYZ'
      })

      expect(name).toBe('BrandNameCo_US_01_CMP_9_20251127000000_005_XYZ')
      expect(name).not.toContain('&')
      expect(name).not.toContain('.')
      expect(name).not.toContain('-')
    })

    it('should truncate long names to max length', () => {
      const name = generateCampaignName({
        offerName: 'VeryLongOfferNameThatExceedsNormalLength_XX_99',
        creativeId: 999999,
        date: new Date(2025, 10, 27, 0, 0, 0, 999),
        randomSuffix: 'AAA'
      })

      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
    })
  })

  describe('generateAdGroupName', () => {
    it('should generate standard ad group name', () => {
      const name = generateAdGroupName({
        offerName: 'Eufy_IT_01',
        creativeId: 121,
        randomSuffix: 'ABC'
      })

      expect(name).toBe('Eufy_IT_01_AG_121_ABC')
    })

    it('should handle missing offer name', () => {
      const name = generateAdGroupName({
        offerName: '',
        creativeId: 0,
        randomSuffix: 'XYZ'
      })

      expect(name).toBe('Offer_AG_0_XYZ')
    })

    it('should handle invalid creativeId', () => {
      const name = generateAdGroupName({
        offerName: 'Eufy_IT_01',
        creativeId: Number.NaN,
        randomSuffix: 'AAA'
      })

      expect(name).toBe('Eufy_IT_01_AG_0_AAA')
    })
  })

  describe('generateAdName', () => {
    it('should generate standard ad name', () => {
      const name = generateAdName({
        theme: 'Cleaning',
        creativeId: 121
      })

      expect(name).toBe('RSA_Cleaning_C121')
    })

    it('should include variant index for smart optimization', () => {
      const name = generateAdName({
        theme: 'Security',
        creativeId: 122,
        variantIndex: 2
      })

      expect(name).toBe('RSA_Security_C122_V2')
    })

    it('should truncate long themes', () => {
      const name = generateAdName({
        theme: 'VeryLongThemeNameThatNeedsToBeShortened',
        creativeId: 123
      })

      expect(name).toContain('RSA_')
      expect(name).toContain('C123')
      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.AD)
    })
  })

  describe('generateAssociativeCampaignName', () => {
    it('should generate underscore format with milliseconds timestamp', () => {
      const date = new Date(2026, 1, 13, 9, 8, 7, 45)
      const name = generateAssociativeCampaignName({
        offerId: 173,
        creativeId: 456,
        brand: 'Reolink',
        country: 'us',
        date
      })

      expect(name).toBe('Reolink_US_173_456_20260213090807045')
    })

    it('should preserve brand text and only sanitize illegal chars', () => {
      const date = new Date(2026, 1, 13, 0, 0, 0, 1)
      const name = generateAssociativeCampaignName({
        offerId: 1,
        creativeId: 2,
        brand: 'Brand Name_X',
        country: 'GB',
        date
      })

      expect(name).toBe('Brand Name_X_GB_1_2_20260213000000001')
    })
  })

  describe('parseCampaignName', () => {
    it('should parse valid campaign name correctly', () => {
      const parsed = parseCampaignName('Ecomobi_US_01_CMP_121_20251127131415_234_ABC')

      expect(parsed).toEqual({
        offerName: 'Ecomobi_US_01',
        creativeId: 121,
        dateTime: '20251127131415',
        milliseconds: '234',
        randomSuffix: 'ABC'
      })
    })

    it('should return null for invalid format', () => {
      const parsed = parseCampaignName('Invalid Campaign Name')
      expect(parsed).toBeNull()
    })

    it('should return null for incomplete parts', () => {
      const parsed = parseCampaignName('Brand_IT_Category')
      expect(parsed).toBeNull()
    })
  })

  describe('parseAssociativeCampaignName', () => {
    it('should parse new underscore format', () => {
      const parsed = parseAssociativeCampaignName('Reolink_US_173_456_20260213090807045')

      expect(parsed).toEqual({
        offerId: 173,
        creativeId: 456,
        brand: 'Reolink',
        country: 'US',
        campaignType: 'Search',
        timestamp: '20260213090807045'
      })
    })

    it('should parse legacy hyphen format with country', () => {
      const parsed = parseAssociativeCampaignName('173-456-reolink-US-Search-20251219211500')

      expect(parsed).toEqual({
        offerId: 173,
        creativeId: 456,
        brand: 'reolink',
        country: 'US',
        campaignType: 'Search',
        timestamp: '20251219211500'
      })
    })
  })

  describe('parseAdGroupName', () => {
    it('should parse valid ad group name correctly', () => {
      const parsed = parseAdGroupName('Ecomobi_US_01_AG_121_ABC')

      expect(parsed).toEqual({
        offerName: 'Ecomobi_US_01',
        creativeId: 121,
        randomSuffix: 'ABC'
      })
    })

    it('should return null for invalid format', () => {
      const parsed = parseAdGroupName('Invalid Ad Group')
      expect(parsed).toBeNull()
    })
  })

  describe('validateCampaignName', () => {
    it('should validate correct campaign name', () => {
      expect(validateCampaignName('Ecomobi_US_01_CMP_121_20251127131415_234_ABC')).toBe(true)
    })

    it('should reject invalid campaign name', () => {
      expect(validateCampaignName('Random Name')).toBe(false)
      expect(validateCampaignName('Brand_IT')).toBe(false)
    })
  })

  describe('validateAdGroupName', () => {
    it('should validate correct ad group name', () => {
      expect(validateAdGroupName('Ecomobi_US_01_AG_121_ABC')).toBe(true)
    })

    it('should reject invalid ad group name', () => {
      expect(validateAdGroupName('Random Name')).toBe(false)
    })
  })

  describe('validateAssociativeCampaignName', () => {
    it('should validate new and legacy formats', () => {
      expect(validateAssociativeCampaignName('Reolink_US_173_456_20260213090807045')).toBe(true)
      expect(validateAssociativeCampaignName('173-456-reolink-US-Search-20251219211500')).toBe(true)
    })

    it('should reject invalid associative names', () => {
      expect(validateAssociativeCampaignName('Invalid Campaign Name')).toBe(false)
    })
  })

  describe('generateSmartOptimizationCampaignName', () => {
    it('should ignore variant suffix for campaign name', () => {
      const date = new Date(2025, 10, 27, 0, 0, 0, 0)
      const name = generateSmartOptimizationCampaignName(
        {
          offerName: 'Eufy_IT_01',
          creativeId: 122,
          date,
          randomSuffix: 'ABC'
        },
        2,
        3
      )

      expect(name).toBe('Eufy_IT_01_CMP_122_20251127000000_000_ABC')
      expect(name).not.toContain('_V2of3')
    })

    it('should respect max length', () => {
      const name = generateSmartOptimizationCampaignName(
        {
          offerName: 'VeryLongOfferNameThatExceedsNormalLength_XX_99',
          creativeId: 999999
        },
        5,
        5
      )

      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
    })
  })

  describe('generateNamingScheme', () => {
    it('should generate complete naming scheme for single creative', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 215,
          brand: 'Eufy',
          offerName: 'Eufy_IT_01',
          category: 'Electronics'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 50,
          budgetType: 'DAILY',
          biddingStrategy: 'TARGET_CPA',
          maxCpcBid: 2.5
        },
        creative: {
          id: 121,
          theme: 'Cleaning'
        }
      })

      expect(scheme.campaignName).toMatch(/^Eufy_IT_215_121_\d{17}$/)
      expect(scheme.associativeCampaignName).toBe(scheme.campaignName)
      expect(scheme.adGroupName).toMatch(/^Eufy_IT_01_AG_121_[A-Za-z0-9]{3}$/)
      expect(scheme.adName).toBe('RSA_Cleaning_C121')
    })

    it('should generate smart optimization naming scheme', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 216,
          brand: 'Eufy',
          offerName: 'Eufy_IT_01',
          category: 'Security'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 100,
          budgetType: 'TOTAL',
          biddingStrategy: 'MAXIMIZE_CONVERSIONS',
          maxCpcBid: 1.8
        },
        creative: {
          id: 122,
          theme: 'Safety'
        },
        smartOptimization: {
          enabled: true,
          variantIndex: 1,
          totalVariants: 3
        }
      })

      expect(scheme.campaignName).toMatch(/^Eufy_IT_216_122_\d{17}$/)
      expect(scheme.associativeCampaignName).toBe(scheme.campaignName)
      expect(scheme.adGroupName).toMatch(/^Eufy_IT_01_AG_122_[A-Za-z0-9]{3}$/)
      expect(scheme.adName).toContain('RSA_Safety_C122_V1')
    })

    it('should handle missing creative', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 215,
          brand: 'Eufy'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 50,
          budgetType: 'DAILY',
          biddingStrategy: 'MANUAL_CPC'
        }
      })

      expect(scheme.campaignName).toBeDefined()
      expect(scheme.adGroupName).toBeDefined()
      expect(scheme.adName).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle non-integer creativeId', () => {
      const date = new Date(2025, 10, 27, 0, 0, 0, 10)
      const name = generateCampaignName({
        offerName: 'Test_US_01',
        creativeId: 12.9,
        date,
        randomSuffix: 'AAA'
      })

      expect(name).toBe('Test_US_01_CMP_12_20251127000000_010_AAA')
    })

    it('should handle invalid creativeId', () => {
      const date = new Date(2025, 10, 27, 0, 0, 0, 10)
      const name = generateCampaignName({
        offerName: 'Test_US_01',
        creativeId: Number.NaN,
        date,
        randomSuffix: 'AAA'
      })

      expect(name).toBe('Test_US_01_CMP_0_20251127000000_010_AAA')
    })
  })
})

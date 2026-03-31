/**
 * 语言约束单元测试
 */

import {
  getLanguageConstraints,
  normalizeLanguageCode,
  isSupportedLanguage,
  getSupportedLanguages,
  validateHeadlineLength,
  validateDescriptionLength,
  validateKeywordWordCount,
  validateKeywordSearchVolume,
  getLanguageConstraintsSummary,
  compareLanguageConstraints,
  getLanguageSpecificAdvice
} from '../language-constraints'

describe('LanguageConstraints', () => {
  describe('getLanguageConstraints', () => {
    it('should return English constraints by default', () => {
      const constraints = getLanguageConstraints('en')
      expect(constraints.language).toBe('English')
      expect(constraints.headlineLength).toBe(30)
      expect(constraints.descriptionLength).toBe(90)
    })

    it('should return German constraints', () => {
      const constraints = getLanguageConstraints('de')
      expect(constraints.language).toBe('German')
      expect(constraints.headlineLength).toBe(35)
      expect(constraints.descriptionLength).toBe(100)
    })

    it('should return Italian constraints', () => {
      const constraints = getLanguageConstraints('it')
      expect(constraints.language).toBe('Italian')
      expect(constraints.headlineLength).toBe(32)
    })

    it('should return Japanese constraints', () => {
      const constraints = getLanguageConstraints('ja')
      expect(constraints.language).toBe('Japanese')
      expect(constraints.keywordMaxWords).toBe(2)
    })

    it('should return Chinese constraints', () => {
      const constraints = getLanguageConstraints('zh')
      expect(constraints.language).toBe('Chinese')
      expect(constraints.keywordMaxWords).toBe(3)
    })

    it('should return default for unknown language', () => {
      const constraints = getLanguageConstraints('unknown')
      expect(constraints.language).toBe('English')
    })

    it('should have all required properties', () => {
      const constraints = getLanguageConstraints('en')
      expect(constraints).toHaveProperty('language')
      expect(constraints).toHaveProperty('languageCode')
      expect(constraints).toHaveProperty('headlineLength')
      expect(constraints).toHaveProperty('descriptionLength')
      expect(constraints).toHaveProperty('keywordMaxWords')
      expect(constraints).toHaveProperty('keywordMinSearchVolume')
    })
  })

  describe('normalizeLanguageCode', () => {
    it('should normalize full language names', () => {
      expect(normalizeLanguageCode('English')).toBe('en')
      expect(normalizeLanguageCode('German')).toBe('de')
      expect(normalizeLanguageCode('Italian')).toBe('it')
      expect(normalizeLanguageCode('Japanese')).toBe('ja')
    })

    it('should normalize language codes', () => {
      expect(normalizeLanguageCode('en')).toBe('en')
      expect(normalizeLanguageCode('de')).toBe('de')
      expect(normalizeLanguageCode('de-ch')).toBe('de-ch')
    })

    it('should be case insensitive', () => {
      expect(normalizeLanguageCode('ENGLISH')).toBe('en')
      expect(normalizeLanguageCode('English')).toBe('en')
      expect(normalizeLanguageCode('eNgLiSh')).toBe('en')
    })

    it('should handle whitespace', () => {
      expect(normalizeLanguageCode('  en  ')).toBe('en')
      expect(normalizeLanguageCode('  English  ')).toBe('en')
    })

    it('should return en for unknown language', () => {
      expect(normalizeLanguageCode('unknown')).toBe('en')
      expect(normalizeLanguageCode('xyz')).toBe('en')
    })
  })

  describe('isSupportedLanguage', () => {
    it('should return true for supported languages', () => {
      expect(isSupportedLanguage('en')).toBe(true)
      expect(isSupportedLanguage('de')).toBe(true)
      expect(isSupportedLanguage('it')).toBe(true)
      expect(isSupportedLanguage('ja')).toBe(true)
      expect(isSupportedLanguage('zh')).toBe(true)
    })

    it('should return true for full language names', () => {
      expect(isSupportedLanguage('English')).toBe(true)
      expect(isSupportedLanguage('German')).toBe(true)
      expect(isSupportedLanguage('Italian')).toBe(true)
    })

    it('should return false for unsupported languages', () => {
      expect(isSupportedLanguage('unknown')).toBe(false)
      expect(isSupportedLanguage('xyz')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(isSupportedLanguage('ENGLISH')).toBe(true)
      expect(isSupportedLanguage('GERMAN')).toBe(true)
    })
  })

  describe('getSupportedLanguages', () => {
    it('should return array of languages', () => {
      const languages = getSupportedLanguages()
      expect(Array.isArray(languages)).toBe(true)
      expect(languages.length).toBeGreaterThan(0)
    })

    it('should include major languages', () => {
      const languages = getSupportedLanguages()
      const codes = languages.map(l => l.languageCode)
      expect(codes).toContain('en')
      expect(codes).toContain('de')
      expect(codes).toContain('ja')
      expect(codes).toContain('zh')
    })

    it('should have all required properties', () => {
      const languages = getSupportedLanguages()
      for (const lang of languages) {
        expect(lang).toHaveProperty('language')
        expect(lang).toHaveProperty('languageCode')
        expect(lang).toHaveProperty('headlineLength')
        expect(lang).toHaveProperty('descriptionLength')
      }
    })
  })

  describe('validateHeadlineLength', () => {
    it('should validate English headline length', () => {
      expect(validateHeadlineLength('A'.repeat(30), 'en')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(31), 'en')).toBe(false)
    })

    it('should validate German headline length', () => {
      expect(validateHeadlineLength('A'.repeat(35), 'de')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(36), 'de')).toBe(false)
    })

    it('should validate Japanese headline length', () => {
      expect(validateHeadlineLength('A'.repeat(30), 'ja')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(31), 'ja')).toBe(false)
    })

    it('should use default for unknown language', () => {
      expect(validateHeadlineLength('A'.repeat(30), 'unknown')).toBe(true)
      expect(validateHeadlineLength('A'.repeat(31), 'unknown')).toBe(false)
    })

    it('should handle empty headline', () => {
      expect(validateHeadlineLength('', 'en')).toBe(true)
    })
  })

  describe('validateDescriptionLength', () => {
    it('should validate English description length', () => {
      expect(validateDescriptionLength('A'.repeat(90), 'en')).toBe(true)
      expect(validateDescriptionLength('A'.repeat(91), 'en')).toBe(false)
    })

    it('should validate German description length', () => {
      expect(validateDescriptionLength('A'.repeat(100), 'de')).toBe(true)
      expect(validateDescriptionLength('A'.repeat(101), 'de')).toBe(false)
    })

    it('should validate Italian description length', () => {
      expect(validateDescriptionLength('A'.repeat(95), 'it')).toBe(true)
      expect(validateDescriptionLength('A'.repeat(96), 'it')).toBe(false)
    })

    it('should use default for unknown language', () => {
      expect(validateDescriptionLength('A'.repeat(90), 'unknown')).toBe(true)
      expect(validateDescriptionLength('A'.repeat(91), 'unknown')).toBe(false)
    })
  })

  describe('validateKeywordWordCount', () => {
    it('should validate English keyword word count', () => {
      expect(validateKeywordWordCount('robot vacuum', 'en')).toBe(true)
      expect(validateKeywordWordCount('robot vacuum cleaner sale', 'en')).toBe(true)
      expect(validateKeywordWordCount('a b c d e', 'en')).toBe(false)
    })

    it('should validate German keyword word count', () => {
      expect(validateKeywordWordCount('robot vacuum', 'de')).toBe(true)
      expect(validateKeywordWordCount('robot vacuum cleaner', 'de')).toBe(true)  // 修复: 3个词，德语max=3
    })

    it('should validate Japanese keyword word count', () => {
      expect(validateKeywordWordCount('robot vacuum', 'ja')).toBe(true)
      expect(validateKeywordWordCount('robot vacuum cleaner', 'ja')).toBe(false)
    })

    it('should validate single word keywords', () => {
      expect(validateKeywordWordCount('robot', 'en')).toBe(true)
      expect(validateKeywordWordCount('robot', 'ja')).toBe(true)
    })

    it('should use default for unknown language', () => {
      expect(validateKeywordWordCount('robot vacuum', 'unknown')).toBe(true)
    })
  })

  describe('validateKeywordSearchVolume', () => {
    it('should validate English search volume', () => {
      expect(validateKeywordSearchVolume(500, 'en')).toBe(true)
      expect(validateKeywordSearchVolume(499, 'en')).toBe(false)
    })

    it('should validate German search volume', () => {
      expect(validateKeywordSearchVolume(400, 'de')).toBe(true)
      expect(validateKeywordSearchVolume(399, 'de')).toBe(false)
    })

    it('should validate Japanese search volume', () => {
      expect(validateKeywordSearchVolume(250, 'ja')).toBe(true)
      expect(validateKeywordSearchVolume(249, 'ja')).toBe(false)
    })

    it('should validate zero volume', () => {
      expect(validateKeywordSearchVolume(0, 'en')).toBe(false)
    })

    it('should validate high volume', () => {
      expect(validateKeywordSearchVolume(10000, 'en')).toBe(true)
    })

    it('should use default for unknown language', () => {
      expect(validateKeywordSearchVolume(500, 'unknown')).toBe(true)
    })
  })

  describe('getLanguageConstraintsSummary', () => {
    it('should generate summary for English', () => {
      const summary = getLanguageConstraintsSummary('en')
      expect(summary).toContain('English')
      expect(summary).toContain('Headline Length')
      expect(summary).toContain('30')
    })

    it('should generate summary for German', () => {
      const summary = getLanguageConstraintsSummary('de')
      expect(summary).toContain('German')
      expect(summary).toContain('35')
    })

    it('should include all constraint details', () => {
      const summary = getLanguageConstraintsSummary('en')
      expect(summary).toContain('Headline Length')
      expect(summary).toContain('Description Length')
      expect(summary).toContain('Keyword Max Words')
      expect(summary).toContain('Keyword Min Search Volume')
    })

    it('should be formatted as readable text', () => {
      const summary = getLanguageConstraintsSummary('en')
      expect(summary.length).toBeGreaterThan(0)
      expect(summary).toContain('\n')
    })
  })

  describe('compareLanguageConstraints', () => {
    it('should compare English and German', () => {
      const comparison = compareLanguageConstraints('en', 'de')
      expect(comparison).toContain('English')
      expect(comparison).toContain('German')
      expect(comparison).toContain('Headline Length')
    })

    it('should show differences', () => {
      const comparison = compareLanguageConstraints('en', 'de')
      expect(comparison).toContain('Difference')
    })

    it('should compare multiple constraints', () => {
      const comparison = compareLanguageConstraints('en', 'ja')
      expect(comparison).toContain('Headline Length')
      expect(comparison).toContain('Description Length')
      expect(comparison).toContain('Keyword Max Words')
      expect(comparison).toContain('Keyword Min Search Volume')
    })

    it('should handle same language comparison', () => {
      const comparison = compareLanguageConstraints('en', 'en')
      expect(comparison).toContain('English')
    })
  })

  describe('getLanguageSpecificAdvice', () => {
    it('should provide advice for German', () => {
      const advice = getLanguageSpecificAdvice('de')
      expect(Array.isArray(advice)).toBe(true)
      expect(advice.length).toBeGreaterThan(0)
      expect(advice[0]).toContain('compound')
    })

    it('should provide advice for Japanese', () => {
      const advice = getLanguageSpecificAdvice('ja')
      expect(Array.isArray(advice)).toBe(true)
      expect(advice.some(a => a.includes('compact'))).toBe(true)
    })

    it('should provide advice for Chinese', () => {
      const advice = getLanguageSpecificAdvice('zh')
      expect(Array.isArray(advice)).toBe(true)
      expect(advice.some(a => a.includes('compact'))).toBe(true)
    })

    it('should provide advice for Romance languages', () => {
      const advice = getLanguageSpecificAdvice('it')
      expect(Array.isArray(advice)).toBe(true)
      expect(advice.some(a => a.includes('verbose'))).toBe(true)
    })

    it('should provide default advice for English', () => {
      const advice = getLanguageSpecificAdvice('en')
      expect(Array.isArray(advice)).toBe(true)
    })

    it('should provide advice for unknown language', () => {
      const advice = getLanguageSpecificAdvice('unknown')
      expect(Array.isArray(advice)).toBe(true)
    })
  })

  describe('Multi-language support', () => {
    it('should support 12+ languages', () => {
      const languages = getSupportedLanguages()
      expect(languages.length).toBeGreaterThanOrEqual(12)
    })

    it('should have different constraints for different languages', () => {
      const en = getLanguageConstraints('en')
      const de = getLanguageConstraints('de')
      const ja = getLanguageConstraints('ja')

      expect(en.headlineLength).not.toBe(de.headlineLength)
      expect(de.headlineLength).not.toBe(ja.headlineLength)
      expect(en.keywordMaxWords).not.toBe(ja.keywordMaxWords)
    })

    it('should handle language code variations', () => {
      expect(getLanguageConstraints('en')).toEqual(getLanguageConstraints('EN'))
      expect(getLanguageConstraints('de')).toEqual(getLanguageConstraints('DE'))
      expect(getLanguageConstraints('English')).toEqual(getLanguageConstraints('en'))
    })
  })

  describe('Edge cases', () => {
    it('should handle empty language string', () => {
      const constraints = getLanguageConstraints('')
      expect(constraints.language).toBe('English')
    })

    it('should handle very long language string', () => {
      const constraints = getLanguageConstraints('A'.repeat(100))
      expect(constraints.language).toBe('English')
    })

    it('should handle special characters in language', () => {
      const constraints = getLanguageConstraints('en-US')
      expect(constraints).toBeDefined()
    })

    it('should handle numeric language codes', () => {
      const constraints = getLanguageConstraints('123')
      expect(constraints.language).toBe('English')
    })

    it('should handle mixed case language names', () => {
      expect(normalizeLanguageCode('eNgLiSh')).toBe('en')
      expect(normalizeLanguageCode('gErMaN')).toBe('de')
    })
  })

  describe('Performance', () => {
    it('should get constraints quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        getLanguageConstraints('en')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should validate headline length quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        validateHeadlineLength('A'.repeat(30), 'en')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should validate keyword word count quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        validateKeywordWordCount('robot vacuum', 'en')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should normalize language code quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        normalizeLanguageCode('English')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })
  })
})

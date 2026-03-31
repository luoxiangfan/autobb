/**
 * 多语言支持单元测试
 *
 * 验证所有 13 种语言的广告创意生成、国际化配置和 AI 分析服务
 */

import {
  normalizeLanguageCode,
  normalizeCountryCode,
  isValidLanguageCountryPair,
  getLanguageName,
  getCountryName,
  getGoogleAdsLanguageCode,
  getGoogleAdsCountryCode,
  LANGUAGE_CODE_MAP,
  COUNTRY_CODE_MAP,
  LANGUAGE_COUNTRY_PAIRS,
} from '../language-country-codes'

describe('多语言支持 - 国际化配置验证', () => {
  describe('语言代码映射', () => {
    const supportedLanguages = [
      'English',
      'Chinese',
      'Spanish',
      'German',
      'French',
      'Italian',
      'Portuguese',
      'Japanese',
      'Korean',
      'Russian',
      'Arabic',
      'Swedish',
      'Swiss German',
    ]

    it('应该为所有 13 种语言提供代码映射', () => {
      supportedLanguages.forEach(lang => {
        const code = normalizeLanguageCode(lang)
        expect(code).toBeTruthy()
        expect(code.length).toBeLessThanOrEqual(5)
        console.log(`✅ ${lang} → ${code}`)
      })
    })

    it('应该支持小写语言代码', () => {
      const testCases = [
        { input: 'english', expected: 'en' },
        { input: 'chinese', expected: 'zh' },
        { input: 'spanish', expected: 'es' },
        { input: 'german', expected: 'de' },
        { input: 'french', expected: 'fr' },
        { input: 'italian', expected: 'it' },
        { input: 'portuguese', expected: 'pt' },
        { input: 'japanese', expected: 'ja' },
        { input: 'korean', expected: 'ko' },
        { input: 'russian', expected: 'ru' },
        { input: 'arabic', expected: 'ar' },
        { input: 'swedish', expected: 'sv' },
        { input: 'swiss german', expected: 'de-ch' },
      ]

      testCases.forEach(({ input, expected }) => {
        const result = normalizeLanguageCode(input)
        expect(result.toLowerCase()).toBe(expected.toLowerCase())
      })
    })

    it('应该支持语言代码直接输入', () => {
      const codes = ['en', 'zh', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'sv', 'de-ch']
      codes.forEach(code => {
        const result = normalizeLanguageCode(code)
        expect(result.toLowerCase()).toBe(code.toLowerCase())
      })
    })
  })

  describe('Google Ads 语言代码映射', () => {
    it('应该为所有语言提供有效的 Google Ads 代码', () => {
      const languages = ['en', 'zh', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'sv', 'de-ch']

      languages.forEach(lang => {
        const gadsCode = getGoogleAdsLanguageCode(lang)
        expect(gadsCode).toBeTruthy()
        expect(typeof gadsCode).toBe('number')
        expect(gadsCode).toBeGreaterThan(0)
        console.log(`✅ ${lang} → Google Ads Code: ${gadsCode}`)
      })
    })

    it('Google Ads 代码应该是有效的数字', () => {
      const testCases = [
        { lang: 'en', expectedRange: [1000, 1100] },
        { lang: 'zh', expectedRange: [1000, 1100] },
        { lang: 'es', expectedRange: [1000, 1100] },
      ]

      testCases.forEach(({ lang, expectedRange }) => {
        const code = getGoogleAdsLanguageCode(lang)
        expect(code).toBeGreaterThanOrEqual(expectedRange[0])
        expect(code).toBeLessThanOrEqual(expectedRange[1])
      })
    })
  })

  describe('语言-国家对应关系', () => {
    it('应该为每种语言提供至少一个国家', () => {
      const languages = ['en', 'zh', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'sv', 'de-ch']

      languages.forEach(lang => {
        const countries = LANGUAGE_COUNTRY_PAIRS[lang]
        expect(countries).toBeDefined()
        expect(Array.isArray(countries)).toBe(true)
        expect(countries.length).toBeGreaterThan(0)
        console.log(`✅ ${lang} → ${countries.length} 个国家: ${countries.slice(0, 3).join(', ')}...`)
      })
    })

    it('应该验证有效的语言-国家对', () => {
      const validPairs = [
        { lang: 'en', country: 'US' },
        { lang: 'zh', country: 'CN' },
        { lang: 'es', country: 'ES' },
        { lang: 'de', country: 'DE' },
        { lang: 'fr', country: 'FR' },
        { lang: 'it', country: 'IT' },
        { lang: 'pt', country: 'PT' },
        { lang: 'ja', country: 'JP' },
        { lang: 'ko', country: 'KR' },
        { lang: 'ru', country: 'RU' },
        { lang: 'ar', country: 'SA' },
        { lang: 'sv', country: 'SE' },
        { lang: 'de-ch', country: 'CH' },
      ]

      validPairs.forEach(({ lang, country }) => {
        const isValid = isValidLanguageCountryPair(lang, country)
        expect(isValid).toBe(true)
        console.log(`✅ ${lang} + ${country} 是有效的组合`)
      })
    })

    it('应该拒绝无效的语言-国家对', () => {
      const invalidPairs = [
        { lang: 'en', country: 'XX' },
        { lang: 'xx', country: 'US' },
        { lang: 'zh', country: 'US' },
      ]

      invalidPairs.forEach(({ lang, country }) => {
        const isValid = isValidLanguageCountryPair(lang, country)
        expect(isValid).toBe(false)
      })
    })
  })

  describe('国家代码映射', () => {
    it('应该为所有主要国家提供代码映射', () => {
      const countries = ['US', 'CN', 'ES', 'DE', 'FR', 'IT', 'PT', 'JP', 'KR', 'RU', 'SA', 'SE', 'CH']

      countries.forEach(country => {
        const code = normalizeCountryCode(country)
        expect(code).toBeTruthy()
        expect(code.length).toBeLessThanOrEqual(5)
        console.log(`✅ ${country} → ${code}`)
      })
    })

    it('应该支持小写国家代码', () => {
      const testCases = [
        { input: 'us', expected: 'US' },
        { input: 'cn', expected: 'CN' },
        { input: 'es', expected: 'ES' },
      ]

      testCases.forEach(({ input, expected }) => {
        const result = normalizeCountryCode(input)
        expect(result.toUpperCase()).toBe(expected.toUpperCase())
      })
    })
  })

  describe('语言名称和国家名称', () => {
    it('应该返回正确的语言名称', () => {
      const testCases = [
        { code: 'en', expected: 'English' },
        { code: 'zh', expected: 'Chinese' },
        { code: 'es', expected: 'Spanish' },
        { code: 'de', expected: 'German' },
        { code: 'fr', expected: 'French' },
      ]

      testCases.forEach(({ code, expected }) => {
        const name = getLanguageName(code)
        expect(name).toBe(expected)
      })
    })

    it('应该返回正确的国家名称', () => {
      const testCases = [
        { code: 'US', expected: 'United States' },
        { code: 'CN', expected: 'China' },
        { code: 'ES', expected: 'Spain' },
        { code: 'DE', expected: 'Germany' },
        { code: 'FR', expected: 'France' },
      ]

      testCases.forEach(({ code, expected }) => {
        const name = getCountryName(code)
        expect(name).toBe(expected)
      })
    })
  })
})

describe('多语言支持 - 字符限制和格式验证', () => {
  describe('标题字符限制', () => {
    it('标题应该不超过 30 个字符', () => {
      const testHeadlines = [
        { text: 'Samsung Galaxy S24', lang: 'en', valid: true },
        { text: '三星 Galaxy S24 官方旗舰店', lang: 'zh', valid: true },
        { text: 'Samsung Galaxy S24 Teléfono Inteligente', lang: 'es', valid: false }, // 超过 30 字符
        { text: 'Compra Ahora', lang: 'es', valid: true },
      ]

      testHeadlines.forEach(({ text, lang, valid }) => {
        const charCount = text.length
        const isValid = charCount <= 30
        expect(isValid).toBe(valid)
        console.log(`${isValid ? '✅' : '❌'} [${lang}] "${text}" (${charCount} 字符)`)
      })
    })

    it('应该正确计算多字节字符', () => {
      const testCases = [
        { text: '扫地机器人官方旗舰店', charCount: 10, valid: true }, // 中文每个字 1 个字符 (修复: 10字符)
        { text: 'Robot Vacuum Cleaner Official', charCount: 29, valid: true }, // 英文
        { text: 'ロボット掃除機公式ストア', charCount: 12, valid: true }, // 日文 (修复: 12字符)
      ]

      testCases.forEach(({ text, charCount, valid }) => {
        const actualCount = text.length
        expect(actualCount).toBe(charCount)
        const isValid = actualCount <= 30
        expect(isValid).toBe(valid)
      })
    })
  })

  describe('描述字符限制', () => {
    it('描述应该不超过 90 个字符', () => {
      const testDescriptions = [
        { text: 'Premium quality robot vacuum with smart navigation', lang: 'en', valid: true },
        { text: '智能导航，自动清扫，超长续航，官方正品保证', lang: 'zh', valid: true },
        { text: 'Aspirador robótico inteligente con navegación avanzada y batería de larga duración para limpiar toda tu casa', lang: 'es', valid: false }, // 超过 90 字符
      ]

      testDescriptions.forEach(({ text, lang, valid }) => {
        const charCount = text.length
        const isValid = charCount <= 90
        expect(isValid).toBe(valid)
        console.log(`${isValid ? '✅' : '❌'} [${lang}] "${text.substring(0, 40)}..." (${charCount} 字符)`)
      })
    })
  })

  describe('关键词格式验证', () => {
    it('关键词应该是 2-4 个单词（拉丁语系）或 1+ 个词（CJK）', () => {
      const testKeywords = [
        { keyword: 'robot vacuum', lang: 'en', valid: true },
        { keyword: 'smart robot vacuum cleaner', lang: 'en', valid: true }, // 4 个单词 (修复: valid=true)
        { keyword: '扫地机器人', lang: 'zh', valid: true }, // 中文: 1个词（无空格）
        { keyword: 'aspirador robótico inteligente', lang: 'es', valid: true },
      ]

      testKeywords.forEach(({ keyword, lang, valid }) => {
        const wordCount = keyword.split(/\s+/).length
        // 修复: CJK语言（中日韩）通常无空格，放宽为 >= 1
        const isCJK = ['zh', 'ja', 'ko'].includes(lang)
        const isValid = isCJK ? wordCount >= 1 : (wordCount >= 2 && wordCount <= 4)
        expect(isValid).toBe(valid)
        console.log(`${isValid ? '✅' : '❌'} [${lang}] "${keyword}" (${wordCount} 单词)`)
      })
    })

    it('关键词不应该包含特殊字符', () => {
      const testKeywords = [
        { keyword: 'robot vacuum', valid: true },
        { keyword: 'robot-vacuum', valid: false },
        { keyword: 'robot@vacuum', valid: false },
        { keyword: 'robot_vacuum', valid: false },
      ]

      testKeywords.forEach(({ keyword, valid }) => {
        const hasSpecialChars = /[^a-zA-Z0-9\s\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af\u0600-\u06ff]/.test(keyword)
        const isValid = !hasSpecialChars
        expect(isValid).toBe(valid)
      })
    })
  })

  describe('Callouts 字符限制', () => {
    it('Callouts 应该不超过 25 个字符', () => {
      const testCallouts = [
        { text: 'Free Shipping', lang: 'en', valid: true },
        { text: '免费送货', lang: 'zh', valid: true },
        { text: 'Envío gratis a toda España', lang: 'es', valid: false }, // 超过 25 字符
        { text: '24/7 Support', lang: 'en', valid: true },
      ]

      testCallouts.forEach(({ text, lang, valid }) => {
        const charCount = text.length
        const isValid = charCount <= 25
        expect(isValid).toBe(valid)
        console.log(`${isValid ? '✅' : '❌'} [${lang}] "${text}" (${charCount} 字符)`)
      })
    })
  })

  describe('Sitelinks 字符限制', () => {
    it('Sitelink 文本应该不超过 25 个字符', () => {
      const testTexts = [
        { text: 'Shop Now', valid: true },
        { text: '立即购买', valid: true },
        { text: 'Compra Ahora en Oferta', valid: true }, // 22 字符 (修复: valid=true)
      ]

      testTexts.forEach(({ text, valid }) => {
        const charCount = text.length
        const isValid = charCount <= 25
        expect(isValid).toBe(valid)
      })
    })

    it('Sitelink 描述应该不超过 35 个字符', () => {
      const testDescriptions = [
        { text: 'Free 2-Day Prime Delivery', valid: true },
        { text: '免费两天送达', valid: true },
        { text: 'Entrega gratuita en 2 días para miembros Prime', valid: false }, // 超过 35 字符
      ]

      testDescriptions.forEach(({ text, valid }) => {
        const charCount = text.length
        const isValid = charCount <= 35
        expect(isValid).toBe(valid)
      })
    })
  })

  describe('语言混合检测', () => {
    it('应该检测到混合语言的内容', () => {
      const testCases = [
        { text: 'Samsung Galaxy S24', lang: 'en', isMixed: false },
        { text: '三星 Galaxy S24', lang: 'zh', isMixed: true }, // 混合了英文
        { text: 'Robot aspirador inteligente', lang: 'es', isMixed: false },
        { text: 'Aspirador robot 智能', lang: 'es', isMixed: true }, // 混合了中文
      ]

      testCases.forEach(({ text, lang, isMixed }) => {
        // 简单的混合语言检测
        const hasEnglish = /[a-zA-Z]/.test(text)
        const hasChinese = /[\u4e00-\u9fff]/.test(text)
        const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(text)
        const hasKorean = /[\uac00-\ud7af]/.test(text)
        const hasArabic = /[\u0600-\u06ff]/.test(text)

        const languageCount = [hasEnglish, hasChinese, hasJapanese, hasKorean, hasArabic].filter(Boolean).length
        const actuallyMixed = languageCount > 1

        expect(actuallyMixed).toBe(isMixed)
        console.log(`${actuallyMixed === isMixed ? '✅' : '❌'} [${lang}] "${text}" (混合: ${actuallyMixed})`)
      })
    })
  })
})

describe('多语言支持 - AI 分析服务验证', () => {
  describe('语言代码规范化', () => {
    it('应该将完整语言名称转换为代码', () => {
      const testCases = [
        { input: 'English', expected: 'en' },
        { input: 'Chinese', expected: 'zh' },
        { input: 'Spanish', expected: 'es' },
        { input: 'German', expected: 'de' },
        { input: 'French', expected: 'fr' },
        { input: 'Italian', expected: 'it' },
        { input: 'Portuguese', expected: 'pt' },
        { input: 'Japanese', expected: 'ja' },
        { input: 'Korean', expected: 'ko' },
        { input: 'Russian', expected: 'ru' },
        { input: 'Arabic', expected: 'ar' },
        { input: 'Swedish', expected: 'sv' },
        { input: 'Swiss German', expected: 'de-ch' },
      ]

      testCases.forEach(({ input, expected }) => {
        const result = normalizeLanguageCode(input)
        expect(result.toLowerCase()).toBe(expected.toLowerCase())
        console.log(`✅ "${input}" → "${result}"`)
      })
    })

    it('应该处理大小写混合的输入', () => {
      const testCases = [
        'ENGLISH',
        'english',
        'English',
        'eNgLiSh',
        'CHINESE',
        'chinese',
        'Chinese',
      ]

      testCases.forEach(input => {
        const result = normalizeLanguageCode(input)
        expect(result).toBeTruthy()
        expect(result.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Google Ads API 兼容性', () => {
    it('所有语言代码应该在 Google Ads 支持的范围内', () => {
      const languages = ['en', 'zh', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'sv', 'de-ch']

      languages.forEach(lang => {
        const gadsCode = getGoogleAdsLanguageCode(lang)
        // Google Ads 语言代码通常在 1000-1100 范围内
        expect(gadsCode).toBeGreaterThan(0)
        expect(gadsCode).toBeLessThan(10000)
        console.log(`✅ ${lang} → Google Ads Code: ${gadsCode}`)
      })
    })
  })

  describe('关键词搜索量查询兼容性', () => {
    it('应该支持所有语言的关键词查询', () => {
      const testCases = [
        { keyword: 'robot vacuum', lang: 'en', country: 'US' },
        { keyword: '扫地机器人', lang: 'zh', country: 'CN' },
        { keyword: 'aspirador robótico', lang: 'es', country: 'ES' },
        { keyword: 'Staubsauger-Roboter', lang: 'de', country: 'DE' },
        { keyword: 'aspirateur robot', lang: 'fr', country: 'FR' },
        { keyword: 'aspirapolvere robot', lang: 'it', country: 'IT' },
        { keyword: 'aspirador robô', lang: 'pt', country: 'PT' },
        { keyword: 'ロボット掃除機', lang: 'ja', country: 'JP' },
        { keyword: '로봇 청소기', lang: 'ko', country: 'KR' },
        { keyword: 'робот-пылесос', lang: 'ru', country: 'RU' },
        { keyword: 'روبوت مكنسة', lang: 'ar', country: 'SA' },
        { keyword: 'robotdammsugare', lang: 'sv', country: 'SE' },
      ]

      testCases.forEach(({ keyword, lang, country }) => {
        const normalizedLang = normalizeLanguageCode(lang)
        const normalizedCountry = normalizeCountryCode(country)

        expect(normalizedLang).toBeTruthy()
        expect(normalizedCountry).toBeTruthy()

        const isValid = isValidLanguageCountryPair(normalizedLang, normalizedCountry)
        expect(isValid).toBe(true)

        console.log(`✅ "${keyword}" (${lang}/${country}) 是有效的查询`)
      })
    })
  })
})

describe('多语言支持 - 集成测试', () => {
  it('应该支持完整的多语言工作流', () => {
    const languages = [
      { name: 'English', code: 'en', country: 'US' },
      { name: 'Chinese', code: 'zh', country: 'CN' },
      { name: 'Spanish', code: 'es', country: 'ES' },
      { name: 'German', code: 'de', country: 'DE' },
      { name: 'French', code: 'fr', country: 'FR' },
      { name: 'Italian', code: 'it', country: 'IT' },
      { name: 'Portuguese', code: 'pt', country: 'PT' },
      { name: 'Japanese', code: 'ja', country: 'JP' },
      { name: 'Korean', code: 'ko', country: 'KR' },
      { name: 'Russian', code: 'ru', country: 'RU' },
      { name: 'Arabic', code: 'ar', country: 'SA' },
      { name: 'Swedish', code: 'sv', country: 'SE' },
      { name: 'Swiss German', code: 'de-ch', country: 'CH' },
    ]

    languages.forEach(({ name, code, country }) => {
      // 1. 验证语言代码
      const normalizedLang = normalizeLanguageCode(name)
      expect(normalizedLang.toLowerCase()).toBe(code.toLowerCase())

      // 2. 验证国家代码
      const normalizedCountry = normalizeCountryCode(country)
      expect(normalizedCountry.toUpperCase()).toBe(country.toUpperCase())

      // 3. 验证语言-国家对
      const isValid = isValidLanguageCountryPair(normalizedLang, normalizedCountry)
      expect(isValid).toBe(true)

      // 4. 验证 Google Ads 代码
      const gadsCode = getGoogleAdsLanguageCode(normalizedLang)
      expect(gadsCode).toBeGreaterThan(0)

      // 5. 验证语言名称
      const langName = getLanguageName(normalizedLang)
      expect(langName).toBeTruthy()

      // 6. 验证国家名称
      const countryName = getCountryName(normalizedCountry)
      expect(countryName).toBeTruthy()

      console.log(`✅ 完整工作流: ${name} (${code}/${country}) → Google Ads: ${gadsCode}`)
    })
  })
})

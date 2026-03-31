/**
 * 合规性检查规则引擎单元测试
 */

import { checkCompliance, getAutoFixSuggestions, type CreativeContent } from '../compliance-checker'

describe('Compliance Checker', () => {
  describe('禁用词汇检查', () => {
    it('should detect exaggeration words', () => {
      const content: CreativeContent = {
        headlines: ['最好的产品', 'Best product ever'],
        descriptions: ['这是最优秀的选择']
      }

      const result = checkCompliance(content)
      expect(result.totalIssues).toBeGreaterThan(0)
      const exaggerationIssues = result.issues.filter(i => i.ruleId.includes('EXAGGERATION'))
      expect(exaggerationIssues.length).toBeGreaterThan(0)
    })

    it('should detect absolute words', () => {
      const content: CreativeContent = {
        headlines: ['100%保证满意', 'Absolutely guaranteed'],
        descriptions: ['绝对不会失望']
      }

      const result = checkCompliance(content)
      const absoluteIssues = result.issues.filter(i => i.ruleId.includes('ABSOLUTE'))
      expect(absoluteIssues.length).toBeGreaterThan(0)
    })

    it('should detect medical claims', () => {
      const content: CreativeContent = {
        headlines: ['治疗疾病', 'Cure your disease'],
        descriptions: ['有效治愈症状']
      }

      const result = checkCompliance(content)
      const medicalIssues = result.issues.filter(i => i.ruleId.includes('MEDICAL'))
      expect(medicalIssues.length).toBeGreaterThan(0)
      expect(medicalIssues[0].severity).toBe('high')
    })

    it('should detect financial promises', () => {
      const content: CreativeContent = {
        headlines: ['保本理财', 'Risk-free investment'],
        descriptions: ['稳赚不赔的机会']
      }

      const result = checkCompliance(content)
      const financialIssues = result.issues.filter(i => i.ruleId.includes('FINANCIAL'))
      expect(financialIssues.length).toBeGreaterThan(0)
      expect(financialIssues[0].severity).toBe('high')
    })

    it('should detect misleading words', () => {
      const content: CreativeContent = {
        headlines: ['完全免费', 'Free giveaway'],
        descriptions: ['错过不再的机会']
      }

      const result = checkCompliance(content)
      const misleadingIssues = result.issues.filter(i => i.ruleId.includes('MISLEADING'))
      expect(misleadingIssues.length).toBeGreaterThan(0)
    })
  })

  describe('格式检查', () => {
    it('should detect excessive capitalization', () => {
      const content: CreativeContent = {
        headlines: ['BEST PRODUCT EVER'],
        descriptions: ['BUY NOW FOR GREAT DEALS']
      }

      const result = checkCompliance(content)
      const capsIssues = result.issues.filter(i => i.ruleId === 'R_EXCESSIVE_CAPS')
      expect(capsIssues.length).toBe(2)
    })

    it('should detect repeated punctuation', () => {
      const content: CreativeContent = {
        headlines: ['Amazing!!!', 'Great Deal???'],
        descriptions: ['Buy now...']
      }

      const result = checkCompliance(content)
      const punctuationIssues = result.issues.filter(i =>
        i.ruleId === 'R_REPEATED_PUNCTUATION' || i.ruleId === 'R_EXCESSIVE_EXCLAMATION'
      )
      expect(punctuationIssues.length).toBeGreaterThan(0)
    })

    it('should detect prohibited symbols', () => {
      const content: CreativeContent = {
        headlines: ['★ Best Deal ★', 'Click Here →'],
        descriptions: ['✓ Verified ✓']
      }

      const result = checkCompliance(content)
      const symbolIssues = result.issues.filter(i => i.ruleId === 'R_PROHIBITED_SYMBOLS')
      expect(symbolIssues.length).toBe(3)
    })
  })

  describe('字符长度检查', () => {
    it('should detect headline length violations', () => {
      const content: CreativeContent = {
        headlines: ['This is a very long headline that exceeds the thirty character limit'],
        descriptions: ['Normal description']
      }

      const result = checkCompliance(content)
      const lengthIssues = result.issues.filter(i => i.ruleId === 'R_HEADLINE_LENGTH')
      expect(lengthIssues.length).toBe(1)
      expect(lengthIssues[0].severity).toBe('high')
    })

    it('should detect description length violations', () => {
      const content: CreativeContent = {
        headlines: ['Short headline'],
        descriptions: ['This is a very long description that exceeds the ninety character limit and should trigger a validation error']
      }

      const result = checkCompliance(content)
      const lengthIssues = result.issues.filter(i => i.ruleId === 'R_DESCRIPTION_LENGTH')
      expect(lengthIssues.length).toBe(1)
      expect(lengthIssues[0].severity).toBe('high')
    })

    it('should pass valid length content', () => {
      const content: CreativeContent = {
        headlines: ['Valid Headline'],
        descriptions: ['This is a valid description within the character limit']
      }

      const result = checkCompliance(content)
      const lengthIssues = result.issues.filter(i =>
        i.ruleId === 'R_HEADLINE_LENGTH' || i.ruleId === 'R_DESCRIPTION_LENGTH'
      )
      expect(lengthIssues.length).toBe(0)
    })
  })

  describe('重复内容检查', () => {
    it('should detect duplicate headlines', () => {
      const content: CreativeContent = {
        headlines: ['Same Headline', 'Same Headline', 'Different One'],
        descriptions: ['Description 1', 'Description 2']
      }

      const result = checkCompliance(content)
      const duplicateIssues = result.issues.filter(i => i.ruleId === 'R_DUPLICATE_HEADLINE')
      expect(duplicateIssues.length).toBe(1)
    })

    it('should detect duplicate descriptions', () => {
      const content: CreativeContent = {
        headlines: ['Headline 1', 'Headline 2'],
        descriptions: ['Same Description', 'Same Description']
      }

      const result = checkCompliance(content)
      const duplicateIssues = result.issues.filter(i => i.ruleId === 'R_DUPLICATE_DESCRIPTION')
      expect(duplicateIssues.length).toBe(1)
    })
  })

  describe('URL检查', () => {
    it('should detect non-HTTPS URLs', () => {
      const content: CreativeContent = {
        headlines: ['Great Product'],
        descriptions: ['Buy now'],
        finalUrl: 'http://example.com'
      }

      const result = checkCompliance(content)
      const urlIssues = result.issues.filter(i => i.ruleId === 'R_URL_HTTPS')
      expect(urlIssues.length).toBe(1)
      expect(urlIssues[0].severity).toBe('high')
    })

    it('should detect invalid URLs', () => {
      const content: CreativeContent = {
        headlines: ['Great Product'],
        descriptions: ['Buy now'],
        finalUrl: 'not-a-valid-url'
      }

      const result = checkCompliance(content)
      const urlIssues = result.issues.filter(i => i.ruleId === 'R_URL_INVALID')
      expect(urlIssues.length).toBe(1)
    })

    it('should pass valid HTTPS URLs', () => {
      const content: CreativeContent = {
        headlines: ['Great Product'],
        descriptions: ['Buy now'],
        finalUrl: 'https://example.com'
      }

      const result = checkCompliance(content)
      const urlIssues = result.issues.filter(i => i.field === 'url')
      expect(urlIssues.length).toBe(0)
    })
  })

  describe('品牌一致性检查', () => {
    it('should detect missing brand name', () => {
      const content: CreativeContent = {
        headlines: ['Great Product', 'Amazing Deal'],
        descriptions: ['Buy now for the best price'],
        brandName: 'MyBrand'
      }

      const result = checkCompliance(content)
      const brandIssues = result.issues.filter(i => i.ruleId === 'R_BRAND_MISSING')
      expect(brandIssues.length).toBe(1)
      expect(brandIssues[0].severity).toBe('low')
    })

    it('should pass when brand name is mentioned', () => {
      const content: CreativeContent = {
        headlines: ['MyBrand Products', 'Amazing Deal'],
        descriptions: ['Buy now for the best price'],
        brandName: 'MyBrand'
      }

      const result = checkCompliance(content)
      const brandIssues = result.issues.filter(i => i.ruleId === 'R_BRAND_MISSING')
      expect(brandIssues.length).toBe(0)
    })
  })

  describe('空内容检查', () => {
    it('should detect empty headlines', () => {
      const content: CreativeContent = {
        headlines: ['', '  ', 'Valid Headline'],
        descriptions: ['Valid description']
      }

      const result = checkCompliance(content)
      const emptyIssues = result.issues.filter(i => i.ruleId === 'R_EMPTY_HEADLINE')
      expect(emptyIssues.length).toBe(2)
    })

    it('should detect empty descriptions', () => {
      const content: CreativeContent = {
        headlines: ['Valid Headline'],
        descriptions: ['', '  ']
      }

      const result = checkCompliance(content)
      const emptyIssues = result.issues.filter(i => i.ruleId === 'R_EMPTY_DESCRIPTION')
      expect(emptyIssues.length).toBe(2)
    })
  })

  describe('点击诱导检查', () => {
    it('should detect clickbait words', () => {
      const content: CreativeContent = {
        headlines: ['点击这里查看', 'Click Here Now'],
        descriptions: ['立即点击了解更多']
      }

      const result = checkCompliance(content)
      const clickbaitIssues = result.issues.filter(i => i.ruleId === 'R_CLICKBAIT')
      expect(clickbaitIssues.length).toBeGreaterThan(0)
    })
  })

  describe('综合检查', () => {
    it('should return isCompliant=false when high severity issues exist', () => {
      const content: CreativeContent = {
        headlines: ['治疗疾病的最好产品'], // 医疗+夸大
        descriptions: ['']
      }

      const result = checkCompliance(content)
      expect(result.isCompliant).toBe(false)
      expect(result.highSeverityCount).toBeGreaterThan(0)
    })

    it('should return isCompliant=true when no high severity issues', () => {
      const content: CreativeContent = {
        headlines: ['优质产品 品质保证'],
        descriptions: ['为您提供专业的服务'],
        finalUrl: 'https://example.com',
        brandName: '优质品牌'
      }

      const result = checkCompliance(content)
      expect(result.isCompliant).toBe(true)
      expect(result.highSeverityCount).toBe(0)
    })

    it('should correctly count issues by severity', () => {
      const content: CreativeContent = {
        headlines: [
          'BEST PRODUCT', // 大写 (low)
          '最好的治疗方案!!!', // 夸大+医疗 (medium+high) + 重复标点 (low)
          'Click Here Now' // 点击诱导 (medium)
        ],
        descriptions: ['Description 1', 'Description 1'], // 重复 (medium)
        finalUrl: 'http://example.com' // 非HTTPS (high)
      }

      const result = checkCompliance(content)
      expect(result.highSeverityCount).toBeGreaterThan(0)
      expect(result.mediumSeverityCount).toBeGreaterThan(0)
      expect(result.lowSeverityCount).toBeGreaterThan(0)
    })
  })

  describe('自动修复建议', () => {
    it('should fix excessive capitalization', () => {
      const fixed = getAutoFixSuggestions(
        { ruleId: 'R_EXCESSIVE_CAPS', ruleName: '', severity: 'low', field: 'headline', message: '' },
        'BEST PRODUCT EVER'
      )
      expect(fixed).toBe('Best product ever')
    })

    it('should fix repeated punctuation', () => {
      const fixed = getAutoFixSuggestions(
        { ruleId: 'R_REPEATED_PUNCTUATION', ruleName: '', severity: 'low', field: 'headline', message: '' },
        'Amazing!!!'
      )
      expect(fixed).toBe('Amazing!')
    })

    it('should fix excessive exclamation marks', () => {
      const fixed = getAutoFixSuggestions(
        { ruleId: 'R_EXCESSIVE_EXCLAMATION', ruleName: '', severity: 'low', field: 'headline', message: '' },
        'Great!!! Amazing!!'
      )
      expect(fixed).toBe('Great! Amazing')
    })

    it('should return null for non-auto-fixable issues', () => {
      const fixed = getAutoFixSuggestions(
        { ruleId: 'R_MEDICAL', ruleName: '', severity: 'high', field: 'headline', message: '' },
        'Cure disease'
      )
      expect(fixed).toBeNull()
    })
  })
})

/**
 * 字符限制验证测试
 *
 * 测试 Callouts、Sitelinks 和关键词的字符限制验证
 */

describe('字符限制验证', () => {
  // ============================================================================
  // Callouts 长度验证 (≤25 字符)
  // ============================================================================
  describe('Callouts 长度验证 (≤25 字符)', () => {
    test('应该接受 ≤25 字符的 callouts', () => {
      const callouts = [
        'Free Shipping',           // 13 字符
        '免费送货',                 // 4 字符
        'Money Back Guarantee',    // 21 字符
        '24/7 Support',            // 12 字符
      ]

      callouts.forEach(callout => {
        expect(callout.length).toBeLessThanOrEqual(25)
      })
    })

    test('应该检测 >25 字符的 callouts', () => {
      const callouts = [
        'Free Shipping Worldwide',           // 24 字符 ✓
        'Free Shipping Worldwide Today',     // 31 字符 ✗
        'Envío gratis a toda España',        // 26 字符 ✗
      ]

      const invalidCallouts = callouts.filter(c => c.length > 25)
      expect(invalidCallouts).toHaveLength(2)
      expect(invalidCallouts).toContain('Free Shipping Worldwide Today')
      expect(invalidCallouts).toContain('Envío gratis a toda España')
    })

    test('应该正确截断超长 callouts', () => {
      const callouts = [
        'Free Shipping Worldwide Today',     // 31 字符
        'Money Back Guarantee Forever',      // 29 字符
      ]

      const truncated = callouts.map(c => c.substring(0, 25))
      // 修复: substring(0, 25) 的实际结果
      expect(truncated[0]).toBe('Free Shipping Worldwide T')
      expect(truncated[0].length).toBe(25)
      expect(truncated[1]).toBe('Money Back Guarantee Fore')
      expect(truncated[1].length).toBe(25)
    })

    test('应该处理空 callouts', () => {
      const callouts = ['', 'Free Shipping', null, undefined]
      const validCallouts = callouts.filter(c => c && c.length <= 25)
      expect(validCallouts).toHaveLength(1)
      expect(validCallouts[0]).toBe('Free Shipping')
    })

    test('应该处理多语言 callouts', () => {
      const callouts = [
        'Free Shipping',                     // 英文 13 字符
        '免费送货',                          // 中文 4 字符
        'Envío gratis',                      // 西班牙文 12 字符
        'Livraison gratuite',                // 法文 18 字符
        'Envío gratis a toda España',        // 西班牙文 26 字符 ✗
      ]

      const invalidCallouts = callouts.filter(c => c.length > 25)
      expect(invalidCallouts).toHaveLength(1)
    })
  })

  // ============================================================================
  // Sitelinks 长度验证 (text ≤25, desc ≤35)
  // ============================================================================
  describe('Sitelinks 长度验证 (text ≤25, desc ≤35)', () => {
    test('应该接受符合要求的 sitelinks', () => {
      const sitelinks = [
        { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },           // 8, 25
        { text: '立即购买', description: '免费两天送达' },                         // 4, 6
        { text: 'Support', description: 'Expert Tech Support 24/7' },             // 7, 25
      ]

      sitelinks.forEach(link => {
        expect(link.text.length).toBeLessThanOrEqual(25)
        expect(link.description.length).toBeLessThanOrEqual(35)
      })
    })

    test('应该检测文本超过 25 字符的 sitelinks', () => {
      const sitelinks = [
        { text: 'Shop Now', description: 'Free Delivery' },                       // 8, 13 ✓
        { text: 'Compra Ahora en Oferta Especial', description: 'Free' },        // 31, 4 ✗
      ]

      const invalidSitelinks = sitelinks.filter(s => s.text.length > 25)
      expect(invalidSitelinks).toHaveLength(1)
      expect(invalidSitelinks[0].text).toBe('Compra Ahora en Oferta Especial')
    })

    test('应该检测描述超过 35 字符的 sitelinks', () => {
      const sitelinks = [
        { text: 'Support', description: 'Expert Tech Support 24/7' },             // 7, 25 ✓
        { text: 'Delivery', description: 'Entrega gratuita en 2 días para miembros Prime' }, // 8, 46 ✗
      ]

      const invalidSitelinks = sitelinks.filter(s => s.description.length > 35)
      expect(invalidSitelinks).toHaveLength(1)
      expect(invalidSitelinks[0].description).toBe('Entrega gratuita en 2 días para miembros Prime')
    })

    test('应该正确截断超长 sitelinks', () => {
      const sitelinks = [
        { text: 'Compra Ahora en Oferta Especial', description: 'Entrega gratuita en 2 días para miembros Prime' },
      ]

      const truncated = sitelinks.map(s => ({
        text: s.text.substring(0, 25),
        description: s.description.substring(0, 35),
      }))

      expect(truncated[0].text).toBe('Compra Ahora en Oferta Es')
      expect(truncated[0].text.length).toBe(25)
      // 修复: 'Entrega gratuita en 2 días para miembros Prime'.substring(0, 35) 的实际结果
      expect(truncated[0].description).toBe('Entrega gratuita en 2 días para mie')
      expect(truncated[0].description.length).toBe(35)
    })

    test('应该处理空 sitelinks', () => {
      const sitelinks = [
        { text: '', description: 'Free Delivery' },
        { text: 'Shop Now', description: '' },
        null,
        undefined,
      ]

      const validSitelinks = sitelinks.filter(s =>
        s && s.text && s.text.length <= 25 && s.description && s.description.length <= 35
      )
      expect(validSitelinks).toHaveLength(0)
    })

    test('应该处理多语言 sitelinks', () => {
      const sitelinks = [
        { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },           // 英文
        { text: '立即购买', description: '免费两天送达' },                         // 中文
        { text: 'Comprar Ahora', description: 'Envío gratis en 2 días' },        // 西班牙文
        { text: 'Acheter Maintenant', description: 'Livraison gratuite 2 jours' }, // 法文
      ]

      const validSitelinks = sitelinks.filter(s =>
        s.text.length <= 25 && s.description.length <= 35
      )
      expect(validSitelinks).toHaveLength(4)
    })
  })

  // ============================================================================
  // 关键词长度验证 (1-4 个单词)
  // ============================================================================
  describe('关键词长度验证 (1-4 个单词)', () => {
    test('应该接受 1-4 个单词的关键词', () => {
      const keywords = [
        'Samsung',                           // 1 个单词
        'Samsung Galaxy',                    // 2 个单词
        'Samsung Galaxy S24',                // 3 个单词
        'Samsung Galaxy S24 Pro',            // 4 个单词
      ]

      keywords.forEach(keyword => {
        const wordCount = keyword.trim().split(/\s+/).length
        expect(wordCount).toBeGreaterThanOrEqual(1)
        expect(wordCount).toBeLessThanOrEqual(4)
      })
    })

    test('应该检测超过 4 个单词的关键词', () => {
      const keywords = [
        'Samsung Galaxy S24 Pro Max',        // 5 个单词 ✗
        'best robot vacuum for pet hair',    // 6 个单词 ✗
        'robot vacuum with mop',             // 4 个单词 ✓
      ]

      const invalidKeywords = keywords.filter(k => {
        const wordCount = k.trim().split(/\s+/).length
        return wordCount > 4
      })

      expect(invalidKeywords).toHaveLength(2)
    })

    test('应该检测空关键词', () => {
      const keywords = [
        'Samsung',
        '',
        '  ',
        'Galaxy S24',
        null,
        undefined,
      ]

      const validKeywords = keywords.filter(k => {
        if (!k || !k.trim()) return false  // 修复: 先检查trim后是否为空
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 4
      })

      expect(validKeywords).toHaveLength(2)
      expect(validKeywords).toEqual(['Samsung', 'Galaxy S24'])
    })

    test('应该处理多语言关键词', () => {
      const keywords = [
        'Samsung',                           // 英文 1 个单词
        '三星',                              // 中文 1 个单词
        'Samsung Galaxy',                    // 英文 2 个单词
        '三星 Galaxy',                       // 混合 2 个单词
        'robot vacuum for pet hair',         // 英文 5 个单词 ✗
        '宠物毛发机器人吸尘器',              // 中文 1 个单词
      ]

      const validKeywords = keywords.filter(k => {
        if (!k) return false
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 4
      })

      expect(validKeywords).toHaveLength(5)
    })

    test('应该正确过滤不符合要求的关键词', () => {
      const keywords = [
        'Samsung',                           // ✓
        'Samsung Galaxy',                    // ✓
        'Samsung Galaxy S24',                // ✓
        'Samsung Galaxy S24 Pro',            // ✓
        'Samsung Galaxy S24 Pro Max',        // ✗
        'best robot vacuum for pet hair',    // ✗
      ]

      const validKeywords = keywords.filter(k => {
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 4
      })

      expect(validKeywords).toHaveLength(4)
      expect(validKeywords).toContain('Samsung')
      expect(validKeywords).toContain('Samsung Galaxy')
      expect(validKeywords).toContain('Samsung Galaxy S24')
      expect(validKeywords).toContain('Samsung Galaxy S24 Pro')
    })

    test('应该处理带有特殊字符的关键词', () => {
      const keywords = [
        'Samsung-Galaxy',                    // 1 个单词 (连字符)
        'Samsung & Galaxy',                  // 2 个单词
        'Samsung (Galaxy)',                  // 2 个单词
        'Samsung/Galaxy',                    // 1 个单词 (斜杠)
      ]

      const validKeywords = keywords.filter(k => {
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 4
      })

      expect(validKeywords).toHaveLength(4)
    })
  })

  // ============================================================================
  // 综合验证测试
  // ============================================================================
  describe('综合验证', () => {
    test('应该同时验证 callouts、sitelinks 和关键词', () => {
      const creative = {
        callouts: [
          'Free Shipping',                   // ✓
          'Free Shipping Worldwide Today',   // ✗ (31 字符)
        ],
        sitelinks: [
          { text: 'Shop Now', description: 'Free Delivery' },                    // ✓
          { text: 'Compra Ahora en Oferta Especial', description: 'Free' },     // ✗ (31 字符)
        ],
        keywords: [
          'Samsung',                         // ✓
          'Samsung Galaxy S24 Pro Max',      // ✗ (5 个单词)
        ],
      }

      // 验证 callouts
      const invalidCallouts = creative.callouts.filter(c => c.length > 25)
      expect(invalidCallouts).toHaveLength(1)

      // 验证 sitelinks
      const invalidSitelinks = creative.sitelinks.filter(s =>
        s.text.length > 25 || s.description.length > 35
      )
      expect(invalidSitelinks).toHaveLength(1)

      // 验证关键词
      const invalidKeywords = creative.keywords.filter(k => {
        const wordCount = k.trim().split(/\s+/).length
        return wordCount < 1 || wordCount > 4
      })
      expect(invalidKeywords).toHaveLength(1)

      // 总共 3 个无效项
      expect(invalidCallouts.length + invalidSitelinks.length + invalidKeywords.length).toBe(3)
    })

    test('应该正确处理完全有效的创意', () => {
      const creative = {
        callouts: [
          'Free Shipping',
          '免费送货',
          'Money Back Guarantee',
        ],
        sitelinks: [
          { text: 'Shop Now', description: 'Free 2-Day Prime Delivery' },
          { text: '立即购买', description: '免费两天送达' },
        ],
        keywords: [
          'Samsung',
          'Samsung Galaxy',
          'Samsung Galaxy S24',
        ],
      }

      // 验证 callouts
      const invalidCallouts = creative.callouts.filter(c => c.length > 25)
      expect(invalidCallouts).toHaveLength(0)

      // 验证 sitelinks
      const invalidSitelinks = creative.sitelinks.filter(s =>
        s.text.length > 25 || s.description.length > 35
      )
      expect(invalidSitelinks).toHaveLength(0)

      // 验证关键词
      const invalidKeywords = creative.keywords.filter(k => {
        const wordCount = k.trim().split(/\s+/).length
        return wordCount < 1 || wordCount > 4
      })
      expect(invalidKeywords).toHaveLength(0)

      // 全部有效
      expect(invalidCallouts.length + invalidSitelinks.length + invalidKeywords.length).toBe(0)
    })
  })
})

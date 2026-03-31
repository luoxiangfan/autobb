/**
 * Offer category utilities tests
 * src/lib/__tests__/offer-category.test.ts
 */

import { describe, it, expect } from 'vitest'
import { compactCategoryLabel, deriveCategoryFromScrapedData } from '../offer-category'

describe('offer-category', () => {
  describe('compactCategoryLabel', () => {
    it('keeps leaf from breadcrumb-style categories', () => {
      const input = 'Home > Electronics > Cameras & Photo > Security Cameras'
      expect(compactCategoryLabel(input)).toBe('Security Cameras')
    })

    it('handles newline-separated breadcrumbs', () => {
      const input = 'Home\nElectronics\nSmart Home\nSmart Speakers'
      expect(compactCategoryLabel(input)).toBe('Smart Speakers')
    })

    it('strips Category prefix', () => {
      expect(compactCategoryLabel('Category: Smart Home')).toBe('Smart Home')
    })
  })

  describe('deriveCategoryFromScrapedData', () => {
    it('prefers store primaryCategories', () => {
      const scraped = JSON.stringify({
        productCategories: {
          primaryCategories: [
            { name: 'Smart Home', count: 10 },
            { name: 'Electronics', count: 3 },
          ],
          totalCategories: 2,
        },
      })
      expect(deriveCategoryFromScrapedData(scraped)).toBe('Smart Home')
    })

    it('falls back to productCategory', () => {
      const scraped = JSON.stringify({
        productCategory: 'Home > Kitchen & Dining > Coffee, Tea & Espresso',
      })
      expect(deriveCategoryFromScrapedData(scraped)).toBe('Coffee, Tea & Espresso')
    })
  })
})


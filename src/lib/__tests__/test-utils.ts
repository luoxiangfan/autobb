/**
 * 测试工具和Mock数据
 */

import type { Offer } from '../offers'
import type { GeneratedAdCreativeData, HeadlineAsset, DescriptionAsset } from '../ad-creative'

/**
 * Mock Offer 数据
 */
export const mockOffers = {
  eufy: {
    id: 1,
    brand: 'Eufy',
    brand_description: 'Smart home cleaning solutions',
    category: 'Robot Vacuum',
    target_country: 'US',
    target_language: 'English',
    unique_selling_points: '4K Resolution, Extended Battery Life, Smart Navigation',
    keywords: ['robot vacuum', 'smart cleaning', 'automated vacuum']
  } as Offer,

  eufyDE: {
    id: 2,
    brand: 'Eufy',
    brand_description: 'Intelligente Reinigungslösungen',
    category: 'Staubsauger-Roboter',
    target_country: 'DE',
    target_language: 'German',
    unique_selling_points: 'Intelligente Navigation, Lange Akkulaufzeit',
    keywords: ['robot staubsauger', 'intelligente reinigung']
  } as Offer,

  eufyIT: {
    id: 3,
    brand: 'Eufy',
    brand_description: 'Soluzioni di pulizia intelligenti',
    category: 'Robot Aspirapolvere',
    target_country: 'IT',
    target_language: 'Italian',
    unique_selling_points: 'Navigazione intelligente, Batteria lunga durata',
    keywords: ['robot aspirapolvere', 'pulizia intelligente']
  } as Offer,

  eufyJA: {
    id: 4,
    brand: 'Eufy',
    brand_description: 'スマートホーム清掃ソリューション',
    category: 'ロボット掃除機',
    target_country: 'JP',
    target_language: 'Japanese',
    unique_selling_points: 'スマートナビゲーション、長いバッテリー寿命',
    keywords: ['ロボット掃除機', 'スマート清掃']
  } as Offer
}

/**
 * Mock 标题数据
 */
export const mockHeadlines = {
  // 完整的15条标题（覆盖所有类型）
  complete: [
    // Brand (2)
    'Official Eufy Store',
    '#1 Trusted Eufy',
    // Feature (4)
    '4K Resolution Display',
    'Extended Battery Life',
    'Smart Navigation System',
    'Eco-Friendly Design',
    // Promo (3)
    'Save 30% Today',
    'Limited Time Offer',
    'Free Shipping',
    // CTA (3)
    'Shop Now',
    'Get Yours Today',
    'Claim Your Deal',
    // Urgency (2)
    'Only 5 Left in Stock',
    'Ends Tomorrow',
    'Premium Quality'
  ],

  // 不完整的标题（缺少某些类型）
  incomplete: [
    'Official Eufy Store',
    '4K Resolution Display',
    'Extended Battery Life',
    'Save 30% Today',
    'Limited Time Offer',
    'Shop Now',
    'Get Yours Today',
    'Only 5 Left in Stock',
    'Ends Tomorrow',
    'Premium Quality'
  ],

  // 相似度高的标题
  highSimilarity: [
    'Official Eufy Store',
    'Official Eufy Shop',
    'Official Eufy Online',
    'Trusted Eufy Store',
    'Trusted Eufy Shop',
    'Trusted Eufy Online',
    '4K Resolution Display',
    '4K Resolution Screen',
    '4K Resolution Monitor',
    'Extended Battery Life',
    'Long Battery Life',
    'Battery Life Extended',
    'Save 30% Today',
    'Save 30% Now',
    'Save 30% This Week'
  ],

  // 短标题
  short: [
    'Shop Now',
    'Buy Today',
    'Get Yours',
    'Claim Deal',
    'Order Now',
    'Save 30%',
    'Free Ship',
    'Limited',
    'Ends Soon',
    'In Stock',
    'Premium',
    'Quality',
    'Smart',
    'Fast',
    'Easy'
  ],

  // 长标题
  long: [
    'Official Eufy Smart Home Cleaning Solutions Store',
    'Trusted Number One Eufy Robot Vacuum Cleaner',
    'Advanced 4K Resolution Display Technology System',
    'Extended Battery Life Smart Navigation Features',
    'Eco-Friendly Design Premium Quality Guaranteed',
    'Save 30% Today Limited Time Special Offer',
    'Free Shipping Worldwide Fast Delivery Service',
    'Shop Now Get Your Eufy Robot Vacuum Today',
    'Claim Your Deal Exclusive Offer Limited Stock',
    'Only 5 Left in Stock Ends Tomorrow Hurry',
    'Premium Quality Trusted by Thousands Worldwide',
    'Smart Navigation System Advanced Technology',
    'Extended Battery Life Long Lasting Performance',
    'Eco-Friendly Design Sustainable Solution',
    'Official Store Authentic Products Guaranteed'
  ]
}

/**
 * Mock 描述数据
 */
export const mockDescriptions = {
  // 完整的4条描述（覆盖所有焦点）
  complete: [
    'Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers. Shop Now',
    'Shop Now for Fast, Free Delivery. Easy Returns Guaranteed.',
    '4K Resolution. Solar Powered. Works Rain or Shine. Learn More',
    'Trusted by 100K+ Buyers. 30-Day Money-Back Promise. Order Now'
  ],

  // 不完整的描述（缺少某些焦点）
  incomplete: [
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers.',
    'Fast, Free Delivery. Easy Returns.',
    '4K Resolution. Solar Powered. Works Rain or Shine.',
    'Trusted by 100K+ Buyers.'
  ],

  // 缺少CTA的描述
  noCTA: [
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers.',
    'Fast, Free Delivery. Easy Returns.',
    '4K Resolution. Solar Powered. Works Rain or Shine.',
    'Trusted by 100K+ Buyers. 30-Day Money-Back Promise.'
  ],

  // 相似度高的描述
  highSimilarity: [
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers. Shop Now',
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers. Buy Now',
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers. Order Now',
    'Award-Winning Tech. Rated 4.8 stars by 50K+ customers. Get Now'
  ]
}

/**
 * Mock 关键词数据
 */
export const mockKeywords = {
  // 完整的30个关键词（满足优先级分布）
  complete: [
    // Brand (8)
    { keyword: 'eufy', searchVolume: 5000 },
    { keyword: 'eufy robot vacuum', searchVolume: 3000 },
    { keyword: 'eufy official', searchVolume: 2000 },
    { keyword: 'eufy store', searchVolume: 1500 },
    { keyword: 'eufy amazon', searchVolume: 1200 },
    { keyword: 'eufy online', searchVolume: 1000 },
    { keyword: 'buy eufy', searchVolume: 800 },
    { keyword: 'eufy authentic', searchVolume: 600 },
    // Core (8)
    { keyword: 'robot vacuum', searchVolume: 8000 },
    { keyword: 'smart vacuum', searchVolume: 5000 },
    { keyword: 'automated cleaning', searchVolume: 3000 },
    { keyword: 'robot cleaner', searchVolume: 2500 },
    { keyword: 'vacuum robot', searchVolume: 2000 },
    { keyword: 'smart home cleaning', searchVolume: 1500 },
    { keyword: 'automatic vacuum', searchVolume: 1200 },
    { keyword: 'robotic vacuum cleaner', searchVolume: 1000 },
    // Intent (5)
    { keyword: 'best robot vacuum', searchVolume: 6000 },
    { keyword: 'cheap robot vacuum', searchVolume: 4000 },
    { keyword: 'robot vacuum for pets', searchVolume: 3000 },
    { keyword: 'affordable robot vacuum', searchVolume: 2000 },
    { keyword: 'robot vacuum sale', searchVolume: 1500 },
    // LongTail (7)
    { keyword: 'best robot vacuum for pet hair', searchVolume: 800 },
    { keyword: 'robot vacuum with app control', searchVolume: 600 },
    { keyword: 'quiet robot vacuum for small apartments', searchVolume: 500 },
    { keyword: 'robot vacuum with mopping', searchVolume: 700 },
    { keyword: 'affordable robot vacuum under 300', searchVolume: 400 },
    { keyword: 'robot vacuum with self emptying', searchVolume: 550 },
    { keyword: 'best budget robot vacuum 2024', searchVolume: 450 }
  ],

  // 不完整的关键词（缺少某些优先级）
  incomplete: [
    { keyword: 'eufy', searchVolume: 5000 },
    { keyword: 'eufy robot vacuum', searchVolume: 3000 },
    { keyword: 'robot vacuum', searchVolume: 8000 },
    { keyword: 'smart vacuum', searchVolume: 5000 },
    { keyword: 'best robot vacuum', searchVolume: 6000 },
    { keyword: 'cheap robot vacuum', searchVolume: 4000 },
    { keyword: 'best robot vacuum for pet hair', searchVolume: 800 },
    { keyword: 'robot vacuum with app control', searchVolume: 600 }
  ],

  // 低搜索量的关键词
  lowVolume: [
    { keyword: 'eufy xyz', searchVolume: 50 },
    { keyword: 'eufy abc', searchVolume: 30 },
    { keyword: 'robot vacuum xyz', searchVolume: 40 },
    { keyword: 'smart vacuum abc', searchVolume: 20 }
  ]
}

/**
 * Mock 创意数据
 */
export const mockCreatives = {
  complete: {
    headlines: mockHeadlines.complete.map((text, index) => ({
      text,
      pinned: false,
      pinnedField: null as any
    })) as HeadlineAsset[],
    descriptions: mockDescriptions.complete.map((text, index) => ({
      text,
      pinned: false,
      pinnedField: null as any
    })) as DescriptionAsset[],
    keywords: mockKeywords.complete,
    callouts: [
      'Free Shipping',
      '30-Day Returns',
      'Prime Eligible',
      'Award Winner'
    ],
    sitelinks: [
      { text: 'Shop Vacuums', description: 'Browse our full collection' },
      { text: 'Robot Vacuums', description: 'Smart cleaning solutions' },
      { text: 'Deals & Offers', description: 'Save on select items' },
      { text: 'Customer Reviews', description: 'See what customers say' },
      { text: 'Support & Help', description: 'Get answers to questions' },
      { text: 'About Us', description: 'Learn our story' }
    ]
  } as GeneratedAdCreativeData,

  incomplete: {
    headlines: mockHeadlines.incomplete.map((text, index) => ({
      text,
      pinned: false,
      pinnedField: null as any
    })) as HeadlineAsset[],
    descriptions: mockDescriptions.incomplete.map((text, index) => ({
      text,
      pinned: false,
      pinnedField: null as any
    })) as DescriptionAsset[],
    keywords: mockKeywords.incomplete,
    callouts: ['Free Shipping', '30-Day Returns'],
    sitelinks: [
      { text: 'Shop Vacuums', description: 'Browse our collection' },
      { text: 'Robot Vacuums', description: 'Smart solutions' }
    ]
  } as GeneratedAdCreativeData
}

/**
 * 计算两个字符串的相似度（简单版本）
 */
export function calculateSimpleSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()

  if (s1 === s2) return 1

  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.length === 0) return 1

  const editDistance = getEditDistance(longer, shorter)
  return (longer.length - editDistance) / longer.length
}

/**
 * 计算编辑距离
 */
function getEditDistance(s1: string, s2: string): number {
  const costs: number[] = []

  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[s2.length] = lastValue
  }

  return costs[s2.length]
}

/**
 * 生成随机标题
 */
export function generateRandomHeadline(): string {
  const prefixes = ['Official', 'Trusted', 'Best', 'Premium', 'Smart']
  const brands = ['Eufy', 'Product', 'Brand', 'Store', 'Shop']
  const suffixes = ['Today', 'Now', 'Sale', 'Deal', 'Offer']

  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
  const brand = brands[Math.floor(Math.random() * brands.length)]
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)]

  return `${prefix} ${brand} ${suffix}`
}

/**
 * 生成随机描述
 */
export function generateRandomDescription(): string {
  const descriptions = [
    'High quality product with great features.',
    'Fast shipping and easy returns available.',
    'Trusted by thousands of happy customers.',
    'Save money with our special offers today.',
    'Premium quality at affordable prices.'
  ]

  return descriptions[Math.floor(Math.random() * descriptions.length)]
}

/**
 * 生成随机关键词
 */
export function generateRandomKeyword(): { keyword: string; searchVolume: number } {
  const keywords = ['product', 'buy', 'shop', 'sale', 'deal', 'offer', 'best', 'cheap']
  const keyword = keywords[Math.floor(Math.random() * keywords.length)]
  const searchVolume = Math.floor(Math.random() * 5000) + 100

  return { keyword, searchVolume }
}

/**
 * 延迟函数（用于异步测试）
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 性能测试计时器
 */
export class PerformanceTimer {
  private startTime: number = 0
  private endTime: number = 0

  start(): void {
    this.startTime = performance.now()
  }

  end(): void {
    this.endTime = performance.now()
  }

  getDuration(): number {
    return this.endTime - this.startTime
  }

  getFormattedDuration(): string {
    const duration = this.getDuration()
    if (duration < 1) {
      return `${(duration * 1000).toFixed(2)}µs`
    } else if (duration < 1000) {
      return `${duration.toFixed(2)}ms`
    } else {
      return `${(duration / 1000).toFixed(2)}s`
    }
  }
}

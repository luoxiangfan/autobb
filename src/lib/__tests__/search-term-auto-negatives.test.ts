import {
  getSearchTermAutoNegativeConfigFromEnv,
  getSearchTermAutoPositiveConfigFromEnv,
  isDuplicateKeywordErrorMessage,
} from '../search-term-auto-negatives'

describe('search-term-auto-negatives', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('识别明确重复关键词错误', () => {
    expect(isDuplicateKeywordErrorMessage('Ad group criterion already exists')).toBe(true)
    expect(isDuplicateKeywordErrorMessage('DUPLICATE keyword in ad group')).toBe(true)
  })

  it('不把通用criterion错误误判为重复', () => {
    expect(
      isDuplicateKeywordErrorMessage(
        'CriterionError.INVALID_KEYWORD_TEXT'
      )
    ).toBe(false)
    expect(
      isDuplicateKeywordErrorMessage(
        'AuthorizationError.CUSTOMER_NOT_ENABLED'
      )
    ).toBe(false)
  })

  it('环境变量解析：非法值回退默认值', () => {
    process.env.AUTO_SEARCH_TERM_NEGATIVE_LOOKBACK_DAYS = '-1'
    process.env.AUTO_SEARCH_TERM_NEGATIVE_MIN_CLICKS = '0'
    process.env.AUTO_SEARCH_TERM_NEGATIVE_MIN_COST = 'abc'
    process.env.AUTO_SEARCH_TERM_NEGATIVE_MAX_PER_ADGROUP = ''
    process.env.AUTO_SEARCH_TERM_NEGATIVE_MAX_PER_USER = '999'

    const config = getSearchTermAutoNegativeConfigFromEnv()
    expect(config.lookbackDays).toBe(30)
    expect(config.minClicks).toBe(2)
    expect(config.minCost).toBe(1)
    expect(config.maxPerAdGroup).toBe(2)
    expect(config.maxPerUser).toBe(999)
  })

  it('正向加词环境变量解析：非法值回退默认值', () => {
    process.env.AUTO_SEARCH_TERM_POSITIVE_LOOKBACK_DAYS = '0'
    process.env.AUTO_SEARCH_TERM_POSITIVE_MIN_CLICKS = '-5'
    process.env.AUTO_SEARCH_TERM_POSITIVE_MIN_CONVERSIONS = 'abc'
    process.env.AUTO_SEARCH_TERM_POSITIVE_MAX_PER_ADGROUP = ''
    process.env.AUTO_SEARCH_TERM_POSITIVE_MAX_PER_USER = '8'

    const config = getSearchTermAutoPositiveConfigFromEnv()
    expect(config.lookbackDays).toBe(30)
    expect(config.minClicks).toBe(3)
    expect(config.minConversions).toBe(1)
    expect(config.maxPerAdGroup).toBe(1)
    expect(config.maxPerUser).toBe(8)
  })
})

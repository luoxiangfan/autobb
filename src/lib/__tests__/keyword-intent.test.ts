import {
  classifyKeywordIntent,
  isHardNegativeIntent,
  recommendMatchTypeForKeyword,
} from '../keyword-intent'

describe('keyword-intent', () => {
  it('classifies review/vs terms as commercial (non-hard-negative)', () => {
    const result = classifyKeywordIntent('eufy camera review vs ring')

    expect(result.intent).toBe('COMMERCIAL')
    expect(result.hardNegative).toBe(false)
  })

  it('classifies transactional price/deal terms as transactional', () => {
    const result = classifyKeywordIntent('eufy camera discount price')

    expect(result.intent).toBe('TRANSACTIONAL')
    expect(result.hardNegative).toBe(false)
  })

  it('classifies support/login/manual as hard-negative support intent', () => {
    const result = classifyKeywordIntent('eufy app login manual setup')

    expect(result.intent).toBe('SUPPORT')
    expect(result.hardNegative).toBe(true)
    expect(isHardNegativeIntent(result.intent)).toBe(true)
  })

  it('classifies piracy keywords as hard-negative piracy intent', () => {
    const result = classifyKeywordIntent('download cracked app torrent')

    expect(result.intent).toBe('PIRACY')
    expect(result.hardNegative).toBe(true)
  })

  it('does not misclassify legitimate product phrases like video doorbell', () => {
    const result = classifyKeywordIntent('video doorbell camera')

    expect(result.intent).toBe('OTHER')
    expect(result.hardNegative).toBe(false)
  })

  it('classifies visual-asset and sizing lookups as hard-negative support intent', () => {
    const visual = classifyKeywordIntent('running girl gif purchase')
    const sizing = classifyKeywordIntent('running girl bra size chart')

    expect(visual.intent).toBe('SUPPORT')
    expect(visual.hardNegative).toBe(true)
    expect(sizing.intent).toBe('SUPPORT')
    expect(sizing.hardNegative).toBe(true)
  })

  it('recommends exact for pure brand keyword', () => {
    const matchType = recommendMatchTypeForKeyword({
      keyword: 'eufy',
      brandName: 'Eufy',
      intent: 'TRANSACTIONAL',
    })

    expect(matchType).toBe('EXACT')
  })

  it('recommends phrase for transactional/commercial keywords', () => {
    const transactional = recommendMatchTypeForKeyword({
      keyword: 'buy eufy camera',
      brandName: 'Eufy',
      intent: 'TRANSACTIONAL',
    })
    const commercial = recommendMatchTypeForKeyword({
      keyword: 'best home security camera',
      brandName: 'Eufy',
      intent: 'COMMERCIAL',
    })

    expect(transactional).toBe('PHRASE')
    expect(commercial).toBe('PHRASE')
  })

  it('recommends phrase for generic other intent keywords', () => {
    const matchType = recommendMatchTypeForKeyword({
      keyword: 'wireless outdoor camera',
      brandName: 'Eufy',
      intent: 'OTHER',
    })

    expect(matchType).toBe('PHRASE')
  })

  it('supports transactional intent classification for spanish language', () => {
    const result = classifyKeywordIntent('comprar filtro industrial proveedor', {
      language: 'es',
    })

    expect(result.intent).toBe('TRANSACTIONAL')
    expect(result.hardNegative).toBe(false)
  })

  it('supports support intent hard-negative for french locale code', () => {
    const result = classifyKeywordIntent('manuel installation et réparation', {
      language: 'fr-FR',
    })

    expect(result.intent).toBe('SUPPORT')
    expect(result.hardNegative).toBe(true)
  })

  it('supports jobs intent hard-negative for chinese keywords', () => {
    const result = classifyKeywordIntent('工业过滤器 招聘 岗位', {
      language: 'zh-CN',
    })

    expect(result.intent).toBe('JOBS')
    expect(result.hardNegative).toBe(true)
  })
})

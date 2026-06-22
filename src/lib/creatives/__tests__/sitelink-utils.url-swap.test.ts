import { describe, expect, it } from 'vitest'
import { formatSitelinkForPublish, splitUrlBaseAndSuffix } from '@/lib/creatives/sitelink-utils'

describe('splitUrlBaseAndSuffix', () => {
  it('splits origin, path and query', () => {
    expect(splitUrlBaseAndSuffix('https://shop.example.com/dp/B001?tag=abc&cid=1')).toEqual({
      base: 'https://shop.example.com/dp/B001',
      suffix: 'tag=abc&cid=1',
    })
  })

  it('returns empty suffix when query is absent', () => {
    expect(splitUrlBaseAndSuffix('https://shop.example.com/store')).toEqual({
      base: 'https://shop.example.com/store',
      suffix: '',
    })
  })
})

describe('formatSitelinkForPublish', () => {
  it('passes through finalUrlSuffix when set', () => {
    expect(
      formatSitelinkForPublish({
        text: 'Series A',
        url: 'https://shop.example.com/series/a',
        finalUrlSuffix: 'tag=abc',
      })
    ).toEqual({
      text: 'Series A',
      url: 'https://shop.example.com/series/a',
      finalUrlSuffix: 'tag=abc',
    })
  })
})

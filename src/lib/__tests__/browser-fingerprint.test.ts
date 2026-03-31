import { describe, it, expect } from 'vitest'
import {
  generateRandomFingerprint,
  getFingerprintByIndex,
  getUserAgentPoolSize,
  getAllUserAgents,
} from '../browser-fingerprint'

describe('Browser Fingerprint', () => {
  describe('generateRandomFingerprint', () => {
    it('should generate a valid fingerprint', () => {
      const fingerprint = generateRandomFingerprint()

      expect(fingerprint).toHaveProperty('userAgent')
      expect(fingerprint).toHaveProperty('platform')
      expect(fingerprint).toHaveProperty('vendor')
      expect(fingerprint).toHaveProperty('language')
      expect(fingerprint).toHaveProperty('acceptLanguage')
      expect(fingerprint).toHaveProperty('accept')

      expect(typeof fingerprint.userAgent).toBe('string')
      expect(fingerprint.userAgent.length).toBeGreaterThan(0)
    })

    it('should generate different fingerprints on multiple calls', () => {
      const fingerprints = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const fingerprint = generateRandomFingerprint()
        fingerprints.add(fingerprint.userAgent)
      }

      // 至少应该有 2 个不同的 User-Agent
      expect(fingerprints.size).toBeGreaterThanOrEqual(2)
    })

    it('should have matching platform and vendor for User-Agent', () => {
      const fingerprint = generateRandomFingerprint()

      if (fingerprint.userAgent.includes('Windows')) {
        expect(fingerprint.platform).toBe('Win32')
      } else if (fingerprint.userAgent.includes('Macintosh')) {
        expect(fingerprint.platform).toBe('MacIntel')
      }

      if (fingerprint.userAgent.includes('Chrome/') && !fingerprint.userAgent.includes('Edg/')) {
        expect(fingerprint.vendor).toBe('Google Inc.')
      } else if (fingerprint.userAgent.includes('Safari/') && !fingerprint.userAgent.includes('Chrome/')) {
        expect(fingerprint.vendor).toBe('Apple Computer, Inc.')
      }
    })
  })

  describe('getFingerprintByIndex', () => {
    it('should return consistent fingerprint for same index', () => {
      const fingerprint1 = getFingerprintByIndex(0)
      const fingerprint2 = getFingerprintByIndex(0)

      expect(fingerprint1.userAgent).toBe(fingerprint2.userAgent)
      expect(fingerprint1.platform).toBe(fingerprint2.platform)
      expect(fingerprint1.vendor).toBe(fingerprint2.vendor)
    })

    it('should wrap around when index exceeds pool size', () => {
      const poolSize = getUserAgentPoolSize()
      const fingerprint1 = getFingerprintByIndex(0)
      const fingerprint2 = getFingerprintByIndex(poolSize)

      expect(fingerprint1.userAgent).toBe(fingerprint2.userAgent)
    })
  })

  describe('getUserAgentPoolSize', () => {
    it('should return a positive number', () => {
      const size = getUserAgentPoolSize()
      expect(size).toBeGreaterThan(0)
    })
  })

  describe('getAllUserAgents', () => {
    it('should return an array of User-Agents', () => {
      const userAgents = getAllUserAgents()

      expect(Array.isArray(userAgents)).toBe(true)
      expect(userAgents.length).toBeGreaterThan(0)

      userAgents.forEach((ua) => {
        expect(typeof ua).toBe('string')
        expect(ua.length).toBeGreaterThan(0)
        expect(ua).toMatch(/Mozilla\/5\.0/)
      })
    })

    it('should include various browser types', () => {
      const userAgents = getAllUserAgents()
      const hasChrome = userAgents.some((ua) => ua.includes('Chrome/'))
      const hasSafari = userAgents.some((ua) => ua.includes('Safari/'))
      const hasFirefox = userAgents.some((ua) => ua.includes('Firefox/'))

      expect(hasChrome).toBe(true)
      expect(hasSafari).toBe(true)
      expect(hasFirefox).toBe(true)
    })
  })
})

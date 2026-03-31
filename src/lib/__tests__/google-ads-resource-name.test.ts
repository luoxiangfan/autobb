import { describe, it, expect } from 'vitest'
import { extractCustomerIdFromResourceName } from '../google-ads-resource-name'

describe('extractCustomerIdFromResourceName', () => {
  it('extracts customer id from resource name', () => {
    expect(extractCustomerIdFromResourceName('customers/1234567890/accountBudgets/111')).toBe('1234567890')
  })

  it('returns null for invalid inputs', () => {
    expect(extractCustomerIdFromResourceName(null)).toBeNull()
    expect(extractCustomerIdFromResourceName(undefined)).toBeNull()
    expect(extractCustomerIdFromResourceName('not-a-resource-name')).toBeNull()
  })
})


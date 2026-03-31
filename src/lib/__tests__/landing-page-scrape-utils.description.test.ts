import { describe, it, expect } from 'vitest'
import { load } from 'cheerio'
import { extractLandingDescription } from '@/lib/landing-page-scrape-utils'

describe('extractLandingDescription', () => {
  it('prefers meta description over navigation/account body text', () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Shop Boscovs.com for great values on Apparel and Shoes for the entire family." />
        </head>
        <body>
          <div>About Me | Saved Addresses | Order History | Boscovs | My Account | Sign In | Wishlist</div>
          <div>Real content block mentioning Boscovs that should not be used when a good meta description exists.</div>
        </body>
      </html>
    `
    const $ = load(html)
    expect(extractLandingDescription({ $, productName: 'Boscovs' })).toBe(
      'Shop Boscovs.com for great values on Apparel and Shoes for the entire family.'
    )
  })

  it('filters blocked-page descriptions (Access Denied)', () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Access Denied - You don't have permission to access this page on this server." />
        </head>
        <body></body>
      </html>
    `
    const $ = load(html)
    expect(extractLandingDescription({ $, productName: 'BJs' })).toBeNull()
  })

  it('falls back to a meaningful body block and filters navigation/account menus', () => {
    const html = `
      <html>
        <body>
          <div>About Me | Saved Addresses | Order History | Boscovs | My Account | Sign In | Wishlist</div>
          <div>
            Boscovs is a department store offering apparel, shoes, home goods, and more at great values for the whole family.
          </div>
        </body>
      </html>
    `
    const $ = load(html)
    expect(extractLandingDescription({ $, productName: 'Boscovs' })).toBe(
      'Boscovs is a department store offering apparel, shoes, home goods, and more at great values for the whole family.'
    )
  })

  it('returns null when only navigation/account snippets are present', () => {
    const html = `
      <html>
        <body>
          <div>About Me | Saved Addresses | Order History | Boscovs | My Account | Sign In | Wishlist</div>
        </body>
      </html>
    `
    const $ = load(html)
    expect(extractLandingDescription({ $, productName: 'Boscovs' })).toBeNull()
  })
})

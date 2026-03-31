const AFFILIATE_LINK_SCHEME = /^https?:\/\//i

const stripWhitespace = (value: string): string => value.replace(/\s+/g, '')

const mergeLinkFragments = (fragments: string[]): string[] => {
  const merged: string[] = []

  for (const fragment of fragments) {
    const cleaned = stripWhitespace(fragment)
    if (!cleaned) continue

    if (AFFILIATE_LINK_SCHEME.test(cleaned)) {
      merged.push(cleaned)
      continue
    }

    if (merged.length > 0) {
      merged[merged.length - 1] += cleaned
      continue
    }

    merged.push(cleaned)
  }

  return merged
}

export const normalizeAffiliateLinksInput = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []

  const fragments = input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  return mergeLinkFragments(fragments)
}

export const parseAffiliateLinksText = (text: string): string[] => {
  const fragments = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return mergeLinkFragments(fragments)
}

export const findInvalidAffiliateLinks = (links: string[]): string[] => (
  links.filter((link) => !AFFILIATE_LINK_SCHEME.test(link))
)

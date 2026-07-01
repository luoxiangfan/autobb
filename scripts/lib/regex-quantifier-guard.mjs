/** Detects corrupted regex quantifiers like `{2 }` (space before `}`). */
export const BROKEN_REGEX_QUANTIFIER_RE = /\{\d+\s+\}/g

export function findBrokenRegexQuantifiers(text) {
  return [...String(text ?? '').matchAll(BROKEN_REGEX_QUANTIFIER_RE)].map((match) => match[0])
}

export function countBrokenRegexQuantifiers(text) {
  return findBrokenRegexQuantifiers(text).length
}

const QUANTIFIER_PLACEHOLDER_PREFIX = '__REGEX_QUANT_'

/** Preserve `{n}` / `{n,}` / `{n,m}` tokens while mutating comment text. */
export function maskRegexQuantifiers(text) {
  let index = 0
  const tokens = []
  const masked = String(text ?? '').replace(/\{\d+(?:,\d*)?\}/g, (match) => {
    const token = `${QUANTIFIER_PLACEHOLDER_PREFIX}${index++}__`
    tokens.push({ token, value: match })
    return token
  })
  return { masked, tokens }
}

export function unmaskRegexQuantifiers(text, tokens) {
  let result = String(text ?? '')
  for (const { token, value } of tokens) {
    result = result.replaceAll(token, value)
  }
  return result
}

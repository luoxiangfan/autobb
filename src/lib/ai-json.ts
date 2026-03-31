export function repairJsonText(input: string): string {
  let text = input.trim()
  if (!text) return text

  text = text.replace(/^\uFEFF/, '')
  text = text.replace(/,\s*([}\]])/g, '$1')
  text = text.replace(/[“”]/g, '"')
  text = text.replace(/[‘’]/g, "'")
  text = text.replace(/:\s*=/g, ':')
  text = text.replace(/=\s*:/g, ':')

  text = quoteUnquotedKeys(text)
  text = convertSingleQuotedStrings(text)
  text = escapeUnescapedNewlines(text)
  text = escapeUnescapedQuotesInStrings(text)
  text = insertMissingCommas(text)

  return text
}

function escapeUnescapedNewlines(input: string): string {
  let output = ''
  let inString = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escape) {
      output += ch
      escape = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        output += ch
        escape = true
        continue
      }
      if (ch === '"') {
        inString = false
        output += ch
        continue
      }
      if (ch === '\n' || ch === '\r') {
        // Replace raw newlines inside strings with a space to keep JSON valid.
        if (ch === '\r' && input[i + 1] === '\n') {
          i += 1
        }
        output += ' '
        continue
      }
      output += ch
      continue
    }

    if (ch === '"') {
      inString = true
      output += ch
      continue
    }

    output += ch
  }

  return output
}

function escapeUnescapedQuotesInStrings(input: string): string {
  let output = ''
  let inString = false
  let escape = false

  const findNextNonWhitespace = (start: number): string | null => {
    for (let i = start; i < input.length; i++) {
      const ch = input[i]
      if (!/\s/.test(ch)) return ch
    }
    return null
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escape) {
      output += ch
      escape = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        output += ch
        escape = true
        continue
      }

      if (ch === '"') {
        const next = findNextNonWhitespace(i + 1)
        if (!next || next === ':' || next === ',' || next === '}' || next === ']') {
          inString = false
          output += ch
          continue
        }

        // Likely a missing comma or nested structure; treat as closing quote.
        if (next === '{' || next === '[' || next === '"' || /[-0-9tfn]/i.test(next)) {
          inString = false
          output += ch
          continue
        }

        // Otherwise escape the quote to keep the string valid.
        output += '\\"'
        continue
      }

      output += ch
      continue
    }

    if (ch === '"') {
      inString = true
      output += ch
      continue
    }

    output += ch
  }

  return output
}

function insertMissingCommas(input: string): string {
  let output = ''
  let inString = false
  let escape = false
  let lastNonWhitespace = ''

  const isValueStart = (ch: string): boolean =>
    ch === '"' || ch === '{' || ch === '[' || ch === '-' || /[0-9tfn]/i.test(ch)

  const shouldInsertComma = (prev: string): boolean => {
    if (!prev) return false
    if (prev === ',' || prev === ':' || prev === '{' || prev === '[') return false
    return prev === '"' || prev === '}' || prev === ']'
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      if (escape) {
        output += ch
        escape = false
        continue
      }
      if (ch === '\\') {
        output += ch
        escape = true
        continue
      }
      output += ch
      if (ch === '"') {
        inString = false
        lastNonWhitespace = '"'
      }
      continue
    }

    if (ch === '"') {
      if (shouldInsertComma(lastNonWhitespace)) {
        output += ','
      }
      output += ch
      inString = true
      lastNonWhitespace = '"'
      continue
    }

    if (/\s/.test(ch)) {
      output += ch
      continue
    }

    if (isValueStart(ch) && shouldInsertComma(lastNonWhitespace)) {
      output += ','
    }

    output += ch
    lastNonWhitespace = ch
  }

  return output
}

function quoteUnquotedKeys(input: string): string {
  let output = ''
  let inSingle = false
  let inDouble = false
  let escape = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (escape) {
      output += ch
      escape = false
      i += 1
      continue
    }

    if (inSingle) {
      if (ch === '\\') {
        output += ch
        escape = true
        i += 1
        continue
      }
      if (ch === "'") {
        inSingle = false
        output += ch
        i += 1
        continue
      }
      output += ch
      i += 1
      continue
    }

    if (inDouble) {
      if (ch === '\\') {
        output += ch
        escape = true
        i += 1
        continue
      }
      if (ch === '"') {
        inDouble = false
        output += ch
        i += 1
        continue
      }
      output += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inDouble = true
      output += ch
      i += 1
      continue
    }

    if (ch === "'") {
      inSingle = true
      output += ch
      i += 1
      continue
    }

    if (ch === '{' || ch === ',') {
      output += ch

      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) {
        j += 1
      }

      if (j < input.length && /[A-Za-z0-9_]/.test(input[j])) {
        let k = j
        while (k < input.length && /[A-Za-z0-9_]/.test(input[k])) {
          k += 1
        }

        let l = k
        while (l < input.length && /\s/.test(input[l])) {
          l += 1
        }

        if (l < input.length && input[l] === ':') {
          // Only quote keys outside strings to avoid breaking tokens like "{KeyWord:...}".
          output += input.slice(i + 1, j)
          output += `"${input.slice(j, k)}"`
          output += input.slice(k, l)
          output += ':'
          i = l + 1
          continue
        }
      }

      i += 1
      continue
    }

    output += ch
    i += 1
  }

  return output
}

function convertSingleQuotedStrings(input: string): string {
  let output = ''
  let inSingle = false
  let inDouble = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escape) {
      if (inSingle && ch === "'") {
        output += "'"
      } else {
        output += '\\' + ch
      }
      escape = false
      continue
    }

    if (ch === '\\' && (inSingle || inDouble)) {
      escape = true
      continue
    }

    if (inSingle && ch === '"') {
      output += '\\"'
      continue
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble
      output += ch
      continue
    }

    if (!inDouble && ch === "'") {
      inSingle = !inSingle
      output += '"'
      continue
    }

    output += ch
  }

  if (escape) {
    output += '\\'
  }

  return output
}

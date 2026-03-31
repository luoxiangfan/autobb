/**
 * Split SQL text into top-level statements.
 *
 * Supports:
 * - SQLite: `CREATE TRIGGER ... BEGIN ... END;` blocks (do not split on inner semicolons)
 * - PostgreSQL: dollar-quoted blocks (`$$`, `$tag$`) such as `DO $$ ... $$;` or function bodies
 * - Quotes: avoids splitting on semicolons inside string/identifier quotes
 * - Comments: ignores `--` line comments and block comments (slash-star ... star-slash)
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''

  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  let inDollarBlock = false
  let dollarTag = ''

  let inTrigger = false

  const pushCurrent = () => {
    const trimmed = current.trim()
    if (trimmed) statements.push(trimmed)
    current = ''
    inTrigger = false
  }

  const endsWithTriggerEnd = (text: string): boolean => {
    const withoutTrailing = text.replace(/[\s;]*$/g, '')
    return /\bEND\b\s*$/i.test(withoutTrailing)
  }

  const maybeEnterTrigger = () => {
    if (inTrigger) return
    const prefix = current.trimStart().slice(0, 80).toUpperCase()
    if (prefix.startsWith('CREATE TRIGGER') || prefix.startsWith('CREATE TEMP TRIGGER')) {
      inTrigger = true
    }
  }

  const tryConsumeDollarTag = (source: string, startIndex: number): { tag: string; endIndex: number } | null => {
    // source[startIndex] is '$'
    let tag = '$'
    let j = startIndex + 1
    while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) {
      tag += source[j]
      j++
    }
    if (j < source.length && source[j] === '$') {
      tag += '$'
      return { tag, endIndex: j + 1 }
    }
    return null
  }

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        // Preserve newlines to avoid accidental token concatenation (cosmetic).
        current += ch
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }

    // Comment start (only when not in any quote or dollar block)
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inDollarBlock) {
      if (ch === '-' && next === '-') {
        inLineComment = true
        i++
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }
    }

    // Dollar-quoted blocks (PostgreSQL)
    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (ch === '$') {
        const consumed = tryConsumeDollarTag(sql, i)
        if (consumed) {
          if (!inDollarBlock) {
            inDollarBlock = true
            dollarTag = consumed.tag
            current += consumed.tag
            i = consumed.endIndex - 1
            continue
          }
          if (inDollarBlock && consumed.tag === dollarTag) {
            inDollarBlock = false
            current += consumed.tag
            i = consumed.endIndex - 1
            dollarTag = ''
            continue
          }
        }
      }
    }

    // Inside dollar blocks: keep everything verbatim (including semicolons)
    if (inDollarBlock) {
      current += ch
      continue
    }

    // Quote toggle (handle escaped single quote '' inside string)
    if (!inDoubleQuote && !inBacktick) {
      if (ch === '\'' && !inSingleQuote) {
        inSingleQuote = true
      } else if (ch === '\'' && inSingleQuote) {
        if (next === '\'') {
          current += ch + next
          i++
          continue
        }
        inSingleQuote = false
      }
    }

    if (!inSingleQuote && !inBacktick) {
      if (ch === '"' && !inDoubleQuote) inDoubleQuote = true
      else if (ch === '"' && inDoubleQuote) inDoubleQuote = false
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '`' && !inBacktick) inBacktick = true
      else if (ch === '`' && inBacktick) inBacktick = false
    }

    current += ch
    maybeEnterTrigger()

    // Statement delimiter
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && ch === ';') {
      if (inTrigger) {
        if (endsWithTriggerEnd(current)) pushCurrent()
      } else {
        pushCurrent()
      }
    }
  }

  if (current.trim()) statements.push(current.trim())
  return statements
}

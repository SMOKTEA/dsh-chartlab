/**
 * Normalize a possibly multi-line SQL fragment into one valid single-line
 * statement. Used by the chart view's SQL box: pasted multi-line queries are
 * collapsed so the editable preview and the structured-filter parser both see
 * one clean line.
 *
 * The function is intentionally SELF-CONTAINED (no imports, no outer-scope
 * references): the view page embeds its source via `toString()` so the browser
 * runs exactly the code these tests exercise.
 *
 * Rules:
 * - Line comments (double-dash to end of line) and block comments (slash-star ...
 *   star-slash) are stripped, string-literal aware: a value like 'a--b' or
 *   'a slash-star b star-slash c' survives untouched, including doubled-quote
 *   escapes.
 * - Runs of whitespace (spaces, tabs, newlines, CRLF) fold into a single space.
 * - String literals / quoted identifiers are copied verbatim (a newline inside
 *   one is part of the value and is preserved).
 * - Leading/trailing whitespace is trimmed.
 */

export function normalizeSqlSingleLine(sql: string): string {
  const out: string[] = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === "'" || c === '"') {
      // quoted literal / identifier (doubled quote escapes, e.g. 'it''s') — verbatim
      const start = i
      const quote = c
      i++
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      out.push(sql.slice(start, i))
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < n - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i = Math.min(n, i + 2)
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (out.length > 0 && out[out.length - 1] !== ' ') out.push(' ')
      i++
      continue
    }
    out.push(c)
    i++
  }
  return out.join('').trim()
}

/**
 * DuckDB-backed SQL execution over a chart's source data (CSV file or DuckDB
 * database table).
 *
 * The plugin loads duckdb lazily (dynamic import) so the plugin itself boots
 * even if the native module is unavailable; only SQL routes/tools fail then.
 *
 * SQL safety: only SELECT / WITH statements are allowed, a small statement
 * denylist guards against destructive/privileged statements, and results are
 * capped so the response stays bounded.
 */

import { resolve } from 'node:path'
import type { Column } from './csv.js'

export interface SqlResult {
  columns: Column[]
  rowCount: number
  data: Record<string, Float64Array | string[]>
  truncated: boolean
}

/** Where a chart's rows come from, for SQL re-execution. */
export type SqlSource =
  | { kind: 'csv'; path: string }
  | { kind: 'duckdb'; path: string; table: string }

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|COPY|PRAGMA|CALL|EXPORT|IMPORT|INSTALL|LOAD|SET|TRUNCATE|VACUUM|GRANT|REVOKE)\b/i

/** v1: row filtering only — aggregation / sorting / grouping are roadmap items. */
const AGGREGATE =
  /\b(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|DISTINCT|SUM|AVG|MIN|MAX|COUNT|date_trunc|WINDOW|OVER|JOIN|UNION|EXCEPT|INTERSECT|FILTER)\b/i

const RESULT_CAP = 200_000

/** Validate the user SQL; returns an error message or null when OK. */
export function validateSql(sql: string): string | null {
  const cleaned = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (cleaned === '') return 'empty query'
  if (!/^(SELECT|WITH)\b/i.test(cleaned)) return 'only SELECT / WITH queries are allowed'
  if (FORBIDDEN.test(cleaned)) return 'query contains a forbidden statement'
  if (AGGREGATE.test(cleaned)) {
    return 'v1 仅支持行筛选（SELECT … WHERE …）：聚合、分组、排序、LIMIT 属于二次处理，暂不支持（见 roadmap）'
  }
  const semis = cleaned.match(/;/g) ?? []
  if (semis.length > 1) return 'only a single statement is allowed'
  return null
}

export function convValue(v: unknown, type: Column['type']): number | string {
  if (v === null || v === undefined) return type === 'string' ? '' : Number.NaN
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return type === 'string' ? v.toISOString() : v.getTime()
  if (type === 'number') return typeof v === 'number' ? v : Number(v)
  if (type === 'date') return typeof v === 'number' ? v : new Date(v as string | number).getTime()
  return String(v)
}

function inferColumnType(values: unknown[]): Column['type'] {
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (v instanceof Date) return 'date'
    if (typeof v === 'bigint') return 'number'
    if (typeof v === 'number') return 'number'
    if (typeof v === 'boolean') return 'number'
    return 'string'
  }
  return 'number'
}

/**
 * Convert DuckDB result rows into the columnar shape every chart route uses.
 * Shared by the SQL route and the DuckDB table data source.
 */
export function rowsToColumnar(rows: Array<Record<string, unknown>>): {
  columns: Column[]
  rowCount: number
  data: Record<string, Float64Array | string[]>
} {
  if (rows.length === 0) return { columns: [], rowCount: 0, data: {} }
  const names = Object.keys(rows[0])
  const columns: Column[] = []
  const data: Record<string, Float64Array | string[]> = {}
  for (const name of names) {
    const raw = rows.map((r) => r[name])
    const type = inferColumnType(raw)
    columns.push({ name, type })
    if (type === 'string') {
      data[name] = raw.map((v) => convValue(v, 'string') as string)
    } else {
      const arr = new Float64Array(raw.length)
      for (let i = 0; i < raw.length; i++) arr[i] = convValue(raw[i], type) as number
      data[name] = arr
    }
  }
  return { columns, rowCount: rows.length, data }
}

/**
 * Run a SELECT query against a chart's source and return columnar results.
 * The source table/CSV is exposed to the query as CTE `dsh_data`.
 */
export async function runSql(source: SqlSource, sql: string): Promise<SqlResult> {
  const guard = validateSql(sql)
  if (guard) throw new Error(guard)

  const duckdb = (await import('duckdb')).default
  const db =
    source.kind === 'csv'
      ? new duckdb.Database(':memory:')
      : new duckdb.Database(source.path, duckdb.OPEN_READONLY)
  try {
    let base: string
    if (source.kind === 'csv') {
      const path2 = resolve(source.path).replace(/\\/g, '/')
      base = `read_csv_auto('${path2.replace(/'/g, "''")}')`
    } else {
      base = `"${source.table.replace(/"/g, '""')}"`
    }
    const trimmed = sql.trim()
    const isWith = /^\s*WITH\b/i.test(trimmed)
    const body = isWith ? trimmed.replace(/^\s*WITH\b/i, '').trim() : trimmed
    // Always expose the data as CTE `dsh_data`; splice the user's own WITH chain in.
    const query = isWith
      ? `WITH dsh_data AS (SELECT * FROM ${base}), ${body}`
      : `WITH dsh_data AS (SELECT * FROM ${base}) ${body}`

    const rows: unknown[] = await new Promise((resolveP, reject) => {
      db.all(query, (err: Error | null, r: unknown[]) => (err ? reject(err) : resolveP(r)))
    })
    const truncated = rows.length > RESULT_CAP
    const capped = rows.slice(0, RESULT_CAP)
    const { columns, rowCount, data } = rowsToColumnar(capped as Array<Record<string, unknown>>)
    return { columns, rowCount, data, truncated }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

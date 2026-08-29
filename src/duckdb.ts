/**
 * DuckDB database file data source.
 *
 * Opens a `.duckdb` / `.ddb` database read-only, lists its tables, and reads
 * one table into the same columnar `ChartPayload` shape as the CSV source, so
 * every downstream route (meta / groups / series / bin / sample / full, row
 * filters, windowing) works unchanged.
 *
 * The table is read with a single streaming pass (DESCRIBE for exact column
 * types + `SELECT *` chunk-by-chunk) so peak memory stays near the size of the
 * final columnar buffers instead of a per-row JS object copy — the same
 * single-pass philosophy as the CSV parser.
 *
 * `@duckdb/node-api` is loaded lazily (dynamic import) so the plugin boots even
 * when the native module is unavailable. Values are read through its JS
 * converter (`getRowObjectsJS` / `yieldRowObjectJs`), which turns DECIMAL into
 * `number`, DATE/TIMESTAMP into ISO strings, and leaves BIGINT as `bigint` —
 * all shapes `convValue` already understands.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type { ChartPayload, Column } from './csv.js'
import { suggestAxes, computePreview, sampleHead } from './csv.js'
import { convValue } from './sql.js'

export interface ReadDuckDbOptions {
  previewTarget?: number
}

/** A read-only @duckdb/node-api connection with a single close entry point. */
interface DuckDbHandle {
  conn: DuckDBConnection
  close(): void
}

/** Quote a DuckDB identifier for safe interpolation in SQL text. */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

async function openReadOnly(dbPath: string): Promise<DuckDbHandle> {
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' })
  const conn = await instance.connect()
  return {
    conn,
    close: () => {
      try {
        conn.disconnectSync()
      } catch {
        /* ignore */
      }
      try {
        instance.closeSync()
      } catch {
        /* ignore */
      }
    },
  }
}

/** Run a query and return JS-converted row objects. */
async function dbAll(db: DuckDbHandle, sql: string): Promise<Array<Record<string, unknown>>> {
  const reader = await db.conn.runAndReadAll(sql)
  return reader.getRowObjectsJS() as Array<Record<string, unknown>>
}

/** Table names in the database, sorted alphabetically (main schema only). */
export async function listDuckDbTables(dbPath: string): Promise<string[]> {
  const db = await openReadOnly(dbPath)
  try {
    const rows = await dbAll(db, 'SHOW TABLES')
    const names = rows.map((r) => String(r.name ?? Object.values(r)[0] ?? '')).filter((n) => n !== '')
    names.sort()
    return names
  } finally {
    db.close()
  }
}

/** DuckDB type name → chartlab column type (best effort; anything else is 'string'). */
function typeFromDuckDb(typeName: string): Column['type'] {
  // DESCRIBE reports parameterized types (DECIMAL(8,2), VARCHAR(10)); match the base name.
  const t = typeName.toUpperCase().replace(/\(.*\)$/, '')
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC|INT|INT2|INT4|INT8|FLOAT4|FLOAT8|BOOLEAN|BOOL)$/.test(t)) return 'number'
  if (/^(DATE|TIMESTAMP|TIMESTAMP_MS|TIMESTAMP_US|TIMESTAMP_NS|TIMESTAMPTZ)$/.test(t)) return 'date'
  return 'string'
}

/** Columnar accumulator that appends one converted cell at a time. */
function makeAccumulator(type: Column['type']): { add(v: unknown): void; data(): Float64Array | string[] } {
  if (type === 'string') {
    const strings: string[] = []
    return { add: (v) => strings.push(convValue(v, 'string') as string), data: () => strings }
  }
  const nums: number[] = []
  return { add: (v) => nums.push(convValue(v, type) as number), data: () => Float64Array.from(nums) }
}

/**
 * Read one table of a DuckDB database into a ChartPayload.
 *
 * Column types come from `DESCRIBE` (not value sniffing), then `SELECT *`
 * streams chunk-by-chunk into typed columnar buffers. An empty table therefore
 * still carries its full column metadata with zero rows.
 */
export async function readDuckDbTable(dbPath: string, table: string, options: ReadDuckDbOptions = {}): Promise<ChartPayload> {
  const previewTarget = options.previewTarget ?? 300
  const db = await openReadOnly(dbPath)
  try {
    const desc = await dbAll(db, `DESCRIBE ${quoteIdent(table)}`)
    const columns: Column[] = desc
      .map((r) => ({ name: String(r.column_name ?? ''), type: typeFromDuckDb(String(r.column_type ?? '')) }))
      .filter((c) => c.name !== '')
    if (columns.length === 0) throw new Error(`table "${table}" has no columns`)

    const accumulators = columns.map((c) => ({ name: c.name, acc: makeAccumulator(c.type) }))
    let rowCount = 0
    const result = await db.conn.stream(`SELECT * FROM ${quoteIdent(table)}`)
    for await (const batch of result.yieldRowObjectJs()) {
      for (const row of batch) {
        rowCount++
        for (const { name, acc } of accumulators) acc.add(row[name])
      }
    }

    const data: Record<string, Float64Array | string[]> = {}
    for (const { name, acc } of accumulators) data[name] = acc.data()

    const { x, y } = suggestAxes(columns)
    const preview = computePreview(data, columns, x, y, previewTarget)
    const sample = sampleHead(data, columns, 5, rowCount)
    return { columns, rowCount, data, suggestedX: x, suggestedY: y, preview, sample }
  } finally {
    db.close()
  }
}

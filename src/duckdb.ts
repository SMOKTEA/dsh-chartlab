/**
 * DuckDB database file data source.
 *
 * Opens a `.duckdb` / `.ddb` database read-only, lists its tables, and reads
 * one table into the same columnar `ChartPayload` shape as the CSV source, so
 * every downstream route (meta / groups / series / bin / sample / full, row
 * filters, windowing) works unchanged.
 *
 * duckdb is loaded lazily (dynamic import) exactly like the SQL engine, so the
 * plugin boots even when the native module is unavailable.
 */

import type { ChartPayload, Column } from './csv.js'
import { suggestAxes, computePreview, sampleHead } from './csv.js'
import { rowsToColumnar } from './sql.js'

export interface ReadDuckDbOptions {
  previewTarget?: number
}

/** Minimal duckdb-node surface the DuckDB data source needs. */
export interface DuckDbHandle {
  all(sql: string, cb: (err: Error | null, rows: unknown[]) => void): void
  close(): void
}

/** Quote a DuckDB identifier for safe interpolation in SQL text. */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

async function openReadOnly(dbPath: string): Promise<DuckDbHandle> {
  const duckdb = (await import('duckdb')).default
  const db = new duckdb.Database(dbPath, duckdb.OPEN_READONLY)
  return db as unknown as DuckDbHandle
}

function dbAll(db: DuckDbHandle, sql: string): Promise<unknown[]> {
  return new Promise((resolveP, reject) => {
    db.all(sql, (err: Error | null, rows: unknown[]) => (err ? reject(err) : resolveP(rows)))
  })
}

/** Table names in the database, sorted alphabetically (main schema only). */
export async function listDuckDbTables(dbPath: string): Promise<string[]> {
  const db = await openReadOnly(dbPath)
  try {
    const rows = (await dbAll(db, 'SHOW TABLES')) as Array<Record<string, unknown>>
    const names = rows.map((r) => String(r.name ?? Object.values(r)[0] ?? '')).filter((n) => n !== '')
    names.sort()
    return names
  } finally {
    db.close()
  }
}

/** DuckDB type name → chartlab column type (best effort; falls back to 'string'). */
function typeFromDuckDb(typeName: string): Column['type'] {
  const t = typeName.toUpperCase()
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC|INT|INT2|INT4|INT8|FLOAT4|FLOAT8)$/.test(t)) return 'number'
  if (/^(DATE|TIMESTAMP|TIMESTAMP_MS|TIMESTAMP_US|TIMESTAMP_NS|TIMESTAMPTZ|TIME)$/.test(t)) return 'date'
  return 'string'
}

/**
 * Read one table of a DuckDB database into a ChartPayload.
 * Uses `SELECT *` over the quoted table name; column types come from the
 * returned values (DuckDB DECIMAL → bigint → number, TIMESTAMP → Date → date).
 * An empty table falls back to `DESCRIBE` so its column metadata still exists.
 */
export async function readDuckDbTable(dbPath: string, table: string, options: ReadDuckDbOptions = {}): Promise<ChartPayload> {
  const previewTarget = options.previewTarget ?? 300
  const db = await openReadOnly(dbPath)
  try {
    const rows = (await dbAll(db, `SELECT * FROM ${quoteIdent(table)}`)) as Array<Record<string, unknown>>

    if (rows.length > 0) {
      const { columns, data, rowCount } = rowsToColumnar(rows)
      const { x, y } = suggestAxes(columns)
      const preview = computePreview(data, columns, x, y, previewTarget)
      const sample = sampleHead(data, columns, 5, rowCount)
      return { columns, rowCount, data, suggestedX: x, suggestedY: y, preview, sample }
    }

    // Empty table: build column metadata from DESCRIBE.
    const desc = (await dbAll(db, `DESCRIBE ${quoteIdent(table)}`)) as Array<Record<string, unknown>>
    const columns: Column[] = desc
      .map((r) => ({ name: String(r.column_name ?? ''), type: typeFromDuckDb(String(r.column_type ?? '')) }))
      .filter((c) => c.name !== '')
    if (columns.length === 0) throw new Error(`table "${table}" has no columns`)
    const data: Record<string, Float64Array | string[]> = {}
    for (const col of columns) {
      data[col.name] = col.type === 'string' ? [] : new Float64Array(0)
    }
    const { x, y } = suggestAxes(columns)
    return {
      columns,
      rowCount: 0,
      data,
      suggestedX: x,
      suggestedY: y,
      preview: { x: [], y: [] },
      sample: [],
    }
  } finally {
    db.close()
  }
}

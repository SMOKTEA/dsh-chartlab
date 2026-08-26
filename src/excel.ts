/**
 * Excel data source (.xlsx / .xls / .xlsm / .xlsb) via a vendored SheetJS build.
 *
 * Reads the first worksheet of the file, converts its rows into the same
 * columnar `ChartPayload` shape as CSV / DuckDB sources, so every downstream
 * route (meta / groups / series / bin / sample / full, row filters, windowing)
 * works unchanged.
 *
 * SheetJS is vendored under `vendor/xlsx.mjs` (Apache-2.0) and loaded lazily,
 * so the plugin has no registry/CDN dependency and boots even when the module
 * is unavailable. Reading is synchronous (SheetJS has no async API) and loads
 * the whole workbook into memory — fine for the typical xlsx/xls size, which
 * is far smaller than the equivalent CSV.
 */

import type { ChartPayload } from './csv.js'
import { suggestAxes, computePreview, sampleHead } from './csv.js'
import { rowsToColumnar } from './sql.js'
import { readFile } from 'node:fs/promises'

export interface ReadExcelOptions {
  previewTarget?: number
}

/** Minimal surface of the vendored SheetJS build (it ships no type declarations). */
interface SheetJs {
  read(data: Uint8Array, opts: { type: 'buffer'; cellDates?: boolean }): {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }
  utils: {
    sheet_to_json(ws: unknown, opts: { header: 1; raw: boolean; defval: unknown }): unknown[][]
  }
}

/** Read the first worksheet of an Excel file into a ChartPayload. */
export async function readExcel(filePath: string, options: ReadExcelOptions = {}): Promise<ChartPayload> {
  const previewTarget = options.previewTarget ?? 300
  // @ts-ignore — the vendored SheetJS ESM build ships no type declarations.
  const XLSX = (await import('../vendor/xlsx.mjs')) as unknown as SheetJs

  // Read the bytes ourselves and hand a buffer to SheetJS: its own readFile/
  // writeFile helpers rely on `require` and are broken in Node's ESM build.
  const buf = await readFile(filePath)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (sheetName === undefined) throw new Error('Excel file has no sheets')
  const ws = wb.Sheets[sheetName]

  // header:1 → array-of-arrays; the first row is the header.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  if (rows.length === 0) throw new Error('Excel sheet has no rows')

  const headerRaw = rows[0]
  const header = headerRaw.map((h, i) => {
    const s = String(h ?? '').trim()
    return s !== '' ? s : `col_${i}`
  })

  // Drop fully-empty rows; keep the rest aligned to the header.
  const objRows: Array<Record<string, unknown>> = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) continue
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? null
    objRows.push(obj)
  }

  const { columns, data, rowCount } = rowsToColumnar(objRows)
  if (columns.length === 0) throw new Error('Excel sheet has no columns')

  const { x, y } = suggestAxes(columns)
  const preview = computePreview(data, columns, x, y, previewTarget)
  const sample = sampleHead(data, columns, 5, rowCount)
  return { columns, rowCount, data, suggestedX: x, suggestedY: y, preview, sample }
}

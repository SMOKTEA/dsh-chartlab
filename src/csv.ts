/**
 * CSV reading + column type inference + columnar projection (host side).
 *
 * Single-pass columnar design: the stream is parsed once. The first
 * `sampleRows` records feed type inference; after that every column
 * accumulates directly into its final representation:
 *   - number → Float64Array
 *   - date   → Float64Array of epoch milliseconds (compact, plot-ready)
 *   - string → string[]
 *
 * No whole-file string[][] is ever materialized, so peak memory stays close
 * to the size of the final columnar buffers instead of a per-cell JS string
 * copy of the entire table.
 */

import { createReadStream } from 'node:fs'
import { lttbPreserve, lttbIndicesPreserve } from './lttb.js'

export type ColumnType = 'number' | 'date' | 'string'

export interface Column {
  name: string
  type: ColumnType
}

export type ColumnData = Float64Array | string[]

export interface ChartPayload {
  columns: Column[]
  rowCount: number
  data: Record<string, ColumnData>
  suggestedX: string
  suggestedY: string
  preview: { x: number[]; y: number[] }
  sample: Array<Record<string, string | number | null>>
  /** Absolute path of the source file (CSV or DuckDB database; set by the tool; used by the SQL engine). */
  path?: string
  /** Source kind, set by the tool: 'csv' (default), 'duckdb' (database file) or 'excel' (.xlsx/.xls). */
  sourceKind?: 'csv' | 'duckdb' | 'excel'
  /** Table name when sourceKind === 'duckdb'. */
  table?: string
  /** Owning session id (set by the tool; used to scope /dsh-chartlab/list per conversation). */
  sessionId?: string
}

/** How many data rows feed type inference before columns are locked. */
const DEFAULT_SAMPLE_ROWS = 200

/** Incremental RFC-4180-ish parser. Handles quotes, escaped quotes ("") and quoted newlines. */
class IncrementalParser {
  private field = ''
  private record: string[] = []
  private inQuotes = false

  constructor(private readonly onRecord: (record: string[]) => void) {}

  feed(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (this.inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            this.field += '"'
            i++
          } else {
            this.inQuotes = false
          }
        } else {
          this.field += c
        }
      } else if (c === '"') {
        this.inQuotes = true
      } else if (c === ',') {
        this.record.push(this.field)
        this.field = ''
      } else if (c === '\n') {
        this.record.push(this.field)
        this.field = ''
        this.emit()
      } else if (c === '\r') {
        // skip; handles CRLF
      } else {
        this.field += c
      }
    }
  }

  end(): void {
    if (this.field !== '' || this.record.length > 0) {
      this.record.push(this.field)
      this.field = ''
      this.emit()
    }
  }

  private emit(): void {
    const rec = this.record
    this.record = []
    if (rec.length > 0) this.onRecord(rec)
  }
}

/** Classify one column's non-empty sampled values as number | date | string. */
function inferType(nonEmptyValues: string[]): ColumnType {
  if (nonEmptyValues.length === 0) return 'string'
  let allNumeric = true
  for (const v of nonEmptyValues) {
    if (!Number.isFinite(Number(v))) {
      allNumeric = false
      break
    }
  }
  if (allNumeric) return 'number'
  let allDate = true
  for (const v of nonEmptyValues) {
    if (Number.isNaN(Date.parse(v))) {
      allDate = false
      break
    }
  }
  return allDate ? 'date' : 'string'
}

function inferColumns(header: string[], sampleRows: string[][]): Column[] {
  return header.map((name, i) => {
    const values: string[] = []
    for (const row of sampleRows) {
      const v = (row[i] ?? '').trim()
      if (v !== '') values.push(v)
    }
    return { name, type: inferType(values) }
  })
}

interface Accumulator {
  kind: ColumnType
  name: string
  add(raw: string): void
  data(): ColumnData
}

function makeAccumulator(name: string, type: ColumnType): Accumulator {
  if (type === 'number') {
    const nums: number[] = []
    return {
      kind: 'number',
      name,
      add(raw: string) {
        const v = raw.trim()
        const n = v === '' ? NaN : Number(v)
        nums.push(Number.isFinite(n) ? n : NaN)
      },
      data() {
        return Float64Array.from(nums)
      },
    }
  }
  if (type === 'date') {
    const ms: number[] = []
    return {
      kind: 'date',
      name,
      add(raw: string) {
        const v = raw.trim()
        ms.push(v === '' ? NaN : Date.parse(v))
      },
      data() {
        return Float64Array.from(ms)
      },
    }
  }
  const strings: string[] = []
  return {
    kind: 'string',
    name,
    add(raw: string) {
      strings.push(raw.trim())
    },
    data() {
      return strings
    },
  }
}

/** ID / code / coordinate-like names that are numeric but not meaningful y axes. */
const ID_LIKE_NAME = /^(id|fips|zip|zipcode|postal|code|key|idx|index|rowid|geo|geoid|geoid2|lat|lon|long|latitude|longitude|locationid|location_id)$/i

export function suggestAxes(columns: Column[]): { x: string; y: string } {
  const dateCols = columns.filter((c) => c.type === 'date')
  const numCols = columns.filter((c) => c.type === 'number' && !ID_LIKE_NAME.test(c.name))
  const x = dateCols[0]?.name ?? numCols[0]?.name ?? columns[0]?.name ?? ''
  const y = numCols.find((c) => c.name !== x)?.name ?? ''
  return { x, y }
}

/**
 * Downsample a (x, y) column pair to at most `target` points. Dates are
 * already epoch ms in `data`; a string x falls back to the row index;
 * non-finite points are dropped before LTTB.
 */
export function computePreview(
  data: Record<string, ColumnData>,
  columns: Column[],
  xName: string,
  yName: string,
  target: number,
  filters?: Filters,
): { x: number[]; y: number[] } {
  const xCol = columns.find((c) => c.name === xName)
  const yCol = columns.find((c) => c.name === yName)
  if (!xCol || !yCol || yCol.type !== 'number') return { x: [], y: [] }

  const rawX = data[xName]
  const rawY = data[yName] as Float64Array
  const n = rawY.length
  const typeOf = (name: string): ColumnType => columns.find((c) => c.name === name)?.type ?? 'string'
  const valueAt = (name: string, row: number): string | number => {
    const d = data[name]
    return d instanceof Float64Array ? d[row] : (d as string[])[row]
  }
  const xs: number[] = new Array(n)
  const ys: number[] = new Array(n)
  let m = 0
  for (let i = 0; i < n; i++) {
    if (!matchAll(filters, (name) => valueAt(name, i), typeOf)) continue
    const yv = rawY[i]
    if (!Number.isFinite(yv)) continue
    let xv: number
    if (xCol.type === 'date' || xCol.type === 'number') xv = (rawX as Float64Array)[i]
    else xv = i
    if (!Number.isFinite(xv)) continue
    xs[m] = xv
    ys[m] = yv
    m++
  }
  if (m < 2) return { x: [], y: [] }
  xs.length = m
  ys.length = m
  return lttbPreserve(xs, ys, target)
}

export function sampleHead(
  data: Record<string, ColumnData>,
  columns: Column[],
  n: number,
  rowCount: number,
): Array<Record<string, string | number | null>> {
  const count = Math.min(n, rowCount)
  const rows: Array<Record<string, string | number | null>> = []
  for (let r = 0; r < count; r++) {
    const obj: Record<string, string | number | null> = {}
    for (const col of columns) {
      const v = data[col.name][r]
      if (col.type === 'date') {
        obj[col.name] = typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null
      } else {
        obj[col.name] = typeof v === 'number' && Number.isNaN(v) ? null : v as string | number
      }
    }
    rows.push(obj)
  }
  return rows
}

export interface ReadCsvOptions {
  previewTarget?: number
  sampleRows?: number
}

/** Row-filter operator. `=`/`!=` apply to any column type; comparisons to numeric/date columns. */
export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'between'

/** One row filter: keep only rows where `column` `op` one of `values` holds. */
export interface GroupFilter {
  column: string
  op: FilterOp
  /** Single value (comparisons) or multiple values (`=`/`!=` → IN / NOT IN). */
  values: string[]
}

export type Filters = GroupFilter[]

/** True when the row satisfies every filter (`=`/`!=` on strings; all ops on numeric/date). */
function matchAll(
  filters: Filters | undefined,
  getValue: (col: string) => string | number,
  getType: (col: string) => ColumnType,
): boolean {
  if (!filters || filters.length === 0) return true
  for (const f of filters) {
    const v = getValue(f.column)
    const t = getType(f.column)
    const values = f.values && f.values.length > 0 ? f.values : ['']
    if (t === 'string') {
      const sv = typeof v === 'string' ? v : ''
      if (f.op === '=' && !values.includes(sv)) return false
      if (f.op === '!=' && values.includes(sv)) return false
      if (f.op !== '=' && f.op !== '!=') return false
      continue
    }
    const nv = typeof v === 'number' ? v : Number(v)
    const tv = Number(values[0])
    if (!Number.isFinite(nv)) return false
    if (f.op === 'between') {
      const t2 = Number(values[1])
      if (!Number.isFinite(t2) || nv < tv || nv > t2) return false
      continue
    }
    if (!Number.isFinite(tv)) return false
    switch (f.op) {
      case '=': if (!values.some((x) => Number(x) === nv)) return false; break
      case '!=': if (values.some((x) => Number(x) === nv)) return false; break
      case '>': if (!(nv > tv)) return false; break
      case '>=': if (!(nv >= tv)) return false; break
      case '<': if (!(nv < tv)) return false; break
      case '<=': if (!(nv <= tv)) return false; break
    }
  }
  return true
}

/** Whether the payload row `row` satisfies every filter. */
export function rowMatches(payload: ChartPayload, row: number, filters?: Filters): boolean {
  if (!filters || filters.length === 0) return true
  const typeOf = (name: string): ColumnType => payload.columns.find((c) => c.name === name)?.type ?? 'string'
  const valueAt = (name: string): string | number => {
    const d = payload.data[name]
    return d instanceof Float64Array ? d[row] : (d as string[])[row]
  }
  return matchAll(filters, valueAt, typeOf)
}

export interface GroupValue {
  value: string
  count: number
}

/**
 * Distinct values of a string column with their row counts, sorted by count
 * descending (ties alphabetical). Capped at `limit`.
 */
export function uniqueGroups(payload: ChartPayload, column: string, limit: number): GroupValue[] {
  const src = payload.data[column]
  if (!Array.isArray(src)) return []
  const counts = new Map<string, number>()
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const arr: GroupValue[] = []
  for (const [value, count] of counts) arr.push({ value, count })
  arr.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
  return arr.slice(0, limit)
}

export type AggKind = 'sum' | 'avg' | 'min' | 'max' | 'count'

/** One aggregated line series (a single group value). */
export interface SeriesGroup {
  name: string
  count: number // rows in this group inside the window
  x: number[] // aggregated x values, sorted ascending
  y: number[] // aggregated y per x
}

export interface GroupSeriesOptions {
  groupCol: string
  xName: string
  yName: string
  x0: number
  x1: number
  maxPoints: number // per-series LTTB budget
  maxGroups: number // cap on returned groups (by row count desc)
  agg: AggKind
  filters?: Filters // row filters applied before grouping
}

/**
 * Aggregate a (x, y) column pair per distinct value of a string column, within
 * the [x0, x1] window. Rows sharing the same x are aggregated (sum/avg/min/max,
 * or per-x row count) so each group becomes one line series — e.g. a per-state
 * daily-total line out of a county-level dataset. Groups are returned by row
 * count descending, capped at `maxGroups`; each series is LTTB-decimated only
 * when it exceeds `maxPoints`.
 */
export function groupSeries(payload: ChartPayload, opts: GroupSeriesOptions): { total: number; groups: SeriesGroup[] } {
  const X = payload.data[opts.xName]
  const Y = payload.data[opts.yName]
  const G = payload.data[opts.groupCol]
  if (!(X instanceof Float64Array) || !(Y instanceof Float64Array) || !Array.isArray(G)) {
    return { total: 0, groups: [] }
  }
  const n = X.length

  let lo = 0
  let hi = n
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (X[m] < opts.x0) lo = m + 1
    else hi = m
  }
  const i0 = lo
  lo = 0
  hi = n
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (X[m] <= opts.x1) lo = m + 1
    else hi = m
  }
  const i1 = lo

  interface XAgg { sum: number; n: number; mn: number; mx: number }
  const accs = new Map<string, { count: number; byX: Map<number, XAgg> }>()
  for (let i = i0; i < i1; i++) {
    if (opts.filters && !rowMatches(payload, i, opts.filters)) continue
    const yv = Y[i]
    if (!Number.isFinite(yv)) continue
    const xv = X[i]
    if (!Number.isFinite(xv)) continue
    const g = G[i]
    let acc = accs.get(g)
    if (!acc) {
      acc = { count: 0, byX: new Map() }
      accs.set(g, acc)
    }
    acc.count++
    let xa = acc.byX.get(xv)
    if (!xa) {
      xa = { sum: 0, n: 0, mn: Infinity, mx: -Infinity }
      acc.byX.set(xv, xa)
    }
    xa.sum += yv
    xa.n++
    if (yv < xa.mn) xa.mn = yv
    if (yv > xa.mx) xa.mx = yv
  }

  const names = [...accs.keys()].sort((a, b) => (accs.get(b)?.count ?? 0) - (accs.get(a)?.count ?? 0))
  const total = names.length
  const groups: SeriesGroup[] = []
  const shown = Math.min(total, opts.maxGroups)
  for (let gi = 0; gi < shown; gi++) {
    const name = names[gi]
    const acc = accs.get(name)
    if (!acc) continue
    const entries = [...acc.byX.entries()].sort((a, b) => a[0] - b[0])
    const xs = new Array<number>(entries.length)
    const ys = new Array<number>(entries.length)
    for (let e = 0; e < entries.length; e++) {
      xs[e] = entries[e][0]
      const xa = entries[e][1]
      ys[e] =
        opts.agg === 'sum' ? xa.sum :
        opts.agg === 'avg' ? xa.sum / xa.n :
        opts.agg === 'min' ? xa.mn :
        opts.agg === 'max' ? xa.mx :
        xa.n
    }
    if (xs.length > opts.maxPoints) {
      const dec = lttbPreserve(xs, ys, opts.maxPoints)
      groups.push({ name, count: acc.count, x: dec.x, y: dec.y })
    } else {
      groups.push({ name, count: acc.count, x: xs, y: ys })
    }
  }
  return { total, groups }
}

/**
 * Read and profile a CSV file.
 */
export async function readCsv(filePath: string, options: ReadCsvOptions = {}): Promise<ChartPayload> {
  const previewTarget = options.previewTarget ?? 300
  const sampleRows = options.sampleRows ?? DEFAULT_SAMPLE_ROWS

  let header: string[] | null = null
  const sample: string[][] = []
  const accumulators: Accumulator[] = []
  let locked = false
  let rowCount = 0

  const parser = new IncrementalParser((record) => {
    if (record.every((f) => f.trim() === '')) return
    if (header === null) {
      header = record.map((h, i) => (h.trim() !== '' ? h.trim() : `col_${i}`))
      return
    }
    if (!locked) {
      sample.push(record)
      rowCount++
      if (sample.length >= sampleRows) {
        locked = true
        const columns = inferColumns(header, sample)
        for (const col of columns) accumulators.push(makeAccumulator(col.name, col.type))
        for (const r of sample) accumulators.forEach((acc, i) => acc.add(r[i] ?? ''))
        sample.length = 0
      }
      return
    }
    rowCount++
    for (let i = 0; i < accumulators.length; i++) accumulators[i].add(record[i] ?? '')
  })

  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 16 })
    stream.on('data', (chunk: string) => parser.feed(chunk))
    stream.on('end', () => {
      parser.end()
      resolvePromise()
    })
    stream.on('error', reject)
  })

  if (header === null) throw new Error('CSV has no header row')

  // Fewer data rows than the sample window: infer from what we have.
  if (!locked) {
    const columns = inferColumns(header, sample)
    for (const col of columns) accumulators.push(makeAccumulator(col.name, col.type))
    for (const r of sample) accumulators.forEach((acc, i) => acc.add(r[i] ?? ''))
  }

  const columns: Column[] = accumulators.map((acc) => ({ name: acc.name, type: acc.kind }))
  const data: Record<string, ColumnData> = {}
  for (const acc of accumulators) data[acc.name] = acc.data()

  const { x, y } = suggestAxes(columns)
  const preview = computePreview(data, columns, x, y, previewTarget)
  const sampleHeadRows = sampleHead(data, columns, 5, rowCount)

  return { columns, rowCount, data, suggestedX: x, suggestedY: y, preview, sample: sampleHeadRows }
}

/**
 * Window the payload to rows whose `xName` falls in [x0, x1], then — only if
 * that window still has more than `maxPoints` rows — LTTB-decimate it on the
 * (x, y) pair so every column stays aligned. Windows with ≤ maxPoints rows are
 * returned verbatim (full detail). This is the plotly-resampler pattern: the
 * full data stays on the host and each view fetches just its window.
 */
export function windowAndDecimate(
  payload: ChartPayload,
  xName: string,
  yName: string,
  x0: number,
  x1: number,
  maxPoints: number,
  filters?: Filters,
): ChartPayload {
  const X = payload.data[xName]
  if (!(X instanceof Float64Array)) return payload
  const n = X.length

  // Binary-search the sorted x column for the [x0, x1] index range.
  let lo = 0
  let hi = n
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (X[m] < x0) lo = m + 1
    else hi = m
  }
  const i0 = lo
  lo = 0
  hi = n
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (X[m] <= x1) lo = m + 1
    else hi = m
  }
  const i1 = lo
  if (i1 <= i0) return { ...payload, rowCount: 0, data: {} }

  // Base index set inside the window: the whole window, or the filter-matched subset.
  const typeOf = (name: string): ColumnType => payload.columns.find((c) => c.name === name)?.type ?? 'string'
  const valueAt = (name: string, row: number): string | number => {
    const d = payload.data[name]
    return d instanceof Float64Array ? d[row] : (d as string[])[row]
  }
  let base: number[]
  if (filters && filters.length > 0) {
    base = []
    for (let i = i0; i < i1; i++) {
      if (matchAll(filters, (name) => valueAt(name, i), typeOf)) base.push(i)
    }
  } else {
    base = new Array<number>(i1 - i0)
    for (let i = i0; i < i1; i++) base[i - i0] = i
  }
  if (base.length === 0) return { ...payload, rowCount: 0, data: {} }

  let indices: number[]
  if (base.length > maxPoints) {
    const Y = payload.data[yName]
    if (Y instanceof Float64Array) {
      const Xb = new Float64Array(base.length)
      const Yb = new Float64Array(base.length)
      for (let i = 0; i < base.length; i++) {
        Xb[i] = X[base[i]]
        Yb[i] = Y[base[i]]
      }
      indices = lttbIndicesPreserve(Xb, Yb, maxPoints).map((rel) => base[rel])
    } else {
      const step = Math.ceil(base.length / maxPoints)
      indices = []
      for (let i = 0; i < base.length; i += step) indices.push(base[i])
    }
  } else {
    indices = base
  }

  const newData: Record<string, ColumnData> = {}
  for (const col of payload.columns) {
    const src = payload.data[col.name]
    if (src instanceof Float64Array) {
      const arr = new Float64Array(indices.length)
      for (let i = 0; i < indices.length; i++) arr[i] = src[indices[i]]
      newData[col.name] = arr
    } else {
      const str = src as string[]
      const arr = new Array<string>(indices.length)
      for (let i = 0; i < indices.length; i++) arr[i] = str[indices[i]]
      newData[col.name] = arr
    }
  }
  return { ...payload, rowCount: indices.length, data: newData }
}

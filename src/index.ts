/**
 * dsh-chartlab host entry.
 *
 * - Registers the `render_chart` tool: reads a local CSV, infers columns and
 *   types, computes a downsampled preview, stores the parsed data in-memory and
 *   returns a small profile (chartId + column metadata) to the model. The raw
 *   rows never enter the model context.
 * - Registers HTTP routes:
 *     GET /dsh-chartlab/data/:chartId/meta                 → column metadata JSON
 *     GET /dsh-chartlab/data/:chartId/groups?column=state  → distinct string values + counts
 *     GET /dsh-chartlab/data/:chartId/series?group=..&x=..&y=.. → per-group aggregated line series
 *     GET /dsh-chartlab/data/:chartId?columns=x,y&format=bin → raw Float64Array bytes
 *     GET /dsh-chartlab/data/:chartId?sample=N             → LTTB-downsampled JSON
 *     GET /dsh-chartlab/data/:chartId                      → full JSON
 *     GET /dsh-chartlab/view/:chartId                      → interactive HTML page
 *
 *   meta / bin / sample / full accept `group=<col>&value=<val>` to restrict the
 *   result to rows of one string-column group (server-side filter, then window + LTTB).
 *   The /series route instead aggregates each group into one line (sum/avg/min/max/count).
 */

import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  readCsv,
  computePreview,
  windowAndDecimate,
  uniqueGroups,
  groupSeries,
  rowMatches,
  type ChartPayload,
  type Column,
  type Filters,
  type AggKind,
} from './csv.js'
import { putChart, getChart, listCharts, purgeSession } from './store.js'
import { runSql } from './sql.js'
import { viewPageHtml } from './view.js'

export const name = 'dsh-chartlab'
export const inject = ['tools', 'systemPrompt']

const PREVIEW_TARGET = 300
/** Window decimation budget: a view with more than this many rows is LTTB-decimated. */
const MAX_POINTS = 5000
/** Series mode: at most this many group lines are returned (by row count desc). */
const MAX_GROUPS = 100
const DATA_ROUTE_PREFIX = '/dsh-chartlab/data/'
const VIEW_ROUTE_PATH = '/dsh-chartlab/view'

interface ToolRegistry {
  register(definition: unknown): () => void
}

interface SystemPromptService {
  section(section: { name: string; order: number; text: string }): void
}

interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void
  }): () => void
}

interface HostContext {
  tools: ToolRegistry
  systemPrompt: SystemPromptService
  inject(deps: string[], callback: (ctx: unknown) => void): unknown
}

interface WebServerHostContext {
  webServer: WebServerService
  effect(callback: () => (() => void) | void, label?: string): unknown
}

interface RenderChartArgs {
  path: string
  x?: string
  y?: string
}

interface ToolResult {
  chartId: string
  path: string
  columns: Column[]
  rowCount: number
  suggestedX: string
  suggestedY: string
}

function renderText(value: ToolResult): string {
  const chart = getChart(value.chartId)
  const cols = value.columns.map((c) => `${c.name} (${c.type})`).join(', ')
  const lines = [
    `Prepared chart \`${value.chartId}\` from \`${value.path}\`.`,
    `- rows: ${value.rowCount}`,
    `- columns: ${cols}`,
    `- suggested x: ${value.suggestedX || '(none)'}, y: ${value.suggestedY || '(none)'}`,
  ]
  if (chart && chart.sample.length > 0) {
    const keys = Object.keys(chart.sample[0])
    lines.push('', 'Sample head:', `| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`)
    for (const row of chart.sample) {
      lines.push(`| ${keys.map((k) => row[k] ?? '').join(' | ')} |`)
    }
  }
  lines.push('', `Open the interactive chart: [/dsh-chartlab/view/${value.chartId}](/dsh-chartlab/view/${value.chartId})`)
  return lines.join('\n')
}

function serializeJson(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) => {
    if (value instanceof Float64Array || value instanceof Float32Array) return Array.from(value)
    return value
  })
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(serializeJson(payload))
}

/** Stream a chart's numeric/date columns as raw Float64Array bytes after a JSON header line. */
function writeBinary(response: ServerResponse, chart: ChartPayload, requested: string[]): void {
  const numeric: Array<{ name: string; type: string; offset: number }> = []
  let offset = 0
  for (const name of requested) {
    const col = chart.columns.find((c) => c.name === name)
    if (!col) continue
    const d = chart.data[name]
    if (d instanceof Float64Array) {
      numeric.push({ name, type: col.type, offset })
      offset += d.byteLength
    }
  }
  const meta = JSON.stringify({ rowCount: chart.rowCount, columns: numeric })
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    'x-dsh-chartlab-meta': meta,
  })
  for (const entry of numeric) {
    const d = chart.data[entry.name] as Float64Array
    response.write(Buffer.from(d.buffer, d.byteOffset, d.byteLength))
  }
  response.end()
}

/** Min/max of a numeric/date column, or null when it is not numeric. Respects optional filters. */
function columnRange(chart: ChartPayload, name: string, filters?: Filters): [number, number] | null {
  const X = chart.data[name]
  if (!(X instanceof Float64Array) || X.length === 0) return null
  let mn = Infinity
  let mx = -Infinity
  for (let i = 0; i < X.length; i++) {
    if (!rowMatches(chart, i, filters)) continue
    const v = X[i]
    if (Number.isFinite(v)) {
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
  }
  return mn === Infinity ? null : [mn, mx]
}

/** Row count after applying optional filters. */
function filteredRowCount(chart: ChartPayload, filters?: Filters): number {
  if (!filters || filters.length === 0) return chart.rowCount
  const n = (chart.data[chart.suggestedX] as Float64Array | undefined)?.length ?? chart.rowCount
  let count = 0
  for (let i = 0; i < n; i++) if (rowMatches(chart, i, filters)) count++
  return count
}

/** Parse the `filters` query param (JSON array of {column, op, value}) into validated filters. */
function filtersFromParams(chart: ChartPayload, params: URLSearchParams): Filters | undefined {
  const raw = params.get('filters')
  if (!raw) return undefined
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(arr)) return undefined
  const out: Filters = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const f = item as Record<string, unknown>
    if (typeof f.column !== 'string' || typeof f.op !== 'string') continue
    const col = chart.columns.find((c) => c.name === f.column)
    if (!col) continue
    const op = f.op as string
    if (op !== '=' && op !== '!=' && op !== '>' && op !== '>=' && op !== '<' && op !== '<=' && op !== 'between') continue
    if (col.type === 'string' && op !== '=' && op !== '!=') continue
    // accept either a single `value` or a `values` array
    let values: string[] = []
    if (Array.isArray(f.values)) {
      values = (f.values as unknown[]).filter((x): x is string => typeof x === 'string' && x !== '')
    } else if (typeof f.value === 'string' && f.value !== '') {
      values = [f.value]
    }
    if (values.length === 0) continue
    if (op === 'between' && values.length !== 2) continue
    out.push({ column: f.column, op: op as Filters[number]['op'], values })
  }
  return out.length > 0 ? out : undefined
}

async function dataHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' })
    response.end()
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const rest = url.pathname.slice(DATA_ROUTE_PREFIX.length)
    const chartId = rest.split('/')[0]
    const chart = getChart(chartId)
    if (chart === undefined) return sendJson(response, 404, { error: 'unknown chartId' })

    if (rest === `${chartId}/sql`) {
      const q = url.searchParams.get('q') ?? ''
      if (q.trim() === '') return sendJson(response, 400, { error: 'missing q' })
      if (!chart.path) return sendJson(response, 400, { error: 'chart has no source path' })
      try {
        const result = await runSql(chart.path, q)
        return sendJson(response, 200, { chartId, ...result })
      } catch (error) {
        return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    }

    if (rest === `${chartId}/groups`) {
      const column = url.searchParams.get('column') ?? ''
      const col = chart.columns.find((c) => c.name === column && c.type === 'string')
      if (!col) return sendJson(response, 400, { error: 'unknown or non-string group column' })
      const limitRaw = Number(url.searchParams.get('limit') ?? '1000')
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 1000
      const values = uniqueGroups(chart, column, limit)
      return sendJson(response, 200, { column, total: values.length, values })
    }

    if (rest === `${chartId}/series`) {
      const groupCol = url.searchParams.get('group') ?? ''
      const col = chart.columns.find((c) => c.name === groupCol && c.type === 'string')
      if (!col) return sendJson(response, 400, { error: 'unknown or non-string group column' })
      const xName = url.searchParams.get('x') ?? chart.suggestedX
      const yName = url.searchParams.get('y') ?? chart.suggestedY
      const x0 = Number(url.searchParams.get('x0') ?? '-Infinity')
      const x1 = Number(url.searchParams.get('x1') ?? 'Infinity')
      const maxPointsRaw = Number(url.searchParams.get('maxPoints') ?? '')
      const maxPoints = Number.isFinite(maxPointsRaw) && maxPointsRaw > 0 ? Math.floor(maxPointsRaw) : MAX_POINTS
      const maxGroupsRaw = Number(url.searchParams.get('maxGroups') ?? '')
      const maxGroups = Number.isFinite(maxGroupsRaw) && maxGroupsRaw > 0 ? Math.floor(maxGroupsRaw) : MAX_GROUPS
      const aggRaw = url.searchParams.get('agg') ?? 'sum'
      const agg: AggKind = ['sum', 'avg', 'min', 'max', 'count'].includes(aggRaw) ? (aggRaw as AggKind) : 'sum'
      const filters = filtersFromParams(chart, url.searchParams)
      const { total, groups } = groupSeries(chart, { groupCol, xName, yName, x0, x1, maxPoints, maxGroups, agg, filters })
      return sendJson(response, 200, { group: groupCol, x: xName, y: yName, agg, total, shown: groups.length, groups })
    }

    if (rest === `${chartId}/meta`) {
      const xParam = url.searchParams.get('x') ?? chart.suggestedX
      const filters = filtersFromParams(chart, url.searchParams)
      const range = columnRange(chart, xParam, filters)
      return sendJson(response, 200, {
        columns: chart.columns,
        rowCount: filteredRowCount(chart, filters),
        suggestedX: chart.suggestedX,
        suggestedY: chart.suggestedY,
        x: xParam,
        ...(range ? { xMin: range[0], xMax: range[1] } : {}),
      })
    }

    if (url.searchParams.get('format') === 'bin') {
      const columnsParam = url.searchParams.get('columns') ?? ''
      const columns = columnsParam.split(',').map((s) => s.trim()).filter((s) => s !== '')
      const xName = columns[0] ?? chart.suggestedX
      const yName = columns[1] ?? chart.suggestedY
      const x0 = Number(url.searchParams.get('x0') ?? '-Infinity')
      const x1 = Number(url.searchParams.get('x1') ?? 'Infinity')
      const maxPointsRaw = Number(url.searchParams.get('maxPoints') ?? '')
      const maxPoints = Number.isFinite(maxPointsRaw) && maxPointsRaw > 0 ? Math.floor(maxPointsRaw) : MAX_POINTS
      const filters = filtersFromParams(chart, url.searchParams)
      const windowed = windowAndDecimate(chart, xName, yName, x0, x1, maxPoints, filters)
      return writeBinary(response, windowed, columns)
    }

    const sample = Number(url.searchParams.get('sample') ?? '0')
    if (Number.isFinite(sample) && sample > 0) {
      const filters = filtersFromParams(chart, url.searchParams)
      const points = computePreview(chart.data, chart.columns, chart.suggestedX, chart.suggestedY, Math.min(sample, 100000), filters)
      return sendJson(response, 200, {
        chartId,
        columns: chart.columns,
        rowCount: filteredRowCount(chart, filters),
        x: chart.suggestedX,
        y: chart.suggestedY,
        points,
      })
    }

    const filters = filtersFromParams(chart, url.searchParams)
    if (filters) {
      const windowed = windowAndDecimate(chart, chart.suggestedX, chart.suggestedY, -Infinity, Infinity, Number.MAX_SAFE_INTEGER, filters)
      return sendJson(response, 200, {
        chartId,
        columns: windowed.columns,
        rowCount: windowed.rowCount,
        suggestedX: windowed.suggestedX,
        suggestedY: windowed.suggestedY,
        data: windowed.data,
      })
    }

    return sendJson(response, 200, {
      chartId,
      columns: chart.columns,
      rowCount: chart.rowCount,
      suggestedX: chart.suggestedX,
      suggestedY: chart.suggestedY,
      data: chart.data,
    })
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function viewHandler(_request: IncomingMessage, response: ServerResponse): void {
  const html = viewPageHtml()
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(html)
}

function listHandler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const session = url.searchParams.get('session')?.trim() ?? undefined
  sendJson(response, 200, {
    session,
    charts: listCharts(session).map((chartId) => ({
      chartId,
      rowCount: getChart(chartId)?.rowCount ?? 0,
    })),
  })
}

/** POST /dsh-chartlab/purge — drop one deleted session's charts from the store. */
function purgeHandler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  let body = ''
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8')
    if (body.length > 16 * 1024) request.destroy()
  })
  request.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}') as { session?: unknown }
      const session = typeof parsed.session === 'string' && parsed.session !== '' ? parsed.session : undefined
      if (session === undefined) return sendJson(response, 400, { error: 'missing session' })
      const purged = purgeSession(session)
      return sendJson(response, 200, { session, purged })
    } catch (error) {
      return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
  request.on('error', () => {
    /* connection dropped before the body completed */
  })
}

export function apply(ctx: HostContext): void {
  ctx.systemPrompt.section({
    name: 'tool:render_chart',
    order: 112,
    text: 'Use the render_chart tool to turn a local CSV file into an interactive chart. Pass the CSV path; the tool reads and profiles the file and returns a chartId plus column metadata (it never loads the raw rows into context). Include the returned /dsh-chartlab/view/<chartId> link in your reply so the user can open the interactive chart window. The interactive chart page itself supports column selection (X/Y) and row filtering; aggregation and grouping are not supported.',
  })

  ctx.tools.register(defineTool({
    name: 'render_chart',
    description: 'Read a local CSV file and prepare it for interactive charting. Returns a chartId and column metadata, never the raw rows.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to the CSV file (absolute, or relative to the host working directory).' },
      x: { type: 'string', description: 'Optional column name to use as the x axis.' },
      y: { type: 'string', description: 'Optional column name to use as the y axis.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chartId: { type: 'string', required: true },
          path: { type: 'string', required: true },
          columns: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                type: { type: 'string', required: true },
              },
            },
          },
          rowCount: { type: 'integer', required: true },
          suggestedX: { type: 'string', required: true },
          suggestedY: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: ToolResult) => [{ type: 'text', text: renderText(value) }],
      presentationMeta: (_args: unknown, value: ToolResult) => {
        const chart = getChart(value.chartId)
        return {
          chartId: value.chartId,
          columns: value.columns,
          rowCount: value.rowCount,
          suggestedX: value.suggestedX,
          suggestedY: value.suggestedY,
          preview: chart?.preview,
          sample: chart?.sample,
        }
      },
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args: RenderChartArgs, exec?: { agent?: { session?: { id: string } } }): Promise<ToolResult> {
      const resolvedPath = resolve(args.path)
      const chart = await readCsv(resolvedPath, { previewTarget: PREVIEW_TARGET })
      chart.path = resolvedPath
      if (exec?.agent?.session?.id) chart.sessionId = exec.agent.session.id
      if (args.x) chart.suggestedX = args.x
      if (args.y) chart.suggestedY = args.y
      const chartId = putChart(chart)
      return {
        chartId,
        path: resolvedPath,
        columns: chart.columns,
        rowCount: chart.rowCount,
        suggestedX: chart.suggestedX,
        suggestedY: chart.suggestedY,
      }
    },
    presentCall: (args: RenderChartArgs) => ({ card: 'generic', title: args.path, kind: 'chart', rawInput: args.path }),
  }))

  ctx.inject(['webServer'], (rawCtx: unknown) => {
    const hostCtx = rawCtx as WebServerHostContext
    hostCtx.effect(() => {
      const offData = hostCtx.webServer.register({
        kind: 'prefix',
        path: '/dsh-chartlab/data',
        handler: dataHandler,
      })
      const offView = hostCtx.webServer.register({
        kind: 'prefix',
        path: VIEW_ROUTE_PATH,
        handler: viewHandler,
      })
      const offList = hostCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-chartlab/list',
        handler: listHandler,
      })
      const offPurge = hostCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-chartlab/purge',
        handler: purgeHandler,
      })
      return () => {
        offData()
        offView()
        offList()
        offPurge()
      }
    }, 'dsh-chartlab: http routes')
  })
}

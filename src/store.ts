/**
 * In-memory chart registry: chartId → parsed chart payload, plus a newest-first
 * id list per owning session so the browser tab shows only the current
 * conversation's charts. Lives for the process lifetime. A later stage can back
 * this with a columnar cache file + LRU eviction so very large datasets do not
 * stay resident forever.
 */

import { randomUUID } from 'node:crypto'
import type { ChartPayload } from './csv.js'

const charts = new Map<string, ChartPayload>()
/** Per-session newest-first id lists ('' = charts with no recorded owner). */
const orderBySession = new Map<string, string[]>()
/** Global newest-first id list (the no-session / fallback view). */
const globalOrder: string[] = []

export function putChart(chart: ChartPayload): string {
  const chartId = randomUUID()
  charts.set(chartId, chart)
  const key = chart.sessionId ?? ''
  const list = orderBySession.get(key) ?? []
  list.unshift(chartId)
  orderBySession.set(key, list)
  globalOrder.unshift(chartId)
  return chartId
}

export function getChart(chartId: string): ChartPayload | undefined {
  return charts.get(chartId)
}

/**
 * Chart ids, newest first. Without a session, every chart is returned (global
 * newest-first); with a session id, only that conversation's charts.
 */
export function listCharts(sessionId?: string): string[] {
  if (sessionId !== undefined) return (orderBySession.get(sessionId) ?? []).slice()
  return globalOrder.slice()
}

/**
 * Drop every chart owned by one session (charts map + both order lists).
 * Returns how many charts were removed.
 */
export function purgeSession(sessionId: string): number {
  const list = orderBySession.get(sessionId)
  if (!list || list.length === 0) {
    orderBySession.delete(sessionId)
    return 0
  }
  const removedSet = new Set(list)
  let removed = 0
  for (const id of removedSet) if (charts.delete(id)) removed++
  orderBySession.delete(sessionId)
  const kept = globalOrder.filter((id) => !removedSet.has(id))
  globalOrder.length = 0
  globalOrder.push(...kept)
  return removed
}

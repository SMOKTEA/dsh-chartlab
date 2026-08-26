/**
 * Largest-Triangle-Three-Buckets downsampling (Sveinn Steinarsson's algorithm).
 * Reduces a line series to at most `threshold` points while preserving the
 * visual shape. Pure, dependency-free, and the same technique plotly-resampler
 * uses server-side — this one runs in the host process for the preview and for
 * the `?sample=` window the data route serves.
 */

export function lttb(xs: number[], ys: number[], threshold: number): { x: number[]; y: number[] } {
  const n = xs.length
  if (n === 0) return { x: [], y: [] }
  if (threshold >= n || threshold <= 0 || n <= 2) return { x: xs.slice(), y: ys.slice() }

  const sampledX: number[] = new Array(threshold)
  const sampledY: number[] = new Array(threshold)
  sampledX[0] = xs[0]
  sampledY[0] = ys[0]
  sampledX[threshold - 1] = xs[n - 1]
  sampledY[threshold - 1] = ys[n - 1]

  const bucketSize = (n - 2) / (threshold - 2)
  let a = 0
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1)
    const avgRangeStart = Math.floor(i * bucketSize) + 1
    const avgRangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1)

    let avgX = 0
    let avgY = 0
    const avgLen = avgRangeEnd - avgRangeStart
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += xs[j]
      avgY += ys[j]
    }
    avgX /= avgLen
    avgY /= avgLen

    const pointAX = xs[a]
    const pointAY = ys[a]
    let maxArea = -1
    let maxIdx = rangeStart
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((pointAX - avgX) * (ys[j] - pointAY) - (pointAX - xs[j]) * (avgY - pointAY))
      if (area > maxArea) {
        maxArea = area
        maxIdx = j
      }
    }
    sampledX[i + 1] = xs[maxIdx]
    sampledY[i + 1] = ys[maxIdx]
    a = maxIdx
  }

  return { x: sampledX, y: sampledY }
}

/**
 * LTTB that returns the picked source indices (ascending) instead of points,
 * so every column of a table can be decimated to the SAME subset and stay
 * aligned. Accepts any array-like (number[] or Float64Array).
 */
export function lttbIndices(xs: ArrayLike<number>, ys: ArrayLike<number>, threshold: number): number[] {
  const n = xs.length
  if (n === 0) return []
  if (threshold >= n || threshold <= 0 || n <= 2) {
    const all: number[] = new Array(n)
    for (let i = 0; i < n; i++) all[i] = i
    return all
  }
  const idx: number[] = new Array(threshold)
  idx[0] = 0
  idx[threshold - 1] = n - 1
  const bucket = (n - 2) / (threshold - 2)
  let a = 0
  for (let i = 0; i < threshold - 2; i++) {
    const rs = Math.floor((i + 1) * bucket) + 1
    const re = Math.min(Math.floor((i + 2) * bucket) + 1, n - 1)
    const as = Math.floor(i * bucket) + 1
    const ae = Math.min(Math.floor((i + 1) * bucket) + 1, n - 1)
    let ax = 0
    let ay = 0
    const alen = ae - as
    for (let j = as; j < ae; j++) {
      ax += xs[j]
      ay += ys[j]
    }
    ax /= alen
    ay /= alen
    const pax = xs[a]
    const pay = ys[a]
    let maxArea = -1
    let maxIdx = rs
    for (let j = rs; j < re; j++) {
      const area = Math.abs((pax - ax) * (ys[j] - pay) - (pax - xs[j]) * (ay - pay))
      if (area > maxArea) {
        maxArea = area
        maxIdx = j
      }
    }
    if (maxIdx >= re) maxIdx = Math.max(0, re - 1) // guard float-boundary empty bucket
    idx[i + 1] = maxIdx
    a = maxIdx
  }
  return idx
}

/**
 * Significant extreme-point indices in `ys` (global min/max plus sharp local
 * spikes/troughs), capped at `maxCount`. These are the values LTTB can swallow;
 * callers append them to a decimated set so anomalies survive downsampling.
 */
export function findExtremeIndices(ys: ArrayLike<number>, maxCount: number): number[] {
  const n = ys.length
  if (n === 0) return []
  let gmin = Infinity
  let gmax = -Infinity
  let gminI = 0
  let gmaxI = 0
  for (let i = 0; i < n; i++) {
    const v = ys[i]
    if (v < gmin) { gmin = v; gminI = i }
    if (v > gmax) { gmax = v; gmaxI = i }
  }
  const range = gmax - gmin
  const cand: Array<{ idx: number; amp: number }> = []
  for (let i = 1; i < n - 1; i++) {
    const v = ys[i]
    const prev = ys[i - 1]
    const next = ys[i + 1]
    if ((v > prev && v > next) || (v < prev && v < next)) {
      const amp = Math.min(Math.abs(v - prev), Math.abs(next - v))
      if (range > 0 && amp > range * 0.03) cand.push({ idx: i, amp })
    }
  }
  cand.sort((x, y) => y.amp - x.amp)
  const out: number[] = [gminI, gmaxI]
  for (let i = 0; i < cand.length && out.length < maxCount; i++) {
    if (cand[i].idx !== gminI && cand[i].idx !== gmaxI) out.push(cand[i].idx)
  }
  return out
}

/**
 * LTTB decimation that also keeps significant extreme points (anomalies/spikes),
 * so sampling never swallows the outliers. Returns ascending source indices;
 * result length is threshold + the (few) extra extremes.
 */
export function lttbIndicesPreserve(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  threshold: number,
  maxExtremes = 40,
): number[] {
  const n = xs.length
  if (threshold >= n || threshold <= 0 || n <= 2) return lttbIndices(xs, ys, threshold)
  const base = lttbIndices(xs, ys, threshold)
  const set = new Set(base)
  for (const e of findExtremeIndices(ys, maxExtremes)) set.add(e)
  const out = [...set].sort((a, b) => a - b)
  return out
}

/** Like `lttb` but preserves extreme points (see `lttbIndicesPreserve`). */
export function lttbPreserve(
  xs: number[],
  ys: number[],
  threshold: number,
  maxExtremes = 40,
): { x: number[]; y: number[] } {
  const n = xs.length
  if (n === 0) return { x: [], y: [] }
  if (threshold >= n || threshold <= 0 || n <= 2) return { x: xs.slice(), y: ys.slice() }
  const idx = lttbIndicesPreserve(xs, ys, threshold, maxExtremes)
  return { x: idx.map((i) => xs[i]), y: idx.map((i) => ys[i]) }
}

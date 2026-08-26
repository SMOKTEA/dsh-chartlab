# dsh-chartlab

CSV → interactive chart for DeepSeek Harness.

- **Host tool** `render_chart`: reads a local CSV, infers column types, and returns a
  `chartId` + column metadata (the raw rows never enter the model context).
- **Web UI tab**: the plugin ships a client bundle (`client/client.js`) that registers a
  **图表** tab next to Chat/Trajectory (`conversation.view`, id `chart`) and a
  header utility that auto-jumps to the Chart tab when a new chart is created.
- **Binary data route** `GET /dsh-chartlab/data/:chartId?columns=x,y&format=bin`: numeric/date
  columns as raw `Float64Array` bytes (metadata in the `x-dsh-chartlab-meta` header), so
  million-point columns transfer and parse with no JSON overhead.
- **Window-based decimation**: the full data stays server-side; the view page requests only
  the visible `x0..x1` window (binary route), and LTTB downsampling is applied only when
  the window exceeds `MAX_POINTS = 5000` points — so zooming into a dense million-point
  chart stays smooth while small windows keep full fidelity.
- **View route** `GET /dsh-chartlab/view/:chartId`: self-contained interactive HTML page —
  column selection, line/scatter, box-select zoom, x-axis drag pan, wheel zoom on the
  x-axis strip, x-nearest hover tooltip, and client-side LTTB decimation. The page
  **follows the DSH host's locale and theme** (reads the parent's `<html lang>` and
  `data-ds-dark-theme` marker; UI strings are zh/en, colors are CSS variables with
  light + dark palettes) and **persists its view options** (X/Y, type, group, filters,
  zoom window) in `localStorage` keyed by chartId, so an iframe remount (tab switch or
  chart change) restores the previous state.
- **v1 workflow — X/Y anchor + row filtering + grouping**: the X/Y dropdowns are always
  available and never rewritten (custom non-native dropdowns). Data processing is
  **row-level only**: a structured **filter panel** builds conditions
  (`{column, op, values[]}` with `= != > >= < <=`; `=`/`!=` accept **multiple values**
  — IN/NOT IN — via a searchable multi-select for string columns, numeric/date
  columns keep a single-value input). The editable **SQL box** shows the live
  `WHERE` clause and round-trips user edits (including `IN (...)` / `NOT IN (...)`).
  A **分组** dropdown switches the chart into multi-series mode — every distinct value
  of the string column becomes one line, summed per x; legends and hover tooltips
  collapse to the 5 largest + 5 smallest groups when there are more than 15, and the
  hovered point is highlighted on the line. Aggregation, sorting and LIMIT in the SQL
  route are explicitly rejected (roadmap items).
- JSON fallbacks: `?sample=N` (LTTB window) and the full JSON route.

## Structure

```
dsh-chartlab/
  package.json          # main: lib/index.js; exports["."] + exports["./client"]; build script; dsh.bundle.patch + dsh.client
  tsconfig.json         # NodeNext, strict, outDir: lib, rootDir: src
  cordis.patch.yml      # inserts dsh-chartlab into the layer stack
  scripts/
    copy-client.mjs     # build step: copies src/client/client.js → lib/client/client.js
  src/                  # TypeScript source
    client/
      client.js         # hand-written DSH client bundle (__ModuleLoader__ format): Chart tab + auto-switch utility
    index.ts            # plugin entry: tools + routes (meta / groups / series / sql / bin / sample / full / view / list / purge)
    csv.ts              # single-pass columnar CSV parse + inference + preview + windowAndDecimate + groupSeries
    sql.ts              # DuckDB-backed SQL engine (lazy duckdb import, SELECT/WITH only)
    sql-normalize.ts    # multi-line SQL → single-line normalizer (embedded into the view page by source)
    lttb.ts             # LTTB downsampling (value + index-tracking variants)
    store.ts            # in-memory chartId → payload registry (session-scoped) + purgeSession
    view.ts             # self-contained HTML chart page
    shims.d.ts          # loose @deepseek-ai/dsh-tools declaration
  lib/                  # build output (tsc + copied client bundle) — the published artifact
    client/client.js    # copied from src/client by scripts/copy-client.mjs
  test/                 # selftest / apply-test / sql-normalize-test / view-render-check / gen-*.mjs + datasets
```

`lib/` is the whole published payload: `files` ships `lib`, `cordis.patch.yml` and
`README.md` only — no raw `src/` or `test/` sources. The browser bundle is
resolved by the host via `exports["./client"]` → `./lib/client/client.js`.

## Build

```powershell
npm install            # typescript + @types/node (devDeps) + duckdb (dependency)
npm run build          # tsc → lib/
```

`duckdb` is loaded lazily (dynamic import) so the plugin boots even without it;
only the SQL routes/tool need the native module.

## Real dataset

`test/us-counties-2020.csv` — NYT COVID-19 county-level time series for 2020
(`https://github.com/nytimes/covid-19-data`, year-split file), **884,737 rows / 34 MB**:
`date,county,state,fips,cases,deaths`. Real, clean (0 dirty rows), public-health data;
the chart defaults to `x=date, y=cases`. Parses in ~0.7 s.

A second year file (`us-counties-2021.csv`, 48 MB) is also available; both are
disjoint by date and can be concatenated for ~2M rows.

```powershell
node test/gen-sample.mjs   # small synthetic sample.csv (2000 rows)
node test/gen-big.mjs      # large synthetic big.csv (7.8M rows) for load testing
node test/verify-real.mjs  # parse the real 2020 dataset through the tool
```

## Performance (single-pass columnar, Node 24)

- 300k rows / 15.5 MB → **0.31 s, 41.8 MB** heap.
- 7.8M rows / 405 MB (`test/big.csv`) → **7.9 s, 556 MB** heap (region string column is
  ~300 MB of that; categorical encoding would shrink it to <1 MB).
- 884K-row real dataset (`us-counties-2020.csv`) → **0.7 s parse**, ~45 MB heap.

## Self-test / bench (no DSH needed)

```powershell
node test/selftest.mjs
node test/apply-test.mjs
node --expose-gc test/bench-big.mjs
```

## Integration

```powershell
dsh plugin --profile dev add file:/path/to/dsh-chartlab
dsh --profile dev --dump-config
dsh --profile dev     # web UI; chat: "画 /path/to/your-data.csv 的图"
```

The client bundle is served by the plugin host at `/plugins/dsh-chartlab/client.js`; the
Chart tab and the auto-switch header utility are **event-driven** — they subscribe to
the current session's notifier and refresh `GET /dsh-chartlab/list?session=<id>` only when
a `tool/result` / `user/message` event lands (no polling timers). The list is **scoped
per conversation**, so each session sees only its own charts.

## Tool / route contract

- `render_chart(path, x?, y?)` → `{ chartId, path, columns[{name,type}], rowCount, suggestedX, suggestedY }`
- `GET /dsh-chartlab/list[?session=<id>]` → this session's newest-first `chartId`s (session-scoped; no param = all charts)
- `GET /dsh-chartlab/data/:chartId/meta[?x=..&filters=..]` → `{ columns, rowCount, suggestedX, suggestedY, x, xMin, xMax }`
- `GET /dsh-chartlab/data/:chartId/groups?column=col[&limit=N]` → `{ column, total, values: [{value,count}] }`
- `GET /dsh-chartlab/data/:chartId/series?group=col&x=..&y=..&agg=sum|avg|min|max|count[&x0&x1&maxPoints&maxGroups]` → `{ total, shown, groups: [{name,count,x[],y[]}] }`
- `GET /dsh-chartlab/data/:chartId/sql?q=SELECT..` → DuckDB result as columnar JSON (v1 rejects aggregation/grouping/sorting/LIMIT)
- `GET /dsh-chartlab/data/:chartId?columns=x,y&x0&x1&maxPoints[&filters=..]&format=bin` → per-window binary (meta in `x-dsh-chartlab-meta`)
- `GET /dsh-chartlab/data/:chartId?columns=x,y&sample=N[&filters=..]` → `{ ..., points: {x[], y[]} }`
- `GET /dsh-chartlab/data/:chartId?columns=x,y[&filters=..]` → full JSON window
- `GET /dsh-chartlab/view/:chartId` → interactive HTML page

`filters` is a URL-encoded JSON array of `{column, op, value}` with `op` in
`= != > >= < <=` (strings: `=`/`!=` only); rows must satisfy every condition.

## Done (2026-08-26)

1. ✅ **语言和主题跟随 DSH**：view 页读取父页面 `<html lang>`（zh/en）与
   `body[data-ds-dark-theme]` 动态适配 —— 文案走 `T(zh,en)`、颜色走 CSS 变量双主题，
   画布颜色从 `getComputedStyle` 解析。
2. ✅ **图表 tab 切换后选项缓存**：X/Y、类型、分组、筛选条件、缩放窗口按 chartId
   持久到 `localStorage`，iframe 重载后自动恢复（`saveOpts` / `loadOpts`）。
3. ✅ **不同对话可看不同图表**：store 按 sessionId 分桶，`render_chart` 记录所属会话，
   `/dsh-chartlab/list?session=<id>` 只返回当前会话的图，ChartTab/ChartSwitcher 传当前
   sessionId。
4. ✅ **删除后台轮询任务**：ChartTab（3s）与 ChartSwitcher（2s）的 `setInterval` 已移除，
   改为订阅当前 session 的 notifier，仅在 `tool/result` / `user/message` 事件到达时
   按需刷新一次。


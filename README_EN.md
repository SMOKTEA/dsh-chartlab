<div align="center">

# 📈 dsh-chartlab

English | [简体中文](./README.md)

**Data → Interactive Chart Lab · DeepSeek Harness plugin**

Turn local data files (`.csv` / `.xlsx` / `.xls`) or DuckDB databases into zoomable, filterable, groupable interactive charts

<p align="center">
  <a href="https://github.com/SMOKTEA/dsh-chartlab/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab/blob/master/LICENSE"><img alt="License MIT" src="https://img.shields.io/github/license/SMOKTEA/dsh-chartlab"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab"><img alt="Last commit" src="https://img.shields.io/github/last-commit/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://awesome-dsh-plugin.com"><img alt="Awesome DSH Plugin" src="https://awesome-dsh-plugin.com/badge.svg"></a>
</p>

</div>

[[_TOC_]]

---

One line: **let the agent turn your data into an interactive chart.**

- **Three data sources** — local data files (`.csv` / `.xlsx` / `.xls`), or a table inside a DuckDB database (`.duckdb` / `.ddb`). Just say it in chat.
- **Supports millions of rows** — data stays on the host; the chart fetches only the visible window, so zooming and panning stay smooth even at millions of rows.
- **Full chart workbench** — line / scatter; box zoom, wheel zoom, drag-to-pan, hover readouts.
- **Filter · Group · SQL** — conditional filters, group rows by a column into multiple lines, or write SQL directly.
- **Native look & feel** — follows DSH's language (zh / en) and theme (dark / light) automatically, no reload needed.
- **Per-session isolation** — each conversation sees only its own charts; deleted sessions are cleaned up.

<p align="center">
  <img src="assets/demo.jpeg" alt="dsh-chartlab demo" width="800">
</p>

---

## ✨ Features

| Capability | Description |
|---|---|
| Data sources | Local data files (`.csv` / `.xlsx` / `.xls`), DuckDB database tables (`.duckdb` / `.ddb`); the DuckDB table name is optional and defaults to the first table |
| Chart types | Line, scatter |
| Interaction | Box zoom, wheel zoom, drag-to-pan, hover readouts, screenshot download |
| Filter · Group | Conditional filters (equal / not equal / range / multi-select, with date ranges); group rows by a column into multiple lines |
| SQL | Write SQL queries directly in the chart; paste multi-line SQL |
| Theme & language | Follows DSH dark / light theme and zh / en language |
| Session isolation | Each conversation is independent; deleted sessions clean up their cache |

---

## 🚀 Quick Start

```powershell
dsh plugin --profile web add dsh-chartlab

```

Then just say in chat:

> **Draw a chart of `/path/to/your-data.csv` with dsh-chartlab**
>
> **Draw a chart of `/path/to/your-data.xlsx` with dsh-chartlab**
>
> **Draw a chart of the `sales` table in `/path/to/your-data.duckdb` with dsh-chartlab** (table name optional; defaults to the first table)

---

## 🗺️ Roadmap

| Status | Item | Notes |
|---|---|---|
| ✅ Done | CSV / Excel / DuckDB data sources | One-line interactive charts |
| ✅ Done | Filters, group lines, SQL row filtering | In-chart UI |
| 🚧 Planned | Streaming Excel reads | Large xlsx currently loads fully & synchronously |
| 🚧 Planned | Multiple Excel sheets | Currently reads the first sheet |
| 💡 Idea | More data sources | Parquet / JSON, etc. |

Issues and PRs welcome.

---

## 📄 License

[MIT](LICENSE) © 2026 mok

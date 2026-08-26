<div align="center">

# 📈 dsh-chartlab

**Data → Interactive Chart Lab · DeepSeek Harness plugin**

Turn local CSV, Excel (`.xlsx` / `.xls`), or DuckDB databases into zoomable, filterable, groupable interactive charts — smooth even on large data.

<p align="center">
  <a href="https://github.com/SMOKTEA/dsh-chartlab/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab/blob/master/LICENSE"><img alt="License MIT" src="https://img.shields.io/github/license/SMOKTEA/dsh-chartlab"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab"><img alt="Last commit" src="https://img.shields.io/github/last-commit/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://awesome-dsh-plugin.com"><img alt="Awesome DSH Plugin" src="https://awesome-dsh-plugin.com/badge.svg"></a>
</p>

</div>

<p align="center">
  <img src="assets/demo.jpeg" alt="dsh-chartlab demo" width="800">
</p>

> 中文文档：[README.md](README.md)

[[_TOC_]]

---

## Introduction

One line: **let the agent turn your data into a zoomable, filterable, groupable interactive chart.**

- **Three data sources** — a local CSV file, an Excel workbook (`.xlsx` / `.xls`), or a table inside a DuckDB database (`.duckdb` / `.ddb`). Just say it in chat.
- **Fast on large data** — data stays on the host; the chart fetches only the visible window, so zooming and panning stay smooth.
- **Full chart workbench** — line / scatter; box zoom, wheel zoom, drag-to-pan, hover readouts.
- **Filter · Group · SQL** — conditional filters, group rows by a column into multiple lines, or write SQL directly.
- **Native look & feel** — follows DSH's language (zh / en) and theme (dark / light) automatically, no reload needed.
- **Per-session isolation** — each conversation sees only its own charts; deleted sessions are cleaned up.

---

## ✨ Features

| Capability | Description |
|---|---|
| Data sources | CSV files, Excel workbooks (`.xlsx` / `.xls`), DuckDB database tables (`.duckdb` / `.ddb`); the DuckDB table name is optional and defaults to the first table |
| Chart types | Line, scatter |
| Interaction | Box zoom, wheel zoom, drag-to-pan, hover readouts, screenshot download |
| Filter · Group | Conditional filters (equal / not equal / range / multi-select, with date ranges); group rows by a column into multiple lines |
| SQL | Write SQL queries directly in the chart; paste multi-line SQL |
| Theme & language | Follows DSH dark / light theme and zh / en language |
| Session isolation | Each conversation is independent; deleted sessions are cleaned up |

---

## 🚀 Quick Start

```powershell
# Install (use a file: path for local development; use the npm package name after publishing)
dsh plugin --profile dev add file:/path/to/dsh-chartlab

# Start the dev profile's web UI
dsh --profile dev
```

Then just say in chat:

> **Draw a chart of `/path/to/your-data.csv` with dsh-chartlab**
>
> **Draw a chart of `/path/to/your-data.xlsx` with dsh-chartlab**
>
> **Draw a chart of the `sales` table in `/path/to/your-data.duckdb` with dsh-chartlab** (table name optional; defaults to the first table)

---

## 🛠️ Build

```powershell
npm install
npm run build
```

---

## 📄 License

[MIT](LICENSE) © 2026 mok

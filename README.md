<div align="center">

# 📊 dsh-chartlab

**CSV → 交互式图表实验台 · DeepSeek Harness 插件**

把本地 CSV 变成可缩放、可筛选、可分组的交互图表 —— 大文件不卡，原始数据不进上下文。

<p align="center">
  <a href="https://github.com/SMOKTEA/dsh-chartlab/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab/blob/master/LICENSE"><img alt="License MIT" src="https://img.shields.io/github/license/SMOKTEA/dsh-chartlab"></a>
  <a href="https://github.com/SMOKTEA/dsh-chartlab"><img alt="Last commit" src="https://img.shields.io/github/last-commit/SMOKTEA/dsh-chartlab?logo=github"></a>
  <a href="https://awesome-dsh-plugin.com"><img alt="Awesome DSH Plugin" src="https://awesome-dsh-plugin.com/badge.svg"></a>
</p>

</div>

---

## 中文简介

一句话：**让 Agent 帮你把 CSV 变成一张能缩放、能筛选、能分组的交互图表。**

- **Agent 一句话画图** —— `render_chart` 工具读取本地 CSV，只把列元数据返回给模型，**原始数据永不进入模型上下文**（省 token、不爆上下文）。
- **百万行也不卡** —— 数据留在宿主内存，浏览器按可视窗口按需取数 + LTTB 抽稀；缩放小窗口时保留全精度。
- **图表工作台** —— 折线/散点、框选缩放、滚轮缩放、拖拽平移、悬浮读数；**条件筛选**（`=` `!=` `>` `<` `between`，字符串多选 IN/NOT IN）、**分组多线**、**DuckDB SQL** 查询。
- **原生观感** —— 自动跟随 DSH 的语言（中/英）与主题（深/浅），打开图表页就像 DSH 自己的一部分；图表选项（X/Y/筛选/缩放）切 tab 不丢失。
- **按会话隔离** —— 每个对话只看自己的图表；删除会话时图表与缓存一并清理。
- **事件驱动，零轮询** —— Web UI 的 `chartLab` 标签页与自动跳转在会话事件到达时才刷新。

---

## ✨ 功能亮点

| 能力 | 说明 |
|---|---|
| **`render_chart` 工具** | 读取本地 CSV，返回 `chartId` + 列元数据；原始行不进入模型上下文 |
| **二进制数据通道** | 数值/日期列以原始 `Float64Array` 字节传输（`x-dsh-chartlab-meta` 头），无 JSON 开销 |
| **窗口化抽稀** | 全量数据留在宿主；按可视窗口 `x0..x1` 取数，超过 `MAX_POINTS = 5000` 才 LTTB 抽稀，小窗口全精度 |
| **筛选 + 分组 + SQL** | 结构化条件面板（多值 IN/NOT IN、日期范围）、分组多线（sum/avg/min/max/count）、DuckDB 查询（SELECT/WITH，聚合/排序等二次处理暂拒） |
| **交互图表页** | 列选择、折线/散点、框选缩放、x 轴滚轮缩放/拖拽平移、悬浮读数、截图下载（白底可读配色） |
| **跟随语言与主题** | 读取宿主 `<html lang>` 与 `data-ds-dark-theme`，中/英 + 深/浅实时切换，无需刷新 |
| **选项缓存** | X/Y、类型、分组、筛选、缩放窗口按 chartId 持久到 `localStorage`，iframe 重载后恢复 |
| **会话隔离与清理** | `/dsh-chartlab/list?session=<id>` 按会话取图；删除会话自动清理 localStorage 缓存与宿主内存图表 |
| **多行 SQL 归一化** | SQL 输入框支持粘贴多行 SQL，自动剥离注释并折叠为单行（字符串字面量感知，带完整测试） |

---

## 🚀 快速开始

```powershell
# 安装（本地开发用 file: 路径；发布后用 npm 包名）
dsh plugin --profile dev add file:/path/to/dsh-chartlab

# 启动 dev profile 的 Web UI
dsh --profile dev
```

然后在聊天里直接说：

> **画 /path/to/your-data.csv 的图**

Agent 调用 `render_chart` 后，侧边栏会出现 `chartLab` 标签页（新图自动跳转），也可以点回复里的 `/dsh-chartlab/view/<chartId>` 链接打开独立图表页。

---

## 📦 项目结构

```
dsh-chartlab/
  package.json          # main: lib/index.js; exports["."] + exports["./client"]; build; dsh.bundle.patch + dsh.client
  tsconfig.json         # NodeNext, strict, outDir: lib, rootDir: src
  cordis.patch.yml      # 把 dsh-chartlab 插入 profile 的 layer stack
  scripts/
    copy-client.mjs     # 构建步骤：复制 src/client/client.js → lib/client/client.js
  src/
    client/client.js    # 手写 DSH 客户端 bundle（__ModuleLoader__ 格式）：chartLab 标签页 + 自动跳转
    index.ts            # 插件入口：工具 + 路由（meta / groups / series / sql / bin / sample / full / view / list / purge）
    csv.ts              # 单遍列式 CSV 解析 + 类型推断 + 预览 + windowAndDecimate + groupSeries
    sql.ts              # DuckDB SQL 引擎（懒加载，仅 SELECT/WITH）
    sql-normalize.ts    # 多行 SQL → 单行归一化（源码内嵌进图表页，与测试共用同一实现）
    lttb.ts             # LTTB 抽稀（数值/索引两种变体）
    store.ts            # 内存图表注册表（按会话分桶）+ purgeSession
    view.ts             # 自包含交互图表页
    shims.d.ts          # @deepseek-ai/dsh-tools 松散声明
  lib/                  # 构建产物（tsc + 复制的客户端 bundle）—— 发布内容
    client/client.js
  test/                 # 本地测试（selftest / apply-test / sql-normalize-test / view-render-check 等，不入库）
```

`lib/` 是完整的发布载荷：`files` 只发布 `lib`、`cordis.patch.yml` 与 `README.md`，不掺 `src/` / `test/`。浏览器 bundle 由宿主经 `exports["./client"]` → `./lib/client/client.js` 解析。

---

## 🔨 构建

```powershell
npm install            # typescript + @types/node（devDeps）+ duckdb（依赖）
npm run build          # tsc → lib/，并把客户端 bundle 复制进 lib/client/
```

`duckdb` 采用懒加载（动态 import）：没有它插件也能正常启动，只有 SQL 查询需要该原生模块。

---

## 🚄 性能（单遍列式解析，Node 24）

| 数据 | 解析耗时 | 内存 |
|---|---|---|
| 300k 行 / 15.5 MB | **0.31 s** | 41.8 MB |
| 7.8M 行 / 405 MB（`big.csv`） | **7.9 s** | 556 MB |
| 884K 行真实数据（NYT COVID-19 2020） | **0.7 s** | ~45 MB |

---

## 📋 更新日志

**v0.1.0**
- 首版：`render_chart` 工具 + 二进制数据通道 + 自包含图表页 + Web UI `chartLab` 标签页
- 语言/主题实时跟随宿主；图表选项按 chartId 缓存；按会话隔离图表；删除会话自动清理；事件驱动零轮询

---

## 📄 License

[MIT](LICENSE) © 2026 mok

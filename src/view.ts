/**
 * Self-contained HTML interactive chart page, served at /dsh-chartlab/view/:chartId.
 *
 * The full data stays on the host. The page fetches column metadata
 * (/dsh-chartlab/data/:chartId/meta), then on every view change asks the host for
 * the CURRENT window (/dsh-chartlab/data/:chartId?columns=x,y&x0=..&x1=..&maxPoints=..&format=bin).
 * The host returns that window's rows, LTTB-decimated only when the window has
 * more than `maxPoints` rows — so zooming into a small region returns full
 * detail, and the browser never holds more than `maxPoints` points.
 *
 * Interaction: drag on the plot rubber-bands a region and zooms to it; drag on
 * the x-axis strip pans left/right; double-click resets.
 */

import { normalizeSqlSingleLine } from './sql-normalize.js'

export function viewPageHtml(): string {
  // The SQL normalizer is embedded by source so the browser runs the exact
  // function the unit tests exercise (it is written to be self-contained).
  const normalizeSrc = normalizeSqlSingleLine.toString()
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-chartlab</title>
<style>
  :root {
    color-scheme: light;
    --bg: #ffffff; --bg-bar: #f5f6f7; --border: #e1e5ee;
    --text: #1f2329; --text-dim: #6b7280;
    --input-bg: #ffffff; --input-border: #cfd3d6; --btn-hover: #eceff4;
    --accent: #4f6ef7; --accent-text: #4f6ef7; --accent-soft: rgba(79,110,247,.18);
    --panel-bg: #ffffff; --overlay-bg: rgba(255,255,255,.85);
    --tip-bg: rgba(255,255,255,.94); --legend-bg: rgba(255,255,255,.78);
    --gridline: rgba(107,114,128,.30); --danger: #e05d5d;
  }
  body[data-ds-dark-theme] {
    color-scheme: dark;
    --bg: #0f1115; --bg-bar: #171a21; --border: #262a33;
    --text: #e5e7eb; --text-dim: #9aa3b2;
    --input-bg: #1f232b; --input-border: #30353f; --btn-hover: #2a2f3a;
    --accent: #4f6ef7; --accent-text: #c6d0ff; --accent-soft: rgba(79,110,247,.18);
    --panel-bg: #1d2129; --overlay-bg: rgba(15,17,21,.4);
    --tip-bg: rgba(23,26,33,.88); --legend-bg: rgba(15,17,21,.72);
    --gridline: rgba(154,163,178,.32); --danger: #e05d5d;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body { margin: 0; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
  #bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 10px 14px;
         background: var(--bg-bar); border-bottom: 1px solid var(--border); flex: none; font-size: 12px; }
  #bar label { display: flex; gap: 6px; align-items: center; color: var(--text-dim); }
  input, button { height: 30px; box-sizing: border-box; background: var(--input-bg); color: var(--text);
                  border: 1px solid var(--input-border); border-radius: 6px; padding: 0 8px; font-size: 12px; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }
  input[type="date"] { color-scheme: inherit; }
  .csel-search:focus { outline: none; border-color: var(--accent); }
  button { cursor: pointer; }
  button:hover { background: var(--btn-hover); }
  /* custom dropdown (non-native) */
  .csel { position: relative; display: inline-block; z-index: 5; }
  .csel-main { height: 30px; min-width: 90px; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
               background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border); border-radius: 6px;
               padding: 0 8px; font-size: 12px; cursor: pointer; user-select: none; }
  .csel-main:hover { border-color: var(--accent); }
  .csel-main .csel-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csel-main .csel-arrow { margin-left: auto; width: 0; height: 0; border-left: 4px solid transparent;
                           border-right: 4px solid transparent; border-top: 5px solid var(--text-dim); flex: none; }
  .csel-main .csel-del { flex: none; width: 14px; height: 14px; display: inline-flex; align-items: center;
                         justify-content: center; border-radius: 50%; color: var(--text-dim); font-size: 11px;
                         cursor: pointer; line-height: 1; }
  .csel-main .csel-del:hover { color: var(--danger); background: var(--accent-soft); }
  .csel-main.open { border-color: var(--accent); }
  .csel-main.open .csel-arrow { transform: rotate(180deg); }
  .csel-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 1000; width: 100%; box-sizing: border-box;
                max-height: 240px; overflow-y: auto; background: var(--panel-bg); border: 1px solid var(--input-border);
                border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.5); display: none; }
  .csel-panel.open { display: block; }
  .csel-opt { padding: 6px 10px; font-size: 12px; color: var(--text); cursor: pointer; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
  .csel-opt:hover, .csel-opt.sel { background: var(--accent-soft); color: var(--accent-text); }
  .csel-opt .ck { flex: none; width: 14px; height: 14px; border: 1px solid var(--accent); border-radius: 3px;
                  display: inline-flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; }
  .csel-opt.on .ck { background: var(--accent); }
  .csel-search { width: calc(100% - 16px); margin: 6px 8px; height: 26px; box-sizing: border-box;
                 background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border); border-radius: 6px;
                 padding: 0 8px; font-size: 12px; }
  .csel-ops { display: flex; gap: 6px; padding: 0 8px 6px; }
  .csel-ops button { flex: 1; height: 20px; padding: 0; font-size: 11px; background: var(--input-bg); color: var(--text-dim);
                     border: 1px solid var(--input-border); border-radius: 5px; }
  .csel-ops button:hover { color: var(--accent-text); border-color: var(--accent); }
  .csel-list { }
  #status { margin-left: auto; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  #filterCount { background: var(--accent); color: #fff; border-radius: 9px; padding: 0 7px; font-size: 11px; line-height: 16px; margin-left: 4px; }
  #filterInfo { color: var(--accent); font-size: 12px; }
  #filterPanel { flex: none; padding: 10px 14px; background: var(--bg-bar); border-bottom: 1px solid var(--border); }
  .frow { display: inline-flex; gap: 6px; align-items: center; padding: 4px 0; vertical-align: middle; margin-bottom: 10px; }
  .frow + .frow { border-left: 1px solid var(--border); padding-left: 12px; margin-left: 4px; }
  .frow .csel-main { min-width: 90px; }
  .frow .frmv { flex: none; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
                background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0; font-size: 12px; line-height: 1; }
  .frow .frmv:hover { color: var(--danger); }
  #filterBtns { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #filterSqlLbl { color: var(--text-dim); font-size: 12px; margin-right: -6px; }
  #filterSql { flex: 1; min-width: 260px; height: 30px; min-height: 30px; box-sizing: border-box;
               background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border);
               border-radius: 6px; padding: 0 8px; font-size: 12px; line-height: 28px;
               resize: none; overflow: hidden; font-family: inherit; }
  #filterSql:focus { outline: none; border-color: var(--accent); }
  #filterSql::placeholder { color: var(--text-dim); opacity: 1; }
  #filterApplySql { height: 30px; }
  #filterMsg { color: var(--danger); font-size: 12px; }
  #wrap { position: relative; flex: 1; min-height: 0; touch-action: none; }
  #snapBtn { position: absolute; top: 8px; right: 14px; width: 26px; height: 26px; padding: 0; border-radius: 6px;
             background: var(--input-bg); color: var(--text-dim); border: 1px solid var(--input-border); font-size: 15px; line-height: 1;
             cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 4; }
  #snapBtn:hover { color: var(--accent-text); border-color: var(--accent); }
  #plot { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
  #loading { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center;
             gap: 10px; background: var(--overlay-bg); z-index: 3; }
  #loading .ld-ring { width: 30px; height: 30px; border: 3px solid rgba(79,110,247,.2); border-top-color: var(--accent);
                      border-radius: 50%; animation: dshSpin .8s linear infinite; }
  #loading .ld-text { color: var(--text-dim); font-size: 12px; }
  #tip { position: absolute; display: none; pointer-events: none; background: var(--tip-bg); border: 1px solid var(--input-border);
         border-radius: 6px; padding: 6px 9px; font-size: 12px; color: var(--text); white-space: nowrap; z-index: 2;
         backdrop-filter: blur(4px); }
  #hint { display: none; }
  #filterHint { flex: none; color: var(--text-dim); opacity: .8; font-size: 11px; background: var(--bg);
                border-bottom: 1px solid var(--border); padding: 6px 14px; }
  #filterToggleBar { flex: none; position: relative; height: 0; z-index: 6; }
  #filterToggle { position: absolute; left: 50%; top: -12px; transform: translateX(-50%); height: 24px; width: 44px;
                  padding: 0; border-radius: 999px; background: var(--panel-bg); color: var(--text-dim); border: 1px solid var(--border);
                  font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 3px; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  #filterToggle:hover { color: var(--accent-text); border-color: var(--accent); }
  #filterToggleIcon { color: var(--accent); font-size: 15px; line-height: 1; }
  #filterToggleCount { color: var(--accent); font-size: 11px; line-height: 1; }
</style>
</head>
<body>
<div id="bar">
  <label id="xLbl">X 轴 <span id="xHost"></span></label>
  <label id="yLbl">Y 轴 <span id="yHost"></span></label>
  <label id="typeLbl">类型 <span id="typeHost"></span></label>
  <label id="grpLbl">分组 <span id="grpHost"></span></label>
  <button type="button" id="clearFilters" style="display:none">清除条件</button>
  <span id="filterInfo" style="display:none"></span>
  <span id="status">加载中…</span>
</div>
<div id="filterToggleBar">
  <button type="button" id="filterToggle" title="展开/收起筛选条件"><span id="filterToggleIcon">▴</span><span id="filterToggleCount" style="display:none"></span></button>
</div>
<div id="filterPanel">
  <div id="filterBtns">
    <button type="button" id="addFilter">+ 添加条件</button>
    <span id="filterSqlLbl">SQL：</span>
    <textarea id="filterSql" rows="1" spellcheck="false" placeholder="WHERE state = 'New York' AND cases > 1000（可编辑，回车或点“应用 SQL”生效）"></textarea>
    <button type="button" id="filterApplySql">应用 SQL</button>
    <span id="filterMsg"></span>
  </div>
</div>
<div id="filterHint">x 轴滚轮缩放 · 框选区域缩放 · x 轴拖拽平移 · 双击复位 · 悬停查看数值</div>
<div id="wrap">
  <canvas id="plot"></canvas>
  <div id="loading"><div class="ld-ring"></div><div class="ld-text">加载数据中…</div></div>
  <button type="button" id="snapBtn" title="下载图表截图（白底）">⤓</button>
  <div id="tip"></div>
  <div id="hint">x 轴滚轮缩放 · 框选区域缩放 · x 轴拖拽平移 · 双击复位 · 悬停查看数值</div>
</div>
<script>
(function () {
  'use strict';
  var normalizeSqlSingleLine = ${normalizeSrc};
  var chartId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

  // ---- follow the DSH host's locale + theme (initial, then live) ----
  // Same-origin iframe: read the parent web app's <html lang> and dark-theme
  // marker so this page matches the host (中文/English, light/dark). The host's
  // ThemePresenter toggles body[data-ds-dark-theme] and the locale service sets
  // <html lang> at runtime, so we watch both and re-apply without a reload.
  var parentDoc = (window.parent && window.parent.document) ? window.parent.document : document;
  var isZh = String(parentDoc.documentElement.lang || document.documentElement.lang || navigator.language || '')
    .toLowerCase().indexOf('zh') === 0;
  var darkTheme = !!(parentDoc.body && parentDoc.body.hasAttribute('data-ds-dark-theme'))
    || document.body.hasAttribute('data-ds-dark-theme');
  function T(zh, en) { return isZh ? zh : en; }
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }
  // Canvas colors, re-resolved whenever the theme flips.
  var C = { border: '', text: '', dim: '', accent: '', gridline: '', legendBg: '', tickStroke: '' };
  function refreshTheme() {
    darkTheme = !!(parentDoc.body && parentDoc.body.hasAttribute('data-ds-dark-theme'));
    document.body.toggleAttribute('data-ds-dark-theme', darkTheme);
    C.border = cssVar('--border', '#30353f');
    C.text = cssVar('--text', '#e5e7eb');
    C.dim = cssVar('--text-dim', '#9aa3b2');
    C.accent = cssVar('--accent', '#4f6ef7');
    C.gridline = cssVar('--gridline', 'rgba(154,163,178,0.32)');
    C.legendBg = cssVar('--legend-bg', 'rgba(15,17,21,0.72)');
    C.tickStroke = cssVar('--border', '#4a5260');
    if (typeof scheduleRender === 'function') scheduleRender();
  }
  function refreshLocale() {
    isZh = String(parentDoc.documentElement.lang || document.documentElement.lang || navigator.language || '')
      .toLowerCase().indexOf('zh') === 0;
    if (parentDoc.documentElement.lang) document.documentElement.lang = parentDoc.documentElement.lang;
    if (typeof localizeStatic === 'function') localizeStatic();
    if (typeof typeSel !== 'undefined' && typeSel) {
      typeSel.setOptions([{ value: 'line', label: T('折线', 'Line') }, { value: 'scatter', label: T('散点', 'Scatter') }]);
      typeSel.setValue(typeSel.value);
      if (typeof grpSel !== 'undefined' && grpSel && typeof cols !== 'undefined') {
        grpSel.placeholder = T('(可选)', '(optional)');
        if (typeof grpDel !== 'undefined' && grpDel) grpDel.title = T('清除分组', 'Clear group');
        var gOpts2 = [];
        for (var gi2 = 0; gi2 < cols.length; gi2++) if (cols[gi2].type === 'string') gOpts2.push({ value: cols[gi2].name, label: cols[gi2].name });
        grpSel.setOptions(gOpts2);
        grpSel.setValue(grpSel.value);
        if (typeof syncGrpDel === 'function') syncGrpDel();
      }
      OP_LABELS = { '=': T('等于', 'equals'), '!=': T('不等于', 'not equals'), '>': T('大于', 'greater'), '>=': T('大于等于', '≥'), '<': T('小于', 'less'), '<=': T('小于等于', '≤'), 'between': T('范围', 'range') };
    }
    if (typeof updateFilterUI === 'function' && typeof filters !== 'undefined') updateFilterUI();
    if (typeof scheduleRender === 'function') scheduleRender();
  }
  function watchHostChrome() {
    if (parentDoc === document || typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function (muts) {
      for (var m = 0; m < muts.length; m++) {
        var change = muts[m];
        if (change.type !== 'attributes') continue;
        if (change.target === parentDoc.body && change.attributeName === 'data-ds-dark-theme') refreshTheme();
        else if (change.target === parentDoc.documentElement && change.attributeName === 'lang') refreshLocale();
      }
    });
    observer.observe(parentDoc.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    observer.observe(parentDoc.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  if (darkTheme) document.body.setAttribute('data-ds-dark-theme', '');
  if (parentDoc.documentElement.lang) document.documentElement.lang = parentDoc.documentElement.lang;
  refreshTheme();

  var canvas = document.getElementById('plot');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('wrap');
  var xLbl = document.getElementById('xLbl');
  var yLbl = document.getElementById('yLbl');
  var filterToggle = document.getElementById('filterToggle');
  var filterToggleIcon = document.getElementById('filterToggleIcon');
  var filterToggleCount = document.getElementById('filterToggleCount');
  var filterPanel = document.getElementById('filterPanel');
  var filterInfo = document.getElementById('filterInfo');
  var clearFiltersBtn = document.getElementById('clearFilters');
  var snapBtn = document.getElementById('snapBtn');
  var filterBtns = document.getElementById('filterBtns');
  var addFilter = document.getElementById('addFilter');
  var filterSql = document.getElementById('filterSql');
  var filterApplySql = document.getElementById('filterApplySql');
  var filterMsg = document.getElementById('filterMsg');
  var statusEl = document.getElementById('status');
  var tip = document.getElementById('tip');
  var loadingEl = document.getElementById('loading');

  // localize the static chrome (runs at load and again on locale change)
  var typeLbl = document.getElementById('typeLbl');
  var grpLbl = document.getElementById('grpLbl');
  function localizeStatic() {
    xLbl.childNodes[0].textContent = T('X 轴 ', 'X axis ');
    yLbl.childNodes[0].textContent = T('Y 轴 ', 'Y axis ');
    typeLbl.childNodes[0].textContent = T('类型 ', 'Type ');
    grpLbl.childNodes[0].textContent = T('分组 ', 'Group ');
    document.getElementById('clearFilters').textContent = T('清除条件', 'Clear filters');
    document.getElementById('filterToggle').title = T('展开/收起筛选条件', 'Toggle filter conditions');
    document.getElementById('addFilter').textContent = T('+ 添加条件', '+ Add condition');
    document.getElementById('filterSqlLbl').textContent = T('SQL：', 'SQL: ');
    document.getElementById('filterApplySql').textContent = T('应用 SQL', 'Apply SQL');
    document.getElementById('filterSql').placeholder = T(
      "WHERE state = 'New York' AND cases > 1000（可编辑，回车或点“应用 SQL”生效）",
      "WHERE state = 'New York' AND cases > 1000 (editable; Enter or “Apply SQL” to run)"
    );
    resizeSqlBox();
    document.getElementById('filterHint').textContent = T(
      'x 轴滚轮缩放 · 框选区域缩放 · x 轴拖拽平移 · 双击复位 · 悬停查看数值',
      'Wheel-zoom on x axis · drag-select to zoom · drag x axis to pan · double-click to reset · hover for values'
    );
    document.getElementById('hint').textContent = document.getElementById('filterHint').textContent;
    document.getElementById('snapBtn').title = T('下载图表截图（白底）', 'Download chart screenshot (white background)');
    loadingEl.querySelector('.ld-text').textContent = T('加载数据中…', 'Loading data…');
  }
  localizeStatic();

  function showLoading() { loadingEl.style.display = 'flex'; }
  function hideLoading() { loadingEl.style.display = 'none'; }

  // Hide the hover tooltip whenever the pointer leaves the plot surface (also
  // on fast exits where no mousemove lands outside the canvas).
  function hideTip() {
    tip.style.display = 'none';
    hoverIdx = -1;
    hoverX = null;
    scheduleRender();
  }

  var PAD_L = 70, PAD_R = 26, PAD_T = 12, PAD_B = 40;
  var MAX_POINTS = 5000;

  // ---- custom dropdown (non-native) ----
  // The option panel is appended to <body> and positioned with fixed
  // coordinates so no container overflow/stacking can clip or hide it.
  function customSelect(host, onChange) {
    var api = {};
    var main = document.createElement('div');
    main.className = 'csel-main';
    var label = document.createElement('span');
    label.className = 'csel-label';
    var arrow = document.createElement('span');
    arrow.className = 'csel-arrow';
    main.appendChild(label);
    main.appendChild(arrow);
    var panel = document.createElement('div');
    panel.className = 'csel-panel';
    var wrapEl = document.createElement('div');
    wrapEl.className = 'csel';
    wrapEl.appendChild(main);
    host.appendChild(wrapEl);
    document.body.appendChild(panel);

    api.options = [];
    api.value = '';
    api.placeholder = '';
    api.setOptions = function (opts) {
      api.options = opts;
      if (api.value === '' && opts.length > 0) api.value = opts[0].value;
      renderPanel();
      renderLabel();
    };
    api.setValue = function (v) { api.value = v; renderLabel(); };
    function optLabel(v) {
      for (var i = 0; i < api.options.length; i++) if (api.options[i].value === v) return api.options[i].label;
      return null;
    }
    function renderLabel() {
      var found = optLabel(api.value);
      if (found !== null) {
        label.textContent = found;
        label.style.color = '';
      } else {
        label.textContent = api.placeholder !== '' ? api.placeholder : api.value;
        label.style.color = '#5c6572';
      }
    }
    function renderPanel() {
      panel.innerHTML = '';
      for (var i = 0; i < api.options.length; i++) {
        (function (o) {
          var d = document.createElement('div');
          d.className = 'csel-opt' + (o.value === api.value ? ' sel' : '');
          d.textContent = o.label;
          d.addEventListener('mousedown', function (e) {
            e.preventDefault();
            api.setValue(o.value);
            close();
            onChange(o.value);
          });
          panel.appendChild(d);
        })(api.options[i]);
      }
    }
    function open() {
      renderPanel();
      // measure option widths off-screen (width:auto so options size to content)
      panel.style.position = 'fixed';
      panel.style.left = '-9999px';
      panel.style.top = '0';
      panel.style.width = 'auto';
      panel.style.minWidth = '0';
      panel.style.display = 'block';
      var maxW = 90;
      var optEls = panel.querySelectorAll('.csel-opt');
      for (var i = 0; i < optEls.length; i++) {
        var ow = optEls[i].offsetWidth || 0;
        if (ow > maxW) maxW = ow;
      }
      var srch = panel.querySelector('.csel-search');
      if (srch && srch.offsetWidth > maxW) maxW = srch.offsetWidth;
      main.style.width = (maxW + 10) + 'px';
      var rect = main.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top = (rect.bottom + 4) + 'px';
      panel.style.width = rect.width + 'px';
      panel.style.maxWidth = '360px';
      main.classList.add('open');
    }
    function close() {
      panel.style.display = 'none';
      main.classList.remove('open');
    }
    main.addEventListener('click', function () {
      if (main.classList.contains('open')) close();
      else { open(); }
    });
    document.addEventListener('click', function (e) {
      if (!wrapEl.contains(e.target) && !panel.contains(e.target)) close();
    });
    api.main = main;
    api.close = close;
    return api;
  }

  // ---- multi-select dropdown (string-column filter values) ----
  function multiSelect(host, onChange) {
    var api = {};
    var main = document.createElement('div');
    main.className = 'csel-main';
    var label = document.createElement('span');
    label.className = 'csel-label';
    var arrow = document.createElement('span');
    arrow.className = 'csel-arrow';
    main.appendChild(label);
    main.appendChild(arrow);
    var panel = document.createElement('div');
    panel.className = 'csel-panel';
    var wrapEl = document.createElement('div');
    wrapEl.className = 'csel';
    wrapEl.appendChild(main);
    host.appendChild(wrapEl);
    document.body.appendChild(panel);

    api.options = [];
    api.values = [];
    api.setOptions = function (opts) { api.options = opts; renderPanel(); renderLabel(); };
    api.setValues = function (vals) { api.values = vals.slice(); renderPanel(); renderLabel(); };

    function optLabel(v) {
      for (var i = 0; i < api.options.length; i++) if (api.options[i].value === v) return api.options[i].label;
      return v;
    }
    function renderLabel() {
      if (api.values.length === 0) { label.textContent = T('选择…', 'Select…'); label.style.color = '#5c6572'; }
      else if (api.values.length === 1) { label.textContent = optLabel(api.values[0]); label.style.color = ''; }
      else { label.textContent = isZh ? '已选 ' + api.values.length + ' 项' : api.values.length + ' selected'; label.style.color = ''; }
    }
    function renderPanel() {
      panel.innerHTML = '';
      var search = document.createElement('input');
      search.type = 'text';
      search.className = 'csel-search';
      search.placeholder = T('搜索过滤…', 'Search…');
      search.addEventListener('keydown', function (e) { e.stopPropagation(); });
      search.addEventListener('click', function (e) { e.stopPropagation(); });
      search.addEventListener('input', function () { renderOptions(search.value.trim().toLowerCase()); });
      panel.appendChild(search);

      // select all / invert / clear
      var ops = document.createElement('div');
      ops.className = 'csel-ops';
      function mkOp(txt, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = txt;
        b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
        ops.appendChild(b);
      }
      mkOp(T('全选', 'Select all'), function () {
        api.values = api.options.map(function (o) { return o.value; });
        renderPanel(); renderLabel(); onChange(api.values.slice());
      });
      mkOp(T('反选', 'Invert'), function () {
        var inv = [];
        for (var i = 0; i < api.options.length; i++) {
          if (api.values.indexOf(api.options[i].value) < 0) inv.push(api.options[i].value);
        }
        api.values = inv;
        renderPanel(); renderLabel(); onChange(api.values.slice());
      });
      mkOp(T('清空', 'Clear'), function () {
        api.values = [];
        renderPanel(); renderLabel(); onChange(api.values.slice());
      });
      panel.appendChild(ops);

      var listDiv = document.createElement('div');
      listDiv.className = 'csel-list';
      panel.appendChild(listDiv);
      renderOptions('');
    }
    function renderOptions(q) {
      var listDiv = panel.querySelector('.csel-list');
      if (!listDiv) return;
      listDiv.innerHTML = '';
      for (var i = 0; i < api.options.length; i++) {
        (function (o) {
          if (q && o.label.toLowerCase().indexOf(q) < 0) return;
          var d = document.createElement('div');
          var on = api.values.indexOf(o.value) >= 0;
          d.className = 'csel-opt' + (on ? ' on' : '');
          var ck = document.createElement('span');
          ck.className = 'ck';
          ck.textContent = on ? '✓' : '';
          var tx = document.createElement('span');
          tx.textContent = o.label;
          d.appendChild(ck);
          d.appendChild(tx);
          d.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var idx = api.values.indexOf(o.value);
            if (idx >= 0) api.values.splice(idx, 1);
            else api.values.push(o.value);
            renderPanel();
            renderLabel();
            onChange(api.values.slice());
          });
          listDiv.appendChild(d);
        })(api.options[i]);
      }
    }
    function close() { panel.style.display = 'none'; main.classList.remove('open'); }
    function open() {
      renderPanel();
      // measure option widths off-screen (width:auto so options size to content)
      panel.style.position = 'fixed';
      panel.style.left = '-9999px';
      panel.style.top = '0';
      panel.style.width = 'auto';
      panel.style.minWidth = '0';
      panel.style.display = 'block';
      var maxW = 90;
      var optEls = panel.querySelectorAll('.csel-opt');
      for (var i = 0; i < optEls.length; i++) {
        var ow = optEls[i].offsetWidth || 0;
        if (ow > maxW) maxW = ow;
      }
      var srch = panel.querySelector('.csel-search');
      if (srch && srch.offsetWidth > maxW) maxW = srch.offsetWidth;
      main.style.width = (maxW + 10) + 'px';
      var rect = main.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top = (rect.bottom + 4) + 'px';
      panel.style.width = rect.width + 'px';
      panel.style.maxWidth = '360px';
      main.classList.add('open');
    }
    main.addEventListener('click', function () {
      if (main.classList.contains('open')) close();
      else { open(); var s = panel.querySelector('.csel-search'); if (s) s.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!wrapEl.contains(e.target) && !panel.contains(e.target)) close();
    });
    api.close = close;
    return api;
  }

  // ---- axis / group selectors ----
  var xSel = customSelect(document.getElementById('xHost'), function () { saveOpts(); resetView(xSel.value); });
  var ySel = customSelect(document.getElementById('yHost'), function () { saveOpts(); loadWindow(); });
  var typeSel = customSelect(document.getElementById('typeHost'), function () { saveOpts(); render(); });
  var grpSel = customSelect(document.getElementById('grpHost'), function () { grpCol = grpSel.value; saveOpts(); syncGrpDel(); resetView(xSel.value); });
  typeSel.setOptions([{ value: 'line', label: T('折线', 'Line') }, { value: 'scatter', label: T('散点', 'Scatter') }]);
  typeSel.setValue('line');
  grpSel.setOptions([]);
  grpSel.setValue('');
  grpSel.placeholder = T('(可选)', '(optional)');
  // Delete icon at the far right of the group box: clears the group selection.
  var grpDel = document.createElement('span');
  grpDel.className = 'csel-del';
  grpDel.textContent = '✕';
  grpDel.title = T('清除分组', 'Clear group');
  grpDel.style.display = 'none';
  grpDel.addEventListener('mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (grpCol === '') return;
    grpCol = '';
    grpSel.setValue('');
    saveOpts();
    syncGrpDel();
    resetView(xSel.value);
  });
  grpDel.addEventListener('click', function (e) { e.stopPropagation(); });
  grpSel.main.appendChild(grpDel);
  function syncGrpDel() {
    if (grpSel && grpSel.main) {
      var del = grpSel.main.querySelector('.csel-del');
      if (del) del.style.display = grpCol === '' ? 'none' : '';
    }
  }

  var cols = [];
  var rowCount = 0;
  var suggestedY = '';
  var X = null;          // Float64Array (current window x, single mode)
  var Y = null;          // Float64Array (current window y, single mode)
  var xMin = null, xMax = null;  // full range of the current x column
  var view = { x0: null, x1: null };
  var selection = null;  // rubber-band { x0, x1 } in canvas pixel coords
  var panning = null;    // { x, x0, x1 } x-axis pan state
  var fetchToken = 0;
  var rafPending = false;
  var wheelTimer = null;
  var filters = [];      // active row filters: [{column, op, values: []}]
  var grpCol = '';       // active group column ('' = single series)
  var series = null;     // { groups: [{name,count,x,y}], total, shown } — group mode
  var hoverIdx = -1;     // single-mode hover point index (for highlight dot)
  var hoverX = null;     // group-mode hover x value

  // ---- view options persistence (X/Y/type/group/filters/zoom) ----
  // Saved per chartId so an iframe remount (tab switch, new chart) restores the
  // previous selection instead of resetting to the defaults.
  var OPT_KEY = 'dsh-chartlab:opts:' + chartId;
  function saveOpts() {
    try {
      localStorage.setItem(OPT_KEY, JSON.stringify({
        x: xSel.value, y: ySel.value, type: typeSel.value, group: grpCol,
        filters: filters, x0: view.x0, x1: view.x1
      }));
    } catch (e) { /* storage unavailable; ignore */ }
  }
  function loadOpts() {
    try {
      var raw = localStorage.getItem(OPT_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }

  var PALETTE = ['#4f6ef7', '#f2a63b', '#3bb273', '#e05d5d', '#8e7cc3', '#37b6c9', '#d18a3f',
                 '#7b68a0', '#c9446f', '#5aa469', '#e8c547', '#6f7c8a', '#b04f9e', '#4c8c4a',
                 '#c95c5c', '#3f7fbf', '#d9a5b3', '#5a9b8f'];

  function col(name) { for (var i = 0; i < cols.length; i++) if (cols[i].name === name) return cols[i]; return null; }

  function hasData() {
    return grpCol ? !!(series && series.groups && series.groups.length > 0) : !!(X && Y && X.length > 0);
  }

  function fmtNum(v) {
    var neg = v < 0;
    var s = Math.round(Math.abs(v)).toString();
    var out = s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    return neg ? '-' + out : out;
  }

  function fmt(col, v) {
    if (col.type === 'date') return new Date(v).toLocaleString();
    if (v === Math.floor(v) && Math.abs(v) < 1e15) return fmtNum(v);
    return Math.abs(v) >= 1000 ? fmtNum(v) : v.toPrecision(4);
  }

  // Index of the element whose value is closest to v (X sorted ascending).
  function nearestIndexX(arr, v, n) {
    if (n === 0) return -1;
    var lo = 0, hi = n - 1, best = 0, bestD = Infinity;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      var dist = Math.abs(arr[m] - v);
      if (dist < bestD) { bestD = dist; best = m; }
      if (arr[m] < v) lo = m + 1; else hi = m - 1;
    }
    return best;
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  // Rubber-band selection overlay: subtle vertical gray gradient + dashed outline.
  function drawSelection(sx0, sx1, ph) {
    var grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + ph);
    grad.addColorStop(0, 'rgba(154, 163, 178, 0.14)');
    grad.addColorStop(1, 'rgba(154, 163, 178, 0.04)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx0, PAD_T, sx1 - sx0, ph, 4);
    else ctx.rect(sx0, PAD_T, sx1 - sx0, ph);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154, 163, 178, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx0, PAD_T, sx1 - sx0, ph, 4);
    else ctx.rect(sx0, PAD_T, sx1 - sx0, ph);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function render() {
    var W = wrap.clientWidth, H = wrap.clientHeight;
    if (W === 0 || H === 0) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (grpCol) { renderSeries(); return; }
    if (!X || !Y) { statusEl.textContent = T('加载中…', 'Loading…'); return; }
    var xCol = col(xSel.value);
    var yCol = col(ySel.value);
    if (!xCol || !yCol) { statusEl.textContent = T('加载中…', 'Loading…'); return; }

    var n = Y.length;
    if (n === 0) { window.__lastDrawn = null; statusEl.textContent = filters.length > 0 ? T('筛选条件无匹配数据（可调整或清除条件）', 'No matching rows — adjust or clear filters') : T('视窗内无数据点', 'No data points in view'); return; }
    var lo = view.x0, hi = view.x1;
    if (lo === null || hi === null || hi === lo) { statusEl.textContent = T('视窗内无数据点', 'No data points in view'); return; }

    var ymin = Infinity, ymax = -Infinity;
    for (var i = 0; i < n; i++) { var v = Y[i]; if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
    if (!isFinite(ymin)) { statusEl.textContent = T('Y 列无有效数值', 'Y column has no valid values'); return; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    else { var ypad = (ymax - ymin) * 0.05 || 1; ymin -= ypad; ymax += ypad; }

    var pw = W - PAD_L - PAD_R, ph = H - PAD_T - PAD_B;
    var sx = function (v) { return PAD_L + (v - lo) / (hi - lo) * pw; };
    var sy = function (v) { return PAD_T + (1 - (v - ymin) / (ymax - ymin)) * ph; };

    ctx.strokeStyle = C.border; ctx.fillStyle = C.dim;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, PAD_T + ph); ctx.lineTo(PAD_L + pw, PAD_T + ph); ctx.stroke();
    var ticks = 5;
    for (var t = 0; t <= ticks; t++) {
      var yv = ymin + (ymax - ymin) * (t / ticks);
      ctx.fillText(fmt(yCol, yv), 6, sy(yv));
      ctx.strokeStyle = C.tickStroke;
      ctx.beginPath(); ctx.moveTo(PAD_L - 8, sy(yv)); ctx.lineTo(PAD_L, sy(yv)); ctx.stroke();
      // horizontal dashed gridline
      ctx.save();
      ctx.strokeStyle = C.gridline;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, sy(yv));
      ctx.lineTo(PAD_L + pw, sy(yv));
      ctx.stroke();
      ctx.restore();
    }
    for (var u = 0; u <= ticks; u++) {
      var xv = lo + (hi - lo) * (u / ticks);
      ctx.textAlign = u === 0 ? 'left' : u === ticks ? 'right' : 'center';
      ctx.fillText(fmt(xCol, xv), sx(xv), PAD_T + ph + 18);
    }
    ctx.textAlign = 'left';

    ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent;
    if (typeSel.value === 'line') {
      ctx.beginPath();
      for (var li = 0; li < n; li++) { var px = sx(X[li]), py = sy(Y[li]); if (li === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    } else {
      for (var si = 0; si < n; si++) { ctx.fillRect(sx(X[si]) - 1.5, sy(Y[si]) - 1.5, 3, 3); }
    }

    // highlight the hovered point
    if (hoverIdx >= 0 && hoverIdx < n) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(X[hoverIdx]), sy(Y[hoverIdx]), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (selection) {
      var sx0 = Math.min(selection.x0, selection.x1), sx1 = Math.max(selection.x0, selection.x1);
      drawSelection(sx0, sx1, ph);
    }

    window.__lastDrawn = { X: X, Y: Y, n: n, sx: sx, sy: sy, xCol: xCol, yCol: yCol, lo: lo, hi: hi };
    statusEl.textContent = 'rows=' + rowCount + (isZh ? ' 窗口=' : ' window=') + n + ' x=[' + fmt(xCol, lo) + ' … ' + fmt(xCol, hi) + ']';
  }

  // Legend, right-aligned inside the plot area. Each item is [color] name,
  // drawn fully inside the canvas (text starts after the swatch), long names are
  // truncated, and the item count adapts to the available height.
  function drawLegend(names, ph, total) {
    var W = wrap.clientWidth;
    var maxW = Math.min(220, W - PAD_L - PAD_R - 24);
    var itemH = 18;
    var maxItems = Math.max(1, Math.floor((ph - 10) / itemH));
    if (maxItems > 20) maxItems = 20;
    var shown = Math.min(names.length, maxItems);
    var lx = W - PAD_R - 12;
    var ly = PAD_T + 8;
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    for (var i = 0; i < shown; i++) {
      var nm = names[i];
      if (nm.length > 24) nm = nm.slice(0, 23) + '…';
      var tw = ctx.measureText(nm).width;
      if (tw > maxW - 16) {
        nm = nm.slice(0, Math.max(1, Math.floor((maxW - 16) / 6))) + '…';
        tw = ctx.measureText(nm).width;
      }
      var itemLeft = lx - 12 - tw;
      var mid = ly + Math.floor(itemH / 2); // vertical center of the row
      ctx.fillStyle = C.legendBg;
      ctx.fillRect(itemLeft - 2, ly, tw + 16, itemH - 2);
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(itemLeft, mid - 4, 8, 8);
      ctx.fillStyle = C.text;
      ctx.fillText(nm, itemLeft + 12, mid);
      ly += itemH;
    }
    var hidden = (total !== undefined && total > 0)
      ? Math.max(0, total - shown)
      : Math.max(0, names.length - shown);
    if (hidden > 0) {
      var tail = T('… 等 ', '… and ') + hidden + T(' 个分组', ' more groups');
      ctx.fillStyle = C.dim;
      ctx.fillText(tail, lx - 12 - ctx.measureText(tail).width, ly + 9);
    }
  }

  function renderSeries() {
    var W = wrap.clientWidth, H = wrap.clientHeight;
    if (!series || series.groups.length === 0) { window.__lastDrawn = null; statusEl.textContent = filters.length > 0 ? T('筛选条件无匹配数据', 'No matching rows — adjust or clear filters') : T('视窗内无数据', 'No data in view'); return; }
    var xCol = col(xSel.value), yCol = col(ySel.value);
    if (!xCol || !yCol) { statusEl.textContent = T('加载中…', 'Loading…'); return; }
    var lo = view.x0, hi = view.x1;
    if (lo === null || hi === null || hi === lo) { statusEl.textContent = T('视窗内无数据', 'No data in view'); return; }
    var pw = W - PAD_L - PAD_R, ph = H - PAD_T - PAD_B;
    if (pw <= 0 || ph <= 0) return;

    var ymin = Infinity, ymax = -Infinity;
    for (var g = 0; g < series.groups.length; g++) {
      var yArr = series.groups[g].y;
      for (var i = 0; i < yArr.length; i++) {
        var v = yArr[i];
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
    if (!isFinite(ymin)) { statusEl.textContent = T('Y 列无有效数值', 'Y column has no valid values'); return; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    else { var ypad = (ymax - ymin) * 0.05 || 1; ymin -= ypad; ymax += ypad; }

    var sx = function (v) { return PAD_L + (v - lo) / (hi - lo) * pw; };
    var sy = function (v) { return PAD_T + (1 - (v - ymin) / (ymax - ymin)) * ph; };

    ctx.strokeStyle = C.border; ctx.fillStyle = C.dim;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, PAD_T + ph); ctx.lineTo(PAD_L + pw, PAD_T + ph); ctx.stroke();
    var ticks = 5;
    for (var t = 0; t <= ticks; t++) {
      var yv = ymin + (ymax - ymin) * (t / ticks);
      ctx.fillText(fmt(yCol, yv), 6, sy(yv));
      ctx.strokeStyle = C.tickStroke;
      ctx.beginPath(); ctx.moveTo(PAD_L - 8, sy(yv)); ctx.lineTo(PAD_L, sy(yv)); ctx.stroke();
      // horizontal dashed gridline
      ctx.save();
      ctx.strokeStyle = C.gridline;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, sy(yv));
      ctx.lineTo(PAD_L + pw, sy(yv));
      ctx.stroke();
      ctx.restore();
    }
    for (var u = 0; u <= ticks; u++) {
      var xv = lo + (hi - lo) * (u / ticks);
      ctx.textAlign = u === 0 ? 'left' : u === ticks ? 'right' : 'center';
      ctx.fillText(fmt(xCol, xv), sx(xv), PAD_T + ph + 18);
    }
    ctx.textAlign = 'left';

    var scatter = typeSel.value === 'scatter';
    ctx.lineWidth = 1.5;
    for (var g2 = 0; g2 < series.groups.length; g2++) {
      var grp = series.groups[g2];
      if (!grp.x || grp.x.length === 0) continue;
      ctx.strokeStyle = PALETTE[g2 % PALETTE.length];
      ctx.fillStyle = PALETTE[g2 % PALETTE.length];
      ctx.beginPath();
      for (var li = 0; li < grp.x.length; li++) {
        var px = sx(grp.x[li]), py = sy(grp.y[li]);
        if (scatter) ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
        else if (li === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (!scatter) ctx.stroke();
    }

    // legend: when too many groups, show the 5 largest + 5 smallest by row count
    var legendGroups = series.groups;
    if (series.groups.length > 15) {
      var sorted = series.groups.slice().sort(function (a, b) { return b.count - a.count; });
      legendGroups = sorted.slice(0, 5).concat(sorted.slice(sorted.length - 5));
    }
    drawLegend(legendGroups.map(function (gr) { return gr.name + ' (' + gr.count + ')'; }), ph, series.total);

    // highlight the hovered x on the shown groups
    if (hoverX !== null) {
      for (var hg = 0; hg < legendGroups.length; hg++) {
        var hgrp = legendGroups[hg];
        if (!hgrp.x || hgrp.x.length === 0) continue;
        var hi2 = nearestIndexX(hgrp.x, hoverX, hgrp.x.length);
        if (hi2 < 0) continue;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = PALETTE[hg % PALETTE.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx(hgrp.x[hi2]), sy(hgrp.y[hi2]), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (selection) {
      var sx0 = Math.min(selection.x0, selection.x1), sx1 = Math.max(selection.x0, selection.x1);
      drawSelection(sx0, sx1, ph);
    }

    window.__lastDrawn = { series: series, sx: sx, sy: sy, xCol: xCol, yCol: yCol, lo: lo, hi: hi };
    statusEl.textContent = 'rows=' + rowCount + (isZh ? ' 组数=' : ' groups=') + series.total +
      (series.shown < series.total ? (isZh ? '（显示前 ' + series.shown + ' 组）' : ' (showing first ' + series.shown + ' groups)') : '') +
      ' x=[' + fmt(xCol, lo) + ' … ' + fmt(xCol, hi) + ']';
  }

  function fillSelects(colsArr) {
    var numOpts = [], dateOpts = [], strCols = [];
    for (var i = 0; i < colsArr.length; i++) {
      var c = colsArr[i];
      if (c.type === 'string') { strCols.push(c.name); continue; }
      if (c.type === 'number') numOpts.push(c.name);
      if (c.type === 'date') dateOpts.push(c.name);
    }
    var xOpts = [];
    for (var j = 0; j < colsArr.length; j++) {
      var cj = colsArr[j];
      if (cj.type !== 'string') xOpts.push({ value: cj.name, label: cj.name });
    }
    var yOpts = numOpts.map(function (n) { return { value: n, label: n }; });
    var x = dateOpts[0] || numOpts[0] || '';
    var y = numOpts.filter(function (n) { return n !== x; })[0] || numOpts[0] || '';
    xSel.setOptions(xOpts);
    ySel.setOptions(yOpts);
    if (x) xSel.setValue(x);
    if (y) ySel.setValue(y);
    var gOpts = [];
    for (var s = 0; s < strCols.length; s++) gOpts.push({ value: strCols[s], label: strCols[s] });
    grpSel.setOptions(gOpts);
    grpSel.setValue('');
    syncGrpDel();
    xLbl.style.display = x ? '' : 'none';
    yLbl.style.display = y ? '' : 'none';
    return { x: x, y: y };
  }

  function filtersQuery() {
    if (!filters || filters.length === 0) return '';
    return '&filters=' + encodeURIComponent(JSON.stringify(filters));
  }

  async function fetchSeries(xName, yName, x0, x1, maxPoints) {
    var q = 'group=' + encodeURIComponent(grpCol) +
            '&x=' + encodeURIComponent(xName) + '&y=' + encodeURIComponent(yName) +
            '&x0=' + x0 + '&x1=' + x1 + '&maxPoints=' + maxPoints + '&maxGroups=100&agg=sum' + filtersQuery();
    var res = await fetch('/dsh-chartlab/data/' + encodeURIComponent(chartId) + '/series?' + q);
    if (!res.ok) throw new Error('series fetch failed ' + res.status);
    return res.json();
  }

  async function fetchBin(xName, yName, x0, x1, maxPoints) {
    var q = 'columns=' + encodeURIComponent(xName) + ',' + encodeURIComponent(yName) +
            '&x0=' + x0 + '&x1=' + x1 + '&maxPoints=' + maxPoints + '&format=bin' + filtersQuery();
    var res = await fetch('/dsh-chartlab/data/' + encodeURIComponent(chartId) + '?' + q);
    if (!res.ok) throw new Error('binary fetch failed ' + res.status);
    var meta = JSON.parse(res.headers.get('x-dsh-chartlab-meta'));
    var buf = await res.arrayBuffer();
    var out = {};
    for (var c = 0; c < meta.columns.length; c++) {
      var col = meta.columns[c];
      out[col.name] = new Float64Array(buf, col.offset, meta.rowCount);
    }
    return { x: out[xName], y: out[yName] };
  }

  async function loadWindow() {
    var xName = xSel.value, yName = ySel.value;
    if (!xName || !yName) return;
    if (view.x0 === null || view.x1 === null) return;
    var token = ++fetchToken;
    showLoading();
    statusEl.textContent = T('加载数据中…', 'Loading data…');
    try {
      if (grpCol) {
        var s = await fetchSeries(xName, yName, view.x0, view.x1, MAX_POINTS);
        if (token !== fetchToken) return;
        series = s; X = null; Y = null;
      } else {
        var d = await fetchBin(xName, yName, view.x0, view.x1, MAX_POINTS);
        if (token !== fetchToken) return;
        X = d.x; Y = d.y; series = null;
      }
      hideLoading();
      render();
    } catch (e) {
      if (token === fetchToken) hideLoading();
      statusEl.textContent = T('加载失败: ', 'Load failed: ') + e.message;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only zoom when the cursor is over the x-axis strip (bottom band).
    var p = canvasPos(e);
    var plotBottom = PAD_T + p.rect.height - PAD_B;
    if (p.y < plotBottom) return;
    if (!hasData() || view.x0 === null || xMin === null || xMax === null) return;
    var rect = canvas.getBoundingClientRect();
    var plotW = rect.width - PAD_L - PAD_R;
    if (plotW <= 0) return;
    var fx = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD_L) / plotW));
    var span = view.x1 - view.x0;
    var factor = e.deltaY < 0 ? 0.8 : 1.25;
    var nspan = span * factor;
    var fullSpan = xMax - xMin;
    if (fullSpan <= 0) return;
    var minSpan = fullSpan / 1e12;   // only guards against float underflow — no practical zoom-in cap
    if (nspan < minSpan) nspan = minSpan;
    if (nspan > fullSpan) nspan = fullSpan;  // zoom-out boundary: the full range
    var anchor = view.x0 + fx * span;
    var nx0 = anchor - fx * nspan;
    var nx1 = nx0 + nspan;
    if (nx0 < xMin) { nx0 = xMin; nx1 = nx0 + nspan; }
    if (nx1 > xMax) { nx1 = xMax; nx0 = nx1 - nspan; }
    view.x0 = nx0; view.x1 = nx1;
    scheduleRender();
    saveOpts();
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(loadWindow, 250);
  }

  function canvasPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect: rect };
  }

  function onDown(e) {
    if (!hasData() || view.x0 === null) return;
    var p = canvasPos(e);
    var plotBottom = PAD_T + p.rect.height - PAD_B;
    if (p.y >= plotBottom) {
      panning = { x: e.clientX, x0: view.x0, x1: view.x1 };
    } else if (p.y >= PAD_T && p.x >= PAD_L) {
      selection = { x0: p.x, x1: p.x };
      tip.style.display = 'none';
    }
  }

  function onMove(e) {
    // ignore hover while the cursor is over the download button
    if (e.target && snapBtn.contains(e.target)) {
      hideTip();
      return;
    }
    if (panning) {
      var rect = canvas.getBoundingClientRect();
      var pw = rect.width - PAD_L - PAD_R;
      if (pw <= 0) return;
      var span = panning.x1 - panning.x0;
      var px = (panning.x - e.clientX) / pw * span;
      var nx0 = panning.x0 + px, nx1 = panning.x1 + px;
      if (xMin !== null && xMax !== null) {
        if (nx0 < xMin) { nx0 = xMin; nx1 = nx0 + span; }
        if (nx1 > xMax) { nx1 = xMax; nx0 = nx1 - span; }
      }
      view.x0 = nx0; view.x1 = nx1;
      scheduleRender();
      saveOpts();
      return;
    }
    if (selection) {
      var p = canvasPos(e);
      selection.x1 = p.x;
      scheduleRender();
      return;
    }
    var d = window.__lastDrawn;
    if (!d) { canvas.style.cursor = 'default'; return; }
    var p2 = canvasPos(e);
    var rect = canvas.getBoundingClientRect();
    var pw = rect.width - PAD_L - PAD_R, ph = rect.height - PAD_T - PAD_B;
    // x-axis strip: show a horizontal-resize (drag) cursor
    var plotBottom = PAD_T + rect.height - PAD_B;
    canvas.style.cursor = (p2.y >= plotBottom && p2.x >= PAD_L && p2.x <= PAD_L + pw) ? 'ew-resize' : 'default';
    if (p2.x < PAD_L || p2.x > PAD_L + pw || p2.y < PAD_T || p2.y > PAD_T + ph) {
      hideTip();
      return;
    }
    var xVal = d.lo + (p2.x - PAD_L) / pw * (d.hi - d.lo);
    var tol = (d.hi - d.lo) * 0.02; // only show points actually near the cursor
    if (d.series) {
      // multi-line tooltip: nearest x value of every group line; when there are
      // many groups, show the 5 largest and 5 smallest values at this x.
      hoverX = xVal;
      hoverIdx = -1;
      var items = [];
      var bestX = null;
      var bestDist = Infinity;
      for (var sg = 0; sg < d.series.groups.length; sg++) {
        var sgrp = d.series.groups[sg];
        if (!sgrp.x || sgrp.x.length === 0) continue;
        var sidx = nearestIndexX(sgrp.x, xVal, sgrp.x.length);
        var sdist = Math.abs(sgrp.x[sidx] - xVal);
        if (sdist < bestDist) { bestDist = sdist; bestX = sgrp.x[sidx]; }
        if (sdist > tol) continue; // this group has no point near the cursor
        items.push({ name: sgrp.name, y: sgrp.y[sidx], x: sgrp.x[sidx], color: PALETTE[sg % PALETTE.length] });
      }
      scheduleRender();
      if (items.length === 0) { tip.style.display = 'none'; hoverX = null; return; }
      var lines2 = [fmt(d.xCol, bestX !== null ? bestX : xVal)];
      var skipped = 0;
      if (items.length > 15) {
        items.sort(function (a, b) { return b.y - a.y; });
        var top5 = items.slice(0, 5);
        var bottom5 = items.slice(items.length - 5);
        skipped = items.length - top5.length - bottom5.length;
        lines2.push(T('最大的 5 个组', 'Largest 5 groups'));
        for (var ti = 0; ti < top5.length; ti++) {
          lines2.push('<span style="color:' + top5[ti].color + '">●</span> ' + top5[ti].name + ': ' + fmt(d.yCol, top5[ti].y));
        }
        if (skipped > 0) lines2.push('<span style="color:' + C.dim + '">' + T('… 等 ', '… and ') + skipped + T(' 组', ' more') + '</span>');
        lines2.push(T('最小的 5 个组', 'Smallest 5 groups'));
        for (var bi = 0; bi < bottom5.length; bi++) {
          lines2.push('<span style="color:' + bottom5[bi].color + '">●</span> ' + bottom5[bi].name + ': ' + fmt(d.yCol, bottom5[bi].y));
        }
      } else {
        for (var si2 = 0; si2 < items.length; si2++) {
          lines2.push('<span style="color:' + items[si2].color + '">●</span> ' + items[si2].name + ': ' + fmt(d.yCol, items[si2].y));
        }
      }
      tip.style.display = 'block';
      tip.innerHTML = lines2.join('<br>');
      tip.style.left = Math.min(p2.x + 12, rect.width - 240) + 'px';
      tip.style.top = Math.max(PAD_T, p2.y - 10) + 'px';
      return;
    }
    // axis-aligned tooltip: nearest data point by x, regardless of cursor height
    var idx = nearestIndexX(d.X, xVal, d.n);
    hoverIdx = idx;
    hoverX = null;
    if (idx >= 0 && Math.abs(d.X[idx] - xVal) <= tol) {
      scheduleRender();
      tip.style.display = 'block';
      tip.innerHTML = fmt(d.xCol, d.X[idx]) + '<br><span style="color:#4f6ef7">●</span> ' + fmt(d.yCol, d.Y[idx]);
      tip.style.left = (d.sx(d.X[idx]) + 12) + 'px';
      tip.style.top = (d.sy(d.Y[idx]) - 10) + 'px';
    } else {
      tip.style.display = 'none';
      hoverIdx = -1;
      scheduleRender();
    }
  }

  function onUp() {
    if (panning) { panning = null; loadWindow(); return; }
    if (selection) {
      var rect = canvas.getBoundingClientRect();
      var pw = rect.width - PAD_L - PAD_R;
      var sx0 = Math.min(selection.x0, selection.x1);
      var sx1 = Math.max(selection.x0, selection.x1);
      if (sx1 - sx0 > 5 && pw > 0) {
        var span = view.x1 - view.x0;
        var nx0 = view.x0 + (sx0 - PAD_L) / pw * span;
        var nx1 = view.x0 + (sx1 - PAD_L) / pw * span;
        if (nx1 - nx0 > 1e-9) { view.x0 = nx0; view.x1 = nx1; }
      }
      selection = null;
      loadWindow();
      saveOpts();
    }
  }

  async function fetchMeta(xName) {
    var url = '/dsh-chartlab/data/' + encodeURIComponent(chartId) + '/meta' + (xName ? '?x=' + encodeURIComponent(xName) : '') + filtersQuery();
    var res = await fetch(url);
    if (!res.ok) throw new Error('meta fetch failed ' + res.status);
    return res.json();
  }

  async function resetView(xName) {
    var meta = await fetchMeta(xName);
    cols = meta.columns; rowCount = meta.rowCount; suggestedY = meta.suggestedY || '';
    if (meta.xMin !== undefined && meta.xMax !== undefined) {
      xMin = meta.xMin; xMax = meta.xMax;
      view.x0 = xMin; view.x1 = xMax;
    }
    loadWindow();
  }

  function populate() {
    var xy = fillSelects(cols);
    if (!xy.x || !xy.y) { statusEl.textContent = T('没有可用的数值列', 'No numeric columns available'); return; }
    resetView(xy.x);
  }

  // ---- Row filter panel ----

  var OP_LABELS = { '=': T('等于', 'equals'), '!=': T('不等于', 'not equals'), '>': T('大于', 'greater'), '>=': T('大于等于', '≥'), '<': T('小于', 'less'), '<=': T('小于等于', '≤'), 'between': T('范围', 'range') };

  function opOptionsFor(colType) {
    var ops = colType === 'string' ? ['=', '!='] : colType === 'date' ? ['between'] : ['=', '!=', '>', '>=', '<', '<='];
    return ops.map(function (op) { return { value: op, label: OP_LABELS[op] }; });
  }

  function filterSqlPreview() {
    if (!filters || filters.length === 0) {
      filterSql.value = '';
      resizeSqlBox();
      return;
    }
    var parts = [];
    function sqlDate(ms) {
      var n = Number(ms);
      if (!isFinite(n)) return String(ms);
      var d = new Date(n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function sqlVal(c, v) {
      if (c && c.type === 'string') return "'" + v.replace(/'/g, "''") + "'";
      if (c && c.type === 'date') return "'" + sqlDate(v) + "'";
      return v;
    }
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      var c = col(f.column);
      // a condition with no values is a no-op (dropped server-side too) — skip it
      if (!f.values || f.values.length === 0) continue;
      if (f.op === '=' && f.values.length > 1) {
        var qs = f.values.map(function (v) { return "'" + v.replace(/'/g, "''") + "'"; }).join(', ');
        parts.push(f.column + ' IN (' + qs + ')');
      } else if (f.op === '!=' && f.values.length > 1) {
        var qs2 = f.values.map(function (v) { return "'" + v.replace(/'/g, "''") + "'"; }).join(', ');
        parts.push(f.column + ' NOT IN (' + qs2 + ')');
      } else if (f.op === 'between') {
        var s = f.values[0], e = f.values[1];
        parts.push(f.column + ' >= ' + sqlVal(c, s) + ' AND ' + f.column + ' <= ' + sqlVal(c, e));
      } else {
        parts.push(f.column + ' ' + f.op + ' ' + sqlVal(c, f.values[0]));
      }
    }
    filterSql.value = 'WHERE ' + parts.join(' AND ');
    resizeSqlBox();
  }

  // Parse an editable WHERE clause back into structured filters
  // (col op value AND ...; supports IN ('a','b') / NOT IN for strings).
  function parseWhere(text) {
    var t = text.trim().replace(/^\\s*WHERE\\b/i, '').trim();
    if (!t) return [];
    function findCol2(name) {
      var n = name.toLowerCase();
      for (var j = 0; j < cols.length; j++) {
        if (cols[j].name.toLowerCase() === n) return cols[j].name;
      }
      return null;
    }
    function unquote(s) { return s.trim().replace(/^'|'$/g, ''); }
    var out = [];
    var parts = t.split(/\\s+AND\\s+/i);
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) continue;
      // IN ('a','b') / NOT IN (...)
      var inm = seg.match(/^([A-Za-z_][\\w]*)\\s+(NOT\\s+)?IN\\s*\\(\\s*(.+?)\\s*\\)$/i);
      if (inm) {
        var fcolIn = findCol2(inm[1]);
        if (!fcolIn) return null;
        var valsIn = inm[3].split(',').map(unquote).filter(function (x) { return x !== ''; });
        if (valsIn.length === 0) return null;
        out.push({ column: fcolIn, op: inm[2] ? '!=' : '=', values: valsIn });
        continue;
      }
      var m = seg.match(/^([A-Za-z_][\\w]*)\\s*(!=|>=|<=|=|>|<)\\s*(.+)$/);
      if (!m) return null;
      var fcol = findCol2(m[1]);
      if (!fcol) return null;
      var op = m[2];
      var c = col(fcol);
      if (c && c.type === 'string' && op !== '=' && op !== '!=') return null;
      var val = unquote(m[3]);
      if (val === '') return null;
      if (c && c.type === 'date') val = String(new Date(val + 'T00:00:00').getTime());
      out.push({ column: fcol, op: op, values: [val] });
    }
    return out;
  }

  function resizeSqlBox() {
    filterSql.style.height = 'auto';
    filterSql.style.height = filterSql.scrollHeight + 'px';
  }

  function applySqlText() {
    // Multi-line pasted SQL collapses to one line before parsing, so the
    // structured-filter parser and the SQL route both see a single statement.
    var sql = normalizeSqlSingleLine(filterSql.value);
    if (sql !== filterSql.value) {
      filterSql.value = sql;
      resizeSqlBox();
    }
    var parsed = parseWhere(sql);
    if (parsed === null) {
      filterMsg.textContent = T('SQL 解析失败：请使用 列 操作符 值 AND …，如 WHERE state = "New York" AND cases > 1000', 'SQL parse failed: use column operator value AND …, e.g. WHERE state = "New York" AND cases > 1000');
      return;
    }
    filterMsg.textContent = '';
    filters = parsed;
    applyFilters();
  }

  function renderFilterRows() {
    var rows = filterPanel.querySelectorAll('.frow');
    for (var r = 0; r < rows.length; r++) rows[r].remove();
    var frag = document.createDocumentFragment();
    for (var i = 0; i < filters.length; i++) {
      (function (idx) {
        var f = filters[idx];
        var c = col(f.column);
        var row = document.createElement('div');
        row.className = 'frow';

        // column selector
        var colOpts = [];
        for (var j = 0; j < cols.length; j++) colOpts.push({ value: cols[j].name, label: cols[j].name });
        var colSel = customSelect(row, function (v) {
          filters[idx].column = v;
          var nc = col(v);
          filters[idx].op = (nc && nc.type === 'date') ? 'between' : '=';
          filters[idx].values = [];
          applyFilters();
        });
        colSel.setOptions(colOpts);
        colSel.setValue(f.column);

        // operator selector
        var opOpts = opOptionsFor(c ? c.type : 'string');
        var opSel = customSelect(row, function (v) {
          filters[idx].op = v;
          if (v !== '=' && v !== '!=') filters[idx].values = filters[idx].values.slice(0, 1);
          applyFilters();
        });
        opSel.setOptions(opOpts);
        opSel.setValue(f.op);

        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'frmv';
        rm.textContent = '✕';
        rm.title = T('删除此条件', 'Remove this condition');
        rm.addEventListener('click', function () { filters.splice(idx, 1); applyFilters(); });

        var colType = c ? c.type : 'string';
        if (colType === 'string') {
          // multi-value dropdown (checkboxes + fuzzy search), aligned with other dropdowns
          var mselTimer = null;
          var msel = multiSelect(row, function (vals) {
            // 清空 / 反选为空：只清空本行多选内容，条件行保留（空条件不生效）
            filters[idx].values = vals;
            filterSqlPreview();
            if (mselTimer) clearTimeout(mselTimer);
            mselTimer = setTimeout(applyFilters, 600); // debounce: let the user pick several
          });
          msel.setValues(f.values);
          fetch('/dsh-chartlab/data/' + encodeURIComponent(chartId) + '/groups?column=' + encodeURIComponent(f.column) + '&limit=5000')
            .then(function (r) { return r.json(); })
            .then(function (g) {
              if (!g || !g.values) return;
              msel.setOptions(g.values.map(function (v) { return { value: v.value, label: v.value }; }));
            })
            .catch(function () {});
        } else if (colType === 'date') {
          // date column: range picker (two native calendars → [start, end] epoch ms)
          function fmtDateMs(ms) {
            var n = Number(ms);
            if (!isFinite(n) || n <= 0) return '';
            var d = new Date(n);
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          }
          var sIn = document.createElement('input');
          sIn.type = 'date';
          sIn.value = fmtDateMs(f.values[0] || (xMin !== null ? xMin : ''));
          var sep = document.createElement('span');
          sep.textContent = '—';
          sep.style.color = '#6b7280';
          var eIn = document.createElement('input');
          eIn.type = 'date';
          eIn.value = fmtDateMs(f.values[1] || (xMax !== null ? xMax : ''));
          function applyRange() {
            var s = sIn.value ? new Date(sIn.value + 'T00:00:00').getTime() : -Infinity;
            var e = eIn.value ? new Date(eIn.value + 'T00:00:00').getTime() : Infinity;
            if (s === -Infinity && e === Infinity) filters[idx].values = [];
            else filters[idx].values = [String(s), String(e)];
            applyFilters();
          }
          sIn.addEventListener('change', applyRange);
          eIn.addEventListener('change', applyRange);
          row.appendChild(sIn);
          row.appendChild(sep);
          row.appendChild(eIn);
        } else {
          // numeric: single value input
          var numIn = document.createElement('input');
          numIn.type = 'text';
          numIn.value = f.values[0] || '';
          numIn.placeholder = T('值', 'value');
          numIn.style.width = '140px';
          numIn.addEventListener('change', function () {
            filters[idx].values = [numIn.value.trim()];
            applyFilters();
          });
          row.appendChild(numIn);
        }

        row.appendChild(rm);
        frag.appendChild(row);
      })(i);
    }
    filterPanel.insertBefore(frag, filterBtns);
  }

  function updateFilterUI() {
    clearFiltersBtn.style.display = filters.length > 0 ? '' : 'none';
    filterInfo.style.display = filters.length > 0 ? '' : 'none';
    filterInfo.textContent = filters.length > 0 ? (isZh ? '已添加 ' + filters.length + ' 个筛选条件' : filters.length + ' filter(s) added') : '';
    filterToggleCount.style.display = filters.length > 0 ? '' : 'none';
    filterToggleCount.textContent = '(' + filters.length + ')';
    renderFilterRows();
    filterSqlPreview();
  }

  async function applyFilters() {
    renderFilterRows();
    filterSqlPreview();
    // re-fetch meta so the range / row count reflect the filters, then reload
    var meta = await fetchMeta(xSel.value);
    rowCount = meta.rowCount;
    if (meta.xMin !== undefined && meta.xMax !== undefined) {
      xMin = meta.xMin; xMax = meta.xMax;
      view.x0 = xMin; view.x1 = xMax;
    }
    updateFilterUI();
    filterMsg.textContent = '';
    loadWindow();
    saveOpts();
  }

  function clearAllFilters() {
    filters = [];
    applyFilters();
  }

  async function main() {
    var meta = await fetchMeta();
    cols = meta.columns; rowCount = meta.rowCount; suggestedY = meta.suggestedY || '';
    if (meta.xMin !== undefined && meta.xMax !== undefined) {
      xMin = meta.xMin; xMax = meta.xMax;
      view.x0 = xMin; view.x1 = xMax;
    }
    // Restore the previous view options for this chart (X/Y/type/group/filters/
    // zoom), so an iframe remount (tab switch, chart change) keeps the state.
    var saved = loadOpts();
    populate();
    if (saved) {
      if (saved.x && col(saved.x)) xSel.setValue(saved.x);
      if (saved.y && col(saved.y)) ySel.setValue(saved.y);
      if (saved.type === 'line' || saved.type === 'scatter') typeSel.setValue(saved.type);
      if (typeof saved.group === 'string') {
        var gOk = saved.group === '' || grpSel.options.some(function (o) { return o.value === saved.group; });
        if (gOk) { grpCol = saved.group; grpSel.setValue(saved.group); } else { grpCol = ''; grpSel.setValue(''); }
      }
      syncGrpDel();
      if (Array.isArray(saved.filters)) {
        filters = saved.filters.filter(function (f) {
          return f && typeof f === 'object' && typeof f.column === 'string' && col(f.column)
            && typeof f.op === 'string' && Array.isArray(f.values);
        });
      }
      updateFilterUI();
      resetView(xSel.value);
      if (typeof saved.x0 === 'number' && typeof saved.x1 === 'number'
          && saved.x1 > saved.x0 && xMin !== null && xMax !== null) {
        view.x0 = Math.max(xMin, saved.x0);
        view.x1 = Math.min(xMax, saved.x1);
      }
      loadWindow();
    }
  }

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('resize', scheduleRender);
  wrap.addEventListener('mouseleave', hideTip);
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hideTip(); });
  window.addEventListener('blur', hideTip);
  canvas.addEventListener('dblclick', function () { selection = null; if (!hasData()) return; if (xMin !== null && xMax !== null) { view.x0 = xMin; view.x1 = xMax; } loadWindow(); saveOpts(); });
  filterToggle.addEventListener('click', function () {
    var show = filterPanel.style.display === 'none';
    filterPanel.style.display = show ? '' : 'none';
    filterToggleIcon.textContent = show ? '▴' : '▾';
    if (show) { renderFilterRows(); filterSqlPreview(); }
  });
  addFilter.addEventListener('click', function () {
    var c = cols.length > 0 ? cols[0] : null;
    filters.push({ column: c ? c.name : '', op: (c && c.type === 'date') ? 'between' : '=', values: [] });
    renderFilterRows();
    filterSqlPreview();
    filterPanel.style.display = '';
    filterToggleIcon.textContent = '▴';
  });
  filterApplySql.addEventListener('click', applySqlText);
  filterSql.addEventListener('keydown', function (e) {
    // Enter applies (multi-line is collapsed to one line first); Shift+Enter
    // inserts a newline so pasted queries can still be edited.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applySqlText(); }
  });
  filterSql.addEventListener('input', resizeSqlBox);
  clearFiltersBtn.addEventListener('click', clearAllFilters);
  snapBtn.addEventListener('click', function () {
    var w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    // Snapshot palette: redraw once with colors that stay visible on the white
    // download background (gridlines are semi-transparent in the dark theme and
    // vanish on white), then restore the main view immediately. The main view
    // itself is never affected.
    var orig = { gridline: C.gridline, text: C.text, dim: C.dim, legendBg: C.legendBg };
    C.gridline = '#9aa3b2';
    C.text = '#1f2329';
    C.dim = '#6b7280';
    C.legendBg = 'rgba(255,255,255,0.82)';
    try {
      render();
      var tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      var tctx = tmp.getContext('2d');
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, w, h);
      tctx.drawImage(canvas, 0, 0);
    } finally {
      C.gridline = orig.gridline;
      C.text = orig.text;
      C.dim = orig.dim;
      C.legendBg = orig.legendBg;
      render();
    }
    tmp.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'chart-' + chartId + '-' + Date.now() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
  });

  watchHostChrome();
  main().catch(function (e) { statusEl.textContent = T('加载失败: ', 'Load failed: ') + e.message; });
})();
</script>
</body>
</html>`
}

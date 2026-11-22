// CNCMaps TS web UI logic.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    renderMode: $('renderMode'), modeHint: $('modeHint'),
    srcLabel: $('srcLabel'), resLabel: $('resLabel'),
    maplist: $('maplist'), mapInfo: $('mapInfo'), mapInfoSummary: $('mapInfoSummary'), mapInfoBody: $('mapInfoBody'),
    sources: document.querySelector('.panel.sources'),
    gameDirBtn: $('gameDirBtn'), gameDirInput: $('gameDirInput'), assetState: $('assetState'),
    gameResSection: $('gameResSection'),
    uploadBtn: $('uploadBtn'), fileInput: $('fileInput'),
    format: $('format'), engine: $('engine'), sizeMode: $('sizeMode'),
    pngCompression: $('pngCompression'), pngCompressionVal: $('pngCompressionVal'),
    pngCompressionField: $('pngCompressionField'),
    markStartPos: $('markStartPos'), markOre: $('markOre'),
    renderBtn: $('renderBtn'), renderAllBtn: $('renderAllBtn'), zipBtn: $('zipBtn'), renderState: $('renderState'),
    progressWrap: $('progressWrap'), progressFill: $('progressFill'),
    progressPct: $('progressPct'), progressPhase: $('progressPhase'),
    previewFrame: $('previewFrame'), placeholder: $('placeholder'), previewImg: $('previewImg'),
    previewMeta: $('previewMeta'), downloadBtn: $('downloadBtn'),
    renderHistory: $('renderHistory'), renderHistoryList: $('renderHistoryList'),
    lightbox: $('lightbox'), lightboxImg: $('lightboxImg'), lightboxTitle: $('lightboxTitle'),
    lightboxClose: $('lightboxClose'), lightboxDownload: $('lightboxDownload'),
    lightboxBody: $('lightboxBody'), zoomPct: $('zoomPct'),
    engineTag: $('engineTag'), langBtn: $('langBtn'),
    statusDot: $('statusDot'), statusText: $('statusText'),
    infoMaps: $('infoMaps'), infoRender: $('infoRender'),
  };

  let selectedMap = null;
  const maps = [];
  let assetInfo = null;
  let gameFiles = [];
  let renderBusy = false;
  let batchBusy = false;
  let lastRenderResult = null;
  let zipBlob = null;
  const renderHistory = [];
  let historySeq = 0;
  const MAX_HISTORY = 12;
  let mapInfoCache = new Map();
  let currentMapInfo = null;
  let currentInfoEntry = null;
  let infoRequestSeq = 0;
  let currentImage = null;
  let renderStart = 0;
  let lastStartArgs = [];
  let blobUrl = null;
  let br = null;
  let brAssetsSig = '';

  const MODE_KEY = 'cncmaps_render_mode';
  const BR_CLIENT = window.CncmapsBrowserRender;
  let renderMode = localStorage.getItem(MODE_KEY) === 'server'
    ? 'server'
    : (BR_CLIENT && BR_CLIENT.supported() ? 'browser' : 'server');

  // ---- i18n ----
  const LANG_KEY = 'cncmaps_lang';
  const I18N = {
    zh: {
      'title': 'CNCMaps TS · 地图渲染器',
      'langBtn': '🌐 English',
      'tagline': 'Red Alert 2 / Yuri\'s Revenge · 地图渲染器',
      'srcTitle': '地图来源',
      'modeLabel': '渲染位置',
      'modeBrowser': '浏览器（不上传）',
      'modeServer': '服务器',
      'modeHintBrowser': '地图与游戏资源只在本机浏览器读取，不上传服务器',
      'modeHintServer': '地图会上传到服务器，使用服务器配置的游戏资源渲染',
      'srcLabelBrowser': '选择本地地图（不上传）',
      'srcLabelServer': '选择地图（上传本机地图文件）',
      'uploadBtnBrowser': '📁 选择本地地图（可多选）',
      'uploadBtnServer': '📁 上传地图文件（可多选）',
      'resLabelBrowser': '游戏资源（选择本机游戏目录，不上传）',
      'assetStateEmptyBrowser': '未选择游戏目录，浏览器渲染需要游戏资源',
      'assetLocalReady': '本地资源 {n} 个 · {size}（不上传）',
      'workerStarting': '启动浏览器渲染器…',
      'phaseAssets': '读取游戏资源…',
      'browserNoMapFile': '该地图没有本地文件，请切换到服务器模式',
      'browserNoAssets': '请先选择游戏目录（浏览器渲染需要游戏资源）',
      'browserUnsupported': '当前浏览器不支持本地渲染，已切换到服务器模式',
      'browserSurfaceTooLarge': '地图过大，浏览器内存不足，请切换到服务器模式',
      'browserEncodeUnsupported': '浏览器不支持图片编码，请切换到服务器模式',
      'browserAssetsMissing': '无法加载游戏资源，请确认选择的是完整游戏目录，或切换到服务器模式',
      'browserRenderFailed': '浏览器渲染失败',
      'localMapsAdded': '已选择 {n} 个本地地图（不上传）',
      'srcLabel': '选择地图（上传本机地图文件）',
      'uploadBtn': '📁 上传地图文件（可多选）',
      'resLabel': '游戏资源（可选，远程部署时上传本机游戏目录）',
      'gameDirBtn': '🎮 选择游戏目录',
      'assetNoFiles': '所选目录中没有可用的游戏资源文件',
      'curLabel': '当前选择',
      'maplistEmpty': '请上传 .map / .yrm / .mpr 地图文件（支持多选）',
      'paramsTitle': '渲染参数',
      'lblFormat': '输出格式',
      'lblEngine': '引擎',
      'engineAuto': '自动检测',
      'engineYR': '尤里的复仇 (YR)',
      'engineRA2': '红色警戒 2 (RA2)',
      'engineTS': '泰伯利亚之日 (TS)',
      'engineFS': '火风暴 (FS)',
      'lblSizeMode': '尺寸模式',
      'sizeAuto': '自动',
      'sizeLocal': '局部 (LocalSize)',
      'sizeFull': '全图 (FullMap)',
      'lblPngComp': 'PNG 压缩',
      'tglStartPos': '标记出生点',
      'tglOre': '高亮矿石',
      'renderBtn': '开始渲染',
      'renderAllBtn': '全部渲染',
      'downloadZip': '⬇ 下载 ZIP',
      'batchRendering': '批量渲染 {i}/{total}：{name}',
      'batchDone': '批量渲染完成：成功 {ok} 张',
      'batchDoneFail': '批量渲染完成：成功 {ok} 张，失败 {fail} 张',
      'batchTooMany': '一次最多批量渲染 {n} 张地图',
      'zipEmpty': '没有可打包的渲染结果',
      'mapInfoTitle': '地图信息',
      'infoName': '名称', 'infoAuthor': '作者', 'infoSize': '尺寸',
      'infoPlayers': '玩家数', 'infoTheater': '剧场',
      'infoLoading': '读取地图信息…', 'infoNone': '—',
      'dropHint': '可直接把地图文件拖到此面板',
      'readingGameDir': '读取游戏目录…',
      'gameDirPermission': '没有游戏目录读取权限',
      'gameDirRestoreFail': '无法恢复上次的游戏目录，请重新选择',
      'renderStateIdle': '尚未渲染',
      'phaseWait': '等待开始',
      'prevTitle': '预览',
      'previewPlaceholder': '渲染完成后自动显示地图预览',
      'previewAlt': '地图预览',
      'downloadImg': '⬇ 下载图片',
      'previewTip': '点击预览图可放大查看',
      'statusReady': '就绪',
      'creditHint': '（可点击跳转 GitHub）',
      'infoRenderEmpty': '最近: 尚未渲染',
      'lightboxTitle': '图片预览',
      'closeLabel': '关闭',
      'zoomIn': '放大', 'zoomOut': '缩小', 'zoomFit': '适应窗口', 'zoom100': '实际大小',
      'enginePrefix': '引擎 · ',
      'selPrefix': '已选择：',
      'selMap': '已选择地图',
      'extErr': '仅支持 .map / .yrm / .mpr 文件',
      'uploading': '上传中…',
      'uploadFail': '上传失败',
      'uploadBatchDone': '已上传 {ok}/{total} 个地图',
      'uploadBatchPartial': '已上传 {ok}/{total} 个地图，{bad} 个文件被跳过',
      'mapsPrefix': '地图：',
      'browserBadge': '本地',
      'phaseParsing': '解析地图 / 规则…', 'phaseTiles': '绘制地形…',
      'phaseObjects': '绘制建筑与单位…', 'phaseEncoding': '编码输出…',
      'phaseDrawing': '绘制中…',
      'phaseSubmit': '提交任务…',
      'renderingPrefix': '渲染中：',
      'rendering': '渲染中…',
      'complete': '完成',
      'failCode': '失败 (code ',
      'renderFailed': '渲染失败',
      'renderError': '渲染错误',
      'renderDone': '渲染完成',
      'errorPrefix': '错误：',
      'reqFailed': '请求失败',
      'reqFailedPrefix': '请求失败：',
      'recentPrefix': '最近: ',
      'historyTitle': '渲染结果',
    },
    en: {
      'title': 'CNCMaps TS · Map Renderer',
      'langBtn': '🌐 中文',
      'tagline': 'Red Alert 2 / Yuri\'s Revenge · Map Renderer',
      'srcTitle': 'Map Source',
      'modeLabel': 'Render Location',
      'modeBrowser': 'Browser (no upload)',
      'modeServer': 'Server',
      'modeHintBrowser': 'Maps and game files stay in this browser; nothing is uploaded',
      'modeHintServer': 'Maps are uploaded and rendered with the server game resources',
      'srcLabelBrowser': 'Choose local maps (no upload)',
      'srcLabelServer': 'Choose maps (upload from this device)',
      'uploadBtnBrowser': '📁 Choose Local Maps (multi)',
      'uploadBtnServer': '📁 Upload Map Files (multi)',
      'resLabelBrowser': 'Game resources (select a local game folder, no upload)',
      'assetStateEmptyBrowser': 'No game folder selected; browser rendering needs game resources',
      'assetLocalReady': 'Local assets: {n} files · {size} (not uploaded)',
      'workerStarting': 'Starting browser renderer…',
      'phaseAssets': 'Reading game resources…',
      'browserNoMapFile': 'This map has no local file; switch to server mode',
      'browserNoAssets': 'Select a game folder first (browser rendering needs game resources)',
      'browserUnsupported': 'This browser cannot render locally; switched to server mode',
      'browserSurfaceTooLarge': 'Map too large for browser memory; switch to server mode',
      'browserEncodeUnsupported': 'Image encoding is not supported; switch to server mode',
      'browserAssetsMissing': 'Could not load game resources; select a complete game folder or switch to server mode',
      'browserRenderFailed': 'Browser render failed',
      'localMapsAdded': 'Selected {n} local maps (not uploaded)',
      'srcLabel': 'Choose a map (upload a local file)',
      'uploadBtn': '📁 Upload Map Files (multi)',
      'resLabel': 'Game resources (optional; upload a local game folder for remote servers)',
      'gameDirBtn': '🎮 Select Game Folder',
      'assetNoFiles': 'No usable game asset files found in the selected folder',
      'curLabel': 'Current Selection',
      'maplistEmpty': 'Upload .map / .yrm / .mpr map files (multiple allowed)',
      'paramsTitle': 'Render Options',
      'lblFormat': 'Output Format',
      'lblEngine': 'Engine',
      'engineAuto': 'Auto Detect',
      'engineYR': 'Yuri\'s Revenge (YR)',
      'engineRA2': 'Red Alert 2 (RA2)',
      'engineTS': 'Tiberian Sun (TS)',
      'engineFS': 'Firestorm (FS)',
      'lblSizeMode': 'Size Mode',
      'sizeAuto': 'Auto',
      'sizeLocal': 'Local (LocalSize)',
      'sizeFull': 'Full Map',
      'lblPngComp': 'PNG Compression',
      'tglStartPos': 'Mark Start Positions',
      'tglOre': 'Highlight Ore',
      'renderBtn': 'Start Render',
      'renderAllBtn': 'Render All',
      'downloadZip': '⬇ Download ZIP',
      'batchRendering': 'Rendering {i}/{total}: {name}',
      'batchDone': 'Batch complete: {ok} succeeded',
      'batchDoneFail': 'Batch complete: {ok} succeeded, {fail} failed',
      'batchTooMany': 'At most {n} maps can be rendered in one batch',
      'zipEmpty': 'No rendered images to package',
      'mapInfoTitle': 'Map Info',
      'infoName': 'Name', 'infoAuthor': 'Author', 'infoSize': 'Size',
      'infoPlayers': 'Players', 'infoTheater': 'Theater',
      'infoLoading': 'Reading map info…', 'infoNone': '—',
      'dropHint': 'Drag map files onto this panel',
      'readingGameDir': 'Reading game folder…',
      'gameDirPermission': 'No permission to read the game folder',
      'gameDirRestoreFail': 'Could not restore the previous game folder; select it again',
      'renderStateIdle': 'Not rendered yet',
      'phaseWait': 'Waiting to start',
      'prevTitle': 'Preview',
      'previewPlaceholder': 'Map preview will appear after rendering',
      'previewAlt': 'map preview',
      'downloadImg': '⬇ Download Image',
      'previewTip': 'Click the preview to zoom in',
      'statusReady': 'Ready',
      'creditHint': '(click to open GitHub)',
      'infoRenderEmpty': 'Recent: not rendered',
      'lightboxTitle': 'Image Preview',
      'closeLabel': 'Close',
      'zoomIn': 'Zoom In', 'zoomOut': 'Zoom Out', 'zoomFit': 'Fit Window', 'zoom100': '100%',
      'enginePrefix': 'Engine · ',
      'selPrefix': 'Selected: ',
      'selMap': 'Map selected',
      'extErr': 'Only .map / .yrm / .mpr files are supported',
      'uploading': 'Uploading…',
      'uploadFail': 'Upload failed',
      'uploadDone': 'Upload complete, map selected',
      'uploadBatchDone': 'Uploaded {ok}/{total} maps',
      'uploadBatchPartial': 'Uploaded {ok}/{total} maps, {bad} file(s) skipped',
      'mapsPrefix': 'Maps: ',
      'browserBadge': 'Local',
      'phaseParsing': 'Parsing map / rules…', 'phaseTiles': 'Drawing terrain…',
      'phaseObjects': 'Drawing buildings & units…', 'phaseEncoding': 'Encoding output…',
      'phaseDrawing': 'Drawing…',
      'phaseSubmit': 'Submitting…',
      'renderingPrefix': 'Rendering: ',
      'rendering': 'Rendering…',
      'complete': 'Done',
      'failCode': 'Failed (code ',
      'renderFailed': 'Render failed',
      'renderError': 'Render error',
      'renderDone': 'Render complete',
      'errorPrefix': 'Error: ',
      'reqFailed': 'Request failed',
      'reqFailedPrefix': 'Request failed: ',
      'recentPrefix': 'Recent: ',
      'historyTitle': 'Rendered Images',
    },
  };
  let LANG = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';
  const t = (key) => (I18N[LANG] && I18N[LANG][key] !== undefined ? I18N[LANG][key] : (I18N.zh[key] || key));
  const tf = (key, vars) => t(key).replace(/\{(\w+)\}/g, (s, k) => (vars[k] !== undefined ? vars[k] : s));

  function applyLang() {
    document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      el.setAttribute('alt', t(el.getAttribute('data-i18n-alt')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    const cr = $('credit');
    if (cr) {
      cr.innerHTML = '<a href="https://github.com/zzattack/ccmaps-net" target="_blank" rel="noopener noreferrer">CNCMaps - NET</a>'
        + t('creditHint') + ' | CNCMaps TS · by 1372704087';
    }
    els.langBtn.textContent = t('langBtn');
    setEngineTag();
    if (els.infoRender.textContent === I18N.zh['infoRenderEmpty'])
      els.infoRender.textContent = t('infoRenderEmpty');
    if (assetInfo)
      els.assetState.textContent = tf('assetLocalReady', assetInfo);
    if (currentInfoEntry) renderMapInfo(currentInfoEntry, currentMapInfo);
    if (renderStateSupportsT(els.renderState.textContent))
      els.renderState.textContent = t(renderStateSupportsT(els.renderState.textContent));
    applyModeUI();
  }
  // map current dynamic render-state text back to its i18n key (for live switch)
  function renderStateSupportsT(text) {
    const keys = ['renderStateIdle', 'renderFailed', 'reqFailed', 'complete', 'renderDone'];
    for (const k of keys) if (text === I18N.zh[k] || text === I18N.en[k]) return k;
    return null;
  }

  function setLang(lang) {
    LANG = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyLang();
  }
  els.langBtn.onclick = () => setLang(LANG === 'zh' ? 'en' : 'zh');
  //

  function setStatus(state, text) {
    els.statusDot.className = 'dot' + (state ? ' ' + state : '');
    els.statusText.textContent = text;
  }
  function setEngineTag() {
    const v = els.engine.value;
    const keys = { '': 'engineAuto', yr: 'engineYR', ra2: 'engineRA2', ts: 'engineTS', fs: 'engineFS' };
    els.engineTag.textContent = t('enginePrefix') + (keys[v] ? t(keys[v]) : t('engineAuto'));
  }

  function fmtSize(n) {
    if (n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function setRenderMode(mode, persist = true) {
    renderMode = mode === 'browser' ? 'browser' : 'server';
    if (persist) localStorage.setItem(MODE_KEY, renderMode);
    applyModeUI();
    if (renderMode === 'browser' && !gameFiles.length) void restoreGameDir();
  }

  function applyModeUI() {
    const browser = renderMode === 'browser';
    els.renderMode.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === renderMode);
    });
    els.modeHint.textContent = t(browser ? 'modeHintBrowser' : 'modeHintServer');
    els.srcLabel.textContent = t(browser ? 'srcLabelBrowser' : 'srcLabelServer');
    els.resLabel.textContent = t('resLabelBrowser');
    els.uploadBtn.querySelector('span').textContent = t(browser ? 'uploadBtnBrowser' : 'uploadBtnServer');
    els.gameResSection.style.display = browser ? '' : 'none';
    els.assetState.textContent = assetInfo
      ? tf('assetLocalReady', assetInfo)
      : t('assetStateEmptyBrowser');
  }

  function updateRenderButtons() {
    const idle = !renderBusy && !batchBusy;
    els.renderBtn.disabled = !idle || !selectedMap;
    els.renderAllBtn.disabled = !idle || maps.length === 0;
    els.zipBtn.disabled = !idle || !zipBlob;
  }

  function selectMap(m) {
    selectedMap = m;
    els.maplist.querySelectorAll('.maplist-item').forEach((x) => {
      x.classList.toggle('active', !!m && x.dataset.key === m.key);
    });
    updateRenderButtons();
    els.renderState.textContent = m ? t('selPrefix') + m.name : t('renderStateIdle');
    setStatus('ok', t('selMap'));
    void loadMapInfo(m);
  }

  function renderMapList() {
    els.maplist.innerHTML = '';
    if (maps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'maplist-empty';
      empty.setAttribute('data-i18n', 'maplistEmpty');
      empty.textContent = t('maplistEmpty');
      els.maplist.appendChild(empty);
      els.mapInfo.hidden = true;
      updateRenderButtons();
      return;
    }
    maps.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'maplist-item';
      item.dataset.key = m.key;
      item.innerHTML = '<span class="ic">📤</span><span class="nm"></span><span class="sz"></span>';
      item.querySelector('.nm').textContent = m.name;
      const isLocalOnly = m.file && !m.uploadToken;
      item.querySelector('.sz').textContent = isLocalOnly ? t('browserBadge') : fmtSize(m.size);
      item.querySelector('.ic').textContent = m.file ? '📄' : '📤';
      item.onclick = () => selectMap(m);
      els.maplist.appendChild(item);
    });
    if (selectedMap) selectMap(selectedMap);
    updateRenderButtons();
  }

  function renderMapInfo(entry, info) {
    currentInfoEntry = entry;
    currentMapInfo = info;
    if (!entry) { els.mapInfo.hidden = true; return; }
    const rows = info ? [
      [t('infoName'), info.name || entry.name],
      [t('infoAuthor'), info.author || t('infoNone')],
      [t('infoSize'), info.width && info.height ? info.width + ' × ' + info.height : t('infoNone')],
      [t('infoPlayers'), info.players != null ? String(info.players) : t('infoNone')],
      [t('infoTheater'), info.theater || t('infoNone')],
    ] : [
      [t('infoName'), entry.name],
      [t('infoSize'), fmtSize(entry.size)],
    ];
    const summary = info
      ? [
        info.name || entry.name,
        info.width && info.height ? info.width + '×' + info.height : '',
        info.players != null ? info.players + 'P' : '',
        info.theater || '',
      ].filter(Boolean).join(' · ')
      : entry.name;
    els.mapInfoSummary.textContent = summary;
    els.mapInfoBody.innerHTML = '';
    for (const [key, value] of rows) {
      const row = document.createElement('div');
      row.className = 'mi-row';
      const k = document.createElement('span');
      k.className = 'mi-key';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'mi-val';
      v.textContent = value;
      row.appendChild(k);
      row.appendChild(v);
      els.mapInfoBody.appendChild(row);
    }
    els.mapInfo.hidden = false;
  }

  async function loadMapInfo(entry) {
    if (!entry) { renderMapInfo(null, null); return; }
    if (!entry.file || !window.CncmapsMapInfo) { renderMapInfo(entry, null); return; }
    const cacheKey = entry.key + ':' + (entry.file.lastModified || 0);
    if (mapInfoCache.has(cacheKey)) { renderMapInfo(entry, mapInfoCache.get(cacheKey)); return; }
    const seq = ++infoRequestSeq;
    els.mapInfo.hidden = false;
    els.mapInfoSummary.textContent = t('infoLoading');
    els.mapInfoBody.innerHTML = '';
    try {
      const info = await window.CncmapsMapInfo.read(entry.file);
      if (seq !== infoRequestSeq) return;
      mapInfoCache.set(cacheKey, info);
      renderMapInfo(entry, info);
    } catch (e) {
      if (seq === infoRequestSeq) renderMapInfo(entry, null);
    }
  }

  async function uploadMaps(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const valid = files.filter((f) => /\.(map|yrm|mpr)$/i.test(f.name));
    const bad = files.length - valid.length;
    if (!valid.length) {
      setStatus('err', t('extErr')); return;
    }
    let ok = 0;
    let lastErr = null;
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      setStatus('work', t('uploading') + ' ' + (i + 1) + '/' + valid.length);
      try {
        const resp = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
        const data = await resp.json();
        if (!resp.ok || !data.token) throw new Error(data.error || t('uploadFail'));
        const entry = { key: 'up:' + data.token, name: data.name, size: data.size, uploadToken: data.token, file };
        maps.push(entry);
        ok++;
        if (!selectedMap) selectedMap = entry;
      } catch (e) {
        lastErr = e;
      }
    }
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + maps.length;
    if (ok === 0) {
      setStatus('err', t('uploadFail') + (lastErr ? ': ' + (lastErr.message || lastErr) : ''));
      return;
    }
    const msg = bad > 0
      ? tf('uploadBatchPartial', { ok, total: valid.length, bad })
      : tf('uploadBatchDone', { ok, total: valid.length });
    setStatus('ok', msg);
  }

  function addLocalMaps(fileList) {
    const files = Array.from(fileList || []);
    const valid = files.filter((f) => /\.(map|yrm|mpr)$/i.test(f.name));
    if (!valid.length) {
      setStatus('err', t('extErr')); return;
    }
    let added = 0;
    for (const file of valid) {
      const key = 'file:' + file.name + ':' + file.size + ':' + (file.lastModified || 0);
      const existing = maps.find((m) => m.key === key);
      if (existing) {
        if (!selectedMap) selectedMap = existing;
        continue;
      }
      const entry = { key, name: file.name, size: file.size, file };
      maps.push(entry);
      if (!selectedMap) selectedMap = entry;
      added++;
    }
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + maps.length;
    setStatus('ok', tf('localMapsAdded', { n: added || valid.length }));
  }

  function setLocalAssets(files) {
    gameFiles = files;
    const size = files.reduce((sum, f) => sum + f.size, 0);
    assetInfo = { n: files.length, size: fmtSize(size) };
    els.assetState.textContent = tf('assetLocalReady', assetInfo);
    setStatus('ok', els.assetState.textContent);
  }

  const ASSET_RE = /\.(mix|mmx|yro|ini|csf|pal|shp|tmp|vxl|hva|vpl|pkt)$/i;

  function setProgress(pct, phase) {
    pct = Math.max(0, Math.min(100, pct));
    els.progressFill.style.width = pct + '%';
    els.progressPct.textContent = Math.round(pct) + '%';
    els.progressPhase.textContent = phase || '';
    els.progressWrap.classList.add('show');
  }

  function showPreview(url, meta) {
    els.previewImg.onload = () => {
      els.placeholder.style.display = 'none';
      els.previewImg.style.display = 'block';
    };
    els.previewImg.src = url.startsWith('blob:') ? url : url + '?t=' + Date.now();
    if (meta) els.previewMeta.textContent = meta;
  }

  function addRenderHistory(url, downloadUrl, name) {
    if (!url) return;
    const existing = renderHistory.find((h) => h.url === url);
    if (existing) {
      existing.name = name || existing.name;
      renderHistoryList();
      return;
    }
    renderHistory.unshift({ id: ++historySeq, url, downloadUrl: downloadUrl || url, name: name || '' });
    while (renderHistory.length > MAX_HISTORY) {
      const removed = renderHistory.pop();
      if (removed && removed.url.startsWith('blob:') && (!currentImage || currentImage.url !== removed.url)) {
        URL.revokeObjectURL(removed.url);
      }
    }
    renderHistoryList();
  }

  function removeHistoryItem(id) {
    const idx = renderHistory.findIndex((h) => h.id === id);
    if (idx === -1) return;
    const [item] = renderHistory.splice(idx, 1);
    if (item.url.startsWith('blob:') && (!currentImage || currentImage.url !== item.url)) {
      URL.revokeObjectURL(item.url);
    }
    renderHistoryList();
  }

  function selectHistoryItem(item) {
    currentImage = { url: item.url, name: item.name, downloadUrl: item.downloadUrl };
    showPreview(item.url, item.name);
    els.downloadBtn.disabled = false;
    els.downloadBtn.dataset.url = item.downloadUrl;
    els.downloadBtn.dataset.name = item.name;
    els.previewMeta.textContent = item.name;
    renderHistoryList();
  }

  function renderHistoryList() {
    els.renderHistoryList.innerHTML = '';
    if (!renderHistory.length) {
      els.renderHistory.hidden = true;
      return;
    }
    els.renderHistory.hidden = false;
    for (const item of renderHistory) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rh-item' + (currentImage && currentImage.url === item.url ? ' active' : '');
      btn.title = item.name;
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';
      img.onerror = () => removeHistoryItem(item.id);
      const name = document.createElement('span');
      name.className = 'rh-name';
      name.textContent = item.name;
      btn.appendChild(img);
      btn.appendChild(name);
      btn.onclick = () => selectHistoryItem(item);
      els.renderHistoryList.appendChild(btn);
    }
  }

  function openLightbox(url, name) {
    els.lightboxImg.src = url;
    els.lightboxTitle.textContent = name || t('lightboxTitle');
    els.lightboxDownload.href = url.includes('/image/')
      ? url.replace('/image/', '/download/')
      : url;
    els.lightbox.hidden = false;
    zoom = 1;
    applyZoom(false);
    els.lightboxBody.scrollLeft = 0;
    els.lightboxBody.scrollTop = 0;
  }
  function closeLightbox() { els.lightbox.hidden = true; }

  // ---- lightbox zoom / pan ----
  let zoom = 1;
  const zoomMin = 0.2, zoomMax = 8;
  function clampZoom(z) { return Math.min(zoomMax, Math.max(zoomMin, z)); }
  function applyZoom(center) {
    const img = els.lightboxImg;
    if (!img.naturalWidth) return;
    const w = img.naturalWidth * zoom;
    const h = img.naturalHeight * zoom;
    // keep the point under cursor roughly stable when zooming with wheel/buttons
    let cx = 0, cy = 0, bx = 0, by = 0;
    if (center) {
      bx = els.lightboxBody.scrollLeft; by = els.lightboxBody.scrollTop;
      cx = center.x; cy = center.y;
    }
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    els.zoomPct.textContent = Math.round(zoom * 100) + '%';
    if (center) {
      const scale = w / (img.offsetWidth || w);
      els.lightboxBody.scrollLeft = bx + (cx - bx) * (scale - 1);
      els.lightboxBody.scrollTop = by + (cy - by) * (scale - 1);
    }
  }
  function zoomAt(factor, cx, cy) {
    const before = zoom;
    zoom = clampZoom(before * factor);
    const img = els.lightboxImg;
    const bx = els.lightboxBody.scrollLeft, by = els.lightboxBody.scrollTop;
    // point under cursor in image coords
    const imgX = img.naturalWidth * (bx + cx) / (img.naturalWidth * before);
    const imgY = img.naturalHeight * (by + cy) / (img.naturalHeight * before);
    img.style.width = (img.naturalWidth * zoom) + 'px';
    img.style.height = (img.naturalHeight * zoom) + 'px';
    els.zoomPct.textContent = Math.round(zoom * 100) + '%';
    els.lightboxBody.scrollLeft = imgX * zoom - cx;
    els.lightboxBody.scrollTop = imgY * zoom - cy;
  }
  let panState = null;
  els.lightboxImg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    els.lightboxImg.setPointerCapture(e.pointerId);
    panState = { x: e.clientX, y: e.clientY, sl: els.lightboxBody.scrollLeft, st: els.lightboxBody.scrollTop };
    els.lightboxImg.classList.add('dragging');
  });
  els.lightboxImg.addEventListener('pointermove', (e) => {
    if (!panState) return;
    els.lightboxBody.scrollLeft = panState.sl - (e.clientX - panState.x);
    els.lightboxBody.scrollTop = panState.st - (e.clientY - panState.y);
  });
  els.lightboxImg.addEventListener('pointerup', (e) => {
    panState = null;
    els.lightboxImg.classList.remove('dragging');
  });
  els.lightboxImg.addEventListener('pointercancel', () => {
    panState = null;
    els.lightboxImg.classList.remove('dragging');
  });
  els.lightboxBody.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = els.lightboxBody.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  async function ensureServerUpload(entry) {
    if (entry.uploadToken) return;
    if (!entry.file) throw new Error(t('browserNoMapFile'));
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(entry.name) },
      body: entry.file,
    });
    const data = await resp.json();
    if (!resp.ok || !data.token) throw new Error(data.error || t('uploadFail'));
    entry.uploadToken = data.token;
    entry.key = 'up:' + data.token;
    entry.size = data.size;
    renderMapList();
  }

  function engineKeyFromName(name) {
    const keys = {
      RedAlert2: 'engineRA2', YurisRevenge: 'engineYR', TiberianSun: 'engineTS', Firestorm: 'engineFS',
    };
    return keys[name] || 'engineAuto';
  }

  function render() {
    if (renderMode === 'browser') void renderBrowser();
    else void renderServer();
  }

  async function renderBrowser() {
    if (renderBusy) return;
    lastRenderResult = { ok: false };
    if (!selectedMap) { setStatus('err', '请先选择地图'); return; }
    if (!selectedMap.file) { setStatus('err', t('browserNoMapFile')); return; }
    if (!gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    if (!BR_CLIENT || !BR_CLIENT.supported()) {
      setRenderMode('server');
      setStatus('err', t('browserUnsupported'));
      return renderServer();
    }

    renderBusy = true;
    els.renderBtn.disabled = true;
    updateRenderButtons();
    renderStart = Date.now();
    setProgress(0, t('phaseSubmit'));
    els.renderState.textContent = t('renderingPrefix') + selectedMap.name;
    els.progressWrap.classList.add('show');
    setStatus('work', t('rendering'));

    let fallback = false;
    let startedRendering = false;
    try {
      if (!br) br = BR_CLIENT.create();
      setProgress(1, t('workerStarting'));
      const caps = await br.start();
      if (!caps.fileReaderSync || !caps.offscreen) {
        fallback = true;
        throw Object.assign(new Error(t('browserUnsupported')), { code: 'UNSUPPORTED' });
      }
      const sig = gameFiles.map((f) => f.name + ':' + f.size + ':' + (f.lastModified || 0)).join('|');
      if (sig !== brAssetsSig) {
        setProgress(2, t('phaseAssets'));
        await br.setAssets(gameFiles);
        brAssetsSig = sig;
      }
      startedRendering = true;
      const res = await br.render(selectedMap.file, selectedMap.name, {
        format: els.format.value,
        engine: els.engine.value,
        sizeMode: els.sizeMode.value,
        markStartPos: els.markStartPos.checked,
        markOre: els.markOre.checked,
      }, (pct, phase) => {
        setProgress(pct, phaseLabel(phase));
      });

      setProgress(100, t('complete'));
      blobUrl = URL.createObjectURL(res.blob);
      currentImage = { url: blobUrl, name: res.name, downloadUrl: blobUrl };
      showPreview(blobUrl, res.name);
      addRenderHistory(blobUrl, blobUrl, res.name);
      els.downloadBtn.disabled = false;
      els.downloadBtn.dataset.url = blobUrl;
      els.downloadBtn.dataset.name = res.name;
      const ms = Date.now() - (renderStart || Date.now());
      const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
      const engKey = engineKeyFromName(res.engine);
      els.engineTag.textContent = t('enginePrefix') + t(engKey);
      els.infoRender.textContent = t('recentPrefix') + res.name + ' · ' + t(engKey) + ' · ' + dur;
      els.renderState.textContent = t('renderDone');
      setStatus('ok', t('complete'));
      lastRenderResult = { ok: true, blob: res.blob, name: res.name };
    } catch (e) {
      lastRenderResult = { ok: false, error: e };
      const code = e && e.code;
      if (code === 'UNSUPPORTED') {
        fallback = true;
        setRenderMode('server');
        setStatus('err', t('browserUnsupported'));
        if (br) { try { br.terminate(); } catch (err) { /* ignore */ } }
        br = null;
        brAssetsSig = '';
      } else if (!code && !startedRendering) {
        // Worker script could not start (missing bundle / blocked). Use the server.
        fallback = true;
        setRenderMode('server');
        setStatus('err', t('browserUnsupported'));
        if (br) { try { br.terminate(); } catch (err) { /* ignore */ } }
        br = null;
        brAssetsSig = '';
      } else {
        if (code === 'SURFACE_TOO_LARGE') setStatus('err', t('browserSurfaceTooLarge'));
        else if (code === 'ENCODE_UNSUPPORTED') setStatus('err', t('browserEncodeUnsupported'));
        else if (code === 'ASSETS_MISSING') setStatus('err', t('browserAssetsMissing'));
        else setStatus('err', t('browserRenderFailed') + ': ' + (e && e.message || e));
        els.renderState.textContent = t('renderFailed');
        if (!code) {
          if (br) { try { br.terminate(); } catch (err) { /* ignore */ } }
          br = null;
          brAssetsSig = '';
        }
      }
    } finally {
      renderBusy = false;
      updateRenderButtons();
    }
    if (fallback) return renderServer();
  }

  async function renderServer() {
    if (renderBusy) return;
    lastRenderResult = { ok: false };
    if (!selectedMap) { setStatus('err', '请先选择地图'); return; }

    renderBusy = true;
    els.renderBtn.disabled = true;
    updateRenderButtons();
    renderStart = Date.now();
    setProgress(0, t('phaseSubmit'));
    els.renderState.textContent = t('renderingPrefix') + selectedMap.name;
    els.progressWrap.classList.add('show');
    setStatus('work', t('rendering'));

    try {
      await ensureServerUpload(selectedMap);
      const body = {
        name: selectedMap.name,
        format: els.format.value,
        engine: els.engine.value,
        sizeMode: els.sizeMode.value,
        pngCompression: els.pngCompression.value,
        markStartPos: els.markStartPos.checked,
        markOre: els.markOre.checked,
      };
      if (selectedMap.uploadToken) body.uploadToken = selectedMap.uploadToken;

      const resp = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let lastProgress = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'start') {
            els.engineTag.textContent = t('enginePrefix') + argvShort(evt.args);
            lastStartArgs = evt.args;
          } else if (evt.type === 'progress') {
            lastProgress = evt.percent;
            setProgress(evt.percent, phaseLabel(evt.phase));
          } else if (evt.type === 'log') {
            if (evt.level === 'fatal') setStatus('err', t('renderError'));
          } else if (evt.type === 'done') {
            if (evt.ok) {
              setProgress(100, t('complete'));
              currentImage = { url: evt.url, name: evt.name, downloadUrl: evt.downloadUrl };
              showPreview(evt.url, evt.name);
              addRenderHistory(evt.url, evt.downloadUrl, evt.name);
              els.downloadBtn.disabled = false;
              els.downloadBtn.dataset.url = evt.downloadUrl;
              els.downloadBtn.dataset.name = evt.name;
              const ms = Date.now() - (renderStart || Date.now());
              const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
              els.infoRender.textContent = t('recentPrefix') + (evt.name || '') + ' · ' +
                argvShort(lastStartArgs) + ' · ' + dur;
              els.renderState.textContent = t('renderDone');
              setStatus('ok', t('complete'));
              lastRenderResult = { ok: true, downloadUrl: evt.downloadUrl, name: evt.name };
            } else {
              setProgress(lastProgress, t('failCode') + evt.code + ')');
              els.renderState.textContent = t('renderFailed');
              setStatus('err', t('renderFailed'));
            }
          } else if (evt.type === 'error') {
            els.renderState.textContent = t('errorPrefix') + (evt.message || '');
            setStatus('err', t('reqFailed'));
          }
        }
      }
    } catch (e) {
      els.renderState.textContent = t('reqFailed');
      setStatus('err', t('reqFailedPrefix') + (e && e.message || e));
    } finally {
      renderBusy = false;
      updateRenderButtons();
    }
  }

  const MAX_BATCH = 12;

  async function renderAll() {
    if (renderBusy || batchBusy) return;
    if (!maps.length) return;
    if (maps.length > MAX_BATCH) { setStatus('err', tf('batchTooMany', { n: MAX_BATCH })); return; }
    if (renderMode === 'browser' && !gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    batchBusy = true;
    zipBlob = null;
    updateRenderButtons();
    const entries = maps.slice();
    const zipped = [];
    let failed = 0;
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        selectedMap = entry;
        renderMapList();
        setStatus('work', tf('batchRendering', { i: i + 1, total: entries.length, name: entry.name }));
        lastRenderResult = null;
        if (renderMode === 'browser') await renderBrowser();
        else await renderServer();
        const result = lastRenderResult;
        if (result && result.ok) {
          let blob = result.blob;
          if (!blob && result.downloadUrl) {
            try {
              const resp = await fetch(result.downloadUrl);
              if (resp.ok) blob = await resp.blob();
            } catch (e) { /* count as failure below */ }
          }
          if (blob) zipped.push({ name: result.name || entry.name, blob });
          else failed++;
        } else {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (zipped.length) zipBlob = await window.createZipBlob(zipped);
      setStatus(zipped.length ? 'ok' : 'err', failed
        ? tf('batchDoneFail', { ok: zipped.length, fail: failed })
        : tf('batchDone', { ok: zipped.length }));
    } catch (e) {
      setStatus('err', t('browserRenderFailed') + ': ' + (e && e.message || e));
    } finally {
      batchBusy = false;
      updateRenderButtons();
    }
  }

  function downloadZip() {
    if (!zipBlob) { setStatus('err', t('zipEmpty')); return; }
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cncmaps-' + new Date().toISOString().slice(0, 10) + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function argvShort(args) {
    const forced = args.find((a) => a.startsWith('--force-'));
    if (forced) {
      const keys = { ra2: 'engineRA2', yr: 'engineYR', ts: 'engineTS', fs: 'engineFS' };
      const k = forced.replace('--force-', '');
      return keys[k] ? t(keys[k]) : k;
    }
    return t('engineAuto');
  }

  function phaseLabel(p) {
    const keys = {
      parsing: 'phaseParsing', tiles: 'phaseTiles', objects: 'phaseObjects',
      encoding: 'phaseEncoding', drawing: 'phaseDrawing',
    };
    return keys[p] ? t(keys[p]) : p;
  }

  const GAME_DB = 'cncmaps_web';
  const GAME_STORE = 'handles';
  const GAME_HANDLE_KEY = 'gameDir';
  let savedDirHandle = null;

  function openGameDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(GAME_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(GAME_STORE)) req.result.createObjectStore(GAME_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getSavedGameDir() {
    try {
      const db = await openGameDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(GAME_STORE, 'readonly');
        const rq = tx.objectStore(GAME_STORE).get(GAME_HANDLE_KEY);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error);
      });
    } catch (e) {
      return null;
    }
  }

  async function saveGameDir(handle) {
    try {
      const db = await openGameDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(GAME_STORE, 'readwrite');
        tx.objectStore(GAME_STORE).put(handle, GAME_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* remembering the folder is best-effort */ }
  }

  async function collectGameFiles(handle) {
    const files = [];
    async function walk(dir) {
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          if (ASSET_RE.test(entry.name)) {
            try { files.push(await entry.getFile()); } catch (e) { /* skip unreadable */ }
          }
        } else if (entry.kind === 'directory') {
          await walk(entry);
        }
      }
    }
    await walk(handle);
    return files;
  }

  async function chooseGameDir() {
    if (!window.showDirectoryPicker) { els.gameDirInput.click(); return; }
    try {
      let handle = savedDirHandle;
      if (handle) {
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') handle = null;
      }
      if (!handle) {
        handle = await window.showDirectoryPicker({ mode: 'read' });
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') { setStatus('err', t('gameDirPermission')); return; }
      }
      savedDirHandle = handle;
      void saveGameDir(handle);
      setStatus('work', t('readingGameDir'));
      const files = await collectGameFiles(handle);
      if (!files.length) setStatus('err', t('assetNoFiles'));
      else setLocalAssets(files);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      setStatus('err', t('gameDirRestoreFail') + ': ' + (e && e.message || e));
    }
  }

  async function restoreGameDir() {
    if (renderMode !== 'browser' || !window.showDirectoryPicker) return;
    const handle = await getSavedGameDir();
    if (!handle) return;
    savedDirHandle = handle;
    try {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return;
      const files = await collectGameFiles(handle);
      if (files.length) setLocalAssets(files);
    } catch (e) { /* ignore a stale handle */ }
  }

  // events
  els.renderMode.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { setRenderMode(b.dataset.mode); };
  });
  els.uploadBtn.onclick = () => els.fileInput.click();
  els.gameDirBtn.onclick = () => { void chooseGameDir(); };
  els.gameDirInput.addEventListener('change', () => {
    if (els.gameDirInput.files && els.gameDirInput.files.length) {
      const files = Array.from(els.gameDirInput.files).filter((f) => ASSET_RE.test(f.name));
      if (!files.length) setStatus('err', t('assetNoFiles'));
      else setLocalAssets(files);
    }
    els.gameDirInput.value = '';
  });
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files && els.fileInput.files.length) {
      if (renderMode === 'server') uploadMaps(els.fileInput.files);
      else addLocalMaps(els.fileInput.files);
    }
    els.fileInput.value = '';
  });
  els.sources.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.sources.classList.add('drag-over');
  });
  els.sources.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.sources.classList.add('drag-over');
  });
  els.sources.addEventListener('dragleave', (e) => {
    if (!els.sources.contains(e.relatedTarget)) els.sources.classList.remove('drag-over');
  });
  els.sources.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.sources.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const mapFiles = files.filter((f) => /\.(map|yrm|mpr)$/i.test(f.name));
    if (!mapFiles.length) { setStatus('err', t('extErr')); return; }
    if (renderMode === 'server') uploadMaps(mapFiles);
    else addLocalMaps(mapFiles);
  });
  window.addEventListener('dragover', (e) => { if (!els.sources.contains(e.target)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!els.sources.contains(e.target)) e.preventDefault(); });
  els.downloadBtn.onclick = () => {
    if (currentImage) {
      const a = document.createElement('a');
      a.href = currentImage.downloadUrl;
      a.download = currentImage.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };
  els.previewImg.onclick = () => { if (currentImage) openLightbox(currentImage.url, currentImage.name); };
  els.lightboxClose.onclick = closeLightbox;
  els.lightbox.addEventListener('click', (e) => { if (e.target === els.lightbox) closeLightbox(); });
  els.lightbox.querySelectorAll('.zbtn').forEach((b) => {
    b.onclick = (e) => {
      const mode = b.dataset.zoom;
      const rect = els.lightboxBody.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      if (mode === 'in') zoomAt(1.5, cx, cy);
      else if (mode === 'out') zoomAt(1 / 1.5, cx, cy);
      else if (mode === 'fit') {
        const img = els.lightboxImg;
        if (!img.naturalWidth) return;
        const pad = 40;
        zoom = clampZoom(Math.min(
          (els.lightboxBody.clientWidth - pad) / img.naturalWidth,
          (els.lightboxBody.clientHeight - pad) / img.naturalHeight,
        ));
        applyZoom(false);
        els.lightboxBody.scrollLeft = 0; els.lightboxBody.scrollTop = 0;
      } else { zoom = 1; applyZoom(false); }
    };
  });
  els.renderBtn.onclick = render;
  els.renderAllBtn.onclick = () => { void renderAll(); };
  els.zipBtn.onclick = downloadZip;
  els.pngCompression.addEventListener('input', () => {
    els.pngCompressionVal.textContent = els.pngCompression.value;
  });
  els.format.addEventListener('change', () => {
    els.pngCompressionField.style.opacity = els.format.value === 'png' ? '1' : '.35';
  });
  els.engine.addEventListener('change', setEngineTag);

  setStatus('ok', t('statusReady'));
  applyLang();
  updateRenderButtons();
  void restoreGameDir();
})();
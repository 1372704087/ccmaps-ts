// CNCMaps TS web UI logic.
(function () {
  'use strict';

  // Keep in sync with package.json.
  const APP_VERSION = '1.1.0';

  const $ = (id) => document.getElementById(id);
  const els = {
    renderMode: $('renderMode'), modeHint: $('modeHint'),
    srcLabel: $('srcLabel'), resLabel: $('resLabel'),
    maplist: $('maplist'), clearMapsBtn: $('clearMapsBtn'), mapInfo: $('mapInfo'), mapInfoSummary: $('mapInfoSummary'), mapInfoBody: $('mapInfoBody'),
    sources: document.querySelector('.panel.sources'),
    gameDirBtn: $('gameDirBtn'), gameDirInput: $('gameDirInput'), assetState: $('assetState'),
    gameResSection: $('gameResSection'),
    uploadBtn: $('uploadBtn'), fileInput: $('fileInput'),
    format: $('format'), engine: $('engine'), sizeMode: $('sizeMode'),
    pngCompression: $('pngCompression'), pngCompressionVal: $('pngCompressionVal'),
    previewWidth: $('previewWidth'), jpegQuality: $('jpegQuality'), jpegQualityVal: $('jpegQualityVal'),
    jpegQualityField: $('jpegQualityField'), pngCompressionField: $('pngCompressionField'),
    presetSelect: $('presetSelect'), presetSaveBtn: $('presetSaveBtn'), presetDeleteBtn: $('presetDeleteBtn'),
    serverHealth: $('serverHealth'), appVersion: $('appVersion'),
    markStartPos: $('markStartPos'), markOre: $('markOre'),
    renderBtn: $('renderBtn'), renderAllBtn: $('renderAllBtn'), zipBtn: $('zipBtn'), cancelBtn: $('cancelBtn'), renderState: $('renderState'),
    progressWrap: $('progressWrap'), progressFill: $('progressFill'),
    progressPct: $('progressPct'), progressPhase: $('progressPhase'),
    renderLog: $('renderLog'), logBody: $('logBody'), logCount: $('logCount'), logClearBtn: $('logClearBtn'),
    previewFrame: $('previewFrame'), placeholder: $('placeholder'), previewImg: $('previewImg'),
    previewMeta: $('previewMeta'), downloadBtn: $('downloadBtn'),
    renderHistory: $('renderHistory'), renderHistoryList: $('renderHistoryList'), clearHistoryBtn: $('clearHistoryBtn'),
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
  let cancelRequested = false;
  let batchCancelled = false;
  let currentJobId = null;
  let abortController = null;
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
      'clearMaps': '清空',
      'removeMap': '移除',
      'mapsCleared': '已清空地图列表',
      'mapRemoved': '已移除地图',
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
      'lblJpegQuality': 'JPEG 质量',
      'lblPreviewWidth': '预览宽度',
      'previewOriginal': '原始尺寸',
      'presetCustom': '自定义参数',
      'presetSave': '保存预设',
      'presetDelete': '删除',
      'presetNamePrompt': '预设名称：',
      'presetSaved': '预设已保存',
      'presetDeleted': '预设已删除',
      'presetDeleteConfirm': '删除这个预设？',
      'serverOk': '服务器就绪：游戏目录 {dirs} 个 · 并发 {active}/{max}',
      'serverQueued': '排队 {n}',
      'serverNoDirs': '服务器未配置游戏资源（浏览器模式可用）',
      'serverDirInvalid': '服务器游戏目录无效或缺少 .mix 文件',
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
      'historyClear': '清空',
      'historyClearConfirm': '清空全部渲染历史？',
      'historyCleared': '渲染历史已清空',
      'historyReuse': '复用参数',
      'historyReuseTitle': '套用该次渲染参数并重新渲染',
      'historyNoMap': '已套用参数，但地图列表中找不到对应地图',
      'historyNoParams': '该历史记录没有保存的渲染参数',
      'logTitle': '渲染日志',
      'logClear': '清空',
      'versionTitle': '当前版本',
      'cancelBtn': '取消',
      'cancelling': '正在取消…',
      'cancelled': '已取消',
      'queuedPos': '排队中（第 {pos} 位）',
      'batchCancelled': '批量渲染已取消',
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
      'clearMaps': 'Clear',
      'removeMap': 'Remove',
      'mapsCleared': 'Map list cleared',
      'mapRemoved': 'Map removed',
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
      'lblJpegQuality': 'JPEG Quality',
      'lblPreviewWidth': 'Preview Width',
      'previewOriginal': 'Original Size',
      'presetCustom': 'Custom',
      'presetSave': 'Save Preset',
      'presetDelete': 'Delete',
      'presetNamePrompt': 'Preset name:',
      'presetSaved': 'Preset saved',
      'presetDeleted': 'Preset deleted',
      'presetDeleteConfirm': 'Delete this preset?',
      'serverOk': 'Server ready: {dirs} game dir(s) · concurrency {active}/{max}',
      'serverQueued': '{n} queued',
      'serverNoDirs': 'Server has no game resources (browser mode still works)',
      'serverDirInvalid': 'Server game directories are invalid or contain no .mix files',
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
      'historyClear': 'Clear',
      'historyClearConfirm': 'Clear all render history?',
      'historyCleared': 'Render history cleared',
      'historyReuse': 'Reuse settings',
      'historyReuseTitle': 'Apply these settings and render again',
      'historyNoMap': 'Settings applied, but no matching map is in the list',
      'historyNoParams': 'This history entry has no saved settings',
      'logTitle': 'Render log',
      'logClear': 'Clear',
      'versionTitle': 'Version',
      'cancelBtn': 'Cancel',
      'cancelling': 'Cancelling…',
      'cancelled': 'Cancelled',
      'queuedPos': 'Queued (position {pos})',
      'batchCancelled': 'Batch render cancelled',
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
    els.appVersion.title = t('versionTitle') + ' ' + APP_VERSION;
    setEngineTag();
    if (els.infoRender.textContent === I18N.zh['infoRenderEmpty'])
      els.infoRender.textContent = t('infoRenderEmpty');
    if (assetInfo)
      els.assetState.textContent = tf('assetLocalReady', assetInfo);
    if (currentInfoEntry) renderMapInfo(currentInfoEntry, currentMapInfo);
    if (renderStateSupportsT(els.renderState.textContent))
      els.renderState.textContent = t(renderStateSupportsT(els.renderState.textContent));
    applyModeUI();
    populatePresets(els.presetSelect.value === '' ? null : Number(els.presetSelect.value));
    renderHistoryList();
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
    else if (renderMode === 'server') void refreshServerHealth();
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
    els.cancelBtn.hidden = idle;
    els.cancelBtn.disabled = cancelRequested;
    els.clearMapsBtn.disabled = !idle || maps.length === 0;
  }

  function cancelRender() {
    if (!renderBusy && !batchBusy) return;
    if (cancelRequested) return;
    cancelRequested = true;
    if (batchBusy) batchCancelled = true;
    setStatus('work', t('cancelling'));
    updateRenderButtons();
    if (br) {
      try { br.terminate(); } catch (e) { /* ignore */ }
      br = null;
      brAssetsSig = '';
    }
    if (currentJobId) {
      fetch('/api/render/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentJobId }),
      }).catch(() => {});
    }
    if (abortController) {
      try { abortController.abort(); } catch (e) { /* ignore */ }
    }
  }

  function applyFormatFields() {
    const jpg = els.format.value === 'jpg';
    els.pngCompressionField.style.display = jpg ? 'none' : '';
    els.jpegQualityField.style.display = jpg ? '' : 'none';
  }

  const PRESET_KEY = 'cncmaps_presets';

  function loadPresets() {
    try {
      const list = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function storePresets(list) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  }

  function currentPresetValues() {
    return {
      format: els.format.value,
      engine: els.engine.value,
      sizeMode: els.sizeMode.value,
      previewWidth: els.previewWidth.value,
      pngCompression: els.pngCompression.value,
      jpegQuality: els.jpegQuality.value,
      markStartPos: els.markStartPos.checked,
      markOre: els.markOre.checked,
    };
  }

  function applyPresetValues(values) {
    if (!values) return;
    els.format.value = values.format === 'jpg' ? 'jpg' : 'png';
    els.engine.value = values.engine || '';
    els.sizeMode.value = values.sizeMode || '';
    els.previewWidth.value = values.previewWidth || '0';
    els.pngCompression.value = values.pngCompression || '4';
    els.pngCompressionVal.textContent = els.pngCompression.value;
    els.jpegQuality.value = values.jpegQuality || '95';
    els.jpegQualityVal.textContent = els.jpegQuality.value;
    els.markStartPos.checked = !!values.markStartPos;
    els.markOre.checked = !!values.markOre;
    applyFormatFields();
    setEngineTag();
  }

  function populatePresets(selectedIndex) {
    const presets = loadPresets();
    els.presetSelect.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = t('presetCustom');
    els.presetSelect.appendChild(custom);
    presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.name;
      els.presetSelect.appendChild(option);
    });
    els.presetSelect.value = selectedIndex != null && presets[selectedIndex] ? String(selectedIndex) : '';
  }

  function savePreset() {
    const presetName = (window.prompt(t('presetNamePrompt'), '') || '').trim();
    if (!presetName) return;
    const presets = loadPresets();
    const values = currentPresetValues();
    const existing = presets.findIndex((p) => p.name === presetName);
    if (existing >= 0) presets[existing].values = values;
    else presets.push({ name: presetName, values });
    storePresets(presets);
    populatePresets(existing >= 0 ? existing : presets.length - 1);
    setStatus('ok', t('presetSaved'));
  }

  function deletePreset() {
    if (els.presetSelect.value === '') return;
    if (!window.confirm(t('presetDeleteConfirm'))) return;
    const presets = loadPresets();
    presets.splice(Number(els.presetSelect.value), 1);
    storePresets(presets);
    populatePresets();
    setStatus('ok', t('presetDeleted'));
  }

  async function refreshServerHealth() {
    try {
      const resp = await fetch('/api/health');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const health = await resp.json();
      if (health.gameDirs === 0) {
        els.serverHealth.textContent = t('serverNoDirs');
        els.serverHealth.classList.add('warn');
        return;
      }
      if (health.gameDirsValid === 0) {
        els.serverHealth.textContent = t('serverDirInvalid');
        els.serverHealth.classList.add('warn');
        return;
      }
      let text = tf('serverOk', {
        dirs: health.gameDirsValid,
        active: health.activeRenderJobs,
        max: health.maxRenderJobs,
      });
      if (health.queuedRenders > 0) text += ' · ' + tf('serverQueued', { n: health.queuedRenders });
      els.serverHealth.textContent = text;
      els.serverHealth.classList.remove('warn');
    } catch (e) {
      els.serverHealth.textContent = '';
      els.serverHealth.classList.remove('warn');
    }
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
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'ml-remove';
      rm.textContent = '×';
      rm.title = t('removeMap');
      rm.setAttribute('aria-label', t('removeMap'));
      rm.onclick = (e) => { e.stopPropagation(); removeMap(m); };
      item.appendChild(rm);
      els.maplist.appendChild(item);
    });
    if (selectedMap) selectMap(selectedMap);
    updateRenderButtons();
  }

  function resetMapSelection() {
    selectedMap = null;
    currentInfoEntry = null;
    els.mapInfo.hidden = true;
    els.renderState.textContent = t('renderStateIdle');
  }

  function removeMap(entry) {
    if (renderBusy || batchBusy) return;
    const idx = maps.indexOf(entry);
    if (idx === -1) return;
    maps.splice(idx, 1);
    if (selectedMap === entry) selectedMap = maps[Math.min(idx, maps.length - 1)] || null;
    if (!maps.length) resetMapSelection();
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + maps.length;
    setStatus('ok', t('mapRemoved'));
  }

  function clearMaps() {
    if (renderBusy || batchBusy || !maps.length) return;
    maps.length = 0;
    resetMapSelection();
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + 0;
    setStatus('ok', t('mapsCleared'));
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

  // ---- render log ----
  const MAX_LOG_LINES = 200;
  let logEntries = [];

  function appendLog(message, level) {
    const text = String(message == null ? '' : message).trim();
    if (!text) return;
    logEntries.push({
      at: Date.now(),
      level: level || 'info',
      text: text.length > 1000 ? text.slice(0, 1000) + '…' : text,
    });
    if (logEntries.length > MAX_LOG_LINES) logEntries.splice(0, logEntries.length - MAX_LOG_LINES);
    renderLog();
  }

  function clearLog() {
    logEntries = [];
    renderLog();
  }

  function renderLog() {
    els.renderLog.hidden = logEntries.length === 0;
    els.logCount.textContent = logEntries.length ? String(logEntries.length) : '';
    const atBottom = els.logBody.scrollHeight - els.logBody.scrollTop - els.logBody.clientHeight < 24;
    els.logBody.innerHTML = '';
    for (const entry of logEntries) {
      const d = new Date(entry.at);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const line = document.createElement('div');
      line.className = 'log-line ' + entry.level;
      line.textContent = '[' + hh + ':' + mm + ':' + ss + '] ' + entry.text;
      els.logBody.appendChild(line);
    }
    if (atBottom) els.logBody.scrollTop = els.logBody.scrollHeight;
  }

  function openLog() {
    if (!els.renderLog.hidden) els.renderLog.open = true;
  }

  function showPreview(url, meta) {
    els.previewImg.onload = () => {
      els.placeholder.style.display = 'none';
      els.previewImg.style.display = 'block';
    };
    els.previewImg.src = url.startsWith('blob:') ? url : url + '?t=' + Date.now();
    if (meta) els.previewMeta.textContent = meta;
  }

  function addRenderHistory(url, downloadUrl, name, blob, values) {
    if (!url) return;
    const existing = renderHistory.find((h) => h.url === url);
    if (existing) {
      existing.name = name || existing.name;
      if (values) existing.values = values;
      renderHistoryList();
      return;
    }
    const item = { id: ++historySeq, dbId: null, url, downloadUrl: downloadUrl || url, name: name || '', values: values || null };
    renderHistory.unshift(item);
    while (renderHistory.length > MAX_HISTORY) {
      const removed = renderHistory.pop();
      if (!removed) continue;
      if (removed.dbId != null) void deleteRenderRecord(removed.dbId);
      if (removed.url.startsWith('blob:') && (!currentImage || currentImage.url !== removed.url)) {
        URL.revokeObjectURL(removed.url);
      }
    }
    renderHistoryList();
    void persistRenderHistoryItem(item, blob, downloadUrl);
  }

  async function persistRenderHistoryItem(item, blob, sourceUrl) {
    try {
      let imageBlob = blob;
      if (!imageBlob && sourceUrl) {
        const resp = await fetch(sourceUrl);
        if (resp.ok) imageBlob = await resp.blob();
      }
      if (!imageBlob || !renderHistory.includes(item)) return;
      if (!item.url.startsWith('blob:')) {
        const oldUrl = item.url;
        const newUrl = URL.createObjectURL(imageBlob);
        item.url = newUrl;
        item.downloadUrl = newUrl;
        if (currentImage && currentImage.url === oldUrl) {
          currentImage = { ...currentImage, url: newUrl, downloadUrl: newUrl };
        }
        renderHistoryList();
      }
      item.dbId = await saveRenderRecord(item.name, imageBlob, item.values);
    } catch (e) { /* persistence is best-effort */ }
  }

  function removeHistoryItem(id) {
    const idx = renderHistory.findIndex((h) => h.id === id);
    if (idx === -1) return;
    const [item] = renderHistory.splice(idx, 1);
    if (item.dbId != null) void deleteRenderRecord(item.dbId);
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
      const wrap = document.createElement('div');
      wrap.className = 'rh-item' + (currentImage && currentImage.url === item.url ? ' active' : '');
      wrap.title = item.name;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rh-pick';
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
      const actions = document.createElement('div');
      actions.className = 'rh-actions';
      const reuse = document.createElement('button');
      reuse.type = 'button';
      reuse.className = 'rh-act';
      reuse.textContent = t('historyReuse');
      reuse.title = t('historyReuseTitle');
      reuse.disabled = !item.values;
      reuse.onclick = (e) => { e.stopPropagation(); reuseHistoryParams(item); };
      actions.appendChild(reuse);
      wrap.appendChild(btn);
      wrap.appendChild(actions);
      els.renderHistoryList.appendChild(wrap);
    }
  }

  function reuseHistoryParams(item) {
    if (!item.values) { setStatus('err', t('historyNoParams')); return; }
    if (renderBusy || batchBusy) return;
    applyPresetValues(item.values);
    const base = item.name.replace(/\.(png|jpe?g)$/i, '').toLowerCase();
    const match = maps.find((m) => m.name.replace(/\.(map|yrm|mpr)$/i, '').toLowerCase() === base);
    if (!match) { setStatus('err', t('historyNoMap')); return; }
    selectedMap = match;
    renderMapList();
    render();
  }

  async function clearRenderHistory() {
    if (!renderHistory.length) return;
    if (!window.confirm(t('historyClearConfirm'))) return;
    for (const item of renderHistory) {
      if (item.url.startsWith('blob:') && (!currentImage || currentImage.url !== item.url)) {
        URL.revokeObjectURL(item.url);
      }
    }
    renderHistory.length = 0;
    renderHistoryList();
    setStatus('ok', t('historyCleared'));
    try {
      const db = await openGameDb();
      await new Promise((resolve) => {
        const tx = db.transaction(RENDER_STORE, 'readwrite');
        tx.objectStore(RENDER_STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) { /* history is best-effort */ }
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
    cancelRequested = false;
    if (!selectedMap) { setStatus('err', '请先选择地图'); return; }
    if (!selectedMap.file) { setStatus('err', t('browserNoMapFile')); return; }
    if (!gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    if (!BR_CLIENT || !BR_CLIENT.supported()) {
      setRenderMode('server');
      setStatus('err', t('browserUnsupported'));
      return renderServer();
    }

    renderBusy = true;
    const renderValues = currentPresetValues();
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
      if (!br) {
        br = BR_CLIENT.create();
        br.onLog = (level, message) => {
          appendLog(message, level >= 5 ? 'fatal' : level >= 4 ? 'error' : 'warn');
          if (level >= 4) openLog();
        };
      }
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
        previewWidth: Number(els.previewWidth.value) || 0,
        jpegQuality: Number(els.jpegQuality.value) || 95,
        markStartPos: els.markStartPos.checked,
        markOre: els.markOre.checked,
      }, (pct, phase) => {
        setProgress(pct, phaseLabel(phase));
      });

      setProgress(100, t('complete'));
      blobUrl = URL.createObjectURL(res.blob);
      currentImage = { url: blobUrl, name: res.name, downloadUrl: blobUrl };
      showPreview(blobUrl, res.name);
      addRenderHistory(blobUrl, blobUrl, res.name, res.blob, renderValues);
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
      if (cancelRequested || (e && e.name === 'AbortError')) {
        lastRenderResult = { ok: false, cancelled: true };
        els.renderState.textContent = t('cancelled');
        setStatus('ok', t('cancelled'));
      } else if (code === 'UNSUPPORTED') {
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
        appendLog(e && e.message ? e.message : String(e), 'error');
        openLog();
        els.renderState.textContent = t('renderFailed');
        if (!code) {
          if (br) { try { br.terminate(); } catch (err) { /* ignore */ } }
          br = null;
          brAssetsSig = '';
        }
      }
    } finally {
      renderBusy = false;
      cancelRequested = false;
      updateRenderButtons();
    }
    if (fallback) return renderServer();
  }

  async function renderServer() {
    if (renderBusy) return;
    lastRenderResult = { ok: false };
    cancelRequested = false;
    currentJobId = null;
    if (!selectedMap) { setStatus('err', '请先选择地图'); return; }
    abortController = new AbortController();

    renderBusy = true;
    const renderValues = currentPresetValues();
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
        previewWidth: Number(els.previewWidth.value) || 0,
        pngCompression: els.pngCompression.value,
        jpegQuality: Number(els.jpegQuality.value) || 95,
        markStartPos: els.markStartPos.checked,
        markOre: els.markOre.checked,
      };
      if (selectedMap.uploadToken) body.uploadToken = selectedMap.uploadToken;

      const resp = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!resp.ok || !resp.body) {
        let msg = 'HTTP ' + resp.status;
        try {
          const data = await resp.json();
          if (data && data.error) msg = data.error;
        } catch (e) { /* keep the HTTP status text */ }
        throw new Error(msg);
      }

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
          if (evt.type === 'job') {
            currentJobId = evt.id;
          } else if (evt.type === 'queued') {
            setProgress(0, tf('queuedPos', { pos: evt.position }));
            els.renderState.textContent = tf('queuedPos', { pos: evt.position });
          } else if (evt.type === 'start') {
            els.engineTag.textContent = t('enginePrefix') + argvShort(evt.args);
            lastStartArgs = evt.args;
          } else if (evt.type === 'progress') {
            lastProgress = evt.percent;
            setProgress(evt.percent, phaseLabel(evt.phase));
          } else if (evt.type === 'log') {
            appendLog(evt.message, evt.level === 'fatal' ? 'fatal' : 'warn');
            if (evt.level === 'fatal') {
              openLog();
              setStatus('err', t('renderError'));
            }
          } else if (evt.type === 'done') {
            if (evt.cancelled) {
              els.renderState.textContent = t('cancelled');
              setStatus('ok', t('cancelled'));
              lastRenderResult = { ok: false, cancelled: true };
            } else if (evt.ok) {
              setProgress(100, t('complete'));
              currentImage = { url: evt.url, name: evt.name, downloadUrl: evt.downloadUrl };
              showPreview(evt.url, evt.name);
              addRenderHistory(evt.url, evt.downloadUrl, evt.name, null, renderValues);
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
              appendLog((evt.message || t('renderFailed')) + (evt.code != null ? ' (code ' + evt.code + ')' : ''), 'error');
              openLog();
              els.renderState.textContent = t('renderFailed');
              setStatus('err', t('renderFailed'));
            }
          } else if (evt.type === 'error') {
            appendLog(evt.message || t('reqFailed'), 'error');
            openLog();
            els.renderState.textContent = t('errorPrefix') + (evt.message || '');
            setStatus('err', t('reqFailed'));
          }
        }
      }
    } catch (e) {
      if (cancelRequested || (e && e.name === 'AbortError')) {
        els.renderState.textContent = t('cancelled');
        setStatus('ok', t('cancelled'));
        lastRenderResult = { ok: false, cancelled: true };
      } else {
        appendLog(e && e.message ? e.message : String(e), 'error');
        openLog();
        els.renderState.textContent = t('reqFailed');
        setStatus('err', t('reqFailedPrefix') + (e && e.message || e));
      }
    } finally {
      renderBusy = false;
      cancelRequested = false;
      currentJobId = null;
      abortController = null;
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
    batchCancelled = false;
    zipBlob = null;
    updateRenderButtons();
    const entries = maps.slice();
    const zipped = [];
    let failed = 0;
    try {
      for (let i = 0; i < entries.length; i++) {
        if (batchCancelled) break;
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
        if (batchCancelled) break;
      }
      if (zipped.length) zipBlob = await window.createZipBlob(zipped);
      if (batchCancelled) setStatus('ok', t('batchCancelled'));
      else setStatus(zipped.length ? 'ok' : 'err', failed
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
  const RENDER_STORE = 'renders';
  const GAME_HANDLE_KEY = 'gameDir';
  const MAX_PERSIST_BYTES = 32 * 1024 * 1024;
  let savedDirHandle = null;

  function openGameDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(GAME_DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GAME_STORE)) db.createObjectStore(GAME_STORE);
        if (!db.objectStoreNames.contains(RENDER_STORE)) db.createObjectStore(RENDER_STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveRenderRecord(name, blob, values) {
    if (!blob || blob.size > MAX_PERSIST_BYTES) return null;
    try {
      const db = await openGameDb();
      const id = await new Promise((resolve, reject) => {
        const tx = db.transaction(RENDER_STORE, 'readwrite');
        const rq = tx.objectStore(RENDER_STORE).add({ name, blob, values: values || null, createdAt: Date.now() });
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
      await trimRenderRecords(db);
      return id;
    } catch (e) {
      return null;
    }
  }

  async function trimRenderRecords(db) {
    try {
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(RENDER_STORE, 'readonly');
        const rq = tx.objectStore(RENDER_STORE).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
      });
      records.sort((a, b) => b.createdAt - a.createdAt);
      const extra = records.slice(MAX_HISTORY);
      if (!extra.length) return;
      await new Promise((resolve) => {
        const tx = db.transaction(RENDER_STORE, 'readwrite');
        const store = tx.objectStore(RENDER_STORE);
        for (const record of extra) store.delete(record.id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) { /* ignore */ }
  }

  async function deleteRenderRecord(id) {
    if (id == null) return;
    try {
      const db = await openGameDb();
      const tx = db.transaction(RENDER_STORE, 'readwrite');
      tx.objectStore(RENDER_STORE).delete(id);
    } catch (e) { /* ignore */ }
  }

  async function restoreRenderHistory() {
    try {
      const db = await openGameDb();
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(RENDER_STORE, 'readonly');
        const rq = tx.objectStore(RENDER_STORE).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
      });
      records.sort((a, b) => a.createdAt - b.createdAt);
      for (const record of records.slice(-MAX_HISTORY)) {
        const url = URL.createObjectURL(record.blob);
        renderHistory.unshift({
          id: ++historySeq,
          dbId: record.id,
          url,
          downloadUrl: url,
          name: record.name || '',
          values: record.values || null,
        });
      }
      renderHistoryList();
    } catch (e) { /* ignore missing history */ }
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
  els.cancelBtn.onclick = cancelRender;
  els.clearMapsBtn.onclick = clearMaps;
  els.clearHistoryBtn.onclick = () => { void clearRenderHistory(); };
  els.logClearBtn.onclick = clearLog;
  els.pngCompression.addEventListener('input', () => {
    els.pngCompressionVal.textContent = els.pngCompression.value;
  });
  els.jpegQuality.addEventListener('input', () => {
    els.jpegQualityVal.textContent = els.jpegQuality.value;
  });
  els.format.addEventListener('change', applyFormatFields);
  els.engine.addEventListener('change', setEngineTag);
  els.presetSelect.addEventListener('change', () => {
    if (els.presetSelect.value === '') return;
    const preset = loadPresets()[Number(els.presetSelect.value)];
    if (preset) applyPresetValues(preset.values);
  });
  els.presetSaveBtn.onclick = savePreset;
  els.presetDeleteBtn.onclick = deletePreset;

  els.appVersion.textContent = 'v' + APP_VERSION;
  setStatus('ok', t('statusReady'));
  applyLang();
  applyFormatFields();
  populatePresets();
  updateRenderButtons();
  void refreshServerHealth();
  setInterval(() => { void refreshServerHealth(); }, 15000);
  void restoreRenderHistory();
  void restoreGameDir();
})();
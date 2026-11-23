// CNCMaps TS web UI logic.
(function () {
  'use strict';

  // Keep in sync with package.json.
  const APP_VERSION = '1.3.0';

  const $ = (id) => document.getElementById(id);
  const els = {
    renderMode: $('renderMode'), modeHint: $('modeHint'),
    srcLabel: $('srcLabel'), resLabel: $('resLabel'),
    maplist: $('maplist'), clearMapsBtn: $('clearMapsBtn'), mapInfo: $('mapInfo'), mapInfoSummary: $('mapInfoSummary'), mapInfoBody: $('mapInfoBody'),
    mapAnalysis: $('mapAnalysis'), mapAnalysisSummary: $('mapAnalysisSummary'), mapAnalysisBody: $('mapAnalysisBody'),
    sources: document.querySelector('.panel.sources'),
    gameDirBtn: $('gameDirBtn'), gameDirInput: $('gameDirInput'), assetState: $('assetState'),
    gameResSection: $('gameResSection'),
    uploadBtn: $('uploadBtn'), fileInput: $('fileInput'),
    format: $('format'), engine: $('engine'), sizeMode: $('sizeMode'),
    psdHint: $('psdHint'),
    pngCompression: $('pngCompression'), pngCompressionVal: $('pngCompressionVal'),
    previewWidth: $('previewWidth'), jpegQuality: $('jpegQuality'), jpegQualityVal: $('jpegQualityVal'),
    aspect: $('aspect'), cropEnable: $('cropEnable'), cropInputs: $('cropInputs'), cropHint: $('cropHint'),
    cropX: $('cropX'), cropY: $('cropY'), cropWidth: $('cropWidth'), cropHeight: $('cropHeight'),
    advancedOptions: $('advancedOptions'), markerShape: $('markerShape'), markerSize: $('markerSize'),
    tunnelPaths: $('tunnelPaths'), tunnelPosition: $('tunnelPosition'), iceGrowth: $('iceGrowth'), compressTiles: $('compressTiles'),
    fixOverlays: $('fixOverlays'), fixTiles: $('fixTiles'), noExpandMixes: $('noExpandMixes'), ignoreLighting: $('ignoreLighting'),
    zipTemplate: $('zipTemplate'),
    batchQueue: $('batchQueue'), batchQueueList: $('batchQueueList'), batchResumeBtn: $('batchResumeBtn'), batchRetryBtn: $('batchRetryBtn'), batchClearBtn: $('batchClearBtn'),
    jpegQualityField: $('jpegQualityField'), pngCompressionField: $('pngCompressionField'),
    presetSelect: $('presetSelect'), presetSaveBtn: $('presetSaveBtn'), presetDeleteBtn: $('presetDeleteBtn'),
    serverHealth: $('serverHealth'), appVersion: $('appVersion'),
    themeBtn: $('themeBtn'), themeMenu: $('themeMenu'), toastStack: $('toastStack'),
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
  let batchItems = [];
  let batchCurrent = null;
  let batchSkipCurrent = false;
  let batchZipEntries = [];
  let mapDragIndex = null;
  let currentJobId = null;
  let abortController = null;
  let lastRenderResult = null;
  let zipBlob = null;
  const renderHistory = [];
  let historySeq = 0;
  const MAX_HISTORY = 12;
  let mapInfoCache = new Map();
  const mapStatsCache = new WeakMap();
  let currentMapInfo = null;
  let currentInfoEntry = null;
  let infoRequestSeq = 0;
  let currentImage = null;
  let renderStart = 0;
  let lastStartArgs = [];
  let blobUrl = null;
  let infoRenderEmpty = true;
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
      'themeToggle': '切换主题',
      'themeDark': '深色',
      'themeLight': '浅色',
      'themeTerminal': '军规终端',
      'themeHolo': '全息冷蓝',
      'themePaper': '纸感工作台',
      'themeContrast': '高对比',
      'themeCyber': '赛博紫',
      'themeSoviet': '铁幕红',
      'themeFrost': '冰霜白',
      'themeSunset': '落日橙',
      'themeGroupDark': '深色系',
      'themeGroupLight': '浅色系',
      'themeGroupSpecial': '无障碍',
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
      'mapReorder': '地图顺序已调整',
      'streamEnded': '渲染连接提前断开，请重试',
      'zipFailed': 'ZIP 创建失败，请重试',
      'paramsTitle': '渲染参数',
      'lblFormat': '输出格式',
      'fmtPsd': 'PSD（分层）',
      'psdHint': 'PSD 分层导出仅支持服务器模式，会按地形、建筑、步兵、载具、飞行器、海军、地形对象、覆盖物、污染物写入独立图层',
      'psdServerOnly': 'PSD 分层导出仅支持服务器模式，请切换到服务器或使用 PNG/JPEG',
      'psdReady': 'PSD 已生成，点击下方按钮下载',
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
      'lblAspect': '画幅', 'aspectFree': '原始比例',
      'lblCrop': '区域裁剪', 'cropEnable': '启用', 'cropWidth': '宽 %', 'cropHeight': '高 %',
      'cropHint': '裁剪区域相对当前尺寸的百分比',
      'advancedTitle': '高级渲染',
      'lblMarkerShape': '出生点形状', 'markerSquared': '方块', 'markerCircled': '圆形', 'markerDiamond': '菱形', 'markerEllipsed': '椭圆', 'markerStar': '星形', 'markerTiled': '平铺',
      'lblMarkerSize': '标记大小', 'tglTunnels': '隧道路径', 'tglTunnelPos': '隧道位置偏移',
      'tglIce': '冰面增长', 'tglCompressTiles': '压缩瓦片', 'tglFixOverlays': '修复覆盖物', 'tglFixTiles': '修复瓦片',
      'tglNoExpandMixes': '不展开 MIX', 'tglIgnoreLighting': '忽略光照',
      'lblZipTemplate': 'ZIP 文件名模板', 'zipTemplateHint': '变量：{map} {engine} {width} {height} {index} {ext}，重名会自动加序号', 'batchResume': '继续未完成', 'bqResultMissing': '结果未缓存，请重试',
      'batchQueueTitle': '批量队列', 'batchRetryFailed': '重试失败', 'batchClear': '关闭', 'batchSkippedSuffix': ' · 跳过 {n} 张', 'batchRestored': '已恢复上次批量队列',
      'bqPending': '待渲染', 'bqRendering': '渲染中', 'bqDone': '完成', 'bqFailed': '失败', 'bqSkipped': '跳过',
      'bqSkip': '跳过', 'bqResume': '恢复', 'bqSkipCurrent': '跳过本张',
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
      'analysisTitle': '渲染统计',
      'analysisTerrain': '地形', 'analysisResources': '资源', 'analysisObjects': '物件',
      'analysisWater': '水面', 'analysisShore': '海岸', 'analysisCliff': '悬崖', 'analysisRamp': '斜坡', 'analysisElevation': '海拔',
      'analysisOre': '矿石', 'analysisGems': '宝石', 'analysisCredits': '信用点', 'analysisSpawners': '矿点',
      'analysisStructures': '建筑', 'analysisTech': '科技建筑', 'analysisUnits': '单位', 'analysisInfantry': '步兵', 'analysisAircraft': '飞机', 'analysisBridges': '桥梁',
      'infoLoading': '读取地图信息…', 'infoNone': '—',
      'dropHint': '可直接把地图文件拖到此面板',
      'readingGameDir': '读取游戏目录…',
      'gameDirPermission': '没有游戏目录读取权限',
      'gameDirRestoreFail': '无法恢复上次的游戏目录，请重新选择',
      'renderStateIdle': '尚未渲染',
      'mapFirst': '请先选择地图',
      'downloadOriginal': '⬇ 下载原图',
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
      'removeHistory': '删除',
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
      'themeToggle': 'Change theme',
      'themeDark': 'Dark',
      'themeLight': 'Light',
      'themeTerminal': 'Field Terminal',
      'themeHolo': 'Holo Blue',
      'themePaper': 'Paper Desk',
      'themeContrast': 'High Contrast',
      'themeCyber': 'Cyber Violet',
      'themeSoviet': 'Iron Curtain',
      'themeFrost': 'Frost Light',
      'themeSunset': 'Sunset Ember',
      'themeGroupDark': 'Dark',
      'themeGroupLight': 'Light',
      'themeGroupSpecial': 'Accessibility',
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
      'mapReorder': 'Map order updated',
      'streamEnded': 'Render connection ended early; please retry',
      'zipFailed': 'ZIP creation failed; please retry',
      'paramsTitle': 'Render Options',
      'lblFormat': 'Output Format',
      'fmtPsd': 'PSD (layers)',
      'psdHint': 'Layered PSD export is server-only and writes terrain, buildings, infantry, vehicles, aircraft, naval, terrain objects, overlays and smudges as separate layers',
      'psdServerOnly': 'Layered PSD export is server-only; switch to server mode or use PNG/JPEG',
      'psdReady': 'PSD ready — use the download button below',
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
      'lblAspect': 'Aspect', 'aspectFree': 'Original ratio',
      'lblCrop': 'Crop', 'cropEnable': 'Enabled', 'cropWidth': 'W %', 'cropHeight': 'H %',
      'cropHint': 'Crop values are percentages of the current size rect',
      'advancedTitle': 'Advanced Render',
      'lblMarkerShape': 'Start marker', 'markerSquared': 'Squared', 'markerCircled': 'Circled', 'markerDiamond': 'Diamond', 'markerEllipsed': 'Ellipsed', 'markerStar': 'Star', 'markerTiled': 'Tiled',
      'lblMarkerSize': 'Marker size', 'tglTunnels': 'Tunnel paths', 'tglTunnelPos': 'Tunnel offset',
      'tglIce': 'Ice growth', 'tglCompressTiles': 'Compress tiles', 'tglFixOverlays': 'Fix overlays', 'tglFixTiles': 'Fix tiles',
      'tglNoExpandMixes': 'Skip expand MIX', 'tglIgnoreLighting': 'Ignore lighting',
      'lblZipTemplate': 'ZIP filename template', 'zipTemplateHint': 'Variables: {map} {engine} {width} {height} {index} {ext}; duplicate names get a suffix', 'batchResume': 'Resume unfinished', 'bqResultMissing': 'Result not cached; retry it',
      'batchQueueTitle': 'Batch Queue', 'batchRetryFailed': 'Retry failed', 'batchClear': 'Close', 'batchSkippedSuffix': ' · {n} skipped', 'batchRestored': 'Previous batch queue restored',
      'bqPending': 'Pending', 'bqRendering': 'Rendering', 'bqDone': 'Done', 'bqFailed': 'Failed', 'bqSkipped': 'Skipped',
      'bqSkip': 'Skip', 'bqResume': 'Restore', 'bqSkipCurrent': 'Skip this',
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
      'analysisTitle': 'Render Stats',
      'analysisTerrain': 'Terrain', 'analysisResources': 'Resources', 'analysisObjects': 'Objects',
      'analysisWater': 'Water', 'analysisShore': 'Shore', 'analysisCliff': 'Cliff', 'analysisRamp': 'Ramp', 'analysisElevation': 'Elevation',
      'analysisOre': 'Ore', 'analysisGems': 'Gems', 'analysisCredits': 'Credits', 'analysisSpawners': 'Ore spawners',
      'analysisStructures': 'Structures', 'analysisTech': 'Tech', 'analysisUnits': 'Units', 'analysisInfantry': 'Infantry', 'analysisAircraft': 'Aircraft', 'analysisBridges': 'Bridges',
      'infoLoading': 'Reading map info…', 'infoNone': '—',
      'dropHint': 'Drag map files onto this panel',
      'readingGameDir': 'Reading game folder…',
      'gameDirPermission': 'No permission to read the game folder',
      'gameDirRestoreFail': 'Could not restore the previous game folder; select it again',
      'renderStateIdle': 'Not rendered yet',
      'mapFirst': 'Select a map first',
      'downloadOriginal': '⬇ Download original',
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
      'removeHistory': 'Delete',
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
    renderThemeMenu();
    updateThemeButton();
    els.appVersion.title = t('versionTitle') + ' ' + APP_VERSION;
    setEngineTag();
    if (infoRenderEmpty) els.infoRender.textContent = t('infoRenderEmpty');
    if (assetInfo)
      els.assetState.textContent = tf('assetLocalReady', assetInfo);
    if (currentInfoEntry) renderMapInfo(currentInfoEntry, currentMapInfo);
    if (renderStateSupportsT(els.renderState.textContent))
      els.renderState.textContent = t(renderStateSupportsT(els.renderState.textContent));
    applyModeUI();
    populatePresets(els.presetSelect.value === '' ? null : Number(els.presetSelect.value));
    renderHistoryList();
    renderBatchQueue();
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

  const THEME_KEY = 'cncmaps_theme';
  const THEME_GROUPS = {
    dark: 'themeGroupDark',
    light: 'themeGroupLight',
    special: 'themeGroupSpecial',
  };
  const THEMES = [
    { id: 'dark', labelKey: 'themeDark', group: 'dark' },
    { id: 'terminal', labelKey: 'themeTerminal', group: 'dark' },
    { id: 'holo', labelKey: 'themeHolo', group: 'dark' },
    { id: 'cyber', labelKey: 'themeCyber', group: 'dark' },
    { id: 'soviet', labelKey: 'themeSoviet', group: 'dark' },
    { id: 'sunset', labelKey: 'themeSunset', group: 'dark' },
    { id: 'light', labelKey: 'themeLight', group: 'light' },
    { id: 'frost', labelKey: 'themeFrost', group: 'light' },
    { id: 'paper', labelKey: 'themePaper', group: 'light' },
    { id: 'contrast', labelKey: 'themeContrast', group: 'special' },
  ];
  const THEME_IDS = THEMES.map((item) => item.id);
  let currentTheme = 'dark';

  function systemTheme() {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }
  function savedTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* storage may be blocked */ }
    return THEME_IDS.indexOf(saved) !== -1 ? saved : systemTheme();
  }
  function themeLabel(id) {
    const meta = THEMES.find((item) => item.id === id);
    return t(meta ? meta.labelKey : 'themeDark');
  }
  function updateThemeButton() {
    els.themeBtn.dataset.themeId = currentTheme;
    const label = t('themeToggle') + ' · ' + themeLabel(currentTheme);
    els.themeBtn.title = label;
    els.themeBtn.setAttribute('aria-label', label);
    els.themeMenu.querySelectorAll('.theme-item').forEach((item) => {
      item.setAttribute('aria-checked', item.dataset.themeId === currentTheme ? 'true' : 'false');
    });
  }
  function renderThemeMenu() {
    if (!els.themeMenu) return;
    els.themeMenu.textContent = '';
    let currentGroup = null;
    THEMES.forEach((item) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        const heading = document.createElement('div');
        heading.className = 'theme-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = t(THEME_GROUPS[item.group]);
        els.themeMenu.append(heading);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-item';
      btn.dataset.themeId = item.id;
      btn.setAttribute('role', 'menuitemradio');
      btn.setAttribute('aria-checked', item.id === currentTheme ? 'true' : 'false');
      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'theme-name';
      name.textContent = t(item.labelKey);
      const check = document.createElement('span');
      check.className = 'theme-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      btn.append(swatch, name, check);
      els.themeMenu.append(btn);
    });
    els.themeMenu.setAttribute('aria-label', t('themeToggle'));
  }
  function applyTheme(theme) {
    currentTheme = THEME_IDS.indexOf(theme) !== -1 ? theme : savedTheme();
    document.documentElement.dataset.cncmapsTheme = currentTheme;
    updateThemeButton();
  }
  let themeTransition = null;
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function themeRevealPoint(origin) {
    const rect = els.themeBtn.getBoundingClientRect();
    const x = origin && origin.x > 0 ? origin.x : rect.left + rect.width / 2;
    const y = origin && origin.y > 0 ? origin.y : rect.top + rect.height / 2;
    document.documentElement.style.setProperty('--theme-reveal-x', Math.round(x) + 'px');
    document.documentElement.style.setProperty('--theme-reveal-y', Math.round(y) + 'px');
  }
  function commitTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* theme still applies for this session */ }
    applyTheme(theme);
  }
  function runThemeVeil() {
    const veil = $('themeVeil');
    if (!veil || reducedMotion()) return;
    veil.classList.remove('run');
    void veil.offsetWidth;
    veil.classList.add('run');
  }
  function setTheme(theme, origin) {
    if (THEME_IDS.indexOf(theme) === -1 || theme === currentTheme) return;
    themeRevealPoint(origin);
    if (document.startViewTransition && !reducedMotion()) {
      try {
        if (themeTransition) themeTransition.skipTransition();
        const transition = document.startViewTransition(() => commitTheme(theme));
        themeTransition = transition;
        transition.finished.finally(() => {
          if (themeTransition === transition) themeTransition = null;
        }).catch(() => {});
        return;
      } catch (e) { /* fall back to a soft veil pulse */ }
    }
    commitTheme(theme);
    runThemeVeil();
  }
  function setThemeMenuOpen(open) {
    els.themeMenu.hidden = !open;
    els.themeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const active = els.themeMenu.querySelector('.theme-item[aria-checked="true"]');
      if (active) active.focus();
    }
  }
  els.themeBtn.onclick = (event) => {
    event.stopPropagation();
    setThemeMenuOpen(els.themeMenu.hidden);
  };
  els.themeMenu.addEventListener('click', (event) => {
    const item = event.target.closest('.theme-item');
    if (!item) return;
    setThemeMenuOpen(false);
    els.themeBtn.focus();
    setTheme(item.dataset.themeId, { x: event.clientX, y: event.clientY });
  });
  els.themeMenu.addEventListener('keydown', (event) => {
    const items = Array.from(els.themeMenu.querySelectorAll('.theme-item'));
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + delta + items.length) % items.length;
      items[next].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setThemeMenuOpen(false);
      els.themeBtn.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (els.themeMenu.hidden) return;
    if (els.themeMenu.contains(event.target) || els.themeBtn.contains(event.target)) return;
    setThemeMenuOpen(false);
  });

  const themeVeil = $('themeVeil');
  if (themeVeil) themeVeil.addEventListener('animationend', () => themeVeil.classList.remove('run'));
  function syncFxPlayState() {
    document.documentElement.classList.toggle('fx-paused', document.hidden);
  }
  document.addEventListener('visibilitychange', syncFxPlayState);
  syncFxPlayState();

  function setStatus(state, text) {
    els.statusDot.className = 'dot' + (state ? ' ' + state : '');
    els.statusText.textContent = text;
  }

  function toast(message, type, ms) {
    if (!message || !els.toastStack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.textContent = message;
    els.toastStack.appendChild(el);
    while (els.toastStack.children.length > 4) els.toastStack.firstElementChild.remove();
    const life = ms || (type === 'error' ? 4500 : 2800);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, life);
  }

  function renderToast(message, type) {
    if (!batchBusy || type === 'error' || type === 'warn') toast(message, type);
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
    els.serverHealth.hidden = browser;
    if (browser) els.serverHealth.textContent = '';
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
    if (els.batchRetryBtn) els.batchRetryBtn.disabled = !idle;
    if (els.batchClearBtn) els.batchClearBtn.disabled = !idle;
    updateMapInteractivity();
  }

  // Keep the drag/remove affordances in sync with renderBusy/batchBusy. The list
  // is only rebuilt at item boundaries, so leaving this to renderMapList() makes
  // items permanently non-draggable after a batch and still draggable during a
  // single render.
  function updateMapInteractivity() {
    const canEdit = !renderBusy && !batchBusy;
    els.maplist.querySelectorAll('.maplist-item').forEach((item) => {
      item.draggable = canEdit;
      const remove = item.querySelector('.ml-remove');
      if (remove) remove.disabled = !canEdit;
    });
  }

  function abortActiveRender() {
    if (cancelRequested) return;
    cancelRequested = true;
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

  function cancelRender() {
    if (!renderBusy && !batchBusy) return;
    if (cancelRequested) return;
    if (batchBusy) batchCancelled = true;
    setStatus('work', t('cancelling'));
    abortActiveRender();
  }

  function skipCurrentBatchItem() {
    if (!batchBusy || !batchCurrent || batchCurrent.status !== 'rendering') return;
    if (cancelRequested) return;
    batchSkipCurrent = true;
    setStatus('work', t('cancelling'));
    abortActiveRender();
  }

  function applyFormatFields() {
    const jpg = els.format.value === 'jpg';
    const psd = els.format.value === 'psd';
    els.pngCompressionField.style.display = jpg || psd ? 'none' : '';
    els.jpegQualityField.style.display = jpg ? '' : 'none';
    els.psdHint.hidden = !psd;
    els.previewWidth.disabled = psd;
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

  function syncCropInputs() {
    const enabled = els.cropEnable.checked;
    els.cropInputs.hidden = !enabled;
    els.cropHint.hidden = !enabled;
  }

  function cropValues() {
    const clamp = (v, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    };
    const x = clamp(els.cropX.value, 0, 99);
    const y = clamp(els.cropY.value, 0, 99);
    const width = Math.min(clamp(els.cropWidth.value, 1, 100), 100 - x);
    const height = Math.min(clamp(els.cropHeight.value, 1, 100), 100 - y);
    return { x, y, width, height };
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
      aspect: els.aspect.value,
      cropEnabled: els.cropEnable.checked,
      cropX: els.cropX.value,
      cropY: els.cropY.value,
      cropWidth: els.cropWidth.value,
      cropHeight: els.cropHeight.value,
      markerShape: els.markerShape.value,
      markerSize: els.markerSize.value,
      tunnelPaths: els.tunnelPaths.checked,
      tunnelPosition: els.tunnelPosition.checked,
      iceGrowth: els.iceGrowth.checked,
      compressTiles: els.compressTiles.checked,
      fixOverlays: els.fixOverlays.checked,
      fixTiles: els.fixTiles.checked,
      noExpandMixes: els.noExpandMixes.checked,
      ignoreLighting: els.ignoreLighting.checked,
      zipTemplate: els.zipTemplate.value,
    };
  }

  function applyPresetValues(values) {
    if (!values) return;
    els.format.value = values.format === 'jpg' ? 'jpg' : (values.format === 'psd' ? 'psd' : 'png');
    els.engine.value = values.engine || '';
    els.sizeMode.value = values.sizeMode || '';
    els.previewWidth.value = values.previewWidth || '0';
    els.pngCompression.value = values.pngCompression || '4';
    els.pngCompressionVal.textContent = els.pngCompression.value;
    els.jpegQuality.value = values.jpegQuality || '95';
    els.jpegQualityVal.textContent = els.jpegQuality.value;
    els.markStartPos.checked = !!values.markStartPos;
    els.markOre.checked = !!values.markOre;
    els.aspect.value = ['1:1', '4:5', '16:9', '9:16'].includes(values.aspect) ? values.aspect : '';
    els.cropEnable.checked = !!values.cropEnabled;
    els.cropX.value = values.cropX ?? '0';
    els.cropY.value = values.cropY ?? '0';
    els.cropWidth.value = values.cropWidth ?? '100';
    els.cropHeight.value = values.cropHeight ?? '100';
    els.markerShape.value = ['squared', 'circled', 'diamond', 'ellipsed', 'star', 'tiled'].includes(values.markerShape) ? values.markerShape : 'squared';
    els.markerSize.value = values.markerSize ?? '4';
    els.tunnelPaths.checked = !!values.tunnelPaths;
    els.tunnelPosition.checked = !!values.tunnelPosition;
    els.iceGrowth.checked = !!values.iceGrowth;
    els.compressTiles.checked = !!values.compressTiles;
    els.fixOverlays.checked = !!values.fixOverlays;
    els.fixTiles.checked = !!values.fixTiles;
    els.noExpandMixes.checked = !!values.noExpandMixes;
    els.ignoreLighting.checked = !!values.ignoreLighting;
    els.zipTemplate.value = values.zipTemplate || '{map}_{engine}_{width}x{height}.{ext}';
    syncCropInputs();
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
    toast(t('presetSaved'), 'ok');
  }

  function deletePreset() {
    if (els.presetSelect.value === '') return;
    if (!window.confirm(t('presetDeleteConfirm'))) return;
    const presets = loadPresets();
    presets.splice(Number(els.presetSelect.value), 1);
    storePresets(presets);
    populatePresets();
    setStatus('ok', t('presetDeleted'));
    toast(t('presetDeleted'), 'ok');
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
      els.mapAnalysis.hidden = true;
      updateRenderButtons();
      return;
    }
    maps.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'maplist-item';
      item.dataset.key = m.key;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', m.name);
      item.innerHTML = '<span class="ic">📤</span><span class="nm"></span><span class="sz"></span>';
      item.querySelector('.nm').textContent = m.name;
      const isLocalOnly = m.file && !m.uploadToken;
      item.querySelector('.sz').textContent = isLocalOnly ? t('browserBadge') : fmtSize(m.size);
      item.querySelector('.ic').textContent = m.file ? '📄' : '📤';
      item.onclick = () => { if (!renderBusy && !batchBusy) selectMap(m); };
      item.onkeydown = (e) => {
        if (e.target !== item || e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!renderBusy && !batchBusy) selectMap(m);
      };
      item.draggable = !renderBusy && !batchBusy;
      item.addEventListener('dragstart', (e) => {
        if (!item.draggable) return;
        mapDragIndex = maps.indexOf(m);
        item.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(mapDragIndex));
        }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        els.maplist.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
        mapDragIndex = null;
      });
      item.addEventListener('dragover', (e) => {
        if (mapDragIndex == null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const from = mapDragIndex;
        const to = maps.indexOf(m);
        mapDragIndex = null;
        if (from == null || from === to || from < 0 || to < 0) return;
        const [moved] = maps.splice(from, 1);
        maps.splice(to, 0, moved);
        renderMapList();
        setStatus('ok', t('mapReorder'));
      });
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
    els.mapAnalysis.hidden = true;
    els.renderState.textContent = t('renderStateIdle');
  }

  function removeMap(entry) {
    if (renderBusy || batchBusy) return;
    const idx = maps.indexOf(entry);
    if (idx === -1) return;
    maps.splice(idx, 1);
    if (selectedMap === entry) selectedMap = maps[Math.min(idx, maps.length - 1)] || null;
    if (!batchBusy) clearBatchQueue();
    if (!maps.length) resetMapSelection();
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + maps.length;
    setStatus('ok', t('mapRemoved'));
    toast(t('mapRemoved'), 'ok');
  }

  function clearMaps() {
    if (renderBusy || batchBusy || !maps.length) return;
    maps.length = 0;
    clearBatchQueue();
    resetMapSelection();
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + 0;
    setStatus('ok', t('mapsCleared'));
    toast(t('mapsCleared'), 'ok');
  }

  function renderMapInfo(entry, info) {
    currentInfoEntry = entry;
    currentMapInfo = info;
    if (!entry) { els.mapInfo.hidden = true; renderMapAnalysis(null); return; }
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
    renderMapAnalysis(entry);
  }

  function normalizeMapStats(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const terrain = raw.terrain && typeof raw.terrain === 'object' ? raw.terrain : null;
    const resources = raw.resources && typeof raw.resources === 'object' ? raw.resources : null;
    const objects = raw.objects && typeof raw.objects === 'object' ? raw.objects : null;
    if (!terrain && !resources && !objects) return null;
    return { terrain: terrain || {}, resources: resources || {}, objects: objects || {} };
  }

  function setMapStats(entry, raw) {
    if (!entry) return;
    const stats = normalizeMapStats(raw);
    if (!stats) return;
    mapStatsCache.set(entry, stats);
    if (selectedMap === entry) renderMapAnalysis(entry);
  }

  function renderMapAnalysis(entry) {
    const stats = entry ? mapStatsCache.get(entry) : null;
    if (!stats) {
      els.mapAnalysis.hidden = true;
      els.mapAnalysisBody.innerHTML = '';
      return;
    }
    const fmt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString(LANG === 'en' ? 'en-US' : 'zh-CN') : '0';
    };
    const terrain = stats.terrain;
    const resources = stats.resources;
    const objects = stats.objects;
    const rows = [
      [t('analysisTerrain'), [
        t('analysisWater') + ' ' + fmt(terrain.waterTiles),
        t('analysisShore') + ' ' + fmt(terrain.shoreTiles),
        t('analysisCliff') + ' ' + fmt(terrain.cliffTiles),
        t('analysisRamp') + ' ' + fmt(terrain.rampTiles),
        t('analysisElevation') + ' ' + fmt(terrain.heightMin) + '–' + fmt(terrain.heightMax),
      ].join(' · ')],
      [t('analysisResources'), [
        t('analysisOre') + ' ' + fmt(resources.oreCells),
        t('analysisGems') + ' ' + fmt(resources.gemCells),
        t('analysisCredits') + ' ' + fmt(resources.totalCredits),
        t('analysisSpawners') + ' ' + fmt(resources.oreSpawners),
      ].join(' · ')],
      [t('analysisObjects'), [
        t('analysisStructures') + ' ' + fmt(objects.structures),
        t('analysisTech') + ' ' + fmt(objects.techStructures),
        t('analysisUnits') + ' ' + fmt(objects.units),
        t('analysisInfantry') + ' ' + fmt(objects.infantry),
        t('analysisAircraft') + ' ' + fmt(objects.aircraft),
        t('analysisBridges') + ' ' + (objects.hasBridges ? '✓' : '—'),
      ].join(' · ')],
    ];
    els.mapAnalysisBody.innerHTML = '';
    for (const [key, value] of rows) {
      const row = document.createElement('div');
      row.className = 'ma-row';
      const k = document.createElement('span');
      k.className = 'ma-key';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'ma-val';
      v.textContent = value;
      row.append(k, v);
      els.mapAnalysisBody.appendChild(row);
    }
    els.mapAnalysisSummary.textContent = [
      t('analysisOre') + ' ' + fmt(resources.oreCells),
      t('analysisStructures') + ' ' + fmt(objects.structures),
      t('analysisUnits') + ' ' + fmt(objects.units),
    ].join(' · ');
    els.mapAnalysis.hidden = false;
    if (!els.mapAnalysis.dataset.autoOpen) {
      els.mapAnalysis.open = true;
      els.mapAnalysis.dataset.autoOpen = '1';
    }
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

  function setUploadBusy(busy) {
    els.uploadBtn.disabled = busy;
    els.uploadBtn.classList.toggle('is-busy', busy);
  }

  async function uploadMaps(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const valid = files.filter((f) => /\.(map|yrm|mpr)$/i.test(f.name));
    const bad = files.length - valid.length;
    if (!valid.length) {
      setStatus('err', t('extErr'));
      toast(t('extErr'), 'error');
      return;
    }
    let ok = 0;
    let lastErr = null;
    setUploadBusy(true);
    try {
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
          const entry = {
            key: 'up:' + data.token,
            name: data.name,
            size: data.size,
            uploadToken: data.token,
            uploadedAt: Number(data.uploadedAt) || Date.now(),
            tokenExpiresAt: Number(data.expiresAt) || undefined,
            file,
          };
          maps.push(entry);
          ok++;
          if (!selectedMap) selectedMap = entry;
        } catch (e) {
          lastErr = e;
        }
      }
    } finally {
      setUploadBusy(false);
    }
    renderMapList();
    els.infoMaps.textContent = t('mapsPrefix') + maps.length;
    if (ok === 0) {
      const msg = t('uploadFail') + (lastErr ? ': ' + (lastErr.message || lastErr) : '');
      setStatus('err', msg);
      toast(msg, 'error');
      return;
    }
    const msg = bad > 0
      ? tf('uploadBatchPartial', { ok, total: valid.length, bad })
      : tf('uploadBatchDone', { ok, total: valid.length });
    setStatus('ok', msg);
    toast(msg, 'ok');
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
    const msg = tf('localMapsAdded', { n: added || valid.length });
    setStatus('ok', msg);
    toast(msg, 'ok');
  }

  function setLocalAssets(assets) {
    gameFiles = assets;
    const size = assets.reduce((sum, a) => sum + a.file.size, 0);
    assetInfo = { n: assets.length, size: fmtSize(size) };
    els.assetState.textContent = tf('assetLocalReady', assetInfo);
    setStatus('ok', els.assetState.textContent);
  }

  function clearLocalAssets() {
    gameFiles = [];
    assetInfo = null;
    brAssetsSig = '';
    els.assetState.textContent = t('assetStateEmptyBrowser');
  }

  const ASSET_RE = /\.(mix|mmx|yro|ini|csf|pal|shp|tmp|vxl|hva|vpl|pkt)$/i;

  function setProgress(pct, phase) {
    pct = Math.max(0, Math.min(100, pct));
    els.progressFill.style.width = pct + '%';
    els.progressPct.textContent = Math.round(pct) + '%';
    els.progressPhase.textContent = phase || '';
    els.progressWrap.classList.add('show');
    if (batchCurrent && batchCurrent.status === 'rendering') {
      batchCurrent.percent = pct;
      const row = els.batchQueueList.querySelector('[data-batch-idx="' + batchCurrent.index + '"]');
      if (row) {
        const out = row.querySelector('.bq-pct');
        if (out) out.textContent = Math.round(pct) + '%';
      }
    }
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
    const ph = els.placeholder.querySelector('p');
    if (ph) ph.textContent = t('previewPlaceholder');
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
    const item = { id: ++historySeq, dbId: null, url, downloadUrl: downloadUrl || url, name: name || '', values: values || null, at: Date.now() };
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

  function historyMeta(item) {
    const parts = [];
    if (item.at) {
      const d = new Date(item.at);
      parts.push(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
    }
    if (item.values) {
      parts.push(item.values.format === 'jpg' ? 'JPG' : 'PNG');
      const eng = { ra2: 'RA2', yr: 'YR', ts: 'TS', fs: 'FS' }[item.values.engine];
      parts.push(eng || 'AUTO');
    }
    return parts.join(' · ');
  }

  function renderHistoryList() {
    els.renderHistoryList.innerHTML = '';
    if (!renderHistory.length) {
      els.renderHistory.hidden = true;
      return;
    }
    els.renderHistory.hidden = false;
    for (const item of renderHistory) {
      const meta = historyMeta(item);
      const wrap = document.createElement('div');
      wrap.className = 'rh-item' + (currentImage && currentImage.url === item.url ? ' active' : '');
      wrap.title = item.name + (meta ? ' · ' + meta : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rh-pick';
      btn.title = wrap.title;
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';
      img.onerror = () => removeHistoryItem(item.id);
      const name = document.createElement('span');
      name.className = 'rh-name';
      name.textContent = item.name;
      const metaEl = document.createElement('span');
      metaEl.className = 'rh-meta';
      metaEl.textContent = meta;
      btn.appendChild(img);
      btn.appendChild(name);
      btn.appendChild(metaEl);
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
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rh-del';
      del.textContent = '×';
      del.title = t('removeHistory');
      del.setAttribute('aria-label', t('removeHistory'));
      del.onclick = (e) => { e.stopPropagation(); removeHistoryItem(item.id); };
      actions.appendChild(reuse);
      actions.appendChild(del);
      wrap.appendChild(btn);
      wrap.appendChild(actions);
      els.renderHistoryList.appendChild(wrap);
    }
  }

  function reuseHistoryParams(item) {
    if (!item.values) {
      setStatus('err', t('historyNoParams'));
      toast(t('historyNoParams'), 'error');
      return;
    }
    if (renderBusy || batchBusy) return;
    applyPresetValues(item.values);
    const base = item.name.replace(/\.(png|jpe?g)$/i, '').toLowerCase();
    const match = maps.find((m) => m.name.replace(/\.(map|yrm|mpr)$/i, '').toLowerCase() === base);
    if (!match) {
      setStatus('err', t('historyNoMap'));
      toast(t('historyNoMap'), 'error');
      return;
    }
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
    toast(t('historyCleared'), 'ok');
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

  let lastFocus = null;
  function openLightbox(url, name) {
    if (els.lightbox.hidden) lastFocus = document.activeElement;
    els.lightboxImg.src = url;
    els.lightboxTitle.textContent = name || t('lightboxTitle');
    els.lightboxDownload.href = url.includes('/image/')
      ? url.replace('/image/', '/download/')
      : url;
    els.lightboxDownload.download = name || '';
    els.lightbox.hidden = false;
    zoom = 1;
    applyZoom();
    els.lightboxBody.scrollLeft = 0;
    els.lightboxBody.scrollTop = 0;
    try { els.lightboxClose.focus(); } catch (e) { /* ignore */ }
  }
  function closeLightbox() {
    if (els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }
    lastFocus = null;
  }

  function navigateHistory(delta) {
    if (!renderHistory.length) return;
    let idx = renderHistory.findIndex((h) => currentImage && h.url === currentImage.url);
    if (idx === -1) idx = 0;
    const next = renderHistory[(idx + delta + renderHistory.length) % renderHistory.length];
    selectHistoryItem(next);
    if (!els.lightbox.hidden) openLightbox(next.url, next.name);
  }

  // ---- lightbox zoom / pan ----
  let zoom = 1;
  const zoomMin = 0.2, zoomMax = 8;
  function clampZoom(z) { return Math.min(zoomMax, Math.max(zoomMin, z)); }
  function applyZoom() {
    const img = els.lightboxImg;
    if (!img.naturalWidth) return;
    img.style.width = (img.naturalWidth * zoom) + 'px';
    img.style.height = (img.naturalHeight * zoom) + 'px';
    els.zoomPct.textContent = Math.round(zoom * 100) + '%';
  }
  function zoomAt(factor, cx, cy) {
    const before = zoom;
    zoom = clampZoom(before * factor);
    const img = els.lightboxImg;
    const body = els.lightboxBody;
    const bodyRect = body.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    // Point under the cursor in image coordinates. The image is centered by
    // margin:auto, so its on-screen origin must come from getBoundingClientRect
    // rather than assuming it starts at scrollLeft/scrollTop.
    const imgX = (bodyRect.left + cx - imgRect.left) / before;
    const imgY = (bodyRect.top + cy - imgRect.top) / before;
    img.style.width = (img.naturalWidth * zoom) + 'px';
    img.style.height = (img.naturalHeight * zoom) + 'px';
    els.zoomPct.textContent = Math.round(zoom * 100) + '%';
    const after = img.getBoundingClientRect();
    body.scrollLeft += (after.left + imgX * zoom) - (bodyRect.left + cx);
    body.scrollTop += (after.top + imgY * zoom) - (bodyRect.top + cy);
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
    // Token TTL on the server is one hour. Refresh a few minutes early while
    // the original File is still available instead of failing the next render.
    const expiresAt = Number(entry.tokenExpiresAt) ||
      (Number(entry.uploadedAt) ? Number(entry.uploadedAt) + 60 * 60 * 1000 : 0);
    if (entry.uploadToken && (!expiresAt || Date.now() < expiresAt - 5 * 60 * 1000)) return;
    if (!entry.file) throw new Error(t('browserNoMapFile'));
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(entry.name) },
      body: entry.file,
    });
    const data = await resp.json();
    if (!resp.ok || !data.token) throw new Error(data.error || t('uploadFail'));
    entry.uploadToken = data.token;
    entry.uploadedAt = Number(data.uploadedAt) || Date.now();
    entry.tokenExpiresAt = Number(data.expiresAt) || entry.uploadedAt + 60 * 60 * 1000;
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
    if (!selectedMap) { setStatus('err', t('mapFirst')); return; }
    if (!selectedMap.file) { setStatus('err', t('browserNoMapFile')); return; }
    if (els.format.value === 'psd') {
      setStatus('err', t('psdServerOnly'));
      toast(t('psdServerOnly'), 'error');
      return;
    }
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
    els.previewFrame.classList.add('busy');
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
      const sig = gameFiles.map((a) => a.path + ':' + a.file.size + ':' + (a.file.lastModified || 0)).join('|');
      if (sig !== brAssetsSig) {
        setProgress(2, t('phaseAssets'));
        await br.setAssets(gameFiles);
        brAssetsSig = sig;
      }
      startedRendering = true;
      const crop = cropValues();
      const res = await br.render(selectedMap.file, selectedMap.name, {
        format: els.format.value,
        engine: els.engine.value,
        sizeMode: els.sizeMode.value,
        previewWidth: Number(els.previewWidth.value) || 0,
        jpegQuality: Number(els.jpegQuality.value) || 95,
        markStartPos: els.markStartPos.checked,
        markOre: els.markOre.checked,
        aspect: els.aspect.value || 'free',
        crop: els.cropEnable.checked ? {
          x: crop.x / 100, y: crop.y / 100,
          width: crop.width / 100, height: crop.height / 100,
        } : undefined,
        markerShape: els.markerShape.value,
        markerSize: Number(els.markerSize.value) || 4,
        tunnelPaths: els.tunnelPaths.checked,
        tunnelPosition: els.tunnelPosition.checked,
        markIceGrowth: els.iceGrowth.checked,
        compressTiles: els.compressTiles.checked,
        fixOverlays: els.fixOverlays.checked,
        fixupTiles: els.fixTiles.checked,
        noExpandMixes: els.noExpandMixes.checked,
        ignoreLighting: els.ignoreLighting.checked,
      }, (pct, phase) => {
        setProgress(pct, phaseLabel(phase));
      });

      setProgress(100, t('complete'));
      blobUrl = URL.createObjectURL(res.blob);
      currentImage = { url: blobUrl, name: res.name, downloadUrl: blobUrl };
      showPreview(blobUrl, res.name);
      setMapStats(selectedMap, res.stats);
      addRenderHistory(blobUrl, blobUrl, res.name, res.blob, renderValues);
      els.downloadBtn.disabled = false;
      els.downloadBtn.dataset.url = blobUrl;
      els.downloadBtn.dataset.name = res.name;
      const ms = Date.now() - (renderStart || Date.now());
      const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
      const engKey = engineKeyFromName(res.engine);
      els.engineTag.textContent = t('enginePrefix') + t(engKey);
      infoRenderEmpty = false;
      els.infoRender.textContent = t('recentPrefix') + res.name + ' · ' + t(engKey) + ' · ' + dur;
      els.renderState.textContent = t('renderDone');
      setStatus('ok', t('complete'));
      renderToast(t('renderDone') + ' · ' + res.name, 'ok');
      lastRenderResult = {
        ok: true,
        blob: res.blob,
        name: res.name,
        engine: res.engine || 'AUTO',
        width: Number(res.width) || undefined,
        height: Number(res.height) || undefined,
      };
    } catch (e) {
      lastRenderResult = { ok: false, error: e };
      const code = e && e.code;
      if (cancelRequested || (e && e.name === 'AbortError')) {
        lastRenderResult = { ok: false, cancelled: true };
        els.renderState.textContent = t('cancelled');
        setStatus('ok', t('cancelled'));
        renderToast(t('cancelled'), 'warn');
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
        renderToast(els.statusText.textContent, 'error');
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
      els.previewFrame.classList.remove('busy');
      updateRenderButtons();
    }
    if (fallback) return renderServer();
  }

  async function renderServer() {
    if (renderBusy) return;
    lastRenderResult = { ok: false };
    cancelRequested = false;
    currentJobId = null;
    if (!selectedMap) { setStatus('err', t('mapFirst')); return; }
    abortController = new AbortController();

    renderBusy = true;
    const renderValues = currentPresetValues();
    els.renderBtn.disabled = true;
    updateRenderButtons();
    renderStart = Date.now();
    setProgress(0, t('phaseSubmit'));
    els.renderState.textContent = t('renderingPrefix') + selectedMap.name;
    els.progressWrap.classList.add('show');
    els.previewFrame.classList.add('busy');
    setStatus('work', t('rendering'));

    try {
      await ensureServerUpload(selectedMap);
      const crop = cropValues();
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
        aspect: els.aspect.value || 'free',
        crop: els.cropEnable.checked ? crop : undefined,
        markerShape: els.markerShape.value,
        markerSize: Number(els.markerSize.value) || 4,
        tunnelPaths: els.tunnelPaths.checked,
        tunnelPosition: els.tunnelPosition.checked,
        markIceGrowth: els.iceGrowth.checked,
        compressTiles: els.compressTiles.checked,
        fixOverlays: els.fixOverlays.checked,
        fixupTiles: els.fixTiles.checked,
        noExpandMixes: els.noExpandMixes.checked,
        ignoreLighting: els.ignoreLighting.checked,
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
      let sawTerminal = false;
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
            sawTerminal = true;
            if (evt.cancelled) {
              els.renderState.textContent = t('cancelled');
              setStatus('ok', t('cancelled'));
              renderToast(t('cancelled'), 'warn');
              lastRenderResult = { ok: false, cancelled: true };
            } else if (evt.ok) {
              setProgress(100, t('complete'));
              const isPsd = /\.psd$/i.test(evt.name || '');
              if (isPsd) {
                currentImage = null;
                els.previewImg.style.display = 'none';
                els.previewImg.removeAttribute('src');
                els.placeholder.style.display = '';
                const ph = els.placeholder.querySelector('p');
                if (ph) ph.textContent = t('psdReady');
                els.previewMeta.textContent = evt.name;
              } else {
                currentImage = { url: evt.url, name: evt.name, downloadUrl: evt.downloadUrl };
                showPreview(evt.url, evt.name);
                addRenderHistory(evt.url, evt.downloadUrl, evt.name, null, renderValues);
              }
              setMapStats(selectedMap, evt.meta);
              els.downloadBtn.disabled = false;
              els.downloadBtn.dataset.url = evt.downloadUrl;
              els.downloadBtn.dataset.name = evt.name;
              const ms = Date.now() - (renderStart || Date.now());
              const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
              infoRenderEmpty = false;
              els.infoRender.textContent = t('recentPrefix') + (evt.name || '') + ' · ' +
                argvShort(lastStartArgs) + ' · ' + dur;
              els.renderState.textContent = t('renderDone');
              setStatus('ok', t('complete'));
              renderToast(t('renderDone') + ' · ' + evt.name, 'ok');
              const metaWidth = evt.meta && Number(evt.meta.renderedWidth);
              const metaHeight = evt.meta && Number(evt.meta.renderedHeight);
              lastRenderResult = {
                ok: true,
                downloadUrl: evt.downloadUrl,
                name: evt.name,
                engine: engineFromArgs(lastStartArgs),
                width: Number.isFinite(metaWidth) && metaWidth > 0 ? metaWidth : undefined,
                height: Number.isFinite(metaHeight) && metaHeight > 0 ? metaHeight : undefined,
              };
            } else {
              const failText = (evt.message || t('renderFailed')) + (evt.code != null ? ' (code ' + evt.code + ')' : '');
              lastRenderResult = { ok: false, error: new Error(failText) };
              setProgress(lastProgress, t('failCode') + evt.code + ')');
              appendLog(failText, 'error');
              openLog();
              renderToast(failText, 'error');
              els.renderState.textContent = t('renderFailed');
              setStatus('err', t('renderFailed'));
            }
          } else if (evt.type === 'error') {
            sawTerminal = true;
            lastRenderResult = { ok: false, error: new Error(evt.message || t('reqFailed')) };
            appendLog(evt.message || t('reqFailed'), 'error');
            openLog();
            renderToast(evt.message || t('reqFailed'), 'error');
            els.renderState.textContent = t('errorPrefix') + (evt.message || '');
            setStatus('err', t('reqFailed'));
          }
        }
      }
      if (!sawTerminal) throw new Error(t('streamEnded'));
    } catch (e) {
      if (cancelRequested || (e && e.name === 'AbortError')) {
        els.renderState.textContent = t('cancelled');
        setStatus('ok', t('cancelled'));
        renderToast(t('cancelled'), 'warn');
        lastRenderResult = { ok: false, cancelled: true };
      } else {
        lastRenderResult = { ok: false, error: e };
        appendLog(e && e.message ? e.message : String(e), 'error');
        openLog();
        renderToast(e && e.message ? e.message : String(e), 'error');
        els.renderState.textContent = t('reqFailed');
        setStatus('err', t('reqFailedPrefix') + (e && e.message || e));
      }
    } finally {
      renderBusy = false;
      cancelRequested = false;
      currentJobId = null;
      abortController = null;
      els.previewFrame.classList.remove('busy');
      updateRenderButtons();
    }
  }

  const MAX_BATCH = 12;

  function errorText(err) {
    if (!err) return t('renderFailed');
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }

  async function blobDimensions(blob) {
    if (!blob) return { width: 0, height: 0 };
    try {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(blob);
        const out = { width: bmp.width, height: bmp.height };
        if (bmp.close) bmp.close();
        return out;
      }
    } catch (e) { /* fall through to Image */ }
    return await new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }

  function zipEntryName(template, item, dims, ext, engine) {
    const values = {
      map: item.entry.name.replace(/\.[^.]+$/, ''),
      engine: engine || 'AUTO',
      width: dims.width ? String(dims.width) : 'unknown',
      height: dims.height ? String(dims.height) : 'unknown',
      index: String(item.index + 1),
      ext,
    };
    let out = String(template || '').trim() || '{map}_{engine}_{width}x{height}.{ext}';
    out = out.replace(/\{([a-z]+)\}/gi, (m, key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m);
    out = out.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    if (!out) out = values.map + '_' + values.engine + '_' + values.width + 'x' + values.height;
    if (!/\.[A-Za-z0-9]{2,5}$/.test(out)) out += '.' + ext;
    if (out.length > 180) out = out.slice(0, 170).replace(/[ ._]+$/, '') + '.' + ext;
    // Windows strips trailing dots/spaces on extraction and refuses device
    // names as file stems; normalize them inside the archive too.
    const extMatch = out.match(/\.([A-Za-z0-9]{2,5})$/);
    const stem = (extMatch ? out.slice(0, -extMatch[0].length) : out).replace(/[ .]+$/g, '');
    const safeStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? '_' + stem : (stem || 'map');
    out = safeStem + (extMatch ? extMatch[0] : '.' + ext);
    return out;
  }

  function uniqueZipName(name, used) {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 1;
    while (used.has(candidate.toLowerCase())) {
      n++;
      candidate = base + '_' + n + ext;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function batchStatusLabel(status) {
    const key = { pending: 'bqPending', rendering: 'bqRendering', ok: 'bqDone', failed: 'bqFailed', skipped: 'bqSkipped' }[status];
    return key ? t(key) : status;
  }

  function renderBatchQueue() {
    if (!els.batchQueue || !els.batchQueueList) return;
    const hasItems = batchItems.length > 0;
    els.batchQueue.hidden = !hasItems;
    if (!hasItems) {
      els.batchQueueList.replaceChildren();
      els.batchRetryBtn.hidden = true;
      els.batchResumeBtn.hidden = true;
      return;
    }
    const rows = batchItems.map((item) => {
      const row = document.createElement('div');
      row.className = 'bq-item ' + item.status;
      row.dataset.batchIdx = String(item.index);

      const dot = document.createElement('span');
      dot.className = 'bq-dot';
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'bq-name';
      name.textContent = item.entry.name;
      name.title = item.entry.name;
      row.appendChild(name);

      const state = document.createElement('span');
      state.className = 'bq-state';
      state.textContent = batchStatusLabel(item.status);
      row.appendChild(state);

      const pct = document.createElement('span');
      pct.className = 'bq-pct';
      pct.textContent = item.status === 'ok' ? '100%'
        : item.status === 'failed' || item.status === 'skipped' ? '—'
          : Math.round(item.percent || 0) + '%';
      row.appendChild(pct);

      if (item.error) {
        row.classList.add('has-error');
        row.title = item.error;
        const err = document.createElement('span');
        err.className = 'bq-error';
        err.textContent = item.error;
        err.title = item.error;
        row.appendChild(err);
        row.addEventListener('click', (e) => {
          if (e.target && e.target.closest('button')) return;
          openLog();
        });
      }

      let label = '';
      let action = null;
      if (item.status === 'pending') { label = t('bqSkip'); action = () => { item.status = 'skipped'; renderBatchQueue(); schedulePersistBatchQueue(); }; }
      else if (item.status === 'rendering') { label = t('bqSkipCurrent'); action = skipCurrentBatchItem; }
      else if (item.status === 'skipped' && batchBusy) { label = t('bqResume'); action = () => { item.status = 'pending'; renderBatchQueue(); schedulePersistBatchQueue(); }; }
      if (label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bq-act';
        btn.textContent = label;
        btn.addEventListener('click', action);
        row.appendChild(btn);
      }
      return row;
    });
    els.batchQueueList.replaceChildren(...rows);

    const failedCount = batchItems.filter((item) => item.status === 'failed').length;
    els.batchRetryBtn.hidden = failedCount === 0;
    els.batchRetryBtn.disabled = batchBusy || renderBusy;
    els.batchRetryBtn.textContent = failedCount ? t('batchRetryFailed') + ' (' + failedCount + ')' : t('batchRetryFailed');
    const unfinishedCount = batchItems.filter((item) => item.status === 'pending' || item.status === 'skipped').length;
    els.batchResumeBtn.hidden = unfinishedCount === 0 || batchBusy || renderBusy;
    els.batchResumeBtn.disabled = batchBusy || renderBusy;
    els.batchResumeBtn.textContent = t('batchResume') + (unfinishedCount ? ' (' + unfinishedCount + ')' : '');
  }

  function clearBatchQueue() {
    if (batchBusy || renderBusy) return;
    batchItems = [];
    batchCurrent = null;
    renderBatchQueue();
    void deleteBatchQueueRecord();
  }

  async function retryFailedBatch() {
    if (renderBusy || batchBusy) return;
    const failedItems = batchItems.filter((item) => item.status === 'failed');
    if (!failedItems.length) return;
    if (renderMode === 'browser' && !gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    for (const item of failedItems) {
      item.status = 'pending';
      item.percent = 0;
      item.error = '';
    }
    renderBatchQueue();
    schedulePersistBatchQueue();
    await runBatch(failedItems.map((item) => item.entry), true, true);
  }

  async function resumeBatch() {
    if (renderBusy || batchBusy) return;
    const unfinished = batchItems.filter((item) => item.status === 'pending' || item.status === 'skipped');
    if (!unfinished.length) return;
    if (renderMode === 'browser' && !gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    for (const item of unfinished) {
      item.status = 'pending';
      item.percent = 0;
      item.error = '';
    }
    renderBatchQueue();
    schedulePersistBatchQueue();
    await runBatch(unfinished.map((item) => item.entry), true, true);
  }

  async function renderAll() {
    if (renderBusy || batchBusy) return;
    if (!maps.length) return;
    if (maps.length > MAX_BATCH) { setStatus('err', tf('batchTooMany', { n: MAX_BATCH })); return; }
    if (renderMode === 'browser' && !gameFiles.length) { setStatus('err', t('browserNoAssets')); return; }
    if (renderMode === 'browser' && els.format.value === 'psd') {
      setStatus('err', t('psdServerOnly'));
      toast(t('psdServerOnly'), 'error');
      return;
    }
    await runBatch(maps.slice());
  }

  async function runBatch(entries, keepZip = false, preserveQueue = false) {
    if ((!entries.length && !preserveQueue) || renderBusy || batchBusy) return;
    batchBusy = true;
    batchCancelled = false;
    batchSkipCurrent = false;
    batchCurrent = null;
    if (!keepZip) { zipBlob = null; batchZipEntries = []; }
    if (!preserveQueue) batchItems = entries.map((entry, index) => ({ entry, index, status: 'pending', percent: 0 }));
    renderBatchQueue();
    updateRenderButtons();
    schedulePersistBatchQueue();

    const zipped = keepZip ? batchZipEntries.slice() : [];
    const usedZipNames = new Set(zipped.map((z) => String(z.name).toLowerCase()));
    let zipError = null;
    try {
      for (const item of batchItems) {
        if (batchCancelled) break;
        if (item.status !== 'pending') continue;
        batchCurrent = item;
        batchSkipCurrent = false;
        item.status = 'rendering';
        item.percent = 0;
        item.error = '';
        renderBatchQueue();
        schedulePersistBatchQueue();

        selectedMap = item.entry;
        renderMapList();
        setStatus('work', tf('batchRendering', { i: item.index + 1, total: batchItems.length, name: item.entry.name }));
        lastRenderResult = null;
        if (renderMode === 'browser') await renderBrowser();
        else await renderServer();

        const result = lastRenderResult;
        const wasSkipped = batchSkipCurrent || (result && result.cancelled);
        if (wasSkipped) {
          item.status = 'skipped';
          item.percent = 0;
          item.error = '';
          renderBatchQueue();
          schedulePersistBatchQueue();
          await new Promise((r) => setTimeout(r, 0));
          continue;
        }

        if (result && result.ok) {
          let blob = result.blob;
          if (!blob && result.downloadUrl) {
            try {
              const resp = await fetch(result.downloadUrl);
              if (resp.ok) blob = await resp.blob();
            } catch (e) { /* count as failure below */ }
          }
          if (blob) {
            let dims = { width: Number(result.width) || 0, height: Number(result.height) || 0 };
            if (!dims.width || !dims.height) {
              try { dims = await blobDimensions(blob); } catch (e) { dims = { width: 0, height: 0 }; }
            }
            const ext = blob.type === 'image/jpeg' || /\.jpe?g$/i.test(result.name || '') ? 'jpg' : 'png';
            const zipName = uniqueZipName(zipEntryName(els.zipTemplate.value, item, dims, ext, result.engine), usedZipNames);
            item.blob = blob;
            item.outputName = zipName;
            zipped.push({ name: zipName, blob });
            item.status = 'ok';
            item.percent = 100;
            item.error = '';
          } else {
            item.status = 'failed';
            item.error = t('bqResultMissing');
          }
        } else {
          item.status = 'failed';
          item.error = errorText(result && result.error);
        }
        renderBatchQueue();
        schedulePersistBatchQueue();
        await new Promise((r) => setTimeout(r, 0));
        if (batchCancelled) break;
      }
      if (batchCancelled) {
        for (const item of batchItems) {
          if (item.status === 'pending') item.status = 'skipped';
        }
        renderBatchQueue();
      }
      if (zipped.length) {
        batchZipEntries = zipped;
        const previousZip = zipBlob;
        try {
          zipBlob = await window.createZipBlob(zipped);
        } catch (e) {
          zipError = e;
          zipBlob = previousZip; // keep an older archive if a retry added files
          appendLog(t('zipFailed') + ': ' + errorText(e), 'error');
          openLog();
        }
      }
      const okCount = batchItems.filter((item) => item.status === 'ok').length;
      const failedCount = batchItems.filter((item) => item.status === 'failed').length;
      const skippedCount = batchItems.filter((item) => item.status === 'skipped').length;
      if (zipError) {
        const msg = t('zipFailed') + ': ' + errorText(zipError);
        setStatus('err', msg);
        toast(msg, 'error');
      } else if (batchCancelled) {
        setStatus('ok', t('batchCancelled'));
        toast(t('batchCancelled'), 'warn');
      } else {
        let msg = failedCount
          ? tf('batchDoneFail', { ok: okCount, fail: failedCount })
          : tf('batchDone', { ok: okCount });
        if (skippedCount) msg += tf('batchSkippedSuffix', { n: skippedCount });
        setStatus(okCount ? 'ok' : 'err', msg);
        toast(msg, okCount ? 'ok' : 'error');
      }
    } catch (e) {
      const msg = errorText(e);
      if (batchCurrent) { batchCurrent.status = 'failed'; batchCurrent.error = msg; }
      setStatus('err', msg);
      toast(msg, 'error');
    } finally {
      if (batchCurrent && batchCurrent.status === 'rendering') {
        batchCurrent.status = 'failed';
        batchCurrent.error = t('renderFailed');
      }
      batchCurrent = null;
      batchBusy = false;
      updateRenderButtons();
      renderBatchQueue();
      schedulePersistBatchQueue();
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

  function engineFromArgs(args) {
    const forced = (args || []).find((a) => a.startsWith('--force-'));
    if (!forced) return 'AUTO';
    const m = { ra2: 'RA2', yr: 'YR', ts: 'TS', fs: 'FS' };
    return m[forced.replace('--force-', '')] || 'AUTO';
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
  const QUEUE_STORE = 'batchQueue';
  const QUEUE_KEY = 'current';
  const GAME_HANDLE_KEY = 'gameDir';
  const MAX_PERSIST_BYTES = 16 * 1024 * 1024;
  let savedDirHandle = null;

  let dbPromise = null;
  function openGameDb() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    const p = new Promise((resolve, reject) => {
      const req = indexedDB.open(GAME_DB, 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GAME_STORE)) db.createObjectStore(GAME_STORE);
        let store;
        if (!db.objectStoreNames.contains(RENDER_STORE)) {
          store = db.createObjectStore(RENDER_STORE, { keyPath: 'id', autoIncrement: true });
        } else {
          store = req.transaction.objectStore(RENDER_STORE);
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        if (!store.indexNames.contains('createdAt')) {
          store.createIndex('createdAt', 'createdAt');
          // Version 2 records predate the index; give them a timestamp so history
          // restore and trimming can see them instead of orphaning their blobs.
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const value = cursor.value;
            if (!value.createdAt) {
              value.createdAt = Date.now();
              cursor.update(value);
            }
            cursor.continue();
          };
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    // Reuse one connection for the whole session: the old code opened a new one
    // per save/trim/delete call and never closed it.
    dbPromise = p;
    p.catch(() => { if (dbPromise === p) dbPromise = null; });
    return p;
  }

  let queuePersistTimer = null;
  let queueRevision = 0;

  function queueEntryRecord(entry) {
    return {
      key: entry.key,
      name: entry.name,
      size: entry.size,
      uploadToken: entry.uploadToken || null,
      uploadedAt: entry.uploadedAt || null,
      tokenExpiresAt: entry.tokenExpiresAt || null,
      file: entry.file || null,
    };
  }

  async function persistBatchQueue(revision) {
    try {
      const db = await openGameDb();
      // A newer queue mutation (or a clear) superseded this snapshot while the
      // DB connection was opening. Never write it back over newer state.
      if (revision !== queueRevision) return;
      if (!batchItems.length) {
        await new Promise((resolve) => {
          const tx = db.transaction(QUEUE_STORE, 'readwrite');
          tx.objectStore(QUEUE_STORE).delete(QUEUE_KEY);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        return;
      }
      const items = [];
      let blobBytes = 0;
      for (const item of batchItems) {
        let blob = null;
        if (item.status === 'ok' && item.blob && item.blob.size + blobBytes <= MAX_PERSIST_BYTES) {
          blob = item.blob;
          blobBytes += item.blob.size;
        }
        items.push({
          entry: queueEntryRecord(item.entry),
          status: item.status === 'ok' && !blob ? 'failed' : item.status,
          percent: item.percent || 0,
          error: item.status === 'ok' && !blob ? t('bqResultMissing') : (item.error || ''),
          outputName: item.outputName || '',
          blob,
        });
      }
      const record = {
        id: QUEUE_KEY,
        updatedAt: Date.now(),
        mode: renderMode,
        template: els.zipTemplate.value,
        items,
      };
      await new Promise((resolve) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite');
        tx.objectStore(QUEUE_STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) { /* queue persistence is best-effort */ }
  }

  function schedulePersistBatchQueue() {
    const revision = ++queueRevision;
    if (queuePersistTimer) clearTimeout(queuePersistTimer);
    queuePersistTimer = setTimeout(() => {
      queuePersistTimer = null;
      void persistBatchQueue(revision);
    }, 150);
  }

  async function deleteBatchQueueRecord() {
    const revision = ++queueRevision;
    if (queuePersistTimer) { clearTimeout(queuePersistTimer); queuePersistTimer = null; }
    try {
      const db = await openGameDb();
      // A new queue may have started while this delete was opening the DB.
      if (revision !== queueRevision) return;
      await new Promise((resolve) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite');
        tx.objectStore(QUEUE_STORE).delete(QUEUE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) { /* ignore */ }
  }

  async function restoreBatchQueue() {
    try {
      const db = await openGameDb();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, 'readonly');
        const rq = tx.objectStore(QUEUE_STORE).get(QUEUE_KEY);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error);
      });
      if (!record || !Array.isArray(record.items) || !record.items.length) return;
      if (record.mode) setRenderMode(record.mode);
      if (record.template) els.zipTemplate.value = record.template;

      const restored = [];
      for (let i = 0; i < record.items.length; i++) {
        const saved = record.items[i];
        if (!saved || !saved.entry || !saved.entry.name) continue;
        let entry = {
          key: saved.entry.key,
          name: saved.entry.name,
          size: saved.entry.size || 0,
          uploadToken: saved.entry.uploadToken || null,
          uploadedAt: saved.entry.uploadedAt || null,
          tokenExpiresAt: saved.entry.tokenExpiresAt || null,
          file: saved.entry.file || null,
        };
        if (entry.file) {
          entry.uploadToken = null;
          entry.tokenExpiresAt = null;
        }
        const existing = maps.find((m) => m.key === entry.key || (m.name === entry.name && m.size === entry.size));
        if (existing) entry = existing;
        else maps.push(entry);

        let status = saved.status === 'rendering' ? 'pending' : (saved.status || 'pending');
        if (!['pending', 'ok', 'failed', 'skipped'].includes(status)) status = 'pending';
        let blob = saved.blob || null;
        let error = saved.error || '';
        if (status === 'ok' && !blob) {
          status = 'failed';
          error = t('bqResultMissing');
        }
        if (status === 'failed' && !error) error = t('renderFailed');
        restored.push({
          entry,
          index: i,
          status,
          percent: saved.percent || (status === 'ok' ? 100 : 0),
          error,
          blob,
          outputName: saved.outputName || '',
        });
      }

      batchItems = restored;
      batchZipEntries = [];
      for (const item of restored) {
        if (item.status === 'ok' && item.blob) {
          batchZipEntries.push({ name: item.outputName || item.entry.name, blob: item.blob });
        }
      }
      if (batchZipEntries.length) {
        try { zipBlob = await window.createZipBlob(batchZipEntries); } catch (e) { zipBlob = null; }
      }
      if (!selectedMap && maps.length) selectedMap = maps[0];
      renderMapList();
      els.infoMaps.textContent = t('mapsPrefix') + maps.length;
      renderBatchQueue();
      updateRenderButtons();
      setStatus('ok', t('batchRestored'));
    } catch (e) { /* ignore missing queue */ }
  }

  async function saveRenderRecord(name, blob, values) {
    if (!blob || blob.size > MAX_PERSIST_BYTES) return null;
    try {
      // Estimating storage lets us skip persistence instead of filling the origin
      // quota and making the transaction fail on every later render.
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota && (est.usage || 0) + blob.size > est.quota * 0.8) return null;
      }
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
      // getAll() loaded every full image blob (12 x 16 MB) just to find the oldest
      // records. A key cursor returns index keys plus the record's primary key,
      // which is what delete() needs (the index key is createdAt, not the id).
      const tx = db.transaction(RENDER_STORE, 'readonly');
      const index = tx.objectStore(RENDER_STORE).index('createdAt');
      const keys = await new Promise((resolve, reject) => {
        const req = index.openKeyCursor();
        const out = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(out);
          out.push(cursor.primaryKey);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
      const extra = keys.slice(0, Math.max(0, keys.length - MAX_HISTORY));
      if (!extra.length) return;
      await new Promise((resolve) => {
        const tx2 = db.transaction(RENDER_STORE, 'readwrite');
        const store = tx2.objectStore(RENDER_STORE);
        for (const id of extra) store.delete(id);
        tx2.oncomplete = resolve;
        tx2.onerror = resolve;
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
      // Read at most MAX_HISTORY records, newest first, instead of materializing
      // the whole blob store at startup.
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(RENDER_STORE, 'readonly');
        const index = tx.objectStore(RENDER_STORE).index('createdAt');
        const req = index.openCursor(null, 'prev');
        const out = [];
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(out); } };
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || out.length >= MAX_HISTORY) return finish();
          out.push(cursor.value);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
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
          at: record.createdAt || Date.now(),
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
    async function walk(dir, prefix) {
      for await (const entry of dir.values()) {
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.kind === 'file') {
          if (ASSET_RE.test(entry.name)) {
            try { files.push({ path: rel, file: await entry.getFile() }); } catch (e) { /* skip unreadable */ }
          }
        } else if (entry.kind === 'directory') {
          await walk(entry, rel);
        }
      }
    }
    await walk(handle, '');
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
      if (!files.length) {
        clearLocalAssets();
        setStatus('err', t('assetNoFiles'));
      } else setLocalAssets(files);
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
      else clearLocalAssets();
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
      // webkitRelativePath starts with the picked folder name; strip it so the
      // game root maps to /game, exactly like the File System Access walk.
      const assets = Array.from(els.gameDirInput.files)
        .filter((f) => ASSET_RE.test(f.name))
        .map((f) => {
          const parts = (f.webkitRelativePath || f.name).split('/');
          return { path: parts.length > 1 ? parts.slice(1).join('/') : f.name, file: f };
        });
      if (!assets.length) {
        clearLocalAssets();
        setStatus('err', t('assetNoFiles'));
      } else setLocalAssets(assets);
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
    const url = els.downloadBtn.dataset.url || (currentImage && currentImage.downloadUrl);
    const name = els.downloadBtn.dataset.name || (currentImage && currentImage.name) || 'render';
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
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
        applyZoom();
        els.lightboxBody.scrollLeft = 0; els.lightboxBody.scrollTop = 0;
      } else { zoom = 1; applyZoom(); }
    };
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.lightbox.hidden) { closeLightbox(); return; }
    if (!els.lightbox.hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      navigateHistory(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !renderBusy && !batchBusy && selectedMap) {
      e.preventDefault();
      render();
    }
  });

  els.renderBtn.onclick = render;
  els.renderAllBtn.onclick = () => { void renderAll(); };
  els.zipBtn.onclick = downloadZip;
  els.cancelBtn.onclick = cancelRender;
  els.batchResumeBtn.onclick = () => { void resumeBatch(); };
  els.batchRetryBtn.onclick = () => { void retryFailedBatch(); };
  els.batchClearBtn.onclick = clearBatchQueue;
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
  els.cropEnable.addEventListener('change', syncCropInputs);
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
  applyTheme();
  applyFormatFields();
  syncCropInputs();
  populatePresets();
  updateRenderButtons();
  if (renderMode === 'server') void refreshServerHealth();
  setInterval(() => {
    if (renderMode === 'server' && !document.hidden) void refreshServerHealth();
  }, 15000);
  void restoreRenderHistory();
  void restoreBatchQueue();
  void restoreGameDir();
})();
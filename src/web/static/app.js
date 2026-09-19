// CNCMaps TS web UI logic.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    uploadBtn: $('uploadBtn'), fileInput: $('fileInput'), maplist: $('maplist'),
    format: $('format'), engine: $('engine'), sizeMode: $('sizeMode'),
    pngCompression: $('pngCompression'), pngCompressionVal: $('pngCompressionVal'),
    pngCompressionField: $('pngCompressionField'),
    markStartPos: $('markStartPos'), markOre: $('markOre'),
    renderBtn: $('renderBtn'), renderState: $('renderState'),
    progressWrap: $('progressWrap'), progressFill: $('progressFill'),
    progressPct: $('progressPct'), progressPhase: $('progressPhase'),
    previewFrame: $('previewFrame'), placeholder: $('placeholder'), previewImg: $('previewImg'),
    previewMeta: $('previewMeta'), downloadBtn: $('downloadBtn'),
    lightbox: $('lightbox'), lightboxImg: $('lightboxImg'), lightboxTitle: $('lightboxTitle'),
    lightboxClose: $('lightboxClose'), lightboxDownload: $('lightboxDownload'),
    lightboxBody: $('lightboxBody'), zoomPct: $('zoomPct'),
    engineTag: $('engineTag'), langBtn: $('langBtn'),
    statusDot: $('statusDot'), statusText: $('statusText'),
    infoMaps: $('infoMaps'), infoRender: $('infoRender'),
  };

  let selectedMap = null;
  let renderBusy = false;
  let currentImage = null;
  let renderStart = 0;
  let lastStartArgs = [];

  // ---- i18n ----
  const LANG_KEY = 'cncmaps_lang';
  const I18N = {
    zh: {
      'title': 'CNCMaps TS · 地图渲染器',
      'langBtn': '🌐 English',
      'tagline': 'Red Alert 2 / Yuri\'s Revenge · 地图渲染器',
      'srcTitle': '地图来源',
      'srcLabel': '选择地图（上传本机地图文件）',
      'uploadBtn': '📁 上传地图文件',
      'curLabel': '当前选择',
      'maplistEmpty': '请上传一个 .map / .yrm / .mpr 地图文件',
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
      'uploaded': '已上传',
      'uploadedPrefix': '已上传：',
      'uploadDone': '上传完成，已选择地图',
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
    },
    en: {
      'title': 'CNCMaps TS · Map Renderer',
      'langBtn': '🌐 中文',
      'tagline': 'Red Alert 2 / Yuri\'s Revenge · Map Renderer',
      'srcTitle': 'Map Source',
      'srcLabel': 'Choose a map (upload a local file)',
      'uploadBtn': '📁 Upload Map File',
      'curLabel': 'Current Selection',
      'maplistEmpty': 'Please upload a .map / .yrm / .mpr map file',
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
      'uploaded': 'Uploaded',
      'uploadedPrefix': 'Uploaded: ',
      'uploadDone': 'Upload complete, map selected',
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
    },
  };
  let LANG = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';
  const t = (key) => (I18N[LANG] && I18N[LANG][key] !== undefined ? I18N[LANG][key] : (I18N.zh[key] || key));

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
    if (renderStateSupportsT(els.renderState.textContent))
      els.renderState.textContent = t(renderStateSupportsT(els.renderState.textContent));
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

  function selectMap(m, item) {
    selectedMap = m;
    document.querySelectorAll('.maplist-item').forEach((x) => x.classList.remove('active'));
    if (item) item.classList.add('active');
    els.renderBtn.disabled = renderBusy ? true : false;
    els.renderState.textContent = t('selPrefix') + m.name;
    setStatus('ok', t('selMap'));
  }

  async function uploadMap(file) {
    if (!file) return;
    if (!/\.(map|yrm|mpr)$/i.test(file.name)) {
      setStatus('err', t('extErr')); return;
    }
    setStatus('work', t('uploading'));
    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await resp.json();
      if (!resp.ok || !data.token) throw new Error(data.error || t('uploadFail'));
      // clear the map list control to its uploaded-map selection
      els.maplist.innerHTML = '';
      const item = document.createElement('div');
      item.className = 'maplist-item active';
      item.innerHTML = '<span class="ic">📤</span><span class="nm"></span><span class="sz"></span>';
      item.querySelector('.nm').textContent = data.name;
      item.querySelector('.sz').textContent = t('uploaded');
      els.maplist.appendChild(item);
      selectMap({ name: data.name, size: data.size, uploadToken: data.token }, item);
      els.infoMaps.textContent = t('uploadedPrefix') + data.name;
      setStatus('ok', t('uploadDone'));
    } catch (e) {
      setStatus('err', t('uploadFail') + ': ' + (e && e.message || e));
    }
  }

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
    els.previewImg.src = url + '?t=' + Date.now();
    if (meta) els.previewMeta.textContent = meta;
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

  async function render() {
    if (renderBusy) return;
    if (!selectedMap) { setStatus('err', '请先选择地图'); return; }

    const body = {
      uploadToken: selectedMap.uploadToken,
      name: selectedMap.name,
      format: els.format.value,
      engine: els.engine.value,
      sizeMode: els.sizeMode.value,
      pngCompression: els.pngCompression.value,
      markStartPos: els.markStartPos.checked,
      markOre: els.markOre.checked,
    };

    renderBusy = true;
    els.renderBtn.disabled = true;
    renderStart = Date.now();
    setProgress(0, t('phaseSubmit'));
    els.renderState.textContent = t('renderingPrefix') + selectedMap.name;
    els.progressWrap.classList.add('show');
    setStatus('work', t('rendering'));

    try {
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
              els.downloadBtn.disabled = false;
              els.downloadBtn.dataset.url = evt.downloadUrl;
              els.downloadBtn.dataset.name = evt.name;
              const ms = Date.now() - (renderStart || Date.now());
              const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
              els.infoRender.textContent = t('recentPrefix') + (evt.name || '') + ' · ' +
                argvShort(lastStartArgs) + ' · ' + dur;
              els.renderState.textContent = t('renderDone');
              setStatus('ok', t('complete'));
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
      els.renderBtn.disabled = selectedMap ? false : true;
    }
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

  // events
  els.uploadBtn.onclick = () => els.fileInput.click();
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files && els.fileInput.files[0]) uploadMap(els.fileInput.files[0]);
    els.fileInput.value = '';
  });
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
  els.pngCompression.addEventListener('input', () => {
    els.pngCompressionVal.textContent = els.pngCompression.value;
  });
  els.format.addEventListener('change', () => {
    els.pngCompressionField.style.opacity = els.format.value === 'png' ? '1' : '.35';
  });
  els.engine.addEventListener('change', setEngineTag);

  setStatus('ok', t('statusReady'));
  applyLang();
})();
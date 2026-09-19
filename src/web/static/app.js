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
    engineTag: $('engineTag'),
    statusDot: $('statusDot'), statusText: $('statusText'),
    infoMaps: $('infoMaps'), infoRender: $('infoRender'),
  };

  let selectedMap = null;
  let renderBusy = false;
  let currentImage = null;
  let renderStart = 0;
  let lastStartArgs = [];

  function setStatus(state, text) {
    els.statusDot.className = 'dot' + (state ? ' ' + state : '');
    els.statusText.textContent = text;
  }
  function setEngineTag() {
    const v = els.engine.value;
    const names = { '': '自动检测', yr: '尤里的复仇', ra2: '红色警戒 2', ts: '泰伯利亚之日', fs: '火风暴' };
    els.engineTag.textContent = '引擎 · ' + (names[v] || '自动');
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
    els.renderState.textContent = '已选择：' + m.name;
    setStatus('ok', '已选择地图');
  }

  async function uploadMap(file) {
    if (!file) return;
    if (!/\.(map|yrm|mpr)$/i.test(file.name)) {
      setStatus('err', '仅支持 .map / .yrm / .mpr 文件'); return;
    }
    setStatus('work', '上传中…');
    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await resp.json();
      if (!resp.ok || !data.token) throw new Error(data.error || '上传失败');
      // clear the map list control to its uploaded-map selection
      els.maplist.innerHTML = '';
      const item = document.createElement('div');
      item.className = 'maplist-item active';
      item.innerHTML = '<span class="ic">📤</span><span class="nm"></span><span class="sz">已上传</span>';
      item.querySelector('.nm').textContent = data.name;
      els.maplist.appendChild(item);
      selectMap({ name: data.name, size: data.size, uploadToken: data.token }, item);
      els.infoMaps.textContent = '已上传：' + data.name;
      setStatus('ok', '上传完成，已选择地图');
    } catch (e) {
      setStatus('err', '上传失败：' + (e && e.message || e));
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
    els.lightboxTitle.textContent = name || '图片预览';
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
    setProgress(0, '提交任务…');
    els.renderState.textContent = '渲染中：' + selectedMap.name;
    els.progressWrap.classList.add('show');
    setStatus('work', '渲染中…');

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
            els.engineTag.textContent = '引擎 · ' + argvShort(evt.args);
            lastStartArgs = evt.args;
          } else if (evt.type === 'progress') {
            lastProgress = evt.percent;
            setProgress(evt.percent, phaseLabel(evt.phase));
          } else if (evt.type === 'log') {
            if (evt.level === 'fatal') setStatus('err', '渲染错误');
          } else if (evt.type === 'done') {
            if (evt.ok) {
              setProgress(100, '完成');
              currentImage = { url: evt.url, name: evt.name, downloadUrl: evt.downloadUrl };
              showPreview(evt.url, evt.name);
              els.downloadBtn.disabled = false;
              els.downloadBtn.dataset.url = evt.downloadUrl;
              els.downloadBtn.dataset.name = evt.name;
              const ms = Date.now() - (renderStart || Date.now());
              const dur = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
              els.infoRender.textContent = '最近: ' + (evt.name || '') + ' · ' +
                argvShort(lastStartArgs) + ' · ' + dur;
              els.renderState.textContent = '渲染完成';
              setStatus('ok', '完成');
            } else {
              setProgress(lastProgress, '失败 (code ' + evt.code + ')');
              els.renderState.textContent = '渲染失败';
              setStatus('err', '渲染失败');
            }
          } else if (evt.type === 'error') {
            els.renderState.textContent = '错误：' + (evt.message || '未知');
            setStatus('err', '错误');
          }
        }
      }
    } catch (e) {
      els.renderState.textContent = '请求失败';
      setStatus('err', '请求失败：' + (e && e.message || e));
    } finally {
      renderBusy = false;
      els.renderBtn.disabled = selectedMap ? false : true;
    }
  }

  function argvShort(args) {
    const forced = args.find((a) => a.startsWith('--force-'));
    if (forced) {
      const map = { ra2: '红色警戒 2', yr: '尤里的复仇', ts: '泰伯利亚之日', fs: '火风暴' };
      const k = forced.replace('--force-', '');
      return map[k] || k;
    }
    return '自动检测';
  }

  function phaseLabel(p) {
    const map = {
      parsing: '解析地图 / 规则…', tiles: '绘制地形…', objects: '绘制建筑与单位…',
      encoding: '编码输出…', drawing: '绘制中…',
    };
    return map[p] || p;
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

  setStatus('ok', '就绪');
  setEngineTag();
})();
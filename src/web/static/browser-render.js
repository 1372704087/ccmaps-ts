// Browser-side renderer client: owns the Web Worker that runs the map renderer
// locally, so map and game files never leave the user's machine.
(function () {
  'use strict';

  // Guard rail for in-browser rendering (BGR surface + depth buffer + RGBA copy).
  // The auto tier follows navigator.deviceMemory, which Chromium buckets to 8 GB max.
  const MP = 1024 * 1024;
  const MIN_PIXELS = 64 * MP;
  const MAX_PIXELS = 128 * MP;
  // OffscreenCanvas cannot encode anything wider or taller than this.
  const MAX_SIDE = 16384;

  const WORKER_URL = new URL('webworker/cncmaps-worker.js', document.baseURI);

  function deviceMemoryGb() {
    const gb = Number(navigator.deviceMemory);
    return Number.isFinite(gb) && gb > 0 ? gb : 0;
  }

  function autoPixels() {
    const gb = deviceMemoryGb();
    if (gb >= 8) return MAX_PIXELS;
    if (gb >= 4) return 96 * MP;
    return MIN_PIXELS;
  }

  /** Maps the UI choice ('auto', '64', '96', '128') to a pixel budget. */
  function resolvePixels(limit) {
    switch (String(limit)) {
      case '64': return 64 * MP;
      case '96': return 96 * MP;
      case '128': return 128 * MP;
      default: return autoPixels();
    }
  }

  function supported() {
    return typeof Worker === 'function'
      && typeof OffscreenCanvas === 'function'
      && typeof Blob === 'function';
  }

  class BrowserRenderer {
    constructor() {
      this.seq = 0;
      this.onLog = null;
      this.pending = new Map();
      this.assetWaiter = null;
      this.readyWaiter = null;
      this.caps = null;
      this.worker = new Worker(WORKER_URL);
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.failAll(new Error(e.message || 'Worker crashed'));
    }

    onMessage(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        this.caps = msg;
        if (this.readyWaiter) {
          clearTimeout(this.readyWaiter.timer);
          this.readyWaiter.resolve(msg);
          this.readyWaiter = null;
        }
        return;
      }
      if (msg.type === 'assets-ok') {
        if (this.assetWaiter) {
          clearTimeout(this.assetWaiter.timer);
          this.assetWaiter.resolve(msg.count);
          this.assetWaiter = null;
        }
        return;
      }
      if (msg.type === 'progress') {
        const p = this.pending.get(msg.id);
        if (p && p.onProgress) p.onProgress(msg.percent, msg.phase);
        return;
      }
      if (msg.type === 'log') {
        if (this.onLog) {
          try { this.onLog(msg.level, msg.message); } catch (e) { /* ignore */ }
        } else if (msg.level >= 4) console.warn('[cncmaps worker]', msg.message);
        return;
      }
      if (msg.type === 'result' || msg.type === 'error') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === 'result') p.resolve(msg);
        else p.reject(Object.assign(new Error(msg.message || 'Render failed'), { code: msg.code }));
      }
    }

    failAll(err) {
      if (this.readyWaiter) { clearTimeout(this.readyWaiter.timer); this.readyWaiter.reject(err); this.readyWaiter = null; }
      this.readyPromise = null;
      if (this.assetWaiter) { clearTimeout(this.assetWaiter.timer); this.assetWaiter.reject(err); this.assetWaiter = null; }
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    }

    start() {
      if (this.caps) return Promise.resolve(this.caps);
      if (this.readyPromise) return this.readyPromise;
      this.readyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.readyWaiter = null;
          this.readyPromise = null;
          reject(new Error('Worker startup timed out'));
        }, 8000);
        this.readyWaiter = { resolve, reject, timer };
      });
      return this.readyPromise;
    }

    setAssets(files) {
      return new Promise((resolve, reject) => {
        const list = Array.from(files || []).map((f) =>
          f && f.file ? { path: f.path || f.file.name, file: f.file } : { path: f.name, file: f });
        const timer = setTimeout(() => {
          this.assetWaiter = null;
          reject(new Error('Assets mount timed out'));
        }, 30000);
        this.assetWaiter = { resolve, reject, timer };
        this.worker.postMessage({ type: 'assets', files: list });
      });
    }

    render(mapFile, mapName, options, onProgress) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onProgress });
        this.worker.postMessage({
          type: 'render',
          id,
          mapName,
          mapFile,
          options: Object.assign({ maxPixels: MAX_PIXELS }, options || {}),
        });
      });
    }

    terminate() {
      try { this.worker.terminate(); } catch (e) { /* ignore */ }
      this.failAll(new Error('Renderer terminated'));
      this.caps = null;
      this.readyPromise = null;
      this.readyWaiter = null;
      this.worker = null;
    }
  }

  window.CncmapsBrowserRender = {
    supported,
    create: () => new BrowserRenderer(),
    MIN_PIXELS,
    MAX_PIXELS,
    MAX_SIDE,
    deviceMemoryGb,
    autoPixels,
    resolvePixels,
  };
})();

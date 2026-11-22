// Browser-side renderer client: owns the Web Worker that runs the map renderer
// locally, so map and game files never leave the user's machine.
(function () {
  'use strict';

  // Guard rail for in-browser rendering (surface + RGBA copy). 0 would disable,
  // but huge maps would crash the tab; tell the user to use server rendering.
  const MAX_PIXELS = 64 * 1024 * 1024;

  const WORKER_URL = new URL('webworker/cncmaps-worker.js', document.baseURI);

  function supported() {
    return typeof Worker === 'function'
      && typeof OffscreenCanvas === 'function'
      && typeof Blob === 'function';
  }

  class BrowserRenderer {
    constructor() {
      this.seq = 0;
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
        if (msg.level >= 4) console.warn('[cncmaps worker]', msg.message);
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
        const list = Array.from(files || []).map((f) => ({ path: f.name, file: f }));
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

  window.CncmapsBrowserRender = { supported, create: () => new BrowserRenderer(), MAX_PIXELS };
})();

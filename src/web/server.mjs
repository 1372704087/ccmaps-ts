// cncmaps-ts local web UI backend.
// Minimal Node http server (no external deps). Serves the static frontend,
// accepts uploaded maps, and runs the renderer CLI as a child process,
// streaming progress back as a NDJSON stream and the result image URL.
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATIC_DIR = path.join(ROOT, 'src', 'web', 'static');
// Scratch dir for the renderer's PNG/JPEG while it is being produced. It is a
// transient temp location, NOT the project/local directory, and the final bytes
// are served from an in-memory cache and the file removed right after.
const SCRATCH_DIR = process.env.CNCMAPS_WEB_SCRATCH || path.join(os.tmpdir(), 'cncmaps-render');
const UPLOAD_DIR = process.env.CNCMAPS_WEB_UPLOAD || path.join(os.tmpdir(), 'cncmaps-uploads');
// Server-side game data directories (deployed copies). When set, uploaded-map
// renders use them as --mixdir so clients never need to supply their own path.
// CNCMAPS_GAME_DIRS accepts several dirs separated by ';' (e.g. one per engine:
// RA2/YR install; TS/FS install). CNCMAPS_GAME_DIR is kept as a single-dir alias.
const GAME_DIRS = (process.env.CNCMAPS_GAME_DIRS || '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s !== '');
if (GAME_DIRS.length === 0 && process.env.CNCMAPS_GAME_DIR) GAME_DIRS.push(process.env.CNCMAPS_GAME_DIR);
const CLI_JS = path.join(ROOT, 'dist', 'cli.js');
const PORT = clampInt(process.env.CNCMAPS_WEB_PORT, 1, 65535, 5173);
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
// JSON control bodies are tiny; without a cap any local page can make the server
// buffer an arbitrary body in memory.
const MAX_BODY_BYTES = 256 * 1024;
// Refuse renders whose full canvas would not fit. Downscaled (banded) previews
// only allocate one strip, so this applies only when no preview width is set.
const MAX_SURFACE_PIXELS = clampInt(process.env.CNCMAPS_MAX_SURFACE_PIXELS, 0, Number.MAX_SAFE_INTEGER, 200_000_000);
const MAX_RENDER_JOBS = clampInt(process.env.CNCMAPS_MAX_RENDER_JOBS, 1, 16, 2);
const RENDER_TIMEOUT_MS = clampInt(process.env.CNCMAPS_RENDER_TIMEOUT_MS, 60_000, 6 * 60 * 60 * 1000, 30 * 60 * 1000);
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const UPLOAD_MAX_FILES = 200;
const UPLOAD_MAX_TOTAL_BYTES = clampInt(process.env.CNCMAPS_MAX_UPLOAD_BYTES, 64 * 1024 * 1024, 16 * 1024 * 1024 * 1024, 1024 * 1024 * 1024);
const IMAGE_TTL_MS = 30 * 60 * 1000;
const IMAGE_MAX = 16;
const IMAGE_MAX_BYTES = clampInt(process.env.CNCMAPS_IMAGE_CACHE_BYTES, 16 * 1024 * 1024, 4 * 1024 * 1024 * 1024, 256 * 1024 * 1024);
const RENDER_QUEUE_MAX = clampInt(process.env.CNCMAPS_RENDER_QUEUE_MAX, 1, 1024, 64);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

// Uploaded maps: token -> { file, name, at }
const mapTokens = new Map();
function mapTokenPut(token, data) { mapTokens.set(token, data); }
function mapTokenGet(token) {
  const e = mapTokens.get(token);
  if (!e) return null;
  if (Date.now() - e.at > UPLOAD_TTL_MS) {
    mapTokens.delete(token);
    try { fs.unlinkSync(e.file); } catch { /* ignore */ }
    return null;
  }
  return e;
}

function removeUploadFile(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

/** A file evicted by the count/TTL sweep must not leave a token pointing at it. */
function dropTokensForFile(file) {
  for (const [token, e] of mapTokens) if (e.file === file) mapTokens.delete(token);
}

/** Delete expired uploads and files left behind by earlier runs. The old server only
 * removed a file when its token was looked up, so an upload that was never rendered
 * stayed on disk forever (and across restarts). */
function activeUploadFiles() {
  const inUse = new Set();
  for (const job of renderQueue) if (job.uploadFile) inUse.add(job.uploadFile);
  for (const job of renderJobs.values()) if (job.uploadFile) inUse.add(job.uploadFile);
  return inUse;
}

function sweepUploads() {
  const now = Date.now();
  const inUse = activeUploadFiles();
  for (const [token, e] of mapTokens) {
    if (now - e.at > UPLOAD_TTL_MS && !inUse.has(e.file)) {
      mapTokens.delete(token);
      removeUploadFile(e.file);
    }
  }
  let files = [];
  try {
    files = fs.readdirSync(UPLOAD_DIR)
      .filter((f) => /\.(map|yrm|mpr)$/i.test(f))
      .map((f) => {
        const full = path.join(UPLOAD_DIR, f);
        let mtime = now;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { full, mtime };
      });
  } catch { /* ignore unreadable dir */ }
  const stale = new Set(files.filter((f) => now - f.mtime > UPLOAD_TTL_MS && !inUse.has(f.full)));
  for (const f of stale) {
    removeUploadFile(f.full);
    dropTokensForFile(f.full);
  }
  files = files.filter((f) => !stale.has(f)).sort((a, b) => a.mtime - b.mtime);
  while (files.length > UPLOAD_MAX_FILES) {
    let old = files.shift();
    if (inUse.has(old.full)) {
      // Protect a file an in-flight render still reads; retry from the next oldest.
      files.push(old);
      const next = files.find((f) => !inUse.has(f.full));
      if (!next) break;
      old = next;
      files.splice(files.indexOf(next), 1);
    }
    removeUploadFile(old.full);
    dropTokensForFile(old.full);
  }
}

/** Remove per-job scratch directories left behind by a killed server. A live
 * server deletes its own job dir on completion/cancel; only stale dirs are removed
 * so two servers sharing the default temp root do not delete each other's jobs. */
function sweepScratch() {
  const now = Date.now();
  const inUse = new Set();
  for (const job of renderQueue) if (job.jobDir) inUse.add(job.jobDir);
  for (const job of renderJobs.values()) if (job.jobDir) inUse.add(job.jobDir);
  let entries = [];
  try { entries = fs.readdirSync(SCRATCH_DIR, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(SCRATCH_DIR, entry.name);
    if (inUse.has(full)) continue;
    try {
      if (now - fs.statSync(full).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function uploadDirBytes() {
  let total = 0;
  try {
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      try { total += fs.statSync(path.join(UPLOAD_DIR, name)).size; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return total;
}

// In-memory rendered images: token -> { buffer, name, mime, at }
const imageCache = new Map();
let imageCacheBytes = 0;
function cacheDelete(token) {
  const old = imageCache.get(token);
  if (old) {
    imageCacheBytes -= old.buffer.length;
    imageCache.delete(token);
  }
}
function cachePut(token, data) {
  cacheDelete(token);
  imageCache.set(token, data);
  imageCacheBytes += data.buffer.length;
  while (imageCache.size > IMAGE_MAX) {
    const oldest = imageCache.keys().next().value;
    cacheDelete(oldest);
  }
  // Keep one oversized image so a legitimate large render can still be
  // downloaded; normal entries are evicted oldest-first.
  while (imageCacheBytes > IMAGE_MAX_BYTES && imageCache.size > 1) {
    const oldest = imageCache.keys().next().value;
    cacheDelete(oldest);
  }
}
function cacheGet(token) {
  const e = imageCache.get(token);
  if (!e) return null;
  if (Date.now() - e.at > IMAGE_TTL_MS) { cacheDelete(token); return null; }
  return e;
}
function sweepImageCache() {
  const now = Date.now();
  for (const token of imageCache.keys()) {
    const e = imageCache.get(token);
    if (e && now - e.at > IMAGE_TTL_MS) cacheDelete(token);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.psd': 'image/vnd.adobe.photoshop',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAP_EXTS = ['.map', '.yrm', '.mpr'];

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  try {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch { /* client already gone */ }
}

/** RFC 5987 Content-Disposition. Node throws on non-Latin-1 header values, so a
 * Chinese map name used to make /download/<token> return 500. */
function contentDisposition(name, mime) {
  const ext = mime === 'image/jpeg' ? '.jpg' : (mime === 'image/vnd.adobe.photoshop' ? '.psd' : '.png');
  const base = name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  const fallback = (base || 'map').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') + ext;
  const encoded = encodeURIComponent(base || 'map')
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + ext;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let done = false;
    const fail = (statusCode, message) => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.resume(); // discard the rest without buffering it
      reject(httpError(statusCode, message));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) return fail(413, 'Request body too large');
      data += c;
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        // Strip a UTF-8 BOM if present so JSON.parse doesn't choke on it.
        const raw = data.replace(/^\uFEFF/, '');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(httpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', (e) => {
      if (!done) { done = true; reject(e); }
    });
  });
}

function readRawBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.resume();
      reject(httpError(413, 'File too large'));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) return fail();
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (!done) { done = true; reject(e); }
    });
  });
}

function safeDisplayName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/')) || 'map.map';
  return base;
}

function buildArgs(p) {
  if (!p.uploadToken) throw httpError(400, 'Missing map file');
  const m = mapTokenGet(p.uploadToken);
  if (!m) throw httpError(410, 'Uploaded map expired or not found; upload it again');
  const infile = m.file;
  const displayName = safeDisplayName(m.name);

  const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const jobDir = path.join(SCRATCH_DIR, token);
  fs.mkdirSync(jobDir, { recursive: true });

  const args = [CLI_JS, '--infile=' + infile, '--outdir=' + jobDir];
  // A stable output stem inside a per-job directory: two concurrent renders of
  // the same upload token used to write and delete each other's <token>.png.
  args.push('--outfile=render');

  // mixdir(s): server-side game copies only. Client game folders are never
  // uploaded in server mode; browser-local rendering handles those.
  for (const d of GAME_DIRS) args.push('--mixdir=' + d);
  if (MAX_SURFACE_PIXELS > 0) args.push('--max-surface-pixels=' + MAX_SURFACE_PIXELS);

  const fmt = p.format === 'psd' ? 'psd' : (p.format === 'jpg' ? 'jpg' : 'png');
  args.push(fmt === 'jpg' ? '--output-jpg' : (fmt === 'psd' ? '--output-psd' : '--output-png'));
  // PSD cannot be shown in a browser; the CLI writes a flattened PNG next to it.
  if (fmt === 'psd') args.push('--psd-preview');
  const pngLevel = clampInt(p.pngCompression, 1, 9, 4);
  const jpegQuality = clampInt(p.jpegQuality, 1, 100, 92);
  if (fmt === 'png') args.push('--png-compression=' + pngLevel);
  else if (fmt === 'jpg') args.push('--jpeg-quality=' + jpegQuality);

  switch (p.sizeMode) {
    case 'local': args.push('--force-localsize'); break;
    case 'full': args.push('--force-fullmap'); break;
    default: break; // auto
  }
  const previewWidth = clampInt(p.previewWidth, 0, 8192, 0);
  if (previewWidth > 0) args.push('--preview-width=' + previewWidth);
  if (p.crop && typeof p.crop === 'object') {
    const x = clampInt(p.crop.x, 0, 100, 0);
    const y = clampInt(p.crop.y, 0, 100, 0);
    const w = clampInt(p.crop.width, 1, 100, 100);
    const h = clampInt(p.crop.height, 1, 100, 100);
    args.push('--crop=' + [x, y, w, h].join(','));
  }
  if (['1:1', '4:5', '16:9', '9:16'].includes(p.aspect)) args.push('--aspect=' + p.aspect);
  switch (p.engine) {
    case 'ra2': args.push('--force-ra2'); break;
    case 'yr': args.push('--force-yr'); break;
    case 'ts': args.push('--force-ts'); break;
    case 'fs': args.push('--force-fs'); break;
    default: break; // auto
  }
  if (p.markStartPos === true) {
    const shapeFlags = {
      squared: '--start-pos-squared', circled: '--start-pos-circled',
      diamond: '--start-pos-diamond', ellipsed: '--start-pos-ellipsed',
      star: '--start-pos-star', tiled: '--start-pos-tiled',
    };
    const shape = String(p.markerShape || 'squared');
    args.push(Object.prototype.hasOwnProperty.call(shapeFlags, shape) ? shapeFlags[shape] : '--start-pos-squared');
    args.push('--mark-start-pos');
    const markerSize = clampInt(p.markerSize, 2, 6, 4);
    args.push('--start-pos-size=' + markerSize);
  }
  if (p.markOre === true) args.push('--mark-ore');
  if (p.tunnelPaths === true) args.push('--tunnels');
  if (p.tunnelPosition === true) args.push('--tunnelpos');
  if (p.markIceGrowth === true) args.push('--icegrowth');
  if (p.compressTiles === true) args.push('--cmprs-tiles');
  if (p.fixOverlays === true) args.push('--fix-overlays');
  if (p.fixupTiles === true) args.push('--fixup-tiles');
  if (p.noExpandMixes === true) args.push('--no-expand-mixes');
  if (p.ignoreLighting === true) args.push('--ignore-lighting');
  args.push('--progress'); // emit progress:N:phase lines for the UI
  const metaFile = path.join(jobDir, 'meta.json');
  args.push('--meta-json=' + metaFile);

  const ext = fmt === 'jpg' ? '.jpg' : (fmt === 'psd' ? '.psd' : '.png');
  const outFile = path.join(jobDir, 'render' + ext);
  const friendlyBase = displayName.replace(/\.(map|yrm|mpr)$/i, '') || 'map';
  const mime = fmt === 'jpg' ? 'image/jpeg' : (fmt === 'psd' ? 'image/vnd.adobe.photoshop' : 'image/png');
  return {
    args,
    jobDir,
    fmt,
    outFile,
    metaFile,
    uploadFile: infile,
    token,
    engine: p.engine || 'auto',
    name: friendlyBase + ext,
    mime,
    url: '/image/' + token,
    downloadUrl: '/download/' + token,
  };
}

let activeRenderJobs = 0;
const renderQueue = [];
const renderJobs = new Map();

function sendQueuePositions() {
  for (let i = 0; i < renderQueue.length; i++) {
    const queued = renderQueue[i];
    if (!queued.finished && !queued.clientGone) queued.wnd({ type: 'queued', position: i + 1 });
  }
}

function pumpRenderQueue() {
  while (activeRenderJobs < MAX_RENDER_JOBS && renderQueue.length) {
    const next = renderQueue.shift();
    if (next.finished || next.cancelled) continue;
    activeRenderJobs++;
    next.started = true;
    try {
      next.onStart();
    } catch (e) {
      finishRenderJob(next, { type: 'error', message: String(e && e.message || e) });
    }
  }
  sendQueuePositions();
}

function cleanupJobDir(job) {
  if (!job.jobDir) return;
  try { fs.rmSync(job.jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function finishRenderJob(job, event) {
  if (job.finished) return;
  job.finished = true;
  if (job.started) activeRenderJobs = Math.max(0, activeRenderJobs - 1);
  const idx = renderQueue.indexOf(job);
  if (idx !== -1) renderQueue.splice(idx, 1);
  renderJobs.delete(job.id);
  if (job.child == null) cleanupJobDir(job);
  if (!job.clientGone) {
    try {
      if (event) job.wnd(event);
      job.res.end();
    } catch { /* client already gone */ }
  }
  pumpRenderQueue();
}

function cancelRenderJob(job) {
  if (!job || job.finished) return;
  job.cancelled = true;
  if (job.child) {
    try { job.child.kill(); } catch { /* ignore */ }
  } else {
    finishRenderJob(job, { type: 'done', ok: false, cancelled: true });
  }
}

function streamRender(req, res, params) {
  if (!params.uploadToken) {
    return sendJson(res, 400, { error: 'Missing map uploadToken' });
  }
  if (!fs.existsSync(CLI_JS)) {
    return sendJson(res, 503, { error: 'Engine is not built. Run `npm run build:all` before starting the web UI.' });
  }
  // Bound the pending queue as well as the active jobs. Without this a client
  // can hold arbitrarily many jobs (and uploaded map files) in memory.
  if (renderQueue.length >= RENDER_QUEUE_MAX) {
    return sendJson(res, 429, { error: `Render queue is full (${RENDER_QUEUE_MAX}); retry shortly` });
  }
  let job;
  try {
    job = buildArgs(params);
  } catch (e) {
    return sendJson(res, e.statusCode || 400, { error: String(e && e.message || e) });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });

  const record = {
    id: job.token,
    jobDir: job.jobDir,
    uploadFile: job.uploadFile,
    res,
    started: false,
    finished: false,
    cancelled: false,
    clientGone: false,
    child: null,
    onStart: start,
    wnd(obj) {
      if (this.clientGone || res.writableEnded) return;
      try { res.write(JSON.stringify(obj) + '\n'); } catch { /* ignore */ }
    },
  };
  renderJobs.set(record.id, record);
  record.wnd({ type: 'job', id: record.id });

  // 'close' on IncomingMessage fires when the request is complete, not when the
  // client disconnects (verified on Node 22). The response close event is the
  // one that means "tab closed / network dropped"; the old listener left the
  // child rendering and a job slot occupied after a tab was closed.
  res.on('close', () => {
    if (record.finished || res.writableEnded) return;
    record.clientGone = true;
    cancelRenderJob(record);
  });

  renderQueue.push(record);
  sendQueuePositions();
  pumpRenderQueue();

  function start() {
    if (record.cancelled) {
      finishRenderJob(record, { type: 'done', ok: false, cancelled: true });
      return;
    }
    record.wnd({ type: 'start', url: job.url, name: job.name, engine: job.engine });
    let child;
    try {
      child = spawn(process.execPath, job.args, { cwd: ROOT });
    } catch (e) {
      finishRenderJob(record, { type: 'error', message: String(e && e.message || e) });
      return;
    }
    record.child = child;
    let outBuf = '';
    const timeout = setTimeout(() => {
      record.timedOut = true;
      record.wnd({ type: 'log', level: 'fatal', message: `Render timed out after ${RENDER_TIMEOUT_MS / 1000}s` });
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, RENDER_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on('data', (d) => {
      outBuf += d.toString('utf8');
      let nl;
      while ((nl = outBuf.indexOf('\n')) !== -1) {
        const line = outBuf.slice(0, nl).trim();
        outBuf = outBuf.slice(nl + 1);
        const m = /^progress:(\d+):(.+)$/.exec(line);
        if (m) record.wnd({ type: 'progress', percent: Number(m[1]), phase: m[2] });
        else if (/^.*\[INFO\] Saved /.test(line)) record.wnd({ type: 'saved' });
        else if (/\[FATAL\]/.test(line)) record.wnd({ type: 'log', level: 'fatal', message: line.replace(/^\d+\s*/, '') });
      }
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      if (/\[FATAL\]/.test(s)) record.wnd({ type: 'log', level: 'fatal', message: s.trim() });
    });

    child.on('error', (e) => {
      clearTimeout(timeout);
      record.child = null;
      finishRenderJob(record, { type: 'error', message: String(e.message || e) });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      record.child = null;
      void finishChild(code);
    });

    async function finishChild(code) {
      if (record.cancelled) {
        cleanupJobDir(record);
        finishRenderJob(record, { type: 'done', ok: false, cancelled: true });
        return;
      }
      const ok = code === 0 && fs.existsSync(job.outFile);
      if (ok) {
        try {
          const buffer = await fs.promises.readFile(job.outFile);
          let meta = null;
          try {
            if (job.metaFile && fs.existsSync(job.metaFile)) {
              meta = JSON.parse(await fs.promises.readFile(job.metaFile, 'utf8'));
            }
          } catch { /* metadata is optional */ }
          cachePut(job.token, { buffer, name: job.name, mime: job.mime, at: Date.now() });
          let previewUrl = null;
          if (job.fmt === 'psd') {
            const previewFile = job.outFile.replace(/\.psd$/i, '') + '.preview.png';
            try {
              if (fs.existsSync(previewFile)) {
                const previewBuffer = await fs.promises.readFile(previewFile);
                const previewToken = job.token + 'p';
                const previewName = job.name.replace(/\.psd$/i, '') + '.png';
                cachePut(previewToken, { buffer: previewBuffer, name: previewName, mime: 'image/png', at: Date.now() });
                previewUrl = '/image/' + previewToken;
              }
            } catch { /* the preview is optional; the PSD download still works */ }
          }
          cleanupJobDir(record);
          finishRenderJob(record, {
            type: 'done', ok: true, url: job.url, downloadUrl: job.downloadUrl, name: job.name,
            previewUrl: previewUrl || undefined, meta,
          });
        } catch (e) {
          cleanupJobDir(record);
          finishRenderJob(record, { type: 'error', message: String(e && e.message || e) });
        }
      } else {
        cleanupJobDir(record);
        finishRenderJob(record, {
          type: 'done', ok: false, code, timedOut: Boolean(record.timedOut),
          message: record.timedOut ? `Render timed out after ${RENDER_TIMEOUT_MS / 1000} seconds` : '',
        });
      }
    }
  }
}

function hostNameOf(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/^\[([^\]]+)\](?::\d+)?$/, '$1')
    .replace(/:\d+$/, '');
}

/** Blocks DNS-rebinding and cross-site POSTs to the local server. Requests without
 * an Origin (curl, same-origin GET) are allowed as long as the Host is loopback. */
function isTrustedRequest(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostNameOf(host))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      return u.host.toLowerCase() === host && ['127.0.0.1', 'localhost', '::1'].includes(hostNameOf(u.hostname));
    } catch {
      return false;
    }
  }
  return true;
}

function serveStatic(req, res, urlPath) {
  let safe;
  try {
    safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('\0')) throw new Error('NUL in path');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad path');
  }
  let file = path.join(STATIC_DIR, safe);
  if (!file.startsWith(STATIC_DIR + path.sep) && file !== STATIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request URL');
  }
  try {
    if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Forbidden origin' });

    if (req.method === 'GET' && url.pathname === '/api/health') {
      let validDirs = 0;
      let mixFiles = 0;
      for (const dir of GAME_DIRS) {
        try {
          const mixes = fs.readdirSync(dir).filter((f) => /\.(mix|mmx|yro)$/i.test(f)).length;
          if (mixes > 0) {
            validDirs++;
            mixFiles += mixes;
          }
        } catch { /* ignore unreadable dirs */ }
      }
      return sendJson(res, 200, {
        ok: true,
        gameDirs: GAME_DIRS.length,
        gameDirsValid: validDirs,
        mixFiles,
        maxRenderJobs: MAX_RENDER_JOBS,
        maxSurfacePixels: MAX_SURFACE_PIXELS,
        maxQueuedRenders: RENDER_QUEUE_MAX,
        uploadBytes: uploadDirBytes(),
        maxUploadBytes: UPLOAD_MAX_TOTAL_BYTES,
        imageCacheBytes,
        maxImageCacheBytes: IMAGE_MAX_BYTES,
        activeRenderJobs,
        queuedRenders: renderQueue.length,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      let fn = 'map.map';
      const header = req.headers['x-filename'];
      if (header) {
        try { fn = safeDisplayName(decodeURIComponent(header)); }
        catch { return sendJson(res, 400, { error: 'Invalid X-Filename header' }); }
      }
      const ext = path.extname(fn).toLowerCase();
      if (!MAP_EXTS.includes(ext)) return sendJson(res, 400, { error: '仅支持 .map / .yrm / .mpr 文件' });
      const buf = await readRawBody(req);
      if (!buf.length) return sendJson(res, 400, { error: '空文件' });
      sweepUploads();
      if (uploadDirBytes() + buf.length > UPLOAD_MAX_TOTAL_BYTES) {
        return sendJson(res, 413, { error: 'Upload storage limit reached; wait for old uploads to expire or clear them' });
      }
      const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const file = path.join(UPLOAD_DIR, token + ext);
      fs.writeFileSync(file, buf);
      const uploadedAt = Date.now();
      mapTokenPut(token, { file, name: fn, at: uploadedAt });
      sweepUploads();
      return sendJson(res, 200, {
        token,
        name: fn,
        size: buf.length,
        uploadedAt,
        expiresAt: uploadedAt + UPLOAD_TTL_MS,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/render') {
      const body = await readBody(req);
      return streamRender(req, res, body);
    }
    if (req.method === 'POST' && url.pathname === '/api/render/cancel') {
      const body = await readBody(req);
      const job = renderJobs.get(String(body.id || ''));
      if (job) cancelRenderJob(job);
      return sendJson(res, 200, { ok: !!job });
    }
    if (req.method === 'GET' && (url.pathname.startsWith('/image/') || url.pathname.startsWith('/download/'))) {
      let token;
      try { token = decodeURIComponent(url.pathname.split('/').pop() || ''); }
      catch { return sendJson(res, 400, { error: 'Invalid image token' }); }
      const e = cacheGet(token);
      if (!e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Image expired or not found'); }
      const headers = {
        'Content-Type': e.mime,
        'Content-Length': e.buffer.length,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      };
      if (url.pathname.startsWith('/download/')) {
        headers['Content-Disposition'] = contentDisposition(e.name, e.mime);
      }
      res.writeHead(200, headers);
      return res.end(e.buffer);
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    const code = e && e.statusCode ? e.statusCode : 500;
    if (!res.headersSent) sendJson(res, code, { error: String(e && e.message || e) });
    else try { res.end(); } catch { /* client gone */ }
  }
});

// Large .mix uploads can take a while on slow links.
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;

sweepUploads();
sweepScratch();
setInterval(() => { sweepUploads(); sweepImageCache(); sweepScratch(); }, 10 * 60 * 1000).unref();

function shutdown(signal) {
  for (const job of [...renderQueue, ...renderJobs.values()]) {
    if (job.child) try { job.child.kill('SIGKILL'); } catch { /* ignore */ }
    cleanupJobDir(job);
  }
  console.log(`\n  ${signal}: stopping web UI`);
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (e) => {
  console.error(`Failed to start web UI: ${e.message}`);
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `\n  CNCMaps TS Web UI running at http://127.0.0.1:${PORT}\n` +
    `  Scratch dir: ${SCRATCH_DIR}\n` +
    `  Upload dir: ${UPLOAD_DIR} (max ${UPLOAD_MAX_FILES} files, ${UPLOAD_TTL_MS / 60000} min TTL, ${UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024} MB total)\n` +
    `  Max render surface: ${MAX_SURFACE_PIXELS} pixels; queue max ${RENDER_QUEUE_MAX}\n` +
    `  Render timeout: ${RENDER_TIMEOUT_MS / 60000} min\n` +
    `  Images are served from memory (not persisted; cache ${IMAGE_MAX} items / ${IMAGE_MAX_BYTES / 1024 / 1024} MB).\n`,
  );
});

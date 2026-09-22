// cncmaps-ts local web UI backend.
// Minimal Node http server (no external deps). Serves the static frontend,
// lists maps in a game dir, and runs the renderer CLI as a child process,
// streaming progress back as a NDJSON/SSE stream and the result image URL.
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
const PORT = Number(process.env.CNCMAPS_WEB_PORT || 5173);
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Uploaded maps: token -> { file, name, at }
const mapTokens = new Map();
const UPLOAD_TTL_MS = 60 * 60 * 1000;
function mapTokenPut(token, data) { mapTokens.set(token, data); }
function mapTokenGet(token) {
  const e = mapTokens.get(token);
  if (!e) return null;
  if (Date.now() - e.at > UPLOAD_TTL_MS) { mapTokens.delete(token); try { fs.unlinkSync(e.file); } catch { /* ignore */ } return null; }
  return e;
}

// In-memory rendered images: token -> { buffer, name, mime, at }
const imageCache = new Map();
const IMAGE_TTL_MS = 30 * 60 * 1000;
const IMAGE_MAX = 16;
function cachePut(token, data) {
  imageCache.delete(token);
  imageCache.set(token, data);
  while (imageCache.size > IMAGE_MAX) {
    const oldest = imageCache.keys().next().value;
    imageCache.delete(oldest);
  }
}
function cacheGet(token) {
  const e = imageCache.get(token);
  if (!e) return null;
  if (Date.now() - e.at > IMAGE_TTL_MS) { imageCache.delete(token); return null; }
  return e;
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
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAP_EXTS = ['.map', '.yrm', '.mpr'];

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        // Strip a UTF-8 BOM if present so JSON.parse doesn't choke on it.
        const raw = data.replace(/^\uFEFF/, '');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('File too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildArgs(p) {
  const args = [CLI_JS];

  // Resolve the input map: an uploaded map (by token) or a server-local path.
  let infile = p.infile || '';
  let displayName = p.name || (infile ? path.basename(infile) : '');
  if (p.uploadToken) {
    const m = mapTokenGet(p.uploadToken);
    if (!m) throw new Error('Uploaded map expired or not found');
    infile = m.file;
    displayName = m.name;
  }
  if (!infile) throw new Error('Missing map file');

  args.push('--infile=' + infile);

  // mixdir(s): prefer the server-side game copies (one --mixdir per dir);
  // otherwise accept a client-supplied dir.
  const dirs = GAME_DIRS.length > 0 ? GAME_DIRS : [p.mixdir || ''].filter((s) => s);
  for (const d of dirs) args.push('--mixdir=' + d);

  const outdir = SCRATCH_DIR;
  fs.mkdirSync(outdir, { recursive: true });
  args.push('--outdir=' + outdir);

  const fmt = p.format === 'jpg' ? 'jpg' : 'png';
  args.push('--output-' + fmt);
  if (fmt === 'png' && p.pngCompression) args.push('--png-compression=' + p.pngCompression);
  if (fmt === 'jpg' && p.jpegQuality) args.push('--jpeg-quality=' + p.jpegQuality);

  switch (p.sizeMode) {
    case 'local': args.push('--force-localsize'); break;
    case 'full': args.push('--force-fullmap'); break;
    default: break; // auto
  }
  switch (p.engine) {
    case 'ra2': args.push('--force-ra2'); break;
    case 'yr': args.push('--force-yr'); break;
    case 'ts': args.push('--force-ts'); break;
    case 'fs': args.push('--force-fs'); break;
    default: break; // auto
  }
  if (p.markStartPos) {
    args.push('--start-pos-squared'); // give the checkbox a visible marker shape
    args.push('--mark-start-pos');
  }
  if (p.markOre) args.push('--mark-ore');
  args.push('--progress'); // emit progress:N:phase lines for the UI

  // The CLI derives the output filename from the *infile* basename (so for an
  // uploaded file the on-disk output ends up <token>.png); the friendly
  // download name stays the original map name.
  const outBase = path.basename(infile).replace(/\.(map|yrm|mpr)$/i, '');
  const ext = fmt === 'jpg' ? '.jpg' : '.png';
  const outFile = path.join(outdir, outBase + ext);
  const friendlyBase = path.basename(displayName).replace(/\.(map|yrm|mpr)$/i, '');
  const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  return {
    args, fmt, outFile, token, name: friendlyBase + ext, mime: fmt === 'jpg' ? 'image/jpeg' : 'image/png',
    url: '/image/' + token, downloadUrl: '/download/' + token,
  };
}

function streamRender(req, res, params) {
  if (!params.infile && !params.uploadToken) {
    return sendJson(res, 400, { error: 'Missing map (infile or uploadToken)' });
  }
  let job;
  try {
    job = buildArgs(params);
  } catch (e) {
    return sendJson(res, 400, { error: String(e && e.message || e) });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const wnd = (obj) => res.write(JSON.stringify(obj) + '\n');
  wnd({ type: 'start', url: job.url, name: job.name, args: job.args.slice(1) });

  const child = spawn(process.execPath, job.args, { cwd: ROOT });
  let outBuf = '';

  child.stdout.on('data', (d) => {
    outBuf += d.toString('utf8');
    let nl;
    while ((nl = outBuf.indexOf('\n')) !== -1) {
      const line = outBuf.slice(0, nl).trim();
      outBuf = outBuf.slice(nl + 1);
      const m = /^progress:(\d+):(.+)$/.exec(line);
      if (m) wnd({ type: 'progress', percent: Number(m[1]), phase: m[2] });
      else if (/^.*\[INFO\] Saved /.test(line)) wnd({ type: 'saved' });
      else if (/\[FATAL\]/.test(line)) wnd({ type: 'log', level: 'fatal', message: line.replace(/^\d+\s*/, '') });
    }
  });
  child.stderr.on('data', (d) => {
    const s = d.toString('utf8');
    if (/\[FATAL\]/.test(s)) wnd({ type: 'log', level: 'fatal', message: s.trim() });
  });

  child.on('error', (e) => {
    wnd({ type: 'error', message: String(e.message || e) });
    res.end();
  });
  child.on('close', (code) => {
    const ok = code === 0 && fs.existsSync(job.outFile);
    if (ok) {
      // Load into memory, then remove the transient file so nothing persists
      // to a local directory.
      cachePut(job.token, { buffer: fs.readFileSync(job.outFile), name: job.name, mime: job.mime, at: Date.now() });
      try { fs.unlinkSync(job.outFile); } catch { /* ignore */ }
      wnd({ type: 'done', ok: true, url: job.url, downloadUrl: job.downloadUrl, name: job.name });
    } else {
      try { fs.unlinkSync(job.outFile); } catch { /* ignore */ }
      wnd({ type: 'done', ok: false, code, message: 'Render exited with code ' + code });
    }
    try {
      res.end();
    } catch { /* already closed */ }
  });
}

function serveStatic(req, res, urlPath) {
  const safe = path
    .normalize(decodeURIComponent(urlPath))
    .replace(/^(\.\.[/\\])+/, '');
  let file = path.join(STATIC_DIR, safe);
  if (!file.startsWith(STATIC_DIR)) {
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
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, root: ROOT });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const fn = (req.headers['x-filename'] && decodeURIComponent(req.headers['x-filename'])) || 'map.map';
      const ext = path.extname(fn).toLowerCase();
      if (!MAP_EXTS.includes(ext)) return sendJson(res, 400, { error: '仅支持 .map / .yrm / .mpr 文件' });
      const buf = await readRawBody(req);
      if (!buf.length) return sendJson(res, 400, { error: '空文件' });
      const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const file = path.join(UPLOAD_DIR, token + ext);
      fs.writeFileSync(file, buf);
      mapTokenPut(token, { file, name: path.basename(fn), at: Date.now() });
      return sendJson(res, 200, { token, name: path.basename(fn), size: buf.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/render') {
      const body = await readBody(req);
      return streamRender(req, res, body);
    }
    if (req.method === 'GET' && (url.pathname.startsWith('/image/') || url.pathname.startsWith('/download/'))) {
      const token = decodeURIComponent(url.pathname.split('/').pop() || '');
      const e = cacheGet(token);
      if (!e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Image expired or not found'); }
      const headers = {
        'Content-Type': e.mime,
        'Content-Length': e.buffer.length,
        'Cache-Control': 'private, max-age=3600',
      };
      if (url.pathname.startsWith('/download/')) {
        headers['Content-Disposition'] = 'attachment; filename="' + e.name.replace(/["\\]/g, '_') + '"';
      }
      res.writeHead(200, headers);
      return res.end(e.buffer);
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

fs.mkdirSync(SCRATCH_DIR, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  CNCMaps TS Web UI running at http://127.0.0.1:${PORT}\n  Scratch dir: ${SCRATCH_DIR}\n  Images are served from memory (not persisted).\n`);
});
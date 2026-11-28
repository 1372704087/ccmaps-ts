// Browser render worker. Runs the existing render engine against an in-memory
// file system built from the user's local map and game folder, then encodes the
// result with OffscreenCanvas. No files are uploaded.
import './polyfills.js';
import { RenderEngine } from '../engine/RenderEngine.js';
import { RenderSettings } from '../shared/RenderSettings.js';
import { EngineType, EngineResult, SizeMode, StartPositionMarking } from '../shared/Enums.js';
import { logger, LogLevel } from '../shared/Log.js';
import type { DrawingSurface } from '../rendering/DrawingSurface.js';
import type { Rectangle } from '../shared/Geometry.js';
import type { MapStats } from '../engine/map/MapStats.js';
import * as vfs from './fs-shim.js';
import { bgrToRgba } from './bgr.js';
import { VirtualFileSystem } from '../formats/vfs/VirtualFileSystem.js';

interface RenderOptions {
  format?: 'png' | 'jpg';
  engine?: string;
  sizeMode?: string;
  markStartPos?: boolean;
  markOre?: boolean;
  previewWidth?: number;
  jpegQuality?: number;
  maxPixels?: number;
  aspect?: string;
  crop?: { x?: number; y?: number; width?: number; height?: number };
  markerShape?: string;
  markerSize?: number;
  tunnelPaths?: boolean;
  tunnelPosition?: boolean;
  markIceGrowth?: boolean;
  compressTiles?: boolean;
  fixOverlays?: boolean;
  fixupTiles?: boolean;
  noExpandMixes?: boolean;
  ignoreLighting?: boolean;
}

interface RenderRequest {
  id: number;
  mapName: string;
  mapFile: Blob;
  options?: RenderOptions;
}

const scope = globalThis as any;

function post(message: any): void {
  scope.postMessage(message);
}

let rendering = false;
let lastFatal = '';

const GAME_DIR = '/game';
/** OffscreenCanvas cannot encode anything wider or taller than this. */
const MAX_CANVAS_SIDE = 16384;
/** Parsed archive indexes per (engine, expand setting). The worker outlives a single render,
 * so the next map skips the game folder scan and the MIX header parse. */
const vfsCache = new Map<string, VirtualFileSystem>();
const MAX_CACHED_VFS = 2;

function engineFromOptions(options: RenderOptions): EngineType {
  switch (options.engine) {
    case 'ra2': return EngineType.RedAlert2;
    case 'yr': return EngineType.YurisRevenge;
    case 'ts': return EngineType.TiberianSun;
    case 'fs': return EngineType.Firestorm;
    default: return EngineType.AutoDetect;
  }
}

function gameVfs(engine: EngineType, noExpandMixes: boolean): VirtualFileSystem {
  const key = `${engine}|${noExpandMixes ? 1 : 0}`;
  const cached = vfsCache.get(key);
  if (cached != null) {
    // refresh LRU position
    vfsCache.delete(key);
    vfsCache.set(key, cached);
    return cached;
  }
  const loaded = new VirtualFileSystem();
  loaded.CacheParsedInis = true;
  loaded.addItem(GAME_DIR);
  loaded.loadMixes(GAME_DIR, engine, !noExpandMixes);
  vfsCache.set(key, loaded);
  while (vfsCache.size > MAX_CACHED_VFS) {
    const oldest = vfsCache.keys().next().value as string;
    const old = vfsCache.get(oldest);
    vfsCache.delete(oldest);
    try { old?.dispose(); } catch { /* ignore */ }
  }
  return loaded;
}

function clearVfsCache(): void {
  for (const cached of vfsCache.values()) {
    try { cached.dispose(); } catch { /* ignore */ }
  }
  vfsCache.clear();
}

logger.setLevel(LogLevel.Warn);
logger.setSink((level, message) => {
  if (level >= LogLevel.Error) lastFatal = message;
  post({ type: 'log', level, message });
});

function makeSettings(
  settings: RenderSettings,
  options: RenderOptions,
  mapPath: string,
  engine: EngineType,
  assetVfs: VirtualFileSystem,
): void {
  settings.InputFile = mapPath;
  settings.MixFilesDirectories = [GAME_DIR];
  settings.AssetVfs = assetVfs;
  settings.OutputFile = '';
  settings.OutputDir = '';
  settings.MetadataOutFile = '';
  settings.PreviewWidth = Math.max(0, Number(options.previewWidth) || 0);
  settings.BandHeight = 0; // let the engine decide; required for previews above the browser cap
  const crop = options.crop;
  if (crop && typeof crop === 'object') {
    settings.CropX = Math.min(1, Math.max(0, Number(crop.x) || 0));
    settings.CropY = Math.min(1, Math.max(0, Number(crop.y) || 0));
    settings.CropWidth = Math.min(1, Math.max(0.001, Number(crop.width) || 1));
    settings.CropHeight = Math.min(1, Math.max(0.001, Number(crop.height) || 1));
  }
  settings.OutputAspect = ['1:1', '4:5', '16:9', '9:16'].includes(String(options.aspect))
    ? String(options.aspect)
    : 'free';
  settings.ReportProgress = true;
  settings.MaxSurfacePixels = options.maxPixels ?? 0;

  settings.Engine = engine;
  switch (options.sizeMode) {
    case 'local': settings.SizeMode = SizeMode.Local; break;
    case 'full': settings.SizeMode = SizeMode.Full; break;
    default: settings.SizeMode = SizeMode.Auto; break;
  }
  settings.MarkStartPos = !!options.markStartPos;
  if (settings.MarkStartPos) {
    const shapes: Record<string, StartPositionMarking> = {
      squared: StartPositionMarking.Squared,
      circled: StartPositionMarking.Circled,
      diamond: StartPositionMarking.Diamond,
      ellipsed: StartPositionMarking.Ellipsed,
      star: StartPositionMarking.Starred,
      tiled: StartPositionMarking.Tiled,
    };
    const shapeKey = String(options.markerShape);
    settings.StartPositionMarking = Object.prototype.hasOwnProperty.call(shapes, shapeKey) ? shapes[shapeKey] : StartPositionMarking.Squared;
  }
  const markerSize = Number(options.markerSize);
  if (Number.isFinite(markerSize)) settings.MarkerStartSize = Math.min(6, Math.max(2, markerSize));
  settings.TunnelPaths = !!options.tunnelPaths;
  settings.TunnelPosition = !!options.tunnelPosition;
  settings.MarkIceGrowth = !!options.markIceGrowth;
  settings.CompressTiles = !!options.compressTiles;
  settings.FixOverlays = !!options.fixOverlays;
  settings.FixupTiles = !!options.fixupTiles;
  settings.NoExpandMixes = !!options.noExpandMixes;
  settings.IgnoreLighting = !!options.ignoreLighting;
  settings.MarkOreFields = !!options.markOre;
}

function mapNameWithoutExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

async function encode(
  surface: DrawingSurface,
  rect: Rectangle,
  format: 'png' | 'jpg',
  jpegQuality: number,
): Promise<Blob> {
  if (typeof (globalThis as any).OffscreenCanvas !== 'function' || typeof (globalThis as any).ImageData !== 'function') {
    throw Object.assign(new Error('OffscreenCanvas is not available'), { code: 'ENCODE_UNSUPPORTED' });
  }
  const width = Math.max(1, rect.Width);
  const height = Math.max(1, rect.Height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Object.assign(new Error('2D context is not available'), { code: 'ENCODE_UNSUPPORTED' });
  // Convert in strips: a 64 MP surface would otherwise need an extra 256 MB RGBA buffer
  // on top of the canvas. 512 rows keeps the transient copy around width*2 KB.
  const bandRows = 512;
  for (let y = 0; y < height; y += bandRows) {
    const rows = Math.min(bandRows, height - y);
    const rgba = bgrToRgba(surface, rect, y, rows);
    ctx.putImageData(new ImageData(rgba, width, rows), 0, y);
  }
  return canvas.convertToBlob({
    type: format === 'jpg' ? 'image/jpeg' : 'image/png',
    quality: format === 'jpg' ? Math.min(1, Math.max(0, jpegQuality / 100)) : undefined,
  });
}

async function handleRender(req: RenderRequest): Promise<void> {
  if (rendering) {
    post({ type: 'error', id: req.id, code: 'BUSY', message: 'A render is already running' });
    return;
  }
  rendering = true;
  lastFatal = '';
  try {
    const mapName = String(req.mapName || 'map.map').split(/[\\/]/).pop() || 'map.map';
    const mapPath = '/maps/' + mapName;
    vfs.mountFile(mapPath, req.mapFile);

    const explicitEngine = engineFromOptions(req.options ?? {});
    const engine = explicitEngine === EngineType.AutoDetect
      ? RenderEngine.detectEngine(vfs.readFileSync(mapPath), [GAME_DIR])
      : explicitEngine;
    const assetVfs = gameVfs(engine, !!req.options?.noExpandMixes);

    const engineInstance = new RenderEngine();
    const settings = new RenderSettings();
    makeSettings(settings, req.options ?? {}, mapPath, engine, assetVfs);
    settings.ProgressSink = (percent, phase) => post({ type: 'progress', id: req.id, percent, phase });
    let captured: { surface: DrawingSurface; rect: Rectangle } | null = null;
    const output: { value: { surface: DrawingSurface; rect: Rectangle } | null } = { value: null };
    settings.OutputSink = (surface, rect) => { output.value = { surface, rect }; };
    let stats: ReturnType<MapStats['toPlainObject']> | null = null;
    settings.StatsSink = (value) => { stats = value.toPlainObject(); };

    const result = engineInstance.Render(settings);
    captured = output.value;
    if (result !== EngineResult.RenderedOk || captured == null) {
      const missingAssets = /rules or art|theater|game data|mix file directory|initialize map/i.test(lastFatal);
      const code = result === EngineResult.SurfaceTooLarge
        ? 'SURFACE_TOO_LARGE'
        : (result === EngineResult.LoadTheaterFailed || missingAssets) ? 'ASSETS_MISSING' : 'RENDER_FAILED';
      post({ type: 'error', id: req.id, code, message: lastFatal || EngineResult[result] });
      return;
    }

    // The surface may fit the pixel budget yet still exceed the canvas side limit, in which
    // case convertToBlob would fail; report it so the UI can retry with a downscaled preview.
    if (captured.rect.Width > MAX_CANVAS_SIDE || captured.rect.Height > MAX_CANVAS_SIDE) {
      post({
        type: 'error',
        id: req.id,
        code: 'SURFACE_TOO_LARGE',
        message: `Rendered image ${captured.rect.Width}x${captured.rect.Height} exceeds the browser `
          + `canvas limit of ${MAX_CANVAS_SIDE}px per side`,
      });
      return;
    }

    post({ type: 'progress', id: req.id, percent: 95, phase: 'encoding' });
    const format = req.options?.format === 'jpg' ? 'jpg' : 'png';
    const blob = await encode(captured.surface, captured.rect, format, req.options?.jpegQuality ?? 92);
    post({
      type: 'result',
      id: req.id,
      blob,
      width: captured.rect.Width,
      height: captured.rect.Height,
      name: mapNameWithoutExt(mapName) + (format === 'jpg' ? '.jpg' : '.png'),
      engine: engineInstance.LastEngine == null ? 'auto' : EngineType[engineInstance.LastEngine],
      stats,
    });
  } catch (e: any) {
    const code = e && e.code ? e.code : 'RENDER_FAILED';
    post({ type: 'error', id: req.id, code, message: String(e && e.message || e) });
  } finally {
    rendering = false;
  }
}

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'assets') {
    // new game files invalidate every archive list parsed from the old ones
    clearVfsCache();
    vfs.reset();
    let count = 0;
    for (const file of msg.files || []) {
      if (!file || !file.path || !file.file) continue;
      vfs.mountFile('/game/' + file.path, file.file);
      count++;
    }
    post({ type: 'assets-ok', count });
    return;
  }
  if (msg.type === 'render') {
    void handleRender(msg as RenderRequest);
  }
};

post({
  type: 'ready',
  fileReaderSync: typeof (globalThis as any).FileReaderSync === 'function',
  offscreen: typeof (globalThis as any).OffscreenCanvas === 'function',
});

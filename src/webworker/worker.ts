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
import * as vfs from './fs-shim.js';
import { bgrToRgba } from './bgr.js';

interface RenderOptions {
  format?: 'png' | 'jpg';
  engine?: string;
  sizeMode?: string;
  markStartPos?: boolean;
  markOre?: boolean;
  previewWidth?: number;
  jpegQuality?: number;
  maxPixels?: number;
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

logger.setLevel(LogLevel.Warn);
logger.setSink((level, message) => {
  if (level >= LogLevel.Error) lastFatal = message;
  post({ type: 'log', level, message });
});

function makeSettings(settings: RenderSettings, options: RenderOptions, mapPath: string): void {
  settings.InputFile = mapPath;
  settings.MixFilesDirectories = ['/game'];
  settings.OutputFile = '';
  settings.OutputDir = '';
  settings.MetadataOutFile = '';
  settings.PreviewWidth = Math.max(0, Number(options.previewWidth) || 0);
  settings.BandHeight = -1;
  settings.ReportProgress = true;
  settings.MaxSurfacePixels = options.maxPixels ?? 0;

  switch (options.engine) {
    case 'ra2': settings.Engine = EngineType.RedAlert2; break;
    case 'yr': settings.Engine = EngineType.YurisRevenge; break;
    case 'ts': settings.Engine = EngineType.TiberianSun; break;
    case 'fs': settings.Engine = EngineType.Firestorm; break;
    default: settings.Engine = EngineType.AutoDetect; break;
  }
  switch (options.sizeMode) {
    case 'local': settings.SizeMode = SizeMode.Local; break;
    case 'full': settings.SizeMode = SizeMode.Full; break;
    default: settings.SizeMode = SizeMode.Auto; break;
  }
  settings.MarkStartPos = !!options.markStartPos;
  if (settings.MarkStartPos) settings.StartPositionMarking = StartPositionMarking.Squared;
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
  const rgba = bgrToRgba(surface, rect);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Object.assign(new Error('2D context is not available'), { code: 'ENCODE_UNSUPPORTED' });
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
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

    const engine = new RenderEngine();
    const settings = new RenderSettings();
    makeSettings(settings, req.options ?? {}, mapPath);
    settings.ProgressSink = (percent, phase) => post({ type: 'progress', id: req.id, percent, phase });
    let captured: { surface: DrawingSurface; rect: Rectangle } | null = null;
    const output: { value: { surface: DrawingSurface; rect: Rectangle } | null } = { value: null };
    settings.OutputSink = (surface, rect) => { output.value = { surface, rect }; };

    const result = engine.Render(settings);
    captured = output.value;
    if (result !== EngineResult.RenderedOk || captured == null) {
      const missingAssets = /rules or art|theater|game data|mix file directory|initialize map/i.test(lastFatal);
      const code = result === EngineResult.SurfaceTooLarge
        ? 'SURFACE_TOO_LARGE'
        : (result === EngineResult.LoadTheaterFailed || missingAssets) ? 'ASSETS_MISSING' : 'RENDER_FAILED';
      post({ type: 'error', id: req.id, code, message: lastFatal || EngineResult[result] });
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
      engine: engine.LastEngine == null ? 'auto' : EngineType[engine.LastEngine],
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

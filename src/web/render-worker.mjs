// Long-lived render worker used by the web server. The worker keeps one VirtualFileSystem per
// (engine, mix dirs, expand setting), so repeated renders reuse the parsed archive indexes
// instead of re-scanning the game folders.
import { parentPort } from 'node:worker_threads';
import * as fs from 'node:fs';
import { RenderEngine } from '../../dist/engine/RenderEngine.js';
import { RenderSettings } from '../../dist/shared/RenderSettings.js';
import { EngineType, SizeMode, StartPositionMarking, EngineResult } from '../../dist/shared/Enums.js';
import { VirtualFileSystem } from '../../dist/formats/vfs/VirtualFileSystem.js';
import { logger, LogLevel } from '../../dist/shared/Log.js';

const vfsCache = new Map(); // key -> VirtualFileSystem, oldest first
const MAX_CACHED_VFS = 2;

function post(message) {
  try { parentPort.postMessage(message); } catch { /* parent gone */ }
}

logger.setLevel(LogLevel.Warn);
logger.setSink((level, message) => {
  if (level >= LogLevel.Warn) post({ type: 'log', level, message });
});

function engineFromName(name) {
  switch (name) {
    case 'ra2': return EngineType.RedAlert2;
    case 'yr': return EngineType.YurisRevenge;
    case 'ts': return EngineType.TiberianSun;
    case 'fs': return EngineType.Firestorm;
    default: return EngineType.AutoDetect;
  }
}

function detectEngine(job) {
  const explicit = engineFromName(job.engine);
  if (explicit !== EngineType.AutoDetect) return explicit;
  try {
    const bytes = fs.readFileSync(job.inputFile);
    return RenderEngine.detectEngine(bytes, job.mixDirs);
  } catch {
    return EngineType.AutoDetect;
  }
}

function gameVfs(job, engine) {
  const key = `${engine}|${job.noExpandMixes ? 1 : 0}|${job.mixDirs.join(';')}`;
  const cached = vfsCache.get(key);
  if (cached != null) {
    // refresh LRU position
    vfsCache.delete(key);
    vfsCache.set(key, cached);
    return cached;
  }
  const vfs = new VirtualFileSystem();
  for (const dir of job.mixDirs) if (dir) vfs.addItem(dir);
  vfs.loadMixes(job.mixDirs[0] || '', engine, !job.noExpandMixes);
  vfsCache.set(key, vfs);
  while (vfsCache.size > MAX_CACHED_VFS) {
    const oldest = vfsCache.keys().next().value;
    const old = vfsCache.get(oldest);
    vfsCache.delete(oldest);
    try { old?.dispose(); } catch { /* ignore */ }
  }
  return vfs;
}

function makeSettings(job, engine, vfs) {
  const s = new RenderSettings();
  s.InputFile = job.inputFile;
  s.OutputDir = job.outputDir;
  s.OutputFile = job.outputFile;
  s.MixFilesDirectories = job.mixDirs.slice();
  s.NoExpandMixes = !!job.noExpandMixes;
  s.Engine = engine;
  s.SavePNG = job.format === 'png';
  s.SaveJPEG = job.format === 'jpg';
  s.SavePSD = job.format === 'psd';
  s.PsdPreview = job.format === 'psd';
  s.PNGQuality = job.pngQuality;
  s.JPEGCompression = job.jpegQuality;
  s.SizeMode = job.sizeMode === 'local' ? SizeMode.Local : job.sizeMode === 'full' ? SizeMode.Full : SizeMode.Auto;
  s.PreviewWidth = job.previewWidth;
  if (job.crop && typeof job.crop === 'object') {
    s.CropX = Math.min(1, Math.max(0, Number(job.crop.x) || 0)) / 100;
    s.CropY = Math.min(1, Math.max(0, Number(job.crop.y) || 0)) / 100;
    s.CropWidth = Math.min(100, Math.max(0.001, Number(job.crop.width) || 100)) / 100;
    s.CropHeight = Math.min(100, Math.max(0.001, Number(job.crop.height) || 100)) / 100;
  }
  s.OutputAspect = ['1:1', '4:5', '16:9', '9:16'].includes(job.aspect) ? job.aspect : 'free';
  s.MarkStartPos = !!job.markStartPos;
  const shapes = {
    squared: StartPositionMarking.Squared,
    circled: StartPositionMarking.Circled,
    diamond: StartPositionMarking.Diamond,
    ellipsed: StartPositionMarking.Ellipsed,
    star: StartPositionMarking.Starred,
    tiled: StartPositionMarking.Tiled,
  };
  s.StartPositionMarking = shapes[job.markerShape] ?? StartPositionMarking.Squared;
  if (Number.isFinite(job.markerSize)) s.MarkerStartSize = Math.min(6, Math.max(2, job.markerSize));
  s.MarkOreFields = !!job.markOre;
  s.TunnelPaths = !!job.tunnelPaths;
  s.TunnelPosition = !!job.tunnelPosition;
  s.MarkIceGrowth = !!job.markIceGrowth;
  s.CompressTiles = !!job.compressTiles;
  s.FixOverlays = !!job.fixOverlays;
  s.FixupTiles = !!job.fixupTiles;
  s.IgnoreLighting = !!job.ignoreLighting;
  s.MaxSurfacePixels = job.maxSurfacePixels || 0;
  s.StreamBands = job.streamBands || 'auto';
  s.RenderMemoryMb = job.renderMemoryMb || 0;
  s.ParallelWorkers = job.parallelWorkers || 1;
  s.MetadataOutFile = job.metadataFile || '';
  s.ReportProgress = false;
  s.ProgressSink = (percent, phase) => post({ type: 'progress', percent, phase });
  s.AssetVfs = vfs;
  return s;
}

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'render') return;
  const job = msg.job;
  const engine = detectEngine(job);
  if (engine === EngineType.AutoDetect) {
    post({ type: 'done', ok: false, result: EngineResult.Exception, message: 'Could not determine the engine' });
    return;
  }
  let vfs = null;
  try {
    vfs = gameVfs(job, engine);
    const settings = makeSettings(job, engine, vfs);
    const result = new RenderEngine().Render(settings);
    post({
      type: 'done',
      ok: result === EngineResult.RenderedOk,
      result,
      message: result === EngineResult.RenderedOk ? '' : EngineResult[result] || 'render failed',
    });
  } catch (e) {
    post({ type: 'done', ok: false, result: EngineResult.Exception, message: String((e && e.stack) || e) });
  }
});

// Worker-thread entry for parallel streamed rendering. The worker is pooled by the renderer and
// stays alive between renders, so the parsed game archives (VFS + rules/art/theater art) are
// reused instead of being rebuilt for every job.
import { parentPort } from 'node:worker_threads';
import * as fs from 'node:fs';
import { RenderEngine } from '../RenderEngine.js';
import { RenderSettings } from '../../shared/RenderSettings.js';
import { EngineResult, EngineType } from '../../shared/Enums.js';
import { VirtualFileSystem } from '../../formats/vfs/VirtualFileSystem.js';

interface BandJob {
  errorFile: string;
  control: SharedArrayBuffer;
  workerIndex: number;
  workerCount: number;
  settings: Record<string, unknown>;
  bandJob: NonNullable<RenderSettings['BandJob']>;
  metadataFile: string;
}

const vfsCache = new Map<string, VirtualFileSystem>();
const MAX_CACHED_VFS = 2;
/** A band worker duplicates the parsed archives, so keep its share of the art cache smaller. */
const BAND_WORKER_ART_CACHE_BYTES = 32 * 1024 * 1024;

function gameVfs(engine: EngineType, dirs: string[], noExpandMixes: boolean): VirtualFileSystem {
  const key = `${engine}|${noExpandMixes ? 1 : 0}|${dirs.join(';')}`;
  const cached = vfsCache.get(key);
  if (cached != null) {
    // refresh LRU position
    vfsCache.delete(key);
    vfsCache.set(key, cached);
    return cached;
  }
  const vfs = new VirtualFileSystem();
  vfs.CacheParsedInis = true;
  for (const dir of dirs) if (dir !== '') vfs.addItem(dir);
  vfs.loadMixes(dirs[0] ?? '', engine, !noExpandMixes);
  vfsCache.set(key, vfs);
  while (vfsCache.size > MAX_CACHED_VFS) {
    const oldest = vfsCache.keys().next().value as string;
    const old = vfsCache.get(oldest);
    vfsCache.delete(oldest);
    try { old?.dispose(); } catch { /* ignore */ }
  }
  return vfs;
}

function renderJob(job: BandJob): void {
  const ctl = new Int32Array(job.control);
  const settings = new RenderSettings();
  Object.assign(settings, job.settings);
  // the parent process owns progress reporting and diagnostics
  settings.ProgressSink = null;
  settings.StatsSink = null;
  settings.OutputSink = null;
  settings.ReportProgress = false;
  settings.MetadataOutFile = job.workerIndex === 0 ? job.metadataFile : '';
  settings.BandJob = job.bandJob;
  settings.BandJobControl = ctl;

  // the parent can only pass plain data across threads; the archives come from this worker's
  // own cache so a repeated render skips the MIX scan and the rules/art parse
  const dirs = settings.MixFilesDirectories;
  let engine = settings.Engine;
  if (engine === EngineType.AutoDetect) {
    engine = RenderEngine.detectEngine(fs.readFileSync(settings.InputFile), dirs);
  }
  if (engine === EngineType.AutoDetect) throw new Error('Could not determine the engine');
  settings.Engine = engine;
  settings.AssetVfs = gameVfs(engine, dirs, settings.NoExpandMixes);

  const result = new RenderEngine().Render(settings);
  if (result !== EngineResult.RenderedOk) {
    throw new Error(`band worker ${job.workerIndex} failed: ${EngineResult[result]}`);
  }
  Atomics.store(ctl, 2 + job.workerIndex, 100);
}

export function runBandWorkerLoop(): void {
  if (parentPort == null) return;
  VirtualFileSystem.SharedFileBudgetBytes = Math.min(
    VirtualFileSystem.SharedFileBudgetBytes,
    BAND_WORKER_ART_CACHE_BYTES,
  );
  parentPort.on('message', (msg: { type?: string; job?: BandJob } | null) => {
    if (msg == null || msg.type !== 'render' || msg.job == null) return;
    const job = msg.job;
    try {
      renderJob(job);
    } catch (e) {
      try { fs.writeFileSync(job.errorFile, String(e instanceof Error ? (e.stack ?? e.message) : e)); } catch { /* ignore */ }
      Atomics.store(new Int32Array(job.control), 1, 1);
    } finally {
      // the parent waits on this slot before handing the worker its next job
      const ctl = new Int32Array(job.control);
      const idle = 2 + job.workerCount + job.workerIndex;
      Atomics.store(ctl, idle, 1);
      Atomics.notify(ctl, idle);
    }
  });
}

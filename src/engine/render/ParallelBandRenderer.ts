// Draws streamed PNG strips on several worker threads. Each worker initialises the render
// engine itself (mix archives are read on demand), works out the same strip layout, renders
// every Nth strip and writes the cropped BGR rows to a scratch file. This process stays light:
// it waits for the workers, then stitches the rows into one PNG in order.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RenderSettings } from '../../shared/RenderSettings.js';
import { pngZlibHeader, writePngChunk, writePngHeader } from '../../rendering/PngWriter.js';

const WORKER_BOOTSTRAP = `
import('node:worker_threads').then(({ workerData }) => {
  const ctl = new Int32Array(workerData.control);
  import(workerData.entryUrl).then((m) => m.runBandWorker(workerData)).catch((e) => {
    import('node:fs').then((fs) => {
      try { fs.writeFileSync(workerData.errorFile, String((e && e.stack) || e)); } catch {}
    }).finally(() => {
      Atomics.store(ctl, 1, 1);
      Atomics.add(ctl, 0, 1);
      Atomics.notify(ctl, 0);
    });
  });
});
`;

export interface ParallelStreamRequest {
  settings: RenderSettings;
  outPath: string;
}

interface Layout {
  width: number;
  height: number;
  bands: unknown[];
}

function entryUrl(): string {
  const base = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
  const file = path.resolve(base, 'engine', 'render', 'bandWorkerMain.js');
  return 'file:///' + file.replace(/\\/g, '/');
}

function report(settings: RenderSettings, last: { pct: number }, pct: number, phase: string): void {
  const value = Math.max(last.pct, Math.min(100, Math.trunc(pct)));
  if (value <= last.pct) return;
  last.pct = value;
  if (settings.ProgressSink) settings.ProgressSink(value, phase);
  else if (settings.ReportProgress) process.stdout.write(`progress:${value}:${phase}\n`);
}

/** Runs the streamed render across several workers and writes the final PNG. */
export function runParallelStream(req: ParallelStreamRequest): void {
  const { settings, outPath } = req;
  const workerCount = Math.max(1, settings.ParallelWorkers);
  const outDir = path.join(path.dirname(outPath), `.cncmaps-band-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(outDir, { recursive: true });

  const control = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (2 + workerCount));
  const ctl = new Int32Array(control);
  const metadataFile = settings.MetadataOutFile;
  const snapshot = JSON.parse(JSON.stringify(settings, (key, value) => (typeof value === 'function' ? undefined : value))) as Record<string, unknown>;
  snapshot.BandJob = null;

  const workers: Worker[] = [];
  const errors: string[] = [];
  const url = entryUrl();
  for (let i = 0; i < workerCount; i++) {
    const errorFile = path.join(outDir, `error-${i}.txt`);
    errors.push(errorFile);
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: {
        entryUrl: url,
        errorFile,
        control,
        workerIndex: i,
        workerCount,
        settings: snapshot,
        bandJob: { outDir, workerIndex: i, workerCount },
        metadataFile,
      },
    });
    worker.unref();
    workers.push(worker);
  }

  const progress = { pct: 10 };
  report(settings, progress, 15, 'drawing tiles');
  const started = Date.now();
  const timeoutMs = 2 * 60 * 60 * 1000;
  let done = 0;
  let failed = 0;
  try {
    while (done < workerCount) {
      Atomics.wait(ctl, 0, done, 250);
      done = Atomics.load(ctl, 0);
      failed = Atomics.load(ctl, 1);
      if (failed !== 0) break;
      let sum = 0;
      for (let i = 0; i < workerCount; i++) sum += Atomics.load(ctl, 2 + i);
      report(settings, progress, 15 + (80 * sum) / (workerCount * 100), 'drawing tiles');
      if (Date.now() - started > timeoutMs) throw new Error('parallel stream timed out');
    }
    if (failed !== 0 || done < workerCount) {
      const detail = errors.map((f) => {
        try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
      }).filter(Boolean).join('\n');
      throw new Error(detail || 'parallel band worker failed');
    }

    const layoutFile = path.join(outDir, 'layout.json');
    if (!fs.existsSync(layoutFile)) throw new Error('parallel band worker did not report a layout');
    const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8')) as Layout;

    // Stitch the already-compressed strips in map order. Splitting a PNG into independent
    // deflate blocks is valid as long as each block ends on a Z_SYNC_FLUSH boundary; only the
    // very last block carries Z_FINISH. The combined Adler-32 is folded in here.
    const fd = fs.openSync(outPath, 'w');
    try {
      writePngHeader(fd, layout.width, layout.height);
      let adlerA = 1;
      let adlerB = 0;
      let first = true;
      for (let index = 0; index < layout.bands.length; index++) {
        const meta = JSON.parse(fs.readFileSync(path.join(outDir, `band-${index}.json`), 'utf8')) as {
          a: number;
          b: number;
          len: number;
        };
        const compressed = fs.readFileSync(path.join(outDir, `band-${index}.deflate`));
        const payload = first
          ? Buffer.concat([pngZlibHeader(settings.PNGQuality), compressed])
          : compressed;
        writePngChunk(fd, 'IDAT', payload);
        const nextA = (adlerA + meta.a - 1) % 65521;
        const nextB = (adlerB + meta.b + meta.len * (adlerA - 1)) % 65521;
        adlerA = nextA;
        adlerB = nextB;
        first = false;
      }
      const adler = Buffer.allocUnsafe(4);
      adler.writeUInt32BE((((adlerB << 16) | adlerA) >>> 0), 0);
      writePngChunk(fd, 'IDAT', adler);
      writePngChunk(fd, 'IEND', Buffer.alloc(0));
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    report(settings, progress, 100, 'done');
  } finally {
    for (const worker of workers) {
      try { void worker.terminate(); } catch { /* ignore */ }
    }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

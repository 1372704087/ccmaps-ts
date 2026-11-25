// Draws streamed PNG strips on several worker threads and hands the compressed strips back
// through shared memory. Each worker initialises the render engine itself (mix archives are
// read on demand), works out the same strip layout, renders every Nth strip and pushes
// deflate blocks through a SharedArrayBuffer; this process only stitches blocks into the PNG.
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

/** One shared slot per worker: a control block plus the compressed block bytes. */
const SLOT_BYTES = 5 * 1024 * 1024;
/** Raw bytes compressed per hand-off (filter byte + RGB rows). */
const RAW_SEGMENT_BYTES = 4 * 1024 * 1024;

export interface ParallelStreamRequest {
  settings: RenderSettings;
  outPath: string;
}

interface Layout {
  width: number;
  height: number;
  bands: { index: number; top: number; height: number }[];
}

// meta slots, see renderBandJob
const M_READY = 0;
const M_ACK = 1;
const M_BAND = 2;
const M_BAND_DONE = 3;
const M_FINAL = 4;
const M_ADLER_A = 5;
const M_ADLER_B = 6;
const M_RAW_LEN = 7;
const M_COMPRESSED_LEN = 8;

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
  const metas: Int32Array[] = [];
  const datas: SharedArrayBuffer[] = [];
  const url = entryUrl();
  for (let i = 0; i < workerCount; i++) {
    const errorFile = path.join(outDir, `error-${i}.txt`);
    errors.push(errorFile);
    const metaBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 9);
    const dataBuffer = new SharedArrayBuffer(SLOT_BYTES);
    metas.push(new Int32Array(metaBuffer));
    datas.push(dataBuffer);
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: {
        entryUrl: url,
        errorFile,
        control,
        workerIndex: i,
        workerCount,
        settings: snapshot,
        bandJob: { outDir, workerIndex: i, workerCount, metaBuffer, dataBuffer },
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
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let fd = -1;
  try {
    // worker 0 publishes the measured framing before drawing; wait for it.
    const layoutFile = path.join(outDir, 'layout.json');
    let layout: Layout | null = null;
    for (let i = 0; i < 2400; i++) {
      if (Atomics.load(ctl, 1) !== 0) throw new Error(readErrors(errors) || 'parallel band worker failed');
      if (fs.existsSync(layoutFile)) {
        try {
          layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8')) as Layout;
          break;
        } catch { /* still being written */ }
      }
      Atomics.wait(sleeper, 0, 0, 50);
    }
    if (layout == null) throw new Error('parallel band worker did not report a layout');

    fd = fs.openSync(outPath, 'w');
    writePngHeader(fd, layout.width, layout.height);
    let adlerA = 1;
    let adlerB = 0;
    let first = true;

    for (let band = 0; band < layout.bands.length; band++) {
      const workerIndex = band % workerCount;
      const meta = metas[workerIndex];
      const data = datas[workerIndex];
      // start from what this worker has already had acknowledged; a block may have been
      // produced before this loop began.
      let consumed = Atomics.load(meta, M_ACK);
      let bandDone = 0;
      while (bandDone === 0) {
        let ready = Atomics.load(meta, M_READY);
        while (ready <= consumed) {
          Atomics.wait(meta, M_READY, ready, 250);
          ready = Atomics.load(meta, M_READY);
          if (Atomics.load(ctl, 1) !== 0) throw new Error(readErrors(errors) || 'parallel band worker failed');
          if (Date.now() - started > timeoutMs) throw new Error('parallel stream timed out');
        }
        if (Atomics.load(meta, M_BAND) !== band) {
          throw new Error(`band worker ${workerIndex} produced band ${Atomics.load(meta, M_BAND)} while ${band} was expected`);
        }
        const rawLen = Atomics.load(meta, M_RAW_LEN);
        const metaA = Atomics.load(meta, M_ADLER_A);
        const metaB = Atomics.load(meta, M_ADLER_B);
        const compressedLen = Atomics.load(meta, M_COMPRESSED_LEN);
        const compressed = Buffer.from(data, 0, compressedLen);
        writePngChunk(fd, 'IDAT', first ? Buffer.concat([pngZlibHeader(settings.PNGQuality), compressed]) : compressed);
        const nextA = (adlerA + metaA - 1) % 65521;
        const nextB = (adlerB + metaB + rawLen * (adlerA - 1)) % 65521;
        adlerA = nextA;
        adlerB = nextB;
        first = false;
        bandDone = Atomics.load(meta, M_BAND_DONE);
        consumed = ready;
        Atomics.store(meta, M_ACK, ready);
        Atomics.notify(meta, M_ACK);
      }
      report(settings, progress, 15 + (80 * (band + 1)) / layout.bands.length, 'drawing tiles');
    }

    const adler = Buffer.allocUnsafe(4);
    adler.writeUInt32BE((((adlerB << 16) | adlerA) >>> 0), 0);
    writePngChunk(fd, 'IDAT', adler);
    writePngChunk(fd, 'IEND', Buffer.alloc(0));
    fs.closeSync(fd);
    fd = -1;
    report(settings, progress, 100, 'done');
  } finally {
    if (fd >= 0) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    for (const worker of workers) {
      try { void worker.terminate(); } catch { /* ignore */ }
    }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function readErrors(files: string[]): string {
  return files.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).filter(Boolean).join('\n');
}

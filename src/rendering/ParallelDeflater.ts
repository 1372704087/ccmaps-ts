// Synchronous parallel deflate: one worker per slot, driven with SharedArrayBuffer counters.
// Chunks are already independent in the PNG writer, so each worker produces exactly the bytes
// the single-thread zlib call would, just on another core.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

const WORKER_BOOTSTRAP = `
import('node:worker_threads').then(({ workerData }) => {
  import(workerData.entryUrl)
    .then((m) => m.runDeflateWorker(workerData))
    .catch(() => process.exit(1));
});
`;

const INPUT_BYTES = 4 * 1024 * 1024;
const OUTPUT_BYTES = INPUT_BYTES + 256 * 1024;

interface Slot {
  worker: Worker;
  meta: Int32Array;
  input: Uint8Array;
  output: Uint8Array;
  seq: number;
  queued: boolean;
}

/** Finds the compiled worker entry next to (or above) the running script, so the CLI, tests
 * and library callers all resolve the same dist layout. Server workers run from src/, so the
 * compiled dist folder is also searched. */
function entryUrl(): string {
  const relatives = [
    path.join('rendering', 'deflateWorkerMain.js'),
    path.join('dist', 'rendering', 'deflateWorkerMain.js'),
  ];
  const start = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
  for (const relative of relatives) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, relative);
      if (fs.existsSync(candidate)) return 'file:///' + candidate.replace(/\\/g, '/');
      dir = path.dirname(dir);
    }
  }
  return 'file:///' + path.resolve(process.cwd(), relatives[0]).replace(/\\/g, '/');
}

export class ParallelDeflater {
  readonly workers: number;
  private readonly slots: Slot[] = [];
  private readonly pending: number[] = [];

  constructor(workers: number, level: number) {
    const url = entryUrl();
    const count = Math.max(1, Math.min(8, workers));
    this.workers = count;
    for (let i = 0; i < count; i++) {
      const metaBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5);
      const inputBuffer = new SharedArrayBuffer(INPUT_BYTES);
      const outputBuffer = new SharedArrayBuffer(OUTPUT_BYTES);
      const worker = new Worker(WORKER_BOOTSTRAP, {
        eval: true,
        workerData: { entryUrl: url, meta: metaBuffer, input: inputBuffer, output: outputBuffer, level },
      });
      worker.unref();
      this.slots.push({
        worker,
        meta: new Int32Array(metaBuffer),
        input: new Uint8Array(inputBuffer),
        output: new Uint8Array(outputBuffer),
        seq: 0,
        queued: false,
      });
    }
  }

  get pendingCount(): number { return this.pending.length; }
  get freeCount(): number { return this.slots.filter((s) => !s.queued).length; }

  /** Copies a raw block into a free slot and starts compressing it there. */
  submit(raw: Uint8Array, final: boolean): void {
    const index = this.slots.findIndex((s) => !s.queued);
    if (index < 0) throw new Error('parallel deflate: no free slot');
    const slot = this.slots[index];
    if (raw.length > slot.input.length) throw new Error('parallel deflate: input block too large');
    slot.input.set(raw, 0);
    slot.seq += 1;
    slot.queued = true;
    Atomics.store(slot.meta, 2, raw.length);
    Atomics.store(slot.meta, 3, final ? 1 : 0);
    Atomics.store(slot.meta, 0, slot.seq);
    Atomics.notify(slot.meta, 0);
    this.pending.push(index);
  }

  /** Waits for the oldest submitted block and returns its compressed bytes. */
  collect(): Buffer {
    const index = this.pending.shift();
    if (index == null) throw new Error('parallel deflate: nothing pending');
    const slot = this.slots[index];
    let done = Atomics.load(slot.meta, 1);
    const deadline = Date.now() + 120_000;
    while (done < slot.seq) {
      if (Date.now() > deadline) throw new Error('parallel deflate: worker timed out');
      Atomics.wait(slot.meta, 1, done, 250);
      done = Atomics.load(slot.meta, 1);
    }
    const length = Atomics.load(slot.meta, 4);
    if (length < 0) throw new Error('parallel deflate: output buffer too small');
    const out = Buffer.from(slot.output.buffer, 0, length);
    slot.queued = false;
    return out;
  }

  close(): void {
    for (const slot of this.slots) {
      try { void slot.worker.terminate(); } catch { /* ignore */ }
    }
  }
}

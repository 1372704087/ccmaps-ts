// Worker-thread loop that compresses one PNG scanline block at a time. The parent writes the
// raw rows into a shared input buffer and waits on a shared counter; this keeps every chunk
// byte-identical to the single-thread zlib call while using several cores.
import * as zlib from 'node:zlib';

interface DeflateWorkerData {
  meta: SharedArrayBuffer;
  input: SharedArrayBuffer;
  output: SharedArrayBuffer;
  level: number;
}

export function runDeflateWorker(data: DeflateWorkerData): void {
  const meta = new Int32Array(data.meta);
  const input = new Uint8Array(data.input);
  const output = new Uint8Array(data.output);
  let seen = 0;
  for (;;) {
    let ready = Atomics.load(meta, 0);
    while (ready <= seen) {
      Atomics.wait(meta, 0, ready, 250);
      ready = Atomics.load(meta, 0);
    }
    seen = ready;
    const length = Atomics.load(meta, 2);
    const final = Atomics.load(meta, 3) !== 0;
    const compressed = zlib.deflateRawSync(input.subarray(0, length), {
      level: data.level,
      finishFlush: final ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
    });
    if (compressed.length > output.length) {
      Atomics.store(meta, 4, -1);
    } else {
      output.set(compressed, 0);
      Atomics.store(meta, 4, compressed.length);
    }
    Atomics.store(meta, 1, seen);
    Atomics.notify(meta, 1);
  }
}

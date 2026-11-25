// Browser stub for the Node worker-thread API used by the parallel streamer.
// Parallel band rendering is Node-only; the engine falls back to a single thread
// in the browser worker, so constructing this Worker never happens there.
export class Worker {
  constructor() {
    throw new Error('node:worker_threads is not available in this environment');
  }
  terminate(): void {}
  postMessage(): void {}
  on(): void {}
}

export const isMainThread = true;
export const parentPort = null;
export const workerData = undefined;

// Injected by esbuild into every module that references `process`.
// Keeps the engine's Node-style checks harmless in a browser worker.
export const process = {
  env: {} as Record<string, string>,
  platform: 'browser',
  argv: [] as string[],
  stdout: { write(): boolean { return true; } },
  stderr: { write(): boolean { return true; } },
  hrtime: {
    bigint: () => BigInt(Math.round((globalThis.performance?.now() ?? Date.now()) * 1e6)),
  },
};

(globalThis as any).process = (globalThis as any).process ?? process;

// Builds the standalone browser render worker.
// Node-only modules are replaced with browser shims so the existing render
// engine can run inside a dedicated Web Worker.
import { build } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'web', 'static', 'webworker', 'cncmaps-worker.js');

await build({
  entryPoints: [path.join(ROOT, 'src', 'webworker', 'worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: OUT,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  alias: {
    'node:fs': path.join(ROOT, 'src', 'webworker', 'fs-shim.ts'),
    'node:path': path.join(ROOT, 'src', 'webworker', 'path-shim.ts'),
    'node:os': path.join(ROOT, 'src', 'webworker', 'os-shim.ts'),
    'node:zlib': path.join(ROOT, 'src', 'webworker', 'zlib-stub.ts'),
    'node:buffer': 'buffer',
    'ag-psd': path.join(ROOT, 'src', 'webworker', 'ag-psd-stub.ts'),
  },
  inject: [path.join(ROOT, 'src', 'webworker', 'inject-globals.ts')],
});

const code = fs.readFileSync(OUT, 'utf8');
if (/\bfrom\s*['"]node:|require\(\s*['"]node:/.test(code)) {
  console.error('Worker bundle still references node: modules');
  process.exit(1);
}
console.log(`Worker bundle written to ${OUT}`);

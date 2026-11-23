// Starts the web UI. In a source checkout it first rebuilds the engine and the
// browser worker; in an installed package only `dist` and `src/web` are present,
// so it reuses the shipped build instead of failing on missing TS sources.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(step, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (existsSync(path.join(ROOT, 'src', 'webworker', 'worker.ts')) && existsSync(path.join(ROOT, 'tsconfig.json'))) {
  run('engine build', [path.join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json']);
  run('worker build', [path.join('scripts', 'build-worker.mjs')]);
}

await import('../src/web/server.mjs');

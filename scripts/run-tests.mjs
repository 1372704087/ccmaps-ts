#!/usr/bin/env node
// Portable test discovery for Node 18+ / Windows / Linux.
// `node --test dist` treats the directory as a single test file on some Node
// versions, so pass every compiled *.test.js explicitly.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [join(root, 'dist'), join(root, 'test')];

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.isFile() && /\.test\.(?:js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let files;
try {
  files = roots.filter((dir) => {
    try { return statSync(dir).isDirectory(); } catch { return false; }
  }).flatMap(collect).sort();
} catch (e) {
  console.error(`Cannot read test directories: ${e.message}`);
  process.exit(1);
}
if (!files.length) {
  console.error(`No test files found under ${roots.join(', ')}; run npm run build first.`);
  process.exit(1);
}
console.log(`Running ${files.length} test files...`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

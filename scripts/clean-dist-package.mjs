// npm's `files` allowlist overrides .npmignore, so compiled tests and source maps
// have to be removed from dist before packing. `npm test` rebuilds them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
let removed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.test\.(js|d\.ts)$/.test(entry.name) || /\.map$/.test(entry.name)) {
      fs.unlinkSync(full);
      removed++;
    }
  }
}

if (fs.existsSync(DIST)) walk(DIST);
console.log(`Removed ${removed} test/map files from dist for packaging`);

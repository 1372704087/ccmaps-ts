#!/usr/bin/env node
// Repeatable render benchmark: runs dist/cli.js per map, records render time,
// peak RSS, output size and pixel hash, and compares against an earlier run.
//
// Usage:
//   node scripts/bench-render.mjs --maps=<dir|map1,map2> [--flags="--force-yr"] [--runs=3]
//        [--mixdir=<game dir>] [--label=baseline] [--out=bench-results]
//   node scripts/bench-render.mjs --compare=bench-results/baseline.json --label=phase1 --maps=...
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'dist', 'cli.js');

function parseArgs(argv) {
  const out = { maps: '', flags: '', runs: '1', label: 'bench', out: 'bench-results', mixdir: [], compare: '' };
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    if (!arg.startsWith('--') || eq < 0) continue;
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    if (key === 'mixdir') out.mixdir.push(value);
    else if (key in out) out[key] = value;
  }
  return out;
}

function splitFlags(text) {
  const flags = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) flags.push(m[1] ?? m[2] ?? m[3]);
  return flags;
}

function listMaps(spec) {
  if (!spec) throw new Error('--maps is required (a directory or comma-separated map files)');
  const maps = [];
  for (const part of spec.split(',')) {
    const p = path.resolve(part.trim());
    if (!fs.existsSync(p)) throw new Error(`map path not found: ${p}`);
    if (fs.statSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) {
        if (/\.(map|yrm|mpr)$/i.test(name)) maps.push(path.join(p, name));
      }
    } else {
      maps.push(p);
    }
  }
  if (maps.length === 0) throw new Error(`no .map/.yrm/.mpr files in ${spec}`);
  return maps;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function fmtMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function runOne(mapPath, flags, mixDirs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-bench-'));
  const benchFile = path.join(tmp, 'bench.json');
  const hashFile = path.join(tmp, 'hash.txt');
  const args = [
    cli,
    '--infile=' + mapPath,
    '--outdir=' + tmp,
    '--outfile=render',
    '--output-png',
    '--bench-json=' + benchFile,
    '--pixel-hash=' + hashFile,
  ];
  for (const dir of mixDirs) args.push('--mixdir=' + dir);
  args.push(...flags);

  const res = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  const ok = res.status === 0 && fs.existsSync(benchFile);
  let record = null;
  if (ok) {
    try { record = JSON.parse(fs.readFileSync(benchFile, 'utf8')); } catch { record = null; }
  }
  const failure = ok ? null : (res.stderr || res.stdout || `exit ${res.status}`).trim().split('\n').slice(-6).join('\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  return { record, failure };
}

function compareAgainst(baselinePath, results) {
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const byMap = new Map(base.maps.map((m) => [m.map, m]));
  console.log('\nComparison vs ' + baselinePath);
  console.log('map'.padEnd(28) + 'ms(base→new)'.padEnd(24) + 'rss(base→new)'.padEnd(26) + 'pixels');
  for (const r of results) {
    if (r.error) { console.log(r.map.padEnd(28) + 'ERROR: ' + r.error.split('\n')[0]); continue; }
    const b = byMap.get(r.map);
    if (!b) { console.log(r.map.padEnd(28) + '(no baseline)'); continue; }
    const dms = b.msMedian > 0 ? ((r.msMedian - b.msMedian) / b.msMedian) * 100 : 0;
    const drss = b.rssMaxBytes > 0 ? ((r.rssMaxBytes - b.rssMaxBytes) / b.rssMaxBytes) * 100 : 0;
    const same = b.pixelHash === r.pixelHash ? 'same' : 'DIFFERENT';
    console.log(
      r.map.padEnd(28) +
      `${b.msMedian}→${r.msMedian} (${dms >= 0 ? '+' : ''}${dms.toFixed(1)}%)`.padEnd(24) +
      `${fmtMb(b.rssMaxBytes)}→${fmtMb(r.rssMaxBytes)} (${drss >= 0 ? '+' : ''}${drss.toFixed(1)}%)`.padEnd(26) +
      same,
    );
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(cli)) {
    console.error(`Missing ${cli}; run \`npm run build\` first.`);
    return 1;
  }
  const maps = listMaps(opts.maps);
  const flags = splitFlags(opts.flags || '');
  const runs = Math.max(1, Number.parseInt(opts.runs, 10) || 1);
  const results = [];

  for (const mapPath of maps) {
    const times = [];
    let record = null;
    let failure = null;
    let firstHash = null;
    let maxRss = 0;
    for (let i = 0; i < runs; i++) {
      const one = runOne(mapPath, flags, opts.mixdir);
      if (one.failure) { failure = one.failure; break; }
      record = one.record;
      times.push(one.record.ms);
      maxRss = Math.max(maxRss, one.record.rssMaxBytes);
      if (firstHash == null) firstHash = one.record.pixelHash;
      else if (one.record.pixelHash !== firstHash) {
        console.error(`${path.basename(mapPath)}: pixel hash changed between runs (${firstHash} vs ${one.record.pixelHash})`);
      }
    }
    if (failure) {
      console.error(`${path.basename(mapPath)}: render failed\n${failure}`);
      results.push({ map: path.basename(mapPath), error: failure });
      continue;
    }
    const entry = {
      map: path.basename(mapPath),
      ms: times,
      msMedian: median(times),
      rssMaxBytes: maxRss,
      outBytes: record.outBytes,
      pixelHash: firstHash,
    };
    results.push(entry);
    console.log(
      `${entry.map.padEnd(28)} ${String(entry.msMedian).padStart(6)} ms  ` +
      `rss ${fmtMb(entry.rssMaxBytes).padStart(9)}  out ${fmtMb(entry.outBytes).padStart(9)}  ${entry.pixelHash ? entry.pixelHash.slice(0, 12) : 'n/a'}`,
    );
  }

  const outDir = path.resolve(repoRoot, opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, opts.label + '.json');
  const payload = {
    label: opts.label,
    at: new Date().toISOString(),
    flags: opts.flags,
    runs,
    maps: results,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nWrote ${file}`);

  if (opts.compare) {
    if (!fs.existsSync(opts.compare)) console.error(`No baseline at ${opts.compare}`);
    else compareAgainst(opts.compare, results);
  }
  return results.some((r) => r.error) ? 1 : 0;
}

process.exit(main());

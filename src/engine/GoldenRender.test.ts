// Batch D #19: end-to-end golden render tests.
// Port of CNCMaps.Tests/GoldenRenderTests.cs: render the committed test maps against real
// game data and compare pixel hashes with test-assets/golden.json. Requires
// CNCMAPS_MIX_DIR (RA2/YR) or CNCMAPS_TS_MIX_DIR (Tiberian Sun) pointing at a directory with
// the mix files; the tests are skipped when the variable is not set. The goldens are only
// valid for unmodified original game data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { RenderSettings } from '../shared/RenderSettings.js';
import { EngineType, EngineResult, StartPositionMarking } from '../shared/Enums.js';
import { Rectangle } from '../shared/Geometry.js';
import { PngWriter } from '../rendering/PngWriter.js';
import { RenderEngine } from './RenderEngine.js';

// dist/engine/GoldenRender.test.js -> repository root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetsRoot = path.join(repoRoot, 'test-assets');

function envDir(name: string): string | null {
  const dir = process.env[name];
  return dir != null && dir !== '' && fs.existsSync(dir) ? dir : null;
}

const mixDir = envDir('CNCMAPS_MIX_DIR');
const tsMixDir = envDir('CNCMAPS_TS_MIX_DIR');

const skipRa2 = mixDir == null ? 'CNCMAPS_MIX_DIR is not set or does not exist' : false;
const skipTs = tsMixDir == null ? 'CNCMAPS_TS_MIX_DIR is not set or does not exist' : false;

function loadGoldens(): Record<string, string> {
  const p = path.join(assetsRoot, 'golden.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
}

/// <summary>Renders a committed test map against the given mix dir; returns the output dir.</summary>
function render(
  mapName: string,
  dir: string,
  configure?: (s: RenderSettings) => void,
): string {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-ts-'));
  // work on a copy: some render options write back into the map file
  const mapCopy = path.join(outDir, mapName);
  fs.copyFileSync(path.join(assetsRoot, 'maps', mapName), mapCopy);

  const settings = new RenderSettings();
  settings.InputFile = mapCopy;
  settings.OutputDir = outDir;
  settings.OutputFile = 'render';
  settings.SavePNG = true;
  settings.MixFilesDirectories = [dir];
  configure?.(settings);

  const result = new RenderEngine().Render(settings);
  assert.equal(result, EngineResult.RenderedOk, `render failed for ${mapName}`);
  return outDir;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/// <summary>Decodes an 8-bit truecolor PNG to its RGB rows. The writer emits a lone IDAT and
/// filter type 0, but all five filters are handled so the hash stays valid if that changes.</summary>
function decodePng(buf: Buffer): { width: number; height: number; rgb: Buffer } {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 2)
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = Buffer.alloc(stride * height);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const b = raw[rawPos++];
      const left = x >= 3 ? rgb[rowStart + x - 3] : 0;
      const up = y > 0 ? rgb[prevStart + x] : 0;
      const upLeft = x >= 3 && y > 0 ? rgb[prevStart + x - 3] : 0;
      let v: number;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + left; break;
        case 2: v = b + up; break;
        case 3: v = b + ((left + up) >> 1); break;
        case 4: v = b + paeth(left, up, upLeft); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      rgb[rowStart + x] = v & 0xff;
    }
  }
  return { width, height, rgb };
}

/// <summary>Hash of the decoded pixel data, independent of the PNG encoding. Matches the
/// .NET GoldenRenderTests.PixelHash: "WxH:" then the RGB rows.</summary>
function pixelHash(pngPath: string): string {
  const { width, height, rgb } = decodePng(fs.readFileSync(pngPath));
  const h = createHash('sha256');
  h.update(Buffer.from(`${width}x${height}:`, 'ascii'));
  h.update(rgb);
  return h.digest('hex');
}

function assertGolden(key: string, actual: string, outDir: string): void {
  const expected = loadGoldens()[key];
  if (expected == null) assert.fail(`no golden for '${key}'; actual hash: ${actual} (render kept in ${outDir})`);
  if (expected !== actual)
    assert.fail(`golden mismatch for '${key}': expected ${expected}, actual ${actual} (render kept in ${outDir})`);
}

test('Golden: RA2 snow map renders golden pixels', { skip: skipRa2 }, () => {
  const outDir = render('mp22s8.map', mixDir!);
  assertGolden('mp22s8-png', pixelHash(path.join(outDir, 'render.png')), outDir);
});

test('Golden: YR urban map renders golden pixels', { skip: skipRa2 }, () => {
  const outDir = render('hillbtwn.map', mixDir!);
  assertGolden('hillbtwn-png', pixelHash(path.join(outDir, 'render.png')), outDir);
});

test('Golden: YR vehicle-heavy map renders golden pixels', { skip: skipRa2 }, () => {
  const outDir = render('austintx.map', mixDir!);
  assertGolden('austintx-png', pixelHash(path.join(outDir, 'render.png')), outDir);
});

test('Golden: squared start-position markers render golden pixels', { skip: skipRa2 }, () => {
  const outDir = render('hillbtwn.map', mixDir!, (s) => {
    s.MarkStartPos = true;
    s.StartPositionMarking = StartPositionMarking.Squared;
  });
  assertGolden('hillbtwn-markers-png', pixelHash(path.join(outDir, 'render.png')), outDir);
});

test('Golden: Tiberian Sun lamp map renders golden pixels', { skip: skipTs }, () => {
  // duel.map places six TSTLAMP alpha light posts; this covers the TS render pipeline and
  // the AlphaImage glow of invisible lamp buildings
  const outDir = render('duel.map', tsMixDir!, (s) => {
    s.Engine = EngineType.TiberianSun;
  });
  assertGolden('duel-png', pixelHash(path.join(outDir, 'render.png')), outDir);
});

test('Golden: repeated in-process renders stay golden', { skip: skipRa2 }, () => {
  // a long-running service worker renders many maps in one process; verify renders are not
  // contaminated by earlier renders (shared caches, statics)
  const first = render('hillbtwn.map', mixDir!);
  assertGolden('hillbtwn-png', pixelHash(path.join(first, 'render.png')), first);
  const other = render('mp22s8.map', mixDir!);
  assertGolden('mp22s8-png', pixelHash(path.join(other, 'render.png')), other);
  const again = render('hillbtwn.map', mixDir!);
  assertGolden('hillbtwn-png', pixelHash(path.join(again, 'render.png')), again);
});

// Data-independent: validates the PNG decode + hash that the golden comparisons rely on, so a
// broken helper fails here rather than hiding behind a skipped golden test.
test('Golden: pixel hash round-trips a written PNG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-ts-png-'));
  const pngPath = path.join(dir, 'x.png');
  // 2x1 surface in BGR memory order: (b3,g2,r1), (b6,g5,r4)
  const surface = Buffer.from([3, 2, 1, 6, 5, 4]);
  PngWriter.save(pngPath, surface, 2, 3, new Rectangle(0, 0, 2, 1), 4);

  const { width, height, rgb } = decodePng(fs.readFileSync(pngPath));
  assert.equal(width, 2);
  assert.equal(height, 1);
  assert.deepEqual([...rgb], [1, 2, 3, 4, 5, 6]);

  const expected = createHash('sha256').update(Buffer.from('2x1:', 'ascii')).update(rgb).digest('hex');
  assert.equal(pixelHash(pngPath), expected);
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { decode as decodeJpeg } from 'jpeg-js';
import { DrawingSurface, SurfaceFormat } from './DrawingSurface.js';

function tempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-writer-'));
  return path.join(dir, name);
}

function makeSurface(width: number, height: number): DrawingSurface {
  const surface = new DrawingSurface(width, height, SurfaceFormat.Bgr24);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      surface.data[i] = (x * 37 + y * 11) & 0xff;      // B
      surface.data[i + 1] = (x * 17 + y * 53) & 0xff;  // G
      surface.data[i + 2] = (x * 91 + y * 7) & 0xff;   // R
    }
  }
  return surface;
}

test('PNG writer round-trips a cropped BGR region byte-exactly', () => {
  const surface = makeSurface(7, 5);
  const file = tempFile('crop.png');
  surface.savePNG(file, 99, 1, 1, 4, 3); // 99 must clamp to 9, not throw
  const png = PNG.sync.read(fs.readFileSync(file));
  assert.equal(png.width, 4);
  assert.equal(png.height, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      const src = ((y + 1) * 7 + (x + 1)) * 3;
      const dst = (y * 4 + x) * 4;
      assert.equal(png.data[dst], surface.data[src + 2], `R at ${x},${y}`);
      assert.equal(png.data[dst + 1], surface.data[src + 1], `G at ${x},${y}`);
      assert.equal(png.data[dst + 2], surface.data[src], `B at ${x},${y}`);
      assert.equal(png.data[dst + 3], 255, `A at ${x},${y}`);
    }
  }
});

test('JPEG writer produces a decodable image with the requested dimensions', () => {
  const surface = makeSurface(16, 12);
  const file = tempFile('full.jpg');
  surface.saveJPEG(file, 999, 0, 0, 16, 12); // quality clamps to 100
  const jpeg = decodeJpeg(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  assert.equal(jpeg.width, 16);
  assert.equal(jpeg.height, 12);
  assert.equal(jpeg.data.length, 16 * 12 * 4);
  // JPEG is lossy; check the flat-ish green channel stays close instead of byte equality.
  for (let i = 0; i < 16 * 12; i++) {
    const src = i * 3;
    assert.ok(Math.abs(jpeg.data[i * 4 + 1] - surface.data[src + 1]) <= 40, `G at pixel ${i}`);
  }
});

test('PNG writer rejects an empty clip', () => {
  const surface = makeSurface(4, 4);
  assert.throws(() => surface.savePNG(tempFile('empty.png'), 4, 10, 10, 2, 2), /empty PNG/);
});

test('JPEG writer rejects an empty clip', () => {
  const surface = makeSurface(4, 4);
  assert.throws(() => surface.saveJPEG(tempFile('empty.jpg'), 90, 10, 10, 2, 2), /empty JPEG/);
});

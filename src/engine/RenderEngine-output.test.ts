import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RenderEngine } from './RenderEngine.js';
import { RenderSettings } from '../shared/RenderSettings.js';
import { Rectangle } from '../shared/Geometry.js';

test('resolveOutputPath uses .jpg only when JPEG is the selected encoder', () => {
  // resolveOutputPath follows the host path separator; compare normalized paths so
  // the test is meaningful on Windows as well.
  const posix = (p: string) => p.replace(/\\/g, '/');
  const jpeg = new RenderSettings();
  jpeg.SaveJPEG = true;
  assert.equal(posix(RenderEngine.resolveOutputPath(jpeg, '/maps/foo.mpr')), '/maps/foo.jpg');
  assert.equal(posix(RenderEngine.resolveOutputPath(jpeg, '/maps/foo.PNG')), '/maps/foo.jpg');

  const png = new RenderSettings();
  png.SavePNG = true;
  png.SaveJPEG = true;
  assert.equal(posix(RenderEngine.resolveOutputPath(png, '/maps/foo.jpg')), '/maps/foo.png');

  const fallback = new RenderSettings();
  assert.equal(posix(RenderEngine.resolveOutputPath(fallback, '/maps/foo.yrm')), '/maps/foo.png');

  const named = new RenderSettings();
  named.OutputFile = '/out/render.jpeg';
  named.SaveJPEG = true;
  assert.equal(posix(RenderEngine.resolveOutputPath(named, '/maps/foo.mpr')), '/out/render.jpg');
});

test('applyOutputFraming crops and centre-fits the requested aspect', () => {
  const base = new Rectangle(0, 0, 100, 80);
  const settings = new RenderSettings();
  settings.CropX = 0.1;
  settings.CropY = 0.1;
  settings.CropWidth = 0.8;
  settings.CropHeight = 0.8;
  const cropped = RenderEngine.applyOutputFraming(base, settings);
  assert.deepEqual({ x: cropped.X, y: cropped.Y, w: cropped.Width, h: cropped.Height }, { x: 10, y: 8, w: 80, h: 64 });

  settings.OutputAspect = '1:1';
  const square = RenderEngine.applyOutputFraming(base, settings);
  assert.equal(square.Width, 64);
  assert.equal(square.Height, 64);
  assert.equal(square.X, 18);
  assert.equal(square.Y, 8);

  settings.OutputAspect = '16:9';
  settings.CropX = 0;
  settings.CropY = 0;
  settings.CropWidth = 1;
  settings.CropHeight = 1;
  const wide = RenderEngine.applyOutputFraming(base, settings);
  assert.equal(wide.Width, 100);
  assert.equal(wide.Height, 56);
  assert.equal(wide.Y, 12);
});

test('applyOutputFraming stays inside the surface for edge crops', () => {
  const settings = new RenderSettings();
  settings.CropX = 1;
  settings.CropY = 1;
  const edge = RenderEngine.applyOutputFraming(new Rectangle(0, 0, 100, 80), settings);
  assert.equal(edge.X, 99);
  assert.equal(edge.Y, 79);
  assert.equal(edge.Width, 1);
  assert.equal(edge.Height, 1);
  const bounded = RenderEngine.applyOutputFraming(new Rectangle(-10, -10, 100, 80), settings);
  assert.equal(bounded.X, 89);
  assert.equal(bounded.Y, 69);
  assert.equal(bounded.Width, 1);
  assert.equal(bounded.Height, 1);
});

test('writeMetadataJson reports output size and scales start pixels', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-meta-'));
  const file = path.join(dir, 'meta.json');
  const mapFile = {
    getSection: () => ({ readString: () => 'Meta Test', readBool: () => false }),
    FullSize: { X: 0, Y: 0, Width: 70, Height: 50 },
    LocalSize: { X: 0, Y: 0, Width: 70, Height: 50 },
    StartCapacity: 4,
  };
  const map = {
    TheaterType: 0,
    TileWidth: 60,
    TileHeight: 30,
    GetStartPositionPixels: () => [{ Number: 1, Rx: 10, Ry: 20, Z: 0, X: 100, Y: 200 }],
  };
  try {
    RenderEngine.writeMetadataJson(
      file,
      'Meta Test',
      mapFile as any,
      map as any,
      new Rectangle(10, 20, 100, 80),
      new Rectangle(0, 0, 50, 40),
      null,
      0 as any,
    );
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(meta.renderedWidth, 50);
    assert.equal(meta.renderedHeight, 40);
    assert.deepEqual(meta.saveRect, { x: 10, y: 20, width: 100, height: 80 });
    assert.deepEqual(meta.startPositionPixels[0].pixel, { x: 45, y: 90 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

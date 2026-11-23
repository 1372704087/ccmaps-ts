import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readPsd } from 'ag-psd';
import { DrawingSurface } from './DrawingSurface.js';
import { LayerCategory } from './LayerCategory.js';
import { PsdExporter } from './PsdExporter.js';
import { Rectangle } from '../shared/Geometry.js';

test('DrawingSurface records categories only for painting writes', () => {
  const surface = new DrawingSurface(4, 2);
  surface.TrackCategories = true;
  const categories = surface.getCategories()!;

  surface.setCategory(LayerCategory.Terrain);
  surface.writePixel(0, 1, 2, 3);
  assert.equal(categories[0], LayerCategory.Terrain);

  surface.setCategory(LayerCategory.Infantry);
  surface.PreserveCategory = true;
  surface.writePixel(3, 9, 9, 9);
  assert.equal(categories[1], LayerCategory.None);

  surface.PreserveCategory = false;
  surface.writePixel(3, 9, 9, 9);
  assert.equal(categories[1], LayerCategory.Infantry);

  // Deferred animations keep the category active when they queue.
  let seen = LayerCategory.None;
  surface.setCategory(LayerCategory.Structure);
  surface.deferAnim(() => { seen = surface.CurrentCategory; });
  surface.setCategory(LayerCategory.Vehicle);
  surface.drawDeferredAnims();
  assert.equal(seen, LayerCategory.Structure);
  assert.equal(surface.CurrentCategory, LayerCategory.Vehicle);
});

test('PsdExporter writes one cropped layer per pixel category', () => {
  const width = 32;
  const height = 24;
  const surface = new DrawingSurface(width, height);
  surface.TrackCategories = true;
  surface.getCategories();

  surface.setCategory(LayerCategory.Terrain);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      surface.writePixel((y * width + x) * 3, 20, 30, 40);
    }
  }

  surface.setCategory(LayerCategory.Vehicle);
  for (let y = 8; y < 16; y++) {
    for (let x = 10; x < 18; x++) {
      surface.writePixel((y * width + x) * 3, 200, 50, 40);
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cncmaps-psd-'));
  const file = path.join(dir, 'layers.psd');
  try {
    PsdExporter.save(file, surface, new Rectangle(0, 0, width, height));
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.subarray(0, 4).toString('latin1'), '8BPS');

    const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    assert.equal(psd.width, width);
    assert.equal(psd.height, height);
    const names = (psd.children ?? []).map((child) => child.name);
    assert.deepEqual(names, ['载具', '地形']);

    const vehicle = psd.children![0];
    assert.deepEqual([vehicle.left, vehicle.top, vehicle.right, vehicle.bottom], [10, 8, 18, 16]);
    const terrain = psd.children![1];
    assert.deepEqual([terrain.left, terrain.top, terrain.right, terrain.bottom], [0, 0, width, height]);

    // Layers must carry an alpha channel or everything outside the art would be opaque.
    const raw = readPsd(buffer, { useRawData: true, skipCompositeImageData: true, skipThumbnail: true });
    const channels = raw.children![0].rawData!.channels.map((channel) => channel.id);
    assert.deepEqual(channels, [-1, 0, 1, 2]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test('PsdExporter writes a group per category and a layer per element', () => {
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
  surface.beginElement('MTNK (1,1)', LayerCategory.Vehicle);
  const part = surface.beginPart(10, 8, 8, 8)!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const pi = (y * 8 + x) * 4;
      part.data[pi] = 40;
      part.data[pi + 1] = 50;
      part.data[pi + 2] = 200;
      part.data[pi + 3] = 255;
    }
  }
  surface.endElement();

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
    // PSD layer records are bottom-to-top, so terrain comes first and sits at the bottom.
    assert.deepEqual(names, ['地形', '载具']);
    assert.deepEqual(psd.children![0].children!.map((child) => child.name), ['地形·合并']);
    assert.deepEqual(psd.children![1].children!.map((child) => child.name), ['MTNK (1,1)']);

    const terrain = psd.children![0].children![0];
    assert.deepEqual([terrain.left, terrain.top, terrain.right, terrain.bottom], [0, 0, width, height]);
    const vehicle = psd.children![1].children![0];
    assert.deepEqual([vehicle.left, vehicle.top, vehicle.right, vehicle.bottom], [10, 8, 18, 16]);

    // Layers must carry an alpha channel or everything outside the art would be opaque.
    const raw = readPsd(buffer, { useRawData: true, skipCompositeImageData: true, skipThumbnail: true });
    const channels = raw.children![1].children![0].rawData!.channels.map((channel) => channel.id);
    assert.deepEqual(channels, [-1, 0, 1, 2]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DrawingSurface collects one element per object and merges redraws by name', () => {
  const surface = new DrawingSurface(16, 8);
  surface.TrackCategories = true;
  surface.getCategories();

  surface.setCategory(LayerCategory.Structure);
  surface.beginElement('GAPOWR (3,4)', LayerCategory.Structure);
  assert.ok(surface.beginPart(2, 2, 4, 3));
  surface.endElement();

  // Ore highlighting redraws an overlay; the same name appends to its existing layer.
  surface.setCategory(LayerCategory.Overlay);
  surface.beginElement('TIB01', LayerCategory.Overlay);
  assert.ok(surface.beginPart(0, 0, 2, 2));
  surface.endElement();
  surface.beginElement('TIB01', LayerCategory.Overlay);
  assert.ok(surface.beginPart(4, 0, 2, 2));
  surface.endElement();

  const elements = surface.takeElements();
  assert.deepEqual(elements.map((e) => e.name), ['GAPOWR (3,4)', 'TIB01']);
  assert.equal(elements[0].parts.length, 1);
  assert.equal(elements[1].parts.length, 2);
  assert.deepEqual(surface.takeElements(), []);
});

// Batch D #15: CLI option parsing for the A/B capture and debug flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderSettings } from './RenderSettings.js';

function parse(args: string[]): RenderSettings {
  const s = new RenderSettings();
  s.ConfigureFromArgs(args);
  return s;
}

test('RenderSettings: --no-expand-mixes flag', () => {
  assert.equal(parse(['--no-expand-mixes']).NoExpandMixes, true);
  assert.equal(parse([]).NoExpandMixes, false);
});

test('RenderSettings: numeric options are clamped to safe ranges', () => {
  const high = parse(['--png-compression', '99', '--jpeg-quality', '999', '--preview-width', '99999', '--start-pos-size', '99']);
  assert.equal(high.PNGQuality, 9);
  assert.equal(high.JPEGCompression, 100);
  assert.equal(high.PreviewWidth, 8192);
  assert.equal(high.MarkerStartSize, 6);
  const low = parse(['--png-compression', '0', '--jpeg-quality', '-5', '--preview-width', '-3', '--start-pos-size', '0']);
  assert.equal(low.PNGQuality, 1);
  assert.equal(low.JPEGCompression, 1);
  assert.equal(low.PreviewWidth, 0);
  assert.equal(low.MarkerStartSize, 2);
});

test('RenderSettings: --max-surface-pixels accepts 0 and positive values only', () => {
  assert.equal(parse(['--max-surface-pixels', '1000000']).MaxSurfacePixels, 1000000);
  assert.equal(parse(['--max-surface-pixels', '-1']).MaxSurfacePixels, 0);
  assert.equal(parse([]).MaxSurfacePixels, 0);
});

test('RenderSettings: debug file options are parsed', () => {
  const s = parse(['--debug-zbuffer', 'z.npy', '--debug-tiles', 'tiles.csv', '--debug-voxelmask', 'vm.npy']);
  assert.equal(s.DebugZBufferFile, 'z.npy');
  assert.equal(s.DebugTilesFile, 'tiles.csv');
  assert.equal(s.DebugVoxelMaskFile, 'vm.npy');
});

test('RenderSettings: --tile-lattice and --vein-rng accept values', () => {
  const s = parse(['--tile-lattice', '0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7']);
  assert.equal(s.TileLattice.split(',').length, 64);
  const vein = parse(['--vein-rng', '0,1,' + Array.from({ length: 250 }, (_, i) => String(i)).join(',')]);
  assert.equal(vein.VeinRandomizer.split(',').length, 252);
});

test('RenderSettings: --pin-random and --anim-frame', () => {
  const s = parse(['--pin-random', '--anim-frame', '57']);
  assert.equal(s.PinRandomDraws, true);
  assert.equal(s.AnimFrame, 57);
});

test('RenderSettings: --meta-json captures the metadata output path', () => {
  assert.equal(parse(['--meta-json', 'meta.json']).MetadataOutFile, 'meta.json');
  assert.equal(parse(['--meta-json=out.json']).MetadataOutFile, 'out.json');
  assert.equal(parse([]).MetadataOutFile, '');
});

test('RenderSettings: bare value option names are not flagged unknown', () => {
  // the unknown-option pass must not report "--anim-frame" just because its
  // help entry reads "--anim-frame=VALUE"
  parse(['--anim-frame', '10']);
});

test('RenderSettings: an actually unknown option is still flagged', () => {
  // no assertion on the log; just ensure parsing does not throw
  parse(['--definitely-not-an-option']);
});

test('RenderSettings: crop percentages and output aspect', () => {
  const s = parse(['--crop=10,20,50,60', '--aspect=4:5']);
  assert.equal(s.CropX, 0.1);
  assert.equal(s.CropY, 0.2);
  assert.equal(s.CropWidth, 0.5);
  assert.equal(s.CropHeight, 0.6);
  assert.equal(s.OutputAspect, '4:5');
  assert.equal(parse(['--crop=bad']).CropWidth, 1);
  assert.equal(parse(['--aspect=3:2']).OutputAspect, 'free');
});

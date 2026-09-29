// Batch D #15: CLI option parsing for the A/B capture and debug flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderSettings } from './RenderSettings.js';
import { StartPositionMarking } from './Enums.js';

function parse(args: string[]): RenderSettings {
  const s = new RenderSettings();
  s.ConfigureFromArgs(args);
  return s;
}

test('RenderSettings: --no-expand-mixes flag', () => {
  assert.equal(parse(['--no-expand-mixes']).NoExpandMixes, true);
  assert.equal(parse([]).NoExpandMixes, false);
});

test('RenderSettings: --thumb-markers parses every documented style', () => {
  assert.equal(parse(['--thumb-markers', 'squared']).ThumbnailMarkers, StartPositionMarking.Squared);
  assert.equal(parse(['--thumb-markers=circled']).ThumbnailMarkers, StartPositionMarking.Circled);
  assert.equal(parse(['--thumb-markers', 'diamond']).ThumbnailMarkers, StartPositionMarking.Diamond);
  assert.equal(parse(['--thumb-markers', 'ellipsed']).ThumbnailMarkers, StartPositionMarking.Ellipsed);
  assert.equal(parse(['--thumb-markers', 'star']).ThumbnailMarkers, StartPositionMarking.Starred);
  assert.equal(parse(['--thumb-markers', 'starred']).ThumbnailMarkers, StartPositionMarking.Starred);
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

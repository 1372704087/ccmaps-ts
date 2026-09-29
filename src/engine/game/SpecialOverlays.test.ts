// Batch C #9: pooled tiberium art selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpecialOverlays } from './SpecialOverlays.js';
import { OverlayObject } from '../map/GameObjects.js';
import { MapTile } from '../map/MapTile.js';
import { EngineType } from '../../shared/Enums.js';

function overlay(id: number, rx: number, ry: number): OverlayObject {
  const o = new OverlayObject(id, 0);
  o.Tile = new MapTile(0, 0, rx, ry);
  return o;
}

test('SpecialOverlays: a flat ore cell indexes the 12-entry pool by (x*y) % 12', () => {
  const o = overlay(102, 5, 3); // product 15 -> 3
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 0), 105);
});

test('SpecialOverlays: a ramped ore cell takes one of the 8 slope pieces after the pool', () => {
  const o = overlay(102, 5, 3); // product 15 -> odd
  // 102 + 12 + (15 % 2) + (ramp-1)*2
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 1), 115);
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 2), 117);
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 4), 121);
});

test('SpecialOverlays: an even cell product flips the slope pick', () => {
  const o = overlay(102, 4, 3); // product 12 -> even
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 1), 114);
});

test('SpecialOverlays: the 12-entry gem pool has no slope pieces, so ramps stay flat', () => {
  const o = overlay(27, 5, 3); // product 15 -> 3
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 1), 30);
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 0), 30);
});

test('SpecialOverlays: a non-tiberium overlay keeps the id the map stored', () => {
  const o = overlay(1, 5, 3);
  assert.equal(SpecialOverlays.GetPooledDrawId(o, EngineType.RedAlert2, 0), 1);
});
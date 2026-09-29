// Minimal test skeleton (batch A #19). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RampHeight } from './RampHeight.js';
import { EngineType } from '../shared/Enums.js';
import type { MapTileLike, ModConfigLike } from '../engine/Types.js';

function config(engine: EngineType): ModConfigLike {
  return { TileWidth: 24, TileHeight: 24, Engine: engine };
}

test('RampHeight: flat and cancelling ramps need no lift', () => {
  const c = config(EngineType.RedAlert2);
  assert.equal(RampHeight.pixelLift(0, 0, c), 0); // flat
  assert.equal(RampHeight.pixelLift(5, 0, c), 0); // opposing corner pair, cancels at centre
  assert.equal(RampHeight.pixelLift(8, 3, c), 0);
});

test('RampHeight: out-of-range ramp types need no lift', () => {
  const c = config(EngineType.RedAlert2);
  assert.equal(RampHeight.pixelLift(-1, 0, c), 0);
  assert.equal(RampHeight.pixelLift(99, 0, c), 0);
});

test('RampHeight: half-level slopes lift by 7/8 px on a 24 px tile', () => {
  // half a level is 52 leptons; on a 24 px RA2 tile that rounds to 3 px, a full level to 6 px
  const c = config(EngineType.RedAlert2);
  assert.equal(RampHeight.pixelLift(1, 0, c), 3); // single-direction slope, half level at centre
  assert.equal(RampHeight.pixelLift(9, 0, c), 6); // raised corner pair, full level at centre
  assert.equal(RampHeight.pixelLift(16, 0, c), 6);
  assert.equal(RampHeight.pixelLift(20, 0, c), 3);
});

test('RampHeight: Tiberian Sun and RA2 agree below the fudge threshold', () => {
  const ra2 = config(EngineType.RedAlert2);
  const ts = config(EngineType.TiberianSun);
  for (let ramp = 0; ramp <= 20; ramp++) {
    assert.equal(RampHeight.pixelLift(ramp, 0, ts), RampHeight.pixelLift(ramp, 0, ra2));
  }
});

test('RampHeight: reads the ramp type from the tile drawable', () => {
  const c = config(EngineType.RedAlert2);
  const tile = {
    Dx: 0,
    Dy: 0,
    Z: 0,
    Rx: 0,
    Ry: 0,
    SubTile: 0,
    Palette: {},
    Layer: {},
    Drawable: { GetTileImage: () => ({ RampType: 9 }) },
  } as unknown as MapTileLike;
  assert.equal(RampHeight.pixelLiftTile(tile, c), 6);
  assert.equal(RampHeight.pixelLiftTile(null, c), 0);
});
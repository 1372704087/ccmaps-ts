// Fixes for the .NET 3.1.0 LAT recalculation:
//  - ramp smoothing pieces are substituted for both RampBase and RampSmooth sets
//  - an off-map neighbour counts as flat, like the game's blank cell
//  - a smooth piece whose flat neighbours are gone reverts to the plain ramp
//  - the drawable is refreshed whenever the set/tile number changes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Operations } from './Operations.js';
import { TileDirection } from './TileLayer.js';

const RAMP_BASE = 100;
const RAMP_SMOOTH = 200;

/** A minimal TileCollection/TileLayer pair exercising the FixTiles control flow. */
function run(rampType: number, setNum: number, neighbours: Partial<Record<TileDirection, number | null>>): {
  tileNum: number;
  drawable: unknown;
} {
  const tile: any = {
    SetNum: 0,
    TileNum: setNum,
    Drawable: null,
    GetTileImage: () => ({ RampType: rampType }),
  };
  const layer: any = {
    GetNeighbourTile: (_t: unknown, dir: TileDirection) => {
      const rt = neighbours[dir];
      if (rt == null) return null;
      return { GetTileImage: () => ({ RampType: rt }) };
    },
    [Symbol.iterator]: function* () {
      yield tile;
    },
  };
  const collection: any = {
    RampBase: RAMP_BASE,
    RampSmooth: RAMP_SMOOTH,
    GetSetNum: (tileNum: number) => tileNum,
    IsCLAT: () => false,
    IsLAT: () => false,
    GetTileNumFromSet: (setNum: number, tileNum = 0) => setNum * 1000 + tileNum,
    GetDrawable: (t: any) => ({ tileNum: t.TileNum }),
  };
  Operations.FixTiles(layer, collection);
  return { tileNum: tile.TileNum, drawable: tile.Drawable };
}

const T = TileDirection;

test('FixTiles: a smooth piece is chosen when one flat neighbour exists', () => {
  const r = run(1, RAMP_BASE, { [T.TopLeft]: 0, [T.BottomRight]: 1 });
  assert.equal(r.tileNum, RAMP_SMOOTH * 1000 + 0); // fixup 0
  assert.deepEqual(r.drawable, { tileNum: r.tileNum });
});

test('FixTiles: the two-flat-neighbour piece is the last smooth variant', () => {
  const r = run(1, RAMP_BASE, { [T.TopLeft]: 0, [T.BottomRight]: 0 });
  assert.equal(r.tileNum, RAMP_SMOOTH * 1000 + 2); // fixup 2 (both flat)
});

test('FixTiles: a smooth piece whose flat neighbours are gone reverts to the plain ramp', () => {
  const r = run(1, RAMP_BASE, { [T.TopLeft]: 1, [T.BottomRight]: 1 });
  assert.equal(r.tileNum, RAMP_BASE * 1000 + 0);
  assert.deepEqual(r.drawable, { tileNum: r.tileNum });
});

test('FixTiles: an off-map neighbour counts as flat', () => {
  const r = run(1, RAMP_BASE, { [T.TopLeft]: null, [T.BottomRight]: 1 });
  assert.equal(r.tileNum, RAMP_SMOOTH * 1000 + 0);
});

test('FixTiles: RampSmooth sets are smoothed too', () => {
  const r = run(2, RAMP_SMOOTH, { [T.TopRight]: 0, [T.BottomLeft]: 1 });
  assert.equal(r.tileNum, RAMP_SMOOTH * 1000 + 3); // (2-1)*3 + 0
});

test('FixTiles: ramps outside 1..4 are left untouched', () => {
  const r = run(5, RAMP_BASE, { [T.TopLeft]: 0, [T.BottomRight]: 0 });
  assert.equal(r.tileNum, RAMP_BASE);
});
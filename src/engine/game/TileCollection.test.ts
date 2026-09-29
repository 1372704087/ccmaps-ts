// Batch C #3: deterministic tile-variant selection.
// Batch C #14: green LAT exemption (RA2+) and the theater ShadowCaster flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileCollection } from './TileCollection.js';
import { IniFile } from '../../formats/IniFile.js';
import { EngineType, TheaterType } from '../../shared/Enums.js';

test('TileCollection: the default 8x8 lattice is (3x + 2y) & 7', () => {
  const l = TileCollection.VariantLattice;
  assert.equal(l.length, 64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) assert.equal(l[x + y * 8], (3 * x + 2 * y) & 7);
});

test('TileCollection: the lattice never repeats a value in an adjacent cell', () => {
  const l = TileCollection.VariantLattice;
  const at = (x: number, y: number) => l[(x & 7) + (y & 7) * 8];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // orthogonally and diagonally adjacent cells differ, seams included (indices wrap at 8)
      assert.notEqual(at(x, y), at(x + 1, y));
      assert.notEqual(at(x, y), at(x, y + 1));
      assert.notEqual(at(x, y), at(x + 1, y + 1));
      assert.notEqual(at(x, y), at(x + 1, y - 1));
    }
  }
});

test('TileCollection: the small-set 4x4 pattern is a Latin square', () => {
  const p = TileCollection.VariantPattern4;
  assert.equal(p.length, 16);
  const expected = [0, 1, 2, 3];
  for (let r = 0; r < 4; r++) {
    const row = p.slice(r * 4, r * 4 + 4).slice().sort();
    assert.deepEqual(row, expected);
    const col = [0, 1, 2, 3].map((c) => p[c * 4 + r]).sort();
    assert.deepEqual(col, expected);
  }
});

test('TileCollection: SetVariantLattice overrides and null restores the default', () => {
  const custom = new Array(64).fill(0).map((_, i) => i & 7);
  TileCollection.SetVariantLattice(custom);
  assert.deepEqual(TileCollection.VariantLattice, custom);
  TileCollection.SetVariantLattice(null);
  assert.deepEqual(TileCollection.VariantLattice, new Array(64).fill(0).map((_, i) => (3 * (i & 7) + 2 * (i >> 3)) & 7));
});

// The green LAT pass only exempts shore and water-bridge neighbours from RA2 on; the TS
// engine's Fixup_LAT has no such exemption and keeps the map's transition pieces there.
function makeTileCollection(engine: EngineType): TileCollection {
  const general = 'GreenTile=1\nShorePieces=2\nWaterBridge=3\nPaveTile=4\nPavedRoads=5\n';
  const ini = new IniFile(new TextEncoder().encode(`[General]\n${general}`));
  const config = { Engine: engine } as any;
  const settings = { Type: TheaterType.None, Extension: '.tem', TheaterIni: '' } as any;
  return new TileCollection(TheaterType.None, config, null as any, null as any, null as any, settings, ini);
}

test('TileCollection: green LAT exemption applies to Red Alert 2 and later', () => {
  const ra2 = makeTileCollection(EngineType.RedAlert2);
  assert.equal(ra2.ConnectTiles(1, 2), false); // green vs shore
  assert.equal(ra2.ConnectTiles(1, 3), false); // green vs water bridge
  assert.equal(ra2.ConnectTiles(1, 4), true); // green vs pave -> CLAT
  assert.equal(ra2.ConnectTiles(4, 5), false); // pave vs paved road
});

test('TileCollection: Tiberian Sun keeps the transition pieces', () => {
  const ts = makeTileCollection(EngineType.Firestorm);
  assert.equal(ts.ConnectTiles(1, 2), true); // green vs shore stays connected
  assert.equal(ts.ConnectTiles(1, 3), true); // green vs water bridge stays connected
  assert.equal(ts.ConnectTiles(4, 5), false); // pave vs paved road still separates
});

test('TileCollection: ShadowCaster is read from the tileset section', () => {
  const theaterIni = new IniFile(
    new TextEncoder().encode(
      '[General]\n' +
        '[TileSet0000]\nFileName=foo\nSetName=Bar\nTilesInSet=1\nShadowCaster=yes\n' +
        '[TileSet0001]\nFileName=baz\nSetName=Qux\nTilesInSet=1\n',
    ),
  );
  const config = { Engine: EngineType.Firestorm } as any;
  const settings = { Type: TheaterType.None, Extension: '.tem', TheaterIni: '' } as any;
  const vfs = { open: () => null } as any;
  const coll = new TileCollection(TheaterType.None, config, vfs, null as any, null as any, settings, theaterIni);
  coll.InitTilesets();
  assert.equal(coll._tileSets[0].ShadowCaster, true);
  assert.equal(coll._tileSets[1].ShadowCaster, false);
});
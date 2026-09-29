// Port of the .NET 3.1.0 vein field rebuild (OverlayClass::Post_Read_Vein_Fixups): every
// veins overlay is cleared, the solid pieces (OverlayData 48 and up) are placed again where
// the terrain allows, and each spreads a connecting piece onto its four cardinal neighbours.
// Fake tiles keep the test off the theater data; a zeroed Random2 state makes every roll 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Operations } from './Operations.js';
import { TileDirection } from './TileLayer.js';
import { OverlayObject } from './GameObjects.js';

const T = TileDirection;
const DELTA: Record<number, [number, number]> = {
  [T.TopRight]: [1, -1],
  [T.BottomRight]: [1, 1],
  [T.BottomLeft]: [-1, 1],
  [T.TopLeft]: [-1, -1],
};

function makeGrid(): {
  addTile: (rx: number, ry: number, terrain?: number, ramp?: number) => any;
  tileAt: (rx: number, ry: number) => any;
} {
  const byRC = new Map<string, any>();
  const layer: any = {
    GetNeighbourTile: (t: any, dir: TileDirection) => {
      const [dx, dy] = DELTA[dir as number];
      return byRC.get(`${t.Rx + dx},${t.Ry + dy}`) ?? null;
    },
  };
  const addTile = (rx: number, ry: number, terrain = 0, ramp = 0): any => {
    const tile: any = {
      Rx: rx,
      Ry: ry,
      Layer: layer,
      AllObjects: [],
      Drawable: { GetTileImage: () => ({ RampType: ramp, TerrainType: terrain }) },
      RemoveObject(o: OverlayObject) {
        const i = this.AllObjects.indexOf(o);
        if (i >= 0) this.AllObjects.splice(i, 1);
      },
      AddObject(o: any) {
        this.AllObjects.push(o);
        o.Tile = this;
      },
    };
    byRC.set(`${rx},${ry}`, tile);
    return tile;
  };
  const tileAt = (rx: number, ry: number): any => byRC.get(`${rx},${ry}`);
  return { addTile, tileAt };
}

function makeVein(tile: any, overlayValue: number): OverlayObject {
  const o = new OverlayObject(46, overlayValue); // 46: the game's VEINS overlay id
  const dr = { IsVeins: true, IsVeinHoleMonster: false, Shp: {} } as any;
  (o as any).Drawable = dr;
  (o as any).BottomTile = tile;
  (o as any).TopTile = tile;
  o.Tile = tile;
  tile.AllObjects.push(o);
  return o;
}

function overlayValue(tile: any): number {
  const ovl = tile.AllObjects.find((a: any) => a instanceof OverlayObject) as OverlayObject | undefined;
  return ovl != null ? ovl.OverlayValue : -1;
}

test('VeinsSpread: a solid piece is placed again and spreads connecting pieces', () => {
  const { addTile, tileAt } = makeGrid();
  for (let rx = 3; rx <= 7; rx++) for (let ry = 3; ry <= 7; ry++) addTile(rx, ry);
  const solid = makeVein(tileAt(5, 5), 48);
  const junk = makeVein(tileAt(4, 5), 6); // a map-made connecting piece
  const ovls = [solid, junk];

  Operations.SetVeinRandomizer([0, 103, ...new Array(250).fill(0)]); // every roll is 0
  Operations.RecalculateVeinsSpread(ovls);

  // the connecting piece is discarded with its cell
  assert.ok(!ovls.includes(junk));
  assert.equal(overlayValue(tileAt(4, 5)), -1);
  // the solid piece sits again at FirstSolid + roll 0
  assert.equal(solid.OverlayValue, 48);
  // each neighbour got 3*frame where only the bit towards the solid piece is set
  assert.equal(ovls.length, 5);
  assert.equal(overlayValue(tileAt(6, 4)), 12); // solid at its bottom-left
  assert.equal(overlayValue(tileAt(6, 6)), 24); // solid at its top-left
  assert.equal(overlayValue(tileAt(4, 6)), 3); // solid at its top-right
  assert.equal(overlayValue(tileAt(4, 4)), 6); // solid at its bottom-right
});

test('VeinsSpread: a ramped neighbour receives a slope piece instead of a connector', () => {
  const { addTile, tileAt } = makeGrid();
  for (let rx = 3; rx <= 7; rx++) for (let ry = 3; ry <= 7; ry++) addTile(rx, ry);
  const solid = makeVein(tileAt(5, 5), 50);
  addTile(6, 4, 0, 3); // the top-right neighbour is ramped (replace the flat tile)
  const ovls: OverlayObject[] = [solid];

  Operations.SetVeinRandomizer([0, 103, ...new Array(250).fill(0)]);
  Operations.RecalculateVeinsSpread(ovls);

  assert.equal(overlayValue(tileAt(6, 4)), 51 + 2 * 3); // FirstRamp + 2*ramp + roll 0
  assert.equal(overlayValue(tileAt(6, 6)), 24);
  assert.equal(overlayValue(tileAt(4, 6)), 3);
  assert.equal(overlayValue(tileAt(4, 4)), 6);
});

test('VeinsSpread: a solid piece the terrain refuses disappears', () => {
  const { addTile, tileAt } = makeGrid();
  addTile(5, 5, 9); // water refuses veins (Can_Place_Veins land type)
  const solid = makeVein(tileAt(5, 5), 48);
  const ovls = [solid];

  Operations.SetVeinRandomizer([0, 103, ...new Array(250).fill(0)]);
  Operations.RecalculateVeinsSpread(ovls);

  assert.equal(ovls.length, 0);
  assert.equal(tileAt(5, 5).AllObjects.length, 0);
});

// Port of CNCMaps.Engine.Map.Operations
import { logger } from '../../shared/Log.js';
import { Rand } from '../../shared/Util.js';
import { EngineType } from '../../shared/Enums.js';
import { TileLayer, TileDirection } from './TileLayer.js';
import { MapTile } from './MapTile.js';
import { OverlayObject } from './GameObjects.js';
import { SpecialOverlays } from '../game/SpecialOverlays.js';
import type { TileCollection } from '../game/TileCollection.js';
import type { ShpDrawable } from '../drawables/ShpDrawable.js';
import type { TileDrawable } from '../drawables/TileDrawable.js';
import type { Drawable } from '../drawables/Drawable.js';

// Random2Class: a 250-entry XOR lagged-Fibonacci table, Index1 and Index2 = Index1 + 103
class VeinRandom2 {
  private readonly table: Int32Array;
  private i1: number;
  private i2: number;

  constructor(state: number[]) {
    this.i1 = state[0] | 0;
    this.i2 = state[1] | 0;
    this.table = new Int32Array(250);
    for (let i = 0; i < 250; i++) this.table[i] = state[i + 2] | 0;
  }

  next(): number {
    this.table[this.i1] ^= this.table[this.i2];
    const val = this.table[this.i1];
    if (++this.i1 >= 250) this.i1 = 0;
    if (++this.i2 >= 250) this.i2 = 0;
    return val;
  }
}

// CellClass::Adjacent_Cell order N, E, S, W; map north is the screen's top right
const VeinCardinal: TileDirection[] = [
  TileDirection.TopRight,
  TileDirection.BottomRight,
  TileDirection.BottomLeft,
  TileDirection.TopLeft,
];

class VeinField {
  static readonly FirstSolid = 48;
  private static readonly FirstRamp = VeinField.FirstSolid + 3;

  private readonly _ovls: OverlayObject[];
  private readonly _id: number;
  private readonly _drawable: Drawable;

  constructor(ovls: OverlayObject[], id: number, drawable: Drawable) {
    this._ovls = ovls;
    this._id = id;
    this._drawable = drawable;
  }

  private static Overlay(t: MapTile | null): OverlayObject | null {
    return (t?.AllObjects.find((a) => a instanceof OverlayObject) as OverlayObject | undefined) ?? null;
  }

  private static Image(t: MapTile | null) {
    if (t == null) return null;
    return (t.Drawable as TileDrawable | null)?.GetTileImage(t) ?? null;
  }

  private static Ramp(t: MapTile | null): number {
    return VeinField.Image(t)?.RampType ?? 0;
  }

  // IsometricTileTypeClass::Land_Type maps the tmp terrain byte to ice (1-4), rock (7, 8, 15),
  // water (9) and beach (10); CellClass::Can_Place_Veins refuses those four land types
  private static LandRefusesVeins(t: MapTile | null): boolean {
    const type = VeinField.Image(t)?.TerrainType ?? 0;
    return (type >= 1 && type <= 4) || type === 7 || type === 8 || type === 9 || type === 10 || type === 15;
  }

  private static IsVeinType(o: OverlayObject | null): boolean {
    return o != null && o.Drawable != null && o.Drawable.IsVeins;
  }

  private IsPlain(o: OverlayObject | null): boolean {
    return o != null && o.Drawable === this._drawable;
  }

  CanPlaceVeins(t: MapTile): boolean {
    if (VeinField.Ramp(t) > 4 || VeinField.LandRefusesVeins(t)) return false;
    const own = VeinField.Overlay(t);
    if (own != null && !VeinField.IsVeinType(own)) return false;
    for (const dir of VeinCardinal) {
      const n = t.Layer != null ? t.Layer.GetNeighbourTile(t, dir) : null;
      if (n == null) continue;
      const ovl = VeinField.Overlay(n);
      if (VeinField.Ramp(n) > 4 && VeinField.Ramp(t) === 0 && !VeinField.IsVeinType(ovl)) return false;
      if (VeinField.LandRefusesVeins(n)) return false;
      if (ovl != null && !VeinField.IsVeinType(ovl)) return false;
    }
    return true;
  }

  PlaceVeins(t: MapTile): void {
    const ramp = VeinField.Ramp(t);
    if (ramp !== 0) {
      this.Set(t, VeinField.FirstRamp + 2 * ramp + Roll2());
      return;
    }
    this.Set(t, VeinField.FirstSolid + Roll3());
    for (const dir of VeinCardinal) {
      const n = t.Layer != null ? t.Layer.GetNeighbourTile(t, dir) : null;
      if (n == null) continue;
      const ovl = VeinField.Overlay(n);
      if (VeinField.IsVeinType(ovl) && (!this.IsPlain(ovl) || ovl!.OverlayValue >= VeinField.FirstSolid)) continue;
      const nRamp = VeinField.Ramp(n);
      if (nRamp !== 0) {
        this.Set(n, VeinField.FirstRamp + 2 * nRamp + Roll2());
        continue;
      }
      const frame = this.VeinFrame(n);
      if (ovl == null || ovl.OverlayValue / 3 !== frame) this.Set(n, 3 * frame + Roll3());
    }
  }

  // CellClass::Get_Vein_Frame: one bit per cardinal neighbour holding a solid or ramp piece
  // or a veinhole cell
  private VeinFrame(t: MapTile): number {
    let frame = 0;
    for (let i = 0; i < VeinCardinal.length; i++) {
      const n = t.Layer != null ? t.Layer.GetNeighbourTile(t, VeinCardinal[i]) : null;
      const ovl = VeinField.Overlay(n);
      if (this.IsPlain(ovl) ? ovl!.OverlayValue >= VeinField.FirstSolid : VeinField.IsVeinType(ovl))
        frame |= 1 << i;
    }
    return frame;
  }

  private Set(t: MapTile, value: number): void {
    let ovl = VeinField.Overlay(t);
    if (ovl == null) {
      ovl = new OverlayObject(this._id, 0);
      ovl.Drawable = this._drawable;
      // unlike the C# base tile walk, nothing backfills these for cells created this late
      ovl.BottomTile = t;
      ovl.TopTile = t;
      t.AddObject(ovl);
      this._ovls.push(ovl);
    }
    ovl.OverlayValue = value;
  }
}

// The engine's abs(RandomNumber()) % 3 and abs(RandomNumber()) & 1.
function Roll3(): number {
  return veinRandom != null ? Math.abs(veinRandom.next()) % 3 : Rand.nextMax(3);
}
function Roll2(): number {
  return veinRandom != null ? Math.abs(veinRandom.next()) & 1 : Rand.nextMax(2);
}

let veinRandom: VeinRandom2 | null = null;

export class Operations {
  /// <summary>The scenario randomizer as the engine entered its vein fixup, from a capture; null
  /// rolls the pieces from the renderer's own generator instead.</summary>
  static SetVeinRandomizer(state: number[] | null): void {
    veinRandom = state == null ? null : new VeinRandom2(state);
  }

  /**
   * Give a tiberium overlay the art the game would draw for its cell.
   * The engine never rewrites the cell's overlay; it picks one of the type's twelve images
   * at draw time from the cell's own coordinates, and one of the eight slope pieces that
   * follow them when the cell ramps. The stored drawable is kept because the shadow still
   * comes from the id the map holds.
   */
  static ApplyTiberiumArt(tile: MapTile, ovl: OverlayObject, engine: EngineType): void {
    if (ovl.Drawable == null || ovl.Collection == null) return;
    const rampType = (tile.Drawable as TileDrawable | null)?.GetTileImage(tile)?.RampType ?? 0;
    const pooled = SpecialOverlays.GetPooledDrawId(ovl, engine, rampType);
    if (pooled === ovl.OverlayID || pooled >= ovl.Collection.DrawableCount) return;
    const pooledDrawable = ovl.Collection.GetDrawable(pooled);
    if (pooledDrawable == null) return;
    ovl.StoredDrawable = ovl.Drawable;
    ovl.Drawable = pooledDrawable;
  }

  // Tiberian Sun rebuilds the vein field when a scenario loads (OverlayClass::Post_Read_Vein_Fixups):
  // every VEINS cell is cleared and only the solid pieces (OverlayData 48 and up, ramp pieces
  // included) are placed again, each spreading a connecting piece onto its four cardinal
  // neighbours. The map's own connecting pieces are discarded, and a solid piece the terrain
  // rejects disappears with them. The engine walks the solid cells in reverse, which only changes
  // which random roll a cell gets.
  static RecalculateVeinsSpread(ovls: OverlayObject[]): void {
    const veins = ovls.filter((o) => {
      const dr = o.Drawable as ShpDrawable | null;
      return Operations.IsVeins(o) && dr != null && !dr.IsVeinHoleMonster && dr.Shp != null;
    });
    if (veins.length === 0) return;
    const field = new VeinField(ovls, veins[0].OverlayID, veins[0].Drawable!);
    // MapClass::Iterate walks screen rows top to bottom, left to right; the fixup takes the
    // solid cells it collected from the last back to the first
    const solid = veins
      .filter((o) => o.OverlayValue >= VeinField.FirstSolid)
      .map((o) => o.Tile!)
      .sort((a, b) => b.Rx + b.Ry - (a.Rx + a.Ry) || b.Rx - a.Rx);
    for (const o of veins) {
      o.Tile!.RemoveObject(o, true);
      ovls.splice(ovls.indexOf(o), 1);
    }
    for (const t of solid) {
      if (field.CanPlaceVeins(t)) field.PlaceVeins(t);
    }
  }

  static IsVeins(o: OverlayObject | null | undefined): boolean {
    return o != null && o.Drawable != null && o.Drawable.IsVeins;
  }

  /// <summary>Recalculates tile system.</summary>
  static FixTiles(tiles: TileLayer, collection: TileCollection): void {
    logger.info('Recalculating tile LAT system');

    // change all CLAT tiles to their corresponding LAT tiles
    for (const t of tiles) {
      // If this tile comes from a CLAT (connecting lat) set,
      // then replace its set and tilenr by corresponding LAT sets'
      t.SetNum = collection.GetSetNum(t.TileNum);

      if (collection.IsCLAT(t.SetNum)) {
        t.SetNum = collection.GetLAT(t.SetNum);
        t.TileNum = collection.GetTileNumFromSet(t.SetNum);
        // the drawable was picked from the map's tile before this pass; a cell the
        // autolat below leaves plain would otherwise keep drawing the CLAT art
        t.Drawable = collection.GetDrawable(t);
      }
    }

    // apply autolat
    for (const t of tiles) {
      // If this tile is a LAT tile, we might have to connect it
      if (collection.IsLAT(t.SetNum)) {
        // Which tile to use from CLAT tileset
        let transitionTile = 0;
        const tileTopRight = tiles.GetNeighbourTile(t, TileDirection.TopRight);
        const tileBottomRight = tiles.GetNeighbourTile(t, TileDirection.BottomRight);
        const tileBottomLeft = tiles.GetNeighbourTile(t, TileDirection.BottomLeft);
        const tileTopLeft = tiles.GetNeighbourTile(t, TileDirection.TopLeft);

        // Find out setnums of adjacent cells
        if (tileTopRight != null && collection.ConnectTiles(t.SetNum, tileTopRight.SetNum)) transitionTile += 1;
        if (tileBottomRight != null && collection.ConnectTiles(t.SetNum, tileBottomRight.SetNum)) transitionTile += 2;
        if (tileBottomLeft != null && collection.ConnectTiles(t.SetNum, tileBottomLeft.SetNum)) transitionTile += 4;
        if (tileTopLeft != null && collection.ConnectTiles(t.SetNum, tileTopLeft.SetNum)) transitionTile += 8;

        // Crystal LAT tile connects to specific tiles in CrystalCliff
        if (collection.IsCrystalLAT(t.SetNum)) {
          if (
            tileTopRight != null &&
            collection.IsCrystalCliff(tileTopRight.SetNum) &&
            tileTopRight.TileNum === collection.GetTileNumFromSet(tileTopRight.SetNum, 1)
          )
            transitionTile = 0;
          if (
            tileBottomRight != null &&
            collection.IsCrystalCliff(tileBottomRight.SetNum) &&
            tileBottomRight.TileNum === collection.GetTileNumFromSet(tileBottomRight.SetNum, 4)
          )
            transitionTile = 0;
          if (
            tileBottomLeft != null &&
            collection.IsCrystalCliff(tileBottomLeft.SetNum) &&
            tileBottomLeft.TileNum === collection.GetTileNumFromSet(tileBottomLeft.SetNum, 0)
          )
            transitionTile = 0;
          if (
            tileTopLeft != null &&
            collection.IsCrystalCliff(tileTopLeft.SetNum) &&
            tileTopLeft.TileNum === collection.GetTileNumFromSet(tileTopLeft.SetNum, 5)
          )
            transitionTile = 0;
        }

        // Swamp has TilesInSet=9 instead of 1 for LAT tilesets
        // which doubles as a normal set for remaining tiles.
        if (collection.IsSwampLAT(t.SetNum) && t.TileNum > collection.GetTileNumFromSet(t.SetNum, 0))
          transitionTile = 0;

        if (transitionTile > 0) {
          // Find Tileset that contains the connecting pieces
          const clatSet = collection.GetCLATSet(t.SetNum);
          // Do not change this setnum, as then we could recognize it as
          // a different tileset for later tiles around this one.
          // (t.SetNum = clatSet;)
          t.TileNum = collection.GetTileNumFromSet(clatSet, transitionTile);
          t.Drawable = collection.GetDrawable(t);
        }
      }
      // apply ramp fixup
      else if (t.SetNum === collection.RampBase || t.SetNum === collection.RampSmooth) {
        const ti = t.GetTileImage();
        if (ti == null || ti.RampType < 1 || 4 < ti.RampType) continue;

        // an off-map neighbour counts as flat, like the game's blank cell
        const flatAt = (dir: TileDirection): boolean => {
          const n = tiles.GetNeighbourTile(t, dir);
          return (n?.GetTileImage()?.RampType ?? 0) === 0;
        };

        let fixup = -1;
        switch (ti.RampType) {
          case 1:
            // northwest facing
            if (flatAt(TileDirection.TopLeft)) fixup++;
            if (flatAt(TileDirection.BottomRight)) fixup += 2;
            break;
          case 2: // northeast facing
            if (flatAt(TileDirection.TopRight)) fixup++;
            if (flatAt(TileDirection.BottomLeft)) fixup += 2;
            break;
          case 3: // southeast facing
            if (flatAt(TileDirection.BottomRight)) fixup++;
            if (flatAt(TileDirection.TopLeft)) fixup += 2;
            break;
          case 4: // southwest facing
            if (flatAt(TileDirection.BottomLeft)) fixup++;
            if (flatAt(TileDirection.TopRight)) fixup += 2;
            break;
        }

        t.TileNum =
          fixup !== -1
            ? collection.GetTileNumFromSet(collection.RampSmooth, (ti.RampType - 1) * 3 + fixup)
            : collection.GetTileNumFromSet(collection.RampBase, ti.RampType - 1);
        // update drawable too: a smooth piece whose flat neighbours are gone reverts to the plain ramp
        t.Drawable = collection.GetDrawable(t);
      }
    }
  }
}

export type { TileDirection };
// Port of CNCMaps.Engine.Map.Operations
import { logger } from '../../shared/Log.js';
import { Rand } from '../../shared/Util.js';
import { EngineType, OverlayTibType } from '../../shared/Enums.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { TileLayer, TileDirection } from './TileLayer.js';
import { MapTile } from './MapTile.js';
import { OverlayObject } from './GameObjects.js';
import { SpecialOverlays } from '../game/SpecialOverlays.js';
import type { TileCollection } from '../game/TileCollection.js';
import type { ShpDrawable } from '../drawables/ShpDrawable.js';
import type { TileDrawable } from '../drawables/TileDrawable.js';

export class Operations {
  static RecalculateOreSpread(ovls: Iterable<OverlayObject>, engine: EngineType): void {
    logger.info('Redistributing ore-spread over patches');

    for (const o of ovls) {
      // The value consists of the sum of all dx's with a little magic offsets
      // plus the sum of all dy's with also a little magic offset, and also
      // everything is calculated modulo 12
      const type = SpecialOverlays.GetOverlayTibType(o, engine);

      if (type === OverlayTibType.Ore) {
        const x = o.Tile != null ? o.Tile.Dx : 0;
        const y = o.Tile != null ? o.Tile.Dy : 0;
        const yInc = ((((y - 9) / 2) % 12) * (((y - 8) / 2) % 12)) % 12;
        const xInc = ((((x - 13) / 2) % 12) * (((x - 12) / 2) % 12)) % 12;

        // x_inc may be > y_inc so adding a big number outside of cell bounds
        // will surely keep num positive
        const num = ((yInc - xInc + 120000) | 0) % 12;

        if (engine <= EngineType.RedAlert2)
          o.OverlayID = SpecialOverlays.Ra2MinIdRiparius + num;
        else o.OverlayID = SpecialOverlays.TsMinIdRiparius + num;
      } else if (type === OverlayTibType.Gems) {
        const x = o.Tile != null ? o.Tile.Dx : 0;
        const y = o.Tile != null ? o.Tile.Dy : 0;
        const yInc = ((((y - 9) / 2) % 12) * (((y - 8) / 2) % 12)) % 12;
        const xInc = ((((x - 13) / 2) % 12) * (((x - 12) / 2) % 12)) % 12;

        const num = ((yInc - xInc + 120000) | 0) % 12;

        if (engine <= EngineType.RedAlert2)
          o.OverlayID = SpecialOverlays.Ra2MinIdCruentus + num;
        else o.OverlayID = SpecialOverlays.TsMinIdCruentus + num;
      } else if (type === OverlayTibType.Vinifera) {
        const x = o.Tile != null ? o.Tile.Dx : 0;
        const y = o.Tile != null ? o.Tile.Dy : 0;
        const yInc = ((((y - 9) / 2) % 12) * (((y - 8) / 2) % 12)) % 12;
        const xInc = ((((x - 13) / 2) % 12) * (((x - 12) / 2) % 12)) % 12;

        const num = ((yInc - xInc + 120000) | 0) % 12;

        if (engine <= EngineType.RedAlert2)
          o.OverlayID = SpecialOverlays.Ra2MinIdVinifera + num;
        else o.OverlayID = SpecialOverlays.TsMinIdVinifera + num;
      } else if (type === OverlayTibType.Aboreus) {
        const x = o.Tile != null ? o.Tile.Dx : 0;
        const y = o.Tile != null ? o.Tile.Dy : 0;
        const yInc = ((((y - 9) / 2) % 12) * (((y - 8) / 2) % 12)) % 12;
        const xInc = ((((x - 13) / 2) % 12) * (((x - 12) / 2) % 12)) % 12;

        const num = ((yInc - xInc + 120000) | 0) % 12;

        if (engine <= EngineType.RedAlert2)
          o.OverlayID = SpecialOverlays.Ra2MinIdAboreus + num;
        else o.OverlayID = SpecialOverlays.TsMinIdAboreus + num;
      }
    }
  }

  static RecalculateVeinsSpread(ovls: Iterable<OverlayObject>, tiles: TileLayer): void {
    let anyVeins: OverlayObject | null = null;

    // VEINHOLEDUMMY marks the cells covered by a veinhole monster; the game renders
    // them as fully grown veins (its rules entry has IsVeins=true but points to a
    // nonexistent image), so give these overlays the real veins drawable.
    let veinsDrawable: ShpDrawable | null = null;
    for (const o of ovls) {
      const dr = o.Drawable as ShpDrawable | null;
      if (Operations.IsVeins(o) && dr != null && !dr.IsVeinHoleMonster && dr.Shp != null) {
        veinsDrawable = dr;
        break;
      }
    }
    if (veinsDrawable != null) {
      for (const o of ovls) {
        const dr = o.Drawable as ShpDrawable | null;
        if (Operations.IsVeins(o) && dr != null && !dr.IsVeinHoleMonster && dr.Shp === null)
          o.Drawable = veinsDrawable;
      }
    }

    for (const o of ovls) {
      const dr = o.Drawable as ShpDrawable | null;
      if (Operations.IsVeins(o) && dr != null && !dr.IsVeinHoleMonster && o.OverlayValue / 3 === 15)
        o.IsGeneratedVeins = true;
    }

    for (const t of tiles) {
      let o = t.AllObjects.find((a) => a instanceof OverlayObject) as OverlayObject | undefined;

      let veins = 0;
      let rnd = 0;
      let mul = 1;
      const amIVeins = Operations.IsVeins(o);

      if (amIVeins && o != null && o.Drawable != null && !(o.Drawable as ShpDrawable).IsVeinHoleMonster) {
        // see if veins are positioned on ramp
        anyVeins = o;
        const tmpImg = (t.Drawable as TileDrawable | null)?.GetTileImage(t) ?? null;
        if (tmpImg != null && tmpImg.RampType !== 0) {
          if (tmpImg.RampType === 7) veins = 51;
          else if (tmpImg.RampType === 2) veins = 55;
          else if (tmpImg.RampType === 3) veins = 57;
          else if (tmpImg.RampType === 4) veins = 59;
          else {
            continue;
          }
          rnd = 2;
          mul = 1;
        } else {
          const ne = t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.TopRight) : null;
          const se = t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.BottomRight) : null;
          const sw = t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.BottomLeft) : null;
          const nw = t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.TopLeft) : null;

          const neV = ne != null && ne.AllObjects.some((a) => a instanceof OverlayObject && Operations.IsVeins(a));
          const seV = se != null && se.AllObjects.some((a) => a instanceof OverlayObject && Operations.IsVeins(a));
          const swV = sw != null && sw.AllObjects.some((a) => a instanceof OverlayObject && Operations.IsVeins(a));
          const nwV = nw != null && nw.AllObjects.some((a) => a instanceof OverlayObject && Operations.IsVeins(a));

          const numNeighbours = Operations.CountNeighbouringVeins4(ne, se, sw, nw, Operations.IsVeins);
          const threshold = numNeighbours !== 4 ? 4 : 0;
          const compare = numNeighbours === 4 ? Operations.IsFullVeins : Operations.IsVeins;
          const thresholdCompare = (ov: OverlayObject): boolean =>
            threshold <= Operations.CountNeighbouringVeins(ov.Tile, compare);

          if (neV && ne != null && ne.AllObjects.some((a) => a instanceof OverlayObject && thresholdCompare(a)))
            veins += 1;

          if (seV && se != null && se.AllObjects.some((a) => a instanceof OverlayObject && thresholdCompare(a)))
            veins += 2;

          if (swV && sw != null && sw.AllObjects.some((a) => a instanceof OverlayObject && thresholdCompare(a)))
            veins += 4;

          if (nwV && nw != null && nw.AllObjects.some((a) => a instanceof OverlayObject && thresholdCompare(a)))
            veins += 8;

          if (veins === 15 && o != null && !o.IsGeneratedVeins) veins++;

          mul = 3;
          rnd = 3;
        }
      }

      if (veins !== 0 || amIVeins) {
        if (o == null) {
          // on the fly veins creation..
          if (anyVeins == null) continue;
          o = new OverlayObject(anyVeins.OverlayID, Rand.nextMax(3));
          o.IsGeneratedVeins = true;
          o.Drawable = anyVeins.Drawable;
          o.Palette = anyVeins.Palette;
          o.BottomTile = t;
          o.TopTile = t;
          t.AddObject(o);
        } else {
          o.OverlayValue = (veins * mul + Rand.nextMax(rnd)) & 0xff;
        }
      }
    }
  }

  static IsVeins(o: OverlayObject | null | undefined): boolean {
    return o != null && o.Drawable != null && o.Drawable.IsVeins;
  }

  static IsFullVeins(o: OverlayObject | null | undefined): boolean {
    return (
      o != null &&
      !o.IsGeneratedVeins &&
      o.Drawable != null &&
      o.Drawable.IsVeins &&
      (o.Drawable.IsVeinHoleMonster || o.OverlayValue / 3 === 16)
    );
  }

  static CountNeighbouringVeins(
    t: MapTile | null,
    test: (tile: OverlayObject) => boolean,
  ): number {
    const ne = t != null && t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.TopRight) : null;
    const se = t != null && t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.BottomRight) : null;
    const sw = t != null && t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.BottomLeft) : null;
    const nw = t != null && t.Layer != null ? t.Layer.GetNeighbourTile(t, TileDirection.TopLeft) : null;
    return Operations.CountNeighbouringVeins4(ne, se, sw, nw, test);
  }

  private static CountNeighbouringVeins4(
    ne: MapTile | null,
    se: MapTile | null,
    sw: MapTile | null,
    nw: MapTile | null,
    test: (tile: OverlayObject) => boolean,
  ): number {
    const neV = ne != null && ne.AllObjects.some((a) => a instanceof OverlayObject && test(a));
    const seV = se != null && se.AllObjects.some((a) => a instanceof OverlayObject && test(a));
    const swV = sw != null && sw.AllObjects.some((a) => a instanceof OverlayObject && test(a));
    const nwV = nw != null && nw.AllObjects.some((a) => a instanceof OverlayObject && test(a));
    return (neV ? 1 : 0) + (seV ? 1 : 0) + (swV ? 1 : 0) + (nwV ? 1 : 0);
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
      else if (t.SetNum === collection.RampBase) {
        const ti = t.GetTileImage();
        if (ti == null || ti.RampType < 1 || 4 < ti.TerrainType) continue;

        let fixup = -1;
        const tileTopRight = tiles.GetNeighbourTile(t, TileDirection.TopRight);
        const tileBottomRight = tiles.GetNeighbourTile(t, TileDirection.BottomRight);
        const tileBottomLeft = tiles.GetNeighbourTile(t, TileDirection.BottomLeft);
        const tileTopLeft = tiles.GetNeighbourTile(t, TileDirection.TopLeft);

        switch (ti.RampType) {
          case 1:
            // northwest facing
            if (tileTopLeft != null && tileTopLeft.GetTileImage()?.RampType === 0) fixup++;
            if (tileBottomRight != null && tileBottomRight.GetTileImage()?.RampType === 0) fixup += 2;
            break;
          case 2: // northeast facing
            if (tileTopRight != null && tileTopRight.GetTileImage()?.RampType === 0) fixup++;
            if (tileBottomLeft != null && tileBottomLeft.GetTileImage()?.RampType === 0) fixup += 2;
            break;
          case 3: // southeast facing
            if (tileBottomRight != null && tileBottomRight.GetTileImage()?.RampType === 0) fixup++;
            if (tileTopLeft != null && tileTopLeft.GetTileImage()?.RampType === 0) fixup += 2;
            break;
          case 4: // southwest facing
            if (tileBottomLeft != null && tileBottomLeft.GetTileImage()?.RampType === 0) fixup++;
            if (tileTopRight != null && tileTopRight.GetTileImage()?.RampType === 0) fixup += 2;
            break;
        }

        if (fixup !== -1) {
          t.TileNum = collection.GetTileNumFromSet(collection.RampSmooth, (ti.RampType - 1) * 3 + fixup);
          // update drawable too
          t.Drawable = collection.GetDrawable(t);
        }
      }
    }
  }
}

export type { TileDirection };
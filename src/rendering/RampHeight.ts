// Port of CNCMaps.Engine.Rendering.RampHeight
//
// Ground height inside a sloped cell.
//
// A ramp cell slopes across its own width, so its stored height only describes one corner.
// Anything standing on it sits on the slope, and the game samples the surface at the object's
// own position (CellClass::Get_Height). Objects are drawn from the centre of their cell, so the
// table below is the game's ramp control table evaluated there: the x and y terms each
// contribute half a level at the centre, leaving base + extra + (xchange + ychange) * level/2,
// clamped to the ramp's maximum.
//
// Tiles and overlays step by a whole pixel level per height (CellClass::Draw_It uses
// LEVEL_PIXEL_H * Height), but an object's lift comes from its lepton height through
// Z_Lepton_To_Pixel. The two only agree because of that routine's fudge term, and a half level
// rounds either side of the .5 boundary depending on the cell's own height: in RA2/YR a half
// level is 7 px up to height 6 and from 14, but 8 px between. TS never crosses the boundary.
import { EngineType } from '../shared/Enums.js';
import type { MapTileLike, ModConfigLike, TileDrawableLike } from '../engine/Types.js';

// One height level in leptons: (int)(tan(30 deg) * cell diagonal / 2).
const LevelLeptons = 104;

// Height above the cell's own level at the cell centre, in half-levels: 0, 1 or 2.
// Index is the tile's RampType; ramps 5-8 cancel out and need no lift at all.
const HalfLevelsAtCentre: readonly number[] = [
  0, // 0  flat
  1, 1, 1, 1, // 1-4   single-direction slopes
  0, 0, 0, 0, // 5-8   opposing corner pairs, which cancel at the centre
  2, 2, 2, 2, // 9-12  raised corner pairs
  2, 2, 2, 2, // 13-16 double-height variants, still one level at the centre
  1, 1, 1, 1, // 17-20 the flat-topped halves
];

export class RampHeight {
  /** Pixels to lift an object standing on this tile, above the tile's own height. */
  static pixelLiftTile(tile: MapTileLike | null, config: ModConfigLike): number {
    if (tile == null) return 0;
    const dr = tile.Drawable as TileDrawableLike | null;
    const ramp = dr != null ? (dr.GetTileImage(tile)?.RampType ?? 0) : 0;
    return RampHeight.pixelLift(ramp, tile.Z, config);
  }

  static pixelLift(rampType: number, cellHeight: number, config: ModConfigLike): number {
    if (rampType <= 0 || rampType >= HalfLevelsAtCentre.length) return 0;
    const half = HalfLevelsAtCentre[rampType];
    if (half === 0) return 0;
    const ground = LevelLeptons * cellHeight;
    return (
      RampHeight.zPixel(ground + half * Math.trunc(LevelLeptons / 2), config) -
      RampHeight.zPixel(ground, config)
    );
  }

  /** Vertical pixel lift of a height in leptons (Tactical::Z_Lepton_To_Pixel). */
  private static zPixel(leptons: number, config: ModConfigLike): number {
    const perLepton = (Math.sin(Math.PI / 3) * config.TileWidth) / (256.0 * Math.sqrt(2.0));
    // the game nudges tall heights up by a pixel so that whole levels keep landing on
    // the tile grid; the threshold is 7 levels in RA2/YR and 9 in TS
    const fudgeAbove =
      config.Engine === EngineType.TiberianSun || config.Engine === EngineType.Firestorm
        ? 9 * LevelLeptons
        : 7 * LevelLeptons;
    const fudge = leptons >= fudgeAbove ? 1 : 0;
    return Math.trunc(leptons * perLepton + fudge + 0.5);
  }
}
// Port of CNCMaps.Engine.Game.DrawProperties
import { Point } from '../../shared/Geometry.js';
import { Palette } from '../../rendering/Palette.js';
import { EngineType, LightingType, PaletteType } from '../../shared/Enums.js';
import { GameObjectLike, InfantryObjectLike, ModConfigLike, OverlayObjectLike } from '../Types.js';

export enum DrawFrame {
  DirectionBased = -1,
  Random = -2,
}

export class DrawProperties {
  HasShadow = false;
  Cloakable = false;
  PaletteType: PaletteType = PaletteType.Default;
  LightingType: LightingType = LightingType.Default;
  CustomPaletteName = '';
  PaletteOverride: Palette | null = null; // if palettetype should be ignored
  ZShapePointMove = new Point(0, 0);

  FrameDecider: ((obj: GameObjectLike) => number) | null = null;
  OffsetHack: ((obj: GameObjectLike) => Point) | null = null; // used to reposition bridges based on their overlay value
  ShadowOffsetHack: ((obj: GameObjectLike) => Point) | null = null;
  Offset = new Point(0, 0);
  ShadowOffset = new Point(0, 0);
  SortIndex = 0;
  TurretVoxelOffset = 0;
  FlightHeight = 0; // pixels above the ground plane; body only, shadow stays grounded
  ZAdjust = 0;

  GetOffset(obj: GameObjectLike): Point {
    const ret = this.Offset.Clone();
    if (this.OffsetHack != null) {
      const hack = this.OffsetHack(obj);
      ret.Offset(hack.X, hack.Y);
    }
    return ret;
  }

  GetShadowOffset(obj: GameObjectLike): Point {
    const ret = this.Offset.Clone();
    if (this.ShadowOffsetHack != null) {
      const hack = this.ShadowOffsetHack(obj);
      ret.Offset(hack.X, hack.Y);
    }
    return ret;
  }

  Clone(): DrawProperties {
    // shallow copy like MemberwiseClone
    const p = new DrawProperties();
    p.HasShadow = this.HasShadow;
    p.Cloakable = this.Cloakable;
    p.PaletteType = this.PaletteType;
    p.LightingType = this.LightingType;
    p.CustomPaletteName = this.CustomPaletteName;
    p.PaletteOverride = this.PaletteOverride;
    p.ZShapePointMove = this.ZShapePointMove;
    p.FrameDecider = this.FrameDecider;
    p.OffsetHack = this.OffsetHack;
    p.ShadowOffsetHack = this.ShadowOffsetHack;
    p.Offset = this.Offset;
    p.ShadowOffset = this.ShadowOffset;
    p.SortIndex = this.SortIndex;
    p.TurretVoxelOffset = this.TurretVoxelOffset;
    p.FlightHeight = this.FlightHeight;
    p.ZAdjust = this.ZAdjust;
    return p;
  }
}

export class OffsetHacks {
  // An [Infantry] entry's sub-cell picks one of the engine's StoppingCoordAbs spots, a quarter
  // cell (64 leptons) off the cell centre. gamemd draws 0 and 1 at the centre, 2 up-right, 3
  // down-left and 4 down; TS keeps the five-spot table with 1 up-left (OpenTS const.cpp).
  static InfantrySubCell(config: ModConfigLike): (obj: GameObjectLike) => Point {
    return (obj: GameObjectLike): Point => {
      let lx = 0;
      let ly = 0;
      switch ((obj as InfantryObjectLike).SubCell ?? 0) {
        case 1:
          if (config.Engine <= EngineType.Firestorm) {
            lx = -64;
            ly = -64;
          }
          break;
        case 2:
          lx = 64;
          ly = -64;
          break;
        case 3:
          lx = -64;
          ly = 64;
          break;
        case 4:
          lx = 64;
          ly = 64;
          break;
      }
      return new Point((((lx - ly) * config.TileWidth) / 512) | 0, (((lx + ly) * config.TileHeight) / 512) | 0);
    };
  }

  static RA2BridgeOffsets(obj: GameObjectLike): Point {
    const bridgeOvl = obj as OverlayObjectLike;
    if (bridgeOvl.OverlayValue <= 8) return new Point(0, -1);
    else return new Point(0, -16);
  }

  static RA2BridgeShadowOffsets(obj: GameObjectLike): Point {
    const bridgeOvl = obj as OverlayObjectLike;
    if (bridgeOvl.OverlayValue <= 8) return new Point(0, -1);
    else return new Point(-15, -9);
  }

  static TSBridgeOffsets(obj: GameObjectLike): Point {
    const bridgeOvl = obj as OverlayObjectLike;
    if (bridgeOvl.OverlayValue <= 8) return new Point(0, -1);
    else return new Point(0, -13);
  }

  static TSBridgeShadowOffsets(obj: GameObjectLike): Point {
    const bridgeOvl = obj as OverlayObjectLike;
    if (bridgeOvl.OverlayValue <= 8) return new Point(0, -1);
    else return new Point(-15, -9);
  }
}

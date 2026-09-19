// Port of CNCMaps.Engine.Game.FrameDeciders
import { EngineType } from '../../shared/Enums.js';
import { Rand } from '../../shared/Util.js';
import { DrawFrame } from './DrawProperties.js';
import type { GameObject, OwnableObject } from '../map/GameObjects.js';
import { OverlayObject } from '../map/GameObjects.js';
import type { ShpFile } from '../../formats/ShpFile.js';

export class FrameDeciders {
  /// Building turrets
  static TurretFrameDecider = (obj: GameObject): number => {
    const direction = obj instanceof Object && isOwnableLike(obj) ? (obj as OwnableObject).Direction : 0;
    switch (direction) {
      case 0: return 28;
      case 32: return 24;
      case 64: return 20;
      case 96: return 16;
      case 128: return 12;
      case 160: return 8;
      case 192: return 4;
      default: return 0;
    }
  };

  /// Use this for non-animated building parts that show frame 0 for healthy and frame 1 for damaged buildings
  static HealthBasedFrameDecider = (obj: GameObject): number => {
    const health = isOwnableLike(obj) ? (obj as OwnableObject).Health : 255;
    if (health >= 128) return 0;
    else return 1;
  };

  /// For non-animated building parts that show frame 0/1 based on ConditionYellow/ConditionRed values
  static BaseBuildingFrameDecider(isDamaged: boolean): (obj: GameObject) => number {
    return () => (isDamaged ? 1 : 0);
  }

  /// For RA2/YR buildings with rubble and health set to 0 in maps.
  static BuildingRubbleFrameDecider(totalFrames: number): (obj: GameObject) => number {
    return () => {
      let frameNum = 0;
      if (totalFrames >= 8) frameNum = totalFrames / 2 - 1;
      return frameNum;
    };
  }

  /// Use this for animations that have a loopstart and loopend
  static LoopFrameDecider(loopstart: number, loopend: number): (obj: GameObject) => number {
    return () => {
      // loopstart > loopend is possible
      return Math.min(loopstart, loopend) + Rand.nextMax(Math.abs(loopend - loopstart));
    };
  }

  static RandomFrameDecider = (): number => {
    return DrawFrame.Random as number;
  };

  static DirectionBasedFrameDecider = (obj: GameObject): number => {
    const direction = isOwnableLike(obj) ? obj.Direction : 0;
    return direction / 32;
  };

  static OverlayValueFrameDecider = (obj: GameObject): number => {
    if (obj instanceof OverlayObject) return obj.OverlayValue;
    else return 0;
  };

  /// Parses a mod config FrameDeciderCode expression. Only its linear form
  /// "frame = (obj as OwnableObject).Direction * a / b + c" is supported, with each term optional.
  static TryParseFrameDeciderCode(code: string): ((obj: GameObject) => number) | null {
    if (code == null || code.trim() === '') return null;
    const m = code
      .trim()
      .match(
        /^frame\s*=\s*\(\s*obj\s+as\s+OwnableObject\s*\)\s*\.\s*Direction(?:\s*\*\s*(\d+))?(?:\s*\/\s*(\d+))?(?:\s*\+\s*(\d+))?\s*;?$/,
      );
    if (m == null) return null;
    const mul = m[1] != null ? parseInt(m[1], 10) : 1;
    const div = m[2] != null ? parseInt(m[2], 10) : 1;
    const add = m[3] != null ? parseInt(m[3], 10) : 0;
    if (div === 0) return null;
    return (obj) => {
      const direction = isOwnableLike(obj) ? obj.Direction : 0;
      return ((((direction * mul) / div) | 0) + add);
    };
  }

  static NullFrameDecider = (): number => 0;

  static AlphaImageFrameDecider(shp: ShpFile): (obj: GameObject) => number {
    return (obj) => {
      let direction = 0;
      if (isOwnableLike(obj)) direction = (obj as OwnableObject).Direction;
      shp.Initialize();
      const imgCount = shp.NumImages;
      if (imgCount % 8 === 0) return (imgCount / 8) * (direction / 32);
      else return 0;
    };
  }

  // SHP vehicles and infantry behave differently, so they require different frame decider logic.
  static SHPVehicleFrameDecider(
    StartStandFrame: number,
    StandingFrames: number,
    StartWalkFrame: number,
    WalkFrames: number,
    Facings: number,
    engine: EngineType,
  ): (obj: GameObject) => number {
    return (obj) => {
      let direction = 0;
      let frameoffset = 0;
      let framenumber = 0;

      if (isOwnableLike(obj)) direction = (obj as OwnableObject).Direction;

      if (Facings === 8) {
        frameoffset = direction / 32 + 1;
        if (frameoffset >= 8) frameoffset -= 8;
      }

      if (Facings === 32) {
        if (engine < EngineType.RedAlert2) {
          frameoffset = direction / 8 + 1;
          if (frameoffset >= 32) frameoffset -= 32;
        } else {
          frameoffset = direction / 8 + 5;
          if (frameoffset >= 32) frameoffset -= 32;
        }
      }
      if (StandingFrames === 0 && StartStandFrame === 0 && WalkFrames > 0)
        framenumber = StartWalkFrame + frameoffset * WalkFrames;
      else if (StandingFrames === 0 && StartStandFrame === 0 && WalkFrames === 0)
        framenumber = StartWalkFrame + frameoffset;
      else if (StandingFrames === 0 && StartStandFrame > 0)
        framenumber = StartStandFrame + frameoffset;
      else framenumber = StartStandFrame + frameoffset * StandingFrames;

      return framenumber;
    };
  }

  static SHPVehicleSHPTurretFrameDecider(
    StartWalkFrame: number,
    WalkFrames: number,
    Facings: number,
  ): (obj: GameObject) => number {
    return (obj) => {
      let direction = 0;
      let frameoffset = 0;
      let framenumber = 0;

      if (isOwnableLike(obj)) direction = (obj as OwnableObject).Direction;

      frameoffset = direction / 8 + 4;
      if (frameoffset >= 32) frameoffset -= 32;

      // 8 instead of facings, is hardcoded in the game
      if (WalkFrames > 0) framenumber = WalkFrames * 8 + frameoffset;
      else framenumber = 8 + frameoffset;

      return framenumber;
    };
  }

  // DirectionBasedFrameDecider does not actually get infantry facings right.
  static InfantryFrameDecider(
    Ready_Start = 0,
    Ready_Count = 1,
    Ready_CountNext = 1,
    randomFacing = -1,
  ): (obj: GameObject) => number {
    return (obj) => {
      let val = 0;
      let direction = 0;
      if (isOwnableLike(obj)) direction = (obj as OwnableObject).Direction;
      if (randomFacing >= 0) direction = randomFacing;
      if (Ready_Count > 0) val = Ready_Start + Ready_CountNext * (7 - direction / 32);
      return val;
    };
  }
}

function isOwnableLike(o: GameObject): o is GameObject & OwnableObject {
  return 'Direction' in o;
}
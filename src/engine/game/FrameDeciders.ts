// Port of CNCMaps.Engine.Game.FrameDeciders
import { EngineType } from '../../shared/Enums.js';
import { Rand } from '../../shared/Util.js';
import { DrawFrame } from './DrawProperties.js';
import type { GameObject, OwnableObject } from '../map/GameObjects.js';
import { OverlayObject } from '../map/GameObjects.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import type { Animation } from '../types/Animation.js';

// OptionsClass::Normalize_Delay: Normalized=yes anims scale their per-frame delay by the game speed
// so their apparent speed stays constant. GameSpeed 0 is fastest (60 fps); the A/B capture pipeline
// runs with spawn.ini GameSpeed=2, which is the value used here.
const ANIM_GAME_SPEED = 2;
const NORMALIZED_DELAY: number[][] = [
  [2, 2, 1, 1, 1, 1, 1, 1],
  [3, 3, 3, 2, 2, 2, 1, 1],
  [5, 4, 4, 3, 3, 2, 2, 1],
  [7, 6, 5, 4, 4, 4, 3, 2],
];

// Anims tick this many times during scenario load, before the frame counter a capture reports
// starts counting. It belongs to the capture setup rather than to the engine: the load runs longer
// with more players, so the A/B corpus needs 5 with every start position filled and needed 2 with
// one human against one AI (both from a sweep of --anim-frame over the corpus).
const ANIM_PHASE = 5;

/// <summary>
/// Replays gamemd's AnimClass tick logic so a render matches an engine capture whose logic was
/// frozen at game-loop frame <paramref name="simFrame"/>. Field semantics from the YR binary: Rate
/// is stored as a delay of 900/Rate game frames per anim frame; End/LoopEnd of 0 mean unset and
/// resolve against the SHP frame count (halved for Shadow=yes anims, whose second half holds the
/// shadow frames). RandomRate/RandomLoopDelay roll the game's synced RNG and cannot be replayed;
/// they are treated as plain Rate with no inter-loop pause. Returns the frame index to draw, or
/// shpFrames (out of range, skipping the draw) for an animation that has expired by then.
/// </summary>
function simulateAnimStage(art: Animation, shpFrames: number, simFrame: number): number {
  let delay = art.Rate > 0 ? Math.trunc(900 / art.Rate) : 0;
  if (art.Normalized)
    delay = delay <= 0 ? 0 : delay < 5 ? NORMALIZED_DELAY[delay - 1][ANIM_GAME_SPEED] : Math.trunc((delay * 8) / (ANIM_GAME_SPEED + 1));

  const bodyFrames = art.Shadow ? Math.trunc(shpFrames / 2) : shpFrames;
  const end = art.End > 0 ? art.End : bodyFrames;
  const loopEnd = art.LoopEnd > 0 ? art.LoopEnd : end;

  // the loop count multiplies into a byte in-game; LoopCount=-1 wraps to 0xFF = infinite
  let loops = art.LoopCount & 0xff;
  if (loops <= 1) loops = 1;
  const infinite = loops === 0xff;

  let stage = 0;
  let step = 1;
  if (art.Reverse) {
    stage = loopEnd - 1;
    step = -1;
  }
  if (delay <= 0) return art.Start + stage;

  let started = 0;
  for (let f = 1; f <= simFrame + ANIM_PHASE; f++) {
    if (f - started < delay) continue;
    started = f;
    stage += step;

    if (art.PingPong) {
      const atBound = loops > 1 ? stage >= loopEnd - art.Start || stage === art.Start : stage >= end || stage === 0;
      if (atBound) step = -step;
      continue;
    }

    let atEnd = loops > 1 ? stage >= loopEnd - art.Start : stage >= end;
    if (art.Reverse) atEnd = atEnd || stage <= 0;
    // Shadow anims wrap at the loop bound even on their last loop, so they never run
    // into the shadow half
    else if (!atEnd && art.Shadow) atEnd = stage >= loopEnd - art.Start;
    if (!atEnd) continue;

    if (!infinite) loops--;
    if (loops === 0) return shpFrames;
    stage = art.Reverse ? loopEnd : art.LoopStart - art.Start;
  }
  return art.Start + stage;
}

export class FrameDeciders {
  /// <summary>The game-loop frame every animation is drawn at when >= 0 (--anim-frame), for
  /// comparing against an engine capture whose logic was frozen. -1 keeps the live loop deciders.</summary>
  static AnimSimFrame = -1;

  /// <summary>
  /// Deterministic replacement for LoopFrameDecider: the frame the game engine shows at
  /// game-loop frame AnimSimFrame. Pure, so the draw, shadow and bounds passes agree.
  /// </summary>
  static AnimTickFrameDecider(animProps: Animation, drawable: { Shp: ShpFile | null }): (obj: GameObject) => number {
    const simFrame = FrameDeciders.AnimSimFrame;
    let frame = -1;
    return () => {
      if (frame < 0) {
        drawable.Shp?.Initialize();
        frame = simulateAnimStage(animProps, drawable.Shp?.NumImages ?? 0, simFrame);
      }
      return frame;
    };
  }

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

  // CellClass::Draw_Overlay picks one of the four interchangeable full-span frames from this
  // table so a long bridge does not draw the same image in every cell.
  private static readonly BridgeVariation = [0, 1, 2, 3, 3, 2, 1, 0, 2, 3, 0, 1, 1, 0, 3, 2];

  /// <summary>
  /// High bridge decks. Frames 0-3 are the east-west full spans and 9-12 the north-south
  /// ones; a map stores only the first of each pair and the game varies it by cell position.
  /// </summary>
  static HighBridgeFrameDecider = (obj: GameObject): number => {
    if (!(obj instanceof OverlayObject)) return 0;
    let frame = obj.OverlayValue;
    const tile = obj.Tile;
    if ((frame === 0 || frame === 9) && tile != null)
      frame += FrameDeciders.BridgeVariation[(tile.Rx & 3) | ((tile.Ry & 3) << 2)];
    return frame;
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
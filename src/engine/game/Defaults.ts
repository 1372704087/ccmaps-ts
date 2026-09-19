// Port of CNCMaps.Engine.Game.Defaults
import { CollectionType, EngineType, LightingType, PaletteType } from '../../shared/Enums.js';
import type { GameObject } from '../map/GameObjects.js';
import { FrameDeciders } from './FrameDeciders.js';

export class Defaults {
  static GetDefaultPalette(t: CollectionType, engine: EngineType): PaletteType {
    switch (t) {
      case CollectionType.Building:
      case CollectionType.Aircraft:
      case CollectionType.Infantry:
      case CollectionType.Vehicle:
        return PaletteType.Unit;
      case CollectionType.Overlay:
        return PaletteType.Overlay;
      case CollectionType.Smudge:
      case CollectionType.Terrain:
      case CollectionType.Animation:
      default:
        return PaletteType.Iso;
    }
  }

  static GetDefaultLighting(type: CollectionType): LightingType {
    switch (type) {
      case CollectionType.Aircraft:
      case CollectionType.Building:
      case CollectionType.Infantry:
      case CollectionType.Vehicle:
        return LightingType.Ambient;
      case CollectionType.Overlay:
      case CollectionType.Smudge:
      case CollectionType.Terrain:
      case CollectionType.Animation:
        return LightingType.Full;
      default:
        throw new RangeError('type');
    }
  }

  static GetDefaultRemappability(type: CollectionType, engine: EngineType): boolean {
    switch (type) {
      case CollectionType.Aircraft:
      case CollectionType.Building:
      case CollectionType.Infantry:
      case CollectionType.Vehicle:
        return true;
      case CollectionType.Overlay:
      case CollectionType.Smudge:
      case CollectionType.Terrain:
      case CollectionType.Animation:
        return false;
      default:
        throw new RangeError('type');
    }
  }

  static GetShadowAssumption(t: CollectionType): boolean {
    switch (t) {
      case CollectionType.Overlay:
      case CollectionType.Building:
      case CollectionType.Infantry:
      case CollectionType.Terrain:
      case CollectionType.Vehicle:
      case CollectionType.Aircraft:
        return true;
      default:
      case CollectionType.Smudge:
      case CollectionType.Animation:
        return false;
    }
  }

  static GetFlatnessAssumption(t: CollectionType): boolean {
    switch (t) {
      case CollectionType.Overlay:
      case CollectionType.Smudge:
        return true;
      case CollectionType.Building:
      case CollectionType.Aircraft:
      case CollectionType.Infantry:
      case CollectionType.Terrain:
      case CollectionType.Vehicle:
        return false;
      default:
        return true;
    }
  }

  static GetDefaultFrameDecider(collection: CollectionType): ((obj: GameObject) => number) | null {
    switch (collection) {
      case CollectionType.Vehicle:
      case CollectionType.Aircraft:
      case CollectionType.Infantry:
        return FrameDeciders.DirectionBasedFrameDecider;
      case CollectionType.Building:
        return FrameDeciders.HealthBasedFrameDecider;
      case CollectionType.Overlay:
        return FrameDeciders.OverlayValueFrameDecider;
      case CollectionType.Smudge:
      case CollectionType.Terrain:
      case CollectionType.Animation:
        return FrameDeciders.NullFrameDecider;
      default:
        throw new RangeError('collection');
    }
  }
}
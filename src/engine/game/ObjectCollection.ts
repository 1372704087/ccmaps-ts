// Port of CNCMaps.Engine.Game.ObjectCollection
import type { IniFile, IniSection } from '../../formats/IniFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import { ModConfig } from '../../shared/ModConfig.js';
import {
  CollectionType,
  TheaterType,
  EngineType,
  LightingType,
  PaletteType,
  OverlayTibType,
} from '../../shared/Enums.js';
import { Size } from '../../shared/Geometry.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import '../../formats/ShpFile.js';
import type { Drawable } from '../drawables/Drawable.js';
import { ShpDrawable } from '../drawables/ShpDrawable.js';
import { UnitDrawable } from '../drawables/UnitDrawable.js';
import { BuildingDrawable } from '../drawables/BuildingDrawable.js';
import { TerrainDrawable } from '../drawables/TerrainDrawable.js';
import { AnimDrawable } from '../drawables/AnimDrawable.js';
import type { GameObjectLike } from '../Types.js';
import { OverlayObject } from '../map/GameObjects.js';
import type { PaletteCollection } from './PaletteCollection.js';
import { GameCollection } from './GameCollection.js';
import { Defaults } from './Defaults.js';
import { FrameDeciders } from './FrameDeciders.js';
import { OffsetHacks } from './DrawProperties.js';
import { SpecialOverlays } from './SpecialOverlays.js';
import { logger } from '../../shared/Log.js';

export class ObjectCollection extends GameCollection {
  readonly FireNames: string[] = [];
  readonly Palettes: PaletteCollection;

  constructor(
    type: CollectionType,
    theater: TheaterType,
    config: ModConfig,
    vfs: VirtualFileSystem,
    rules: IniFile,
    art: IniFile,
    objectsList: IniSection,
    palettes: PaletteCollection,
  ) {
    super(type, theater, config, vfs, rules, art);

    this.Palettes = palettes;
    if (this._config.Engine >= EngineType.RedAlert2) {
      const fireNames = this.Rules.readString(
        this._config.Engine === EngineType.RedAlert2 ? 'AudioVisual' : 'General',
        'DamageFireTypes',
        'FIRE01,FIRE02,FIRE03',
      );
      this.FireNames = fireNames.split(/[,.]/).filter((s) => s !== '');
    }

    for (const entry of objectsList.OrderedEntries) {
      const value = entry.Value.toString();
      if (value !== '') {
        logger.trace(`Loading object ${objectsList.Name}.${value}`);
        this.AddObject(value);
      }
    }
  }

  protected override MakeDrawable(objName: string): Drawable {
    let drawable: Drawable;
    const rulesSection = this.Rules.getOrCreateSection(objName);
    const artSectionName = rulesSection.readString('Image', objName);
    const artSection = this.Art.getOrCreateSection(artSectionName);

    switch (this.Type) {
      case CollectionType.Aircraft:
      case CollectionType.Vehicle:
        drawable = new UnitDrawable(this._config, this._vfs, rulesSection, artSection);
        break;
      case CollectionType.Building:
        drawable = new BuildingDrawable(this._config, this._vfs, rulesSection, artSection);
        break;
      case CollectionType.Infantry:
      case CollectionType.Overlay:
      case CollectionType.Smudge:
        drawable = new ShpDrawable(this._config, this._vfs, rulesSection, artSection);
        break;
      case CollectionType.Terrain:
        drawable = new TerrainDrawable(this._config, this._vfs, rulesSection, artSection);
        break;
      case CollectionType.Animation:
        drawable = new AnimDrawable(this._config, this._vfs, rulesSection, artSection);
        break;
      default:
        throw new RangeError('Invalid enum value for CollectionType');
    }
    return drawable;
  }

  protected override LoadDrawable(drawable: Drawable): void {
    switch (this.Type) {
      case CollectionType.Aircraft:
      case CollectionType.Vehicle:
        this.LoadUnitDrawable(drawable as UnitDrawable);
        break;
      case CollectionType.Building:
        this.LoadBuildingDrawable(drawable as BuildingDrawable);
        break;
      case CollectionType.Infantry:
      case CollectionType.Overlay:
      case CollectionType.Smudge:
        this.LoadSimpleDrawable(drawable as ShpDrawable);
        break;
      case CollectionType.Terrain:
        this.LoadTerrainDrawable(drawable as TerrainDrawable);
        break;
      case CollectionType.Animation:
        this.LoadAnimDrawable(drawable as AnimDrawable);
        break;
      default:
        throw new RangeError('Invalid enum value for CollectionType');
    }

    // overrides from the modconfig
    const cfgOverrides = this._config.ObjectOverrides
      .filter(
        (ovr) =>
          // matches collection
          (ovr.CollectionTypes & this.Type) === this.Type &&
          // matches theater
          (ovr.TheaterTypes & this.Theater) === this.Theater &&
          // matches object regex
          new RegExp(ovr.ObjRegex, 'i').test(drawable.Name),
      )
      .sort((a, b) => b.Priority - a.Priority);

    for (const cfgOverride of cfgOverrides) {
      logger.debug(`Object ${drawable.Name} receives overrides from regex ${cfgOverride.ObjRegex}`);

      if (cfgOverride.Lighting !== LightingType.Default) drawable.Props.LightingType = cfgOverride.Lighting;

      if (cfgOverride.Palette !== PaletteType.Default) {
        drawable.Props.PaletteType = cfgOverride.Palette;
        drawable.Props.CustomPaletteName = cfgOverride.CustomPaletteFile;
      }

      if (cfgOverride.FrameDeciderCode.trim() !== '') {
        const decider = FrameDeciders.TryParseFrameDeciderCode(cfgOverride.FrameDeciderCode);
        if (decider != null)
          drawable.Props.FrameDecider = decider as unknown as (obj: GameObjectLike) => number;
        else logger.warn(`Unsupported FrameDeciderCode "${cfgOverride.FrameDeciderCode}" in mod config ignored`);
      }
    }
  }

  private LoadAnimDrawable(anim: AnimDrawable): void {
    this.InitDrawableDefaults(anim);
    anim.LoadFromRules();
    anim.Shp = this._vfs.open(anim.GetFilename(), FileFormat.Shp) as ShpFile | null;
  }

  private InitDrawableDefaults(drawable: Drawable): void {
    drawable.OwnerCollection = this;
    drawable.Props.PaletteType = Defaults.GetDefaultPalette(this.Type, this._config.Engine);
    drawable.Props.LightingType = Defaults.GetDefaultLighting(this.Type);
    drawable.IsRemapable = Defaults.GetDefaultRemappability(this.Type, this._config.Engine);
    drawable.Props.FrameDecider = Defaults.GetDefaultFrameDecider(this.Type) as unknown as
      | ((obj: GameObjectLike) => number)
      | null;

    // apply collection-specific offsets
    switch (this.Type) {
      case CollectionType.Building:
      case CollectionType.Overlay:
      case CollectionType.Smudge:
        drawable.Props.Offset.Offset(this._config.TileWidth / 2, 0);
        break;
      case CollectionType.Terrain:
      case CollectionType.Vehicle:
      case CollectionType.Infantry:
      case CollectionType.Aircraft:
      case CollectionType.Animation:
        drawable.Props.Offset.Offset(this._config.TileWidth / 2, this._config.TileHeight / 2);
        break;
    }
  }

  private LoadTerrainDrawable(drawable: TerrainDrawable): void {
    this.InitDrawableDefaults(drawable);
    drawable.LoadFromRules();
  }

  private LoadSimpleDrawable(drawable: ShpDrawable): void {
    this.InitDrawableDefaults(drawable);
    drawable.LoadFromRules();

    const shpFile = drawable.GetFilename();
    drawable.Shp = this._vfs.open(shpFile, FileFormat.Shp) as ShpFile | null;

    if (this.Type === CollectionType.Smudge)
      drawable.Foundation = new Size(drawable.Rules!.readInt('Width', 1), drawable.Rules!.readInt('Height', 1));

    if (this.Type === CollectionType.Overlay) this.LoadOverlayDrawable(drawable);
  }

  private LoadBuildingDrawable(drawable: BuildingDrawable): void {
    this.InitDrawableDefaults(drawable);
    drawable.LoadFromRules();
  }

  private LoadUnitDrawable(drawable: UnitDrawable): void {
    this.InitDrawableDefaults(drawable);
    drawable.LoadFromRules();
  }

  private LoadOverlayDrawable(drawable: ShpDrawable): void {
    const ovl = new OverlayObject(drawable.Index, 0);
    const tibType = SpecialOverlays.GetOverlayTibType(ovl, this._config.Engine);
    const props = drawable.Props;

    if (this._config.Engine >= EngineType.RedAlert2) {
      if (tibType !== OverlayTibType.NotSpecial) {
        props.FrameDecider = FrameDeciders.OverlayValueFrameDecider as unknown as (obj: GameObjectLike) => number;
        props.PaletteType = PaletteType.Overlay;
        props.LightingType = LightingType.None;
      } else if (SpecialOverlays.IsHighBridge(ovl)) {
        props.OffsetHack = OffsetHacks.RA2BridgeOffsets;
        props.ShadowOffsetHack = OffsetHacks.RA2BridgeShadowOffsets;
        drawable.TileElevation = 4; // for lighting
        drawable.Foundation = new Size(3, 1); // ensures they're drawn later --> fixes overlap
      }
    } else if (this._config.Engine <= EngineType.Firestorm) {
      if (tibType !== OverlayTibType.NotSpecial) {
        props.FrameDecider = FrameDeciders.OverlayValueFrameDecider as unknown as (obj: GameObjectLike) => number;
        props.PaletteType = PaletteType.Unit;
        props.LightingType = LightingType.None;
        drawable.IsRemapable = true;
      } else if (SpecialOverlays.IsHighBridge(ovl) || SpecialOverlays.IsTSHighRailsBridge(ovl)) {
        props.OffsetHack = OffsetHacks.TSBridgeOffsets;
        props.ShadowOffsetHack = OffsetHacks.TSBridgeShadowOffsets;
        drawable.TileElevation = 4; // for lighting
      }
    }
  }

  ApplyNewTheaterIfNeeded(artName: string, imageFileName: string): string {
    if (artName.length < 2 || imageFileName.length < 2) return imageFileName;
    if (this._config.Engine <= EngineType.Firestorm) {
      // the tag will only work if the ID for the object starts with either G, N or C and its second letter is A (for Arctic/Snow theater) or T (for Temperate theater)
      if (['G', 'N', 'C'].includes(artName[0]) && ['A', 'T'].includes(artName[1]))
        return this.ApplyNewTheater(imageFileName);
    } else if (this._config.Engine === EngineType.RedAlert2) {
      // In RA2, for the tag to work, it must start with either G, N or C, and its second letter must be A, T or U (Urban theater).
      if (['G', 'N', 'C'].includes(artName[0]) && ['A', 'T', 'U'].includes(artName[1]))
        return this.ApplyNewTheater(imageFileName);
    } else {
      //  In Yuri's Revenge, the ID can also start with Y."
      // It can also use D, L & N as theater ID's.
      // Ares allows use of any letter as the first letter.
      if (['A', 'T', 'U', 'D', 'L', 'N'].includes(artName[1])) return this.ApplyNewTheater(imageFileName);
    }
    return imageFileName;
  }

  private ApplyNewTheater(imageFileName: string): string {
    const chars = imageFileName.split('');
    chars[1] = ModConfig.ActiveTheater != null ? ModConfig.ActiveTheater.NewTheaterChar : '';
    if (!this._vfs.fileExists(chars.join(''))) {
      chars[1] = 'G'; // generic
      if (!this._vfs.fileExists(chars.join(''))) chars[1] = imageFileName[1]; // fallback to original
    }
    return chars.join('');
  }
}
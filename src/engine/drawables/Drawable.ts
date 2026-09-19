// Port of CNCMaps.Engine.Drawables.Drawable
import { Rectangle, Size } from '../../shared/Geometry.js';
import { EngineType, LightingType, PaletteType } from '../../shared/Enums.js';
import type { IniSection } from '../../formats/IniFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { ObjectCollection } from '../game/ObjectCollection.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { DrawProperties } from '../game/DrawProperties.js';
import { Defaults } from '../game/Defaults.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import { ShpRenderer } from '../../rendering/ShpRenderer.js';
import type { GameObjectLike } from '../Types.js';

// Lazy factory for AlphaDrawable, registered by AlphaDrawable.ts at module
// load. This breaks the import cycle Drawable -> AlphaDrawable -> ShpDrawable
// -> Drawable that ESM cannot resolve.
export type AlphaDrawableFactory = (renderer: ShpRenderer, shpFile: ShpFile | null) => Drawable;
let alphaDrawableFactory: AlphaDrawableFactory | null = null;
export function registerAlphaDrawableFactory(f: AlphaDrawableFactory): void {
  alphaDrawableFactory = f;
}

export abstract class Drawable {
  /// <summary>Name of rules section</summary>
  Name = '';

  /// <summary>Index of object in its owner collection array</summary>
  Index = 0;

  Rules: IniSection | null = null;
  Art: IniSection | null = null;
  protected readonly _config: ModConfig;
  protected readonly _vfs: VirtualFileSystem;
  OwnerCollection: ObjectCollection | null = null;
  Props = new DrawProperties();
  SubDrawables: Drawable[] = [];

  IsRemapable = false;
  InvisibleInGame = false;
  Foundation = new Size(1, 1);

  Overrides = false;
  IsWall = false;
  IsActualWall = false;
  IsGate = false;
  IsRubble = false;
  IsVeins = false;
  IsVeinHoleMonster = false;
  TileElevation = 0;
  Flat = false;
  StartWalkFrame = 0;
  StartStandFrame = 0;
  StandingFrames = 0;
  WalkFrames = 0;
  Facings = 0;
  Ready_Start = 0;
  Ready_Count = 1;
  Ready_CountNext = 1;
  Theater = false;
  IsBuildingPart = true;

  IsVoxel = false;
  NewTheater = false;
  Image = '';
  TheaterExtension = false;

  constructor();
  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection | null, art: IniSection | null);
  constructor(config?: ModConfig, vfs?: VirtualFileSystem, rules?: IniSection | null, art?: IniSection | null) {
    this._config = config as ModConfig;
    this._vfs = vfs as VirtualFileSystem;
    this.Rules = rules ?? null;
    this.Art = art ?? null;
    this.Name = rules != null ? rules.Name : '';
  }

  LoadFromRules(): void {
    this.LoadFromArtEssential();
    this.LoadFromRulesFull();
  }

  LoadFromArtEssential(): void {
    if (this.Art == null) return;
    this.Image = this.Art.readString('Image', this.Art.Name);
    this.IsVoxel = this.Art.readBool('Voxel');
    this.TheaterExtension = this.Art.readBool('Theater');
    this.NewTheater = (this._config != null && this._config.Engine >= EngineType.RedAlert2) || this.Art.readBool('NewTheater');
  }

  LoadFromRulesFull(): void {
    if (this.Art == null || this.Rules == null) return;

    if (this.Art.readString('Remapable') !== '') {
      // does NOT work in RA2
      if (this._config.Engine <= EngineType.Firestorm) this.IsRemapable = this.Art.readBool('Remapable');
    }

    // Used palette can be overridden
    const noUseTileLandType = this.Rules.readString('NoUseTileLandType') !== '';
    if (noUseTileLandType) {
      this.Props.PaletteType = PaletteType.Iso;
      this.Props.LightingType = LightingType.Full;
    }
    if (this.Art.readBool('TerrainPalette')) {
      this.Props.PaletteType = PaletteType.Iso;
      this.IsRemapable = false;
    } else if (this.Art.readBool('AnimPalette')) {
      this.Props.PaletteType = PaletteType.Anim;
      this.Props.LightingType = LightingType.None;
      this.IsRemapable = false;
    } else if (this.Art.readString('Palette') !== '') {
      this.Props.PaletteType = PaletteType.Custom;
      this.Props.CustomPaletteName = this.Art.readString('Palette');
    }

    if (this.Rules.readString('AlphaImage') !== '') {
      const alphaImageFile = this.Rules.readString('AlphaImage') + '.shp';
      if (this._vfs.fileExists(alphaImageFile) && alphaDrawableFactory != null) {
        const ad = alphaDrawableFactory(
          new ShpRenderer(this._config, this._vfs),
          this._vfs.open(alphaImageFile, FileFormat.Shp) as ShpFile,
        );
        ad.OwnerCollection = this.OwnerCollection;
        this.SubDrawables.push(ad);
      }
    }

    const ownerType = this.OwnerCollection != null ? this.OwnerCollection.Type : 0;
    this.Props.HasShadow = this.Art.readBool('Shadow', Defaults.GetShadowAssumption(ownerType));
    this.Props.HasShadow = this.Props.HasShadow && !this.Rules.readBool('NoShadow');
    this.Props.Cloakable = this.Rules.readBool('Cloakable');
    this.Flat =
      (this.Rules.readBool('DrawFlat', Defaults.GetFlatnessAssumption(ownerType)) || this.Rules.readBool('Flat'));

    if (this.Rules.readBool('Gate')) {
      this.IsGate = true;
      this.Flat = false;
      this.IsBuildingPart = true;
      this.Props.PaletteType = PaletteType.Unit;
      this.Props.FrameDecider = FrameDeciders.NullFrameDecider as unknown as (obj: GameObjectLike) => number;
    }

    if (this.Rules.readBool('Wall')) {
      this.IsWall = true;
      this.Flat = false;
      this.IsBuildingPart = true;
      // RA2 walls appear a bit higher
      if (this._config.Engine >= EngineType.RedAlert2) {
        this.Props.Offset.Offset(0, 3); // seems walls are located 3 pixels lower
      }
      this.Props.PaletteType = PaletteType.Unit;
      this.Props.LightingType = LightingType.Ambient;
      this.Props.FrameDecider = FrameDeciders.OverlayValueFrameDecider as unknown as (obj: GameObjectLike) => number;
    }

    // Overlays with IsRubble are not drawn.
    if (this.Rules.readBool('IsRubble')) {
      this.InvisibleInGame = true;
    }
    if (this.Rules.readBool('IsVeins')) {
      this.Props.LightingType = LightingType.None;
      this.Props.PaletteType = PaletteType.Unit;
      this.IsVeins = true;
      this.Flat = true;
      this.Props.Offset.Y = -1; // why is this needed???
    }
    if (this.Rules.readBool('IsVeinholeMonster')) {
      this.Props.Offset.Y = -49; // why is this needed???
      this.Props.LightingType = LightingType.None;
      this.Props.PaletteType = PaletteType.Unit;
      this.IsVeinHoleMonster = true;
    }

    if (this.Rules.readString('Land') === 'Rock') {
      this.Props.Offset.Y += this._config.TileHeight / 2;
    } else if (this.Rules.readString('Land') === 'Road') {
      this.Props.Offset.Y += this._config.TileHeight / 2;
      if (this.Name.toUpperCase().includes('LOBRDG') || this.Name.toUpperCase().includes('LOBRDB'))
        this.Props.ZAdjust += this._config.TileHeight;
    } else if (this.Rules.readString('Land') === 'Railroad') {
      if (this._config.Engine <= EngineType.Firestorm) this.Props.Offset.Y = 11;
      else this.Props.Offset.Y = 14;
      this.Props.LightingType = LightingType.Full;
      this.Props.PaletteType = PaletteType.Iso;
    }
    if (this.Rules.readBool('SpawnsTiberium')) {
      // For example on TIBTRE / Ore Poles
      this.Props.Offset.Y = -1;
      this.Props.LightingType = LightingType.None;
      this.Props.PaletteType = PaletteType.Unit;
    }

    this.Facings = this.Art.readInt('Facings', 8);
    this.StartStandFrame = this.Art.readInt('StartStandFrame', 0);
    this.StandingFrames = this.Art.readInt('StandingFrames', 0);
    this.StartWalkFrame = this.Art.readInt('StartWalkFrame', 0);
    this.WalkFrames = this.Art.readInt('WalkFrames', 0);

    this.Props.Offset.Offset(this.Art.readInt('XDrawOffset'), this.Art.readInt('YDrawOffset'));

    const sequence = this.Art.readString('Sequence');
    if (sequence !== '' && this.OwnerCollection != null && this.OwnerCollection.Art != null) {
      const seqSection = this.OwnerCollection.Art.getOrCreateSection(sequence);
      const seqReady = seqSection.readString('Ready');
      const readyParts = seqReady.split(',');
      if (readyParts.length === 3) {
        const start = parseInt(readyParts[0], 10);
        const frames = parseInt(readyParts[1], 10);
        const facingcount = parseInt(readyParts[2], 10);
        if (!isNaN(start) && !isNaN(frames) && !isNaN(facingcount)) {
          this.Ready_Start = start;
          this.Ready_Count = frames;
          this.Ready_CountNext = facingcount;
        }
      }
    }
  }

  abstract Draw(obj: GameObject, ds: DrawingSurface, shadow?: boolean): void;
  DrawShadow(_obj: GameObject, _ds: DrawingSurface): void {}

  abstract GetBounds(obj: GameObject): Rectangle;

  Clone(): Drawable {
    const ret = Object.assign(Object.create(Object.getPrototypeOf(this)), this) as Drawable;
    ret.Props = this.Props.Clone();
    return ret;
  }

  toString(): string {
    return this.Name;
  }
}
// Port of CNCMaps.Engine.Game.Theater
import { Size } from '../../shared/Geometry.js';
import { EngineType, TheaterType, CollectionType, PaletteType } from '../../shared/Enums.js';
import { logger } from '../../shared/Log.js';
import { ModConfig } from '../../shared/ModConfig.js';
import { VirtualFileSystem } from '../../formats/vfs/VirtualFileSystem.js';
import { IniFile, IniSection } from '../../formats/IniFile.js';
import { PalFile } from '../../formats/PalFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import { VplFile } from '../../formats/VplFile.js';
import { Palette } from '../../rendering/Palette.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { ObjectCollection } from './ObjectCollection.js';
import { TileCollection } from './TileCollection.js';
import { PaletteCollection } from './PaletteCollection.js';
import { VoxelDrawable } from '../drawables/VoxelDrawable.js';
import type { Drawable } from '../drawables/Drawable.js';
import { BuildingDrawable } from '../drawables/BuildingDrawable.js';
import { UnitDrawable } from '../drawables/UnitDrawable.js';
import { MapTile } from '../map/MapTile.js';
import type { GameObject } from '../map/GameObjects.js';
import {
  AircraftObject,
  AnimationObject,
  InfantryObject,
  NamedObject,
  OverlayObject,
  SmudgeObject,
  StructureObject,
  TerrainObject,
  UnitObject,
} from '../map/GameObjects.js';

export class Theater {
  private readonly _theaterType: TheaterType;
  private readonly _config: ModConfig;
  private readonly _vfs: VirtualFileSystem;
  private readonly _rules: IniFile;
  private readonly _art: IniFile;

  private _infantryTypes: ObjectCollection | null = null;
  private _vehicleTypes: ObjectCollection | null = null;
  private _aircraftTypes: ObjectCollection | null = null;
  private _buildingTypes: ObjectCollection | null = null;
  private _overlayTypes: ObjectCollection | null = null;
  private _terrainTypes: ObjectCollection | null = null;
  private _smudgeTypes: ObjectCollection | null = null;
  private _animations: ObjectCollection | null = null;
  private _tileTypes: TileCollection | null = null;
  private _palettes: PaletteCollection | null = null;

  constructor(theaterType: TheaterType, config: ModConfig, vfs: VirtualFileSystem, rules: IniFile, art: IniFile);
  constructor(theaterType: TheaterType, engine: EngineType, vfs: VirtualFileSystem);
  constructor(
    theaterType: TheaterType,
    configOrEngine: ModConfig | EngineType,
    vfs: VirtualFileSystem,
    rules?: IniFile,
    art?: IniFile,
  ) {
    this._theaterType = theaterType;
    this._vfs = vfs;

    if (typeof configOrEngine === 'number') {
      const engine = configOrEngine as EngineType;
      if (engine === EngineType.RedAlert2 || engine === EngineType.TiberianSun) {
        this._rules = vfs.open('rules.ini') as IniFile;
        this._art = vfs.open('art.ini') as IniFile;
      } else if (engine === EngineType.YurisRevenge) {
        this._rules = vfs.open('rulesmd.ini') as IniFile;
        this._art = vfs.open('artmd.ini') as IniFile;
      } else if (engine === EngineType.Firestorm) {
        this._rules = vfs.open('rules.ini') as IniFile;
        const fsRules = vfs.open('firestrm.ini') as IniFile;
        logger.info('Merging Firestorm rules with TS rules');
        this._rules.mergeWith(fsRules);
        this._art = vfs.open('artmd.ini') as IniFile;
      } else {
        this._rules = vfs.open('rules.ini') as IniFile;
        this._art = vfs.open('art.ini') as IniFile;
      }
      this._config = ModConfig.GetDefaultConfig(engine);
      this.LoadIncludes(vfs);
    } else {
      this._config = configOrEngine as ModConfig;
      this._rules = rules as IniFile;
      this._art = art as IniFile;
      this.LoadIncludes(vfs);
    }
  }

  private LoadIncludes(vfs: VirtualFileSystem): void {
    this._rules.loadAresIncludes(vfs);
    this._rules.loadPhobosIncludes(vfs);
    this._rules.solvePhobosInheritance();
    this._art.loadAresIncludes(vfs);
    this._art.loadPhobosIncludes(vfs);
    this._art.solvePhobosInheritance();
  }

  Initialize(): boolean {
    logger.info(`Initializing theater of type ${this._theaterType}`);

    if (!this._config.SetActiveTheater(this._theaterType)) return false;
    Theater.Active = this;

    // load palettes and additional mix files for this theater
    const isoPal = this._vfs.open(ModConfig.ActiveTheater!.IsoPaletteName, FileFormat.Pal) as PalFile | null;
    const ovlPal = this._vfs.open(ModConfig.ActiveTheater!.OverlayPaletteName, FileFormat.Pal) as PalFile | null;
    const unitPal = this._vfs.open(ModConfig.ActiveTheater!.UnitPaletteName, FileFormat.Pal) as PalFile | null;
    if (isoPal == null || ovlPal == null || unitPal == null) {
      logger.error(
        'Theater palettes could not be loaded; the mix file directory does not appear to ' +
          'contain valid game data for this engine. Try specifying the engine type manually.',
      );
      return false;
    }

    this._palettes = new PaletteCollection(this._vfs);
    this._palettes.IsoPalette = new Palette(isoPal);
    this._palettes.OvlPalette = new Palette(ovlPal);
    this._palettes.UnitPalette = new Palette(unitPal, ModConfig.ActiveTheater!.UnitPaletteName, true);

    for (const mix of ModConfig.ActiveTheater!.Mixes) this._vfs.addItem(mix); // wish for these to be cached as they're gonna be hit often

    const animPal = this._vfs.open('anim.pal', FileFormat.Pal) as PalFile | null;
    if (animPal == null) {
      logger.error('anim.pal could not be loaded; the mix file directory does not appear to contain valid game data.');
      return false;
    }
    this._palettes.AnimPalette = new Palette(animPal);

    // voxels.vpl provides the game's voxel lighting lookup
    VoxelDrawable.VoxelRenderer.Configure(this._vfs.open('voxels.vpl') as VplFile | null, this._config.Engine);

    const animSect = this._rules.getSection('Animations') as IniSection;
    this._animations = new ObjectCollection(
      CollectionType.Animation,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      animSect,
      this._palettes,
    );

    this._tileTypes = new TileCollection(
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      ModConfig.ActiveTheater!,
    );

    this._buildingTypes = new ObjectCollection(
      CollectionType.Building,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('BuildingTypes') as IniSection,
      this._palettes,
    );

    this._aircraftTypes = new ObjectCollection(
      CollectionType.Aircraft,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('AircraftTypes') as IniSection,
      this._palettes,
    );

    this._infantryTypes = new ObjectCollection(
      CollectionType.Infantry,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('InfantryTypes') as IniSection,
      this._palettes,
    );

    this._overlayTypes = new ObjectCollection(
      CollectionType.Overlay,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('OverlayTypes') as IniSection,
      this._palettes,
    );

    this._terrainTypes = new ObjectCollection(
      CollectionType.Terrain,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('TerrainTypes') as IniSection,
      this._palettes,
    );

    this._smudgeTypes = new ObjectCollection(
      CollectionType.Smudge,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('SmudgeTypes') as IniSection,
      this._palettes,
    );

    this._vehicleTypes = new ObjectCollection(
      CollectionType.Vehicle,
      this._theaterType,
      this._config,
      this._vfs,
      this._rules,
      this._art,
      this._rules.getSection('VehicleTypes') as IniSection,
      this._palettes,
    );

    this._tileTypes.InitTilesets();
    this._tileTypes.InitAnimations(this._animations);

    return true;
  }

  static TheaterTypeFromString(theater: string): TheaterType {
    theater = theater.toLowerCase();
    if (theater === 'lunar') return TheaterType.Lunar;
    else if (theater === 'newurban') return TheaterType.NewUrban;
    else if (theater === 'desert') return TheaterType.Desert;
    else if (theater === 'temperate') return TheaterType.Temperate;
    else if (theater === 'urban') return TheaterType.Urban;
    else if (theater === 'snow') return TheaterType.Snow;
    else throw new Error(`Unknown theater type: ${theater}`);
  }

  GetTileCollection(): TileCollection {
    return this._tileTypes as TileCollection;
  }

  GetPalettes(): PaletteCollection {
    return this._palettes as PaletteCollection;
  }

  GetPalette(drawable: Drawable): Palette {
    let pal: Palette | null = null;
    if (drawable.Props.PaletteType === PaletteType.Custom) {
      pal = this._palettes!.GetCustomPalette(drawable.Props.CustomPaletteName);
      if (pal == null) {
        if (drawable instanceof BuildingDrawable || drawable instanceof UnitDrawable) return this._palettes!.UnitPalette as Palette;
        else if (drawable.constructor.name === 'AnimDrawable') return this._palettes!.AnimPalette as Palette;
        else return this._palettes!.IsoPalette as Palette;
      }
    } else {
      pal = this._palettes!.GetPalette(drawable.Props.PaletteType);
    }
    return pal as Palette;
  }

  GetObjectCollection(o: GameObject): ObjectCollection | TileCollection | null {
    if (o instanceof InfantryObject) return this._infantryTypes;
    else if (o instanceof UnitObject) return this._vehicleTypes;
    else if (o instanceof AircraftObject) return this._aircraftTypes;
    else if (o instanceof StructureObject) {
      if (this._buildingTypes!.HasObject(o)) return this._buildingTypes;
      else return this._overlayTypes;
    } else if (o instanceof OverlayObject) return this._overlayTypes;
    else if (o instanceof TerrainObject) return this._terrainTypes;
    else if (o instanceof SmudgeObject) return this._smudgeTypes;
    else if (o instanceof AnimationObject) return this._animations;
    else if (o instanceof MapTile) return this._tileTypes;
    else return null;
  }

  GetFoundation(v: NamedObject): Size {
    if (this._buildingTypes!.HasObject(v)) return this._buildingTypes!.GetDrawable(v)!.Foundation;
    else return (this._overlayTypes!.GetDrawable(v) as Drawable).Foundation;
  }

  GetCollection(t: CollectionType): GameCollectionLike {
    switch (t) {
      case CollectionType.Aircraft:
        return this._aircraftTypes as GameCollectionLike;
      case CollectionType.Building:
        return this._buildingTypes as GameCollectionLike;
      case CollectionType.Infantry:
        return this._infantryTypes as GameCollectionLike;
      case CollectionType.Overlay:
        return this._overlayTypes as GameCollectionLike;
      case CollectionType.Smudge:
        return this._smudgeTypes as GameCollectionLike;
      case CollectionType.Terrain:
        return this._terrainTypes as GameCollectionLike;
      case CollectionType.Vehicle:
        return this._vehicleTypes as GameCollectionLike;
      case CollectionType.Tiles:
        return this._tileTypes as unknown as GameCollectionLike;
      default:
        throw new RangeError('t');
    }
  }

  Draw(obj: GameObject, ds: DrawingSurface): void {
    logger.trace(`Drawing object ${obj} @ ${obj.Tile}`);
    obj.Drawable?.Draw(obj, ds);
  }

  static Active: Theater | null = null;
}

// minimal structural type to satisfy GetCollection without importing the abstract base
export interface GameCollectionLike {
  Type: CollectionType;
  GetDrawable(o: GameObject | string | number): Drawable | null;
  HasObject(o: GameObject): boolean;
}

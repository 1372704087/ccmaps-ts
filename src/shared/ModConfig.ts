// Port of CNCMaps.Shared.ModConfig + TheaterSettings + ObjectOverride + ModOption
import { EngineType, TheaterType, CollectionType, PaletteType, LightingType } from '../shared/Enums.js';

export class TheaterSettings {
  Type: TheaterType = TheaterType.None;
  Mixes: string[] = [];
  TheaterIni = '';
  Extension = '';
  NewTheaterChar = '';
  IsoPaletteName = '';
  UnitPaletteName = '';
  OverlayPaletteName = '';

  constructor() {
    this.Mixes = [];
  }

  clone(): TheaterSettings {
    const ret = new TheaterSettings();
    ret.Type = this.Type;
    ret.Mixes = this.Mixes.slice();
    ret.TheaterIni = this.TheaterIni;
    ret.Extension = this.Extension;
    ret.NewTheaterChar = this.NewTheaterChar;
    ret.IsoPaletteName = this.IsoPaletteName;
    ret.UnitPaletteName = this.UnitPaletteName;
    ret.OverlayPaletteName = this.OverlayPaletteName;
    return ret;
  }

  toString(): string {
    return TheaterType[this.Type];
  }
}

export class ObjectOverride {
  CollectionTypes: CollectionType = CollectionType.All;
  TheaterTypes: TheaterType = TheaterType.All;
  ObjRegex = '';
  Palette: PaletteType = PaletteType.Default;
  CustomPaletteFile = '';
  Lighting: LightingType = LightingType.Default;
  FrameDeciderCode = '';
  Priority = 0;

  clone(): ObjectOverride {
    const ret = new ObjectOverride();
    ret.CollectionTypes = this.CollectionTypes;
    ret.TheaterTypes = this.TheaterTypes;
    ret.ObjRegex = this.ObjRegex;
    ret.Palette = this.Palette;
    ret.CustomPaletteFile = this.CustomPaletteFile;
    ret.Lighting = this.Lighting;
    ret.FrameDeciderCode = this.FrameDeciderCode;
    ret.Priority = this.Priority;
    return ret;
  }

  toString(): string {
    return `Override for "${this.ObjRegex !== '' ? this.ObjRegex : '<empty>'}"`;
  }
}

export class ModOption {
  DisableOreRandomization = false;
  DisableTibRemap = false;
  EnableRandomInfantryFacing = false;
  MapLocalSizeBottomCropValue = '0';
  LightingAmbientRGBDelta = '0,0,0,0';

  clone(): ModOption {
    const ret = new ModOption();
    ret.DisableOreRandomization = this.DisableOreRandomization;
    ret.DisableTibRemap = this.DisableTibRemap;
    ret.EnableRandomInfantryFacing = this.EnableRandomInfantryFacing;
    ret.MapLocalSizeBottomCropValue = this.MapLocalSizeBottomCropValue;
    ret.LightingAmbientRGBDelta = this.LightingAmbientRGBDelta;
    return ret;
  }

  toString(): string {
    return (
      `ModOption for DisableOreRandomization: ${this.DisableOreRandomization} DisableTibRemap: ${this.DisableTibRemap}` +
      ` EnableRandomInfantryFacing: ${this.EnableRandomInfantryFacing} BottomCrop: ${this.MapLocalSizeBottomCropValue} LightingDelta: ${this.LightingAmbientRGBDelta}`
    );
  }
}

export class ModConfig {
  static ActiveTheater: TheaterSettings | null = null;

  static GetDefaultConfig(engine: EngineType): ModConfig {
    switch (engine) {
      case EngineType.TiberianSun:
        return ModConfig.DefaultsTS;
      case EngineType.Firestorm:
        return ModConfig.DefaultsFS;
      case EngineType.RedAlert2:
        return ModConfig.DefaultsRA2;
      case EngineType.YurisRevenge:
        return ModConfig.DefaultsYR;
      default:
        throw new Error('Invalid engine value');
    }
  }

  SetActiveTheater(theater: TheaterType): boolean {
    ModConfig.ActiveTheater = this.Theaters.find((t) => t.Type === theater) ?? null;
    return ModConfig.ActiveTheater != null;
  }

  Name = 'Custom mod config';
  Engine: EngineType = EngineType.YurisRevenge;
  Directories: string[] = [];
  ExtraMixes: string[] = [];
  CustomRulesIniFiles: string[] = [];
  CustomArtIniFiles: string[] = [];
  Theaters: TheaterSettings[] = [];
  ObjectOverrides: ObjectOverride[] = [];
  ExtraOptions: ModOption[] = [];

  clone(): ModConfig {
    const ret = new ModConfig();
    ret.Name = this.Name;
    ret.Engine = this.Engine;
    ret.Directories = this.Directories.slice();
    ret.ExtraMixes = this.ExtraMixes.slice();
    ret.CustomRulesIniFiles = this.CustomRulesIniFiles.slice();
    ret.CustomArtIniFiles = this.CustomArtIniFiles.slice();
    ret.Theaters = this.Theaters.map((t) => t.clone());
    ret.ObjectOverrides = this.ObjectOverrides.map((t) => t.clone());
    ret.ExtraOptions = this.ExtraOptions.map((t) => t.clone());
    return ret;
  }

  get TileWidth(): number {
    return this.Engine === EngineType.RedAlert2 || this.Engine === EngineType.YurisRevenge ? 60 : 48;
  }

  get TileHeight(): number {
    return this.Engine === EngineType.RedAlert2 || this.Engine === EngineType.YurisRevenge ? 30 : 24;
  }

  GetTheater(th: TheaterType): TheaterSettings | null {
    return this.Theaters.find((t) => t.Type === th) ?? null;
  }

  static DefaultsTS: ModConfig = (() => {
    const c = new ModConfig();
    c.Name = 'TS Defaults';
    c.Engine = EngineType.TiberianSun;
    c.Theaters = [
      {
        Type: TheaterType.Temperate,
        TheaterIni: 'temperat.ini',
        Mixes: ['isotemp.mix', 'temperat.mix', 'tem.mix'],
        Extension: '.tem',
        NewTheaterChar: 'T',
        IsoPaletteName: 'isotem.pal',
        UnitPaletteName: 'unittem.pal',
        OverlayPaletteName: 'temperat.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Snow,
        TheaterIni: 'snow.ini',
        Mixes: ['isosnow.mix', 'snow.mix', 'sno.mix'],
        Extension: '.sno',
        NewTheaterChar: 'A',
        IsoPaletteName: 'isosno.pal',
        UnitPaletteName: 'unitsno.pal',
        OverlayPaletteName: 'snow.pal',
      } as TheaterSettings,
    ];
    return c;
  })();

  static DefaultsFS: ModConfig = ModConfig.DefaultsTS;

  static DefaultsRA2: ModConfig = (() => {
    const c = new ModConfig();
    c.Name = 'RA2 Defaults';
    c.Engine = EngineType.RedAlert2;
    c.Theaters = [
      {
        Type: TheaterType.Temperate,
        TheaterIni: 'temperat.ini',
        Mixes: ['isotemp.mix', 'temperat.mix', 'tem.mix'],
        Extension: '.tem',
        NewTheaterChar: 'T',
        IsoPaletteName: 'isotem.pal',
        UnitPaletteName: 'unittem.pal',
        OverlayPaletteName: 'temperat.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Snow,
        TheaterIni: 'snow.ini',
        Mixes: ['isosnow.mix', 'snow.mix', 'sno.mix'],
        Extension: '.sno',
        NewTheaterChar: 'A',
        IsoPaletteName: 'isosno.pal',
        UnitPaletteName: 'unitsno.pal',
        OverlayPaletteName: 'snow.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Urban,
        TheaterIni: 'urban.ini',
        Mixes: ['isourb.mix', 'urb.mix', 'urban.mix'],
        Extension: '.urb',
        NewTheaterChar: 'U',
        IsoPaletteName: 'isourb.pal',
        UnitPaletteName: 'uniturb.pal',
        OverlayPaletteName: 'urban.pal',
      } as TheaterSettings,
    ];
    return c;
  })();

  static DefaultsYR: ModConfig = (() => {
    const c = new ModConfig();
    c.Name = 'YR Defaults';
    c.Engine = EngineType.YurisRevenge;
    c.Theaters = [
      {
        Type: TheaterType.Temperate,
        TheaterIni: 'temperatmd.ini',
        Mixes: ['isotemp.mix', 'isotemmd.mix', 'temperat.mix', 'tem.mix'],
        Extension: '.tem',
        NewTheaterChar: 'T',
        IsoPaletteName: 'isotem.pal',
        UnitPaletteName: 'unittem.pal',
        OverlayPaletteName: 'temperat.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Snow,
        TheaterIni: 'snowmd.ini',
        Mixes: ['isosnomd.mix', 'snowmd.mix', 'isosnow.mix', 'snow.mix', 'sno.mix'],
        Extension: '.sno',
        NewTheaterChar: 'A',
        IsoPaletteName: 'isosno.pal',
        UnitPaletteName: 'unitsno.pal',
        OverlayPaletteName: 'snow.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Urban,
        TheaterIni: 'urbanmd.ini',
        Mixes: ['isourbmd.mix', 'isourb.mix', 'urb.mix', 'urban.mix'],
        Extension: '.urb',
        NewTheaterChar: 'U',
        IsoPaletteName: 'isourb.pal',
        UnitPaletteName: 'uniturb.pal',
        OverlayPaletteName: 'urban.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.NewUrban,
        TheaterIni: 'urbannmd.ini',
        Mixes: ['isoubnmd.mix', 'isoubn.mix', 'ubn.mix', 'urbann.mix'],
        Extension: '.ubn',
        NewTheaterChar: 'N',
        IsoPaletteName: 'isoubn.pal',
        UnitPaletteName: 'unitubn.pal',
        OverlayPaletteName: 'urbann.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Desert,
        TheaterIni: 'desertmd.ini',
        Mixes: ['isodesmd.mix', 'desert.mix', 'des.mix', 'isodes.mix'],
        Extension: '.des',
        NewTheaterChar: 'D',
        IsoPaletteName: 'isodes.pal',
        UnitPaletteName: 'unitdes.pal',
        OverlayPaletteName: 'desert.pal',
      } as TheaterSettings,
      {
        Type: TheaterType.Lunar,
        TheaterIni: 'lunarmd.ini',
        Mixes: ['isolunmd.mix', 'isolun.mix', 'lun.mix', 'lunar.mix'],
        Extension: '.lun',
        NewTheaterChar: 'L',
        IsoPaletteName: 'isolun.pal',
        UnitPaletteName: 'unitlun.pal',
        OverlayPaletteName: 'lunar.pal',
      } as TheaterSettings,
    ];
    return c;
  })();
}

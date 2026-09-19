// Enums ported from CNCMaps.Shared.Enums

export enum OverlayTibType {
  NotSpecial = 0,
  Riparius = 1,
  Cruentus = 2,
  Vinifera = 4,
  Aboreus = 8,
  Ore = 1,
  Gems = 2,
  Ore2 = 4,
  Ore3 = 8,
  All = 15,
}

export enum EngineType {
  AutoDetect = 0,
  TiberianSun = 1,
  Firestorm = 2,
  RedAlert2 = 3,
  YurisRevenge = 4,
}

export enum TheaterType {
  None = 0,
  Temperate = 1,
  Urban = 2,
  Snow = 4,
  Lunar = 8,
  Desert = 16,
  NewUrban = 32,
  All = 63,
}

export enum CollectionType {
  None = 0,
  Aircraft = 1,
  Building = 2,
  Infantry = 4,
  Overlay = 8,
  Smudge = 16,
  Terrain = 32,
  Vehicle = 64,
  Animation = 128,
  Tiles = 256,
  All = 511,
}

export enum LightingType {
  None,
  Global,
  Level,
  Ambient,
  Full,
  Default,
}

export enum PaletteType {
  None,
  Iso,
  Unit,
  Overlay,
  Anim,
  Custom,
  Default,
}

export enum StartPositionMarking {
  None,
  Squared,
  Circled,
  Diamond,
  Ellipsed,
  Starred,
  Tiled,
}

export enum PreviewMarkersType {
  None,
  SelectedAsAbove,
  Bittah,
  Aro,
}

export enum SizeMode {
  Local,
  Full,
  Auto,
}

export enum EngineResult {
  RenderedOk,
  Exception,
  LoadTheaterFailed,
  LoadRulesFailed,
}

// From CNCMaps.Shared/Enums.cs in Engine.Types (drawable kinds)
export enum DrawableKind {
  Undefined,
  Building,
  Unit,
  Infantry,
  Aircraft,
  Terrain,
  Overlay,
  OverlayPack,
  Smudge,
  Animation,
  Voxel,
  Tunnel,
}
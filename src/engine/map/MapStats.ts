// Port of CNCMaps.Engine.Map.MapStats

/// <summary>Statistics derived from the fully parsed map, exported via --meta-json.</summary>
export class MapStats {
  HeightMin = 0;
  HeightMax = 0;
  TotalTiles = 0;
  WaterTiles = 0;
  ShoreTiles = 0;
  CliffTiles = 0;
  RampTiles = 0;

  OreCells = 0;
  GemCells = 0;
  TotalCredits = 0;
  OreSpawners = 0;

  Structures = 0;
  TechStructures = 0;
  GarrisonableStructures = 0;
  TerrainObjects = 0;
  Units = 0;
  Infantry = 0;
  Aircraft = 0;
  Smudges = 0;
  HasBridges = false;

  TechStructureTypes = new Map<string, number>();
}

/// <summary>A start waypoint in both cell and drawing-surface pixel coordinates, exported via
/// --meta-json so a render can be aligned against an engine capture of the same map.</summary>
export class StartPositionPixel {
  Number = 0;
  Rx = 0;
  Ry = 0;
  Z = 0;
  X = 0;
  Y = 0;
}

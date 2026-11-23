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

  /** Plain object with the same shape the CLI metadata JSON uses for stats. */
  toPlainObject(): {
    terrain: Record<string, number>;
    resources: Record<string, number>;
    objects: Record<string, unknown>;
  } {
    const techStructureTypes: Record<string, number> = {};
    for (const [name, count] of [...this.TechStructureTypes.entries()].sort(([a], [b]) => a.localeCompare(b)))
      techStructureTypes[name] = count;
    return {
      terrain: {
        heightMin: this.HeightMin,
        heightMax: this.HeightMax,
        totalTiles: this.TotalTiles,
        waterTiles: this.WaterTiles,
        shoreTiles: this.ShoreTiles,
        cliffTiles: this.CliffTiles,
        rampTiles: this.RampTiles,
      },
      resources: {
        oreCells: this.OreCells,
        gemCells: this.GemCells,
        totalCredits: this.TotalCredits,
        oreSpawners: this.OreSpawners,
      },
      objects: {
        structures: this.Structures,
        techStructures: this.TechStructures,
        techStructureTypes,
        garrisonableStructures: this.GarrisonableStructures,
        terrainObjects: this.TerrainObjects,
        units: this.Units,
        infantry: this.Infantry,
        aircraft: this.Aircraft,
        smudges: this.Smudges,
        hasBridges: this.HasBridges,
      },
    };
  }
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

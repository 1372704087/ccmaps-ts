// Categories tracked per rendered pixel so a render can be split into layered PSDs.
// The numbers are stored in a byte per pixel, so keep them explicit and small.
export enum LayerCategory {
  None = 0,
  Terrain = 1,
  Structure = 2,
  Infantry = 3,
  Vehicle = 4,
  Aircraft = 5,
  Naval = 6,
  TerrainObject = 7,
  Overlay = 8,
  Smudge = 9,
}

/** PSD layer names (Chinese first: the categories are aimed at map editors). */
export const LayerCategoryNames: Record<number, string> = {
  [LayerCategory.Terrain]: '地形',
  [LayerCategory.Structure]: '建筑',
  [LayerCategory.Infantry]: '步兵',
  [LayerCategory.Vehicle]: '载具',
  [LayerCategory.Aircraft]: '飞行器',
  [LayerCategory.Naval]: '海军',
  [LayerCategory.TerrainObject]: '地形对象',
  [LayerCategory.Overlay]: '覆盖物',
  [LayerCategory.Smudge]: '污染物',
};

/** Bottom-to-top paint order; PSD layers are written top-to-bottom (reverse of this). */
export const LayerCategoryStack: LayerCategory[] = [
  LayerCategory.Terrain,
  LayerCategory.Smudge,
  LayerCategory.Overlay,
  LayerCategory.TerrainObject,
  LayerCategory.Structure,
  LayerCategory.Infantry,
  LayerCategory.Vehicle,
  LayerCategory.Naval,
  LayerCategory.Aircraft,
];

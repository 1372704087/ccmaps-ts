// Public facade for cncmaps-ts — a TypeScript port of CNCMaps,
// the C&C Red Alert 2 / Tiberian Sun map renderer.

// Engine facade
export { RenderEngine } from './engine/RenderEngine.js';
export { MapRenderer as Map } from './engine/map/Map.js';

// Engine internals (useful to embed the renderer directly)
export { MapFile } from './formats/map/MapFile.js';
export { Theater } from './engine/game/Theater.js';
export { MapRenderer } from './engine/map/Map.js';
export { RenderProgress } from './engine/RenderProgress.js';

// Shared configuration / settings
export { RenderSettings } from './shared/RenderSettings.js';
export { ModConfig, TheaterSettings, ObjectOverride, ModOption } from './shared/ModConfig.js';
export { logger } from './shared/Log.js';

// Public enums
export * from './shared/Enums.js';

// Low-level formats (for custom readers)
export * from './formats/index.js';
export * from './formats/map/index.js';
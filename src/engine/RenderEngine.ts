// Port of CNCMaps.Engine.RenderEngine (+ Program-level facade).
// Ties the whole pipeline together: load a .map/.mpr/.yrm file, detect the
// engine, load the game data through the VFS, and render the map to a PNG.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../shared/Log.js';
import { EngineType, EngineResult } from '../shared/Enums.js';
import { ModConfig } from '../shared/ModConfig.js';
import { RenderSettings } from '../shared/RenderSettings.js';
import { VirtualFileSystem } from '../formats/vfs/VirtualFileSystem.js';
import { MapFile } from '../formats/map/MapFile.js';
import { MapRenderer } from './map/Map.js';
import { RenderProgress } from './RenderProgress.js';

export class RenderEngine {
  /// <summary>
  /// Renders the map referred to by <paramref name="settings"/>. Returns an
  /// EngineResult describing the outcome.
  /// </summary>
  Render(settings: RenderSettings): EngineResult {
    if (settings.InputFile === '') {
      logger.error('No input file given');
      return EngineResult.Exception;
    }
    if (!fs.existsSync(settings.InputFile)) {
      logger.fatal(`File not found: ${settings.InputFile}`);
      return EngineResult.Exception;
    }

    const mapBytes = fs.readFileSync(settings.InputFile);
    const mapName = path.basename(settings.InputFile);

    // 1. Resolve the engine type (explicit override or auto-detect).
    const engine = settings.Engine !== EngineType.AutoDetect ? settings.Engine : RenderEngine.detectEngine(mapBytes, settings.MixFilesDirectories);
    if (engine === EngineType.AutoDetect) {
      logger.fatal('Could not determine the engine; specify one with --force-ts/-t, --force-fs/-T, --force-ra2/-y or --force-yr/-Y');
      return EngineResult.Exception;
    }
    logger.info(`Using ${EngineType[engine]} engine`);

    const config = ModConfig.GetDefaultConfig(engine);

    // 2. Build the virtual file system from the given mix directories.
    const vfs = new VirtualFileSystem();
    const dirs = settings.MixFilesDirectories.length > 0 ? settings.MixFilesDirectories : [RenderEngine.defaultMixDir(engine)];
    for (const d of dirs) if (d !== '') vfs.addItem(d);
    vfs.loadMixes(dirs.length > 0 ? dirs[0] : '', engine);

    // 3. Parse the map file.
    let mapFile: MapFile;
    try {
      mapFile = new MapFile(mapBytes, mapName);
    } catch (e) {
      logger.fatal(`Could not parse map file: ${e instanceof Error ? e.message : String(e)}`);
      return EngineResult.Exception;
    }

    // 4. Configure and initialize the map renderer.
    const renderer = new MapRenderer();
    renderer.IgnoreLighting = settings.IgnoreLighting;
    renderer.MarkOreFields = settings.MarkOreFields;
    renderer.StartPosMarking = settings.StartPositionMarking;
    renderer.StartMarkerSize = settings.MarkerStartSize;
    if (settings.ReportProgress) {
      renderer.Progress = new RenderProgress((pct, phase) => process.stdout.write(`progress:${Math.trunc(pct)}:${phase}\n`));
    }

    try {
      if (!renderer.Initialize(mapFile, config, vfs)) {
        logger.fatal('Failed to initialize map');
        return EngineResult.Exception;
      }

      if (settings.FixupTiles) renderer.FixupTileLayer();
      if (settings.FixOverlays) renderer.FixupOverlays();
      if (settings.CompressTiles) renderer.CompressIsoMapPack5();

      if (!renderer.LoadTheater()) {
        logger.fatal('Failed to initialize theater (failed to load rules/art or theater assets). Verify the mix directory contains the game data.');
        return EngineResult.LoadTheaterFailed;
      }
    } catch (e) {
      logger.fatal(`Rendering failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return EngineResult.Exception;
    }

    // 5. Draw the map.
    renderer.Draw();

    if (settings.MarkIceGrowth) renderer.MarkIceGrowth();
    if (settings.TunnelPaths) renderer.PlotTunnels(settings.TunnelPosition);
    if (settings.MarkStartPos) renderer.DrawStartPositions();

    // Optional: generate a preview pack and inject it back into the map file.
    if (settings.GeneratePreviewPack) {
      renderer.GeneratePreviewPack(settings.PreviewMarkers, settings.SizeMode, mapFile, settings.FixPreviewDimensions);
    }

    // 6. Resolve the output path and save the PNG.
    const outPath = RenderEngine.resolveOutputPath(settings, mapName);
    const rect = renderer.GetSizePixels(settings.SizeMode);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    renderer.GetDrawingSurface().savePNG(outPath, settings.PNGQuality, rect.Left, rect.Top, rect.Width, rect.Height);
    logger.info(`Saved ${outPath}`);

    renderer.FreeUseless();
    return EngineResult.RenderedOk;
  }

  /// <summary>Resolves the output .png file path from settings and map name.</summary>
  static resolveOutputPath(settings: RenderSettings, mapName: string): string {
    const baseExt = path.extname(mapName);
    let outBase = settings.OutputFile !== '' ? settings.OutputFile : path.join(path.dirname(mapName), path.basename(mapName, baseExt));
    if (settings.OutputDir !== '') outBase = path.join(settings.OutputDir, path.basename(outBase));
    return outBase.replace(/\.(png|jpg|jpeg)$/i, '') + '.png';
  }

  static defaultMixDir(engine: EngineType): string {
    if (process.platform === 'win32') {
      const candidates = engine >= EngineType.RedAlert2
        ? [process.env['RA2_INSTALL_DIR'] ?? '', process.env['RY_Installation_Path'] ?? '', process.env['ProgramFiles'] ?? '']
        : [process.env['TS_INSTALL_DIR'] ?? '', process.env['ProgramFiles'] ?? ''];
      return candidates.find((c) => c !== '' && fs.existsSync(c)) ?? '';
    }
    return process.env.MIX_FILES_DIR ?? '';
  }

  /// <summary>Best-effort auto-detection of the engine from the map timeout and the mix directory.</summary>
  static detectEngine(mapBytes: Uint8Array, mixDirs: string[]): EngineType {
    // Look at the theater name in the [Map] section: YR uses "xxxMD".
    const text = Buffer.from(mapBytes.slice(0, 3 * 64 * 1024)).toString('latin1');
    let theater = '';
    if (text.includes('[Map]')) {
      const m = /\bTheater\s*=\s*([^\r\n]+)/i.exec(text);
      if (m) theater = m[1].trim();
    }

    // Scan the mix directories for engine-specific top-level .mix files.
    const dirs = mixDirs.length > 0 ? mixDirs : [RenderEngine.defaultMixDir(EngineType.RedAlert2)];
    const found = new Set<string>();
    for (const d of dirs) {
      if (d === '' || !fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) found.add(f.toLowerCase());
    }

    if (/\bmd$/.test(theater.trim()) || found.has('ra2md.mix') || found.has('rulesmd.ini')) return EngineType.YurisRevenge;
    if (found.has('ra2.mix')) return EngineType.RedAlert2;
    if (found.has('firestrm.ini') || (found.has('patch.mix') || found.has('tibsun.mix'))) return EngineType.Firestorm;
    if (found.has('tibsun.mix')) return EngineType.TiberianSun;
    return EngineType.RedAlert2;
  }
}
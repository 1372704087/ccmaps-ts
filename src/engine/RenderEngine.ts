// Port of CNCMaps.Engine.RenderEngine (+ Program-level facade).
// Ties the whole pipeline together: load a .map/.mpr/.yrm file, detect the
// engine, load the game data through the VFS, and render the map to a PNG.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../shared/Log.js';
import { EngineType, EngineResult, TheaterType } from '../shared/Enums.js';
import { ModConfig } from '../shared/ModConfig.js';
import { RenderSettings } from '../shared/RenderSettings.js';
import { VirtualFileSystem } from '../formats/vfs/VirtualFileSystem.js';
import { MapFile } from '../formats/map/MapFile.js';
import { MapRenderer } from './map/Map.js';
import { MapStats } from './map/MapStats.js';
import { MixFile } from '../formats/MixFile.js';
import { FileFormat } from '../formats/FileFormat.js';
import { MixArchiveExtensions } from '../formats/FormatHelper.js';
import { PktFile, PktMapEntry, GameMode } from '../formats/PktFile.js';
import { MissionsFile, MissionEntry } from '../formats/MissionsFile.js';
import { CsfFile } from '../formats/CsfFile.js';
import { Rectangle } from '../shared/Geometry.js';
import { TileCollection } from './game/TileCollection.js';
import { Operations } from './map/Operations.js';
import { FrameDeciders } from './game/FrameDeciders.js';
import { RenderProgress } from './RenderProgress.js';
import { Palette } from '../rendering/Palette.js';
import { Rand } from '../shared/Util.js';
import type { DrawingSurface } from '../rendering/DrawingSurface.js';

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

    // make each render deterministic regardless of how many renders ran earlier in this process
    Rand.reset();
    Rand.Pinned = settings.PinRandomDraws;
    FrameDeciders.AnimSimFrame = settings.AnimFrame;

    // Quantize lighting to the 63 intensity steps the engine draws through (always on for a render).
    Palette.QuantizeIntensity = true;

    // gamemd's own tile-variant lattice; an explicit one lets an A/B render match a capture.
    let lattice: number[] | null = null;
    if (settings.TileLattice !== '') {
      const vals = settings.TileLattice.split(',');
      if (vals.length !== 64) throw new Error('--tile-lattice needs 64 comma-separated values');
      lattice = vals.map((v) => parseInt(v, 10));
    }
    TileCollection.SetVariantLattice(lattice);

    // The scenario randomizer as the engine entered its vein fixup; an explicit state replays it.
    let veinRng: number[] | null = null;
    if (settings.VeinRandomizer !== '') {
      const vals = settings.VeinRandomizer.split(',');
      if (vals.length !== 252) throw new Error('--vein-rng needs 252 comma-separated values');
      veinRng = vals.map((v) => parseInt(v, 10));
    }
    Operations.SetVeinRandomizer(veinRng);

    // 2. Build the virtual file system from the given mix directories.
    const vfs = new VirtualFileSystem();
    const dirs = settings.MixFilesDirectories.length > 0 ? settings.MixFilesDirectories : [RenderEngine.defaultMixDir(engine)];
    for (const d of dirs) if (d !== '') vfs.addItem(d);
    vfs.loadMixes(dirs.length > 0 ? dirs[0] : '', engine, !settings.NoExpandMixes);

    // 3. Parse the map file.
    let mapFile: MapFile;
    try {
      mapFile = new MapFile(mapBytes, mapName);
    } catch (e) {
      logger.fatal(`Could not parse map file: ${e instanceof Error ? e.message : String(e)}`);
      return EngineResult.Exception;
    }

    // always resolve the map's proper name (pkt/csf lookup for official maps);
    // it is logged as "Mapname found:" and exported via --meta-json
    let resolvedName: string;
    try {
      resolvedName = RenderEngine.determineMapName(mapFile, engine, vfs, settings.InputFile);
    } catch (e) {
      logger.warn(`Could not determine map name: ${e instanceof Error ? e.message : String(e)}`);
      resolvedName = path.basename(mapName, path.extname(mapName));
    }

    // 4. Configure and initialize the map renderer.
    const renderer = new MapRenderer();
    renderer.IgnoreLighting = settings.IgnoreLighting;
    renderer.MarkOreFields = settings.MarkOreFields;
    renderer.StartPosMarking = settings.StartPositionMarking;
    renderer.StartMarkerSize = settings.MarkerStartSize;
    renderer.PreCaptureColors = settings.PreCaptureColors;
    renderer.TrackVoxelMask = settings.DebugVoxelMaskFile !== '';
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

    if (settings.DebugZBufferFile !== '')
      RenderEngine.dumpZBuffer(renderer.GetDrawingSurface(), settings.DebugZBufferFile);
    if (settings.DebugVoxelMaskFile !== '')
      RenderEngine.dumpVoxelMask(renderer.GetDrawingSurface(), settings.DebugVoxelMaskFile);
    if (settings.DebugTilesFile !== '')
      RenderEngine.dumpTiles(renderer, settings.DebugTilesFile);

    if (settings.MarkIceGrowth) renderer.MarkIceGrowth();
    if (settings.TunnelPaths) renderer.PlotTunnels(settings.TunnelPosition);
    if (settings.MarkStartPos) renderer.DrawStartPositions();

    // Optional: generate a preview pack and inject it back into the map file.
    if (settings.GeneratePreviewPack) {
      renderer.GeneratePreviewPack(settings.PreviewMarkers, settings.SizeMode, mapFile, settings.FixPreviewDimensions);
    }

    // 6. Resolve the output path and save the PNG.
    const outPath = RenderEngine.resolveOutputPath(settings, mapName);
    const saveRect = renderer.GetSizePixels(settings.SizeMode);
    saveRect.Intersect(new Rectangle(0, 0, renderer.GetDrawingSurface().Width, renderer.GetDrawingSurface().Height));
    // stats need the rules, which FreeUseless disposes below
    const mapStats = settings.MetadataOutFile !== '' ? renderer.ComputeStats() : null;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    renderer.GetDrawingSurface().savePNG(outPath, settings.PNGQuality, saveRect.Left, saveRect.Top, saveRect.Width, saveRect.Height);
    logger.info(`Saved ${outPath}`);

    if (settings.MetadataOutFile !== '')
      RenderEngine.writeMetadataJson(settings.MetadataOutFile, resolvedName, mapFile, renderer, saveRect, mapStats, engine);

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

  private static stripPlayersFromName(mapName: string): string {
    const paren = mapName.indexOf(' (');
    if (paren !== -1) return mapName.substring(0, paren);
    const bracket = mapName.indexOf(' [');
    if (bracket !== -1) return mapName.substring(0, bracket);
    return mapName;
  }

  /// <summary>Determines the map's proper name (raw, unsanitized).</summary>
  static determineMapName(map: MapFile, engine: EngineType, vfs: VirtualFileSystem, inputFile: string): string {
    const fileNameWithoutExtension = path.basename(map.fileName, path.extname(map.fileName));

    const basic = map.getSection('Basic');
    if (basic == null) return fileNameWithoutExtension;
    if (!basic.readBool('Official')) return basic.readString('Name', fileNameWithoutExtension);

    const mapExt = path.extname(inputFile).toLowerCase();
    let missionName = '';
    let mapName = '';
    let pktMapEntry: PktMapEntry | undefined;
    let missionEntry: MissionEntry | undefined;

    // campaign mission
    if (!basic.readBool('MultiplayerOnly') && basic.readBool('Official')) {
      let missionsFile: string;
      switch (engine) {
        case EngineType.TiberianSun:
        case EngineType.RedAlert2:
          missionsFile = 'mission.ini';
          break;
        case EngineType.Firestorm:
          missionsFile = 'mission1.ini';
          break;
        case EngineType.YurisRevenge:
          missionsFile = 'missionmd.ini';
          break;
        default:
          missionsFile = 'mission.ini';
          break;
      }
      const mf = vfs.openFile(missionsFile) as unknown as MissionsFile | null;
      if (mf != null) missionEntry = mf.getMissionEntry(path.basename(map.fileName));
      if (missionEntry != null) missionName = engine >= EngineType.RedAlert2 ? missionEntry.UIName : missionEntry.Name;
    } else {
      // multiplayer map
      let pktEntryName = fileNameWithoutExtension;
      let pkt: PktFile | null = null;

      if (MixArchiveExtensions.includes(mapExt)) {
        // this is an 'official' map 'archive' containing a PKT file with its name
        try {
          const mix = new MixFile(fs.readFileSync(inputFile), inputFile);
          pkt = mix.openFile(fileNameWithoutExtension + '.pkt', FileFormat.Pkt) as unknown as PktFile | null;
          if (pkt != null && pkt.MapEntries.size > 0) pktEntryName = pkt.MapEntries.keys().next().value as string;
        } catch {
          /* not an archive we can read; fall through to the vfs pkt */
        }
      } else {
        // determine pkt file based on engine
        let pktFile: string;
        switch (engine) {
          case EngineType.TiberianSun:
          case EngineType.RedAlert2:
            pktFile = 'missions.pkt';
            break;
          case EngineType.Firestorm:
            pktFile = 'multi01.pkt';
            break;
          case EngineType.YurisRevenge:
            pktFile = 'missionsmd.pkt';
            break;
          default:
            pktFile = 'missions.pkt';
            break;
        }
        pkt = vfs.openFile(pktFile) as unknown as PktFile | null;
      }

      // fallback for multiplayer maps with .map extension, no YR objects so assumed to be
      // ra2, but actually meant to be used on yr
      if (mapExt === '.map' && pkt != null && !pkt.MapEntries.has(pktEntryName.toLowerCase()) && engine >= EngineType.RedAlert2) {
        const mapVfs = new VirtualFileSystem();
        if (mapVfs.addItem(inputFile)) {
          pkt = mapVfs.openFile('missionsmd.pkt') as unknown as PktFile | null;
          if (pkt != null && pktEntryName !== '') pktMapEntry = pkt.getMapEntry(pktEntryName);
        }
      } else if (pkt != null && pktEntryName !== '') pktMapEntry = pkt.getMapEntry(pktEntryName);
    }

    // now, if we have a map entry from a PKT file,
    // for TS we are done, but for RA2 we need to look in the CSV file for the translated mapname
    if (engine <= EngineType.Firestorm) {
      if (pktMapEntry != null) mapName = pktMapEntry.Description;
      else if (missionEntry != null) {
        if (engine === EngineType.TiberianSun) {
          if (missionEntry.Briefing.length >= 3) {
            const campaignSide = missionEntry.Briefing.substring(0, 3);
            const missionNumber = missionEntry.Briefing.length > 3 ? missionEntry.Briefing.substring(3) : '';
            missionName = '';
            mapName = `${campaignSide} ${missionNumber.replace(/A+$/, '').padStart(2, '0')} - ${missionName}`;
          } else if (missionEntry.Name.length >= 10) {
            mapName = missionEntry.Name;
          }
        } else {
          // FS map names are constructed a bit easier
          mapName = missionName.replace(/:/g, ' - ');
        }
      } else if (basic.readString('Name') !== '') mapName = basic.readString('Name', fileNameWithoutExtension);
    }
    // if this is a RA2/YR mission (csfEntry set) or official map with valid pktMapEntry
    else if (missionEntry != null || pktMapEntry != null) {
      const csfEntryName = missionEntry != null ? missionName : pktMapEntry!.Description;

      const csfFile = engine === EngineType.YurisRevenge ? 'ra2md.csf' : 'ra2.csf';
      logger.info(`Loading csf file ${csfFile}`);
      const csf = vfs.openFile(csfFile) as unknown as CsfFile | null;
      if (csf != null && csfEntryName != null) mapName = csf.getValue(csfEntryName.toLowerCase());

      if (missionEntry != null) {
        if (mapName.includes('Operation: ')) {
          const missionMapName = path.basename(map.fileName);
          const c3 = missionMapName[3];
          const c4 = missionMapName[4];
          if (c3 >= '0' && c3 <= '9' && c4 >= '0' && c4 <= '9') {
            const missionNr = missionMapName.substring(3, 5);
            mapName = mapName.substring(0, mapName.indexOf(':')) + ' ' + missionNr + ' -' + mapName.substring(mapName.indexOf(':') + 1);
          }
        }
      } else if ((pktMapEntry!.GameModes & GameMode.Standard) === 0) {
        // not standard map
        if ((pktMapEntry!.GameModes & GameMode.Megawealth) === GameMode.Megawealth) mapName += ' (Megawealth)';
        if ((pktMapEntry!.GameModes & GameMode.Duel) === GameMode.Duel) mapName += ' (Land Rush)';
        if ((pktMapEntry!.GameModes & GameMode.NavalWar) === GameMode.NavalWar) mapName += ' (Naval War)';
      }
    }

    // not really used, likely empty, but if this is filled in it's probably better than guessing
    if (mapName === '' && basic.OrderedEntries.some((e) => e.Key.toLowerCase() === 'name')) mapName = basic.readString('Name');

    if (mapName === '') {
      logger.warn(`No valid mapname given or found, reverting to default filename ${fileNameWithoutExtension}`);
      mapName = fileNameWithoutExtension;
    } else {
      logger.info(`Mapname found: ${mapName}`);
    }

    return mapName;
  }

  /// <summary>
  /// Writes the authoritatively resolved map properties as JSON, for consumers
  /// like the web portal that would otherwise have to re-parse the map INI.
  /// </summary>
  static writeMetadataJson(
    filePath: string,
    resolvedName: string,
    mapFile: MapFile,
    map: MapRenderer,
    saveRect: Rectangle,
    stats: MapStats | null,
    engine: EngineType,
  ): void {
    try {
      const basic = mapFile.getSection('Basic');

      // start waypoints counted straight from the ini: MapFile.Waypoints is gated on
      // MultiplayerOnly, but maps missing that flag still carry playable starts
      let startPositions = 0;
      const wpSection = mapFile.getSection('Waypoints');
      if (wpSection != null) {
        for (const kv of wpSection.OrderedEntries) {
          if (/^-?\d+$/.test(kv.Key) && parseInt(kv.Key, 10) < 8 && /^-?\d+$/.test(kv.Value.toString()))
            startPositions++;
        }
      }

      const techStructureTypes: Record<string, number> = {};
      if (stats != null)
        for (const k of [...stats.TechStructureTypes.keys()].sort())
          techStructureTypes[k] = stats.TechStructureTypes.get(k)!;

      const meta = {
        name: RenderEngine.stripPlayersFromName(resolvedName).replace(/  /g, ' ').trim(),
        rawName: resolvedName,
        basicName: basic?.readString('Name') ?? '',
        official: basic?.readBool('Official') ?? false,
        multiplayerOnly: basic?.readBool('MultiplayerOnly') ?? false,
        engine: EngineType[engine],
        theater: TheaterType[map.TheaterType],
        fullSize: { x: mapFile.FullSize.X, y: mapFile.FullSize.Y, width: mapFile.FullSize.Width, height: mapFile.FullSize.Height },
        localSize: { x: mapFile.LocalSize.X, y: mapFile.LocalSize.Y, width: mapFile.LocalSize.Width, height: mapFile.LocalSize.Height },
        startPositions,
        renderedWidth: saveRect.Width,
        renderedHeight: saveRect.Height,
        // Everything needed to map a cell to a pixel in the saved image:
        //   Dx = Rx - Ry + fullSize.width - 1        Dy = Rx + Ry - fullSize.width - 1
        //   x  = Dx * tileWidth / 2      - saveRect.x
        //   y  = (Dy - z) * tileHeight/2 - saveRect.y
        // saveRect is the crop taken out of the drawing surface; without its origin the
        // surface coordinates above cannot be converted to saved-image coordinates.
        saveRect: { x: saveRect.X, y: saveRect.Y, width: saveRect.Width, height: saveRect.Height },
        tileWidth: map.TileWidth,
        tileHeight: map.TileHeight,
        startPositionPixels: map.GetStartPositionPixels().map((sp) => ({
          number: sp.Number,
          cell: { x: sp.Rx, y: sp.Ry, z: sp.Z },
          pixel: { x: sp.X - saveRect.X, y: sp.Y - saveRect.Y },
          surfacePixel: { x: sp.X, y: sp.Y },
        })),
        terrain:
          stats == null
            ? null
            : {
                heightMin: stats.HeightMin,
                heightMax: stats.HeightMax,
                totalTiles: stats.TotalTiles,
                waterTiles: stats.WaterTiles,
                shoreTiles: stats.ShoreTiles,
                cliffTiles: stats.CliffTiles,
                rampTiles: stats.RampTiles,
              },
        resources:
          stats == null
            ? null
            : {
                oreCells: stats.OreCells,
                gemCells: stats.GemCells,
                totalCredits: stats.TotalCredits,
                oreSpawners: stats.OreSpawners,
              },
        objects:
          stats == null
            ? null
            : {
                structures: stats.Structures,
                techStructures: stats.TechStructures,
                techStructureTypes,
                garrisonableStructures: stats.GarrisonableStructures,
                terrainObjects: stats.TerrainObjects,
                units: stats.Units,
                infantry: stats.Infantry,
                aircraft: stats.Aircraft,
                smudges: stats.Smudges,
                hasBridges: stats.HasBridges,
              },
      };
      fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
      logger.info(`Wrote map metadata to ${filePath}`);
    } catch (e) {
      logger.error(`Failed writing metadata JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // numpy .npy v1.0 files so the buffers load directly into analysis scripts
  /// <summary>One row per cell: rx,ry,z,ramp,tile,subtile. The ramp type lives in the tile image
  /// rather than the map, and IsoMapPack5 is LZO, so a script outside the renderer cannot work
  /// either out on its own.</summary>
  static dumpTiles(map: MapRenderer, filePath: string): void {
    const lines: string[] = ['rx,ry,z,ramp,tile,subtile,height,extraX,extraY,extraW,extraH'];
    for (const t of map.GetTiles()) {
      if (t == null) continue;
      const img = (t.Drawable as { GetTileImage(m: unknown): unknown } | null)?.GetTileImage(t) as
        | { RampType: number; Height: number; hasExtraData: boolean; ExtraX: number; ExtraY: number; ExtraWidth: number; ExtraHeight: number }
        | null
        | undefined;
      const ramp = img?.RampType ?? 0;
      const height = img?.Height ?? 0;
      const extra = img != null && img.hasExtraData ? `${img.ExtraX},${img.ExtraY},${img.ExtraWidth},${img.ExtraHeight}` : ',,,';
      lines.push(`${t.Rx},${t.Ry},${t.Z},${ramp},${t.TileNum},${t.SubTile},${height},${extra}`);
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
  }

  static dumpZBuffer(ds: DrawingSurface, filePath: string): void {
    const zb = ds.getZBuffer();
    const data = Buffer.allocUnsafe(zb.length * 2);
    for (let i = 0; i < zb.length; i++) data.writeInt16LE(zb[i], i * 2);
    fs.writeFileSync(filePath, Buffer.concat([RenderEngine.npyHeader('<i2', ds.Height, ds.Width), data]));
  }

  static dumpVoxelMask(ds: DrawingSurface, filePath: string): void {
    const mask = ds.getVoxelMask();
    const data = Buffer.alloc(ds.Height * ds.Width);
    if (mask != null) data.set(mask);
    fs.writeFileSync(filePath, Buffer.concat([RenderEngine.npyHeader('|b1', ds.Height, ds.Width), data]));
  }

  private static npyHeader(descr: string, h: number, w: number): Buffer {
    let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${h}, ${w}), }`;
    const padded = Math.trunc((10 + header.length + 1 + 63) / 64) * 64;
    header = header.padEnd(padded - 10 - 1) + '\n';
    const buf = Buffer.alloc(10 + header.length);
    buf[0] = 0x93;
    buf.write('NUMPY', 1, 'ascii');
    buf[6] = 1;
    buf[7] = 0;
    buf.writeUInt16LE(header.length, 8);
    buf.write(header, 10, 'ascii');
    return buf;
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
    if (found.has('firestrm.ini')) return EngineType.Firestorm;
    if (found.has('ra2.mix')) return EngineType.RedAlert2;
    if (found.has('tibsun.mix')) return EngineType.TiberianSun;
    if (found.has('patch.mix')) return EngineType.TiberianSun;
    return EngineType.RedAlert2;
  }
}
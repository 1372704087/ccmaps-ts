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
import { resizeRegionBox } from '../rendering/ImageUtil.js';
import { Rand } from '../shared/Util.js';
import { DrawingSurface, SurfaceFormat } from '../rendering/DrawingSurface.js';
import { PsdExporter } from '../rendering/PsdExporter.js';

export class RenderEngine {
  /** Engine chosen by the last render (explicit or auto-detected). */
  LastEngine: EngineType | null = null;

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
    this.LastEngine = engine;

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
    renderer.TrackCategories = settings.SavePSD;
    if (settings.ReportProgress || settings.ProgressSink != null) {
      const sink = settings.ProgressSink
        ?? ((pct: number, phase: string) => process.stdout.write(`progress:${Math.trunc(pct)}:${phase}\n`));
      renderer.Progress = new RenderProgress(sink);
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
    // A 500x500 map renders to 29760x14805 pixels: 3 B colour + 2 B depth per pixel, ~2.2 GB in
    // one canvas. When that does not fit the band budget we draw the map in horizontal strips and
    // downscale each strip into the preview straight away, so the canvas stays at strip size.
    const fullRect = renderer.GetFullMapSizePixels();
    const fullPixels = Math.max(1, fullRect.Width) * Math.max(1, fullRect.Height);
    let bandHeight = settings.BandHeight;
    const bandTrigger = Math.min(
      RenderEngine.DefaultBandThreshold,
      settings.MaxSurfacePixels > 0 ? settings.MaxSurfacePixels : Number.POSITIVE_INFINITY,
    );
    if (bandHeight <= 0 && fullPixels > bandTrigger && settings.PreviewWidth > 0) {
      const budgetPixels = 32_000_000; // ~160 MB of pixels + depth per strip
      bandHeight = Math.min(4096, Math.max(512, Math.trunc(budgetPixels / Math.max(1, fullRect.Width))));
    }
    const banded = bandHeight > 0 && bandHeight < Math.max(1, fullRect.Height) && settings.PreviewWidth > 0
      && !settings.SavePSD;
    if (settings.SavePSD) {
      // PSD layers cannot come from banded strips, and each layer holds a full-width RGBA
      // buffer, so cap the canvas well below the flat-image path's limit.
      const maxPsdPixels = 32_000_000;
      if (fullPixels > maxPsdPixels || fullRect.Width > 30000 || fullRect.Height > 30000) {
        logger.fatal(
          `PSD export needs the whole map in memory (map is ${fullRect.Width}x${fullRect.Height}); ` +
          'use PNG/JPEG or a smaller map',
        );
        renderer.FreeUseless();
        return EngineResult.SurfaceTooLarge;
      }
    }
    // The cap protects the surface actually allocated. A banded preview only ever holds one strip,
    // so a 500x500 map that would need a 2.2 GB full canvas is fine when it is downscaled band by band.
    if (!banded && settings.MaxSurfacePixels > 0 && fullPixels > settings.MaxSurfacePixels) {
      logger.fatal(
        `Map surface needs ${fullPixels} pixels, above the ${settings.MaxSurfacePixels} limit; ` +
          'set --preview-width to render a downscaled preview, or raise the limit',
      );
      renderer.FreeUseless();
      return EngineResult.SurfaceTooLarge;
    }

    if (banded) {
      let outPath = '';
      if (settings.OutputSink == null) {
        outPath = RenderEngine.resolveOutputPath(settings, mapName);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
      }
      const mapStats = settings.MetadataOutFile !== '' || settings.StatsSink != null ? renderer.ComputeStats() : null;
      if (mapStats != null && settings.StatsSink != null) settings.StatsSink(mapStats);
      const save = settings.OutputSink
        ? (canvas: DrawingSurface) => settings.OutputSink!(canvas, new Rectangle(0, 0, canvas.Width, canvas.Height))
        : (canvas: DrawingSurface) =>
            RenderEngine.saveImage(canvas, outPath, settings, new Rectangle(0, 0, canvas.Width, canvas.Height));
      const previewLayout: { sourceRect?: Rectangle } = {};
      const previewRect = RenderEngine.renderBandedPreview(renderer, settings, save, bandHeight, previewLayout);
      if (previewRect.Width <= 0 || previewRect.Height <= 0) {
        renderer.FreeUseless();
        return EngineResult.SurfaceTooLarge;
      }
      if (settings.MetadataOutFile !== '') {
        RenderEngine.writeMetadataJson(
          settings.MetadataOutFile,
          resolvedName,
          mapFile,
          renderer,
          previewLayout.sourceRect ?? previewRect,
          previewRect,
          mapStats,
          engine,
        );
      }
      renderer.FreeUseless();
      return EngineResult.RenderedOk;
    }

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
    let outPath = '';
    if (settings.OutputSink == null) {
      outPath = RenderEngine.resolveOutputPath(settings, mapName);
    }
    const sizeRect = renderer.GetSizePixels(settings.SizeMode);
    logger.debug(`size rect ${sizeRect.Left},${sizeRect.Top},${sizeRect.Width}x${sizeRect.Height}`);
    const surfaceBounds = new Rectangle(0, 0, renderer.GetDrawingSurface().Width, renderer.GetDrawingSurface().Height);
    const saveRect = RenderEngine.applyOutputFraming(sizeRect, settings, surfaceBounds);
    if (saveRect.Width <= 0 || saveRect.Height <= 0) {
      logger.error('The crop/framing left an empty output rect');
      renderer.FreeUseless();
      return EngineResult.Exception;
    }
    // stats need the rules, which FreeUseless disposes below
    const mapStats = settings.MetadataOutFile !== '' || settings.StatsSink != null ? renderer.ComputeStats() : null;
    if (mapStats != null && settings.StatsSink != null) settings.StatsSink(mapStats);
    if (settings.OutputSink == null) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const surface = renderer.GetDrawingSurface();
    let outputSurface = surface;
    let outputRect = saveRect;
    if (!settings.SavePSD && settings.PreviewWidth > 0 && saveRect.Width > settings.PreviewWidth) {
      const targetWidth = settings.PreviewWidth;
      const targetHeight = Math.max(1, Math.round((saveRect.Height * targetWidth) / saveRect.Width));
      outputSurface = resizeRegionBox(surface, saveRect, targetWidth, targetHeight);
      outputRect = new Rectangle(0, 0, targetWidth, targetHeight);
      logger.info(`Downscaling saved image to ${targetWidth}x${targetHeight}`);
    }
    if (settings.SavePSD && settings.OutputSink == null) {
      PsdExporter.save(outPath, surface, saveRect);
      logger.info(`Saved layered PSD ${outPath}`);
      if (settings.PsdPreview) {
        // Browsers cannot decode PSD, so the web UI previews this flattened PNG instead.
        const previewPath = outPath.replace(/\.psd$/i, '') + '.preview.png';
        const maxWidth = RenderEngine.PsdPreviewMaxWidth;
        const requestedWidth = settings.PreviewWidth > 0 ? settings.PreviewWidth : maxWidth;
        const targetWidth = Math.min(saveRect.Width, requestedWidth, maxWidth);
        if (saveRect.Width > targetWidth) {
          const targetHeight = Math.max(1, Math.round((saveRect.Height * targetWidth) / saveRect.Width));
          const previewSurface = resizeRegionBox(surface, saveRect, targetWidth, targetHeight);
          previewSurface.savePNG(previewPath, settings.PNGQuality, 0, 0, targetWidth, targetHeight);
          logger.info(`Saved PSD preview ${targetWidth}x${targetHeight} to ${previewPath}`);
        } else {
          surface.savePNG(previewPath, settings.PNGQuality, saveRect.Left, saveRect.Top, saveRect.Width, saveRect.Height);
          logger.info(`Saved PSD preview to ${previewPath}`);
        }
      }
    } else if (settings.OutputSink != null) {
      settings.OutputSink(outputSurface, outputRect);
    } else {
      RenderEngine.saveImage(outputSurface, outPath, settings, outputRect);
      logger.info(`Saved ${outPath}`);
    }

    if (settings.MetadataOutFile !== '')
      RenderEngine.writeMetadataJson(
        settings.MetadataOutFile,
        resolvedName,
        mapFile,
        renderer,
        saveRect,
        outputRect,
        mapStats,
        engine,
      );

    renderer.FreeUseless();
    return EngineResult.RenderedOk;
  }

  /// <summary>Applies the optional crop and aspect framing to a size rect. Crop values are
  /// fractions of the rect, so a preset keeps working when Auto selects Local or Full.</summary>
  static applyOutputFraming(rect: Rectangle, settings: RenderSettings, bounds?: Rectangle): Rectangle {
    if (rect.Width <= 0 || rect.Height <= 0) return Rectangle.Empty;
    const base = rect.Clone();
    if (bounds != null) base.Intersect(bounds);
    if (base.Width <= 0 || base.Height <= 0) return Rectangle.Empty;

    const clamp01 = (n: number): number => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
    const x = clamp01(settings.CropX);
    const y = clamp01(settings.CropY);
    const w = clamp01(settings.CropWidth);
    const h = clamp01(settings.CropHeight);
    let left = base.Left + Math.round(base.Width * x);
    let top = base.Top + Math.round(base.Height * y);
    left = Math.min(base.Right - 1, Math.max(base.Left, left));
    top = Math.min(base.Bottom - 1, Math.max(base.Top, top));
    let width = Math.max(1, Math.round(base.Width * w));
    let height = Math.max(1, Math.round(base.Height * h));
    width = Math.min(width, base.Right - left);
    height = Math.min(height, base.Bottom - top);

    const ratios: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '9:16': 9 / 16 };
    const target = ratios[settings.OutputAspect];
    if (target != null && width > 0 && height > 0) {
      if (width / height > target) {
        const newWidth = Math.max(1, Math.round(height * target));
        left += Math.trunc((width - newWidth) / 2);
        width = newWidth;
      } else if (width / height < target) {
        const newHeight = Math.max(1, Math.round(width / target));
        top += Math.trunc((height - newHeight) / 2);
        height = newHeight;
      }
    }
    return new Rectangle(left, top, Math.max(1, width), Math.max(1, height));
  }

  /// <summary>Above this many pixels (full canvas) a preview is drawn strip by strip.</summary>
  static DefaultBandThreshold = 120_000_000;

  /// <summary>Longest edge of the flattened PNG written next to a layered PSD.</summary>
  static PsdPreviewMaxWidth = 2048;

  /// <summary>Draws the map in horizontal strips and downscales each strip straight into the
  /// preview image, so the peak canvas is one strip instead of the whole map.</summary>
  static renderBandedPreview(renderer: MapRenderer, settings: RenderSettings, save: (canvas: DrawingSurface) => void, bandHeight: number, layout?: { sourceRect?: Rectangle }): Rectangle {
    // The preview is "the size-mode rect scaled to the requested width", exactly as the single
    // canvas path saves it. That rect is only final once every tile has been drawn (the local view
    // is trimmed by the cutoff row), so the strips are laid out against the full map and pasted
    // onto the size-mode rect's grid as they are drawn.
    const fullRect = renderer.GetFullMapSizePixels();
    const fullWidth = Math.max(1, fullRect.Width);
    const fullHeight = Math.max(1, fullRect.Height);
    // the cutoff row that trims the local view comes out of the tile pass, so a strip render has
    // to walk the tiles once on a throwaway surface before it can lay out the preview
    renderer.MeasureTileTouchState();
    const sizeRect = RenderEngine.applyOutputFraming(renderer.GetSizePixels(settings.SizeMode), settings, fullRect);
    if (sizeRect.Width <= 0 || sizeRect.Height <= 0) {
      logger.error('The crop/framing left an empty output rect');
      return Rectangle.Empty;
    }
    if (layout) layout.sourceRect = sizeRect.Clone();
    const targetWidth = settings.PreviewWidth;
    const scale = targetWidth / Math.max(1, sizeRect.Width);
    const canvasHeight = Math.max(1, Math.round(sizeRect.Height * scale));
    if (settings.MaxSurfacePixels > 0 && targetWidth * canvasHeight > settings.MaxSurfacePixels) {
      logger.fatal(
        `Preview surface would need ${targetWidth * canvasHeight} pixels, above the ${settings.MaxSurfacePixels} limit; ` +
          'lower --preview-width or raise the limit',
      );
      return Rectangle.Empty;
    }
    const canvas = new DrawingSurface(targetWidth, canvasHeight, SurfaceFormat.Bgr24);
    const originX = sizeRect.Left;
    const originY = sizeRect.Top;
    logger.info(
      `Rendering ${fullWidth}x${fullHeight} map in strips of ${bandHeight}px -> ${targetWidth}x${canvasHeight} preview`,
    );

    // rows of the map that actually land on the preview; the size rect may reach past the canvas
    const bandFrom = Math.max(0, originY);
    const bandTo = Math.min(fullHeight, originY + sizeRect.Height);
    for (let top = bandFrom; top < bandTo; top += bandHeight) {
      const h = Math.min(bandHeight, bandTo - top);
      renderer.Draw({ originY: top, height: h });
      if (settings.MarkIceGrowth) renderer.MarkIceGrowth();
      if (settings.TunnelPaths) renderer.PlotTunnels(settings.TunnelPosition);
      if (settings.MarkStartPos) renderer.DrawStartPositions();

      const surface = renderer.GetDrawingSurface();
      const ratio = sizeRect.Height / canvasHeight;
      const dstTop = Math.round((top - originY) / ratio);
      const dstBottom = Math.round((top + h - originY) / ratio);
      const dstHeight = Math.max(1, dstBottom - dstTop);
      // the strip's share of the preview row range, expressed back in map rows, so each strip is
      // sampled exactly where the single-canvas box filter would have sampled it
      const localTop = Math.max(0, Math.round(dstTop * ratio) - (top - originY));
      const localHeight = Math.max(1, Math.min(h - localTop, Math.round(dstHeight * ratio)));
      const scaled = resizeRegionBox(
        surface,
        new Rectangle(originX, localTop, sizeRect.Width, localHeight),
        targetWidth,
        dstHeight,
      );
      // paste the strip onto the preview, clipping against its edges
      const x0 = 0;
      const x1 = Math.min(scaled.Width, canvas.Width);
      const y0 = Math.max(0, -dstTop);
      const y1 = Math.min(scaled.Height, canvas.Height - dstTop);
      for (let y = y0; y < y1; y++) {
        const srcStart = (y * scaled.Width + x0) * 3;
        const dstStart = ((dstTop + y) * canvas.Width + x0) * 3;
        canvas.data.set(scaled.data.subarray(srcStart, srcStart + (x1 - x0) * 3), dstStart);
      }
      logger.info(`Strip ${top}-${top + h} done`);
      renderer.ReleaseDrawingSurface();
    }

    save(canvas);
    logger.info(`Saved preview (${canvas.Width}x${canvas.Height})`);
    return new Rectangle(0, 0, canvas.Width, canvas.Height);
  }

  /// <summary>Resolves the output image path (PNG unless JPEG was explicitly requested).</summary>
  static resolveOutputPath(settings: RenderSettings, mapName: string): string {
    const baseExt = path.extname(mapName);
    let outBase = settings.OutputFile !== '' ? settings.OutputFile : path.join(path.dirname(mapName), path.basename(mapName, baseExt));
    if (settings.OutputDir !== '') outBase = path.join(settings.OutputDir, path.basename(outBase));
    const ext = settings.SavePSD ? '.psd' : (settings.SaveJPEG && !settings.SavePNG ? '.jpg' : '.png');
    return outBase.replace(/\.(png|jpg|jpeg|psd)$/i, '') + ext;
  }

  private static saveImage(
    surface: DrawingSurface,
    outPath: string,
    settings: RenderSettings,
    rect: Rectangle,
  ): void {
    if (settings.SaveJPEG && !settings.SavePNG) {
      surface.saveJPEG(
        outPath,
        settings.JPEGCompression,
        rect.Left,
        rect.Top,
        rect.Width,
        rect.Height,
      );
    } else {
      surface.savePNG(
        outPath,
        settings.PNGQuality,
        rect.Left,
        rect.Top,
        rect.Width,
        rect.Height,
      );
    }
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
    sourceRect: Rectangle,
    outputRect: Rectangle,
    stats: MapStats | null,
    engine: EngineType,
  ): void {
    try {
      const basic = mapFile.getSection('Basic');

      // VERA20k maps declare their starts with [Basic] MaxPlayers plus a complete
      // waypoint run; ordinary maps keep the native 0..7 range.
      const startPositions = mapFile.StartCapacity;

      const techStructureTypes: Record<string, number> = {};
      if (stats != null)
        for (const k of [...stats.TechStructureTypes.keys()].sort())
          techStructureTypes[k] = stats.TechStructureTypes.get(k)!;

      const scaleX = sourceRect.Width > 0 ? outputRect.Width / sourceRect.Width : 1;
      const scaleY = sourceRect.Height > 0 ? outputRect.Height / sourceRect.Height : 1;
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
        renderedWidth: outputRect.Width,
        renderedHeight: outputRect.Height,
        // Everything needed to map a cell to a pixel in the saved image:
        //   Dx = Rx - Ry + fullSize.width - 1        Dy = Rx + Ry - fullSize.width - 1
        //   x  = Dx * tileWidth / 2      - sourceRect.x
        //   y  = (Dy - z) * tileHeight/2 - sourceRect.y
        // sourceRect is the crop taken out of the drawing surface; without its origin the
        // surface coordinates above cannot be converted to saved-image coordinates. If the
        // image was downscaled to previewWidth, apply scaleX/scaleY to get output pixels.
        saveRect: { x: sourceRect.X, y: sourceRect.Y, width: sourceRect.Width, height: sourceRect.Height },
        renderScale: { x: scaleX, y: scaleY },
        tileWidth: map.TileWidth,
        tileHeight: map.TileHeight,
        startPositionPixels: map.GetStartPositionPixels().map((sp) => ({
          number: sp.Number,
          cell: { x: sp.Rx, y: sp.Ry, z: sp.Z },
          pixel: {
            x: Math.round((sp.X - sourceRect.X) * scaleX),
            y: Math.round((sp.Y - sourceRect.Y) * scaleY),
          },
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

// Port of CNCMaps.Shared.RenderSettings (CLI options holder)
import { EngineType, SizeMode, StartPositionMarking, PreviewMarkersType } from './Enums.js';
import { logger } from './Log.js';
import type { DrawingSurface } from '../rendering/DrawingSurface.js';
import type { Rectangle } from './Geometry.js';
import type { MapStats } from '../engine/map/MapStats.js';

export class RenderSettings {
  InputFile = '';
  OutputFile = '';
  OutputDir = '';
  SavePNG = false;
  SaveJPEG = false;
  /** Write a layered PSD (one layer per object category) instead of a flat PNG/JPEG. */
  SavePSD = false;
  /** With SavePSD, also write a flattened <name>.preview.png next to the PSD so browsers
   * (which cannot decode PSD) can show a preview. */
  PsdPreview = false;
  PNGQuality = 4; // deflate level; with unfiltered scanlines this compresses game graphics best for its speed
  JPEGCompression = 95;
  MixFilesDirectories: string[] = [];
  NoExpandMixes = false;
  MetadataOutFile = '';
  ShowHelp = false;
  MarkOreFields = false;
  IgnoreLighting = false;
  SizeMode: SizeMode = SizeMode.Auto;
  /** Downscale the saved PNG to this width; 0 keeps the full render size. */
  PreviewWidth = 0;
  /** Output framing is applied to the selected size rect before scaling. Crop values are
   * fractions of that rect, so they survive Local/Full size changes. */
  CropX = 0;
  CropY = 0;
  CropWidth = 1;
  CropHeight = 1;
  /** 'free' keeps the framed rect's aspect; other values centre-crop to the requested aspect. */
  OutputAspect = 'free';
  /** Draw the map in strips of this many pixels instead of one canvas; 0 = auto (strip when the
   * full canvas gets too big) and -1 = never strip. */
  BandHeight = 0;
  Engine: EngineType = EngineType.AutoDetect;
  StartPositionMarking: StartPositionMarking = StartPositionMarking.None;
  MarkStartPos = false;
  MarkerStartSize: number | null = null;
  FixupTiles = false;
  GeneratePreviewPack = false;
  PreviewMarkers: PreviewMarkersType = PreviewMarkersType.None;
  FixPreviewDimensions = true;
  Debug = false;
  DebugZBufferFile = '';
  DebugVoxelMaskFile = '';
  DebugTilesFile = '';
  ReportProgress = false;
  MarkIceGrowth = false;
  FixOverlays = false;
  CompressTiles = false;
  TunnelPaths = false;
  TunnelPosition = false;
  TileLattice = '';
  VeinRandomizer = '';
  PinRandomDraws = false;
  AnimFrame = -1;

  /// <summary>When set, the renderer hands back the finished surface instead of
  /// writing a PNG. Used by the browser worker, where encoding happens on a canvas.</summary>
  OutputSink: ((surface: DrawingSurface, rect: Rectangle) => void) | null = null;
  /** Receives map statistics when the caller asks for the analysis card. */
  StatsSink: ((stats: MapStats) => void) | null = null;
  /// <summary>Optional progress callback; takes precedence over stdout progress lines.</summary>
  ProgressSink: ((percent: number, phase: string) => void) | null = null;
  /// <summary>Safety limit for in-memory rendering (0 = unlimited).</summary>
  MaxSurfacePixels = 0;

  /** Write a JSON benchmark record (render time, peak RSS, output bytes, pixel hash). */
  BenchJsonFile = '';
  /** Write the rendered PNG's pixel hash (sha256 over the decoded RGB rows). */
  PixelHashFile = '';
  /** Upper bound for layered PSD export (0 = the engine's 32M-pixel default). */
  PsdMaxPixels = 0;

  /// <summary>The game's own multiplayer colour order: start position N carries colour N.
  /// Read off captures whose spawn pinned one player per start position.</summary>
  static readonly DefaultPreCaptureColors: string[] = [
    'Gold',
    'DarkRed',
    'DarkBlue',
    'DarkGreen',
    'Orange',
    'DarkSky',
    'Purple',
    'Magenta',
  ];

  private static parsePreCaptureColors(value: string): (string | null)[] | null {
    if (value == null || value.trim() === '') return [...RenderSettings.DefaultPreCaptureColors];
    if (value.trim().toLowerCase() === 'none') return null;
    const parts = value.split(',');
    const colors: (string | null)[] = new Array(RenderSettings.DefaultPreCaptureColors.length).fill(null);
    for (let i = 0; i < colors.length && i < parts.length; i++) {
      const name = parts[i].trim();
      if (name.length > 0) colors[i] = name;
    }
    return colors;
  }

  PreCaptureColors: (string | null)[] | null = [...RenderSettings.DefaultPreCaptureColors];

  private readonly helpEntries: { invocation: string; description: string }[] = [];

  ConfigureFromArgs(args: string[]): void {
    const applications: Array<() => void> = [];

    const registerFlag = (names: string[], description: string, apply: () => void) => {
      this.helpEntries.push({ invocation: names.join(', '), description });
      applications.push(() => {
        if (findFlag(names)) apply();
      });
    };
    const registerValue = (names: string[], description: string, apply: (v: string) => void) => {
      this.helpEntries.push({ invocation: names.join(', ') + '=VALUE', description });
      applications.push(() => {
        const v = findValue(names);
        if (v !== null) apply(v);
      });
    };

    const findFlag = (names: string[]): boolean => {
      for (const name of names) {
        if (args.includes(name)) return true;
      }
      return false;
    };
    const findValue = (names: string[]): string | null => {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        for (const name of names) {
          if (a === name && i + 1 < args.length) return args[i + 1];
          if (a.startsWith(name + '=')) return a.substring(name.length + 1);
        }
      }
      return null;
    };

    registerFlag(['--help', '-h'], 'Show this short help text', () => (this.ShowHelp = true));
    registerValue(['--infile', '-i'], 'Input file', (v) => (this.InputFile = v));
    registerValue(['--outfile', '-o'], 'Output file, without extension, read from map if not specified.', (v) => (this.OutputFile = v));
    registerValue(['--outdir', '-d'], 'Output directory', (v) => (this.OutputDir = v));
    registerFlag(['--force-ra2', '-y'], 'Force using the Red Alert 2 engine for rendering', () => (this.Engine = EngineType.RedAlert2));
    registerFlag(['--force-yr', '-Y'], "Force using the Yuri's Revenge engine for rendering", () => (this.Engine = EngineType.YurisRevenge));
    registerFlag(['--force-ts', '-t'], 'Force using the Tiberian Sun engine for rendering', () => (this.Engine = EngineType.TiberianSun));
    registerFlag(['--force-fs', '-T'], 'Force using the Firestorm engine for rendering', () => (this.Engine = EngineType.Firestorm));
    registerFlag(['--output-jpg', '-j'], 'Output JPEG file', () => (this.SaveJPEG = true));
    registerValue(['--jpeg-quality', '-q'], 'Set JPEG quality level (1-100)', (v) => {
      const n = parseInt(v, 10);
      this.JPEGCompression = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 92;
    });
    registerFlag(['--output-png', '-p'], 'Output PNG file', () => (this.SavePNG = true));
    registerFlag(['--output-psd'], 'Output a layered PSD (terrain, buildings, infantry, vehicles, aircraft, naval, terrain objects, overlays, smudges)', () => (this.SavePSD = true));
    registerFlag(['--psd-preview'], 'With --output-psd, also write a flattened PNG preview (<name>.preview.png)', () => (this.PsdPreview = true));
    registerValue(['--psd-max-pixels'], 'Maximum pixel count for layered PSD export (default 32000000)', (v) => {
      const n = parseInt(v, 10);
      this.PsdMaxPixels = Number.isFinite(n) ? Math.max(0, n) : 0;
    });
    registerValue(['--png-compression', '-c'], 'Set PNG compression level (1-9)', (v) => {
      const n = parseInt(v, 10);
      // zlib throws RangeError outside 0..9; a bad CLI/API value must not kill the render.
      this.PNGQuality = Number.isFinite(n) ? Math.min(9, Math.max(1, n)) : 4;
    });
    registerValue(['--mixdir', '-m'], 'Specify location of .mix files, read from registry if not specified (win only). May be repeated', (v) => {
      if (v.trim() !== '') this.MixFilesDirectories.push(v);
    });
    registerFlag(['--no-expand-mixes'], 'Skip the expand(md)##.mix files. The CnCNet spawner never loads them, so a map rendered for CnCNet play should not use them either', () => (this.NoExpandMixes = true));
    registerValue(['--meta-json'], 'Write resolved map metadata (name, engine, theater, size, start positions) as JSON to the given file', (v) => (this.MetadataOutFile = v));
    registerValue(['--bench-json'], 'Write a JSON benchmark record (render time, peak RSS, output bytes, pixel hash) to the given file', (v) => (this.BenchJsonFile = v));
    registerValue(['--pixel-hash'], 'Write the rendered PNG pixel hash (sha256 of the decoded RGB rows) to the given file', (v) => (this.PixelHashFile = v));
    registerFlag(['--progress'], 'Print machine-readable render progress to stdout as progress:N:phase lines', () => (this.ReportProgress = true));
    registerFlag(['--mark-start-pos'], 'Mark starting positions', () => (this.MarkStartPos = true));
    registerFlag(['--start-pos-squared', '-S'], 'Mark starting positions in a squared manner', () => (this.StartPositionMarking = StartPositionMarking.Squared));
    registerFlag(['--start-pos-circled'], 'Mark starting positions in a circled manner', () => (this.StartPositionMarking = StartPositionMarking.Circled));
    registerFlag(['--start-pos-diamond'], 'Mark starting positions in a diamond manner', () => (this.StartPositionMarking = StartPositionMarking.Diamond));
    registerFlag(['--start-pos-ellipsed'], 'Mark starting positions in a ellipsed manner', () => (this.StartPositionMarking = StartPositionMarking.Ellipsed));
    registerFlag(['--start-pos-star'], 'Mark starting positions in a star manner', () => (this.StartPositionMarking = StartPositionMarking.Starred));
    registerFlag(['--start-pos-tiled', '-s'], 'Mark starting positions in a tiled manner', () => (this.StartPositionMarking = StartPositionMarking.Tiled));
    registerValue(['--start-pos-size'], 'Mark starting positions with given size (2-6), defaults to 4, or 3 for tiled markers on TS/FS', (v) => {
      const n = parseFloat(v);
      this.MarkerStartSize = Number.isFinite(n) ? Math.min(6, Math.max(2, n)) : null;
    });
    registerFlag(['--mark-ore', '-r'], 'Mark ore and gem fields more explicity, looks good when resizing to a preview', () => (this.MarkOreFields = true));
    registerFlag(['--force-fullmap', '-F'], 'Ignore LocalSize definition and just save the full map', () => (this.SizeMode = SizeMode.Full));
    registerFlag(['--force-localsize', '-f'], 'Use localsize for map dimensions; without this or -F the size is picked automatically', () => (this.SizeMode = SizeMode.Local));
    registerValue(['--preview-width'], 'Downscale the saved image to this pixel width (0 = full render size, max 8192)', (v) => {
      const n = parseInt(v, 10);
      this.PreviewWidth = Number.isFinite(n) ? Math.min(8192, Math.max(0, n)) : 0;
    });
    registerValue(['--band-height'], 'Draw the map in strips of this many pixels and downscale each strip into the preview (0 = strip only when the full canvas exceeds the budget, -1 = never strip)', (v) => {
      const n = parseInt(v, 10);
      this.BandHeight = Number.isFinite(n) ? Math.max(-1, n) : 0;
    });
    registerValue(['--crop'], 'Crop output before scaling: x,y,width,height as percentages of the selected size rect (e.g. 10,10,80,80)', (v) => {
      const parts = v.split(',').map((x) => parseFloat(x));
      if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return;
      const [x, y, w, h] = parts.map((n) => Math.min(100, Math.max(0, n)));
      this.CropX = x / 100; this.CropY = y / 100;
      this.CropWidth = Math.max(0.001, w / 100);
      this.CropHeight = Math.max(0.001, h / 100);
    });
    registerValue(['--aspect'], 'Centre-crop the framed output to an aspect ratio: 1:1, 4:5, 16:9 or 9:16 (default free)', (v) => {
      this.OutputAspect = ['1:1', '4:5', '16:9', '9:16'].includes(v) ? v : 'free';
    });
    registerValue(['--max-surface-pixels'], 'Abort when the full render surface would exceed this pixel count (0 = unlimited)', (v) => {
      const n = parseInt(v, 10);
      this.MaxSurfacePixels = Number.isFinite(n) ? Math.max(0, n) : 0;
    });
    registerFlag(['--debug', '-D'], 'Enable debug-level logging', () => (this.Debug = true));
    registerValue(['--debug-zbuffer'], "Write the render's z-buffer (.npy) to the given path for diagnostics", (v) => (this.DebugZBufferFile = v));
    registerValue(['--debug-tiles'], "Write one CSV row per map cell (rx,ry,z,ramp,tile,subtile) for diagnostics that need to know a cell's height or slope", (v) => (this.DebugTilesFile = v));
    registerValue(['--debug-voxelmask'], 'Write a mask (.npy) of the pixels drawn by the voxel rasterizer, so a comparison against a game capture can exclude them: the game shades voxels differently on purpose', (v) => (this.DebugVoxelMaskFile = v));
    registerValue(['--tile-lattice'], 'Override the 8x8 tile-variant lattice with 64 comma-separated values 0-7 (row-major), e.g. one exported from an engine capture', (v) => (this.TileLattice = v));
    registerValue(['--vein-rng'], "Tiberian Sun: replay the engine's vein placement rolls from a scenario randomizer state, 252 comma-separated values (Index1, Index2, Table[250]) as exported by an engine capture", (v) => (this.VeinRandomizer = v));
    registerFlag(['--pin-random'], 'Pin every randomised draw choice (animation loop frame, random SHP frame, building fire art, generated veins) to its first option, so a render is byte-comparable with an engine capture whose game logic was frozen', () => (this.PinRandomDraws = true));
    registerValue(['--anim-frame'], 'Draw every animation at the frame the game engine shows at game-loop frame VALUE, for comparing against an engine capture whose logic was frozen at that frame', (v) => {
      const n = parseInt(v, 10);
      this.AnimFrame = Number.isFinite(n) ? Math.max(-1, n) : -1;
    });
    registerFlag(['--replace-preview-nomarkers', '-k'], 'Update the maps [PreviewPack] data with the rendered image, using no markers on the start positions', () => {
      this.GeneratePreviewPack = true;
      this.PreviewMarkers = PreviewMarkersType.None;
    });
    registerFlag(['--preview-markers-selected', '-K'], 'Update the maps [PreviewPack] data with the rendered image, using the selected options of marker type and size on the start positions', () => {
      this.GeneratePreviewPack = true;
      this.PreviewMarkers = PreviewMarkersType.SelectedAsAbove;
    });
    registerFlag(['--preview-markers-bittah', '-l'], "Update the maps [PreviewPack] data with the rendered image, using Bittah's image on the start positions", () => {
      this.GeneratePreviewPack = true;
      this.PreviewMarkers = PreviewMarkersType.Bittah;
    });
    registerFlag(['--preview-markers-aro', '-L'], "Update the maps [PreviewPack] data with the rendered image, using Aro's image on the start positions", () => {
      this.GeneratePreviewPack = true;
      this.PreviewMarkers = PreviewMarkersType.Aro;
    });
    registerFlag(['--ignore-lighting', '-n'], 'Ignore all lighting and lamps on the map', () => (this.IgnoreLighting = true));
    registerFlag(['--no-preview-fixup', '-x'], 'Do not fix the [Preview] dimensions when injecting the rendered preview', () => (this.FixPreviewDimensions = false));
    registerFlag(['--fixup-tiles'], 'Remove undefined tiles and overwrite IsoMapPack5 section in map', () => (this.FixupTiles = true));
    registerFlag(['--icegrowth', '-g'], 'Mark cells with ice growth set, used in TS snow maps', () => (this.MarkIceGrowth = true));
    registerFlag(['--fix-overlays'], 'Remove undefined overlays and update overlay packs in map', () => (this.FixOverlays = true));
    registerFlag(['--cmprs-tiles'], 'Compress and update IsoMapPack5 in map', () => (this.CompressTiles = true));
    registerFlag(['--tunnels'], 'Show tunnels path lines', () => (this.TunnelPaths = true));
    registerFlag(['--tunnelpos'], 'Adjust position of tunnel path lines', () => (this.TunnelPosition = true));
    registerValue(['--precapture'], 'Colour of each start position A-H for objects a map trigger hands to a starting player at game start (oil derricks and other tech buildings): one rules [Colors] name per position, comma-separated, empty where nobody starts, or "none" to leave them neutral grey. Default ' + RenderSettings.DefaultPreCaptureColors.join(','), (v) => (this.PreCaptureColors = RenderSettings.parsePreCaptureColors(v)));

    for (const apply of applications) apply();

    // warn about unknown options
    const known = new Set<string>();
    for (const e of this.helpEntries) for (const p of e.invocation.split(', ')) known.add(p);
    const isKnown = (a: string): boolean => {
      if (known.has(a)) return true;
      // a value option may be passed as "--name value", so the bare name matches
      // the "--name=VALUE" help entry
      for (const p of known) if (p.endsWith('=VALUE') && p.substring(0, p.length - 6) === a) return true;
      return false;
    };
    for (const a of args) {
      if (a.startsWith('-') && !a.includes('=') && !isKnown(a)) {
        logger.warn(`Unknown option '${a}' passed`);
      }
    }
  }

  GetHelpText(): string {
    if (this.helpEntries.length === 0) this.ConfigureFromArgs([]);
    let sb = '';
    for (const e of this.helpEntries) sb += '  ' + e.invocation.padEnd(30) + e.description + '\n';
    return sb;
  }
}

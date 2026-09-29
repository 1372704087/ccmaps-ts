// Port of CNCMaps.Shared.RenderSettings (CLI options holder)
import { EngineType, SizeMode, StartPositionMarking, PreviewMarkersType } from './Enums.js';
import { logger } from './Log.js';

export class RenderSettings {
  InputFile = '';
  OutputFile = '';
  OutputDir = '';
  SavePNG = false;
  SaveJPEG = false;
  PNGQuality = 4; // deflate level; with unfiltered scanlines this compresses game graphics best for its speed
  JPEGCompression = 95;
  MixFilesDirectories: string[] = [];
  ModConfig = '';
  NoExpandMixes = false;
  MetadataOutFile = '';
  ShowHelp = false;
  MarkOreFields = false;
  IgnoreLighting = false;
  SizeMode: SizeMode = SizeMode.Auto;
  Engine: EngineType = EngineType.AutoDetect;
  StartPositionMarking: StartPositionMarking = StartPositionMarking.None;
  MarkStartPos = false;
  MarkerStartSize: number | null = null;
  PreferOSMesa = false;
  ThumbnailConfig = '';
  ThumbnailMarkers: StartPositionMarking = StartPositionMarking.None;
  FixupTiles = false;
  GeneratePreviewPack = false;
  PreviewMarkers: PreviewMarkersType = PreviewMarkersType.None;
  SavePNGThumbnails = false;
  FixPreviewDimensions = true;
  Debug = false;
  DebugZBufferFile = '';
  DebugVoxelMaskFile = '';
  DebugTilesFile = '';
  ReportProgress = false;
  MarkIceGrowth = false;
  Backup = false;
  FixOverlays = false;
  CompressTiles = false;
  TunnelPaths = false;
  TunnelPosition = false;
  TileLattice = '';
  VeinRandomizer = '';
  PinRandomDraws = false;
  AnimFrame = -1;

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
    registerValue(['--jpeg-quality', '-q'], 'Set JPEG quality level (0-100)', (v) => (this.JPEGCompression = parseInt(v, 10)));
    registerFlag(['--output-png', '-p'], 'Output PNG file', () => (this.SavePNG = true));
    registerValue(['--png-compression', '-c'], 'Set PNG compression level (1-9)', (v) => (this.PNGQuality = parseInt(v, 10)));
    registerValue(['--mixdir', '-m'], 'Specify location of .mix files, read from registry if not specified (win only). May be repeated', (v) => {
      if (v.trim() !== '') this.MixFilesDirectories.push(v);
    });
    registerFlag(['--no-expand-mixes'], 'Skip the expand(md)##.mix files. The CnCNet spawner never loads them, so a map rendered for CnCNet play should not use them either', () => (this.NoExpandMixes = true));
    registerValue(['--modconfig', '-M'], 'Filename of a game configuration specific to your mod (create with GUI)', (v) => (this.ModConfig = v));
    registerValue(['--meta-json'], 'Write resolved map metadata (name, engine, theater, size, start positions) as JSON to the given file', (v) => (this.MetadataOutFile = v));
    registerFlag(['--progress'], 'Print machine-readable render progress to stdout as progress:N:phase lines', () => (this.ReportProgress = true));
    registerFlag(['--mark-start-pos'], 'Mark starting positions', () => (this.MarkStartPos = true));
    registerFlag(['--start-pos-squared', '-S'], 'Mark starting positions in a squared manner', () => (this.StartPositionMarking = StartPositionMarking.Squared));
    registerFlag(['--start-pos-circled'], 'Mark starting positions in a circled manner', () => (this.StartPositionMarking = StartPositionMarking.Circled));
    registerFlag(['--start-pos-diamond'], 'Mark starting positions in a diamond manner', () => (this.StartPositionMarking = StartPositionMarking.Diamond));
    registerFlag(['--start-pos-ellipsed'], 'Mark starting positions in a ellipsed manner', () => (this.StartPositionMarking = StartPositionMarking.Ellipsed));
    registerFlag(['--start-pos-star'], 'Mark starting positions in a star manner', () => (this.StartPositionMarking = StartPositionMarking.Starred));
    registerFlag(['--start-pos-tiled', '-s'], 'Mark starting positions in a tiled manner', () => (this.StartPositionMarking = StartPositionMarking.Tiled));
    registerValue(['--start-pos-size'], 'Mark starting positions with given size (2-6), defaults to 4, or 3 for tiled markers on TS/FS', (v) => (this.MarkerStartSize = parseFloat(v)));
    registerFlag(['--mark-ore', '-r'], 'Mark ore and gem fields more explicity, looks good when resizing to a preview', () => (this.MarkOreFields = true));
    registerFlag(['--force-fullmap', '-F'], 'Ignore LocalSize definition and just save the full map', () => (this.SizeMode = SizeMode.Full));
    registerFlag(['--force-localsize', '-f'], 'Use localsize for map dimensions; without this or -F the size is picked automatically', () => (this.SizeMode = SizeMode.Local));
    registerFlag(['--debug', '-D'], '', () => (this.Debug = true));
    registerValue(['--debug-zbuffer'], "Write the render's z-buffer (.npy) to the given path for diagnostics", (v) => (this.DebugZBufferFile = v));
    registerValue(['--debug-tiles'], "Write one CSV row per map cell (rx,ry,z,ramp,tile,subtile) for diagnostics that need to know a cell's height or slope", (v) => (this.DebugTilesFile = v));
    registerValue(['--debug-voxelmask'], 'Write a mask (.npy) of the pixels drawn by the voxel rasterizer, so a comparison against a game capture can exclude them: the game shades voxels differently on purpose', (v) => (this.DebugVoxelMaskFile = v));
    registerValue(['--tile-lattice'], 'Override the 8x8 tile-variant lattice with 64 comma-separated values 0-7 (row-major), e.g. one exported from an engine capture', (v) => (this.TileLattice = v));
    registerValue(['--vein-rng'], "Tiberian Sun: replay the engine's vein placement rolls from a scenario randomizer state, 252 comma-separated values (Index1, Index2, Table[250]) as exported by an engine capture", (v) => (this.VeinRandomizer = v));
    registerFlag(['--pin-random'], 'Pin every randomised draw choice (animation loop frame, random SHP frame, building fire art, generated veins) to its first option, so a render is byte-comparable with an engine capture whose game logic was frozen', () => (this.PinRandomDraws = true));
    registerValue(['--anim-frame'], 'Draw every animation at the frame the game engine shows at game-loop frame VALUE, for comparing against an engine capture whose logic was frozen at that frame', (v) => (this.AnimFrame = parseInt(v, 10)));
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
    registerValue(['--create-thumbnail', '-z'], 'Also save thumbnail(s) along with the fullmap; comma-separated specs [name:][+](x,y)[@q]', (v) => (this.ThumbnailConfig = v));
    registerValue(['--thumb-markers'], "Draw this start position marker style (squared|circled|diamond|ellipsed|star) onto the thumbnails only; it is stamped after the full-size image is saved, so the main render keeps its own marker style", (v) => {
      switch (v.trim().toLowerCase()) {
        case 'squared': this.ThumbnailMarkers = StartPositionMarking.Squared; break;
        case 'circled': this.ThumbnailMarkers = StartPositionMarking.Circled; break;
        case 'diamond': this.ThumbnailMarkers = StartPositionMarking.Diamond; break;
        case 'ellipsed': this.ThumbnailMarkers = StartPositionMarking.Ellipsed; break;
        case 'star':
        case 'starred': this.ThumbnailMarkers = StartPositionMarking.Starred; break;
        // tiled is baked into the tile palettes before drawing, so it cannot be applied per-thumbnail
        default: logger.warn(`Unknown --thumb-markers style '${v}' ignored`); break;
      }
    });
    registerFlag(['--no-preview-fixup', '-x'], 'Do not fix the [Preview] dimensions when injecting the rendered preview', () => (this.FixPreviewDimensions = false));
    registerFlag(['--thumb-png'], 'Save thumbnails as PNG instead of JPEG.', () => (this.SavePNGThumbnails = true));
    registerFlag(['--fixup-tiles'], 'Remove undefined tiles and overwrite IsoMapPack5 section in map', () => (this.FixupTiles = true));
    registerFlag(['--icegrowth', '-g'], 'Mark cells with ice growth set, used in TS snow maps', () => (this.MarkIceGrowth = true));
    registerFlag(['--bkp', '-b'], 'Create map file backup when modifying', () => (this.Backup = true));
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

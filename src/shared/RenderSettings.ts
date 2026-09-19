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
  FixupTiles = false;
  GeneratePreviewPack = false;
  PreviewMarkers: PreviewMarkersType = PreviewMarkersType.None;
  SavePNGThumbnails = false;
  FixPreviewDimensions = true;
  Debug = false;
  ReportProgress = false;
  MarkIceGrowth = false;
  Backup = false;
  FixOverlays = false;
  CompressTiles = false;
  TunnelPaths = false;
  TunnelPosition = false;

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
    registerFlag(['--no-preview-fixup', '-x'], 'Do not fix the [Preview] dimensions when injecting the rendered preview', () => (this.FixPreviewDimensions = false));
    registerFlag(['--thumb-png'], 'Save thumbnails as PNG instead of JPEG.', () => (this.SavePNGThumbnails = true));
    registerFlag(['--fixup-tiles'], 'Remove undefined tiles and overwrite IsoMapPack5 section in map', () => (this.FixupTiles = true));
    registerFlag(['--icegrowth', '-g'], 'Mark cells with ice growth set, used in TS snow maps', () => (this.MarkIceGrowth = true));
    registerFlag(['--bkp', '-b'], 'Create map file backup when modifying', () => (this.Backup = true));
    registerFlag(['--fix-overlays'], 'Remove undefined overlays and update overlay packs in map', () => (this.FixOverlays = true));
    registerFlag(['--cmprs-tiles'], 'Compress and update IsoMapPack5 in map', () => (this.CompressTiles = true));
    registerFlag(['--tunnels'], 'Show tunnels path lines', () => (this.TunnelPaths = true));
    registerFlag(['--tunnelpos'], 'Adjust position of tunnel path lines', () => (this.TunnelPosition = true));

    for (const apply of applications) apply();

    // warn about unknown options
    const known = new Set<string>();
    for (const e of this.helpEntries) for (const p of e.invocation.split(', ')) known.add(p);
    for (const a of args) {
      if (a.startsWith('-') && !known.has(a) && !a.includes('=')) {
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

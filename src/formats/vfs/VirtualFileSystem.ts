// Port of CNCMaps.FileFormats.VirtualFileSystem.VirtualFileSystem
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngineType } from '../../shared/Enums.js';
import { FileFormat } from '../FileFormat.js';
import { FormatHelper, guessFormat } from '../FormatHelper.js';
import { MixFile } from '../MixFile.js';
// Side-effect imports: ensure format factories are registered before any open().
import { IniFile } from '../IniFile.js';
import '../PalFile.js';
import '../ShpFile.js';
import '../TmpFile.js';
import '../HvaFile.js';
import '../VxlFile.js';
import '../VplFile.js';
import '../CsfFile.js';
import '../PktFile.js';
import '../MissionsFile.js';
import { CacheMethod, IArchive } from './IArchive.js';
import { DirArchive } from './DirArchive.js';
import { VirtualFile } from './VirtualFile.js';

/** Formats the renderer only reads. A long-lived worker can share one parsed instance across
 * renders, so theater tiles, SHP frames and voxels are decoded once instead of per map. */
const SharedFileFormats = new Set<FileFormat>([
  FileFormat.Csf,
  FileFormat.Pkt,
  FileFormat.Missions,
  FileFormat.Tmp,
  FileFormat.Shp,
  FileFormat.Vxl,
  FileFormat.Hva,
  FileFormat.Vpl,
  FileFormat.Pal,
]);

export class VirtualFileSystem {
  readonly allArchives: IArchive[] = [];
  /** Parse rules/art once and hand out per-render copies. Long-lived workers enable this;
   * one-shot CLI runs keep the plain parse path. */
  CacheParsedInis = false;
  /** Bound for the shared read-only files; a theater's tiles and SHPs take roughly 15 MB. */
  static SharedFileBudgetBytes = 96 * 1024 * 1024;
  private readonly parsedInis = new Map<string, IniFile>();
  private readonly sharedFiles = new Map<string, VirtualFile>();
  private sharedFileBytes = 0;

  /** Cached parse-once INI access; callers own the returned file and may mutate it. */
  openIni(filename: string): IniFile | null {
    if (!this.CacheParsedInis) return this.open(filename, FileFormat.Ini) as IniFile | null;
    const key = filename.toLowerCase();
    let base: IniFile | null = this.parsedInis.get(key) ?? null;
    if (base == null) {
      base = this.open(filename, FileFormat.Ini) as IniFile | null;
      if (base == null) return null;
      this.parsedInis.set(key, base);
    }
    return base.clone();
  }

  /** True when this mix name was already resolved into an archive (addItem can be repeated). */
  private hasArchive(pathname: string): boolean {
    return this.allArchives.some((a) => a instanceof MixFile && a.fileName === pathname);
  }

  private evictSharedFiles(): void {
    while (this.sharedFileBytes > VirtualFileSystem.SharedFileBudgetBytes && this.sharedFiles.size > 0) {
      const key = this.sharedFiles.keys().next().value as string;
      const old = this.sharedFiles.get(key);
      this.sharedFiles.delete(key);
      if (old != null) this.sharedFileBytes -= old.length;
    }
  }

  fileExists(filename: string): boolean {
    return this.allArchives.some((v) => v !== null && v.containsFile(filename));
  }

  openFile(filename: string): VirtualFile | null {
    const format = guessFormat(filename);
    return this.open(filename, format);
  }

  open(filename: string, format: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile | null {
    if (this.allArchives.length === 0) return null;
    // Resolve the format up front so a shared cache entry is found whichever way the caller
    // named it: open(path) used to leave the format to the archive itself.
    if (format === FileFormat.None) format = guessFormat(filename);
    const shared = this.CacheParsedInis && m === CacheMethod.Default && SharedFileFormats.has(format);
    const key = format + '|' + filename.toLowerCase();
    if (shared) {
      const cached = this.sharedFiles.get(key);
      if (cached != null) {
        // refresh LRU position
        this.sharedFiles.delete(key);
        this.sharedFiles.set(key, cached);
        return cached;
      }
    }
    const archive = this.allArchives.find((v) => v !== null && v.containsFile(filename));
    if (!archive) return null;
    let file: VirtualFile | null;
    try {
      file = archive.openFile(filename, format, m);
    } catch {
      return null;
    }
    if (file != null && shared) {
      this.sharedFiles.set(key, file);
      this.sharedFileBytes += file.length;
      this.evictSharedFiles();
    }
    return file;
  }

  addItem(pathname: string, m = CacheMethod.Default): boolean {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(pathname);
    } catch {
      stat = null;
    }

    // directory
    if (stat?.isDirectory()) {
      this.allArchives.push(new DirArchive(pathname));
      return true;
    }
    // regular file
    if (stat?.isFile()) {
      const ext = path.extname(pathname).toLowerCase();
      if (FormatHelper.MixArchiveExtensions.includes(ext)) {
        // repeated renders re-add the theater mixes; keep the parsed archive instead of
        // re-reading its header every time
        if (this.hasArchive(pathname)) return true;
        // open the archive lazily: only its directory header is parsed, entries are read on demand
        const lazy = MixFile.open(pathname);
        if (lazy != null) {
          lazy.fileName = pathname;
          this.allArchives.push(lazy);
          return true;
        }
        const mf = new MixFile(fs.readFileSync(pathname), pathname, 0, 0, false);
        mf.fileName = pathname;
        this.allArchives.push(mf);
        return true;
      }
    }
    // virtual mix file
    else if (this.fileExists(pathname)) {
      if (this.hasArchive(pathname)) return true;
      // Mix names during loadMixes are relative ('ra2md.mix'); resolve them to the real file so
      // the archive can be opened lazily instead of being read whole through the DirArchive.
      for (const archive of this.allArchives) {
        if (!(archive instanceof DirArchive)) continue;
        const full = archive.resolvePath(pathname);
        if (full == null) continue;
        const lazy = MixFile.open(full);
        if (lazy != null) {
          lazy.fileName = pathname;
          this.allArchives.push(lazy);
          return true;
        }
      }
      const mx = this.open(pathname, FileFormat.Mix) as MixFile | null;
      if (mx == null) return false;
      this.allArchives.push(mx);
      return true;
    }
    return false;
  }

  addMix(mix: MixFile): boolean {
    this.allArchives.push(mix);
    return true;
  }

  static determineMixDir(mixDirOverride: string, engine: EngineType): string {
    if (!mixDirOverride) {
      mixDirOverride =
        engine >= EngineType.RedAlert2 || engine === EngineType.AutoDetect ? RA2_INSTALL_DIR : TS_INSTALL_DIR;
    }
    return mixDirOverride;
  }

  loadMixes(dir: string, engine: EngineType, loadExpandMixes = true): boolean {
    if (!this.allArchives.some((a) => a instanceof DirArchive && normalizePath(dir) === normalizePath(a.directory))) {
      this.addItem(dir);
    }
    return this.loadMixesFor(engine, loadExpandMixes);
  }

  private loadMixesFor(engine: EngineType, loadExpandMixes = true): boolean {
    if (engine === EngineType.AutoDetect) {
      return false;
    }
    if (engine === EngineType.Firestorm) {
      if (this.fileExists('patch.mix')) this.addItem('patch.mix');
    }

    for (let i = loadExpandMixes ? 99 : -1; i >= 0; i--) {
      const file =
        engine === EngineType.YurisRevenge
          ? 'expandmd' + pad2(i) + '.mix'
          : 'expand' + pad2(i) + '.mix';
      if (this.fileExists(file)) this.addItem(file);
    }

    if (engine <= EngineType.Firestorm) {
      for (let i = 99; i >= 0; i--) {
        const file = 'ecache' + pad2(i) + '.mix';
        if (this.fileExists(file)) this.addItem(file);
      }
    }

    if (engine >= EngineType.RedAlert2) {
      if (engine === EngineType.YurisRevenge) this.addItem('langmd.mix');
      this.addItem('language.mix');
    }

    if (engine >= EngineType.RedAlert2) {
      if (engine === EngineType.YurisRevenge) this.addItem('ra2md.mix');
      this.addItem('ra2.mix');
    } else {
      this.addItem('tibsun.mix');
    }

    if (engine === EngineType.YurisRevenge) this.addItem('cachemd.mix');
    this.addItem('cache.mix');

    if (engine === EngineType.YurisRevenge) this.addItem('localmd.mix');
    this.addItem('local.mix');

    if (engine === EngineType.YurisRevenge) this.addItem('audiomd.mix');

    if (engine >= EngineType.RedAlert2) {
      const ecacheList: string[] = [];
      for (const dir of this.allArchives.filter((a): a is DirArchive => a instanceof DirArchive)) {
        for (const file of fs.readdirSync(dir.directory)) {
          if (file.toLowerCase().startsWith('ecache') && file.toLowerCase().endsWith('.mix')) {
            ecacheList.push(file);
          }
        }
      }
      for (const ecachefile of ecacheList.sort().reverse()) this.addItem(ecachefile);
    }

    for (let i = 99; i >= 0; i--) {
      const file = 'elocal' + pad2(i) + '.mix';
      if (this.fileExists(file)) this.addItem(file);
    }

    if (engine >= EngineType.RedAlert2) {
      for (const dir of this.allArchives.filter((a): a is DirArchive => a instanceof DirArchive)) {
        for (const file of fs.readdirSync(dir.directory)) {
          if (file.toLowerCase().endsWith('.mmx')) this.addItem(path.join(dir.directory, file));
          if (engine === EngineType.YurisRevenge && file.toLowerCase().endsWith('.yro')) {
            this.addItem(path.join(dir.directory, file));
          }
        }
      }
    }

    this.addItem('conquer.mix');

    if (engine >= EngineType.RedAlert2) {
      if (engine === EngineType.YurisRevenge) {
        this.addItem('conqmd.mix');
        this.addItem('genermd.mix');
      }
      this.addItem('generic.mix');
      if (engine === EngineType.YurisRevenge) this.addItem('isogenmd.mix');
      this.addItem('isogen.mix');
      if (engine === EngineType.YurisRevenge) this.addItem('cameomd.mix');
      this.addItem('cameo.mix');
      if (engine === EngineType.YurisRevenge) {
        this.addItem('mapsmd03.mix');
        this.addItem('multimd.mix');
        this.addItem('thememd.mix');
      }
    }

    return true;
  }

  reset(): void {
    for (const arch of this.allArchives) arch?.dispose();
    this.allArchives.length = 0;
    this.parsedInis.clear();
    this.sharedFiles.clear();
    this.sharedFileBytes = 0;
  }

  dispose(): void {
    this.reset();
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

// No registry lookup in the sandbox; install paths are provided by the caller.
export const RA2_INSTALL_DIR = '';
export const TS_INSTALL_DIR = '';
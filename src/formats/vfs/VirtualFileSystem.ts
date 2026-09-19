// Port of CNCMaps.FileFormats.VirtualFileSystem.VirtualFileSystem
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngineType } from '../../shared/Enums.js';
import { FileFormat } from '../FileFormat.js';
import { FormatHelper, guessFormat } from '../FormatHelper.js';
import { MixFile } from '../MixFile.js';
// Side-effect imports: ensure format factories are registered before any open().
import '../IniFile.js';
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

export class VirtualFileSystem {
  readonly allArchives: IArchive[] = [];

  fileExists(filename: string): boolean {
    return this.allArchives.some((v) => v !== null && v.containsFile(filename));
  }

  openFile(filename: string): VirtualFile | null {
    const format = guessFormat(filename);
    return this.open(filename, format);
  }

  open(filename: string, format: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile | null {
    if (this.allArchives.length === 0) return null;
    const archive = this.allArchives.find((v) => v !== null && v.containsFile(filename));
    if (!archive) return null;
    try {
      return archive.openFile(filename, format, m);
    } catch {
      return null;
    }
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
        const mf = new MixFile(fs.readFileSync(pathname), pathname, 0, 0, false);
        mf.fileName = pathname;
        this.allArchives.push(mf);
        return true;
      }
    }
    // virtual mix file
    else if (this.fileExists(pathname)) {
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

  loadMixes(dir: string, engine: EngineType): boolean {
    if (!this.allArchives.some((a) => a instanceof DirArchive && normalizePath(dir) === normalizePath(a.directory))) {
      this.addItem(dir);
    }
    return this.loadMixesFor(engine);
  }

  private loadMixesFor(engine: EngineType): boolean {
    if (engine === EngineType.AutoDetect) {
      return false;
    }
    if (engine === EngineType.Firestorm) {
      if (this.fileExists('patch.mix')) this.addItem('patch.mix');
    }

    for (let i = 99; i >= 0; i--) {
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
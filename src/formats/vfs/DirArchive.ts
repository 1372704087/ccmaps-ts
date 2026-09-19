// Port of CNCMaps.FileFormats.VirtualFileSystem.DirArchive
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileFormat } from '../FileFormat.js';
import { FormatHelper } from '../FormatHelper.js';
import { CacheMethod, IArchive } from './IArchive.js';
import { VirtualFile } from './VirtualFile.js';

export class DirArchive implements IArchive {
  readonly directory: string;
  private readonly index = new Map<string, string>(); // requested name (case-insensitive) -> actual filename
  private readonly openedFiles = new Map<string, Buffer>();

  constructor(dir: string) {
    this.directory = dir;
    const lower = new Map<string, string>();
    for (const f of fs.readdirSync(dir)) {
      lower.set(f.toLowerCase(), f);
    }
    for (const f of lower.values()) {
      this.index.set(f.toLowerCase(), f);
    }
  }

  containsFile(filename: string): boolean {
    return this.index.has(filename.toLowerCase());
  }

  openFile(filename: string, format: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile {
    let data = this.openedFiles.get(filename);
    if (!data) {
      const actual = this.index.get(filename.toLowerCase()) ?? filename;
      data = fs.readFileSync(path.join(this.directory, actual));
      this.openedFiles.set(filename, data);
    }
    return FormatHelper.openAsFormat(data, filename, 0, data.length, format, m);
  }

  dispose(): void {
    this.openedFiles.clear();
  }
}
// Port of CNCMaps.FileFormats.VplFile
import { VirtualFile } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';

export class VplFile extends VirtualFile {
  private firstRemap = 0;
  private lastRemap = 0;
  private numSections = 0;
  private unknown = 0;
  private lookupSections: Uint8Array[] = [];
  private parsed = false;

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = false,
  ) {
    super(baseStream, fileName, baseOffset, fileSize < 0 ? baseStream.length : fileSize, isBuffered);
  }

  private Parse(): void {
    this.firstRemap = this.readUInt32();
    this.lastRemap = this.readUInt32();
    this.numSections = this.readUInt32();
    this.unknown = this.readUInt32();
    this.read(768); // palette (unused in the renderer)
    this.lookupSections = [];
    for (let i = 0; i < this.numSections; i++) this.lookupSections.push(this.read(256));
    this.parsed = true;
  }

  get NumSections(): number {
    if (!this.parsed) this.Parse();
    return this.numSections;
  }

  getPaletteIndex(page: number, color: number): number {
    if (!this.parsed) this.Parse();
    return this.lookupSections[Math.min(page, this.numSections - 1)][color];
  }
}

registerFormat(FileFormat.Vpl, (b, f, o, l, c) => new VplFile(b, f, o, l, c));
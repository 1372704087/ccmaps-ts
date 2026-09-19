// Port of CNCMaps.FileFormats.PalFile
import { VirtualFile } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';

export class PalFile extends VirtualFile {
  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, fileSize < 0 ? baseStream.length : fileSize, isBuffered);
  }

  getOriginalColors(): Uint8Array {
    this.position = 0;
    return this.read(256 * 3);
  }
}

registerFormat(FileFormat.Pal, (b, f, o, l, c) => new PalFile(b, f, o, l, c));
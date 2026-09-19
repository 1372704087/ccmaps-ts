// Port of CNCMaps.FileFormats.VirtualFileSystem.VirtualTextFile
import { VirtualFile } from './VirtualFile.js';

export class VirtualTextFile extends VirtualFile {
  constructor(baseStream: Uint8Array, fileName?: string);
  constructor(baseStream: Uint8Array, fileName: string, baseOffset: number, length: number, isBuffered?: boolean);

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    length = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, length < 0 ? baseStream.length : length, isBuffered);
    this.position = 0;
  }

  get canRead(): boolean {
    return !this.eof;
  }

  // ASCII only, matching the C# original.
  readLine(): string {
    let builder = '';
    while (this.canRead) {
      const c = String.fromCharCode(this.readByte());
      if (c === '\n') break;
      else if (c !== '\r') builder += c;
    }
    return builder;
  }
}
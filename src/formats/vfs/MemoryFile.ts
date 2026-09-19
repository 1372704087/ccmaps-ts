// Port of CNCMaps.FileFormats.VirtualFileSystem.MemoryFile
import { VirtualFile } from './VirtualFile.js';

/// <summary>Virtual file from a memory buffer.</summary>
export class MemoryFile extends VirtualFile {
  constructor(buffer: Uint8Array, isBuffered = true) {
    super(buffer, 'MemoryFile', 0, buffer.length, isBuffered);
  }
}
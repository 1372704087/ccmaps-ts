// Port of CNCMaps.FileFormats.VirtualFileSystem.IArchive
import { FileFormat } from '../FileFormat.js';
import { VirtualFile } from './VirtualFile.js';

export enum CacheMethod {
  Default,
  Cache,
  NoCache,
}

export interface IArchive {
  containsFile(filename: string): boolean;
  openFile(filename: string, format: FileFormat, m?: CacheMethod): VirtualFile | null;
  dispose(): void;
}
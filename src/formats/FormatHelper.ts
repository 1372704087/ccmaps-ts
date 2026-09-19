// Port of CNCMaps.FileFormats.FormatHelper
import { FileFormat } from './FileFormat.js';
import { CacheMethod } from './vfs/IArchive.js';
import { VirtualFile } from './vfs/VirtualFile.js';

export const MixArchiveExtensions = ['.mix', '.yro', '.mmx'];
export const MapExtensions = ['.map', '.yrm', '.mpr'];

// Registry of typed-format constructors. Each file-format module registers a
// factory here as it is ported; unregistered formats fall back to a plain
// VirtualFile. This mirrors OpenAsFormat's switch while avoiding an import
// cycle during the step-by-step port.
export type VirtualFileFactory = (
  baseStream: Uint8Array,
  fileName: string,
  offset: number,
  length: number,
  cached: boolean,
) => VirtualFile;

const factories: Partial<Record<FileFormat, VirtualFileFactory>> = {};

export function registerFormat(format: FileFormat, factory: VirtualFileFactory): void {
  factories[format] = factory;
}

// Namespace object mirroring the C# static FormatHelper class.
export const FormatHelper = {
  MixArchiveExtensions,
  MapExtensions,
  guessFormat,
  openAsFormat,
};

export interface FileFormatCtor {
  new (
    baseStream: Uint8Array,
    fileName: string,
    offset: number,
    length: number,
    cached: boolean,
  ): VirtualFile;
}

export function guessFormat(filename: string): FileFormat {
  const idx = Math.max(filename.lastIndexOf('.'), filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const extension = (idx >= 0 ? filename.slice(idx).toLowerCase() : '');
  if (extension === '.csf') return FileFormat.Csf;
  else if (extension === '.hva') return FileFormat.Hva;
  else if (extension === '.ini') return filename.toUpperCase().startsWith('MISSION') ? FileFormat.Missions : FileFormat.Ini;
  else if (MixArchiveExtensions.includes(extension)) return FileFormat.Mix;
  else if (extension === '.pal') return FileFormat.Pal;
  else if (extension === '.pkt') return FileFormat.Pkt;
  else if (extension === '.shp' || extension === '.sha') return FileFormat.Shp;
  else if (extension === '.tmp') return FileFormat.Tmp;
  else if (extension === '.vpl') return FileFormat.Vpl;
  else if (extension === '.vxl') return FileFormat.Vxl;
  else if (MapExtensions.includes(extension)) return FileFormat.Map;
  return FileFormat.Ukn;
}

export function openAsFormat(
  baseStream: Uint8Array,
  filename: string,
  offset = 0,
  length = -1,
  format: FileFormat = FileFormat.None,
  m: CacheMethod = CacheMethod.Default,
): VirtualFile {
  if (length === -1) length = baseStream.length;
  if (format === FileFormat.None) format = guessFormat(filename);
  const factory = factories[format];
  if (factory) return factory(baseStream, filename, offset, length, m !== CacheMethod.NoCache);
  return new VirtualFile(baseStream, filename, offset, length, m !== CacheMethod.NoCache);
}
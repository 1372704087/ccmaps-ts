// Port of CNCMaps.FileFormats.MixFile
import * as fs from 'node:fs';
import { Blowfish } from './encodings/Blowfish.js';
import { BlowfishKeyProvider } from './encodings/BlowfishKeyProvider.js';
import { CRC32 } from './encodings/CRC32.js';
import { FileFormat } from './FileFormat.js';
import { FormatHelper, registerFormat } from './FormatHelper.js';
import { CacheMethod } from './vfs/IArchive.js';
import { IArchive } from './vfs/IArchive.js';
import { VirtualFile } from './vfs/VirtualFile.js';

export enum MixFileFlags {
  Checksum = 0x10000,
  Encrypted = 0x20000,
}

const standardNames = new Map<number, string>();
// VFS.open() asks every archive whether it contains the same filename, so the CRC of one name
// was recomputed dozens of times per lookup. Cache the uppercase name -> hash (bounded).
const hashCache = new Map<string, number>();
const HASH_CACHE_LIMIT = 4096;

export class MixEntry {
  readonly hash: number;
  readonly offset: number;
  readonly length: number;

  constructor(hash: number, offset: number, length: number) {
    this.hash = hash;
    this.offset = offset;
    this.length = length;
  }

  toString(): string {
    const name = standardNames.get(this.hash);
    if (name) return `${name} - offset 0x${this.offset.toString(16).padStart(8, '0')} - length 0x${this.length.toString(16).padStart(8, '0')}`;
    return `0x${this.hash.toString(16).padStart(8, '0')} - offset 0x${this.offset.toString(16).padStart(8, '0')} - length 0x${this.length.toString(16).padStart(8, '0')}`;
  }

  static hashFilename(filename: string): number {
    const key = filename.toUpperCase();
    const cached = hashCache.get(key);
    if (cached !== undefined) return cached;

    let f = key;
    const l = f.length;
    const a = l >> 2;
    if ((l & 3) !== 0) {
      f += String.fromCharCode(l - (a << 2));
      let i = 3 - (l & 3);
      while (i-- !== 0) f += f[a << 2];
    }
    const bytes = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) bytes[i] = f.charCodeAt(i) & 0xff;
    const hash = CRC32.CalculateCrc(bytes);
    if (hashCache.size >= HASH_CACHE_LIMIT) hashCache.delete(hashCache.keys().next().value as string);
    hashCache.set(key, hash);
    return hash;
  }

  static readonly SIZE = 12;

  static addStandardName(s: string): void {
    const hash = MixEntry.hashFilename(s);
    standardNames.set(hash, s);
  }
}

export class MixFile extends VirtualFile implements IArchive {
  index = new Map<number, MixEntry>();
  private dataStart = 0; // first byte of body, directly after mix header
  /** Set for archives opened straight from disk: entries are read on demand instead of
   * keeping the whole (often hundreds of MB) .mix file in the JavaScript heap. */
  /** Set for archives opened straight from disk: entries are read on demand instead of
   * keeping the whole (often hundreds of MB) .mix file in the JavaScript heap. */
  private filePath: string | null = null;

  constructor(
    baseStream: Uint8Array,
    filename = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = false,
    parseHeader = true,
  ) {
    super(baseStream, filename, baseOffset, fileSize < 0 ? baseStream.length : fileSize, isBuffered);
    if (parseHeader) this.parseHeader();
  }

  /** Opens a .mix file on disk and parses only its directory header. Entries are read with
   * fs.readSync when the renderer asks for them, so loading the VFS no longer pulls the full
   * game install into memory. Returns null when the file is not a valid mix archive. */
  static open(path: string): MixFile | null {
    let fd: number;
    try {
      fd = fs.openSync(path, 'r');
    } catch {
      return null;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size < 4) throw new Error('truncated mix');
      const probe = MixFile.readRange(fd, 0, Math.min(size, 96));
      const dv = new DataView(probe.buffer, probe.byteOffset, probe.byteLength);
      const signature = dv.getUint32(0, true);
      const isCncMix = (signature & 0xffff) !== 0;
      const isEncrypted = !isCncMix && (signature & MixFileFlags.Encrypted) !== 0;

      let numFiles: number;
      let headerLength: number;
      if (isCncMix) {
        if (probe.length < 2) throw new Error('truncated mix');
        numFiles = dv.getUint16(0, true);
        headerLength = 6 + numFiles * MixEntry.SIZE;
      } else if (!isEncrypted) {
        if (probe.length < 6) throw new Error('truncated mix');
        numFiles = dv.getUint16(4, true);
        headerLength = 10 + numFiles * MixEntry.SIZE;
      } else {
        // decrypt just the first block to learn the entry count, like parseHeader does
        if (probe.length < 84) throw new Error('truncated mix');
        const reader = new VirtualFile(probe, path, 0, probe.length);
        const blowfishKey = new BlowfishKeyProvider().decryptKey(reader.read(80));
        const fish = new Blowfish(blowfishKey);
        const first = fish.decrypt(new Uint32Array([reader.readUInt32(), reader.readUInt32()]));
        numFiles = first[0] & 0xffff;
        headerLength = 84 + ((6 + numFiles * MixEntry.SIZE + 7) & ~7);
      }
      if (numFiles <= 0 || headerLength > size) throw new Error('invalid mix header');

      const headerBytes = MixFile.readRange(fd, 0, headerLength);
      const mix = new MixFile(headerBytes, path, 0, headerBytes.length, false);
      mix.filePath = path;
      return mix;
    } catch {
      return null;
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  private static readRange(fd: number, offset: number, length: number): Uint8Array {
    const buf = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buf, read, length - read, offset + read);
      if (n <= 0) break;
      read += n;
    }
    return read === length ? buf : buf.subarray(0, read);
  }

  containsFile(filename: string): boolean {
    return this.index.has(MixEntry.hashFilename(filename));
  }

  isValid(): boolean {
    this.position = 0;
    const signature = this.readUInt32();
    if ((signature & ~(MixFileFlags.Encrypted | MixFileFlags.Checksum)) !== 0) return false;

    if ((signature & MixFileFlags.Encrypted) !== 0) {
      const keyblock = this.read(80);
      const blowfishKey = new BlowfishKeyProvider().decryptKey(keyblock);
      const h = this.readUints(2);
      const fish = new Blowfish(blowfishKey);
      const ms = decrypt2Bytes(fish.decrypt(h));
      const r = new VirtualFile(ms);
      const numFiles = r.readUInt16();
      const dataSize = r.readUInt32();
      const pad = 6 + numFiles * MixEntry.SIZE + 7 & ~7;
      return numFiles > 0 && 84 + pad + dataSize + ((signature & MixFileFlags.Checksum) !== 0 ? 20 : 0) === this.length;
    } else {
      const numFiles = this.readUInt16();
      const dataSize = this.readUInt32();
      return numFiles > 0 && 4 + 6 + numFiles * MixEntry.SIZE + dataSize + ((signature & MixFileFlags.Checksum) !== 0 ? 20 : 0) === this.length;
    }
  }

  private parseHeader(): void {
    this.position = 0;
    const signature = this.readUInt32();
    const isCncMix = (signature & 0xffff) !== 0;
    const isEncrypted = !isCncMix && (signature & MixFileFlags.Encrypted) !== 0;

    let header: VirtualFile;
    if (!isCncMix) {
      header = isEncrypted ? new VirtualFile(this.decryptHeader()) : this;
    } else {
      header = this;
      header.seek(0, 0);
    }

    const numFiles = header.readUInt16();
    const dataSize = header.readUInt32();
    void dataSize;
    this.index = new Map<number, MixEntry>();
    for (let i = 0; i < numFiles; i++) {
      const entry = new MixEntry(header.readUInt32(), header.readUInt32(), header.readUInt32());
      this.index.set(entry.hash, entry);
    }
    this.dataStart = this.position; // body follows end of header
  }

  private decryptHeader(): Uint8Array {
    const reader = this;
    const keyblock = reader.read(80);
    const blowfishKey = new BlowfishKeyProvider().decryptKey(keyblock);

    // Decrypt just the 1st block to determine the number of items.
    const fish = new Blowfish(blowfishKey);
    const h = fish.decrypt(this.readUints(2));

    // First 2 decrypted bytes indicate the number of files.
    const numFiles = h[0] & 0xffff;
    const blockSize = 8;
    const headerLength = (6 + numFiles * MixEntry.SIZE + (blockSize - 1)) & ~(blockSize - 1);

    // Decrypt the full header.
    reader.position = 84;
    return decrypt2Bytes(fish.decrypt(this.readUints(Math.floor(headerLength / 4))));
  }

  private readUints(count: number): Uint32Array {
    const ret = new Uint32Array(count);
    for (let i = 0; i < ret.length; i++) ret[i] = this.readUInt32();
    return ret;
  }

  openFile(filename: string, f: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile | null {
    const e = this.index.get(MixEntry.hashFilename(filename));
    if (!e) return null;
    return this.openEntry(e, filename, f, m);
  }

  openFileById(entry: number, filename = '', f: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile {
    const e = this.index.get(entry)!;
    return this.openEntry(e, filename, f, m);
  }

  private openEntry(e: MixEntry, filename: string, f: FileFormat, m: CacheMethod): VirtualFile {
    const start = this.dataStart + e.offset;
    if (this.filePath == null) {
      // in-memory archive (nested mix, browser buffer): keep the zero-copy view
      return FormatHelper.openAsFormat(this.baseStream, filename, this.baseOffset + start, e.length, f, m);
    }
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const bytes = MixFile.readRange(fd, start, e.length);
      return FormatHelper.openAsFormat(bytes, filename, 0, bytes.length, f, m);
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  allFileHashes(): IterableIterator<number> {
    return this.index.keys();
  }

  dispose(): void {
    // entries are read with a short-lived file descriptor, so there is nothing to release
  }
}

function decrypt2Bytes(uints: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(uints.length * 4);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < uints.length; i++) dv.setUint32(i * 4, uints[i], true);
  return bytes;
}

function mixFactory(
  baseStream: Uint8Array,
  fileName: string,
  offset: number,
  length: number,
  cached: boolean,
): VirtualFile {
  return new MixFile(baseStream, fileName, offset, length, cached);
}
registerFormat(FileFormat.Mix, mixFactory);
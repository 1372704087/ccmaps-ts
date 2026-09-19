// Port of CNCMaps.FileFormats.MixFile
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
    let f = filename.toUpperCase();
    const l = f.length;
    const a = l >> 2;
    if ((l & 3) !== 0) {
      f += String.fromCharCode(l - (a << 2));
      let i = 3 - (l & 3);
      while (i-- !== 0) f += f[a << 2];
    }
    const bytes = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) bytes[i] = f.charCodeAt(i) & 0xff;
    return CRC32.CalculateCrc(bytes);
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
    return FormatHelper.openAsFormat(this.baseStream, filename, this.baseOffset + this.dataStart + e.offset, e.length, f, m);
  }

  openFileById(entry: number, filename = '', f: FileFormat = FileFormat.None, m: CacheMethod = CacheMethod.Default): VirtualFile {
    const e = this.index.get(entry)!;
    return FormatHelper.openAsFormat(this.baseStream, filename, this.baseOffset + this.dataStart + e.offset, e.length, f, m);
  }

  allFileHashes(): IterableIterator<number> {
    return this.index.keys();
  }

  dispose(): void {
    // nothing to release; base stream is owned by the disk/buffer layer
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
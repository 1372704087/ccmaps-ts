// Port of CNCMaps.FileFormats.VirtualFileSystem.VirtualFile
//
// The C# original is a Stream wrapper over a shared FileStream that is
// positioned on demand (BaseOffset + Pos). In the port we keep the same model
// but back BaseStream with an in-memory Uint8Array view, so every read is a
// cheap subarray slice. All primitives are little-endian to match BitConverter
// on the machines the C# version targets.

export enum SeekOrigin {
  Begin = 0,
  Current = 1,
  End = 2,
}

export class VirtualFile {
  protected baseStream: Uint8Array;
  protected baseOffset: number;
  protected size: number;
  protected pos: number;
  protected isBuffered: boolean;
  fileName: string;

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = false,
  ) {
    this.baseStream = baseStream;
    this.baseOffset = baseOffset;
    this.size = fileSize < 0 ? baseStream.length : fileSize;
    this.pos = 0;
    this.isBuffered = isBuffered;
    this.fileName = fileName;
  }

  get canRead(): boolean {
    return this.pos < this.size;
  }

  // Alias kept for closeness to the C# `Length` property.
  get canWrite(): boolean {
    return false;
  }

  get length(): number {
    return this.size;
  }

  get remaining(): number {
    return this.length - this.pos;
  }

  get eof(): boolean {
    return this.remaining <= 0;
  }

  get canSeek(): boolean {
    return true;
  }

  get position(): number {
    return this.pos;
  }

  set position(value: number) {
    this.pos = value;
  }

  get buffer(): Uint8Array {
    return this.baseStream;
  }

  // Reads up to `count` bytes into `dest` at `destOffset`; returns bytes read.
  readInto(dest: Uint8Array, destOffset: number, count: number): number {
    count = Math.min(count, this.size - this.pos);
    if (count <= 0) return 0;
    const srcStart = this.baseOffset + this.pos;
    dest.set(this.baseStream.subarray(srcStart, srcStart + count), destOffset);
    this.pos += count;
    return count;
  }

  // Reads exactly `numBytes` into a fresh buffer. Like the C# Read(int), the
  // returned array always has numBytes length; bytes past EOF stay zero.
  read(numBytes: number): Uint8Array {
    const ret = new Uint8Array(numBytes);
    this.readInto(ret, 0, numBytes);
    return ret;
  }

  readCString(count: number): string {
    const arr = this.read(count);
    let sb = '';
    for (let i = 0; i < count && arr[i] !== 0; i++) sb += String.fromCharCode(arr[i]);
    return sb;
  }

  readByte(): number {
    return this.readUInt8();
  }

  readSByte(): number {
    return (this.readUInt8() << 24) >> 24;
  }

  readUInt8(): number {
    return this.read(1)[0];
  }

  private view(n: number): DataView {
    return new DataView(this.read(n).buffer);
  }

  readInt16(): number {
    return this.view(2).getInt16(0, true);
  }

  readUInt16(): number {
    return this.view(2).getUint16(0, true);
  }

  readInt32(): number {
    return this.view(4).getInt32(0, true);
  }

  readUInt32(): number {
    return this.view(4).getUint32(0, true);
  }

  readFloat(): number {
    return this.view(4).getFloat32(0, true);
  }

  // Like BitConverter with reversed bytes (big-endian single).
  readFloat2(): number {
    const b = this.read(4);
    return new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(0, false);
  }

  readDouble(): number {
    return this.view(8).getFloat64(0, true);
  }

  seek(offset: number, origin: SeekOrigin): number {
    switch (origin) {
      case SeekOrigin.Begin:
        this.position = offset;
        break;
      case SeekOrigin.Current:
        this.position += offset;
        break;
      case SeekOrigin.End:
        this.position = this.length - offset;
        break;
    }
    return this.position;
  }

  toString(): string {
    return this.fileName;
  }
}
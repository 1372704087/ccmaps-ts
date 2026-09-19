// Minimal positional byte reader over a Uint8Array, mirroring the MemoryFile/VirtualFile
// semantics used by the encoding decoders (read-only, big-endian-free little-endian).

export class ByteReader {
  public buf: Uint8Array;
  public pos: number;
  private dv: DataView;

  constructor(buf: Uint8Array, pos = 0) {
    this.buf = buf;
    this.pos = pos;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number { return this.buf.length - this.pos; }
  get eof(): boolean { return this.pos >= this.buf.length; }

  readByte(): number { return this.buf[this.pos++] & 0xff; }
  readUInt8(): number { return this.buf[this.pos++] & 0xff; }
  readUInt16(): number {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readInt16(): number {
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readUInt32(): number {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readInt32(): number {
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readBytes(count: number): Uint8Array {
    const out = this.buf.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }
  readInto(dest: Uint8Array, destIndex: number, count: number): void {
    for (let i = 0; i < count; i++) dest[destIndex + i] = this.buf[this.pos + i];
    this.pos += count;
  }
  readCString(count: number): string {
    let s = '';
    for (let i = 0; i < count; i++) {
      const c = this.buf[this.pos + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    this.pos += count;
    return s;
  }
  seek(pos: number): void { this.pos = pos; }
  skip(n: number): void { this.pos += n; }
}

export class ByteWriter {
  public buf: Uint8Array;
  public pos: number;
  private dv: DataView;
  constructor(capacity = 4096) {
    this.buf = new Uint8Array(capacity);
    this.pos = 0;
    this.dv = new DataView(this.buf.buffer);
  }
  private ensure(extra: number): void {
    if (this.pos + extra > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra));
      nb.set(this.buf.subarray(0, this.pos));
      this.buf = nb;
      this.dv = new DataView(nb.buffer);
    }
  }
  writeByte(b: number): void { this.ensure(1); this.buf[this.pos++] = b & 0xff; }
  writeUInt16(v: number): void { this.ensure(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; }
  writeInt16(v: number): void { this.ensure(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; }
  writeUInt32(v: number): void { this.ensure(4); this.dv.setUint32(this.pos, v, true); this.pos += 4; }
  writeInt32(v: number): void { this.ensure(4); this.dv.setInt32(this.pos, v, true); this.pos += 4; }
  writeBytes(arr: Uint8Array, offset = 0, count = arr.length): void {
    this.ensure(count);
    this.buf.set(arr.subarray(offset, offset + count), this.pos);
    this.pos += count;
  }
  writeASCII(s: string): void {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i) & 0xff;
  }
  getResult(): Uint8Array { return this.buf.subarray(0, this.pos); }
  reset(): void { this.pos = 0; }
}

// Little-endian helpers for fixed buffer access (used by MiniLZO and others).
export function readU16LE(buf: Uint8Array, off: number): number {
  return (buf[off] & 0xff) | ((buf[off + 1] & 0xff) << 8);
}
export function writeU16LE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
}
export function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off] | 0) + (buf[off + 1] << 8) + (buf[off + 2] << 16) + (buf[off + 3] << 24)) >>> 0;
}
export function writeU32LE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}
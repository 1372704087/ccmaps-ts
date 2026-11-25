// Port of CNCMaps.Engine.Rendering.PngWriter
//
// Writes truecolor (RGB) PNGs with unfiltered (filter-type-0) scanlines, matching
// the byte layout of the C# writer. Compression is delegated to Node's zlib.
// Scanlines are compressed in bounded chunks and written as multiple IDAT blocks,
// so a full-map render never materializes the whole decompressed PNG body in RAM.
import * as fs from 'node:fs';
// Namespace import: zlib.crc32 only exists on Node >=20.15/22. A named import
// of a missing built-in export fails at module load on Node 18, taking the whole
// CLI down before the feature check can fall back to the JS CRC.
import * as zlib from 'node:zlib';
import { Rectangle } from '../shared/Geometry.js';
import { ParallelDeflater } from './ParallelDeflater.js';

const crcTable = buildCrcTable();
type Crc32Fn = (data: Uint8Array, value?: number) => number;
const nativeCrc32 = (zlib as unknown as { crc32?: Crc32Fn }).crc32;
const hasNativeCrc = typeof nativeCrc32 === 'function';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Rows per compression chunk; the raw buffer stays a few MiB even for huge maps. */
const MAX_RAW_CHUNK = 4 * 1024 * 1024;
/** zlib's NMAX: the largest run that fits an adler accumulator without overflowing. */
const ADLER_NMAX = 5552;

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function updateCrc(crc: number, data: Uint8Array): number {
  for (const b of data) crc = (crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return crc >>> 0;
}

function writeBEU32(data: Uint8Array, offset: number, v: number): void {
  data[offset] = (v >>> 24) & 0xff;
  data[offset + 1] = (v >>> 16) & 0xff;
  data[offset + 2] = (v >>> 8) & 0xff;
  data[offset + 3] = v & 0xff;
}

function crcOfChunk(type: Buffer, payload: Buffer): number {
  return hasNativeCrc
    ? (nativeCrc32!(payload, nativeCrc32!(type)) >>> 0)
    : ((updateCrc(0xffffffff, Buffer.concat([type, payload])) ^ 0xffffffff) >>> 0);
}

/** Writes one PNG chunk with writev so the compressed payload is never copied. */
function writeChunk(fd: number, type: Buffer, payload: Buffer): void {
  const len = Buffer.allocUnsafe(4);
  writeBEU32(len, 0, payload.length);
  const crc = Buffer.allocUnsafe(4);
  writeBEU32(crc, 0, crcOfChunk(type, payload));
  fs.writevSync(fd, [len, type, payload, crc]);
}

const CHUNK_IHDR = Buffer.from('IHDR', 'ascii');
const CHUNK_IDAT = Buffer.from('IDAT', 'ascii');
const CHUNK_IEND = Buffer.from('IEND', 'ascii');

/** PNG signature, exported for writers that assemble already-compressed bands. */
export const PNG_SIGNATURE_BYTES = PNG_SIGNATURE;

/** Writes a PNG chunk (length, type, payload, CRC) to an open file descriptor. */
export function writePngChunk(fd: number, type: string, payload: Buffer): void {
  writeChunk(fd, Buffer.from(type, 'ascii'), payload);
}

/** Writes the PNG signature and IHDR for an 8-bit truecolor image. */
export function writePngHeader(fd: number, width: number, height: number): void {
  fs.writeSync(fd, PNG_SIGNATURE);
  const ihdr = Buffer.alloc(13);
  writeBEU32(ihdr, 0, width);
  writeBEU32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeChunk(fd, CHUNK_IHDR, ihdr);
}

/** The two-byte zlib header that starts the IDAT stream for the given deflate level. */
export function pngZlibHeader(level: number): Buffer {
  return Buffer.from([0x78, level === 0 ? 0x01 : 0x9c]);
}

/**
 * Incremental PNG writer: rows are handed over as they finish rendering and are
 * compressed in bounded chunks, so a banded/streamed render never needs the
 * whole image in memory. The output is a single ordinary PNG.
 */
export class PngStreamWriter {
  private readonly fd: number;
  private readonly width: number;
  private readonly height: number;
  private readonly bytesPerPixel: number;
  private readonly level: number;
  private readonly rowBytes: number;
  private readonly rowsPerChunk: number;
  private readonly raw: Uint8Array;
  private rawFill = 0;
  private rowsInChunk = 0;
  private adlerA = 1;
  private adlerB = 0;
  private firstChunk = true;
  private rowsWritten = 0;
  private finished = false;
  private deflater: ParallelDeflater | null = null;

  constructor(path: string, width: number, height: number, bytesPerPixel: number, compressionLevel: number) {
    if (width <= 0 || height <= 0) throw new Error('Cannot write an empty PNG');
    const level = Number.isFinite(compressionLevel)
      ? Math.min(9, Math.max(0, Math.trunc(compressionLevel)))
      : 4;
    this.fd = fs.openSync(path, 'w');
    this.width = width;
    this.height = height;
    this.bytesPerPixel = bytesPerPixel;
    this.level = level;
    this.rowBytes = width * 3;
    this.rowsPerChunk = Math.max(1, Math.min(height, Math.floor(MAX_RAW_CHUNK / (this.rowBytes + 1))));
    this.raw = new Uint8Array((this.rowBytes + 1) * this.rowsPerChunk);

    fs.writeSync(this.fd, PNG_SIGNATURE);
    const ihdr = Buffer.alloc(13);
    writeBEU32(ihdr, 0, width);
    writeBEU32(ihdr, 4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: truecolor
    writeChunk(this.fd, CHUNK_IHDR, ihdr);

    // Compressing several scanline blocks at once is the biggest win on big images; small
    // outputs stay on the single-thread path so the worker startup does not dominate.
    const workers = PngWriter.ParallelCompressionWorkers;
    if (workers > 1 && (this.rowBytes + 1) * height >= 8 * 1024 * 1024) {
      try {
        this.deflater = new ParallelDeflater(workers, level);
      } catch {
        this.deflater = null; // e.g. no worker_threads in this environment
      }
    }
  }

  /** Appends `rows` output rows taken from `src` starting at `srcFirstRow`, cropping
   * horizontally at `left` for `width` pixels. Rows must be supplied top to bottom. */
  writeRows(src: Uint8Array, srcWidth: number, left: number, srcFirstRow: number, rows: number): void {
    if (this.finished) throw new Error('PNG stream already finished');
    let remaining = rows;
    let firstRow = srcFirstRow;
    while (remaining > 0) {
      const take = Math.min(this.rowsPerChunk - this.rowsInChunk, remaining, this.height - this.rowsWritten);
      if (take <= 0) throw new Error('PNG stream received more rows than its height');
      for (let y = 0; y < take; y++) {
        let dst = this.rawFill;
        this.raw[dst++] = 0; // filter: None
        let srcIdx = ((firstRow + y) * srcWidth + left) * this.bytesPerPixel;
        if (this.bytesPerPixel === 3) {
          for (let x = 0; x < this.width; x++) {
            this.raw[dst] = src[srcIdx + 2]; // r
            this.raw[dst + 1] = src[srcIdx + 1]; // g
            this.raw[dst + 2] = src[srcIdx]; // b
            dst += 3;
            srcIdx += 3;
          }
        } else {
          for (let x = 0; x < this.width; x++) {
            this.raw[dst] = src[srcIdx + 2];
            this.raw[dst + 1] = src[srcIdx + 1];
            this.raw[dst + 2] = src[srcIdx];
            dst += 3;
            srcIdx += this.bytesPerPixel;
          }
        }
        this.rawFill = dst;
      }
      this.rowsInChunk += take;
      this.rowsWritten += take;
      remaining -= take;
      firstRow += take;
      if (this.rowsInChunk === this.rowsPerChunk) this.flushChunk(this.rowsWritten === this.height);
    }
  }

  finish(): void {
    if (this.finished) return;
    if (this.rowsWritten !== this.height) {
      throw new Error(`PNG stream ended after ${this.rowsWritten} of ${this.height} rows`);
    }
    if (this.rowsInChunk > 0) this.flushChunk(true);
    if (this.deflater) {
      while (this.deflater.pendingCount > 0) this.writeCompressed(this.deflater.collect());
      this.deflater.close();
      this.deflater = null;
    }
    const adler = Buffer.allocUnsafe(4);
    writeBEU32(adler, 0, (((this.adlerB << 16) | this.adlerA) >>> 0));
    writeChunk(this.fd, CHUNK_IDAT, adler);
    writeChunk(this.fd, CHUNK_IEND, Buffer.alloc(0));
    fs.closeSync(this.fd);
    this.finished = true;
  }

  /** Closes the file without a valid trailer; used when a render is cancelled. */
  abort(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.deflater) {
      this.deflater.close();
      this.deflater = null;
    }
    try { fs.closeSync(this.fd); } catch { /* ignore */ }
  }

  private flushChunk(last: boolean): void {
    const filled = this.rawFill;
    let a = this.adlerA;
    let b = this.adlerB;
    let i = 0;
    while (i < filled) {
      const end = Math.min(filled, i + ADLER_NMAX);
      for (; i < end; i++) {
        a += this.raw[i];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
    this.adlerA = a;
    this.adlerB = b;

    if (this.deflater) {
      while (this.deflater.freeCount === 0) this.writeCompressed(this.deflater.collect());
      this.deflater.submit(this.raw.subarray(0, filled), last);
      // keep up to one block per worker in flight, draining in submission order
      while (this.deflater.pendingCount >= this.deflater.workers) {
        this.writeCompressed(this.deflater.collect());
      }
      this.rawFill = 0;
      this.rowsInChunk = 0;
      return;
    }

    this.writeCompressed(zlib.deflateRawSync(this.raw.subarray(0, filled), {
      level: this.level,
      finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
    }));
    this.rawFill = 0;
    this.rowsInChunk = 0;
  }

  private writeCompressed(compressed: Buffer): void {
    if (this.firstChunk) {
      const header = Buffer.from([0x78, this.level === 0 ? 0x01 : 0x9c]);
      writeChunk(this.fd, CHUNK_IDAT, Buffer.concat([header, compressed]));
      this.firstChunk = false;
    } else {
      writeChunk(this.fd, CHUNK_IDAT, compressed);
    }
  }
}

export class PngWriter {
  /** Worker threads used to compress PNG scanline blocks (1 = single-threaded). */
  static ParallelCompressionWorkers = 1;

  static save(
    path: string,
    data: Uint8Array,
    surfaceWidth: number,
    bytesPerPixel: number,
    rect: Rectangle,
    compressionLevel: number,
  ): void {
    const writer = new PngStreamWriter(path, rect.Width, rect.Height, bytesPerPixel, compressionLevel);
    try {
      // Feed the surface one compression chunk's worth of rows at a time so the
      // crop/stride walk happens over the same bounded row count.
      const rowsPerBatch = Math.max(1, Math.min(rect.Height, Math.floor(MAX_RAW_CHUNK / (rect.Width * 3 + 1))));
      for (let top = 0; top < rect.Height; top += rowsPerBatch) {
        const rows = Math.min(rowsPerBatch, rect.Height - top);
        writer.writeRows(data, surfaceWidth, rect.Left, rect.Top + top, rows);
      }
      writer.finish();
    } catch (e) {
      writer.abort();
      throw e;
    }
  }
}

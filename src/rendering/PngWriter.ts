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

const crcTable = buildCrcTable();
type Crc32Fn = (data: Uint8Array, value?: number) => number;
const nativeCrc32 = (zlib as unknown as { crc32?: Crc32Fn }).crc32;
const hasNativeCrc = typeof nativeCrc32 === 'function';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Rows per compression chunk; the raw buffer stays a few MiB even for huge maps. */
const MAX_RAW_CHUNK = 4 * 1024 * 1024;

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

export class PngWriter {
  static save(
    path: string,
    data: Uint8Array,
    surfaceWidth: number,
    bytesPerPixel: number,
    rect: Rectangle,
    compressionLevel: number,
  ): void {
    // API callers can bypass the CLI parser; zlib throws RangeError outside 0..9.
    const level = Number.isFinite(compressionLevel)
      ? Math.min(9, Math.max(0, Math.trunc(compressionLevel)))
      : 4;
    const fd = fs.openSync(path, 'w');
    try {
      fs.writeSync(fd, PNG_SIGNATURE);

      const ihdr = Buffer.alloc(13);
      writeBEU32(ihdr, 0, rect.Width);
      writeBEU32(ihdr, 4, rect.Height);
      ihdr[8] = 8; // bit depth
      ihdr[9] = 2; // color type: truecolor
      fs.writeSync(fd, PngWriter.chunk('IHDR', ihdr));

      // One zlib stream split over multiple IDAT chunks: the header goes in the
      // first block, the Adler-32 trailer in the last one.
      const zlibHeader = Buffer.from([0x78, level === 0 ? 0x01 : 0x9c]);
      const rowBytes = rect.Width * 3;
      const rowsPerChunk = Math.max(1, Math.min(rect.Height, Math.floor(MAX_RAW_CHUNK / (rowBytes + 1))));
      let adlerA = 1;
      let adlerB = 0;
      let first = true;

      for (let top = 0; top < rect.Height; top += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, rect.Height - top);
        const raw = new Uint8Array((rowBytes + 1) * rows);
        let rawIdx = 0;
        for (let y = 0; y < rows; y++) {
          const rowStart = rawIdx;
          raw[rawIdx++] = 0; // filter: None
          let srcIdx = ((rect.Top + top + y) * surfaceWidth + rect.Left) * bytesPerPixel;
          for (let x = 0; x < rect.Width; x++) {
            raw[rawIdx++] = data[srcIdx + 2]; // r
            raw[rawIdx++] = data[srcIdx + 1]; // g
            raw[rawIdx++] = data[srcIdx + 0]; // b
            srcIdx += bytesPerPixel;
          }
          for (let i = rowStart; i < rawIdx; i++) {
            adlerA += raw[i];
            adlerB += adlerA;
            if ((i & 0x3ff) === 0x3ff) {
              adlerA %= 65521;
              adlerB %= 65521;
            }
          }
        }
        adlerA %= 65521;
        adlerB %= 65521;

        const last = top + rows >= rect.Height;
        const compressed = zlib.deflateRawSync(raw, {
          level,
          finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
        });
        const payload = first ? Buffer.concat([zlibHeader, compressed]) : compressed;
        fs.writeSync(fd, PngWriter.chunk('IDAT', payload));
        first = false;
      }

      const adler = Buffer.alloc(4);
      writeBEU32(adler, 0, (((adlerB << 16) | adlerA) >>> 0));
      fs.writeSync(fd, PngWriter.chunk('IDAT', adler));
      fs.writeSync(fd, PngWriter.chunk('IEND', Buffer.alloc(0)));
    } finally {
      fs.closeSync(fd);
    }
  }

  private static chunk(type: string, payload: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    writeBEU32(len, 0, payload.length);
    // CRC over type+payload without copying the payload: zlib.crc32 accepts the
    // previous checksum, so crc(type+payload) = crc(payload, crc(type)).
    const crc = hasNativeCrc
      ? (nativeCrc32!(payload, nativeCrc32!(t)) >>> 0)
      : (updateCrc(0xffffffff, Buffer.concat([t, payload])) ^ 0xffffffff);
    const crcBuf = Buffer.alloc(4);
    writeBEU32(crcBuf, 0, crc >>> 0);
    return Buffer.concat([len, t, payload, crcBuf]);
  }
}

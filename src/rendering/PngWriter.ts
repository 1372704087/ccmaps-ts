// Port of CNCMaps.Engine.Rendering.PngWriter
//
// Writes truecolor (RGB) PNGs with unfiltered (filter-type-0) scanlines, matching
// the byte layout of the C# writer. Compression is delegated to Node's zlib
// (deflateSync) which produces a valid single-stream zlib payload; the C# version
// used a pigz-style parallel deflate but the resulting PNGs are equivalent.
import * as fs from 'node:fs';
import { deflateSync, deflateSync as _deflate } from 'node:zlib';
import { Rectangle } from '../shared/Geometry.js';

void _deflate;

const crcTable = buildCrcTable();

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
    const rowBytes = rect.Width * 3;
    const raw = new Uint8Array((rowBytes + 1) * rect.Height);

    // Build the filtered stream: each scanline prefixed with filter type 0, and
    // pixels converted from BGR memory order to PNG RGB.
    for (let y = 0; y < rect.Height; y++) {
      let rawIdx = y * (rowBytes + 1);
      raw[rawIdx++] = 0; // filter: None
      let srcIdx = ((rect.Top + y) * surfaceWidth + rect.Left) * bytesPerPixel;
      for (let x = 0; x < rect.Width; x++) {
        raw[rawIdx++] = data[srcIdx + 2]; // r
        raw[rawIdx++] = data[srcIdx + 1]; // g
        raw[rawIdx++] = data[srcIdx + 0]; // b
        srcIdx += bytesPerPixel;
      }
    }

    const idat = deflateSync(raw, { level: compressionLevel });

    const chunks: Buffer[] = [];
    chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // IHDR: 8-bit truecolor
    const ihdr = Buffer.alloc(13);
    writeBEU32(ihdr, 0, rect.Width);
    writeBEU32(ihdr, 4, rect.Height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: truecolor
    chunks.push(PngWriter.chunk('IHDR', ihdr));

    chunks.push(PngWriter.chunk('IDAT', Buffer.from(idat)));
    chunks.push(PngWriter.chunk('IEND', Buffer.alloc(0)));

    fs.writeFileSync(path, Buffer.concat(chunks));
  }

  private static chunk(type: string, payload: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    writeBEU32(len, 0, payload.length);
    const crcData = Buffer.concat([t, payload]);
    const crc = updateCrc(0xffffffff, crcData) ^ 0xffffffff;
    const crcBuf = Buffer.alloc(4);
    writeBEU32(crcBuf, 0, crc >>> 0);
    return Buffer.concat([len, t, payload, crcBuf]);
  }
}
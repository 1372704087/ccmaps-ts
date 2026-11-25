// Shared PNG decoding helpers for tests, benchmarks and image comparison.
// The writer emits 8-bit truecolor images; all five scanline filters are handled
// so the pixel hash stays valid if the filter type ever changes.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  rgb: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 2)
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = Buffer.alloc(stride * height);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const b = raw[rawPos++];
      const left = x >= 3 ? rgb[rowStart + x - 3] : 0;
      const up = y > 0 ? rgb[prevStart + x] : 0;
      const upLeft = x >= 3 && y > 0 ? rgb[prevStart + x - 3] : 0;
      let v: number;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + left; break;
        case 2: v = b + up; break;
        case 3: v = b + ((left + up) >> 1); break;
        case 4: v = b + paeth(left, up, upLeft); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      rgb[rowStart + x] = v & 0xff;
    }
  }
  return { width, height, rgb };
}

/// <summary>Hash of the decoded pixel data, independent of the PNG encoding. Matches the
/// .NET GoldenRenderTests.PixelHash: "WxH:" then the RGB rows.</summary>
export function pixelHashFromBuffer(buf: Buffer): string {
  const { width, height, rgb } = decodePng(buf);
  const h = createHash('sha256');
  h.update(Buffer.from(`${width}x${height}:`, 'ascii'));
  h.update(rgb);
  return h.digest('hex');
}

export function pixelHash(pngPath: string): string {
  return pixelHashFromBuffer(fs.readFileSync(pngPath));
}

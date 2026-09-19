import { ByteReader } from './ByteReader.js';

// Port of Format3 (per-row run-length for tiles).
export class Format3 {
  static DecodeInto(src: Uint8Array, dst: Uint8Array, cx: number, cy: number): number {
    const r = new ByteReader(src);
    let w = 0;
    for (let y = 0; y < cy; y++) {
      let count = r.readUInt16() - 2;
      let x = 0;
      while (count-- > 0) {
        let v = r.readByte();
        if (v !== 0) {
          x++;
          dst[w++] = v;
        } else {
          count--;
          v = r.readByte();
          if (x + v > cx) v = cx - x;
          x += v;
          while (v-- !== 0) dst[w++] = 0;
        }
      }
    }
    return w;
  }
}
import { ByteReader } from './ByteReader.js';

// Port of Format40 (XOR-based compression used by SHP).
export class Format40 {
  static DecodeInto(src: Uint8Array, dest: Uint8Array): number {
    const ctx = new ByteReader(src);
    let destIndex = 0;
    while (true) {
      const i = ctx.readByte();
      if ((i & 0x80) === 0) {
        const count = i & 0x7f;
        if (count === 0) {
          // case 6
          const c = ctx.readByte();
          const value = ctx.readByte();
          for (let end = destIndex + c; destIndex < end; destIndex++) dest[destIndex] ^= value;
        } else {
          // case 5
          for (let end = destIndex + count; destIndex < end; destIndex++) dest[destIndex] ^= ctx.readByte();
        }
      } else {
        let count = i & 0x7f;
        if (count === 0) {
          count = ctx.readInt16();
          if (count === 0) return destIndex;
          if ((count & 0x8000) === 0) {
            // case 2, skip
            destIndex += count & 0x7fff;
          } else if ((count & 0x4000) === 0) {
            // case 3
            for (let end = destIndex + (count & 0x3fff); destIndex < end; destIndex++) dest[destIndex] ^= ctx.readByte();
          } else {
            // case 4
            const value = ctx.readByte();
            for (let end = destIndex + (count & 0x3fff); destIndex < end; destIndex++) dest[destIndex] ^= value;
          }
        } else {
          // case 1
          destIndex += count;
        }
      }
    }
  }
}
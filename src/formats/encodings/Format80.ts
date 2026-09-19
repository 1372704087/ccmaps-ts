import { ByteReader } from './ByteReader.js';

// Port of Format80 (RLE/image-line compression used by SHP/TMP).
export class Format80 {
  static DecodeInto(src: Uint8Array, dest: Uint8Array): number {
    const ctx = new ByteReader(src);
    let destIndex = 0;
    while (true) {
      const i = ctx.readByte();
      if ((i & 0x80) === 0) {
        // case 2
        const secondByte = ctx.readByte();
        const count = ((i & 0x70) >> 4) + 3;
        const rpos = ((i & 0xf) << 8) + secondByte;
        destIndex = replicatePrevious(dest, destIndex, destIndex - rpos, count);
      } else if ((i & 0x40) === 0) {
        // case 1
        const count = i & 0x3f;
        if (count === 0) return destIndex;
        ctx.readInto(dest, destIndex, count);
        destIndex += count;
      } else {
        const count3 = i & 0x3f;
        if (count3 === 0x3e) {
          // case 4 (fill)
          const count = ctx.readUInt16();
          const color = ctx.readByte();
          for (let end = destIndex + count; destIndex < end; destIndex++) dest[destIndex] = color;
        } else if (count3 === 0x3f) {
          // case 5
          const count = ctx.readUInt16();
          let srcIndex = ctx.readUInt16();
          for (let end = destIndex + count; destIndex < end; destIndex++) dest[destIndex] = dest[srcIndex++];
        } else {
          // case 3
          const count = count3 + 3;
          let srcIndex = ctx.readUInt16();
          for (let end = destIndex + count; destIndex < end; destIndex++) dest[destIndex] = dest[srcIndex++];
        }
      }
    }
  }

  // Quick and dirty Format80 encoder: raw copy + RLE.
  static Encode(src: Uint8Array): Uint8Array {
    const out: number[] = [];
    let offset = 0;
    const left = src.length;
    let blockStart = 0;
    while (offset < left) {
      const repeatCount = countSame(src, offset, 0xffff);
      if (repeatCount >= 4) {
        writeCopyBlocks(src, blockStart, offset - blockStart, out);
        out.push(0xfe);
        out.push(repeatCount & 0xff);
        out.push(repeatCount >> 8);
        out.push(src[offset]);
        offset += repeatCount;
        blockStart = offset;
      } else {
        offset++;
      }
    }
    writeCopyBlocks(src, blockStart, offset - blockStart, out);
    out.push(0x80);
    return new Uint8Array(out);
  }
}

function replicatePrevious(dest: Uint8Array, destIndex: number, srcIndex: number, count: number): number {
  if (srcIndex > destIndex) throw new Error('Format80: srcIndex > destIndex in replicatePrevious');
  for (let i = 0; i < count; i++) dest[destIndex + i] = dest[srcIndex + i];
  return destIndex + count;
}

function countSame(src: Uint8Array, offset: number, maxCount: number): number {
  maxCount = Math.min(src.length - offset, maxCount);
  if (maxCount <= 0) return 0;
  const first = src[offset++];
  let count = 1;
  while (count < maxCount && src[offset++] === first) count++;
  return count;
}

function writeCopyBlocks(src: Uint8Array, offset: number, count: number, out: number[]): void {
  while (count > 0) {
    const writeNow = Math.min(count, 0x3f);
    out.push(0x80 | writeNow);
    for (let i = 0; i < writeNow; i++) out.push(src[offset + i]);
    count -= writeNow;
    offset += writeNow;
  }
}
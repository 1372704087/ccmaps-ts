import { ByteReader, ByteWriter } from './ByteReader.js';
import { Format80 } from './Format80.js';
import { MiniLZO } from './MiniLZO.js';

// Port of Format5 (chunked LZO stream used by map IsoMapPack5 and tile sets).
// Encoded as a sequence of chunks: [u16 size_out][u16 size_in][LZO/Format80 data].
export class Format5 {
  static DecodeInto(src: Uint8Array, dest: Uint8Array, format = 5): number {
    const scratch = format === 80 ? null : new Uint8Array(0xffff + MiniLZO.LZO_OUT_SLACK);
    const r = new ByteReader(src);
    let w = 0;
    const wEnd = dest.length;

    while (w < wEnd) {
      if (r.remaining < 4) break;
      const size_in = r.readUInt16();
      const size_out = r.readUInt16();
      if (size_in === 0 || size_out === 0) break;
      if (r.remaining < size_in) break;
      if (size_out > wEnd - w) break;

      if (format === 80) {
        Format80.DecodeInto(
          src.subarray(r.pos, r.pos + size_in),
          dest.subarray(w, w + size_out),
        );
        r.skip(size_in);
        w += size_out;
      } else {
        const chunkIn = src.subarray(r.pos, r.pos + size_in);
        r.skip(size_in);
        let produced = size_out;
        const status = MiniLZO.Decompress(
          chunkIn,
          scratch!,
          size_out + MiniLZO.LZO_OUT_SLACK,
          (p) => { produced = Math.min(p, size_out); },
        );
        if (status < 0 || produced > size_out) break;
        dest.set(scratch!.subarray(0, produced), w);
        w += produced;
      }
    }
    return w;
  }

  // Port of Format5.Encode: split source into 8192-byte chunks, compress each,
  // write [u16 out][u16 in][data].
  static Encode(source: Uint8Array, format: number): Uint8Array {
    const out = new ByteWriter(source.length * 2);
    const src = new ByteReader(source);
    while (!src.eof) {
      const cb_in = Math.min(src.remaining, 8192);
      const chunk_in = src.buf.subarray(src.pos, src.pos + cb_in);
      src.skip(cb_in);
      const chunk_out = format === 80 ? Format80.Encode(chunk_in) : MiniLZO.Compress(chunk_in);
      const cb_out = chunk_out.length;
      out.writeUInt16(cb_out);
      out.writeUInt16(cb_in);
      out.writeBytes(chunk_out);
    }
    return out.getResult();
  }
}

// Keep a module-level helper for callers that encoded sections with MiniLZO directly.
export function encodeFormat5Section(s: Uint8Array): Uint8Array {
  return MiniLZO.Compress(s);
}
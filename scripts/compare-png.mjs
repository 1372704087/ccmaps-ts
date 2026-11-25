#!/usr/bin/env node
// Compares two 8-bit truecolor PNGs by decoded pixels, one row at a time, so
// two large renders never have to be fully decoded in memory at once.
//
// Usage: node scripts/compare-png.mjs <a.png> <b.png>
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

function parsePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    throw new Error('not a PNG');
  let pos = 8;
  const header = { width: 0, height: 0, idat: [] };
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      header.width = data.readUInt32BE(0);
      header.height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2)
        throw new Error(`unsupported PNG: bit depth ${data[8]}, color type ${data[9]}`);
    } else if (type === 'IDAT') {
      header.idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  return header;
}

class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  push(buf) {
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.length += buf.length;
  }
  take(n) {
    const out = Buffer.allocUnsafe(n);
    let filled = 0;
    while (filled < n) {
      const head = this.chunks[0];
      const need = n - filled;
      if (head.length <= need) {
        head.copy(out, filled);
        filled += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, filled, 0, need);
        this.chunks[0] = head.subarray(need);
        filled += need;
      }
    }
    this.length -= n;
    return out;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterRow(filter, raw, prev, stride) {
  const row = Buffer.allocUnsafe(stride);
  for (let x = 0; x < stride; x++) {
    const left = x >= 3 ? row[x - 3] : 0;
    const up = prev != null ? prev[x] : 0;
    const upLeft = x >= 3 && prev != null ? prev[x - 3] : 0;
    let v;
    switch (filter) {
      case 0: v = raw[x]; break;
      case 1: v = raw[x] + left; break;
      case 2: v = raw[x] + up; break;
      case 3: v = raw[x] + ((left + up) >> 1); break;
      case 4: v = raw[x] + paeth(left, up, upLeft); break;
      default: throw new Error(`bad PNG filter ${filter}`);
    }
    row[x] = v & 0xff;
  }
  return row;
}

async function* pngRows(header, source) {
  const stride = header.width * 3;
  const queue = new ByteQueue();
  const inflate = zlib.createInflate();
  for (const chunk of header.idat) inflate.write(chunk);
  inflate.end();
  let prev = null;
  try {
    for await (const chunk of inflate) {
      queue.push(chunk);
      while (queue.length >= stride + 1) {
        const filter = queue.take(1)[0];
        const raw = queue.take(stride);
        const row = unfilterRow(filter, raw, prev, stride);
        prev = row;
        yield row;
      }
    }
  } finally {
    inflate.destroy();
  }
}

async function main() {
  const [fileA, fileB] = process.argv.slice(2);
  if (!fileA || !fileB) {
    console.error('Usage: node scripts/compare-png.mjs <a.png> <b.png>');
    return 2;
  }
  const headerA = parsePng(fs.readFileSync(fileA));
  const headerB = parsePng(fs.readFileSync(fileB));
  if (headerA.width !== headerB.width || headerA.height !== headerB.height) {
    console.log(`size differs: ${headerA.width}x${headerA.height} vs ${headerB.width}x${headerB.height}`);
    return 1;
  }

  const rowsA = pngRows(headerA);
  const rowsB = pngRows(headerB);
  let y = 0;
  try {
    for (;;) {
      const a = await rowsA.next();
      const b = await rowsB.next();
      if (a.done || b.done) {
        if (a.done !== b.done) {
          console.log(`row count differs at y=${y}`);
          return 1;
        }
        break;
      }
      if (!a.value.equals(b.value)) {
        let i = 0;
        while (i < a.value.length && a.value[i] === b.value[i]) i++;
        const x = Math.floor(i / 3);
        const channel = ['R', 'G', 'B'][i % 3];
        console.log(
          `first difference at y=${y} x=${x} ${channel}: ` +
          `${a.value[i]} (a) vs ${b.value[i]} (b) in ${headerA.width}x${headerA.height}`,
        );
        return 1;
      }
      y++;
    }
  } finally {
    await rowsA.return?.();
    await rowsB.return?.();
  }
  console.log(`identical pixels: ${headerA.width}x${headerA.height}`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(String(e && e.stack || e));
  process.exit(2);
});

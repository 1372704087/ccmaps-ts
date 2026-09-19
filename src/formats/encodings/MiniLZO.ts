// Index-based port of the minilzo lzo1x_decompress used by Format5.
// The C# version uses byte pointers; here we use numeric offsets into Uint8Array.
// Semantics are preserved exactly (runs copied 4 bytes at a time may overshoot the
// logical end by up to 3 bytes, hence callers must supply LZO_OUT_SLACK headroom).

function readU16LE(buf: Uint8Array, off: number): number {
  return (buf[off] & 0xff) | ((buf[off + 1] & 0xff) << 8);
}
function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off] | 0) + (buf[off + 1] << 8) + (buf[off + 2] << 16) + (buf[off + 3] << 24)) >>> 0;
}
function writeU16LE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
}

// Fast 4-byte big-endian-free little-endian read.
function rd32(buf: Uint8Array, off: number): number {
  return readU32LE(buf, off);
}
function wr32(buf: Uint8Array, off: number, v: number): void {
  writeU16LE(buf, off, v & 0xffff);
  writeU16LE(buf, off + 2, v >>> 16);
}
function rd16(buf: Uint8Array, off: number): number {
  return readU16LE(buf, off);
}

export class MiniLZO {
  static readonly LZO_E_OUTPUT_OVERRUN = -5;
  static readonly LZO_E_LOOKBEHIND_OVERRUN = -6;
  static readonly LZO_OUT_SLACK = 8;

  // Decompresses `input` into `out` at capacity `outCap`. `out` must have
  // outCap + LZO_OUT_SLACK bytes. Returns lzo status (0 = success).
  static Decompress(input: Uint8Array, out: Uint8Array, outCap: number, onProduced?: (p: number) => void): number {
    const ipEnd = input.length;
    const opEnd = outCap;
    let op = 0;
    let ip = 0;
    let t = 0;
    onProduced?.(0);

    const outputOverrun = (): number => { let _ = op; void _; onProduced?.(op); return MiniLZO.LZO_E_OUTPUT_OVERRUN; };
    const lookbehindOverrun = (): number => { onProduced?.(op); return MiniLZO.LZO_E_LOOKBEHIND_OVERRUN; };

    // match_next: copies t bytes then reads the next command
    const match_next = (): void => { do { out[op++] = input[ip++]; } while (--t > 0); t = input[ip++]; };
    // copy_match: copies t bytes from m_pos
    const copy_match = (mPos: number, cnt: number): number => {
      let mp = mPos;
      out[op++] = out[mp++];
      out[op++] = out[mp++];
      do { out[op++] = out[mp++]; } while (--cnt > 0);
      void cnt;
      return mp;
    };

    let gtFirstLiteralRun = false;
    let gtMatchDone = false;

    if (input[ip] > 17) {
      t = input[ip++] - 17;
      if (t < 4) {
        if (op + t > opEnd) return outputOverrun();
        match_next();
      } else {
        if (op + t > opEnd) return outputOverrun();
        do { out[op++] = input[ip++]; } while (--t > 0);
        gtFirstLiteralRun = true;
      }
    }

    for (;;) {
      let gotoFirstLiteralRun = false;
      if (gtFirstLiteralRun) {
        gtFirstLiteralRun = false;
        gotoFirstLiteralRun = true;
      } else {
        t = input[ip++];
        if (t < 16) {
          if (t === 0) {
            while (input[ip] === 0) { t += 255; ip++; }
            t += 15 + input[ip++];
          }
          if (op + t + 3 > opEnd) return outputOverrun();
          wr32(out, op, rd32(input, ip));
          op += 4; ip += 4;
          if (--t > 0) {
            if (t >= 4) {
              do {
                wr32(out, op, rd32(input, ip));
                op += 4; ip += 4; t -= 4;
              } while (t >= 4);
              if (t > 0) do { out[op++] = input[ip++]; } while (--t > 0);
            } else {
              do { out[op++] = input[ip++]; } while (--t > 0);
            }
          }
          // fell through the literal run into first_literal_run
          gotoFirstLiteralRun = true;
        }
        // else t >= 16 is a match token: skip first_literal_run and go to match
      }

      // first_literal_run (skipped when the token above was a match, i.e. t>=16)
      if (gotoFirstLiteralRun) {
        t = input[ip++];
        if (t >= 16) {
          // -> match below
        } else {
          let mPos = op - (1 + 0x0800);
          mPos -= t >> 2;
          mPos -= input[ip++] << 2;
          if (mPos < 0) return lookbehindOverrun();
          if (op + 3 > opEnd) return outputOverrun();
          out[op++] = out[mPos++]; out[op++] = out[mPos++]; out[op++] = out[mPos];
          gtMatchDone = true;
        }
      }

      // match:
      // In the C#/minilzo original every match token, plus the implicit short
      // match from first_literal_run, falls through (via goto) to the shared
      // `match_done` tail that reads `t = ip[-2] & 3` and may process another
      // match_next run. The earlier port used `break` here, which skips that
      // tail and desynchronizes the stream; route all of them through it.
      do {
        let mPos = 0;
        let goMatchDone = false;

        if (gtMatchDone) {
          gtMatchDone = false;
          goMatchDone = true; // -> match_done (3 bytes already copied above)
        } else if (t >= 64) {
          mPos = op - 1;
          mPos -= (t >> 2) & 7;
          mPos -= input[ip++] << 3;
          t = (t >> 5) - 1;
          if (mPos < 0) return lookbehindOverrun();
          if (op + t + 2 > opEnd) return outputOverrun();
          copy_match(mPos, t);
          goMatchDone = true; // -> match_done
        } else if (t >= 32) {
          t &= 31;
          if (t === 0) {
            while (input[ip] === 0) { t += 255; ip++; }
            t += 31 + input[ip++];
          }
          mPos = op - 1;
          mPos -= rd16(input, ip) >> 2;
          ip += 2;
        } else if (t >= 16) {
          mPos = op;
          mPos -= (t & 8) << 11;
          t &= 7;
          if (t === 0) {
            while (input[ip] === 0) { t += 255; ip++; }
            t += 7 + input[ip++];
          }
          mPos -= rd16(input, ip) >> 2;
          ip += 2;
          if (mPos === op) {
            // eof_found
            onProduced?.(op);
            return ip === ipEnd ? 0 : ip < ipEnd ? -8 : -4;
          }
          mPos -= 0x4000;
        } else {
          mPos = op - 1;
          mPos -= t >> 2;
          mPos -= input[ip++] << 2;
          if (mPos < 0) return lookbehindOverrun();
          if (op + 2 > opEnd) return outputOverrun();
          out[op++] = out[mPos++]; out[op++] = out[mPos];
          goMatchDone = true; // -> match_done
        }

        // match_copy: reached only from the t>=32 / t>=16 fall-through paths
        if (!goMatchDone) {
          if (mPos < 0) return lookbehindOverrun();
          if (op + t + 5 > opEnd) return outputOverrun();
          if (t >= 2 * 4 - (3 - 1) && (op - mPos) >= 4) {
            wr32(out, op, rd32(out, mPos));
            op += 4; mPos += 4; t -= 4 - (3 - 1);
            do {
              wr32(out, op, rd32(out, mPos));
              op += 4; mPos += 4; t -= 4;
            } while (t >= 4);
            if (t > 0) do { out[op++] = out[mPos++]; } while (--t > 0);
          } else {
            out[op++] = out[mPos++]; out[op++] = out[mPos++];
            do { out[op++] = out[mPos++]; } while (--t > 0);
          }
        }

        // match_done:
        t = input[ip - 2] & 3;
        if (t === 0) break;
        // match_next:
        if (op + t > opEnd) return outputOverrun();
        out[op++] = input[ip++];
        if (t > 1) { out[op++] = input[ip++]; if (t > 2) out[op++] = input[ip++]; }
        t = input[ip++];
      } while (true);
    }
  }

  // ---- lzo1x_1_compress (index-based, used by Format5.Encode) ----
  static Compress(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length + Math.floor(input.length / 16) + 64 + 3);
    const outLen = lzo1x1Compress(input, input.length, out);
    return out.subarray(0, outLen);
  }
}

const MultiplyDeBruijnBitPosition = [
  0, 1, 28, 2, 29, 14, 24, 3, 30, 22, 20, 15, 25, 17, 4, 8,
  31, 27, 13, 23, 21, 19, 16, 7, 26, 12, 18, 6, 11, 5, 10, 9,
];

function lzoBitopsCtz32(v: number): number {
  return MultiplyDeBruijnBitPosition[((v & -v) * 0x077cb531) >>> 27];
}

// compress one block of size ll starting at `inStart`, append to out at `outStart`.
function lzo1x1CompressCore(
  input: Uint8Array, inStart: number, inLen: number,
  out: Uint8Array, outStart: number, ti: number, dict: Uint16Array,
): { outLen: number; finalIp: number } {
  let ip = inStart;
  let op = outStart;
  const inEnd = inStart + inLen;
  const ipEnd = inStart + inLen - 20;
  let ii = ip;
  if (ti < 4) ip += 4 - ti;

  for (;;) {
    // literal:
    ip += 1 + ((ip - ii) >> 5);
    // next:
    if (ip >= ipEnd) break;
    const dv = rd32(input, ip);
    const dindex = (dv * 0x1824429d) >>> (32 - 14);
    const mPos = inStart + dict[dindex];
    dict[dindex] = (ip - inStart) & 0xffff;
    if (dv !== rd32(input, mPos)) {
      ii = ip;
      continue;
    }
    ii -= ti; ti = 0;
    {
      let t = ip - ii;
      if (t !== 0) {
        if (t <= 3) {
          out[op - 2] |= t;
          wr32(out, op, rd32(input, ii));
          op += t;
        } else if (t <= 16) {
          out[op++] = t - 3;
          wr32(out, op, rd32(input, ii));
          wr32(out, op + 4, rd32(input, ii + 4));
          wr32(out, op + 8, rd32(input, ii + 8));
          wr32(out, op + 12, rd32(input, ii + 12));
          op += t;
        } else {
          if (t <= 18) out[op++] = t - 3;
          else {
            let tt = t - 18;
            out[op++] = 0;
            while (tt > 255) { tt -= 255; out[op++] = 0; }
            out[op++] = tt;
          }
          do {
            wr32(out, op, rd32(input, ii));
            wr32(out, op + 4, rd32(input, ii + 4));
            wr32(out, op + 8, rd32(input, ii + 8));
            wr32(out, op + 12, rd32(input, ii + 12));
            op += 16; ii += 16; t -= 16;
          } while (t >= 16);
          if (t > 0) { do { out[op++] = input[ii++]; } while (--t > 0); }
        }
      }
    }
    let mLen = 4;
    {
      let v = (rd32(input, ip + mLen) ^ rd32(input, mPos + mLen)) >>> 0;
      if (v === 0) {
        do {
          mLen += 4;
          v = (rd32(input, ip + mLen) ^ rd32(input, mPos + mLen)) >>> 0;
          if (ip + mLen >= ipEnd) break;
        } while (v === 0);
      }
      mLen += Math.floor(lzoBitopsCtz32(v >>> 0) / 8);
    }
    let mOff = ip - mPos;
    ip += mLen;
    ii = ip;
    if (mLen <= 8 && mOff <= 0x0800) {
      mOff -= 1;
      out[op++] = ((mLen - 1) << 5) | ((mOff & 7) << 2);
      out[op++] = mOff >> 3;
    } else if (mOff <= 0x4000) {
      mOff -= 1;
      if (mLen <= 33) out[op++] = 32 | (mLen - 2);
      else {
        mLen -= 33;
        out[op++] = 32 | 0;
        while (mLen > 255) { mLen -= 255; out[op++] = 0; }
        out[op++] = mLen;
      }
      out[op++] = (mOff << 2) & 0xff;
      out[op++] = mOff >> 6;
    } else {
      mOff -= 0x4000;
      if (mLen <= 9) out[op++] = 16 | ((mOff >> 11) & 8) | (mLen - 2);
      else {
        mLen -= 9;
        out[op++] = 16 | ((mOff >> 11) & 8);
        while (mLen > 255) { mLen -= 255; out[op++] = 0; }
        out[op++] = mLen;
      }
      out[op++] = (mOff << 2) & 0xff;
      out[op++] = mOff >> 6;
    }
    // goto next
    void inEnd;
  }
  return { outLen: op - outStart, finalIp: ip };
}

function lzo1x1Compress(input: Uint8Array, inLen: number, out: Uint8Array): number {
  const dict = new Uint16Array(1 << 14);
  let ip = 0;
  let op = 0;
  let l = inLen;
  let t = 0;
  while (l > 20) {
    let ll = l;
    ll = ll <= 49152 ? ll : 49152;
    dict.fill(0);
    const res = lzo1x1CompressCore(input, ip, ll, out, op, t, dict);
    t = res.finalIp - ip;
    ip += ll;
    op += res.outLen;
    l -= ll;
  }
  t += l;
  if (t > 0) {
    let ii = input.length - t;
    if (op === 0 && t <= 238) out[op++] = 17 + t;
    else if (t <= 3) out[op - 2] |= t;
    else if (t <= 18) out[op++] = t - 3;
    else {
      let tt = t - 18;
      out[op++] = 0;
      while (tt > 255) { tt -= 255; out[op++] = 0; }
      out[op++] = tt;
    }
    do { out[op++] = input[ii++]; } while (--t > 0);
  }
  out[op++] = 16 | 1;
  out[op++] = 0;
  out[op++] = 0;
  return op;
}
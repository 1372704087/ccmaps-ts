// Deterministic pseudo-random matching System.Random with a fixed seed,
// ported from CNCMaps.Shared.Utility.Rand

export class RandImpl {
  // System.Random uses a 56-bit "seed array" based on an int seed.
  private seedArray: Int32Array;
  private inext = 0;
  private inextp = 0;

  constructor(seed: number) {
    // port of System.Random ctor
    const ii = new Int32Array(56);
    let subtraction = seed === -2147483648 ? 2147483647 : Math.abs(seed);
    let mj = 161803398 - subtraction;
    mj %= 2147483647;
    if (mj < 0) mj += 2147483647;
    ii[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii21 = (21 * i) % 55;
      ii[ii21] = mk;
      mk = mj - mk;
      if (mk < 0) mk += 2147483647;
      mj = ii[ii21];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        const n = (i + 30) % 55;
        ii[i] -= ii[n];
        if (ii[i] < 0) ii[i] += 2147483647;
      }
    }
    this.seedArray = ii;
    this.inext = 0;
    this.inextp = 21;
  }

  private internalSample(): number {
    let locINext = this.inext + 1;
    let locINextp = this.inextp + 1;
    if (locINext >= 56) locINext = 1;
    if (locINextp >= 56) locINextp = 1;
    let retVal = this.seedArray[locINext] - this.seedArray[locINextp];
    if (retVal < 0) retVal += 2147483647;
    this.seedArray[locINext] = retVal;
    this.inext = locINext;
    this.inextp = locINextp;
    return retVal;
  }

  next(): number {
    // System.Random.Next() returns internalSample & MaxValue
    return this.internalSample() & 2147483647;
  }

  nextMax(maxValue: number): number {
    return this.getSampleForLargeRange(maxValue);
  }

  nextDouble(): number {
    return this.internalSample() * 4.6566128752457969e-10;
  }

  private getSampleForLargeRange(maxValue: number): number {
    // equivalent to GetSampleForLargeRange / Next(min, max-style) for max<=Int32.MaxValue
    const sample = this.next();
    return sample % maxValue;
  }
}

export class Rand {
  private static readonly Seed = 32846238;
  private static r: RandImpl = new RandImpl(Rand.Seed);

  static reset(): void {
    Rand.r = new RandImpl(Rand.Seed);
  }
  static next(): number {
    return Rand.r.next();
  }
  static nextMax(maxValue: number): number {
    return Rand.r.nextMax(maxValue);
  }
  static nextDouble(): number {
    return Rand.r.nextDouble();
  }
}

// Simple equality-comparer helper (port of Compare.By)
export class Compare {
  static by<TSource, TIdentity>(identitySelector: (x: TSource) => TIdentity): (a: TSource, b: TSource) => boolean {
    return (x, y) => Object.is(identitySelector(x), identitySelector(y));
  }
}

// Match C# string case-insensitive comparisons used in the renderer.
export function ci(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}
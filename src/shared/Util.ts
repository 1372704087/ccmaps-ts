// Deterministic pseudo-random matching System.Random with a fixed seed,
// ported from CNCMaps.Shared.Utility.Rand

export class RandImpl {
  // System.Random uses a 56-element "seed array" based on an int seed.
  private seedArray: Int32Array;
  private inext = 0;
  private inextp = 0;

  constructor(seed: number) {
    // port of Random.CompatPrng.Initialize
    const ii = new Int32Array(56);
    const subtraction = seed === -2147483648 ? 2147483647 : Math.abs(seed);
    let mj = 161803398 - subtraction;
    ii[55] = mj;
    let mk = 1;
    let idx = 0;
    for (let i = 1; i < 55; i++) {
      // the range [1..55] is special (Knuth) and so we're wasting the 0'th position
      idx += 21;
      if (idx >= 55) idx -= 55;
      ii[idx] = mk;
      mk = mj - mk;
      if (mk < 0) mk += 2147483647;
      mj = ii[idx];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let n = i + 30;
        if (n >= 55) n -= 55;
        ii[i] -= ii[1 + n];
        if (ii[i] < 0) ii[i] += 2147483647;
      }
    }
    this.seedArray = ii;
    this.inext = 0;
    this.inextp = 21;
  }

  private internalSample(): number {
    let locINext = this.inext;
    let locINextp = this.inextp;
    if (++locINext >= 56) locINext = 1;
    if (++locINextp >= 56) locINextp = 1;
    let retVal = this.seedArray[locINext] - this.seedArray[locINextp];
    if (retVal === 2147483647) retVal--;
    if (retVal < 0) retVal += 2147483647;
    this.seedArray[locINext] = retVal;
    this.inext = locINext;
    this.inextp = locINextp;
    return retVal;
  }

  next(): number {
    // Random.Next() is InternalSample(), already in [0, int.MaxValue)
    return this.internalSample();
  }

  nextMax(maxValue: number): number {
    // Random.Next(int maxValue) converts Sample() * maxValue to an integer natively
    return Math.trunc(this.sample() * maxValue);
  }

  nextDouble(): number {
    return this.sample();
  }

  private sample(): number {
    return this.internalSample() * (1.0 / 2147483647);
  }
}

export class Rand {
  private static readonly Seed = 32846238;
  private static r: RandImpl = new RandImpl(Rand.Seed);

  /// <summary>When set, every draw yields its first option instead of a random one. The sequence
  /// is shared by all callers, so adding or removing one object shifts every later draw; pinning
  /// removes that coupling for A/B renders against an engine capture.</summary>
  static Pinned = false;

  static reset(): void {
    Rand.r = new RandImpl(Rand.Seed);
  }
  static next(): number {
    return Rand.Pinned ? 0 : Rand.r.next();
  }
  static nextMax(maxValue: number): number {
    return Rand.Pinned ? 0 : Rand.r.nextMax(maxValue);
  }
  static nextDouble(): number {
    return Rand.Pinned ? 0.0 : Rand.r.nextDouble();
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
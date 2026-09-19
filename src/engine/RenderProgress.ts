// Port of CNCMaps.Engine.RenderProgress
// Monotonic 0-100 progress over a whole render. Phase boundaries are fixed
// percentages taken from measured renders; within the drawing and encoding
// phases progress follows real units (rows drawn, blocks compressed), so the
// bar never guesses from wall-clock time.

export class RenderProgress {
  private readonly sink: ((percent: number, phase: string) => void) | null;
  private last = -1;

  /// <summary>Where the drawing phase ends and encoding begins.</summary>
  readonly DrawEnd: number;

  constructor(sink: (percent: number, phase: string) => void, drawEnd = 90) {
    this.sink = sink;
    this.DrawEnd = drawEnd;
  }

  Report(percent: number, phase: string): void {
    if (this.sink == null) return;
    if (percent > 100) percent = 100;
    if (percent <= this.last) return;
    this.last = percent;
    this.sink(percent, phase);
  }

  /// <summary>Reports fraction <paramref name="frac"/> of the span [from, to].</summary>
  Span(from: number, to: number, frac: number, phase: string): void {
    if (frac < 0) frac = 0;
    else if (frac > 1) frac = 1;
    this.Report(from + Math.trunc((to - from) * frac), phase);
  }
}

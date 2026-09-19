// Geometry primitives replicating System.Drawing semantics used throughout CNCMaps.

export class Point {
  constructor(public X: number, public Y: number) {}
  static get Empty(): Point { return new Point(0, 0); }
  get IsEmpty(): boolean { return this.X === 0 && this.Y === 0; }
  Offset(dx: number, dy: number): void { this.X += dx; this.Y += dy; }
  Clone(): Point { return new Point(this.X, this.Y); }
  static Add(p: Point, sz: Size): Point { return new Point(p.X + sz.Width, p.Y + sz.Height); }
  static Subtract(p: Point, sz: Size): Point { return new Point(p.X - sz.Width, p.Y - sz.Height); }
  toString(): string { return `{X=${this.X},Y=${this.Y}}`; }
}

export class Size {
  constructor(public Width: number, public Height: number) {}
  static get Empty(): Size { return new Size(0, 0); }
  get IsEmpty(): boolean { return this.Width === 0 && this.Height === 0; }
  Clone(): Size { return new Size(this.Width, this.Height); }
  toString(): string { return `{Width=${this.Width}, Height=${this.Height}}`; }
}

export class Rectangle {
  constructor(
    public X: number,
    public Y: number,
    public Width: number,
    public Height: number,
  ) {}
  static get Empty(): Rectangle { return new Rectangle(0, 0, 0, 0); }
  get Left(): number { return this.X; }
  get Top(): number { return this.Y; }
  get Right(): number { return this.X + this.Width; }
  get Bottom(): number { return this.Y + this.Height; }
  get Location(): Point { return new Point(this.X, this.Y); }
  get Size(): Size { return new Size(this.Width, this.Height); }
  get IsEmpty(): boolean { return this.Width === 0 && this.Height === 0; }
  ContainsPoint(x: number, y: number): boolean {
    return x >= this.Left && x <= this.Right && y >= this.Top && y <= this.Bottom;
  }
  static FromLTRB(left: number, top: number, right: number, bottom: number): Rectangle {
    return new Rectangle(left, top, right - left, bottom - top);
  }
  static Union(a: Rectangle, b: Rectangle): Rectangle {
    if (a.IsEmpty) return b;
    if (b.IsEmpty) return a;
    const x1 = Math.min(a.X, b.X);
    const y1 = Math.min(a.Y, b.Y);
    const x2 = Math.max(a.Right, b.Right);
    const y2 = Math.max(a.Bottom, b.Bottom);
    return Rectangle.FromLTRB(x1, y1, x2, y2);
  }
  static Intersect(a: Rectangle, b: Rectangle): Rectangle {
    const x1 = Math.max(a.X, b.X);
    const y1 = Math.max(a.Y, b.Y);
    const x2 = Math.min(a.Right, b.Right);
    const y2 = Math.min(a.Bottom, b.Bottom);
    if (x1 >= x2 || y1 >= y2) return Rectangle.Empty;
    return new Rectangle(x1, y1, x2 - x1, y2 - y1);
  }
  Intersect(b: Rectangle): void {
    const r = Rectangle.Intersect(this, b);
    this.X = r.X; this.Y = r.Y; this.Width = r.Width; this.Height = r.Height;
  }
  IntersectsWith(rect: Rectangle): boolean {
    return !(rect.X > this.Right || rect.Right < this.X || rect.Y > this.Bottom || rect.Bottom < this.Y);
  }
  Offset(dx: number, dy: number): void;
  Offset(p: Point): void;
  Offset(dxOrP: number | Point, dy?: number): void {
    if (typeof dxOrP === 'number') {
      this.X += dxOrP;
      this.Y += dy ?? 0;
    } else {
      this.X += dxOrP.X;
      this.Y += dxOrP.Y;
    }
  }
  Clone(): Rectangle { return new Rectangle(this.X, this.Y, this.Width, this.Height); }
  toString(): string { return `{X=${this.X},Y=${this.Y},Width=${this.Width},Height=${this.Height}}`; }
}

// 8-bit RGBA color, matching System.Drawing.Color semantics used in renderers.
export class Color {
  constructor(
    public R: number,
    public G: number,
    public B: number,
    public A: number = 255,
  ) {}
  static FromArgb(a: number, r: number, g: number, b: number): Color {
    return new Color(r, g, b, a);
  }
  static FromArgbArg(argb: number): Color {
    return new Color(
      (argb >> 16) & 0xff,
      (argb >> 8) & 0xff,
      argb & 0xff,
      (argb >>> 24) & 0xff,
    );
  }
  static FromRgb(r: number, g: number, b: number): Color {
    return new Color(r, g, b, 255);
  }
  get IsEmpty(): boolean { return this.R === 0 && this.G === 0 && this.B === 0 && this.A === 0; }
  Clone(): Color { return new Color(this.R, this.G, this.B, this.A); }
}

// Simple 3-element float vector matching System.Numerics.Vector3 semantics.
export class Vector3 {
  constructor(public X: number, public Y: number, public Z: number) {}
  static get Zero(): Vector3 { return new Vector3(0, 0, 0); }
  static get UnitX(): Vector3 { return new Vector3(1, 0, 0); }
  static get UnitY(): Vector3 { return new Vector3(0, 1, 0); }
  static get UnitZ(): Vector3 { return new Vector3(0, 0, 1); }
  static FromScalar(s: number): Vector3 { return new Vector3(s, s, s); }
  static Add(a: Vector3, b: Vector3): Vector3 { return new Vector3(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
  static Subtract(a: Vector3, b: Vector3): Vector3 { return new Vector3(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
  static Multiply(a: Vector3, b: Vector3): Vector3 { return new Vector3(a.X * b.X, a.Y * b.Y, a.Z * b.Z); }
  static MultiplyScalar(a: Vector3, s: number): Vector3 { return new Vector3(a.X * s, a.Y * s, a.Z * s); }
  static Dot(a: Vector3, b: Vector3): number { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
  static Cross(a: Vector3, b: Vector3): Vector3 {
    return new Vector3(
      a.Y * b.Z - a.Z * b.Y,
      a.Z * b.X - a.X * b.Z,
      a.X * b.Y - a.Y * b.X,
    );
  }
  static Normalize(v: Vector3): Vector3 {
    const len = Math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z);
    return new Vector3(v.X / len, v.Y / len, v.Z / len);
  }
  toString(): string { return `<${this.X}, ${this.Y}, ${this.Z}>`; }
}

// Simple 4-element float vector matching System.Numerics.Vector4 semantics.
export class Vector4 {
  constructor(public X: number, public Y: number, public Z: number, public W: number) {}
  toString(): string { return `<${this.X}, ${this.Y}, ${this.Z}, ${this.W}>`; }
}
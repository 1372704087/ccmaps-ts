// Port of CNCMaps.Engine.Utility.Hexagon + Axis
export enum Axis {
  X = 0,
  Y = 1,
  Z = 2,
  None = 3,
}

export class Hexagon {
  xMin = 0;
  xMax = 0;
  yMin = 0;
  yMax = 0;
  zMin = 0;
  zMax = 0;

  static GetSeparationAxis(a: Hexagon, b: Hexagon): Axis {
    if (Hexagon.RangesDisjoint(a.zMin, a.zMax, b.zMin, b.zMax)) return Axis.Z;
    if (Hexagon.RangesDisjoint(a.yMin, a.yMax, b.yMin, b.yMax)) return Axis.Y;
    if (Hexagon.RangesDisjoint(a.xMin, a.xMax, b.xMin, b.xMax)) return Axis.X;
    return Axis.None;
  }

  static RangesDisjoint(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
    return aMax < bMin || bMax < aMin;
  }
}

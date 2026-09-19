// Port of CNCMaps.Engine.Map.ObjectSorter
import { Point, Rectangle } from '../../shared/Geometry.js';
import { Axis, Hexagon } from '../utility/Hexagon.js';
import { SpecialOverlays } from '../game/SpecialOverlays.js';
import {
  GameObject,
  AircraftObject,
  InfantryObject,
  OverlayObject,
  SmudgeObject,
  StructureObject,
  TerrainObject,
  UnitObject,
  AnimationObject,
  OwnableObject,
} from './GameObjects.js';
import { MapTile } from './MapTile.js';
import { TileLayer } from './TileLayer.js';
import type { Theater } from '../game/Theater.js';

export class ObjectSorter {
  private readonly map: TileLayer;
  private readonly t: Theater;
  private readonly graph = new Map<GameObject, Set<GameObject>>();
  private readonly hist = new Set<GameObject>();
  private readonly histOrdered: GameObject[] = [];

  constructor(t: Theater, map: TileLayer) {
    this.map = map;
    this.t = t;
  }

  GetOrderedObjects(): GameObject[] {
    for (let y = 0; y < this.map.Height; y++) {
      for (let x = this.map.Width * 2 - 2; x >= 0; x -= 2) this.ProcessTile(this.map.get(x, y));
      for (let x = this.map.Width * 2 - 3; x >= 0; x -= 2) this.ProcessTile(this.map.get(x, y));
    }

    while (this.graph.size !== 0) {
      let leastDyKey: GameObject | null = null;
      let leastDy = Number.POSITIVE_INFINITY;
      for (const key of this.graph.keys()) {
        const topDy = key.TopTile != null ? key.TopTile.Dy : Number.POSITIVE_INFINITY;
        if (topDy < leastDy) {
          leastDy = topDy;
          leastDyKey = key;
        }
      }
      if (leastDyKey != null) this.MarkDependencies(leastDyKey);
    }

    return this.histOrdered;
  }

  private ProcessTile(tile: MapTile | null): void {
    if (tile == null) return;
    // "lock" this tile at least until we've examined its neighbourhood
    this.AddDependency(tile, null);
    this.ExamineNeighbourhood(tile);
    for (const obj of tile.AllObjects) {
      // every object depends on its bottom-most host tile at least
      this.AddDependency(obj, null);
      this.ExamineNeighbourhood(obj);
    }

    const g = this.graph.get(tile);
    if (g != null) g.delete(tile);
    const g2 = this.graph.get(tile);
    if (g2 != null && g2.size === 0) this.MarkDependencies(tile);
  }

  ExamineNeighbourhood(obj: GameObject): void {
    const objBB = obj.GetBounds();
    const tileTL = this.map.GetTileScreen(objBB.Location, true, false);
    const tileBR = this.map.GetTileScreen(
      new Point(objBB.Location.X + objBB.Size.Width, objBB.Location.Y + objBB.Size.Height),
    );

    if (tileTL == null || tileBR == null) return;
    const objTopDy = obj.TopTile != null ? obj.TopTile.Dy : 0;

    for (let y = tileTL.Dy - 3; y <= tileBR.Dy + 3; y++) {
      for (let x = tileTL.Dx - 3; x <= tileBR.Dx + 3; x += 2) {
        if (x + (y + objTopDy) < 0 || y < 0) continue;
        const tile2 = this.map.get(x + ((y + objTopDy) % 2), Math.trunc(y / 2));
        if (tile2 == null) continue;

        this.ExamineObjects(obj, tile2);
        for (const obj2 of tile2.AllObjects) this.ExamineObjects(obj, obj2);
      }
    }
  }

  private ExamineObjects(obj: GameObject, obj2: GameObject): void {
    if (obj === obj2) return;

    const front = this.GetFrontBlock(obj, obj2);
    if (front === obj && !this.hist.has(obj2)) this.AddDependency(obj, obj2);
    else if (front === obj2) this.AddDependency(obj2, obj);
  }

  private AddDependency(obj: GameObject, dependency: GameObject | null): void {
    let list = this.graph.get(obj);
    if (list == null) {
      list = new Set<GameObject>();
      this.graph.set(obj, list);
      if (obj.BottomTile != null) list.add(obj.BottomTile);
      if (obj.TopTile != null) list.add(obj.TopTile);
    }

    if (dependency != null) {
      list.add(dependency);
    }
  }

  private MarkDependencies(nowSatisfied: GameObject): void {
    const satisfiedQueue: GameObject[] = [nowSatisfied];
    while (satisfiedQueue.length > 0) {
      const mark = satisfiedQueue[satisfiedQueue.length - 1];
      satisfiedQueue.pop();

      // move the tile we're marking from the graph to the history
      this.graph.delete(mark);
      this.hist.add(mark);
      this.histOrdered.push(mark);

      // prune newly satisfied
      const prune: GameObject[] = [];
      for (const [obj, deps] of this.graph) {
        if (deps.delete(mark) && deps.size === 0) prune.push(obj);
      }
      for (const obj of prune) {
        this.graph.delete(obj);
        satisfiedQueue.push(obj);
      }
    }
  }

  private GetFrontBlock(objA: GameObject, objB: GameObject): GameObject | null {
    // tiles never overlap
    if (objA instanceof MapTile && objB instanceof MapTile) return null;

    const boxA = objA.GetBounds();
    const boxB = objB.GetBounds();
    if (!boxA.IntersectsWith(boxB)) return null;

    const hexA = this.GetIsoBoundingBox(objA);
    const hexB = this.GetIsoBoundingBox(objB);

    const sepAxis = Hexagon.GetSeparationAxis(hexA, hexB);

    const aIsTile = objA instanceof MapTile;
    const bIsTile = objB instanceof MapTile;
    // tiles can only be in front based on z-axis separation
    if ((aIsTile !== bIsTile) && sepAxis !== Axis.Z) return aIsTile ? objB : objA;

    // flat stuff always loses
    const aFlat = objA.Drawable != null && objA.Drawable.Flat;
    const bFlat = objB.Drawable != null && objB.Drawable.Flat;
    if (aFlat !== bFlat) {
      if (sepAxis !== Axis.Z) return aFlat ? objB : objA;
    }

    switch (sepAxis) {
      case Axis.X:
        if (hexA.xMin > hexB.xMax) return objA;
        else if (hexB.xMin > hexA.xMax) return objB;
        break;
      case Axis.Y:
        if (hexA.yMin > hexB.yMax) return objA;
        else if (hexB.yMin > hexA.yMax) return objB;
        break;
      case Axis.Z:
        if (hexA.zMin > hexB.zMax) return objA;
        else if (hexB.zMin > hexA.zMax) return objB;
        break;
    }

    // units on bridges can only be drawn after the bridge
    if (objA instanceof OverlayObject && SpecialOverlays.IsHighBridge(objA) && objB instanceof GameObject && isOwnable(objB) && objB.OnBridge)
      return objB;
    else if (objB instanceof OverlayObject && SpecialOverlays.IsHighBridge(objB) && objA instanceof GameObject && isOwnable(objA) && objA.OnBridge)
      return objA;

    // no proper separation is possible, if one of both
    // objects is flat then mark the other one as in front,
    // otherwise use the one with lowest y
    if (aFlat && !bFlat) return objB;
    else if (bFlat && !aFlat) return objA;

    const prioA = priorityOf(objA);
    const prioB = priorityOf(objB);
    if (prioA > prioB) return objA;
    else if (prioA < prioB) return objB;

    // finally try the minimal y coordinate
    if (boxA.Bottom > boxB.Bottom) return objA;
    else if (boxA.Bottom < boxB.Bottom) return objB;

    return objA.Id <= objB.Id ? objA : objB;
  }

  GetIsoBoundingBox(obj: GameObject): Hexagon {
    if (obj instanceof MapTile) {
      return {
        xMin: obj.Rx,
        xMax: obj.Rx,
        yMin: obj.Ry,
        yMax: obj.Ry,
        zMin: obj.Z,
        zMax: obj.Z,
      } as Hexagon;
    } else if (isOwnable(obj)) {
      const oObj = obj as OwnableObject;
      return {
        xMin: obj.TopTile != null ? obj.TopTile.Rx : 0,
        xMax: obj.BottomTile != null ? obj.BottomTile.Rx : 0,
        yMin: obj.TopTile != null ? obj.TopTile.Ry : 0,
        yMax: obj.BottomTile != null ? obj.BottomTile.Ry : 0,
        zMin: (obj.Tile != null ? obj.Tile.Z : 0) + (oObj.OnBridge ? 4 : 0),
        zMax: (obj.Tile != null ? obj.Tile.Z : 0) + (oObj.OnBridge ? 4 : 0),
      } as Hexagon;
    } else {
      const tileElev = obj.Drawable != null ? obj.Drawable.TileElevation : 0;
      return {
        xMin: obj.TopTile != null ? obj.TopTile.Rx : 0,
        xMax: obj.BottomTile != null ? obj.BottomTile.Rx : 0,
        yMin: obj.TopTile != null ? obj.TopTile.Ry : 0,
        yMax: obj.BottomTile != null ? obj.BottomTile.Ry : 0,
        zMin: (obj.Tile != null ? obj.Tile.Z : 0) + tileElev,
        zMax: (obj.Tile != null ? obj.Tile.Z : 0) + tileElev,
      } as Hexagon;
    }
  }
}

function isOwnable(o: GameObject): o is GameObject & OwnableObject {
  return (
    o instanceof AircraftObject ||
    o instanceof InfantryObject ||
    o instanceof UnitObject ||
    o instanceof StructureObject
  );
}

function priorityOf(o: GameObject): number {
  if (o instanceof MapTile) return 0;
  else if (o instanceof SmudgeObject) return 1;
  else if (o instanceof OverlayObject) return 2;
  else if (o instanceof TerrainObject) return 3;
  else if (o instanceof StructureObject) return 3;
  else if (o instanceof AnimationObject) return 3;
  else if (o instanceof UnitObject) return 3;
  else if (o instanceof InfantryObject) return 3;
  else if (o instanceof AircraftObject) return 4;
  return 3;
}
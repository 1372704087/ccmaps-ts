// Structural engine types referenced by the rendering layer.
//
// The full engine-layer classes (MapTile, TileLayer, GameObject, Drawable,
// ModConfig, ...) are ported separately; TypeScript's structural typing lets the
// renderers depend on these interfaces without a circular import.

import { Palette } from '../rendering/Palette.js';
import { Point } from '../shared/Geometry.js';
import { EngineType } from '../shared/Enums.js';
import { VirtualFile } from '../formats/vfs/VirtualFile.js';
import { TmpImage } from '../formats/TmpFile.js';
import { DrawProperties } from './game/DrawProperties.js';

export enum TouchType {
  Untouched = 0,
  ByNormalData = 1,
  ByExtraData = 2,
}

export interface SizeLike {
  Width: number;
  Height: number;
}

export interface MapTileLike {
  Dx: number;
  Dy: number;
  Z: number;
  Rx: number;
  Ry: number;
  SubTile: number;
  Palette: Palette;
  Layer: TileLayerLike;
  Drawable: DrawableLike | null;
}

export interface TileLayerLike {
  GetTileScreen(p: Point, fixOOB?: boolean, omitHeight?: boolean): MapTileLike | null;
  GridTouched: number[][];
  GridTouchedBy: MapTileLike[][];
}

export interface DrawableLike {
  Props: DrawProperties;
  Foundation: SizeLike;
  IsActualWall: boolean;
  TileElevation: number;
  Flat: boolean;
  IsBuildingPart: boolean;
}

export interface TileDrawableLike extends DrawableLike {
  GetTileImage(tile: MapTileLike): TmpImage | null;
}

export interface GameObjectLike {
  Tile: MapTileLike;
  BottomTile: MapTileLike;
  TopTile: MapTileLike;
  Drawable: DrawableLike | null;
  Palette: Palette;
}

export interface StructureObjectLike extends GameObjectLike {
  WallBuildingFrame: number;
}

export interface OverlayObjectLike extends GameObjectLike {
  OverlayValue: number;
}

export interface OwnableObjectLike {
  Direction: number;
}

export interface ModConfigLike {
  TileWidth: number;
  TileHeight: number;
  Engine: EngineType;
}

export interface VirtualFileSystemLike {
  open(filename: string, format?: number, m?: number): VirtualFile | null;
}

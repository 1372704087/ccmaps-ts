// Batch C #13: infantry sub-cell positioning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OffsetHacks } from './DrawProperties.js';
import type { GameObjectLike, ModConfigLike } from '../Types.js';
import { EngineType } from '../../shared/Enums.js';

const ra2: ModConfigLike = { TileWidth: 60, TileHeight: 30, Engine: EngineType.RedAlert2 };
const ts: ModConfigLike = { TileWidth: 60, TileHeight: 30, Engine: EngineType.TiberianSun };

function at(subCell: number): GameObjectLike {
  return { SubCell: subCell } as unknown as GameObjectLike;
}

function assertPoint(p: { X: number; Y: number }, x: number, y: number): void {
  assert.equal(p.X, x);
  assert.equal(p.Y, y);
}

test('InfantrySubCell: gamemd draws sub-cells 0 and 1 at the cell centre', () => {
  const hack = OffsetHacks.InfantrySubCell(ra2);
  assertPoint(hack(at(0)), 0, 0);
  assertPoint(hack(at(1)), 0, 0);
});

test('InfantrySubCell: sub-cells 2, 3 and 4 land a quarter cell off centre', () => {
  const hack = OffsetHacks.InfantrySubCell(ra2);
  assertPoint(hack(at(2)), 15, 0); // up-right
  assertPoint(hack(at(3)), -15, 0); // down-left
  assertPoint(hack(at(4)), 0, 7); // down
});

test('InfantrySubCell: Tiberian Sun keeps the five-spot table with 1 up-left', () => {
  const hack = OffsetHacks.InfantrySubCell(ts);
  assertPoint(hack(at(1)), 0, -7);
});
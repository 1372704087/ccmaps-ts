import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rectangle } from '../shared/Geometry.js';
import { bgrToRgba } from './bgr.js';

test('converts BGR pixels to RGBA', () => {
  const surface = { data: new Uint8Array([1, 2, 3, 4, 5, 6]), Width: 2, BytesPerPixel: 3 };
  const rgba = bgrToRgba(surface, new Rectangle(0, 0, 2, 1));
  assert.deepEqual(Array.from(rgba), [3, 2, 1, 255, 6, 5, 4, 255]);
});

test('keeps alpha for BGRA surfaces', () => {
  const surface = { data: new Uint8Array([1, 2, 3, 4]), Width: 1, BytesPerPixel: 4 };
  const rgba = bgrToRgba(surface, new Rectangle(0, 0, 1, 1));
  assert.deepEqual(Array.from(rgba), [3, 2, 1, 4]);
});

test('honours the source rectangle', () => {
  const surface = { data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), Width: 3, BytesPerPixel: 3 };
  const rgba = bgrToRgba(surface, new Rectangle(1, 0, 1, 1));
  assert.deepEqual(Array.from(rgba), [6, 5, 4, 255]);
});

test('converts only the requested rows for banded encoding', () => {
  const data = new Uint8Array(2 * 3 * 3);
  for (let i = 0; i < 18; i++) data[i] = i;
  const surface = { data, Width: 2, BytesPerPixel: 3 };
  const rgba = bgrToRgba(surface, new Rectangle(0, 0, 2, 3), 1, 2);
  assert.equal(rgba.length, 2 * 2 * 4);
  assert.deepEqual(Array.from(rgba.slice(0, 8)), [8, 7, 6, 255, 11, 10, 9, 255]);
});

test('an empty or out-of-range row band produces no pixels', () => {
  const surface = { data: new Uint8Array(3), Width: 1, BytesPerPixel: 3 };
  assert.equal(bgrToRgba(surface, new Rectangle(0, 0, 1, 1), 1, 1).length, 0);
  assert.equal(bgrToRgba(surface, new Rectangle(0, 0, 0, 0)).length, 0);
});

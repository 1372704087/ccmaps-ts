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

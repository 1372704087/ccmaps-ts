// Batch B #2: engine lighting normalization + 63-step intensity quantization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Palette } from './Palette.js';
import { Lighting } from '../formats/map/Lighting.js';
import { HsvColor } from '../engine/utility/HsvColor.js';

// The raw-colors constructor mirrors the .NET one: it sets _origColors but leaves the
// "original colors loaded" flag down, so Recalculate would bail. The engine only ever calls
// Recalculate on palettes that loaded from a PalFile, so a test has to flip the flag itself.
function makeLoadedPalette(r: number, g: number, b: number): Palette {
  const bytes = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    bytes[i * 3 + 0] = r;
    bytes[i * 3 + 1] = g;
    bytes[i * 3 + 2] = b;
  }
  const p = new Palette(null, 'test', false, bytes);
  (p as unknown as { originalColorsLoaded: boolean }).originalColorsLoaded = true;
  return p;
}

function lighting(Ambient: number, Red: number, Green: number, Blue: number): Lighting {
  return { Ambient, Red, Green, Blue, Ground: 0, Level: 0 } as unknown as Lighting;
}

test('Palette: tints clamp to [0,2] and normalize so the max channel carries the intensity', () => {
  const prev = Palette.QuantizeIntensity;
  Palette.QuantizeIntensity = false;
  try {
    // ambient 3 and red 3 both clamp to 2; the triple (2,1,1) normalizes to (1,0.5,0.5),
    // the max 2 goes into the intensity and clamps back to 2, so the result is (2,1,1)
    const p = makeLoadedPalette(42, 42, 42);
    p.applyLighting(lighting(3, 3, 1, 1), 0, true);
    p.recalculate();
    assert.deepEqual([p.Colors[0].R, p.Colors[0].G, p.Colors[0].B], [255, 170, 170]);
  } finally {
    Palette.QuantizeIntensity = prev;
  }
});

test('Palette: a zero-max tint triple goes fully black', () => {
  const prev = Palette.QuantizeIntensity;
  Palette.QuantizeIntensity = false;
  try {
    const p = makeLoadedPalette(42, 42, 42);
    p.applyLighting(lighting(1, 0, 0, 0), 0, true);
    p.recalculate();
    assert.deepEqual([p.Colors[0].R, p.Colors[0].G, p.Colors[0].B], [0, 0, 0]);
  } finally {
    Palette.QuantizeIntensity = prev;
  }
});

test('Palette: quantization snaps intensity to a multiple of 1/31', () => {
  const prev = Palette.QuantizeIntensity;
  try {
    const continuous = makeLoadedPalette(63, 63, 63);
    Palette.QuantizeIntensity = false;
    continuous.applyLighting(lighting(0.5, 1, 1, 1), 0, true);
    continuous.recalculate();
    assert.equal(continuous.Colors[0].R, 127.5); // 63 * 0.5 / 63 * 255

    const quantized = makeLoadedPalette(63, 63, 63);
    Palette.QuantizeIntensity = true;
    quantized.applyLighting(lighting(0.5, 1, 1, 1), 0, true);
    quantized.recalculate();
    // intensity 0.5 -> level 15 -> 15/31, so 63 * (15/31) / 63 * 255
    assert.equal(quantized.Colors[0].R, (15 / 31) * 255);
    assert.notEqual(quantized.Colors[0].R, continuous.Colors[0].R);
  } finally {
    Palette.QuantizeIntensity = prev;
  }
});

test('Palette: remap ramps saturation up and value down, shade 15 is black', () => {
  const p = makeLoadedPalette(0, 0, 0);
  p.remap(new HsvColor(0, 255, 255)); // pure red
  const orig = (p as unknown as { origColors: Uint8Array }).origColors;
  // shade 15 sits at both sweeps' end (pi/2): sin 1, cos 0, so it is black
  assert.deepEqual([orig[31 * 3], orig[31 * 3 + 1], orig[31 * 3 + 2]], [0, 0, 0]);
  // shade 0 keeps most of the value and drops saturation to sin(0.8726) * 255
  assert.deepEqual([orig[16 * 3], orig[16 * 3 + 1], orig[16 * 3 + 2]], [61, 14, 14]);
});

test('Palette: addLight raises the ambient intensity (ExtraUnitLight)', () => {
  const prev = Palette.QuantizeIntensity;
  Palette.QuantizeIntensity = false;
  try {
    const p = makeLoadedPalette(42, 42, 42);
    p.applyLighting(lighting(1, 1, 1, 1), 0, true);
    p.addLight(0.2); // rulesmd.ini ExtraUnitLight/InfantryLight/AircraftLight
    p.recalculate();
    assert.ok(Math.abs(p.Colors[0].R - 204) < 1e-6, `expected ~204, got ${p.Colors[0].R}`);
  } finally {
    Palette.QuantizeIntensity = prev;
  }
});

test('Palette: quantization is the identity at intensity 1 and 2', () => {
  const prev = Palette.QuantizeIntensity;
  Palette.QuantizeIntensity = true;
  try {
    const one = makeLoadedPalette(63, 63, 63);
    one.applyLighting(lighting(1, 1, 1, 1), 0, true);
    one.recalculate();
    assert.equal(one.Colors[0].R, 255);

    const two = makeLoadedPalette(32, 32, 32);
    // tints (2,1,1): max 2 carries an intensity of min(2*2,2) = 2, the others normalize to 1
    two.applyLighting(lighting(2, 2, 1, 1), 0, true);
    two.recalculate();
    assert.equal(two.Colors[0].R, 255); // 32 * 2 / 63 * 255 clamps at 255
    assert.equal(two.Colors[0].G, (32 / 63) * 255);
  } finally {
    Palette.QuantizeIntensity = prev;
  }
});
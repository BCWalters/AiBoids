import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRealisticBirdGeometries, type SmallBirdPalette } from './smallBirdGeometry';

/**
 * Regression tests for the tail-cap color fix (issue #175).
 *
 * The body geometry returned by createRealisticBirdGeometries merges the
 * lathe body, tail cap disc, and eye dots into a single BufferGeometry with a
 * baked 'color' attribute. The tail cap disc lives at the minimum-Y of the
 * merged geometry (the actual tail tip), so we can isolate those vertices and
 * check that their baked color matches the species palette rather than the
 * neutral white that caused the "grey disc on a red cardinal" visual bug.
 */

const LENGTH = 1.0;
const WIDTH = 0.5;

/** Inspect the merged body geometry's color attribute at the tail-tip Y plane. */
function tailCapColors(palette: SmallBirdPalette): THREE.Color[] {
  const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), palette);
  const body = geoms.body;
  body.computeBoundingBox();
  const minY = body.boundingBox!.min.y;

  const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;
  const results: THREE.Color[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    // Tail cap vertices sit exactly at the minimum Y of the merged geometry.
    if (Math.abs(posAttr.getY(i) - minY) < 1e-5) {
      results.push(new THREE.Color(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i)));
    }
  }
  return results;
}

const CARDINAL_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xcc2936),
  tailBack:  new THREE.Color(0xe06070),
  headBelly: new THREE.Color(0xd03545),
  tailBelly: new THREE.Color(0xf09098),
  wing:      new THREE.Color(0x8f1f28),
  wingTip:   new THREE.Color(0x3d0f14),
  tail:      new THREE.Color(0x8f1f28),
  tailTip:   new THREE.Color(0x3d0f14),
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   true,
};

const GOLDFINCH_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xf5d327),
  tailBack:  new THREE.Color(0x1c1c1c),
  headBelly: new THREE.Color(0xf5d327),
  tailBelly: new THREE.Color(0xf8ec80),
  wing:      new THREE.Color(0xf5d327),
  wingTip:   new THREE.Color(0x151505),
  tail:      new THREE.Color(0x3a3a3a),
  tailTip:   new THREE.Color(0x0d0d0d),
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   true,
};

describe('small-bird tail cap vertex color', () => {
  it('is not white when a dorsal-gradient palette is provided', () => {
    const colors = tailCapColors(CARDINAL_PALETTE);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) {
      // Must not be white (r,g,b all ≥ 0.99)
      expect(c.r < 0.99 || c.g < 0.99 || c.b < 0.99).toBe(true);
    }
  });

  it('bakes a plumage-range color for a cardinal (not neutral grey)', () => {
    // The tail-tip region of the merged body geometry contains body-lathe
    // vertices (with the bilinear Z-gradient) and the disc-cap vertices
    // (flat midpoint of tailBelly/tailBack).  Both should sit within the
    // palette's tail color bounds — none should be the old neutral white.
    const colors = tailCapColors(CARDINAL_PALETTE);
    expect(colors.length).toBeGreaterThan(0);
    const minR = Math.min(CARDINAL_PALETTE.tailBelly.r, CARDINAL_PALETTE.tailBack.r);
    const maxR = Math.max(CARDINAL_PALETTE.tailBelly.r, CARDINAL_PALETTE.tailBack.r);
    const minG = Math.min(CARDINAL_PALETTE.tailBelly.g, CARDINAL_PALETTE.tailBack.g);
    const maxG = Math.max(CARDINAL_PALETTE.tailBelly.g, CARDINAL_PALETTE.tailBack.g);
    const minB = Math.min(CARDINAL_PALETTE.tailBelly.b, CARDINAL_PALETTE.tailBack.b);
    const maxB = Math.max(CARDINAL_PALETTE.tailBelly.b, CARDINAL_PALETTE.tailBack.b);
    const eps = 0.05; // small float tolerance for smoothstep/lerp rounding
    for (const c of colors) {
      expect(c.r).toBeGreaterThanOrEqual(minR - eps);
      expect(c.r).toBeLessThanOrEqual(maxR + eps);
      expect(c.g).toBeGreaterThanOrEqual(minG - eps);
      expect(c.g).toBeLessThanOrEqual(maxG + eps);
      expect(c.b).toBeGreaterThanOrEqual(minB - eps);
      expect(c.b).toBeLessThanOrEqual(maxB + eps);
    }
  });

  it('bakes a plumage-range color for a goldfinch (tail-end is NOT white)', () => {
    // Goldfinch has high contrast between tailBack (near-black 0x1c1c1c) and
    // tailBelly (yellow 0xf8ec80) — the old WHITE_VERTEX_COLOR would produce
    // r,g,b all ≥ 0.98, which sits way outside the palette range.
    const colors = tailCapColors(GOLDFINCH_PALETTE);
    expect(colors.length).toBeGreaterThan(0);
    const minR = Math.min(GOLDFINCH_PALETTE.tailBelly.r, GOLDFINCH_PALETTE.tailBack.r);
    const maxR = Math.max(GOLDFINCH_PALETTE.tailBelly.r, GOLDFINCH_PALETTE.tailBack.r);
    const minG = Math.min(GOLDFINCH_PALETTE.tailBelly.g, GOLDFINCH_PALETTE.tailBack.g);
    const maxG = Math.max(GOLDFINCH_PALETTE.tailBelly.g, GOLDFINCH_PALETTE.tailBack.g);
    const minB = Math.min(GOLDFINCH_PALETTE.tailBelly.b, GOLDFINCH_PALETTE.tailBack.b);
    const maxB = Math.max(GOLDFINCH_PALETTE.tailBelly.b, GOLDFINCH_PALETTE.tailBack.b);
    const eps = 0.05;
    for (const c of colors) {
      expect(c.r).toBeGreaterThanOrEqual(minR - eps);
      expect(c.r).toBeLessThanOrEqual(maxR + eps);
      expect(c.g).toBeGreaterThanOrEqual(minG - eps);
      expect(c.g).toBeLessThanOrEqual(maxG + eps);
      expect(c.b).toBeGreaterThanOrEqual(minB - eps);
      expect(c.b).toBeLessThanOrEqual(maxB + eps);
    }
  });

  it('uses white when no palette is provided', () => {
    const geoms = createRealisticBirdGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;

    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = body.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getY(i) - minY) < 1e-5) {
        // All tail-cap vertices should be white (no palette → white fallback)
        expect(colorAttr.getX(i)).toBeCloseTo(1, 3);
        expect(colorAttr.getY(i)).toBeCloseTo(1, 3);
        expect(colorAttr.getZ(i)).toBeCloseTo(1, 3);
      }
    }
  });
});

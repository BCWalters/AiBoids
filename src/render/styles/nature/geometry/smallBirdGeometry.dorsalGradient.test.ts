import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRealisticBirdGeometries, type SmallBirdPalette } from './smallBirdGeometry';

/**
 * Regression tests for issue #227: the small-bird body dorsal/ventral blend
 * factor (tZ) was derived from the global bounding-box Z span, which collapses
 * toward 0.5 at the nose and tail tips where the lathe radius shrinks to near-
 * zero. There every vertex has position.z ≈ 0 (the midpoint), so tZ ≈ 0.5
 * regardless of whether the vertex is on the back or the belly — making the
 * rump colour average tailBelly and tailBack instead of showing tailBack.
 *
 * The fix uses vertex normal.z instead of position.z / zSpan.  For a
 * LatheGeometry the normal points radially outward from the Y axis, so
 * normal.z = +1 on the back surface and -1 on the belly, independent of the
 * local radius.
 *
 * Two behavioural assertions are verified:
 *  1. The topmost (most dorsal) vertices in the rearmost Y band are coloured
 *     close to `tailBack`, not the belly/back midpoint.
 *  2. Dorsal luminance is monotonically non-increasing from head to tail — the
 *     pre-fix code reversed this in the tail bands.
 *
 * Both assertions are also run against the broken algorithm to confirm they
 * catch the original defect (falsification).
 *
 * NOTE: vertex colours are stored in the linear colour space that Three.js
 * uses internally; all comparisons here are linear-to-linear, which is correct
 * and avoids any sRGB round-trip error.
 */

const LENGTH = 1.0;
const WIDTH  = 0.5;

/**
 * Goldfinch palette: maximum head↔tail contrast (bright yellow crown →
 * near-black rump) makes the reversal defect most visible.
 */
const GOLDFINCH_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xf5d327), // bright yellow — high luma
  tailBack:  new THREE.Color(0x1c1c1c), // near-black   — very low luma
  headBelly: new THREE.Color(0xf5d327), // same yellow as headBack
  tailBelly: new THREE.Color(0xf8ec80), // pale yellow
  wing:      new THREE.Color(0xf5d327),
  wingTip:   new THREE.Color(0x151505),
  tail:      new THREE.Color(0x3a3a3a),
  tailTip:   new THREE.Color(0x000000),
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   false,
};

/** Rec. 709 relative luminance from a linear-space Three.js Color. */
function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Splits the body geometry's Y range into `numBands` equal bands (band 0 =
 * head end, band numBands-1 = tail end) and returns the average linear colour
 * of the "topmost" vertices in each band.
 *
 * "Topmost" = those whose Z is at least half the per-band maximum Z.
 * This selects the dorsal surface correctly even where the body tapers to a
 * small radius, without relying on a fixed global Z threshold.
 */
function dorsalColorsPerBand(body: THREE.BufferGeometry, numBands: number): THREE.Color[] {
  body.computeBoundingBox();
  const minY = body.boundingBox!.min.y;
  const maxY = body.boundingBox!.max.y;
  const ySpan = maxY - minY;
  const bandH = ySpan / numBands;

  const pos   = body.getAttribute('position') as THREE.BufferAttribute;
  const color = body.getAttribute('color')    as THREE.BufferAttribute;

  return Array.from({ length: numBands }, (_, band) => {
    // Band 0 starts at maxY (head), band numBands-1 ends at minY (tail).
    const hi = maxY - band * bandH;
    const lo = hi - bandH;

    // Pass 1: find the maximum Z in this band.
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= lo && y < hi) {
        const z = pos.getZ(i);
        if (z > maxZ) maxZ = z;
      }
    }
    if (maxZ <= 0) return new THREE.Color(0, 0, 0);

    // Pass 2: average colour of vertices with Z ≥ 0.5 × maxZ (the dorsal half).
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= lo && y < hi && pos.getZ(i) >= 0.5 * maxZ) {
        r += color.getX(i);
        g += color.getY(i);
        b += color.getZ(i);
        n++;
      }
    }
    return n > 0 ? new THREE.Color(r / n, g / n, b / n) : new THREE.Color(0, 0, 0);
  });
}

/**
 * Overwrites the body geometry's 'color' attribute using the BROKEN pre-fix
 * algorithm: tZ is derived from global bounding-box zSpan rather than from
 * vertex normals. Used to falsify the assertions below and confirm the fix
 * is load-bearing.
 */
function retintWithBrokenZSpan(body: THREE.BufferGeometry, p: SmallBirdPalette): void {
  body.computeBoundingBox();
  const { min, max } = body.boundingBox!;
  const ySpan = Math.max(1e-5, max.y - min.y);
  const zSpan = Math.max(1e-5, max.z - min.z);
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  const buf = new Float32Array(pos.count * 3);
  for (let vi = 0; vi < pos.count; vi++) {
    const tY = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp((max.y - pos.getY(vi)) / ySpan, 0, 1), 0.05, 0.95);
    const tZ = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp((pos.getZ(vi) - min.z) / zSpan, 0, 1), 0.15, 0.85);
    buf[vi * 3]     = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(p.headBelly.r, p.headBack.r, tZ),
      THREE.MathUtils.lerp(p.tailBelly.r, p.tailBack.r, tZ), tY);
    buf[vi * 3 + 1] = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(p.headBelly.g, p.headBack.g, tZ),
      THREE.MathUtils.lerp(p.tailBelly.g, p.tailBack.g, tZ), tY);
    buf[vi * 3 + 2] = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(p.headBelly.b, p.headBack.b, tZ),
      THREE.MathUtils.lerp(p.tailBelly.b, p.tailBack.b, tZ), tY);
  }
  body.setAttribute('color', new THREE.BufferAttribute(buf, 3));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-algorithm assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('small-bird body dorsal gradient fix (issue #227)', () => {

  it('rump dorsal vertices are coloured close to tailBack, not the belly/back midpoint', () => {
    const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), GOLDFINCH_PALETTE);
    // 10 bands: band 9 is the rearmost (rump).
    const bands = dorsalColorsPerBand(geoms.body, 10);
    const rump  = bands[9];

    // tailBack = #1c1c1c (near-black). Allow ±0.05 tolerance so small
    // lerp blend from the adjacent head colour (tY < 1) is accepted.
    expect(rump.r).toBeCloseTo(GOLDFINCH_PALETTE.tailBack.r, 1);
    expect(rump.g).toBeCloseTo(GOLDFINCH_PALETTE.tailBack.g, 1);
    expect(rump.b).toBeCloseTo(GOLDFINCH_PALETTE.tailBack.b, 1);
  });

  it('dorsal luminance is monotonically non-increasing from head to tail', () => {
    const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), GOLDFINCH_PALETTE);
    const bands = dorsalColorsPerBand(geoms.body, 10);
    const lumaValues = bands.map(luma);

    for (let i = 0; i + 1 < lumaValues.length; i++) {
      // Allow a small tolerance for floating-point and smoothstep rounding.
      const notDecreasing = lumaValues[i] >= lumaValues[i + 1] - 0.05;
      expect(notDecreasing).toBe(true);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Falsification: the broken algorithm must fail both assertions above.
  // ───────────────────────────────────────────────────────────────────────────

  describe('falsification: broken global-zSpan algorithm fails both assertions', () => {

    it('broken algorithm yields a washed-out rump clearly brighter than tailBack', () => {
      const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), GOLDFINCH_PALETTE);
      const body  = geoms.body;
      retintWithBrokenZSpan(body, GOLDFINCH_PALETTE);

      const bands    = dorsalColorsPerBand(body, 10);
      const rump     = bands[9];
      const tailBack = GOLDFINCH_PALETTE.tailBack;

      // The broken rump mixes tailBelly into tailBack (tZ < 1), giving a
      // noticeably brighter colour. Luminance must be significantly above
      // tailBack's luminance.
      expect(luma(rump)).toBeGreaterThan(luma(tailBack) + 0.1);
    });

    it('broken algorithm produces a brightness reversal in the tail bands', () => {
      const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), GOLDFINCH_PALETTE);
      const body  = geoms.body;
      retintWithBrokenZSpan(body, GOLDFINCH_PALETTE);

      const bands      = dorsalColorsPerBand(body, 10);
      const lumaValues = bands.map(luma);

      // The shrinking lathe radius near the tail causes tZ to drop below
      // its wider-body value in the adjacent band, so belly colour bleeds
      // in and the rump becomes brighter than the band just in front of it.
      let hasReversal = false;
      for (let i = 0; i + 1 < lumaValues.length; i++) {
        if (lumaValues[i + 1] > lumaValues[i] + 0.05) {
          hasReversal = true;
          break;
        }
      }
      expect(hasReversal).toBe(true);
    });

  });

});

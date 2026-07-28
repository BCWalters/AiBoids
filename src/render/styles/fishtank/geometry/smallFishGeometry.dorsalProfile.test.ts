import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPlainFishFinThicknessSamples } from './smallFishGeometry';
import { FISHTANK_CREATURE_SIZES } from '../../../sceneRenderers/FishtankSceneRenderer3D';

/**
 * Verifies that the small-fish dorsal fin has a natural tapered profile:
 * peak near the leading (forward) edge, long gentle slope toward the
 * trailing (rear) edge — not the former uniform-height "mohawk" trapezoid.
 *
 * Uses `createPlainFishFinThicknessSamples` to obtain the shipped dorsal
 * geometry at scene size (not a local constant copy), so this test will
 * catch the profile regressing back to the flat-top shape.
 *
 * Falsification:
 *   - Revert `buildDorsalFinGeometry` to the old flat trapezoid
 *     (`rearTop`/`frontTop` both at `baseZ + finHeight`) and the
 *     rear-taper assertion fails immediately:
 *       "dorsal fin rear should taper: Expected < 0.5, Received: 1.0"
 *   - Move the peak to the rear of the fin and the peak-position assertion
 *     fails:
 *       "dorsal fin peak should be forward of center: Expected > midY+0.25*extent"
 */
describe('small fish dorsal fin profile', () => {
  const LENGTH = FISHTANK_CREATURE_SIZES.plainFish.length;
  const WIDTH  = FISHTANK_CREATURE_SIZES.plainFish.width;

  it('peaks near the leading edge, not uniformly across the top (no mohawk)', () => {
    const samples = createPlainFishFinThicknessSamples(LENGTH, WIDTH);
    const dorsalSample = samples.find((s) => s.label === 'dorsal')!;
    expect(dorsalSample, 'dorsal fin sample must exist').toBeDefined();

    const geom = dorsalSample.geometry;
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const midY       = (bb.max.y + bb.min.y) * 0.5;
    const finExtentY = bb.max.y - bb.min.y;

    const pos = geom.getAttribute('position') as THREE.BufferAttribute;

    // Collect Y-positions of all peak-height vertices and the max Z reached
    // in the rear (Y < midY) half of the fin.
    // Fin height must be measured against the LOCAL base at each Y, not against
    // the geometry's global min Z. The fin's base follows the curve of the
    // fish's back (issue #258), so the base sits far higher over the shoulder
    // than at either end — measuring from a single global floor would report
    // the arch of the body as fin height and call a properly tapered fin a
    // mohawk.
    const bins = new Map<number, { lo: number; hi: number }>();
    const BIN = finExtentY / 60;
    for (let i = 0; i < pos.count; i++) {
      const key = Math.round(pos.getY(i) / BIN);
      const z = pos.getZ(i);
      const bin = bins.get(key);
      if (bin) {
        bin.lo = Math.min(bin.lo, z);
        bin.hi = Math.max(bin.hi, z);
      } else {
        bins.set(key, { lo: z, hi: z });
      }
    }
    let peakHeight = 0;
    for (const bin of bins.values()) peakHeight = Math.max(peakHeight, bin.hi - bin.lo);

    let peakYSum  = 0;
    let peakCount = 0;
    let rearMaxHeight = 0;
    const peakTol = peakHeight * 0.02;
    for (const [key, bin] of bins) {
      const y = key * BIN;
      const height = bin.hi - bin.lo;
      if (height >= peakHeight - peakTol) {
        peakYSum += y;
        peakCount++;
      }
      if (y < midY) rearMaxHeight = Math.max(rearMaxHeight, height);
    }
    expect(peakCount).toBeGreaterThan(0);
    const peakY = peakYSum / peakCount;

    // 1. The peak should be significantly forward of the fin's midpoint.
    //    Old flat trapezoid: top edge centroid ≈ midY → fails.
    //    New profile: peak ≈ midY + 0.38 * finExtentY → passes.
    expect(
      peakY,
      'dorsal fin peak should be in the forward portion of the fin (not a flat top)',
    ).toBeGreaterThan(midY + 0.25 * finExtentY);

    // 2. The rear half should taper to well below the peak height.
    //    Old flat trapezoid: rearTop at full finHeight → rearFraction = 1.0 → fails.
    //    New profile: rearTaper at 18 % finHeight → rearFraction ≈ 0.18 → passes.
    const rearFraction = rearMaxHeight / peakHeight;
    expect(
      rearFraction,
      'dorsal fin rear should taper to less than half its peak height',
    ).toBeLessThan(0.5);

    geom.dispose();
  });
});

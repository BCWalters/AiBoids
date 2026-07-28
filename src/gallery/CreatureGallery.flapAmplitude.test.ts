/**
 * Asserts that the gallery's wing-flap amplitude matches realistic in-flight
 * motion rather than showing the exaggerated full-speed stroke.
 *
 * Root cause of issue #246: poseGalleryCreatureIfReady set the creature's
 * velocity to ~97 % of maxSpeed, so computeSpeedFraction returned ≈ 0.97 and
 * computeFlapAmplitude produced nearly the maximum arc (≈ 1.12 rad / 64 °).
 * In real flight, birds cruise at roughly 55–65 % of maxSpeed, giving an arc
 * of ≈ 0.79 rad / 45 °.
 *
 * The fix exports GALLERY_SPEED_FRACTION (the exact speed fraction used when
 * posing) so this test can import BOTH shipped values — GALLERY_SPEED_FRACTION
 * and the simulation flap constants — and verify their relationship.  Using
 * imported values rather than restating magic numbers means this test will
 * catch drift if either constant changes.
 *
 * HOW TO FALSIFY (documented per issue #246):
 *   Temporarily set GALLERY_SPEED_FRACTION back to 0.973 (the old effective
 *   value when velocity was set to 0.9 × maxSpeed without normalising).
 *   Both assertions below will fail:
 *     - "gallery is well below max amplitude" fails because
 *       0.25 + 0.9 × 0.973 ≈ 1.125, max = 1.15, diff ≈ 0.025 < 0.25
 *     - "gallery speed fraction is in cruise range" fails because 0.973 > 0.75
 */

import { describe, it, expect } from 'vitest';
import { GALLERY_SPEED_FRACTION, computeGalleryVelocity } from './CreatureGalleryController';
import {
  FLAP_IDLE_AMPLITUDE,
  FLAP_SPEED_AMPLITUDE,
} from '../render/sceneRenderers/NatureSceneRenderer3D';
import { computeFlapAmplitude } from '../render/motion/flapMath';

describe('CreatureGallery flap amplitude', () => {
  const galleryAmplitude = computeFlapAmplitude({
    idleAmplitude: FLAP_IDLE_AMPLITUDE,
    speedAmplitude: FLAP_SPEED_AMPLITUDE,
    speedFraction: GALLERY_SPEED_FRACTION,
    stateAmplitudeMultiplier: 1,
  });

  const maxAmplitude = computeFlapAmplitude({
    idleAmplitude: FLAP_IDLE_AMPLITUDE,
    speedAmplitude: FLAP_SPEED_AMPLITUDE,
    speedFraction: 1,
    stateAmplitudeMultiplier: 1,
  });

  it('gallery speed fraction is in the realistic cruise range (not near-max)', () => {
    // Too low → the creature would barely be moving and animation would look
    // frozen; too high → the gallery shows an exaggerated full-power flap.
    expect(GALLERY_SPEED_FRACTION).toBeGreaterThanOrEqual(0.4);
    expect(GALLERY_SPEED_FRACTION).toBeLessThanOrEqual(0.75);
  });

  it('gallery is well below max amplitude (not showing the full-speed stroke)', () => {
    // Must be more than 0.25 rad less than max so the gallery does not read
    // as the exaggerated near-maximum arc that caused issue #246.
    // At the old effective speedFraction ≈ 0.973: diff ≈ 0.025 — fails.
    expect(maxAmplitude - galleryAmplitude).toBeGreaterThan(0.25);
  });

  it('gallery amplitude exceeds idle (creature has visible speed-driven flap)', () => {
    expect(galleryAmplitude).toBeGreaterThan(FLAP_IDLE_AMPLITUDE);
  });

  // The three assertions above all read GALLERY_SPEED_FRACTION directly, so
  // none of them can see issue #246's actual root cause: the posing code
  // multiplying an un-normalised direction vector by maxSpeed, which yields
  // |v| = 0.973 x maxSpeed no matter what the constant says. Verified by
  // sabotage -- reverting the assignment to `maxSpeed * 0.9` left all three
  // green. These two exercise the shipped computation instead.
  describe('posed velocity (the wiring, not just the constant)', () => {
    const maxSpeed = 37;
    const velocity = computeGalleryVelocity({ maxSpeed });
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);

    it('speed the renderer sees equals GALLERY_SPEED_FRACTION x maxSpeed', () => {
      // computeSpeedFraction is speed / maxSpeed, so this is exactly the
      // speedFraction fed to computeFlapAmplitude at render time.
      expect(speed / maxSpeed).toBeCloseTo(GALLERY_SPEED_FRACTION, 6);
    });

    it('holds the 3/4 cruising direction (mostly +X, slight climb, some Z)', () => {
      // Guards against "fixing" the magnitude by flattening the pose to a
      // dead-straight +X charge, which loses the 3/4 framing.
      expect(velocity.x / speed).toBeCloseTo(0.925, 2);
      expect(velocity.y / speed).toBeCloseTo(0.123, 2);
      expect(velocity.z / speed).toBeCloseTo(0.36, 2);
    });
  });
});

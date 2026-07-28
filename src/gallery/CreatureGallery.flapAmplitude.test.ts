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
import { GALLERY_SPEED_FRACTION } from './CreatureGalleryController';
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
});

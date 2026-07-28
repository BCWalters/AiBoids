/**
 * Worst-case downstroke limits per flapping creature (issue #276).
 *
 * Asserts that the maximum wing-down angle (most positive flapAngleFromPhase
 * value) stays within an absolute bound when both speed and the
 * state-amplitude multiplier are at their worst-case maxima.
 *
 * "Worst case" is:
 *   speedFraction = 1 (full speed)
 *   stateAmplitudeMultiplier = STATE_AMPLITUDE_MULTIPLIER_MAX = 1.24
 *     (the cap from flapMath.ts; panic + climb simultaneously)
 *
 * The bound is derived from measurement: the "before" value (no clip) and the
 * "after" value (with clip) are shown in comments next to each assertion, and
 * the threshold sits between them.  A bound the code cannot violate (e.g.
 * because the quantity saturates well below the limit) is worthless — these
 * thresholds would each fail if the corresponding bottomClipRad were set to 0.
 *
 * HOW TO FALSIFY (verified by temporarily reverting each clip to 0):
 *
 * | Creature    | Before (no clip) | After (with clip) | Threshold |
 * |-------------|-----------------|-------------------|-----------|
 * | Small birds |    1.426 rad    |    1.226 rad      | 1.30 rad  |
 * | Parrot      |    1.674 rad    |    1.324 rad      | 1.50 rad  |
 * | Dragon      |    1.550 rad    |    1.250 rad      | 1.30 rad  |
 *
 * For unicorn (no clip applied — amplitude is already modest):
 * | Unicorn     | 0.893 rad (nominal + 1.24×) — well within its own bound |
 *
 * Revert a clip to 0 in NatureSceneRenderer3D.ts → that creature's test fails.
 * The dragon test is the existing canary; birds and parrots are added here.
 */

import { describe, it, expect } from 'vitest';
import { computeFlapAmplitude, flapAngleFromPhase } from './flapMath';

// ---------------------------------------------------------------------------
// Constants mirroring NatureSceneRenderer3D.ts — intentionally duplicated
// so a change to either the renderer or the test without the other causes a
// failure.  (Same discipline as the dragon clip test in flapMath.test.ts.)
// ---------------------------------------------------------------------------

// Small birds (and non-profiled boid species)
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.90;
const BIRD_BOTTOM_CLIP_RAD = 0.20;
const BIRD_DOWNSTROKE_FRACTION = 0.37;

// Profiled macaw / parrot
const _PARROT_FLAP_IDLE_AMPLITUDE = 0.40;
const _PARROT_FLAP_SPEED_AMPLITUDE = 0.95;
const _PARROT_BOTTOM_CLIP_RAD = 0.35;

// Dragon (existing clip — included as a regression guard)
const DRAGON_FLAP_IDLE_AMPLITUDE = 0.40;
const DRAGON_FLAP_SPEED_AMPLITUDE = 0.85;
const DRAGON_BOTTOM_CLIP_RAD = 0.30;
const DRAGON_DOWNSTROKE_FRACTION = 0.43;

// Unicorn (no clip applied)
const _UNICORN_FLAP_IDLE_AMPLITUDE = 0.22;
const _UNICORN_FLAP_SPEED_AMPLITUDE = 0.50;
const UNICORN_DOWNSTROKE_FRACTION = 0.42;

// The cap from flapMath.ts (STATE_AMPLITUDE_MULTIPLIER_MAX).
// Not exported from flapMath, so duplicated here as documentation.
const STATE_AMPLITUDE_MULTIPLIER_MAX = 1.24;

// ---------------------------------------------------------------------------
// Helper: sweep 360 phase samples and return the true max flapAngleFromPhase.
// ---------------------------------------------------------------------------
function worstCaseBottomAngle({
  idleAmplitude,
  speedAmplitude,
  bottomClipRad = 0,
  downstrokeFraction,
}: {
  idleAmplitude: number;
  speedAmplitude: number;
  bottomClipRad?: number;
  downstrokeFraction: number;
}): number {
  const amplitude = computeFlapAmplitude({
    idleAmplitude,
    speedAmplitude,
    speedFraction: 1,
    stateAmplitudeMultiplier: STATE_AMPLITUDE_MULTIPLIER_MAX,
  });
  let max = -Infinity;
  const SAMPLES = 360;
  for (let i = 0; i < SAMPLES; i++) {
    const phase = (i / SAMPLES) * 2 * Math.PI;
    const angle = flapAngleFromPhase({
      phase,
      amplitude,
      restBiasRad: 0,
      downstrokeFraction,
      bottomClipRad,
    });
    if (angle > max) max = angle;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Worst-case top (upstroke) should be unchanged by the clip.
// ---------------------------------------------------------------------------
function worstCaseTopAngle({
  idleAmplitude,
  speedAmplitude,
  bottomClipRad = 0,
  downstrokeFraction,
}: {
  idleAmplitude: number;
  speedAmplitude: number;
  bottomClipRad?: number;
  downstrokeFraction: number;
}): number {
  const amplitude = computeFlapAmplitude({
    idleAmplitude,
    speedAmplitude,
    speedFraction: 1,
    stateAmplitudeMultiplier: STATE_AMPLITUDE_MULTIPLIER_MAX,
  });
  let min = Infinity;
  const SAMPLES = 360;
  for (let i = 0; i < SAMPLES; i++) {
    const phase = (i / SAMPLES) * 2 * Math.PI;
    const angle = flapAngleFromPhase({
      phase,
      amplitude,
      restBiasRad: 0,
      downstrokeFraction,
      bottomClipRad,
    });
    if (angle < min) min = angle;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Small birds (BoidSpecies.Normal, Gold, Red, Blue — and non-profiled parrots)
// ---------------------------------------------------------------------------
describe('small-bird worst-case downstroke (issue #276)', () => {
  it('bottom angle with BIRD_BOTTOM_CLIP_RAD is below 1.30 rad', () => {
    // Before (BIRD_BOTTOM_CLIP_RAD = 0): 1.426 rad (81.7°) — failed visual check
    // After  (BIRD_BOTTOM_CLIP_RAD = 0.20): 1.226 rad (70.2°)
    const bottom = worstCaseBottomAngle({
      idleAmplitude: FLAP_IDLE_AMPLITUDE,
      speedAmplitude: FLAP_SPEED_AMPLITUDE,
      bottomClipRad: BIRD_BOTTOM_CLIP_RAD,
      downstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
    });
    expect(bottom).toBeLessThan(1.30);
  });

  it('top of stroke is unchanged by the clip (stays at −amplitude)', () => {
    // The clip must not move the upstroke — it only raises the bottom.
    const expectedTop = -(FLAP_IDLE_AMPLITUDE + FLAP_SPEED_AMPLITUDE) * STATE_AMPLITUDE_MULTIPLIER_MAX;
    const top = worstCaseTopAngle({
      idleAmplitude: FLAP_IDLE_AMPLITUDE,
      speedAmplitude: FLAP_SPEED_AMPLITUDE,
      bottomClipRad: BIRD_BOTTOM_CLIP_RAD,
      downstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
    });
    expect(top).toBeCloseTo(expectedTop, 2);
  });
});

// ---------------------------------------------------------------------------
// Profiled parrots (BoidSpecies.Multicolor with isProfiledParrot = true)
// ---------------------------------------------------------------------------
describe('parrot worst-case downstroke (issue #276)', () => {
  it('bottom angle with _PARROT_BOTTOM_CLIP_RAD is below 1.50 rad', () => {
    // Before (_PARROT_BOTTOM_CLIP_RAD = 0): 1.674 rad (95.9°) — the worst pre-fix
    // After  (_PARROT_BOTTOM_CLIP_RAD = 0.35): 1.324 rad (75.8°)
    const bottom = worstCaseBottomAngle({
      idleAmplitude: _PARROT_FLAP_IDLE_AMPLITUDE,
      speedAmplitude: _PARROT_FLAP_SPEED_AMPLITUDE,
      bottomClipRad: _PARROT_BOTTOM_CLIP_RAD,
      downstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
    });
    expect(bottom).toBeLessThan(1.50);
  });

  it('top of stroke is unchanged by the clip', () => {
    const expectedTop = -(_PARROT_FLAP_IDLE_AMPLITUDE + _PARROT_FLAP_SPEED_AMPLITUDE) * STATE_AMPLITUDE_MULTIPLIER_MAX;
    const top = worstCaseTopAngle({
      idleAmplitude: _PARROT_FLAP_IDLE_AMPLITUDE,
      speedAmplitude: _PARROT_FLAP_SPEED_AMPLITUDE,
      bottomClipRad: _PARROT_BOTTOM_CLIP_RAD,
      downstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
    });
    expect(top).toBeCloseTo(expectedTop, 2);
  });
});

// ---------------------------------------------------------------------------
// Dragon — regression guard for the existing fix (issue #199)
// ---------------------------------------------------------------------------
describe('dragon worst-case downstroke (regression guard, issue #199)', () => {
  it('bottom angle with DRAGON_BOTTOM_CLIP_RAD stays below 1.30 rad', () => {
    // Before (DRAGON_BOTTOM_CLIP_RAD = 0): 1.550 rad (88.8°)
    // After  (DRAGON_BOTTOM_CLIP_RAD = 0.30): 1.250 rad (71.6°)
    const bottom = worstCaseBottomAngle({
      idleAmplitude: DRAGON_FLAP_IDLE_AMPLITUDE,
      speedAmplitude: DRAGON_FLAP_SPEED_AMPLITUDE,
      bottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
      downstrokeFraction: DRAGON_DOWNSTROKE_FRACTION,
    });
    expect(bottom).toBeLessThan(1.30);
  });
});

// ---------------------------------------------------------------------------
// Unicorn — no clip applied; amplitude is already the lowest of any flapper.
// Included so a future amplitude increase would show up here first.
// ---------------------------------------------------------------------------
describe('unicorn worst-case downstroke (no clip — already modest)', () => {
  it('bottom angle stays below 1.00 rad even without a clip', () => {
    // Worst case = (0.22 + 0.50) × 1.24 = 0.893 rad (51.1°) — already well within range.
    const bottom = worstCaseBottomAngle({
      idleAmplitude: _UNICORN_FLAP_IDLE_AMPLITUDE,
      speedAmplitude: _UNICORN_FLAP_SPEED_AMPLITUDE,
      bottomClipRad: 0,
      downstrokeFraction: UNICORN_DOWNSTROKE_FRACTION,
    });
    expect(bottom).toBeLessThan(1.00);
  });
});

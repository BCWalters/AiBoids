import { describe, it, expect } from 'vitest';
import {
  TAIL_SWAY_PHASE_OFFSET,
  advanceFlapPhase,
  computeClimbFraction,
  computeFlapAmplitude,
  computeFlapStateMultipliers,
  computeSpeedFraction,
  computeTailSwayPhase,
  flapAngleFromPhase,
  initialFlapPhase,
  legSwingAngleFromPhase,
  LEG_SWING_PHASE_OFFSET,
  SYMMETRIC_DOWNSTROKE_FRACTION,
  tailSwayAngleFromPhase,
  type FlapStateWeights,
} from './flapMath';

const NEUTRAL_WEIGHTS: FlapStateWeights = {
  blendStrength: 0,
  climbWeight: 0,
  diveWeight: 0,
  turnWeight: 0,
  panicWeight: 0,
  cruiseWeight: 0,
};

function weights(overrides: Partial<FlapStateWeights>): FlapStateWeights {
  return { ...NEUTRAL_WEIGHTS, blendStrength: 1, ...overrides };
}

describe('computeFlapStateMultipliers', () => {
  it('is a no-op when blendStrength is zero', () => {
    const result = computeFlapStateMultipliers({ ...NEUTRAL_WEIGHTS, climbWeight: 1, panicWeight: 1 });
    expect(result.frequencyMultiplier).toBe(1);
    expect(result.amplitudeMultiplier).toBe(1);
  });

  it('beats faster and wider when climbing', () => {
    const result = computeFlapStateMultipliers(weights({ climbWeight: 1 }));
    expect(result.frequencyMultiplier).toBeGreaterThan(1);
    expect(result.amplitudeMultiplier).toBeGreaterThan(1);
  });

  it('beats slower but still wider when diving', () => {
    const result = computeFlapStateMultipliers(weights({ diveWeight: 1 }));
    expect(result.frequencyMultiplier).toBeLessThan(1);
    expect(result.amplitudeMultiplier).toBeGreaterThan(1);
  });

  it('beats faster and wider when panicking', () => {
    const result = computeFlapStateMultipliers(weights({ panicWeight: 1 }));
    expect(result.frequencyMultiplier).toBeGreaterThan(1);
    expect(result.amplitudeMultiplier).toBeGreaterThan(1);
  });

  it('eases off both when cruising', () => {
    const result = computeFlapStateMultipliers(weights({ cruiseWeight: 1 }));
    expect(result.frequencyMultiplier).toBeLessThan(1);
    expect(result.amplitudeMultiplier).toBeLessThan(1);
  });

  it('scales the response with blendStrength', () => {
    const half = computeFlapStateMultipliers(weights({ blendStrength: 0.5, climbWeight: 1 }));
    const full = computeFlapStateMultipliers(weights({ climbWeight: 1 }));
    expect(half.frequencyMultiplier).toBeGreaterThan(1);
    expect(half.frequencyMultiplier).toBeLessThan(full.frequencyMultiplier);
  });

  it('clamps multipliers even when every state is driven to an extreme', () => {
    const maxed = computeFlapStateMultipliers(
      weights({ blendStrength: 100, climbWeight: 100, turnWeight: 100, panicWeight: 100 }),
    );
    expect(maxed.frequencyMultiplier).toBeLessThanOrEqual(1.18);
    expect(maxed.amplitudeMultiplier).toBeLessThanOrEqual(1.24);

    const floored = computeFlapStateMultipliers(
      weights({ blendStrength: 100, diveWeight: 100, cruiseWeight: 100 }),
    );
    expect(floored.frequencyMultiplier).toBeGreaterThanOrEqual(0.8);
    expect(floored.amplitudeMultiplier).toBeGreaterThanOrEqual(0.82);
  });
});

describe('computeSpeedFraction', () => {
  it('normalizes speed against maxSpeed', () => {
    expect(computeSpeedFraction({ speed: 2, maxSpeed: 8 })).toBeCloseTo(0.25);
  });

  it('saturates at 1 above maxSpeed', () => {
    expect(computeSpeedFraction({ speed: 99, maxSpeed: 8 })).toBe(1);
  });

  it('returns 0 rather than dividing by a non-positive maxSpeed', () => {
    expect(computeSpeedFraction({ speed: 5, maxSpeed: 0 })).toBe(0);
    expect(computeSpeedFraction({ speed: 5, maxSpeed: -1 })).toBe(0);
  });
});

describe('computeClimbFraction', () => {
  it('is signed and clamped to [-1, 1]', () => {
    expect(computeClimbFraction({ verticalVelocity: 4, maxSpeed: 8 })).toBeCloseTo(0.5);
    expect(computeClimbFraction({ verticalVelocity: -4, maxSpeed: 8 })).toBeCloseTo(-0.5);
    expect(computeClimbFraction({ verticalVelocity: 100, maxSpeed: 8 })).toBe(1);
    expect(computeClimbFraction({ verticalVelocity: -100, maxSpeed: 8 })).toBe(-1);
  });

  it('returns 0 for a non-positive maxSpeed', () => {
    expect(computeClimbFraction({ verticalVelocity: 4, maxSpeed: 0 })).toBe(0);
  });
});

describe('computeFlapAmplitude', () => {
  it('equals the idle amplitude when stationary', () => {
    const amplitude = computeFlapAmplitude({
      idleAmplitude: 0.3,
      speedAmplitude: 0.5,
      speedFraction: 0,
      stateAmplitudeMultiplier: 1,
    });
    expect(amplitude).toBeCloseTo(0.3);
  });

  it('adds the full speed amplitude at top speed', () => {
    const amplitude = computeFlapAmplitude({
      idleAmplitude: 0.3,
      speedAmplitude: 0.5,
      speedFraction: 1,
      stateAmplitudeMultiplier: 1,
    });
    expect(amplitude).toBeCloseTo(0.8);
  });

  it('increases monotonically with speed', () => {
    const at = (speedFraction: number) =>
      computeFlapAmplitude({ idleAmplitude: 0.3, speedAmplitude: 0.5, speedFraction, stateAmplitudeMultiplier: 1 });
    expect(at(0)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(1));
  });

  it('applies the state multiplier', () => {
    const amplitude = computeFlapAmplitude({
      idleAmplitude: 0.4,
      speedAmplitude: 0,
      speedFraction: 0,
      stateAmplitudeMultiplier: 1.2,
    });
    expect(amplitude).toBeCloseTo(0.48);
  });
});

describe('flap phase', () => {
  it('gives different creatures different starting phases', () => {
    expect(initialFlapPhase(3)).not.toBeCloseTo(initialFlapPhase(4));
  });

  it('integrates at the given frequency', () => {
    expect(advanceFlapPhase({ previousPhase: 1, frequency: 4, dt: 0.25 })).toBeCloseTo(2);
  });

  it('accumulates the same total over many small steps as one big step', () => {
    let phase = initialFlapPhase(2);
    for (let i = 0; i < 100; i += 1) {
      phase = advanceFlapPhase({ previousPhase: phase, frequency: 6, dt: 0.01 });
    }
    const single = advanceFlapPhase({ previousPhase: initialFlapPhase(2), frequency: 6, dt: 1 });
    expect(phase).toBeCloseTo(single);
  });
});

describe('flapAngleFromPhase', () => {
  it('is deterministic for a given creature id and elapsed time', () => {
    const pose = () => {
      const phase = advanceFlapPhase({ previousPhase: initialFlapPhase(7), frequency: 5, dt: 1.5 });
      return flapAngleFromPhase({ phase, amplitude: 0.6, restBiasRad: 0 });
    };
    expect(pose()).toBe(pose());
  });

  it('peaks at the amplitude and troughs at its negation', () => {
    const peak = flapAngleFromPhase({ phase: Math.PI / 2, amplitude: 0.6, restBiasRad: 0 });
    const trough = flapAngleFromPhase({ phase: -Math.PI / 2, amplitude: 0.6, restBiasRad: 0 });
    expect(peak).toBeCloseTo(0.6);
    expect(trough).toBeCloseTo(-0.6);
  });

  it('offsets the whole stroke by the rest bias', () => {
    const biased = flapAngleFromPhase({ phase: 0, amplitude: 0.6, restBiasRad: 0.25 });
    expect(biased).toBeCloseTo(0.25);
  });

  it('stays within amplitude +/- rest bias across a full cycle', () => {
    for (let i = 0; i <= 64; i += 1) {
      const phase = (i / 64) * Math.PI * 2;
      const angle = flapAngleFromPhase({ phase, amplitude: 0.6, restBiasRad: 0.1 });
      expect(angle).toBeGreaterThanOrEqual(0.1 - 0.6 - 1e-9);
      expect(angle).toBeLessThanOrEqual(0.1 + 0.6 + 1e-9);
    }
  });
});

describe('asymmetric wingbeat', () => {
  const AMPLITUDE = 0.6;
  const sample = (phase: number, downstrokeFraction?: number) =>
    flapAngleFromPhase({ phase, amplitude: AMPLITUDE, restBiasRad: 0, downstrokeFraction });

  it('defaults to a pure sine, so scenes that opt out are unchanged', () => {
    for (let i = 0; i <= 64; i += 1) {
      const phase = (i / 64) * Math.PI * 2;
      expect(sample(phase)).toBeCloseTo(Math.sin(phase) * AMPLITUDE);
      expect(sample(phase, SYMMETRIC_DOWNSTROKE_FRACTION)).toBeCloseTo(Math.sin(phase) * AMPLITUDE);
    }
  });

  it('spends less of the cycle sweeping downward when the downstroke is shortened', () => {
    // The downstroke is the motion from the top extreme to the bottom one —
    // i.e. where the angle is increasing (positive is model-down). Measuring
    // "angle > 0" instead would always give half the cycle, by symmetry.
    const steps = 4000;
    const sweepingDownFraction = (downstrokeFraction: number) => {
      let n = 0;
      for (let i = 0; i < steps; i += 1) {
        const phase = (i / steps) * Math.PI * 2;
        const next = ((i + 1) / steps) * Math.PI * 2;
        if (sample(next, downstrokeFraction) > sample(phase, downstrokeFraction)) n += 1;
      }
      return n / steps;
    };
    expect(sweepingDownFraction(SYMMETRIC_DOWNSTROKE_FRACTION)).toBeCloseTo(0.5, 2);
    expect(sweepingDownFraction(0.35)).toBeCloseTo(0.35, 2);
    expect(sweepingDownFraction(0.3)).toBeLessThan(sweepingDownFraction(0.45));
  });

  it('sweeps down faster than it recovers', () => {
    const downstrokeFraction = 0.3;
    const peakSpeed = (from: number, to: number) => {
      let fastest = 0;
      const steps = 2000;
      for (let i = 0; i < steps; i += 1) {
        const a = from + ((to - from) * i) / steps;
        const b = from + ((to - from) * (i + 1)) / steps;
        fastest = Math.max(fastest, Math.abs(sample(b, downstrokeFraction) - sample(a, downstrokeFraction)) / (b - a));
      }
      return fastest;
    };
    // Downstroke occupies the first 30% of the cycle, recovery the rest.
    const down = peakSpeed(-Math.PI / 2, Math.PI * 2 * downstrokeFraction - Math.PI / 2);
    const up = peakSpeed(Math.PI * 2 * downstrokeFraction - Math.PI / 2, Math.PI * 1.5);
    expect(down).toBeGreaterThan(up * 1.5);
  });

  it('still reaches the full stroke extremes', () => {
    const steps = 4000;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < steps; i += 1) {
      const angle = sample((i / steps) * Math.PI * 2, 0.3);
      min = Math.min(min, angle);
      max = Math.max(max, angle);
    }
    expect(max).toBeCloseTo(AMPLITUDE, 3);
    expect(min).toBeCloseTo(-AMPLITUDE, 3);
  });

  it('stays periodic over 2*PI', () => {
    for (let i = 0; i < 16; i += 1) {
      const phase = (i / 16) * Math.PI * 2;
      expect(sample(phase + Math.PI * 2, 0.32)).toBeCloseTo(sample(phase, 0.32));
      expect(sample(phase - Math.PI * 2, 0.32)).toBeCloseTo(sample(phase, 0.32));
    }
  });

  it('has no positional jump at the segment seams', () => {
    // The warp is piecewise, so guard against a visible snap where the two
    // segments meet by checking the stroke is continuous everywhere.
    const steps = 20000;
    const step = (Math.PI * 2) / steps;
    let previous = sample(0, 0.3);
    let largestJump = 0;
    for (let i = 1; i <= steps; i += 1) {
      const angle = sample(i * step, 0.3);
      largestJump = Math.max(largestJump, Math.abs(angle - previous));
      previous = angle;
    }
    // A continuous stroke moves at most ~amplitude * segmentRate * step per sample.
    expect(largestJump).toBeLessThan(0.01);
  });

  it('eases through the seams rather than changing speed abruptly', () => {
    // Seams sit at the stroke extremes, where angular velocity is zero on both
    // sides, so speed matches across them even though the warp rate jumps.
    const downstrokeFraction = 0.3;
    const eps = 1e-4;
    // Bottom extreme: phase where the warped stroke hits +PI/2.
    const bottom = Math.PI * 2 * (downstrokeFraction - 0.25);
    const before = sample(bottom - eps, downstrokeFraction);
    const at = sample(bottom, downstrokeFraction);
    const after = sample(bottom + eps, downstrokeFraction);
    expect(at).toBeCloseTo(AMPLITUDE, 6);
    // Velocity vanishes on both sides of the seam.
    expect(Math.abs(at - before) / eps).toBeLessThan(1e-2);
    expect(Math.abs(after - at) / eps).toBeLessThan(1e-2);
  });

  it('clamps absurd downstroke fractions instead of collapsing the stroke', () => {
    for (const downstrokeFraction of [0, -5, 1, 12, Number.MIN_VALUE]) {
      for (let i = 0; i <= 32; i += 1) {
        const angle = sample((i / 32) * Math.PI * 2, downstrokeFraction);
        expect(Number.isFinite(angle)).toBe(true);
        expect(Math.abs(angle)).toBeLessThanOrEqual(AMPLITUDE + 1e-9);
      }
    }
  });
});

describe('tail sway', () => {
  it('lags the wingbeat by TAIL_SWAY_PHASE_OFFSET at matched frequency', () => {
    const creatureId = 5;
    const elapsed = 2;
    const frequency = 4;
    const tailPhase = computeTailSwayPhase({ elapsed, frequency, creatureId });
    const wingPhase = advanceFlapPhase({
      previousPhase: initialFlapPhase(creatureId),
      frequency,
      dt: elapsed,
    });
    expect(tailPhase - wingPhase).toBeCloseTo(TAIL_SWAY_PHASE_OFFSET);
  });

  it('does not mirror the wingbeat exactly', () => {
    expect(Math.sin(TAIL_SWAY_PHASE_OFFSET)).not.toBeCloseTo(0);
  });

  it('scales linearly with amplitude', () => {
    const phase = 0.9;
    const small = tailSwayAngleFromPhase({ phase, amplitude: 0.2 });
    const large = tailSwayAngleFromPhase({ phase, amplitude: 0.4 });
    expect(large).toBeCloseTo(small * 2);
  });

  it('is stateless — same elapsed time yields the same angle', () => {
    const at = () =>
      tailSwayAngleFromPhase({
        phase: computeTailSwayPhase({ elapsed: 3.25, frequency: 4, creatureId: 11 }),
        amplitude: 0.3,
      });
    expect(at()).toBe(at());
  });
});

describe('legSwingAngleFromPhase', () => {
  it('is a no-op when the scene gives the creature no leg motion', () => {
    // Rigid legs must stay exactly welded, so the angle has to be exactly 0 —
    // the renderer relies on articulating by zero reproducing the body matrix.
    // Math.abs normalises -0, which a zero amplitude produces on the negative
    // half of the sine and which rotates identically to +0.
    for (let i = 0; i <= 16; i += 1) {
      const angle = legSwingAngleFromPhase({
        phase: (i / 16) * Math.PI * 2,
        amplitude: 0,
        tuckRad: 0,
        speedFraction: 1,
      });
      expect(Math.abs(angle)).toBe(0);
    }
  });

  it('draws the legs backward as speed rises', () => {
    const at = (speedFraction: number) =>
      legSwingAngleFromPhase({ phase: 0.4, amplitude: 0, tuckRad: 0.3, speedFraction });
    // Positive is forward, so tucking back means a decreasing angle.
    expect(at(1)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0));
    expect(at(0)).toBe(0);
    expect(at(1)).toBeCloseTo(-0.3);
  });

  it('clamps the speed fraction so out-of-range input cannot over-tuck', () => {
    const tuckRad = 0.3;
    expect(legSwingAngleFromPhase({ phase: 0, amplitude: 0, tuckRad, speedFraction: 4 })).toBeCloseTo(-tuckRad);
    expect(legSwingAngleFromPhase({ phase: 0, amplitude: 0, tuckRad, speedFraction: -4 })).toBeCloseTo(0);
  });

  it('oscillates around the tuck rather than replacing it', () => {
    const amplitude = 0.12;
    const tuckRad = 0.3;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 512; i += 1) {
      const angle = legSwingAngleFromPhase({
        phase: (i / 512) * Math.PI * 2,
        amplitude,
        tuckRad,
        speedFraction: 1,
      });
      min = Math.min(min, angle);
      max = Math.max(max, angle);
    }
    expect(max).toBeCloseTo(-tuckRad + amplitude, 2);
    expect(min).toBeCloseTo(-tuckRad - amplitude, 2);
  });

  it('lags the wingbeat instead of moving in lockstep with it', () => {
    expect(LEG_SWING_PHASE_OFFSET).toBeGreaterThan(0);
    expect(Math.sin(LEG_SWING_PHASE_OFFSET)).not.toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// Dragon wing-bottom clip (issue #199)
// ---------------------------------------------------------------------------
// These constants mirror the values in NatureSceneRenderer3D.ts.  They are
// intentionally duplicated here (not imported) so that a change to one without
// the other causes a test failure — a canary for the fix being complete.
const DRAGON_FLAP_IDLE_AMPLITUDE = 0.4;
const DRAGON_FLAP_SPEED_AMPLITUDE = 0.85;
const DRAGON_BOTTOM_CLIP_RAD = 0.30;

// Phase at the TOP of the stroke: warpStrokePhase input u=0 → the quarter-
// cycle offset in warpStrokePhase means phase = -π/2 reaches u=0 exactly.
const PHASE_AT_TOP = -Math.PI / 2;
// Phase at the BOTTOM of the stroke (symmetric default): u = 0.5.
const PHASE_AT_BOTTOM_SYMMETRIC = Math.PI / 2;

describe('dragon wing-bottom clip (issue #199)', () => {
  // Amplitude at full speed, state-multiplier = 1 (the worst-case scenario
  // that previously caused the wing to pass through the legs).
  const amplitudeAtMaxSpeed = DRAGON_FLAP_IDLE_AMPLITUDE + DRAGON_FLAP_SPEED_AMPLITUDE; // 1.25

  it('leaves the top of the stroke at its pre-change value (-1.25 rad at max speed)', () => {
    // Pre-change: flapAngleFromPhase({ phase: PHASE_AT_TOP, amplitude: 1.25, restBiasRad: 0 })
    // = 1.25 * sin(-π/2) + 0 = -1.25
    const angle = flapAngleFromPhase({
      phase: PHASE_AT_TOP,
      amplitude: amplitudeAtMaxSpeed,
      restBiasRad: 0,
      bottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
    });
    expect(angle).toBeCloseTo(-1.25);
  });

  it('raises the bottom of the stroke from +1.25 to +0.95 rad at max speed', () => {
    // Pre-change: flapAngleFromPhase({ phase: PHASE_AT_BOTTOM, amplitude: 1.25, restBiasRad: 0 })
    // = 1.25 * sin(π/2) + 0 = +1.25
    // Post-change (d = 0.30): bottom = 1.25 - 0.30 = 0.95
    const angle = flapAngleFromPhase({
      phase: PHASE_AT_BOTTOM_SYMMETRIC,
      amplitude: amplitudeAtMaxSpeed,
      restBiasRad: 0,
      bottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
    });
    expect(angle).toBeCloseTo(0.95);
  });

  it('leaves the top unchanged at idle speed as well', () => {
    // Pre-change idle top = -DRAGON_FLAP_IDLE_AMPLITUDE = -0.4
    const angle = flapAngleFromPhase({
      phase: PHASE_AT_TOP,
      amplitude: DRAGON_FLAP_IDLE_AMPLITUDE,
      restBiasRad: 0,
      bottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
    });
    expect(angle).toBeCloseTo(-0.4);
  });

  it('clips the bottom at idle speed to amplitude - clip (0.40 - 0.30 = 0.10 rad)', () => {
    const angle = flapAngleFromPhase({
      phase: PHASE_AT_BOTTOM_SYMMETRIC,
      amplitude: DRAGON_FLAP_IDLE_AMPLITUDE,
      restBiasRad: 0,
      bottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
    });
    expect(angle).toBeCloseTo(0.10);
  });

  it('does not affect other creatures (bottomClipRad defaulting to 0)', () => {
    // A bird at full speed: amplitude = 0.25 + 0.9 = 1.15 (FLAP_IDLE + FLAP_SPEED)
    const birdAmplitude = 0.25 + 0.9;
    const phase = 1.23;
    const unchanged = flapAngleFromPhase({ phase, amplitude: birdAmplitude, restBiasRad: 0 });
    const withZeroClip = flapAngleFromPhase({
      phase,
      amplitude: birdAmplitude,
      restBiasRad: 0,
      bottomClipRad: 0,
    });
    expect(withZeroClip).toBe(unchanged);
  });

  it('the new stroke bottom (0.95 rad) keeps the wing inner boundary clear of the leg claws', () => {
    // Back leg claws in the nature scene: deepest Z = −13.95 model units.
    // Dragon wing wristAnchor is at X_local = 16.2 (span=67.5, span*0.24=16.2).
    // At the new stroke floor θ = 0.95 rad:
    //   Z_wristAnchor = −16.2 × sin(0.95) ≈ −13.19, which clears −13.95 by ~0.76 units.
    const thetaNew = 0.95; // new maximum downstroke (amplitude - clip = 1.25 - 0.30)
    const WRIST_ANCHOR_X_LOCAL = 16.2; // span * 0.24 = 67.5 * 0.24
    const LEG_CLAW_DEEPEST_Z = -13.95; // back leg claws, absolute value of Z
    const zWristAtNewBottom = -WRIST_ANCHOR_X_LOCAL * Math.sin(thetaNew);
    expect(zWristAtNewBottom).toBeGreaterThan(LEG_CLAW_DEEPEST_Z); // clears the claw
  });
});

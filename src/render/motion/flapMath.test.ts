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

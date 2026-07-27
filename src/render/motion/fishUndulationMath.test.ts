import { describe, expect, it } from 'vitest';
import {
  advanceFishUndulationPhase,
  computeFishUndulationOffset,
  computeFishUndulationOffsetSlope,
  computeFishUndulationOmega,
  sampleFishUndulationEnvelope,
} from './fishUndulationMath';

describe('fishUndulationMath', () => {
  it('keeps the head nearly still and grows toward the tail', () => {
    const headPosition = 8;
    const tailPosition = -8;
    const head = sampleFishUndulationEnvelope({ axisPosition: headPosition, headPosition, tailPosition }).envelope;
    const mid = sampleFishUndulationEnvelope({ axisPosition: 0, headPosition, tailPosition }).envelope;
    const tail = sampleFishUndulationEnvelope({ axisPosition: tailPosition, headPosition, tailPosition }).envelope;

    expect(head).toBeCloseTo(0, 8);
    expect(mid).toBeGreaterThan(head);
    expect(tail).toBeGreaterThan(mid);
    expect(tail).toBeCloseTo(1, 8);
  });

  it('matches analytic offset slope against finite differences', () => {
    const args = {
      axisPosition: -2.5,
      headPosition: 8,
      tailPosition: -8,
      amplitude: 0.16,
      waveNumber: 0.42,
      phase: 1.3,
    };
    const eps = 1e-4;
    const numerical =
      (computeFishUndulationOffset({ ...args, axisPosition: args.axisPosition + eps })
        - computeFishUndulationOffset({ ...args, axisPosition: args.axisPosition - eps }))
      / (2 * eps);
    const analytic = computeFishUndulationOffsetSlope(args);
    expect(analytic).toBeCloseTo(numerical, 5);
  });

  it('increases beat rate with speed fraction', () => {
    const slow = computeFishUndulationOmega({ baseOmega: 3.4, speedFraction: 0.1, speedScale: 1.2 });
    const fast = computeFishUndulationOmega({ baseOmega: 3.4, speedFraction: 0.9, speedScale: 1.2 });
    expect(fast).toBeGreaterThan(slow);
  });

  it('advances undulation phase over time', () => {
    const next = advanceFishUndulationPhase({ previousPhase: 2, omega: 4.5, dt: 0.2 });
    expect(next).toBeCloseTo(2.9, 8);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation } from './Simulation';
import { params, resetParams } from './params';
import * as V from './vector';

/**
 * Behavioural guard for the #237 burst strike.
 *
 * The strike is a *feel* change to the hunt, so string/shape assertions are
 * worthless here — every claim below is measured off the simulation itself.
 * The observable is predator speed, which needs no test-only accessor: the
 * strike's whole mechanism is raising the speed clamp.
 */

const REAL_RANDOM = Math.random;

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Sample {
  /** Distinct boids caught over the run. */
  caught: number;
  /** Fastest predator speed seen at any frame. */
  peakSpeed: number;
  /** Fraction of predator-frames spent above normal cruise speed. */
  dutyCycle: number;
}

function runSim(seed: number, strike: boolean, seconds = 30): Sample {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.boidCount = 60;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.horseCount = 0;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;
  params.predatorStrikeEnabled = strike;

  const sim = new Simulation(1000, 1000);
  const caught = new Set<number>();
  let peakSpeed = 0;
  let fast = 0;
  let frames = 0;
  const cruise = params.predatorMaxSpeed;

  for (let i = 0; i < seconds * 60; i++) {
    sim.update(1 / 60);
    for (const b of sim.boids) if (b.dying) caught.add(b.id);
    for (const pred of sim.predators) {
      const speed = V.magnitude(pred.velocity);
      if (speed > peakSpeed) peakSpeed = speed;
      // 1e-6 slack: the clamp is an equality, not a strict inequality.
      if (speed > cruise + 1e-6) fast++;
      frames++;
    }
  }
  return { caught: caught.size, peakSpeed, dutyCycle: fast / frames };
}

describe('predator burst strike (#237)', () => {
  afterEach(() => {
    Math.random = REAL_RANDOM;
    resetParams();
  });

  it('is off by default', () => {
    resetParams();
    expect(params.predatorStrikeEnabled).toBe(false);
  });

  it('never exceeds cruise speed while disabled', () => {
    const off = runSim(1, false);
    // Absolute anchor, not a ratio: a bound expressed in terms of the
    // measured peak could not detect the clamp being lifted.
    expect(off.peakSpeed).toBeLessThanOrEqual(params.predatorMaxSpeed + 1e-6);
    expect(off.dutyCycle).toBe(0);
  }, 120_000);

  it('actually engages when enabled, and respects the boosted cap', () => {
    const on = runSim(1, true);
    resetParams();
    const cruise = params.predatorMaxSpeed;
    const cap = cruise * params.predatorStrikeSpeedBoost;
    // Engages at all: without this the feature could be silently inert.
    expect(on.peakSpeed).toBeGreaterThan(cruise + 1);
    // And never blows past the configured ceiling.
    expect(on.peakSpeed).toBeLessThanOrEqual(cap + 1e-6);
  }, 120_000);

  it('bursts intermittently rather than becoming the new cruise speed', () => {
    // A burst that never ends is just a faster predator, and nothing else in
    // this file would notice -- a stuck ramp still shows a healthy peak speed
    // and an even better catch rate, so only the duty cycle exposes it.
    //
    // Threshold picked from measurement, not guessed: the shipped config runs
    // 7.8%, and removing the ramp-down entirely takes it to 24.5%. Note the
    // duty cycle saturates near 25% however far the strike range is raised,
    // because the real limiter is how often any prey is inside the 220-unit
    // perception radius -- so a loose bound like 0.5 here would be
    // unfalsifiable. 0.15 sits between the two measured populations.
    const on = runSim(1, true);
    expect(on.dutyCycle).toBeGreaterThan(0.01);
    expect(on.dutyCycle).toBeLessThan(0.15);
  }, 120_000);

  it('raises the catch rate, which is the point of the change', () => {
    let offTotal = 0;
    let onTotal = 0;
    for (const seed of [1, 2, 3, 4]) {
      offTotal += runSim(seed, false).caught;
      onTotal += runSim(seed, true).caught;
    }
    expect(onTotal).toBeGreaterThan(offTotal);
  }, 300_000);
});

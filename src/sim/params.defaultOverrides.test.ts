import { describe, it, expect, afterEach } from 'vitest';
import { params, defaultParams, mobileCreatureCounts, installDefaultOverrides, resetParams } from './params';

/**
 * Covers the startup-override mechanism behind the reduced mobile
 * populations of issue #304. The subtle part is Reset: the control panel's
 * Reset button and the mobile defaults are set by different code paths, and
 * an override that only applied at startup would let one tap of Reset hand a
 * phone the full 460-creature desktop flock.
 */

afterEach(() => {
  // installDefaultOverrides mutates module state; put both it and `params`
  // back so ordering between test files cannot matter.
  installDefaultOverrides({});
  resetParams();
});

describe('default overrides', () => {
  it('resets to the plain desktop defaults when nothing is installed', () => {
    params.boidCount = 7;
    resetParams();
    expect(params.boidCount).toBe(defaultParams.boidCount);
  });

  it('applies installed overrides to the live params immediately', () => {
    installDefaultOverrides(mobileCreatureCounts);
    expect(params.boidCount).toBe(mobileCreatureCounts.boidCount);
    expect(params.monsterCount).toBe(mobileCreatureCounts.monsterCount);
  });

  it('restores the overrides, not the desktop defaults, on reset', () => {
    installDefaultOverrides(mobileCreatureCounts);
    params.boidCount = 400;
    resetParams();
    expect(params.boidCount).toBe(mobileCreatureCounts.boidCount);
    expect(params.boidCount).not.toBe(defaultParams.boidCount);
  });

  it('leaves fields the overrides do not mention at their desktop defaults', () => {
    installDefaultOverrides(mobileCreatureCounts);
    params.perceptionRadius = 5;
    resetParams();
    expect(params.perceptionRadius).toBe(defaultParams.perceptionRadius);
  });

  it('keeps every mobile count below its desktop counterpart', () => {
    // Guards against an edit that adds a field to mobileCreatureCounts with
    // the desktop value pasted in, which would silently do nothing.
    const entries = Object.entries(mobileCreatureCounts) as [keyof typeof defaultParams, number][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect.soft(value, `${key} should be reduced on mobile`).toBeLessThan(defaultParams[key] as number);
    }
  });
});

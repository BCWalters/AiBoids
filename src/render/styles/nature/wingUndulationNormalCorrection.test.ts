import { describe, expect, it } from 'vitest';
import {
  UNSHAPED_WAVE,
  sampleWingUndulationDisplacement,
  sampleWingUndulationSlope,
} from './wingUndulationShader';

/**
 * The wing undulation moves each vertex by `z += w(x)` in the vertex shader,
 * and corrects the normal with the analytic slope `dw/dx`. That correction is
 * only as good as the claim that `sampleWingUndulationSlope` really is the
 * derivative of `sampleWingUndulationDisplacement` — if it isn't, the wing is
 * lit as some surface other than the one being drawn, and no amount of
 * rendering will say WHY it looks wrong.
 *
 * These tests pin the derivative against a central finite difference of the
 * displacement itself. They are deliberately not written against a
 * hand-expanded formula: that would just restate the implementation.
 */

const BASE = {
  root: 0,
  span: 1.1,
  amplitude: 0.37,
  waveNumber: Math.PI * 0.7,
};

function finiteDifference(x: number, phase: number, slapSharpness: number): number {
  const h = 1e-6;
  const at = (v: number) =>
    sampleWingUndulationDisplacement({ ...BASE, x: v, phase, slapSharpness });
  return (at(x + h) - at(x - h)) / (2 * h);
}

describe('wing undulation analytic normal correction', () => {
  for (const slapSharpness of [UNSHAPED_WAVE, 2]) {
    it(`slope matches a finite difference of the displacement at slapSharpness ${slapSharpness}`, () => {
      // Sampled across the span and around a full cycle, so the wave's sign
      // change, the envelope's inflection and the phase lag are all covered.
      for (let i = 1; i < 20; i++) {
        const x = BASE.root + (BASE.span * i) / 20;
        for (let p = 0; p < 12; p++) {
          const phase = (Math.PI * 2 * p) / 12 + 0.11;
          const analytic = sampleWingUndulationSlope({ ...BASE, x, phase, slapSharpness });
          expect(analytic).toBeCloseTo(finiteDifference(x, phase, slapSharpness), 3);
        }
      }
    });

    it(`slope is odd in x at slapSharpness ${slapSharpness}, matching the mirrored wings`, () => {
      // Both wings are driven by abs(x) from one attribute, so the left wing is
      // the mirror of the right and its slope must be the negation. Getting
      // this wrong lights one wing correctly and the other inside out.
      for (const x of [0.2, 0.55, 0.9]) {
        const right = sampleWingUndulationSlope({ ...BASE, x, phase: 1.3, slapSharpness });
        const left = sampleWingUndulationSlope({ ...BASE, x: -x, phase: 1.3, slapSharpness });
        expect(left).toBeCloseTo(-right, 10);
        expect(Math.abs(right)).toBeGreaterThan(1e-3);
      }
    });
  }

  it('slope is zero outside the clamped band, where the surface is flat', () => {
    // t is clamped to [0, 1], so beyond the tip and inboard of the root the
    // displacement is constant in x. Tilting the normal there would shade
    // geometry that has not moved — visible as a seam at the wing root.
    const outboard = sampleWingUndulationSlope({ ...BASE, x: BASE.span * 1.4, phase: 1.3 });
    expect(outboard).toBe(0);
    const atRoot = sampleWingUndulationSlope({ ...BASE, x: 0, phase: 1.3 });
    expect(atRoot).toBe(0);
  });

  it('slope is zero for a degenerate span rather than dividing by it', () => {
    expect(sampleWingUndulationSlope({ ...BASE, span: 0, x: 0.5, phase: 1.3 })).toBe(0);
  });

  it('a seated root panel measures its slope from its own root, not the origin', () => {
    // The sea horse pectoral is seated at |x| ~ 0.34. Measuring from the origin
    // would hand the root a share of the deflection and tear it out of the flank.
    const seated = { ...BASE, root: 0.34, span: 0.66 };
    const h = 1e-6;
    const at = (v: number) =>
      sampleWingUndulationDisplacement({ ...seated, x: v, phase: 2.1 });
    const analytic = sampleWingUndulationSlope({ ...seated, x: 0.7, phase: 2.1 });
    expect(analytic).toBeCloseTo((at(0.7 + h) - at(0.7 - h)) / (2 * h), 3);
  });

  it('the shaped wave really is sharper: it spends longer near its extremes', () => {
    // slapSharpness < 1 is meant to square the wave up so the tip dwells at the
    // top and bottom and crosses between them faster. If it did nothing (or the
    // exponent were applied the wrong way round) this fraction would not rise.
    const dwellFraction = (slapSharpness: number) => {
      let near = 0;
      const samples = 2000;
      for (let i = 0; i < samples; i++) {
        const phase = (Math.PI * 2 * i) / samples;
        const d = sampleWingUndulationDisplacement({
          ...BASE,
          x: BASE.span,
          phase,
          slapSharpness,
        });
        if (Math.abs(d) > BASE.amplitude * 0.8) near++;
      }
      return near / samples;
    };
    const plain = dwellFraction(UNSHAPED_WAVE);
    const sharp = dwellFraction(2);
    expect(sharp).toBeGreaterThan(plain * 1.3);
  });
});

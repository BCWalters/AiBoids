import { describe, it, expect } from 'vitest';
import { warpStrokePhase, SYMMETRIC_DOWNSTROKE_FRACTION } from './flapMath';

const TWO_PI = Math.PI * 2;

/**
 * The rigid wing rotation and the wing-undulation vertex shader are two halves
 * of one motion, and they have to share a clock.
 *
 * The rotation runs on `warpStrokePhase(phase, downstrokeFraction)` so the wing
 * snaps down and eases back up. The shader used to be handed the RAW linear
 * phase, so on every creature with an asymmetric beat (all of them) the
 * travelling wave slid against the stroke it belongs to and read as an
 * unrelated ripple instead of the tip trailing the wing.
 *
 * These tests pin the two properties that make sharing the clock correct:
 * it is a no-op for symmetric beats, and it genuinely reshapes asymmetric ones.
 */
describe('wing undulation / rigid flap phase synchronisation', () => {
  it('is the identity at a symmetric 0.5 beat, so fishtank fins are untouched', () => {
    // The fishtank never sets flapDownstrokeFraction, so it defaults to
    // SYMMETRIC_DOWNSTROKE_FRACTION. This is what makes routing the shader
    // through the warp provably safe for every fish.
    //
    // Compared through sin/cos rather than as raw numbers because the warp
    // wraps its result into a single turn: it is the identity MODULO 2*pi, and
    // both consumers (the rigid rotation and the shader's travelling wave) only
    // ever use the phase inside a sin, so agreement mod 2*pi is exactly the
    // property that matters and the raw values are free to differ by a turn.
    for (let i = 0; i <= 24; i++) {
      const phase = (i / 24) * TWO_PI * 2 - TWO_PI;
      const warped = warpStrokePhase(phase, SYMMETRIC_DOWNSTROKE_FRACTION);
      expect(Math.sin(warped)).toBeCloseTo(Math.sin(phase), 6);
      expect(Math.cos(warped)).toBeCloseTo(Math.cos(phase), 6);
    }
  });

  it('reaches the bottom of the stroke after exactly downstrokeFraction of the cycle', () => {
    // sin(warped) = +1 is the bottom of the stroke, -1 the top. The warp's
    // internal clock is a quarter turn ahead of phase so that u = 0 is the TOP,
    // which puts the top at phase = -pi/2 and the bottom a further
    // `downstrokeFraction` of a turn along from there. This is the property the
    // shader depends on: "the bottom" must mean the same instant for both.
    const topPhase = TWO_PI * -0.25;
    for (const downstroke of [0.37, 0.43, 0.5]) {
      expect(Math.sin(warpStrokePhase(topPhase, downstroke))).toBeCloseTo(-1, 6);
      const bottomPhase = topPhase + TWO_PI * downstroke;
      expect(Math.sin(warpStrokePhase(bottomPhase, downstroke))).toBeCloseTo(1, 6);
    }
  });

  it('compresses the downstroke of an asymmetric beat relative to a symmetric one', () => {
    // Guards against the warp silently degenerating into the identity for every
    // input, which would make the fix above a no-op everywhere rather than only
    // in the fishtank. At the bird's 0.37 beat the wing must be further through
    // its descent at mid-downstroke than a symmetric beat would be.
    const topPhase = TWO_PI * -0.25;
    const birdBeat = 0.37;
    const quarterWay = topPhase + TWO_PI * birdBeat * 0.5;
    const bird = Math.sin(warpStrokePhase(quarterWay, birdBeat));
    const symmetric = Math.sin(warpStrokePhase(quarterWay, SYMMETRIC_DOWNSTROKE_FRACTION));
    expect(bird).toBeGreaterThan(symmetric);
  });
});

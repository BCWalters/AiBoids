import { describe, expect, it } from 'vitest';
import { HAWK_FLAP_FREQUENCY, FLAP_FREQUENCY } from '../../../sceneRenderers/NatureSceneRenderer3D';

/**
 * Regression test for the hawk flap-frequency fix (issue #196, defect 3).
 *
 * Hawks are large soaring raptors; they should beat their wings noticeably
 * slower than the small passerine birds (FLAP_FREQUENCY). Verifying this as a
 * constant comparison (rather than at runtime) means the intent survives future
 * tuning of either value — if someone accidentally raises HAWK_FLAP_FREQUENCY
 * above FLAP_FREQUENCY this test will catch it before it ships.
 */
describe('hawk flap frequency', () => {
  it('HAWK_FLAP_FREQUENCY is strictly less than the small-bird FLAP_FREQUENCY', () => {
    expect(HAWK_FLAP_FREQUENCY).toBeLessThan(FLAP_FREQUENCY);
  });

  it('HAWK_FLAP_FREQUENCY is a meaningful reduction (at most 60% of small-bird rate)', () => {
    // A 40%+ reduction is needed to read as "noticeably slower" —
    // this guard prevents the constant from creeping back up without intent.
    expect(HAWK_FLAP_FREQUENCY).toBeLessThanOrEqual(FLAP_FREQUENCY * 0.6);
  });
});

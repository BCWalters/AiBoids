import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from './dragonGeometry';
import { DRAGON_PREDATOR_BASE } from '../../../sceneRenderers/NatureSceneRenderer3D';

/**
 * The dragon's membrane wings fade from the body color at the shoulder to a
 * near-white lavender at the wingtip.
 *
 * As with the tail, the gradient is baked as a MULTIPLIER (exactly 1 at the
 * root) rather than as absolute colors. The body's instance color is not
 * fixed — it lerps from DRAGON_PREDATOR_BASE toward DRAGON_PREDATOR_HUNT while
 * chasing — so absolute colors would pin the wings to one palette and open a
 * visible seam at the shoulder the moment the body brightened.
 *
 * Two further traps this covers:
 *
 *  - Renderer3D enables vertexColors by sniffing wingLeft for a 'color'
 *    attribute. If the attribute is dropped the gradient does not merely
 *    disappear, it silently reverts to a flat wing.
 *
 *  - The wings are built by a single function called once per side with
 *    opposite sign, and the span axis is X, so a gradient keyed on raw X
 *    rather than |X| would come out inverted on one wing.
 */
describe('dragon wing membrane gradient', () => {
  const LENGTH = 2;
  const WIDTH = 0.8;

  const wings = () => {
    const g = createDragonGeometries(LENGTH, WIDTH);
    return { left: g.wingLeft, right: g.wingRight };
  };

  /** Root is the vertex nearest the body centreline; tip is the furthest out. */
  const rootAndTip = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(col).toBeTruthy();

    let rootIdx = 0;
    let tipIdx = 0;
    for (let i = 1; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) < Math.abs(pos.getX(rootIdx))) rootIdx = i;
      if (Math.abs(pos.getX(i)) > Math.abs(pos.getX(tipIdx))) tipIdx = i;
    }
    return {
      root: new THREE.Color(col.getX(rootIdx), col.getY(rootIdx), col.getZ(rootIdx)),
      tip: new THREE.Color(col.getX(tipIdx), col.getY(tipIdx), col.getZ(tipIdx)),
    };
  };

  it('carries a color attribute on both wings so vertexColors is enabled', () => {
    const { left, right } = wings();
    expect(left.getAttribute('color')).toBeTruthy();
    expect(right.getAttribute('color')).toBeTruthy();
  });

  it('is neutral at the root so the membrane starts on the body color', () => {
    for (const wing of Object.values(wings())) {
      const { root } = rootAndTip(wing);
      expect(root.r).toBeCloseTo(1, 5);
      expect(root.g).toBeCloseTo(1, 5);
      expect(root.b).toBeCloseTo(1, 5);
    }
  });

  it('lightens strongly toward the tip on BOTH wings, not just one', () => {
    for (const [side, wing] of Object.entries(wings())) {
      const { tip } = rootAndTip(wing);
      // Above 1 is the whole point: these lighten rather than darken. A
      // gradient keyed on signed X instead of |X| leaves one wing below 1.
      expect(tip.r, `${side} wing red`).toBeGreaterThan(1.5);
      expect(tip.g, `${side} wing green`).toBeGreaterThan(1.5);
      expect(tip.b, `${side} wing blue`).toBeGreaterThan(1.5);
    }
  });

  it('brightens monotonically outward from the body', () => {
    const { left } = wings();
    const pos = left.getAttribute('position') as THREE.BufferAttribute;
    const col = left.getAttribute('color') as THREE.BufferAttribute;

    const samples: { out: number; lum: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      samples.push({
        out: Math.abs(pos.getX(i)),
        lum: col.getX(i) + col.getY(i) + col.getZ(i),
      });
    }
    samples.sort((a, b) => a.out - b.out);

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].lum).toBeGreaterThanOrEqual(samples[i - 1].lum - 1e-5);
    }
  });

  it('resolves to a genuinely light tip against the shipped body color', () => {
    const { tip } = rootAndTip(wings().left);
    const base = DRAGON_PREDATOR_BASE;

    // This is the drift guard. The multiplier is derived from a reference pair
    // whose body half must track DRAGON_PREDATOR_BASE; if the base is deepened
    // and that reference is not updated with it, the realised tip darkens by
    // the same factor and quietly stops reading as a light membrane.
    const realised = new THREE.Color(tip.r * base.r, tip.g * base.g, tip.b * base.b);
    const baseLum = base.r + base.g + base.b;
    const tipLum = realised.r + realised.g + realised.b;

    expect(tipLum).toBeGreaterThan(baseLum * 4);
    // And it must stay in gamut rather than blowing out to pure white, which
    // would flatten the outer third of the wing into a featureless blob.
    expect(Math.max(realised.r, realised.g, realised.b)).toBeLessThan(1.25);
  });

  it('desaturates toward lavender rather than merely brightening the purple', () => {
    const { tip } = rootAndTip(wings().left);
    // Green is the scarcest channel in the body purple, so lifting it hardest
    // is what turns "brighter purple" into "thin membrane catching light".
    expect(tip.g).toBeGreaterThan(tip.b);
  });
});

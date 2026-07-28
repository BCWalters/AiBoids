import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from './dragonGeometry';

/**
 * The dragon's membrane wings bake a root→tip lightening gradient as a
 * multiplier, so the membrane tracks whatever color the body currently is.
 *
 * Only the failure that is invisible in code review is pinned here: the wings
 * are built by ONE function called twice with opposite sign, and the span axis
 * is X, so a gradient keyed on raw X instead of |X| comes out inverted on one
 * wing — and you only notice by orbiting the camera to the far side.
 *
 * Dropping the 'color' attribute entirely is caught by the same assertion,
 * since Renderer3D enables vertexColors by sniffing for it.
 *
 * Exact stop values are deliberately NOT asserted: they are visual taste and
 * were tuned live against the preview.
 */
describe('dragon wing membrane gradient', () => {
  it('lightens outward on BOTH wings', () => {
    const { wingLeft, wingRight } = createDragonGeometries(2, 0.8);

    for (const [side, wing] of Object.entries({ wingLeft, wingRight })) {
      const pos = wing.getAttribute('position') as THREE.BufferAttribute;
      const col = wing.getAttribute('color') as THREE.BufferAttribute;
      expect(col, `${side} has no color attribute`).toBeTruthy();

      let rootIdx = 0;
      let tipIdx = 0;
      for (let i = 1; i < pos.count; i++) {
        if (Math.abs(pos.getX(i)) < Math.abs(pos.getX(rootIdx))) rootIdx = i;
        if (Math.abs(pos.getX(i)) > Math.abs(pos.getX(tipIdx))) tipIdx = i;
      }

      const lum = (i: number) => col.getX(i) + col.getY(i) + col.getZ(i);
      expect(lum(tipIdx), `${side} tip not lighter than root`).toBeGreaterThan(lum(rootIdx) * 1.5);
    }
  });
});

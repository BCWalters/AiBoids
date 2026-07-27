import { describe, expect, it } from 'vitest';

import { createDragonGeometries } from './dragonGeometry';
import { createHawkGeometries } from './hawkGeometry';
import { createParrotGeometries } from './parrotGeometry';
import { createRealisticBirdGeometries } from './smallBirdGeometry';
import { createUnicornGeometries } from './unicornGeometry';
import type { CreatureLegPart } from '../../../geometry/sharedGeometry';
import { findRigOrderingViolation } from '../../../motion/rig';

/**
 * Legs are posed by rotating each rig part about the pivot its geometry builder
 * declared. Nothing at runtime re-derives that pivot, so a geometry change that
 * moved a joint without updating its declaration would swing the part about a
 * point it no longer attaches at — visibly detaching it from the body, which no
 * colour or smoke test would catch.
 *
 * These assertions pin the convention those declarations rely on: legs are
 * modelled hanging along -Z from the point where they meet the body.
 */
describe('leg attachment convention', () => {
  const creatures: [string, CreatureLegPart[] | undefined][] = [
    ['unicorn', createUnicornGeometries(1, 0.4).legs],
    ['dragon', createDragonGeometries(1, 0.4).legs],
    ['hawk', createHawkGeometries(1, 0.4).legs],
    ['parrot', createParrotGeometries(1, 0.4).legs],
    ['small bird', createRealisticBirdGeometries(1, 0.4).legs],
  ];

  it('finds legs on every nature creature expected to have them', () => {
    const missing = creatures.filter(([, legs]) => !legs?.length).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  for (const [name, legs] of creatures) {
    it(`${name} legs hang below their declared pivot`, () => {
      expect(legs?.length).toBeTruthy();
      if (!legs) return;

      for (const part of legs) {
        part.geometry.computeBoundingBox();
        const box = part.geometry.boundingBox;
        expect(box, `${name} ${part.role}`).toBeTruthy();
        if (!box) return;

        const drop = box.max.z - box.min.z;
        // The part must extend downward from its joint rather than straddling it.
        expect(drop, `${name} ${part.role}`).toBeGreaterThan(0);
        // The declared pivot sits at or above the top of the part it rotates,
        // with a small tolerance because some creatures (the dragon) attach
        // their legs a little above the central spine axis.
        expect(part.pivot[2], `${name} ${part.role}`).toBeGreaterThanOrEqual(box.max.z - drop * 0.1);
      }
    });

    it(`${name} legs declare a well-ordered rig`, () => {
      if (!legs) return;
      expect(findRigOrderingViolation(legs)).toBeNull();
    });
  }
});

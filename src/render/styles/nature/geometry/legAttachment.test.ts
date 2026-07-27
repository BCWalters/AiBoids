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

  it('gives the unicorn a jointed leg whose lower segment hangs off a knee', () => {
    const legs = createUnicornGeometries(1, 0.4).legs;
    expect(legs).toBeTruthy();
    if (!legs) return;

    // A horse's legs read as stiff unless the knee actually changes angle, and
    // a part can only rotate as a unit — so the lower segments must be their
    // own parts, parented to the thigh above them. Collapsing this back into
    // one mesh would silently restore the rigid-plank look.
    const jointed = legs.filter((part) => part.parent !== undefined);
    expect(jointed.length).toBeGreaterThanOrEqual(2);

    for (const part of jointed) {
      const thigh = legs[part.parent as number];
      // The knee must sit below the hip it hangs from, or the chain is inverted.
      expect(part.pivot[2], `${part.role} pivot vs ${thigh.role}`).toBeLessThan(thigh.pivot[2]);
    }
  });
});

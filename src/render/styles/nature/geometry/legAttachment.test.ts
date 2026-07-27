import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createDragonGeometries } from './dragonGeometry';
import { createHawkGeometries } from './hawkGeometry';
import { createParrotGeometries } from './parrotGeometry';
import { createRealisticBirdGeometries } from './smallBirdGeometry';
import { createUnicornGeometries } from './unicornGeometry';

/**
 * CreatureInstanceRenderer swings legs about a hip pivot it derives from the
 * legs geometry — the top of their bounding box (see legHipPivotZ). That only
 * works because legs are modelled hanging along -Z from where they meet the
 * body. If a geometry change ever broke that assumption the legs would pivot
 * about the wrong point and visibly detach from the body, which no colour or
 * smoke test would catch.
 */
describe('leg attachment convention', () => {
  const creatures: [string, THREE.BufferGeometry | undefined][] = [
    ['unicorn', createUnicornGeometries(1, 0.4).legs],
    ['dragon', createDragonGeometries(1, 0.4).legs],
    ['hawk', createHawkGeometries(1, 0.4).legs],
    ['parrot', createParrotGeometries(1, 0.4).legs],
    ['small bird', createRealisticBirdGeometries(1, 0.4).legs],
  ];

  it('finds legs on every nature creature expected to have them', () => {
    const missing = creatures.filter(([, legs]) => !legs).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  for (const [name, legs] of creatures) {
    it(`${name} legs hang below their attachment point`, () => {
      expect(legs).toBeTruthy();
      if (!legs) return;
      legs.computeBoundingBox();
      const box = legs.boundingBox;
      expect(box).toBeTruthy();
      if (!box) return;
      const drop = box.max.z - box.min.z;
      // Legs must extend downward from the hip rather than straddling it.
      expect(drop).toBeGreaterThan(0);
      // The hip sits at the body, not out in space above it. Some creatures
      // (the dragon) attach their legs a little above the central spine axis,
      // so this allows a small positive offset rather than requiring z <= 0.
      expect(box.max.z).toBeLessThanOrEqual(drop * 0.1);
    });
  }
});

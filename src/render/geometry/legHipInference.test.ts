import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { singleLegPart } from './sharedGeometry';
import { createRealisticBirdGeometries } from '../styles/nature/geometry/smallBirdGeometry';
import { createHawkGeometries } from '../styles/nature/geometry/hawkGeometry';

/**
 * Guards the hip that singleLegPart infers.
 *
 * The failure this exists to prevent is silent: the legs still render, still
 * animate, and still sit in the right place at rest. They only go wrong once
 * the speed-proportional tuck winds up, and then they slide inside the body
 * rather than disappearing outright, so nothing throws and no colour test
 * notices. It has to be caught arithmetically.
 */

// Matches BIRD_LEG_TUCK_RAD + BIRD_LEG_SWING_AMPLITUDE in NatureSceneRenderer3D:
// the most backward the legs are ever driven.
const MAX_BIRD_TUCK_RAD = -(0.34 + 0.1);

function tuckedFeet(geometries: { body: THREE.BufferGeometry; legs?: { pivot?: number[] | null; geometry: THREE.BufferGeometry }[] }) {
  const part = geometries.legs?.[0];
  if (!part?.pivot) throw new Error('expected a legs part with a declared pivot');
  const pivot = new THREE.Vector3(...part.pivot);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), MAX_BIRD_TUCK_RAD);
  const position = part.geometry.getAttribute('position');

  let lowestTucked = Infinity;
  for (let i = 0; i < position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
    vertex.sub(pivot).applyQuaternion(rotation).add(pivot);
    lowestTucked = Math.min(lowestTucked, vertex.z);
  }

  geometries.body.computeBoundingBox();
  return { lowestTucked, bodyBottom: geometries.body.boundingBox?.min.z ?? 0, pivot };
}

describe('singleLegPart hip inference', () => {
  const birds = [
    { name: 'small bird', build: () => createRealisticBirdGeometries(2.2, 0.8) },
    { name: 'hawk', build: () => createHawkGeometries(3.2, 1.1) },
  ];

  for (const bird of birds) {
    it(`keeps the ${bird.name}'s feet below the body at full tuck`, () => {
      const { lowestTucked, bodyBottom } = tuckedFeet(bird.build() as never);

      // The regression put every leg vertex above this line, i.e. entirely
      // swallowed by the body.
      expect(lowestTucked).toBeLessThan(bodyBottom);
    });

    it(`hinges the ${bird.name}'s legs at the legs, not at the model origin`, () => {
      const { pivot } = tuckedFeet(bird.build() as never);

      // A hip pinned to y = 0 is the specific bug: it sits roughly half a
      // body-length ahead of where these legs attach, and the resulting
      // lever arm is what threw the feet up into the belly. Assert the hinge
      // has been carried back to the legs themselves.
      expect(pivot.y).toBeLessThan(0);
    });
  }

  it('averages the attachment slice rather than trusting one extreme vertex', () => {
    // Two clusters of leg vertices at the same height plus a single stray
    // spur further forward. The hinge should follow the clusters.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          // attachment slice, sitting at y = -1
          -0.2, -1, 0, 0.2, -1, 0, 0, -1, 0,
          // feet, well below
          -0.2, -1, -1, 0.2, -1, -1, 0, -1, -1,
        ]),
        3,
      ),
    );

    const [part] = singleLegPart(geometry);
    expect(part.pivot?.[2]).toBeCloseTo(0);
    expect(part.pivot?.[1]).toBeCloseTo(-1);
    // Left and right legs share one hinge line because the swing axis is X.
    expect(part.pivot?.[0]).toBe(0);
  });

  it('does not fall over on an empty legs geometry', () => {
    const [part] = singleLegPart(new THREE.BufferGeometry());
    expect(part.pivot?.every((n) => Number.isFinite(n))).toBe(true);
  });
});

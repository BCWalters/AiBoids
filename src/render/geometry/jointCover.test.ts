import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { jointBarrelForBoxSection, pushJointBarrel } from './sharedGeometry';
import { createUnicornGeometries } from '../styles/nature/geometry/unicornGeometry';

/**
 * The unicorn's knee is the first joint in the codebase that actually
 * articulates, so it is where the "two flat faces open a wedge" problem
 * first showed up. These guard the cover that hides it.
 *
 * Two things can go wrong, and they pull in opposite directions: too small
 * and the gap reappears at large bend angles, too large and it reads as a
 * knee pad. Both directions are asserted, because fixing one by eye is
 * exactly how you break the other.
 */

const LENGTH = 10;
const WIDTH = 3;
// Mirrors buildUnicornLegParts. The cannon bone is the segment that moves
// relative to the thigh, at 0.85 of the thigh's section.
const LEG_HALF_WIDTH = WIDTH * 0.09;
const LEG_HALF_DEPTH = WIDTH * 0.07;
const MOVING_HALF_WIDTH = LEG_HALF_WIDTH * 0.85;
const MOVING_HALF_DEPTH = LEG_HALF_DEPTH * 0.85;

function movingCapVertices() {
  const geometries = createUnicornGeometries(LENGTH, WIDTH);
  const lower = geometries.legs?.find((part) => part.role === 'legLowerFront');
  if (!lower?.pivot) throw new Error('expected a legLowerFront part with a declared pivot');
  const pivot = new THREE.Vector3(...lower.pivot);
  const position = lower.geometry.getAttribute('position');

  // The cap is the ring of vertices sitting on the knee itself: the hinge
  // runs along X, so cap vertices are the ones closest to that axis line.
  const cap: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
    const axialDistance = Math.hypot(vertex.y - pivot.y, vertex.z - pivot.z);
    if (axialDistance <= MOVING_HALF_DEPTH * 1.0001) cap.push(vertex);
  }
  return { cap, pivot };
}

describe('joint cover sizing', () => {
  it('covers the whole face that moves, so no gap opens at any bend angle', () => {
    const { cap, pivot } = movingCapVertices();
    const barrel = jointBarrelForBoxSection({
      movingHalfDepth: MOVING_HALF_DEPTH,
      widestHalfWidth: LEG_HALF_WIDTH,
    });

    // Guard against the assertion passing simply because nothing was found.
    expect(cap.length).toBeGreaterThan(0);

    // The hinge runs along X, so rotating the cap preserves each vertex's
    // distance from the axis and its X coordinate. Containing the cap at
    // rest therefore contains it at *every* angle - which is the whole
    // reason a barrel about the hinge axis is the right shape.
    const kneeX = Math.max(...cap.map((v) => Math.abs(v.x))) - MOVING_HALF_WIDTH;
    for (const vertex of cap) {
      expect(Math.hypot(vertex.y - pivot.y, vertex.z - pivot.z)).toBeLessThanOrEqual(barrel.radius);
      expect(Math.abs(Math.abs(vertex.x) - kneeX)).toBeLessThanOrEqual(barrel.halfLength);
    }
  });

  it('stays within the limb it covers rather than reading as a knee pad', () => {
    const barrel = jointBarrelForBoxSection({
      movingHalfDepth: MOVING_HALF_DEPTH,
      widestHalfWidth: LEG_HALF_WIDTH,
    });

    // The first attempt here was a sphere, which had to reach the moving
    // face's half-*diagonal* to swallow its corners and so bulged well
    // clear of the leg fore-aft. A barrel separates fore-aft reach from
    // width, so it sits inside the thigh's own profile and disappears.
    expect(barrel.radius).toBeLessThan(LEG_HALF_DEPTH);
    const spherePlacebo = Math.hypot(MOVING_HALF_WIDTH, MOVING_HALF_DEPTH);
    expect(barrel.radius).toBeLessThan(spherePlacebo);
  });

  it('sits on the hinge axis, so the joint it covers cannot make it wobble', () => {
    const geometries = createUnicornGeometries(LENGTH, WIDTH);
    const upper = geometries.legs?.find((part) => part.role === 'legUpperFront');
    const lower = geometries.legs?.find((part) => part.role === 'legLowerFront');
    if (!lower?.pivot) throw new Error('expected a legLowerFront pivot');

    // The cover lives in the thigh so it follows the hip, but it is centred
    // on the knee's pivot line and aligned to the knee's axis - the only
    // placement under which the knee's own bend leaves it fixed.
    expect(lower.axis).toEqual([1, 0, 0]);
    expect(upper?.axis).toEqual([1, 0, 0]);

    // Its presence is what distinguishes a covered joint from a bare one;
    // the thigh carries strictly more geometry than the cannon bone below
    // it precisely because it owns the cover.
    const upperCount = upper?.geometry.getAttribute('position').count ?? 0;
    const lowerCount = lower.geometry.getAttribute('position').count;
    expect(upperCount).toBeGreaterThan(lowerCount);
  });
});

describe('pushJointBarrel', () => {
  it('builds a closed barrel about the axis it is given', () => {
    const sink = { positions: [] as number[], colors: [] as number[] };
    const center = new THREE.Vector3(1, 2, 3);
    const axis = new THREE.Vector3(1, 0, 0);
    pushJointBarrel(sink, { center, axis, radius: 0.5, halfLength: 0.25, color: new THREE.Color(1, 0, 0) });

    expect(sink.positions.length).toBeGreaterThan(0);
    expect(sink.positions.length % 9).toBe(0);
    expect(sink.colors.length).toBe(sink.positions.length);

    for (let i = 0; i < sink.positions.length; i += 3) {
      const v = new THREE.Vector3(sink.positions[i], sink.positions[i + 1], sink.positions[i + 2]);
      // Every vertex within the declared envelope: nothing escapes sideways
      // along the hinge, nothing escapes radially.
      expect(Math.abs(v.x - center.x)).toBeLessThanOrEqual(0.25 + 1e-6);
      expect(Math.hypot(v.y - center.y, v.z - center.z)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it('does not degenerate when the axis is the one used to seed the basis', () => {
    // The perpendicular basis is seeded from a fixed vector, so an axis
    // parallel to that seed would produce a zero-length cross product and
    // a barrel full of NaNs.
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const sink = { positions: [] as number[], colors: [] as number[] };
      pushJointBarrel(sink, {
        center: new THREE.Vector3(),
        axis,
        radius: 0.5,
        halfLength: 0.25,
        color: new THREE.Color(1, 1, 1),
      });
      expect(sink.positions.length).toBeGreaterThan(0);
      expect(sink.positions.every((n) => Number.isFinite(n))).toBe(true);
    }
  });
});

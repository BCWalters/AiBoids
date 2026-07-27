import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composePartArticulation } from './partTransform';

function articulate(axis: THREE.Vector3, angle: number, pivot: THREE.Vector3 | null): THREE.Matrix4 {
  return composePartArticulation({
    target: new THREE.Matrix4(),
    axis,
    angle,
    pivot,
    scratchQuat: new THREE.Quaternion(),
    scratchToOrigin: new THREE.Matrix4(),
    scratchToPivot: new THREE.Matrix4(),
  }).clone();
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

describe('composePartArticulation', () => {
  it('reduces to a plain rotation when there is no pivot', () => {
    const expected = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromAxisAngle(AXIS_Y, 0.4),
    );
    expect(articulate(AXIS_Y, 0.4, null).elements).toEqual(expected.elements);
  });

  it('treats a zero pivot identically to no pivot', () => {
    const withNull = articulate(AXIS_Y, 0.4, null);
    const withZero = articulate(AXIS_Y, 0.4, new THREE.Vector3(0, 0, 0));
    withZero.elements.forEach((v, i) => expect(v).toBeCloseTo(withNull.elements[i]));
  });

  it('leaves the pivot point itself fixed', () => {
    const pivot = new THREE.Vector3(0, 1.5, 0);
    const moved = pivot.clone().applyMatrix4(articulate(AXIS_X, 0.7, pivot));
    expect(moved.x).toBeCloseTo(pivot.x);
    expect(moved.y).toBeCloseTo(pivot.y);
    expect(moved.z).toBeCloseTo(pivot.z);
  });

  it('swings points away from the pivot rather than about the origin', () => {
    const pivot = new THREE.Vector3(0, 1, 0);
    const tip = new THREE.Vector3(0, 2, 0);
    const aboutPivot = tip.clone().applyMatrix4(articulate(AXIS_X, Math.PI / 2, pivot));
    const aboutOrigin = tip.clone().applyMatrix4(articulate(AXIS_X, Math.PI / 2, null));

    // A point one unit beyond the pivot swings to one unit out from the pivot.
    expect(aboutPivot.y).toBeCloseTo(1);
    expect(Math.abs(aboutPivot.z)).toBeCloseTo(1);
    // Rotating about the origin instead swings it twice as far.
    expect(aboutOrigin.y).toBeCloseTo(0);
    expect(Math.abs(aboutOrigin.z)).toBeCloseTo(2);
  });

  it('is the identity at zero angle', () => {
    const identity = new THREE.Matrix4();
    articulate(AXIS_X, 0, new THREE.Vector3(0, 1.5, 0)).elements.forEach((v, i) =>
      expect(v).toBeCloseTo(identity.elements[i]),
    );
  });

  it('supports pivots off the Y axis', () => {
    const pivot = new THREE.Vector3(0.5, 0, -0.25);
    const moved = pivot.clone().applyMatrix4(articulate(AXIS_Y, 1.1, pivot));
    expect(moved.x).toBeCloseTo(pivot.x);
    expect(moved.z).toBeCloseTo(pivot.z);
  });

  it('does not allocate a new matrix — it writes into the target', () => {
    const target = new THREE.Matrix4();
    const result = composePartArticulation({
      target,
      axis: AXIS_Y,
      angle: 0.3,
      pivot: new THREE.Vector3(0, 1, 0),
      scratchQuat: new THREE.Quaternion(),
      scratchToOrigin: new THREE.Matrix4(),
      scratchToPivot: new THREE.Matrix4(),
    });
    expect(result).toBe(target);
  });
});

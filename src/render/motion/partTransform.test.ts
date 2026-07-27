import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composeArticulationChain, composePartArticulation } from './partTransform';

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

describe('composeArticulationChain', () => {
  function link(angle: number, pivot: THREE.Vector3): THREE.Matrix4 {
    return composePartArticulation({
      target: new THREE.Matrix4(),
      axis: new THREE.Vector3(1, 0, 0),
      angle,
      pivot,
      scratchQuat: new THREE.Quaternion(),
      scratchToOrigin: new THREE.Matrix4(),
      scratchToPivot: new THREE.Matrix4(),
    });
  }

  const HIP = new THREE.Vector3(0, 0, 0);
  const KNEE = new THREE.Vector3(0, 0, -1);

  it('reduces to the single link when the chain has one entry', () => {
    const only = link(0.3, HIP);
    const chained = composeArticulationChain({ target: new THREE.Matrix4(), chain: [only] });
    expect(chained.elements).toEqual(only.elements);
  });

  it('leaves geometry untouched when every joint is at rest', () => {
    const chained = composeArticulationChain({
      target: new THREE.Matrix4(),
      chain: [link(0, HIP), link(0, KNEE)],
    });
    const foot = new THREE.Vector3(0, 0, -2).applyMatrix4(chained);
    expect(foot.x).toBeCloseTo(0);
    expect(foot.y).toBeCloseTo(0);
    expect(foot.z).toBeCloseTo(-2);
  });

  it('carries the knee along when only the hip rotates', () => {
    // A rigid leg: bending nothing at the knee, the foot must still swing
    // through the full hip arc rather than staying put.
    const chained = composeArticulationChain({
      target: new THREE.Matrix4(),
      chain: [link(Math.PI / 2, HIP), link(0, KNEE)],
    });
    const foot = new THREE.Vector3(0, 0, -2).applyMatrix4(chained);
    // Rotating -Z by +90deg about +X carries it to +Y (model-forward).
    expect(foot.y).toBeCloseTo(2);
    expect(foot.z).toBeCloseTo(0);
  });

  it('bends the lower segment about the knee without moving the knee itself', () => {
    const chained = composeArticulationChain({
      target: new THREE.Matrix4(),
      chain: [link(0, HIP), link(Math.PI / 2, KNEE)],
    });
    // The knee is the pivot, so it is the one point that must not move.
    const knee = KNEE.clone().applyMatrix4(chained);
    expect(knee.y).toBeCloseTo(0);
    expect(knee.z).toBeCloseTo(-1);
    // The foot one unit below the knee folds forward to the knee's height.
    const foot = new THREE.Vector3(0, 0, -2).applyMatrix4(chained);
    expect(foot.y).toBeCloseTo(1);
    expect(foot.z).toBeCloseTo(-1);
  });

  it('accumulates both joints, so a child inherits its parent rotation', () => {
    const chained = composeArticulationChain({
      target: new THREE.Matrix4(),
      chain: [link(Math.PI / 2, HIP), link(-Math.PI / 2, KNEE)],
    });
    // Hip swings the whole leg forward 90deg, knee folds back 90deg. The lower
    // segment ends up parallel to its rest orientation but displaced by the hip
    // swing — the signature of a real chain rather than two independent parts.
    const foot = new THREE.Vector3(0, 0, -2).applyMatrix4(chained);
    expect(foot.y).toBeCloseTo(1);
    expect(foot.z).toBeCloseTo(-1);
  });
});

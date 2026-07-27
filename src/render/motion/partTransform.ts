import * as THREE from 'three';

/**
 * Builds the local articulation transform for one creature part: a rotation of
 * `angle` about `axis`, applied around `pivot` (model space) instead of the
 * model origin.
 *
 * Written into `target` so callers can reuse scratch matrices — this runs for
 * every part of every creature every frame, so it must not allocate.
 *
 * When the pivot is the origin this reduces to a plain rotation matrix, which
 * is why wings (no pivot) and tails (pivoted at their attachment point) can
 * share a single code path in CreatureInstanceRenderer.
 */
export function composePartArticulation({
  target,
  axis,
  angle,
  pivot,
  scratchQuat,
  scratchToOrigin,
  scratchToPivot,
}: {
  target: THREE.Matrix4;
  axis: THREE.Vector3;
  angle: number;
  pivot: THREE.Vector3 | null;
  scratchQuat: THREE.Quaternion;
  scratchToOrigin: THREE.Matrix4;
  scratchToPivot: THREE.Matrix4;
}): THREE.Matrix4 {
  scratchQuat.setFromAxisAngle(axis, angle);
  target.makeRotationFromQuaternion(scratchQuat);
  if (!pivot || (pivot.x === 0 && pivot.y === 0 && pivot.z === 0)) return target;
  scratchToOrigin.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  scratchToPivot.makeTranslation(pivot.x, pivot.y, pivot.z);
  target.premultiply(scratchToPivot);
  target.multiply(scratchToOrigin);
  return target;
}

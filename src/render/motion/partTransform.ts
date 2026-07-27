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

/**
 * Composes a chain of articulations in *model space*, so a child joint inherits
 * every rotation applied to its ancestors — a hoof follows the knee, which
 * follows the hip.
 *
 * `chain` must be ordered root-first. Each entry is the local articulation of
 * one link, as produced by composePartArticulation. The result is the product
 * `root · … · leaf`, which the caller then applies once to the body transform.
 *
 * Composing in model space rather than accumulating world matrices is what
 * keeps this cheap: the body's position/orientation/scale is applied a single
 * time at the end instead of being decomposed per link. That's valid because
 * body scale is uniform, and uniform scale commutes with rotation.
 */
export function composeArticulationChain({
  target,
  chain,
}: {
  target: THREE.Matrix4;
  chain: readonly THREE.Matrix4[];
}): THREE.Matrix4 {
  target.identity();
  for (const link of chain) target.multiply(link);
  return target;
}

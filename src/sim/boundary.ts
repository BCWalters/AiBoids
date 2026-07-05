import * as V from './vector';
import type { Vec3 } from './vector';

export interface WorldBounds {
  width: number; // x: [0, width]
  height: number; // y: [0, height]
  depth: number; // z: [0, depth]
}

/**
 * Computes a steering force pushing `position` away from any wall it's
 * within `margin` of, scaling up linearly as the wall gets closer. Used in
 * 3D mode instead of wraparound, since teleporting across the world reads
 * as a jarring glitch once you have a camera you can orbit/pan.
 * Returns a zero vector when not near any wall.
 *
 * The result is pre-scaled by `maxForce` (each axis contributes up to
 * ±maxForce right at the wall) rather than being a raw 0..1 unit vector —
 * without this, a caller's `boundaryWeight` (a small, user-facing 0-10
 * multiplier meant to fine-tune push strength) had to single-handedly
 * scale a ~1-unit vector up to something competitive with other steering
 * forces that are already maxForce-scale (e.g. predator pursuit). At the
 * old scale, even the max wall push (~sqrt(3) at a true corner) times a
 * default boundaryWeight of 3.5 came out to roughly 6 — utterly
 * negligible next to a maxForce of 250 — so a predator actively chasing
 * prey straight into a corner had no real way to be pushed back out
 * and would sit pinned against the boundary. Baking maxForce in here
 * means boundaryWeight now behaves as "what fraction of maxForce, at
 * most, should wall avoidance be allowed to compete with other forces
 * at" (0 = off, 10 = a full maxForce-strength shove right at the wall).
 */
export function boundarySteer(position: Vec3, bounds: WorldBounds, margin: number, maxForce: number): Vec3 {
  if (margin <= 0) return V.create();
  const steer = V.create();

  const near = (coord: number, max: number): number => {
    const distFromMin = coord;
    const distFromMax = max - coord;
    if (distFromMin < margin) return (margin - distFromMin) / margin; // positive push
    if (distFromMax < margin) return -(margin - distFromMax) / margin; // negative push
    return 0;
  };

  // Divide by 10 here (rather than in every caller) so the existing
  // boundaryWeight UI slider (range 0-10, default 3.5) keeps behaving as
  // "0 = off, 10 = strongest" while its strongest setting now actually
  // means something (a full maxForce-scale push), not ~6 units of force.
  const scale = maxForce / 10;
  steer.x = near(position.x, bounds.width) * scale;
  steer.y = near(position.y, bounds.height) * scale;
  steer.z = near(position.z, bounds.depth) * scale;

  return steer;
}

/** Hard safety clamp so entities never numerically drift outside the box. */
export function clampToBounds(position: Vec3, bounds: WorldBounds): void {
  if (position.x < 0) position.x = 0;
  else if (position.x > bounds.width) position.x = bounds.width;
  if (position.y < 0) position.y = 0;
  else if (position.y > bounds.height) position.y = bounds.height;
  if (position.z < 0) position.z = 0;
  else if (position.z > bounds.depth) position.z = bounds.depth;
}

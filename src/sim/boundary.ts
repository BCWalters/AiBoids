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
 */
export function boundarySteer(position: Vec3, bounds: WorldBounds, margin: number): Vec3 {
  if (margin <= 0) return V.create();
  const steer = V.create();

  const near = (coord: number, max: number): number => {
    const distFromMin = coord;
    const distFromMax = max - coord;
    if (distFromMin < margin) return (margin - distFromMin) / margin; // positive push
    if (distFromMax < margin) return -(margin - distFromMax) / margin; // negative push
    return 0;
  };

  steer.x = near(position.x, bounds.width);
  steer.y = near(position.y, bounds.height);
  steer.z = near(position.z, bounds.depth);

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

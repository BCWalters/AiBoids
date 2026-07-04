// Minimal 3D vector math helpers used throughout the simulation.
// Vectors are plain {x, y, z} objects (no class) to keep hot-path allocations cheap.
// 2D mode simply keeps z at 0 throughout, so all the general-purpose ops below
// work unchanged for both 2D and 3D simulation modes.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function create(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function magnitude(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function magnitudeSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function normalize(a: Vec3): Vec3 {
  const m = magnitude(a);
  if (m === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / m, y: a.y / m, z: a.z / m };
}

/** Returns a copy of `a` with magnitude clamped to `max`. */
export function limit(a: Vec3, max: number): Vec3 {
  const m = magnitude(a);
  if (m <= max || m === 0) return { x: a.x, y: a.y, z: a.z };
  return scale(a, max / m);
}

/** Sets magnitude of `a` to exactly `len` (direction preserved). */
export function setMagnitude(a: Vec3, len: number): Vec3 {
  return scale(normalize(a), len);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * 2D heading angle (radians), ignoring z. Used by the 2D canvas renderer to
 * rotate a boid's sprite. Not meaningful in 3D — use the velocity vector
 * itself (e.g. via lookAt) for 3D orientation instead.
 */
export function heading2D(a: Vec3): number {
  return Math.atan2(a.y, a.x);
}

export function fromAngle2D(angle: number, len = 1): Vec3 {
  return { x: Math.cos(angle) * len, y: Math.sin(angle) * len, z: 0 };
}

/** Random unit vector, uniformly distributed on the sphere. */
export function randomUnit3D(): Vec3 {
  // Marsaglia method for uniform sampling on a sphere.
  let x1: number, x2: number, s: number;
  do {
    x1 = Math.random() * 2 - 1;
    x2 = Math.random() * 2 - 1;
    s = x1 * x1 + x2 * x2;
  } while (s >= 1);
  const factor = 2 * Math.sqrt(1 - s);
  return { x: x1 * factor, y: x2 * factor, z: 1 - 2 * s };
}

export function distance(a: Vec3, b: Vec3): number {
  return magnitude(sub(a, b));
}

export function distanceSq(a: Vec3, b: Vec3): number {
  return magnitudeSq(sub(a, b));
}

/**
 * Angle (radians, 0..PI) between two vectors, e.g. a heading direction and
 * the direction to a neighbor. Used for the vision-cone check (works for
 * both 2D and 3D since it's based on the dot product, not atan2).
 */
export function angleBetween(a: Vec3, b: Vec3): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma < 1e-9 || mb < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (ma * mb)));
  return Math.acos(cos);
}

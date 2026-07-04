// Minimal 2D vector math helpers used throughout the simulation.
// Vectors are plain {x, y} objects (no class) to keep hot-path allocations cheap.

export interface Vec2 {
  x: number;
  y: number;
}

export function create(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function magnitude(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function magnitudeSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function normalize(a: Vec2): Vec2 {
  const m = magnitude(a);
  if (m === 0) return { x: 0, y: 0 };
  return { x: a.x / m, y: a.y / m };
}

/** Returns a copy of `a` with magnitude clamped to `max`. */
export function limit(a: Vec2, max: number): Vec2 {
  const m = magnitude(a);
  if (m <= max || m === 0) return { x: a.x, y: a.y };
  return scale(a, max / m);
}

/** Sets magnitude of `a` to exactly `len` (direction preserved). */
export function setMagnitude(a: Vec2, len: number): Vec2 {
  return scale(normalize(a), len);
}

export function heading(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function fromAngle(angle: number, len = 1): Vec2 {
  return { x: Math.cos(angle) * len, y: Math.sin(angle) * len };
}

export function distance(a: Vec2, b: Vec2): number {
  return magnitude(sub(a, b));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return magnitudeSq(sub(a, b));
}

/** Smallest signed angle difference (radians) from `a` to `b`, in [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

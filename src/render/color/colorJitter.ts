import * as THREE from 'three';

/**
 * Cheap deterministic pseudo-random hash from an integer id + a small "salt"
 * into [0, 1). Gives each boid a stable (no per-frame flicker) individual
 * color variation derived purely from its id.
 */
export function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const scratchHSL = { h: 0, s: 0, l: 0 };

/**
 * Nudges `target` to a small, stable-per-id HSL jitter around `base`
 * (mutates in place so callers can reuse a scratch Color). Shared by the
 * sparrow "shades of brown" variation and the parrot per-individual jitter.
 */
export function jitterHSL(
  target: THREE.Color,
  base: THREE.Color,
  id: number,
  salt: number,
  hueAmt: number,
  satAmt: number,
  lightAmt: number,
): void {
  base.getHSL(scratchHSL);
  let { h, s, l } = scratchHSL;
  h = (h + (idHash(id, salt) - 0.5) * hueAmt + 1) % 1;
  s = Math.max(0, Math.min(1, s + (idHash(id, salt + 10) - 0.5) * satAmt));
  l = Math.max(0, Math.min(1, l + (idHash(id, salt + 20) - 0.5) * lightAmt));
  target.setHSL(h, s, l);
}

import { describe, expect, it } from 'vitest';

import { createParrotGeometries } from './parrotGeometry';

const PALETTES = ['green-focus', 'scarlet-focus', 'blue-gold-focus'] as const;

/**
 * The eyes are separate disks merged into the body mesh, so nothing about the
 * merge notices when they stop matching the skull they sit on. Every time the
 * head's proportions changed, a hand-set eye offset silently went stale — the
 * disks either floated off the surface or were half-swallowed by it, and the
 * suite stayed green throughout. These assertions compare the eye geometry
 * against the body surface directly so that failure mode is caught.
 */
function eyeVertices(geometry: ReturnType<typeof createParrotGeometries>['body']): {
  eye: number[];
  body: number[];
} {
  const color = geometry.getAttribute('color');
  const eye: number[] = [];
  const body: number[] = [];
  for (let i = 0; i < color.count; i++) {
    // Near-black picks up the lower mandible on some palettes as well as the
    // pupils, so the eye set is narrowed to the two disks below by taking only
    // the outermost vertex — the mandible sits near the midline and never
    // competes for that.
    const isDark = color.getX(i) < 0.06 && color.getY(i) < 0.06 && color.getZ(i) < 0.06;
    if (isDark) eye.push(i);
    else body.push(i);
  }
  return { eye, body };
}

describe('parrot eye seating', () => {
  it.each(PALETTES)('seats the pupils flush against the skull on %s', (palette) => {
    const geometries = createParrotGeometries(9.1, 6.24, palette);
    const position = geometries.body.getAttribute('position');
    const { eye, body } = eyeVertices(geometries.body);
    expect(eye.length).toBeGreaterThan(0);

    let outermost = -Infinity;
    let outermostIndex = -1;
    for (const i of eye) {
      const x = Math.abs(position.getX(i));
      if (x <= outermost) continue;
      outermost = x;
      outermostIndex = i;
    }

    // The skull's half-width right where that outermost eye vertex sits.
    const y = position.getY(outermostIndex);
    const z = position.getZ(outermostIndex);
    let skullHalfWidth = 0;
    for (const i of body) {
      if (Math.abs(position.getY(i) - y) > 0.12) continue;
      if (Math.abs(position.getZ(i) - z) > 0.25) continue;
      skullHalfWidth = Math.max(skullHalfWidth, Math.abs(position.getX(i)));
    }
    expect(skullHalfWidth).toBeGreaterThan(0);

    // Proud enough to be visible, not so proud it reads as a bolted-on disk.
    // Asserted as a fraction of the local half-width so it survives changes to
    // the head's proportions, which is the whole point.
    const proud = (outermost - skullHalfWidth) / skullHalfWidth;
    expect(proud).toBeGreaterThan(-0.02);
    expect(proud).toBeLessThan(0.12);
  });

});

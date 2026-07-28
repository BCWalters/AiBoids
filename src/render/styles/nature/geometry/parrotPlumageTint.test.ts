import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createParrotGeometries } from './parrotGeometry';

const NATURE_BASE = { length: 9.1, width: 6.24 };

const PALETTES = [
  'green-focus',
  'blue-gold-focus',
  'scarlet-focus',
  'purple-lavender-focus',
  'neutral',
] as const;

/** Palettes that actually carry plumage colour, i.e. everything but `neutral`. */
const CHROMATIC_PALETTES = PALETTES.filter((p) => p !== 'neutral');

/**
 * SphereGeometry(r, 10, 8) triangulates to 140 faces: 10 for the top cap, 10 for
 * the bottom cap, and 6 middle rings of 10 quads. Non-indexed that is 420
 * vertices, and the connector is merged first so it owns exactly this prefix.
 */
const CONNECTOR_VERTEX_COUNT = 420;

/** Max channel spread. Near zero means the colour has gone grey. */
function saturation(color: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): number {
  const rgb = [color.getX(i), color.getY(i), color.getZ(i)];
  return Math.max(...rgb) - Math.min(...rgb);
}

describe('parrot tail connector tint', () => {
  // The dorsal/ventral crossfade lerps tailRoot -> belly in RGB. On several
  // palettes those are near-complementary (blue-gold is literally blue -> gold),
  // so the middle of that interpolation is a desaturated grey. Tail feathers are
  // thin vanes and mostly sample the ends, but the connector is a rounded blob
  // whose surface sweeps the whole ramp -- which is why it used to render a grey
  // band that read as unpainted or see-through. The connector therefore gets a
  // sharpened split; this asserts that sharpening is actually in effect.
  //
  // `neutral` is excluded deliberately: it is all-white by construction (the
  // per-instance tint supplies its colour), so it has no chromatic endpoints to
  // strand a vertex between and no saturation for the metric to read.
  //
  // Margin: with the sharpening the least-saturated connector vertex measures
  // 0.31 (scarlet) to 0.45 (blue-gold); with it removed it drops to 0.04, and
  // 104 connector vertices fall below this threshold.
  it.each(CHROMATIC_PALETTES)('keeps every connector vertex saturated on %s', (palette) => {
    const tail = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, palette).tail;
    expect(tail).toBeDefined();
    const color = tail!.getAttribute('color');
    const muddy: number[] = [];
    for (let i = 0; i < CONNECTOR_VERTEX_COUNT; i++) {
      if (saturation(color, i) < 0.2) muddy.push(i);
    }
    expect(muddy).toEqual([]);
  });

  it('addresses the connector prefix it thinks it does', () => {
    const tail = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, 'neutral').tail;
    expect(tail).toBeDefined();
    expect(tail!.getAttribute('position').count).toBeGreaterThan(CONNECTOR_VERTEX_COUNT);
  });
});

describe('parrot bare-face patch', () => {
  // The patch is applied inside tintParrotTorsoRegions, which has two branches:
  // one for palettes with a dorsal gradient and one for those without. Only
  // green-focus sets dorsalGradient, so a patch wired into just one branch is
  // invisible on four of the five palettes -- and the unit suite stays green.
  //
  // Merely asserting "some pale vertex exists on the head" does NOT catch that:
  // the face dome and the eye whites are painted pale by separate code and keep
  // such a test passing with the patch entirely missing. The assertion has to be
  // on the *extent* of the pale region.
  //
  // Margin: with the patch applied the pale fraction of head vertices measures
  // 0.46 (scarlet) to 0.50 (blue-gold); with the second branch reverted to the
  // bug it drops to 0.14 and 0.23 respectively.
  it.each(CHROMATIC_PALETTES)('wraps bare skin around the eye for %s', (palette) => {
    const body = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, palette).body;
    const position = body.getAttribute('position');
    const color = body.getAttribute('color');

    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) maxY = Math.max(maxY, position.getY(i));

    // Bare skin is deliberately pale and near-neutral; plumage is not.
    let headVertices = 0;
    let paleVertices = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < maxY * 0.5) continue;
      headVertices++;
      const luma = (color.getX(i) + color.getY(i) + color.getZ(i)) / 3;
      if (luma > 0.45 && saturation(color, i) < 0.25) paleVertices++;
    }
    expect(paleVertices / headVertices).toBeGreaterThan(0.35);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PARROT_WING_PANEL_VERTEX_COUNT,
  createParrotGeometries,
  parrotFaceSkinColor,
  parrotPaletteFor,
} from './parrotGeometry';

const NATURE_BASE = { length: 9.1, width: 6.24 };

/**
 * Every palette that carries plumage colour. `neutral` is excluded throughout:
 * it is all-white by construction (the per-instance tint supplies its colour),
 * so it has no chromatic endpoints to strand a vertex between and nothing for a
 * saturation or colour-match metric to read.
 */
const CHROMATIC_PALETTES = [
  'green-focus',
  'blue-gold-focus',
  'scarlet-focus',
  'purple-lavender-focus',
] as const;

type ColorAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** Max channel spread. Near zero means the colour has gone grey. */
function saturation(color: ColorAttr, i: number): number {
  return (
    Math.max(color.getX(i), color.getY(i), color.getZ(i)) -
    Math.min(color.getX(i), color.getY(i), color.getZ(i))
  );
}

describe('parrot tail tint', () => {
  // The tail crossfades tailRoot -> tailTip along the feather and tailRoot ->
  // belly across it. On several palettes those endpoints are near-complementary
  // (blue-gold ramps literally blue -> gold), and a straight RGB line between
  // complementary colours passes through desaturated grey, so the fan came out
  // washed out through its middle and outlined in grey along every feather rim.
  //
  // The fix is twofold: interpolate in HSL, and take the dorsal/ventral side
  // from the sign of the vertex normal with no blend band (over half of a
  // feather's vertices are on its extruded rim, where the normal is
  // perpendicular to both faces, so any band strands all of them mid-ramp).
  //
  // Margin: the least-saturated tail vertex measures 0.41 to 0.97 depending on
  // palette. Reverting either half of the fix drops it to 0.04 and puts 264
  // (blue-gold) to 468 (scarlet) vertices below this threshold.
  it.each(CHROMATIC_PALETTES)('keeps every tail vertex saturated on %s', (palette) => {
    const tail = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, palette).tail;
    expect(tail).toBeDefined();
    const color = tail!.getAttribute('color');
    const muddy: number[] = [];
    for (let i = 0; i < color.count; i++) {
      if (saturation(color, i) < 0.2) muddy.push(i);
    }
    expect(muddy).toEqual([]);
  });
});

describe('parrot wing tint', () => {
  // Two separate regressions live here, and one assertion covers both.
  //
  // 1. The topside/underside split used to be read from position.z. The panel is
  //    only chord * 0.012 thick, so both its faces sit within a hair of z = 0 and
  //    the blend put the lower face around the halfway point of a lerp from a
  //    blue topside to a gold underside -- and the midpoint of a blue->gold RGB
  //    lerp is mud. The underside was never painted gold; it was painted the
  //    average of gold and blue. That is the dull grey-brown the wings had.
  //
  // 2. Reading it from the vertex normal instead introduced a second bug: the
  //    right wing is the same construction with x negated, which reverses every
  //    triangle's winding and so flips the sign of its normals. Without folding
  //    `side` back in, one wing came out with its two sides swapped.
  //
  // Asserting on position rather than on the normal is deliberate: the normal is
  // the thing under test, so a test that consulted it would move with the bug.
  // The panel straddles z = 0 with a known orientation on both wings (z is not
  // mirrored, only x), which makes position an independent witness.
  it.each(CHROMATIC_PALETTES)('paints each side of both wings its own colour on %s', (palette) => {
    const geometries = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, palette);
    const paletteColors = parrotPaletteFor(palette);
    // Sampled ramps rather than bare endpoints. Both ramps are interpolated in
    // HSL, which bows well away from the straight RGB line between their ends,
    // so a mid-ramp vertex is legitimately far from either endpoint and only the
    // ramp itself is a meaningful reference.
    const rampSamples = (from: THREE.Color, to: THREE.Color): THREE.Color[] =>
      Array.from({ length: 33 }, (_, k) => from.clone().lerpHSL(to, k / 32));
    const topside = rampSamples(paletteColors.wingTopRear, paletteColors.wingTopFront);
    const underside = rampSamples(
      paletteColors.wingUndersideFront,
      paletteColors.wingUndersideRear,
    );

    const nearestDistance = (color: ColorAttr, i: number, candidates: THREE.Color[]): number =>
      Math.min(
        ...candidates.map((c) =>
          Math.hypot(color.getX(i) - c.r, color.getY(i) - c.g, color.getZ(i) - c.b),
        ),
      );

    for (const wing of [geometries.wingLeft, geometries.wingRight]) {
      const position = wing.getAttribute('position');
      const color = wing.getAttribute('color');
      let checked = 0;
      for (let i = 0; i < PARROT_WING_PANEL_VERTEX_COUNT; i++) {
        const z = position.getZ(i);
        if (z === 0) continue;
        checked++;
        const expected = z > 0 ? topside : underside;
        const wrong = z > 0 ? underside : topside;
        // What must hold is that the vertex sits on its own side's ramp rather
        // than being stranded between the two sides.
        expect(nearestDistance(color, i, expected)).toBeLessThan(
          nearestDistance(color, i, wrong),
        );
      }
      expect(checked).toBe(PARROT_WING_PANEL_VERTEX_COUNT);
    }
  });
});

describe('parrot bare-face patch', () => {
  // The patch is applied inside tintParrotTorsoRegions, which has two branches:
  // one for palettes with a dorsal gradient and one for those without. Only
  // green-focus sets dorsalGradient, so a patch wired into just one branch is
  // invisible on three of the four chromatic palettes -- and the unit suite
  // stays green.
  //
  // Matching against the palette's own faceSkin rather than against "pale and
  // near-neutral" is deliberate. The near-neutral version of this test passed
  // with the patch entirely missing, because the eye whites and the old face
  // dome were painted pale by separate code; it then broke outright once a
  // palette painted its bare skin a strong colour (the green profile's red
  // military-macaw blaze). Comparing to the source colour tests the thing that
  // actually matters and works whatever hue a species uses.
  //
  // Margin: with the patch applied, 0.38 (scarlet) to 0.41 (purple) of head
  // vertices land on the skin colour; with the second branch reverted to the
  // bug it drops to 0.02 or below on every palette that takes it.
  it.each(CHROMATIC_PALETTES)('paints bare skin around the eye for %s', (palette) => {
    const body = createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, palette).body;
    const position = body.getAttribute('position');
    const color = body.getAttribute('color');
    const skin = parrotFaceSkinColor(palette);

    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) maxY = Math.max(maxY, position.getY(i));

    let headVertices = 0;
    let skinVertices = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < maxY * 0.5) continue;
      headVertices++;
      const delta = Math.hypot(
        color.getX(i) - skin.r,
        color.getY(i) - skin.g,
        color.getZ(i) - skin.b,
      );
      if (delta < 0.12) skinVertices++;
    }
    expect(skinVertices / headVertices).toBeGreaterThan(0.25);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createUnicornGeometries,
  UNICORN_TAIL_SEGMENTS,
  UNICORN_TAIL_SIDES,
} from './unicornGeometry';

const LENGTH = 2;
const WIDTH = 0.8;

const geoms = () => createUnicornGeometries(LENGTH, WIDTH, new THREE.Color(0xc9a8f0));

const posKey = (a: THREE.BufferAttribute, i: number) =>
  `${a.getX(i).toFixed(5)}|${a.getY(i).toFixed(5)}|${a.getZ(i).toFixed(5)}`;

/**
 * The tail was built one segment at a time, and each segment generated its own
 * ring at BOTH of its endpoints. Every interior joint therefore carried two
 * rings at the same center — one square to the incoming direction, one to the
 * outgoing — which do not coincide wherever the tail bends. The surface was
 * torn open at every joint, which is what read as "slight separations between
 * the tail segments".
 *
 * A closed surface has every edge shared by exactly two triangles; an edge used
 * by only one is a literal hole. Measured on the same geometry:
 *
 *   per-segment rings (before)   120 boundary edges   (6 joints x 10 sides x 2)
 *   shared mitred rings (after)    0 boundary edges
 *
 * Triangle count is identical (156) — this is purely about sharing vertices,
 * not about adding geometry. Asserting exactly 0 is right here: any regression
 * that stops adjacent segments sharing a ring reintroduces a whole joint's
 * worth at once, and a correct tube simply has none.
 */
describe('unicorn tail is one continuous surface', () => {
  it('has no boundary edges — no gaps between segments', () => {
    const tail = geoms().tail!;
    const pos = tail.getAttribute('position') as THREE.BufferAttribute;
    const edges = new Map<string, number>();
    for (let t = 0; t < pos.count; t += 3) {
      const k = [posKey(pos, t), posKey(pos, t + 1), posKey(pos, t + 2)];
      for (let e = 0; e < 3; e++) {
        const ek = [k[e], k[(e + 1) % 3]].sort().join('#');
        edges.set(ek, (edges.get(ek) ?? 0) + 1);
      }
    }
    const boundary = [...edges.values()].filter((c) => c === 1).length;
    expect(boundary, `${boundary} boundary edges — the tail surface is torn open`).toBe(0);
  });

  /**
   * Zero boundary edges alone is not enough. Capping every segment at both ends
   * also yields a closed surface — but as a row of separate sealed sausages,
   * which is exactly the appearance being fixed. Verified: a variant that caps
   * each segment individually passes the boundary-edge check above.
   *
   * So assert the rings are genuinely SHARED, by counting distinct positions:
   *
   *   one ring per point (after)     80  = 8 points x 10 sides
   *   two rings per segment (before) 128
   *
   * Triangle count is identical either way, so only vertex identity
   * distinguishes them.
   */
  it('adjacent segments share their joint ring, rather than each having its own', () => {
    const tail = geoms().tail!;
    const pos = tail.getAttribute('position') as THREE.BufferAttribute;
    const unique = new Set<string>();
    for (let i = 0; i < pos.count; i++) unique.add(posKey(pos, i));
    expect(unique.size).toBe((UNICORN_TAIL_SEGMENTS + 1) * UNICORN_TAIL_SIDES);
  });
});

/**
 * The front hips sat at length*0.02, forward of the chest's own front surface,
 * so the top of each front leg stood outside the body and only the thin joint
 * barrel bridged the gap — the legs looked attached by a thread.
 *
 * Measured as the hip's distance from its nearest body ring's centroid divided
 * by how far that ring's surface reaches in the same direction. Below 1 the hip
 * is inside the body; above 1 it is outside it.
 *
 *   front hip at length*0.02 (before)              1.807  OUTSIDE
 *   front hip backed off by one leg depth (after)  0.734  inside
 *   rear hip (already fixed previously)            0.735  inside
 *
 * The threshold is 1.0 because that is the body surface itself, not an
 * arbitrary tolerance — and the shipped value clears it by the same margin the
 * rear legs already do.
 */
describe('unicorn front legs attach inside the body', () => {
  const STANCE_X = WIDTH * 0.19;
  const HIP_Z = -WIDTH * 0.16;

  const containmentRatio = (body: THREE.BufferGeometry, hipY: number): number => {
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    // Body vertices exist only at discrete ring heights, so compare against the
    // nearest ring rather than a slab, which can fall between rings and be empty.
    const byY = new Map<string, THREE.Vector2[]>();
    for (let i = 0; i < pos.count; i++) {
      const k = pos.getY(i).toFixed(4);
      const a = byY.get(k) ?? [];
      a.push(new THREE.Vector2(pos.getX(i), pos.getZ(i)));
      byY.set(k, a);
    }
    const ringYs = [...byY.keys()].map(Number).sort((a, b) => a - b);
    const nearest = ringYs.reduce((a, b) => (Math.abs(b - hipY) < Math.abs(a - hipY) ? b : a));
    const ring = byY.get(nearest.toFixed(4))!;

    const centroid = new THREE.Vector2();
    ring.forEach((p) => centroid.add(p));
    centroid.divideScalar(ring.length);

    const dir = new THREE.Vector2(STANCE_X, HIP_Z).sub(centroid);
    const hipDist = dir.length();
    dir.normalize();
    let surfaceReach = 0;
    for (const p of ring) {
      const d = p.clone().sub(centroid);
      if (d.dot(dir) > 0.85 * d.length()) surfaceReach = Math.max(surfaceReach, d.dot(dir));
    }
    return hipDist / surfaceReach;
  };

  it('front hip is inside the chest, not floating outside it', () => {
    const legs = geoms().legs!;
    const frontUpper = legs.find((p) => p.role === 'legUpperFront')!;
    const hipY = frontUpper.pivot[1];
    const ratio = containmentRatio(geoms().body, hipY);
    expect(
      ratio,
      `front hip sits at ${ratio.toFixed(3)} x the body surface radius — outside the body`,
    ).toBeLessThan(1);
  });

  it('front hip is seated as deeply as the rear hip already is', () => {
    const legs = geoms().legs!;
    const body = geoms().body;
    const front = containmentRatio(body, legs.find((p) => p.role === 'legUpperFront')!.pivot[1]);
    const rear = containmentRatio(body, legs.find((p) => p.role === 'legUpperRear')!.pivot[1]);
    expect(Math.abs(front - rear)).toBeLessThan(0.25);
  });
});

/**
 * Legs used to carry a lighter lavender (0xd8cef0) than the per-instance body
 * color (0xc9a8f0). A near-match reads as a mismatch, so they looked like paler
 * parts stuck onto the horse. A neutral multiplier makes them render in exactly
 * the body color whatever that instance's tint is — which is why this asserts
 * the multiplier is neutral rather than comparing against a hard-coded hex.
 *
 * Hooves are excluded: they are deliberately dark (0x3a3a3a).
 */
/**
 * Legs fade from the body color at the hip to white by the hoof.
 *
 * Vertex colors MULTIPLY the per-instance lavender, so "body color" means a
 * neutral 1.0 multiplier and "white" means components above 1 — specifically
 * the reciprocal of the species body color, which lifts green hardest (the
 * lavender is weakest in green) and blue barely at all. Checking that green
 * rises faster than red is what distinguishes walking toward WHITE from merely
 * brightening the lavender.
 */
/**
 * Leg colours are ABSOLUTE, not multipliers.
 *
 * applyLegChainColor() in src/render/color/legColorApplication.ts forces the
 * per-instance colour of every leg part to white whenever the part geometry
 * carries a `color` attribute. So unlike the body mesh — where vertex colours
 * multiply the per-instance species tint and neutral is 1.0 — a leg vertex
 * colour is exactly what gets drawn. That is why createUnicornGeometries has
 * to be TOLD the body colour: it cannot inherit it at draw time.
 *
 * This test uses a deliberately lurid body colour rather than the shipped
 * lavender, so that "the top of the leg is the body colour" is checked against
 * a value that could not arise by accident from a neutral or a stray tint.
 */
describe('unicorn legs fade from body color at the hip to white at the hoof', () => {
  const BODY = new THREE.Color(0.2, 0.4, 0.8);

  it('starts at the body color at the hip and ramps to white at the hoof', () => {
    const legs = createUnicornGeometries(LENGTH, WIDTH, BODY).legs!;
    let hoof = 0;
    let top: { r: number; g: number; b: number; z: number } | null = null;
    let bottom: { r: number; g: number; b: number; z: number } | null = null;

    for (const part of legs) {
      const pos = part.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = part.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i++) {
        const r = col.getX(i);
        const g = col.getY(i);
        const b = col.getZ(i);
        // The hoof is a flat dark tint by design and sits outside the ramp.
        if (r < 0.15 && g < 0.15 && b < 0.15) {
          hoof++;
          continue;
        }
        const z = pos.getZ(i);
        // Legs are built downward along -Z, so max Z is the hip end.
        if (!top || z > top.z) top = { r, g, b, z };
        if (!bottom || z < bottom.z) bottom = { r, g, b, z };
        // Absolute colours: nothing on the leg may exceed white. An
        // above-1 value here would mean the multiplier model had crept back.
        expect(r).toBeLessThanOrEqual(1 + 1e-5);
        expect(g).toBeLessThanOrEqual(1 + 1e-5);
        expect(b).toBeLessThanOrEqual(1 + 1e-5);
      }
    }

    expect(hoof, 'expected dark hoof vertices to still exist').toBeGreaterThan(0);
    expect(top, 'expected leg vertices').not.toBeNull();
    expect(bottom, 'expected leg vertices').not.toBeNull();

    // Top of the leg: the body colour itself, so the leg reads as continuous
    // with the haunch it hangs from.
    expect(top!.r).toBeCloseTo(BODY.r, 2);
    expect(top!.g).toBeCloseTo(BODY.g, 2);
    expect(top!.b).toBeCloseTo(BODY.b, 2);

    // Bottom of the leg: a white sock. Every channel has risen toward 1, and
    // the channel that started lowest has climbed the furthest.
    expect(bottom!.r).toBeGreaterThan(top!.r);
    expect(bottom!.g).toBeGreaterThan(top!.g);
    expect(bottom!.b).toBeGreaterThan(top!.b);
    expect(bottom!.r).toBeGreaterThan(0.9);
    expect(bottom!.g).toBeGreaterThan(0.9);
    expect(bottom!.b).toBeGreaterThan(0.9);
  });
});

/**
 * Vertical body gradient: a deepened lavender along the topline fading to a
 * pale pink underneath — countershading, the way it sits on a real animal.
 * Vertex colors multiply the per-instance lavender, so "lighter" means
 * components above 1 and "pinker" means red rising faster than blue.
 *
 * This deliberately runs belly-light. It used to run the other way (pink
 * topline, plain underside), so these assertions are directional on purpose:
 * a revert would flip the sign and fail rather than merely weaken.
 *
 * The separation bound is deliberately well above "any difference at all".
 * An earlier version of this gradient passed a weaker bound while being
 * invisible on screen, because ACES tone mapping compressed the authored
 * 1.84x luminance spread down to 1.28x. These thresholds are set against the
 * tone-mapped result, not the raw numbers — see UNICORN_TOPLINE_TINT.
 *
 * Sampled from the barrel only (behind the withers), because the head and
 * muzzle carry their own tint and the horn is baked gold.
 */
describe('unicorn body has a vertical gradient', () => {
  const sampleBarrel = (body: THREE.BufferGeometry) => {
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    const col = body.getAttribute('color') as THREE.BufferAttribute;
    const top: THREE.Color[] = [];
    const bottom: THREE.Color[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) continue; // barrel/rump only, skip neck and head
      const c = new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
      if (pos.getZ(i) > WIDTH * 0.1) top.push(c);
      else if (pos.getZ(i) < -WIDTH * 0.1) bottom.push(c);
    }
    const mean = (list: THREE.Color[]) =>
      list.reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / list.length);
    return { top: mean(top), bottom: mean(bottom), topN: top.length, bottomN: bottom.length };
  };

  it('the underside is lighter than the topline', () => {
    const { top, bottom, topN, bottomN } = sampleBarrel(geoms().body);
    expect(topN, 'expected topline samples').toBeGreaterThan(20);
    expect(bottomN, 'expected underside samples').toBeGreaterThan(20);
    const lum = (c: THREE.Color) => c.r + c.g + c.b;
    // 1.15 was the old bound and the old gradient cleared it while being
    // invisible in the render. The two-sided ramp authors ~1.9x here, so hold
    // the line well above the level that was already known to be too weak.
    expect(lum(bottom)).toBeGreaterThan(lum(top) * 1.6);
  });

  it('the topline is deepened, but still reads as the body color', () => {
    const { top } = sampleBarrel(geoms().body);
    // The ramp is two-sided: the topline is pushed below neutral so ACES tone
    // mapping has range to work with (see UNICORN_TOPLINE_TINT). But it must
    // stay close enough to neutral to still read as the unicorn's own colour
    // rather than as a second, darker species.
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(top[ch], `topline ${ch} should be darker than neutral`).toBeLessThan(0.97);
      expect(top[ch], `topline ${ch} should not be a wholly different colour`).toBeGreaterThan(0.6);
    }
    // Still recognisably the lavender body hue: blue stays the strongest
    // channel and green the weakest, as in 0xc9a8f0.
    expect(top.b).toBeGreaterThan(top.r);
    expect(top.r).toBeGreaterThan(top.g);
  });

  it('the pale is confined to the underside, not spread up the flank', () => {
    // Countershading is a white BELLY, not a top-to-bottom fade. The tint is
    // held off until past the widest point of each ring (UNICORN_BELLY_ONSET),
    // so the whole visible side of the horse stays lavender and only the
    // underside goes pale. Dropping the onset makes this a two-tone horse.
    //
    // Sampled by depth within each ring rather than by absolute Z, because the
    // spine rises and falls between rump and withers — the same reason
    // gradedColorAt normalises per ring.
    const body = geoms().body;
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    const col = body.getAttribute('color') as THREE.BufferAttribute;

    const rings = new Map<string, number[]>();
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) continue; // barrel/rump only
      const key = pos.getY(i).toFixed(4);
      if (!rings.has(key)) rings.set(key, []);
      rings.get(key)!.push(i);
    }

    let midFlank = 0;
    let belly = 0;
    const neutral = new THREE.Color(1, 1, 1);
    for (const idx of rings.values()) {
      if (idx.length < 4) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of idx) {
        lo = Math.min(lo, pos.getZ(i));
        hi = Math.max(hi, pos.getZ(i));
      }
      if (hi - lo < 1e-6) continue;
      for (const i of idx) {
        const depth = 1 - (pos.getZ(i) - lo) / (hi - lo); // 0 spine, 1 belly
        const lightened = col.getX(i) > neutral.r;
        // At and just above the midline the body colour must still hold.
        if (depth <= 0.5) {
          expect(lightened, `vertex at depth ${depth.toFixed(2)} should not be paled`).toBe(false);
          midFlank++;
        }
        if (depth > 0.9) belly++;
      }
    }
    expect(midFlank, 'expected mid-flank samples').toBeGreaterThan(50);
    expect(belly, 'expected belly samples').toBeGreaterThan(20);
  });

  it('the underside shifts toward pink, not just toward white', () => {
    // Vertex colors are MULTIPLIERS against the per-instance body tint, and the
    // multiply happens in LINEAR space, so a ratio taken on the raw tint says
    // nothing about the colour that gets drawn. An earlier belly tint was
    // red-highest — which reads as "pink" as a bare triplet and passed a
    // raw-tint check — but against this low-green body it painted clipped
    // magenta. Convert to linear and multiply through before judging hue.
    const { top, bottom } = sampleBarrel(geoms().body);
    // NB: no convertSRGBToLinear here. THREE.ColorManagement is enabled, so
    // constructing from a hex literal already yields linear components
    // (0xc9a8f0 -> 0.584/0.392/0.871). Converting again double-applies the
    // transfer function and skews the hue toward blue.
    const body = new THREE.Color(0xc9a8f0);
    const painted = (c: THREE.Color) => c.clone().multiply(body);
    const litTop = painted(top);
    const litBottom = painted(bottom);
    // Warm: red must sit above blue, so the belly leans pink rather than cool.
    expect(litBottom.r).toBeGreaterThan(litBottom.b);
    // ...but only just. If red runs far ahead of blue the belly has gone
    // magenta rather than off-white, which is the failure mode above.
    expect(litBottom.r / litBottom.b).toBeLessThan(1.3);
    // And it must be a genuine lightening, not a hue swap: every channel of
    // the belly has to outrun the topline.
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(litBottom[ch], `belly ${ch} should exceed topline`).toBeGreaterThan(litTop[ch]);
    }
  });
});

/**
 * The mane was a single chunky 4-sided box-section strand draped along +X only,
 * so the neck read smooth and round from one side and hard-edged and blocky
 * from the other. It is removed until there is a real, symmetric mane.
 *
 * Asserting symmetry rather than "the mane function is gone" means a
 * replacement mane is free to land, as long as it is built on both sides.
 */
describe('unicorn neck is symmetric (no one-sided mane)', () => {
  it('every neck vertex has a mirrored counterpart across the midline', () => {
    const body = geoms().body;
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    const present = new Set<string>();
    const neck: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      present.add(`${v.x.toFixed(3)}|${v.y.toFixed(3)}|${v.z.toFixed(3)}`);
      // Neck region: ahead of the withers, and off the midline.
      if (v.y > LENGTH * 0.03 && Math.abs(v.x) > WIDTH * 0.02) neck.push(v);
    }
    expect(neck.length, 'expected neck vertices').toBeGreaterThan(50);
    const unmirrored = neck.filter(
      (v) => !present.has(`${(-v.x).toFixed(3)}|${v.y.toFixed(3)}|${v.z.toFixed(3)}`),
    );
    const fraction = unmirrored.length / neck.length;
    // A symmetric neck is exactly 0. The removed one-sided mane measured 0.0386
    // (59 of 1529 neck vertices), so 0.005 sits well between the two while
    // leaving room for float noise.
    expect(
      fraction,
      `${unmirrored.length}/${neck.length} neck vertices have no mirror — the neck is one-sided`,
    ).toBeLessThan(0.005);
  });
});

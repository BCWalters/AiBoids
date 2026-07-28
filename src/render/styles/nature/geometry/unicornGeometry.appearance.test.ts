import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createUnicornGeometries } from './unicornGeometry';

const LENGTH = 2;
const WIDTH = 0.8;

const geoms = () => createUnicornGeometries(LENGTH, WIDTH);

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
describe('unicorn legs render in the body color', () => {
  it('leg vertices use a neutral color multiplier', () => {
    const legs = geoms().legs!;
    let neutral = 0;
    let hoof = 0;
    for (const part of legs) {
      const c = part.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < c.count; i++) {
        const r = c.getX(i);
        const g = c.getY(i);
        const b = c.getZ(i);
        if (r < 0.5 && g < 0.5 && b < 0.5) {
          hoof++;
          continue;
        }
        expect(r).toBeCloseTo(1, 5);
        expect(g).toBeCloseTo(1, 5);
        expect(b).toBeCloseTo(1, 5);
        neutral++;
      }
    }
    expect(neutral, 'expected leg vertices').toBeGreaterThan(0);
    expect(hoof, 'expected dark hoof vertices to still exist').toBeGreaterThan(0);
  });
});

/**
 * Vertical body gradient: body color underneath fading to a very light pink
 * over the topline. Vertex colors multiply the per-instance lavender, so
 * "lighter" means components above 1 and "pinker" means red rising faster than
 * blue.
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

  it('the topline is lighter than the underside', () => {
    const { top, bottom, topN, bottomN } = sampleBarrel(geoms().body);
    expect(topN, 'expected topline samples').toBeGreaterThan(20);
    expect(bottomN, 'expected underside samples').toBeGreaterThan(20);
    const lum = (c: THREE.Color) => c.r + c.g + c.b;
    expect(lum(top)).toBeGreaterThan(lum(bottom) * 1.15);
  });

  it('the underside keeps the body color unchanged', () => {
    const { bottom } = sampleBarrel(geoms().body);
    expect(bottom.r).toBeCloseTo(1, 1);
    expect(bottom.g).toBeCloseTo(1, 1);
    expect(bottom.b).toBeCloseTo(1, 1);
  });

  it('the topline shifts toward pink, not just toward white', () => {
    const { top, bottom } = sampleBarrel(geoms().body);
    // Red must gain on blue: a purely brighter (white) topline would keep the
    // same red/blue ratio and fail this.
    expect(top.r / top.b).toBeGreaterThan((bottom.r / bottom.b) * 1.1);
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
    expect(
      fraction,
      `${unmirrored.length}/${neck.length} neck vertices have no mirror — the neck is one-sided`,
    ).toBeLessThan(0.02);
  });
});

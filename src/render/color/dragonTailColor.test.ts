import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from '../styles/nature/geometry/dragonGeometry';
import { DragonColorApplicator } from './dragonColorApplication';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';
import type { Boid } from '../../sim/Boid';

/**
 * The dragon's tail must start at exactly the body's current color and darken
 * from there.
 *
 * The bug this guards: the tail baked ABSOLUTE colors (root 0x502a7f, tip
 * 0x080314) and the color applicator handed it white so that gradient showed
 * through untouched. But the body's instance color is not fixed — it lerps
 * from DRAGON_PREDATOR_BASE toward the brighter DRAGON_PREDATOR_HUNT as the
 * dragon chases. So body and tail agreed only at rest, and the instant the
 * body brightened, the tail stayed behind and a seam opened at the joint.
 *
 * The fix has two halves and BOTH must hold, so both are asserted here:
 *   - the geometry bakes a MULTIPLIER (1 at the root, dark at the tip), and
 *   - the applicator passes the body's state color rather than white.
 *
 * Either half alone still leaves body and tail mismatched.
 */
describe('dragon tail color tracks the body color', () => {
  const LENGTH = 2;
  const WIDTH = 0.8;

  const tailGeometry = () => {
    const geometries = createDragonGeometries(LENGTH, WIDTH);
    const tail = geometries.tail;
    if (!tail) throw new Error('dragon geometries have no tail');
    return tail;
  };

  /** Root/tip are along -Y: the root is at max Y, the tip at min Y. */
  const rootAndTipColors = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(col).toBeTruthy();

    let rootIdx = 0;
    let tipIdx = 0;
    for (let i = 1; i < pos.count; i++) {
      if (pos.getY(i) > pos.getY(rootIdx)) rootIdx = i;
      if (pos.getY(i) < pos.getY(tipIdx)) tipIdx = i;
    }
    return {
      root: new THREE.Color(col.getX(rootIdx), col.getY(rootIdx), col.getZ(rootIdx)),
      tip: new THREE.Color(col.getX(tipIdx), col.getY(tipIdx), col.getZ(tipIdx)),
    };
  };

  it('bakes a neutral multiplier at the root so the tail starts on the body color', () => {
    const { root } = rootAndTipColors(tailGeometry());

    // Exactly 1 on every channel: anything else tints the joint away from the
    // body color. This is the assertion the absolute-color version failed.
    expect(root.r).toBeCloseTo(1, 5);
    expect(root.g).toBeCloseTo(1, 5);
    expect(root.b).toBeCloseTo(1, 5);
  });

  it('gives the tail the same instance color as the body, including the hunt tint', () => {
    const recorded = new Map<string, THREE.Color>();
    const part = (name: string) => ({
      geometry: tailGeometry(),
      setColorAt: (_i: number, c: THREE.Color) => recorded.set(name, c.clone()),
    });

    const set = {
      body: part('body'),
      wingLeft: part('wingLeft'),
      wingRight: part('wingRight'),
      tail: part('tail'),
    };

    const base = new THREE.Color(0x502a7f);
    const hunt = new THREE.Color(0x7b4fc2);

    // Mid-hunt is the case the old code got wrong: the body brightens toward
    // the hunt tint while a white-passthrough tail stays at its baked palette.
    const args = {
      set,
      index: 0,
      creature: {} as Boid,
      baseColor: base,
      highlightColor: hunt,
      getIntensity: () => 0.5,
    } as unknown as CreatureInstanceColorArgs;

    new DragonColorApplicator().apply(args);

    const body = recorded.get('body');
    const tail = recorded.get('tail');
    expect(body).toBeTruthy();
    expect(tail).toBeTruthy();

    expect(tail!.r).toBeCloseTo(body!.r, 6);
    expect(tail!.g).toBeCloseTo(body!.g, 6);
    expect(tail!.b).toBeCloseTo(body!.b, 6);

    // Guard the premise: the body really did move off its base color here, so
    // this test would actually notice a tail pinned to a fixed palette.
    expect(body!.r).not.toBeCloseTo(base.r, 3);
  });
});

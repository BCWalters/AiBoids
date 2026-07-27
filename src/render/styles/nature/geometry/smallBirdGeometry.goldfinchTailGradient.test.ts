import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRealisticBirdGeometries, type SmallBirdPalette } from './smallBirdGeometry';
import { GOLDFINCH_NATURE_PALETTE } from '../../../sceneRenderers/NatureSceneRenderer3D';

const LENGTH = 1.0;
const WIDTH = 0.5;
const BACK_PLUMAGE_AT_TAIL = new THREE.Color(0x1c1c1c);
const TAIL_TIP_BLACK = new THREE.Color(0x000000);

const GOLDFINCH_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xf5d327),
  tailBack:  BACK_PLUMAGE_AT_TAIL,
  headBelly: new THREE.Color(0xf5d327),
  tailBelly: new THREE.Color(0xf8ec80),
  wing:      new THREE.Color(0xf5d327),
  wingTip:   new THREE.Color(0x151505),
  tail:      new THREE.Color(0x3a3a3a),
  tailTip:   TAIL_TIP_BLACK,
  dorsalGradient: true,
  wingGradient: true,
  tailGradient: true,
  tailGradientRootColor: BACK_PLUMAGE_AT_TAIL,
  tailGradientInterpolation: 'hsl',
  tailGradientRootHold: 0.08,
};

describe('small-bird goldfinch tail gradient', () => {
  it('matches back plumage at the root and reaches black at the rearmost tip', () => {
    const geoms = createRealisticBirdGeometries(LENGTH, WIDTH, new THREE.Color(0x888888), GOLDFINCH_PALETTE);
    const tail = geoms.tail!;
    tail.computeBoundingBox();
    const rootY = tail.boundingBox!.max.y;
    const tipY = tail.boundingBox!.min.y;

    const pos = tail.getAttribute('position') as THREE.BufferAttribute;
    const color = tail.getAttribute('color') as THREE.BufferAttribute;
    let rootCount = 0;
    let tipCount = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (Math.abs(y - rootY) < 1e-5) {
        rootCount++;
        expect(color.getX(i)).toBeCloseTo(BACK_PLUMAGE_AT_TAIL.r, 4);
        expect(color.getY(i)).toBeCloseTo(BACK_PLUMAGE_AT_TAIL.g, 4);
        expect(color.getZ(i)).toBeCloseTo(BACK_PLUMAGE_AT_TAIL.b, 4);
      }
      if (Math.abs(y - tipY) < 1e-5) {
        tipCount++;
        expect(color.getX(i)).toBeCloseTo(TAIL_TIP_BLACK.r, 4);
        expect(color.getY(i)).toBeCloseTo(TAIL_TIP_BLACK.g, 4);
        expect(color.getZ(i)).toBeCloseTo(TAIL_TIP_BLACK.b, 4);
      }
    }
    expect(rootCount).toBeGreaterThan(0);
    expect(tipCount).toBeGreaterThan(0);
  });

  // The test above uses a local palette copy, so it only proves buildTailGeometry
  // honours the options - it would keep passing if the real goldfinch config lost
  // them. Bind the assertions to the shipped palette so the feature can't rot into
  // dead config the way the bird tail sway amplitudes did (#210).
  it('ships a goldfinch palette whose tail root matches its own back plumage', () => {
    const p = GOLDFINCH_NATURE_PALETTE;
    expect(p.tailGradient).toBe(true);
    expect(p.tailGradientRootColor).toBeDefined();
    expect(p.tailGradientRootColor!.getHex()).toBe(p.tailBack.getHex());
    expect(p.tailTip.getHex()).toBe(0x000000);
  });
});

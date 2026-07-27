import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries, dragonTailRootY, dragonTailRootZ } from './dragonGeometry';

const LENGTH = 2.0;
const WIDTH = 0.8;

describe('dragon rear cap', () => {
  it('has no open boundary at the rump (cap centre vertex present)', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const bb = body.boundingBox!;
    const minY = bb.min.y;
    const yRange = bb.max.y - bb.min.y;
    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;

    let foundCapCentreVertex = false;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y < minY + yRange * 0.08) {
        if (Math.abs(posAttr.getX(i)) < 1e-4 && Math.abs(posAttr.getZ(i)) < 1e-4) {
          foundCapCentreVertex = true;
          break;
        }
      }
    }

    expect(foundCapCentreVertex).toBe(true);
  });

  it('keeps dragon tail root offsets stable for a given length', () => {
    expect(dragonTailRootY(17.3)).toBeCloseTo(-4.325);
    expect(dragonTailRootZ(17.3)).toBeCloseTo(0.346);
  });

  it('uses a rear cap large enough to contain the tail root envelope at max sway', () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    const body = geoms.body;
    body.computeBoundingBox();
    const minY = body.boundingBox!.min.y;
    const posAttr = body.getAttribute('position') as THREE.BufferAttribute;

    let capMaxZ = 0;
    for (let i = 0; i < posAttr.count; i++) {
      if (Math.abs(posAttr.getY(i) - minY) < 1e-4) {
        capMaxZ = Math.max(capMaxZ, posAttr.getZ(i));
      }
    }

    const tailRootRadius = WIDTH * 0.255;
    // Sway rotates about the root attachment point, so the root section always
    // remains inside this sphere envelope in world space, even at max angle.
    const rootEnvelopeZ = dragonTailRootZ(LENGTH) + tailRootRadius;
    expect(capMaxZ).toBeGreaterThan(rootEnvelopeZ);
  });
});

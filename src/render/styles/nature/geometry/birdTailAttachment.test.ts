import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildTailGeometry,
  getBirdBodyRearTipY,
  getBirdTailFanProfileY,
} from './birdSharedGeometry';

function maxFlankY(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    if (Math.abs(pos.getX(i)) <= 1e-4) continue;
    maxY = Math.max(maxY, pos.getY(i));
  }
  return maxY;
}

describe('bird tail fan attachment', () => {
  it('small-bird fan profile starts at the same rear Y as the body', () => {
    const length = 2.2;
    const rearY = getBirdBodyRearTipY(length);
    const profile = getBirdTailFanProfileY(length);
    expect(profile.rootY).toBeCloseTo(rearY);
    expect(profile.sideTipY).toBeLessThanOrEqual(rearY);
  });

  it('small-bird fan does not widen ahead of the body rear', () => {
    const length = 2.2;
    const rearY = getBirdBodyRearTipY(length);
    const tail = buildTailGeometry(length, 1);
    expect(maxFlankY(tail)).toBeLessThanOrEqual(rearY + 1e-3);
  });

  it('hawk fan does not widen ahead of the body rear', () => {
    const bodyLength = 3.2;
    const tailLength = bodyLength * 1.1;
    const rearY = getBirdBodyRearTipY(bodyLength);
    const tail = buildTailGeometry(tailLength, 1, { halfWidth: 0.9, bodyLength });
    expect(maxFlankY(tail)).toBeLessThanOrEqual(rearY + 1e-3);
  });
});

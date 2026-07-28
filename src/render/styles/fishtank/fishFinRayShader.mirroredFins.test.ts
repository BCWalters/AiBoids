import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGoldfishGeometries } from './geometry/smallFishGeometry';
import {
  applyFishFinRayShader,
  BONY_FISH_FIN_RAY_CONFIG,
  PECTORAL_FIN_FRAME,
} from './fishFinRayShader';

/**
 * The left and right pectoral fins are mirror images driven by a SINGLE shared
 * FinRayFrame, and they span opposite directions from a common seam at x = 0
 * (left runs 0 -> +span, right runs -span -> 0).
 *
 * The frame used to declare a fixed `spanSign: 1`, so the right fin's root was
 * taken at x = -span -- its outer TIP rather than the body seam. The ray fan was
 * then struck from the wrong end: rays converged at the fin's outer edge and the
 * root fade erased them where they meet the body, which is the opposite of the
 * intended "converge at the seam, spread toward the edge" reading.
 *
 * The root is now detected as whichever end of the span axis lies nearer the
 * model origin. This test pins that both fins resolve to the SAME seam, which is
 * the property a hard-coded direction cannot have.
 */
function rayUniforms(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshStandardMaterial();
  applyFishFinRayShader(material, geometry, BONY_FISH_FIN_RAY_CONFIG, PECTORAL_FIN_FRAME);
  const shader = {
    vertexShader: '#include <color_vertex>',
    fragmentShader: '#include <color_fragment>',
    uniforms: {} as Record<string, { value: number }>,
  };
  material.onBeforeCompile!(shader as never, null as never);
  return shader.uniforms;
}

describe('mirrored pectoral fins', () => {
  it('roots both fins at the body seam, not at either outer tip', () => {
    const { wingLeft, wingRight } = createGoldfishGeometries(3, 1.2);

    const spanRange = (geometry: THREE.BufferGeometry) => {
      const pos = geometry.getAttribute('position');
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        min = Math.min(min, pos.getX(i));
        max = Math.max(max, pos.getX(i));
      }
      return { min, max };
    };

    // Guard the premise: these fins must actually be mirrored, or the test
    // below would pass trivially.
    const left = spanRange(wingLeft);
    const right = spanRange(wingRight);
    expect(left.max).toBeGreaterThan(0);
    expect(right.min).toBeLessThan(0);

    const leftRoot = rayUniforms(wingLeft).uFinRayRootSpan.value;
    const rightRoot = rayUniforms(wingRight).uFinRayRootSpan.value;

    // Both fins attach at the same seam.
    expect(leftRoot).toBeCloseTo(rightRoot, 6);
    // ...and that seam is the body wall, not an outer tip.
    expect(Math.abs(leftRoot)).toBeLessThan(Math.abs(left.max));
    expect(Math.abs(rightRoot)).toBeLessThan(Math.abs(right.min));
  });

  it('gives both fins the same angular fan, so neither renders inverted', () => {
    const { wingLeft, wingRight } = createGoldfishGeometries(3, 1.2);
    const left = rayUniforms(wingLeft);
    const right = rayUniforms(wingRight);

    expect(right.uFinRayFreq.value).toBeCloseTo(left.uFinRayFreq.value, 6);
    expect(right.uFinRaySpanExtent.value).toBeCloseTo(left.uFinRaySpanExtent.value, 6);
  });
});

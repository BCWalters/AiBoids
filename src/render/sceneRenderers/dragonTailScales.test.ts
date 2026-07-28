import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDragonGeometries } from '../styles/nature/geometry/dragonGeometry';
import { applyDragonScaleShader, DRAGON_SCALE_CONFIG } from '../styles/nature/dragonScaleShader';

/**
 * The dragon's scale texture has to cover the tail as well as the body.
 *
 * Two things make this non-obvious:
 *
 *  1. The tail does NOT share the body's material. Renderer3D clones the WING
 *     material for it, so patchBodyMaterial never reaches it — hence the
 *     separate patchTailMaterial hook.
 *
 *  2. The shader derives its cell size from the geometry's Z span, and the two
 *     geometries have very different spans (measured at LENGTH=2, WIDTH=0.8):
 *
 *       body zSpan  0.672
 *       tail zSpan  1.490   (2.2x the body)
 *
 *     because the tail sweeps far in Z while the body is a slim tube. Passing
 *     the tail its own geometry would therefore render its scales 2.2x
 *     oversized, with the mismatch landing right at the joint — the most
 *     visible spot possible. The body geometry must be passed for both.
 */
describe('dragon tail carries the same scale texture as the body', () => {
  const captureFreq = (material: THREE.MeshStandardMaterial): number => {
    const shader = {
      vertexShader: 'void main() {\n#include <color_vertex>\n}',
      fragmentShader: 'void main() {\n#include <roughnessmap_fragment>\n}',
      uniforms: {} as Record<string, { value: number }>,
    };
    material.onBeforeCompile!(shader as never, null as never);
    return shader.uniforms.uDragonScaleFreq.value;
  };

  const patched = (geometryForFrequency: THREE.BufferGeometry): number => {
    const mat = new THREE.MeshStandardMaterial();
    applyDragonScaleShader(mat, geometryForFrequency, DRAGON_SCALE_CONFIG);
    return captureFreq(mat);
  };

  it('the tail geometry span really does differ enough to matter', () => {
    const geoms = createDragonGeometries(2, 0.8);
    geoms.body.computeBoundingBox();
    geoms.tail!.computeBoundingBox();
    const bodySpan = geoms.body.boundingBox!.max.z - geoms.body.boundingBox!.min.z;
    const tailSpan = geoms.tail!.boundingBox!.max.z - geoms.tail!.boundingBox!.min.z;
    // Guards the premise of the test below: if these ever converge, the
    // body-vs-tail distinction stops being observable and the assertion that
    // the correct geometry is used would quietly become vacuous.
    expect(tailSpan / bodySpan).toBeGreaterThan(1.5);
  });

  it('patching with the tail geometry would oversize its scales', () => {
    const geoms = createDragonGeometries(2, 0.8);
    const fromBody = patched(geoms.body);
    const fromTail = patched(geoms.tail!);
    // Lower frequency = larger cells.
    expect(fromBody / fromTail).toBeGreaterThan(1.5);
  });
});

/**
 * The hook itself: the nature scene must patch the tail material, and must do
 * it with the body's frequency so body and tail agree.
 */
describe('NatureSceneRenderer3D patches the dragon tail material', () => {
  it('exposes patchTailMaterial alongside patchBodyMaterial', async () => {
    const { NatureSceneRenderer3D } = await import('./NatureSceneRenderer3D');
    expect(typeof NatureSceneRenderer3D.prototype.patchTailMaterial).toBe('function');
    expect(typeof NatureSceneRenderer3D.prototype.patchBodyMaterial).toBe('function');
  });

  it('patchTailMaterial uses the body frequency, not the tail geometry', async () => {
    const { NatureSceneRenderer3D } = await import('./NatureSceneRenderer3D');
    const geoms = createDragonGeometries(2, 0.8);
    // The renderer identity-matches against its own cached dragon geometries,
    // so stand in a minimal instance carrying exactly that field.
    const fake = { dragonPredatorGeometries: geoms } as unknown as InstanceType<
      typeof NatureSceneRenderer3D
    >;

    const bodyMat = new THREE.MeshStandardMaterial();
    const tailMat = new THREE.MeshStandardMaterial();
    NatureSceneRenderer3D.prototype.patchBodyMaterial.call(fake, bodyMat, geoms);
    NatureSceneRenderer3D.prototype.patchTailMaterial.call(fake, tailMat, geoms);

    // MeshStandardMaterial ships a no-op onBeforeCompile, so its presence
    // proves nothing. The shader's own cache key is the reliable marker.
    expect(
      tailMat.customProgramCacheKey?.() ?? '',
      'tail material was never patched',
    ).toContain('aiboids-dragon-scale');

    const captureFreq = (material: THREE.MeshStandardMaterial): number => {
      const shader = {
        vertexShader: 'void main() {\n#include <color_vertex>\n}',
        fragmentShader: 'void main() {\n#include <roughnessmap_fragment>\n}',
        uniforms: {} as Record<string, { value: number }>,
      };
      material.onBeforeCompile!(shader as never, null as never);
      return shader.uniforms.uDragonScaleFreq.value;
    };

    // Identical frequency is the whole point: same cell size across the joint.
    expect(captureFreq(tailMat)).toBeCloseTo(captureFreq(bodyMat), 6);
  });

  it('leaves non-dragon creatures untouched', async () => {
    const { NatureSceneRenderer3D } = await import('./NatureSceneRenderer3D');
    const geoms = createDragonGeometries(2, 0.8);
    const other = createDragonGeometries(3, 1.0);
    const fake = { dragonPredatorGeometries: geoms } as unknown as InstanceType<
      typeof NatureSceneRenderer3D
    >;
    const mat = new THREE.MeshStandardMaterial();
    NatureSceneRenderer3D.prototype.patchTailMaterial.call(fake, mat, other);
    expect(mat.customProgramCacheKey?.() ?? '').not.toContain('aiboids-dragon-scale');
  });
});

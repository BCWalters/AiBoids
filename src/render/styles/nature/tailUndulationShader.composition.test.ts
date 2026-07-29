/**
 * Tests for applyTailUndulationShader — concern: surviving composition.
 *
 * Bird tails now carry two patches on one material: the feather shader (applied
 * by the scene's patchTailMaterial hook) and this undulation. Both use
 * String.replace against a named chunk, and the failure mode when two patches
 * want the same chunk is silent — the second replace finds nothing, no-ops, and
 * the material still compiles and renders, just without the effect.
 *
 * These tests are falsifiable: change the injection anchor or drop the chunk
 * from the replacement string and they fail with an obvious message.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyTailUndulationShader, type TailUndulationConfig } from './tailUndulationShader';

const CONFIG: TailUndulationConfig = {
  upBiasFraction: 0.1,
  amplitudeFraction: 0.05,
  verticalAmplitudeFraction: 0.12,
  tipPhaseLagRad: Math.PI * 0.5,
  omega: 2.0,
};

function makeTailMesh(): THREE.InstancedMesh {
  // Sweeps along Y, which is the root-to-tip convention the shader relies on.
  const geo = new THREE.BoxGeometry(0.4, 2.0, 0.02);
  return new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 4);
}

function compile(mesh: THREE.InstancedMesh, vertexShader: string) {
  const shader = { vertexShader, uniforms: {} as Record<string, { value: number }> };
  (mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as never, null as never);
  return shader;
}

describe('applyTailUndulationShader', () => {
  it('injects the displacement GLSL and its uniforms', () => {
    const tail = makeTailMesh();
    applyTailUndulationShader({ tailMesh: tail, config: CONFIG });

    const shader = compile(tail, '#include <begin_vertex>');

    expect(shader.vertexShader).toContain('tailUndulationPhase');
    expect(shader.vertexShader).toContain('transformed.z +=');
    expect(shader.vertexShader).toContain('transformed.x +=');
    expect(shader.uniforms['uTailWaveNumber'].value).toBeCloseTo(Math.PI * 0.5, 4);
  });

  it('displaces after begin_vertex, which is what defines `transformed`', () => {
    // Injecting before the chunk would write to a variable that does not exist
    // yet; the chunk must also survive so a later patch can still anchor on it.
    const tail = makeTailMesh();
    applyTailUndulationShader({ tailMesh: tail, config: CONFIG });

    const shader = compile(tail, '#include <begin_vertex>');

    const chunkAt = shader.vertexShader.indexOf('#include <begin_vertex>');
    expect(chunkAt).toBeGreaterThanOrEqual(0);
    expect(shader.vertexShader.indexOf('transformed.z +=')).toBeGreaterThan(chunkAt);
  });

  it('still injects when an earlier patch has already rewritten the vertex shader', () => {
    // Stands in for the bird feather shader, which prepends declarations and
    // injects at color_vertex. If this shader ever moved to begin_vertex, the
    // undulation would silently vanish from every bird tail.
    const tail = makeTailMesh();
    applyTailUndulationShader({ tailMesh: tail, config: CONFIG });

    const shader = compile(
      tail,
      'varying vec3 vBirdFeatherPos;\n#include <color_vertex>\n#include <begin_vertex>',
    );

    expect(shader.vertexShader).toContain('vBirdFeatherPos');
    expect(shader.vertexShader).toContain('transformed.z +=');
  });

  it('scales displacement by the tail span, so short bird tails stay subtle', () => {
    const shortTail = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.5, 0.02),
      new THREE.MeshStandardMaterial(),
      4,
    );
    applyTailUndulationShader({ tailMesh: shortTail, config: CONFIG });
    const short = compile(shortTail, '#include <begin_vertex>');

    const longTail = makeTailMesh();
    applyTailUndulationShader({ tailMesh: longTail, config: CONFIG });
    const long = compile(longTail, '#include <begin_vertex>');

    expect(short.uniforms['uTailVerticalAmplitude'].value).toBeLessThan(
      long.uniforms['uTailVerticalAmplitude'].value,
    );
  });

  it('gives configs that differ only in amplitude distinct cache keys', () => {
    const a = makeTailMesh();
    const b = makeTailMesh();
    applyTailUndulationShader({ tailMesh: a, config: CONFIG });
    applyTailUndulationShader({
      tailMesh: b,
      config: { ...CONFIG, verticalAmplitudeFraction: 0.3 },
    });

    const keyA = (a.material as THREE.MeshStandardMaterial).customProgramCacheKey?.() ?? '';
    const keyB = (b.material as THREE.MeshStandardMaterial).customProgramCacheKey?.() ?? '';
    expect(keyA).toContain('aiboids-tail-undulation-v4');
    expect(keyA).not.toEqual(keyB);
  });
});

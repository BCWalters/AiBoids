/**
 * Tests for applyWingUndulationShader — concern: silent failures from the
 * THREE.Material.clone() trap (dropping onBeforeCompile / customProgramCacheKey).
 *
 * Each test is falsifiable: comment out the corresponding production code path
 * and the test will fail with a message that makes the bug obvious.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyWingUndulationShader, type WingUndulationConfig } from './wingUndulationShader';

const BASE_CONFIG: WingUndulationConfig = {
  amplitudeFraction: 0.06,
  tipPhaseLagRad: Math.PI * 0.6,
};

function makeWingMesh(xSpan = 1.0): THREE.InstancedMesh {
  // A simple flat panel geometry; bounding box has x-extent ±xSpan/2
  const geo = new THREE.BoxGeometry(xSpan, 0.1, 0.01);
  return new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 4);
}

describe('applyWingUndulationShader — cache-key integrity', () => {
  it('customProgramCacheKey includes the undulation key so three.js never reuses a stale compiled program', () => {
    const left = makeWingMesh(2.0);
    const right = makeWingMesh(2.0);
    applyWingUndulationShader({ wingLeft: left, wingRight: right, config: BASE_CONFIG });

    const leftKey = (left.material as THREE.MeshStandardMaterial).customProgramCacheKey?.();
    const rightKey = (right.material as THREE.MeshStandardMaterial).customProgramCacheKey?.();
    expect(leftKey).toBeTruthy();
    expect(rightKey).toBeTruthy();
    // Both keys must contain the undulation sentinel so a different amplitude
    // produces a different cache key, preventing stale-shader reuse.
    expect(leftKey).toContain('aiboids-wing-undulation-v1');
    expect(rightKey).toContain('aiboids-wing-undulation-v1');
  });

  it('customProgramCacheKey is distinct when config amplitude differs, guarding against program cache collisions', () => {
    const leftA = makeWingMesh(2.0);
    const rightA = makeWingMesh(2.0);
    const leftB = makeWingMesh(2.0);
    const rightB = makeWingMesh(2.0);

    applyWingUndulationShader({
      wingLeft: leftA,
      wingRight: rightA,
      config: { amplitudeFraction: 0.06, tipPhaseLagRad: Math.PI * 0.6 },
    });
    applyWingUndulationShader({
      wingLeft: leftB,
      wingRight: rightB,
      config: { amplitudeFraction: 0.12, tipPhaseLagRad: Math.PI * 0.6 },
    });

    const keyA = (leftA.material as THREE.MeshStandardMaterial).customProgramCacheKey?.() ?? '';
    const keyB = (leftB.material as THREE.MeshStandardMaterial).customProgramCacheKey?.() ?? '';
    expect(keyA).not.toEqual(keyB);
  });

  it('injects wingUndulationPhase attribute and wing-undulation GLSL into the vertex shader', () => {
    const left = makeWingMesh(2.0);
    const right = makeWingMesh(2.0);
    applyWingUndulationShader({ wingLeft: left, wingRight: right, config: BASE_CONFIG });

    const shader = {
      vertexShader: '#include <begin_vertex>',
      uniforms: {} as Record<string, { value: number }>,
    };
    (left.material as THREE.MeshStandardMaterial).onBeforeCompile(shader as any, null as any);

    expect(shader.vertexShader).toContain('wingUndulationPhase');
    expect(shader.vertexShader).toContain('uWingSpan');
    expect(shader.vertexShader).toContain('transformed.z +=');
    expect(shader.uniforms['uWingUndulationAmplitude']).toBeDefined();
    expect(shader.uniforms['uWingUndulationWaveNumber'].value).toBeCloseTo(Math.PI * 0.6, 4);
  });

  it('both wing meshes share the same phase attribute buffer', () => {
    const left = makeWingMesh(2.0);
    const right = makeWingMesh(2.0);
    const state = applyWingUndulationShader({ wingLeft: left, wingRight: right, config: BASE_CONFIG });

    const leftPhase = left.geometry.getAttribute('wingUndulationPhase');
    const rightPhase = right.geometry.getAttribute('wingUndulationPhase');
    expect(leftPhase).toBe(state.phaseAttribute);
    expect(rightPhase).toBe(state.phaseAttribute);
  });

  it('clones the wing geometry so each batch owns independent attributes', () => {
    const sharedGeo = new THREE.BoxGeometry(2.0, 0.1, 0.01);
    const leftA = new THREE.InstancedMesh(sharedGeo, new THREE.MeshStandardMaterial(), 4);
    const rightA = new THREE.InstancedMesh(sharedGeo, new THREE.MeshStandardMaterial(), 4);
    const leftB = new THREE.InstancedMesh(sharedGeo, new THREE.MeshStandardMaterial(), 4);
    const rightB = new THREE.InstancedMesh(sharedGeo, new THREE.MeshStandardMaterial(), 4);

    const stateA = applyWingUndulationShader({ wingLeft: leftA, wingRight: rightA, config: BASE_CONFIG });
    const stateB = applyWingUndulationShader({ wingLeft: leftB, wingRight: rightB, config: BASE_CONFIG });

    expect(leftA.geometry).not.toBe(sharedGeo);
    expect(leftB.geometry).not.toBe(sharedGeo);
    expect(stateA.phaseAttribute).not.toBe(stateB.phaseAttribute);

    // Writing to one must not affect the other
    stateA.phaseAttribute.setX(0, 9.9);
    expect(stateA.phaseAttribute.getX(0)).toBeCloseTo(9.9);
    expect(stateB.phaseAttribute.getX(0)).toBeCloseTo(0);
  });
});

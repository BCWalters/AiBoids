import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyFishUndulationShader } from './fishUndulationShader';

describe('fishUndulationShader phase attribute ownership', () => {
  it('keeps distinct live phase attributes when two meshes start from one shared geometry', () => {
    const sharedGeometry = new THREE.BoxGeometry(1, 2, 1);
    const meshA = new THREE.InstancedMesh(sharedGeometry, new THREE.MeshStandardMaterial(), 4);
    const meshB = new THREE.InstancedMesh(sharedGeometry, new THREE.MeshStandardMaterial(), 4);
    const config = {
      amplitudeFraction: 0.1,
      wavesPerBody: 0.6,
      baseOmega: 3,
      speedOmegaScale: 1,
    };

    const stateA = applyFishUndulationShader({ mesh: meshA, config });
    const stateB = applyFishUndulationShader({ mesh: meshB, config });

    const liveA = meshA.geometry.getAttribute('fishUndulationPhase');
    const liveB = meshB.geometry.getAttribute('fishUndulationPhase');
    expect(meshA.geometry).not.toBe(meshB.geometry);
    expect(liveA).toBe(stateA.phaseAttribute);
    expect(liveB).toBe(stateB.phaseAttribute);
    expect(liveA).not.toBe(liveB);

    stateA.phaseAttribute.setX(0, 7.5);
    expect(stateA.phaseAttribute.getX(0)).toBeCloseTo(7.5);
    expect(stateB.phaseAttribute.getX(0)).toBeCloseTo(0);
  });

  it('patches body and tail with the same phase attribute and undulation shader uniforms', () => {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial(), 2);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.4, 0.2), new THREE.MeshStandardMaterial(), 2);
    const config = {
      amplitudeFraction: 0.1,
      wavesPerBody: 0.6,
      baseOmega: 3,
      speedOmegaScale: 1,
    };

    const state = applyFishUndulationShader({ mesh: body, tailMesh: tail, config });
    const bodyPhase = body.geometry.getAttribute('fishUndulationPhase');
    const tailPhase = tail.geometry.getAttribute('fishUndulationPhase');
    expect(bodyPhase).toBe(state.phaseAttribute);
    expect(tailPhase).toBe(state.phaseAttribute);

    const bodyShader = {
      vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
      uniforms: {} as Record<string, { value: number }>,
    };
    const tailShader = {
      vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
      uniforms: {} as Record<string, { value: number }>,
    };
    (body.material as THREE.MeshStandardMaterial).onBeforeCompile(bodyShader as any, null as any);
    (tail.material as THREE.MeshStandardMaterial).onBeforeCompile(tailShader as any, null as any);

    expect(bodyShader.vertexShader).toContain('fishUndulationSample( position.y, fishUndulationPhase');
    expect(tailShader.vertexShader).toContain('fishUndulationSample( position.y, fishUndulationPhase');
    expect(tailShader.uniforms.uFishHeadPosition.value).toBeCloseTo(bodyShader.uniforms.uFishHeadPosition.value, 6);
    expect(tailShader.uniforms.uFishTailPosition.value).toBeCloseTo(bodyShader.uniforms.uFishTailPosition.value, 6);
    expect(tailShader.uniforms.uFishAmplitude.value).toBeCloseTo(bodyShader.uniforms.uFishAmplitude.value, 6);
    expect(tailShader.uniforms.uFishWaveNumber.value).toBeCloseTo(bodyShader.uniforms.uFishWaveNumber.value, 6);
  });
});

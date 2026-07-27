import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CreatureInstanceRenderer, type BoidRenderBatch } from './CreatureInstanceRenderer';

function makeBatch(): BoidRenderBatch {
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const wingGeo = new THREE.BoxGeometry(0.5, 0.5, 0.1);
  const tailGeo = new THREE.BoxGeometry(0.4, 0.8, 0.1);
  const material = new THREE.MeshBasicMaterial();
  return {
    body: new THREE.InstancedMesh(bodyGeo, material, 1),
    wingLeft: new THREE.InstancedMesh(wingGeo, material, 1),
    wingRight: new THREE.InstancedMesh(wingGeo, material, 1),
    tail: new THREE.InstancedMesh(tailGeo, material, 1),
  };
}

function matrixMaxAbsDelta(a: THREE.Matrix4, b: THREE.Matrix4): number {
  let delta = 0;
  for (let i = 0; i < 16; i += 1) delta = Math.max(delta, Math.abs(a.elements[i] - b.elements[i]));
  return delta;
}

describe('CreatureInstanceRenderer bird tail articulation', () => {
  it('poses a bird tail differently from the body at a non-zero sway phase', () => {
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3(0, 0, 0)) as unknown as {
      bodyQuat: THREE.Quaternion;
      applyCreatureBodyMatrices: (
        set: BoidRenderBatch,
        i: number,
        pos: { x: number; y: number; z: number },
        entityScale: number,
        worldScale: number,
        meshScaleBoost: number,
        restOnFloor: boolean,
        containWithinTankWalls: boolean,
      ) => void;
      applyCreatureTailSwayMatrix: (
        set: BoidRenderBatch,
        i: number,
        creature: { id: number },
        elapsed: number,
        flapFrequency: number,
        maxFlapAngle: number,
        flapAngle: number,
        tailSwayAxis: THREE.Vector3,
        tailSwayAmplitude: number,
        tailSwayFrequency: number | undefined,
        tailSwayPivotY: number,
        tailFlareStrength: number,
      ) => void;
    };
    const set = makeBatch();

    renderer.bodyQuat.identity();
    renderer.applyCreatureBodyMatrices(set, 0, { x: 0, y: 0, z: 0 }, 1, 1, 1, false, false);
    renderer.applyCreatureTailSwayMatrix(
      set,
      0,
      { id: 7 },
      0.37,
      7.6,
      1.2,
      0.24,
      new THREE.Vector3(1, 0, 0),
      0.07,
      undefined,
      -1.1,
      0.3,
    );

    const bodyMatrix = new THREE.Matrix4();
    const tailMatrix = new THREE.Matrix4();
    set.body.getMatrixAt(0, bodyMatrix);
    set.tail!.getMatrixAt(0, tailMatrix);
    expect(matrixMaxAbsDelta(bodyMatrix, tailMatrix)).toBeGreaterThan(1e-5);
  });
});

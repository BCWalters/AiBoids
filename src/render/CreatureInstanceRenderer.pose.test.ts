import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Boid } from '../sim/Boid';
import { CreatureInstanceRenderer, type BoidRenderBatch, type LegPartMesh } from './CreatureInstanceRenderer';
import type { ColorStrategy, MotionConfig } from './sceneRenderers/createSceneRendererHooks';

function makeCreature(id: number, velocity: { x: number; y: number; z: number }): Boid {
  return {
    id,
    species: 'normal',
    position: { x: 0, y: 0, z: 0 },
    velocity: { ...velocity },
    panicLevel: 0,
    renderHeading: { x: 0, y: 1, z: 0 },
    renderRight: { x: 1, y: 0, z: 0 },
    renderBank: 0,
    dying: false,
    dyingElapsed: 0,
    deathTarget: null,
    abductedByUFO: false,
    scale: 1,
    spawnBurstRemaining: 0,
  } as Boid;
}

function createMesh(count: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
}

function createBatch(count: number, legs?: LegPartMesh[]): BoidRenderBatch {
  return {
    body: createMesh(count),
    wingLeft: createMesh(count),
    wingRight: createMesh(count),
    legs,
  };
}

function matrixAt(mesh: THREE.InstancedMesh, index = 0): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

const colors: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

const motion: MotionConfig = {
  flapFrequency: 4,
  flapIdleAmplitude: 0.5,
  flapSpeedAmplitude: 0.3,
  keepUpright: true,
  uprightStyle: 'dragon',
};

describe('CreatureInstanceRenderer pose state', () => {
  it('keeps renderRight continuous while heading crosses near-vertical', () => {
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    const creature = makeCreature(11, { x: 0.06, y: 1, z: 0 });
    const set = createBatch(1);
    const xs = [0.06, 0.04, 0.02, -0.02, -0.04, -0.06];
    const rights: THREE.Vector3[] = [];

    for (const x of xs) {
      creature.velocity.x = x;
      renderer.updateInstances(set, [creature], 2, 0, 1 / 60, colors, motion);
      rights.push(new THREE.Vector3(creature.renderRight.x, creature.renderRight.y, creature.renderRight.z));
    }

    for (let i = 1; i < rights.length; i += 1) {
      expect(rights[i - 1].dot(rights[i])).toBeGreaterThan(0);
      expect(rights[i - 1].angleTo(rights[i])).toBeLessThan(0.15);
    }
  });

  it('integrates flap phase per creature and stays comparable across step sizes', () => {
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    const fine = makeCreature(7, { x: 0.5, y: 0.2, z: 0.1 });
    const coarse = makeCreature(7, { x: 0.5, y: 0.2, z: 0.1 });
    const set = createBatch(1);

    for (let i = 0; i < 120; i += 1) {
      renderer.updateInstances(set, [fine], 2, 0, 1 / 120, colors, motion);
    }
    renderer.updateInstances(set, [coarse], 2, 0, 1, colors, motion);

    const flapPhase = (renderer as unknown as { flapPhase: WeakMap<Boid, number> }).flapPhase;
    expect(flapPhase.get(fine)).toBeCloseTo(flapPhase.get(coarse) ?? 0, 6);
  });

  it('seeds per-creature phase by id so equal motion stays desynchronised', () => {
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    const a = makeCreature(3, { x: 0.7, y: 0.1, z: 0 });
    const b = makeCreature(4, { x: 0.7, y: 0.1, z: 0 });
    const set = createBatch(2);

    renderer.updateInstances(set, [a, b], 2, 0, 0.5, colors, motion);

    const flapPhase = (renderer as unknown as { flapPhase: WeakMap<Boid, number> }).flapPhase;
    const phaseA = flapPhase.get(a) ?? 0;
    const phaseB = flapPhase.get(b) ?? 0;
    expect(phaseA).not.toBeCloseTo(phaseB);
  });

  it('articulates a leg away from the plain body pose at non-zero drive', () => {
    const legMesh = createMesh(1);
    const legs: LegPartMesh[] = [
      {
        mesh: legMesh,
        role: 'leg',
        group: 'legs',
        pivot: [0, -0.2, 0] as const,
        axis: [1, 0, 0] as const,
        drive: { source: 'legSwing' },
      },
    ];
    const set = createBatch(1, legs);
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    const creature = makeCreature(5, { x: 0.8, y: 0.1, z: 0 });

    renderer.updateInstances(set, [creature], 2, 0, 0.35, colors, {
      ...motion,
      legSwingAmplitude: 0.4,
      legTuckRad: 0.2,
    });

    const bodyPoint = new THREE.Vector3(0, 0, -0.6).applyMatrix4(matrixAt(set.body));
    const legPoint = new THREE.Vector3(0, 0, -0.6).applyMatrix4(matrixAt(legMesh));
    expect(legPoint.distanceTo(bodyPoint)).toBeGreaterThan(1e-4);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Boid } from '../sim/Boid';
import { CreatureInstanceRenderer, type BoidRenderBatch } from './CreatureInstanceRenderer';
import type { ColorStrategy, MotionConfig } from './sceneRenderers/createSceneRendererHooks';
import { swayingTailRig } from './geometry/sharedGeometry';
import type { FishUndulationInstanceState } from './styles/fishtank/fishUndulationShader';

function makeCreature(id: number): Boid {
  return {
    id,
    species: 'normal',
    position: { x: 3, y: 2, z: 1 },
    velocity: { x: 0.6, y: 0.4, z: 0.1 },
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

const mesh = (n: number) =>
  new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), n);

const colors: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

/**
 * Deliberately omits uprightStyle, matching the nature bird and fishtank fish
 * boid configs. MotionConfig defaults it to 'dragon', which is what made the
 * old sway-gated tail write silently skip these creatures.
 */
const birdLikeMotion: MotionConfig = {
  flapFrequency: 3,
  flapIdleAmplitude: 0.15,
  flapSpeedAmplitude: 0.4,
  tailSwayAmplitude: 0.07,
  tailSwayFrequency: 2.2,
  worldScale: 1,
  meshScaleBoost: 1,
  preferUpright: true,
};

function makeFishUndulationState(instanceCount: number): FishUndulationInstanceState {
  return {
    phaseAttribute: new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1),
    baseOmega: 3.2,
    speedOmegaScale: 0.6,
    headPosition: 1.2,
    tailPosition: -1.8,
    amplitude: 0.3,
    waveNumber: 1.7,
  };
}

function poseOnce(set: BoidRenderBatch, motion: MotionConfig): { body: THREE.Matrix4; tail: THREE.Matrix4 } {
  const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
  renderer.updateInstances(set, [makeCreature(9)], 2, 0.5, 1 / 60, colors, motion);
  const body = new THREE.Matrix4();
  const tail = new THREE.Matrix4();
  set.body.getMatrixAt(0, body);
  set.tail!.getMatrixAt(0, tail);
  return { body, tail };
}

describe('tail weld (regression from #200)', () => {
  it('welds a rigless tail to the body instead of leaving it at the identity matrix', () => {
    const set: BoidRenderBatch = { body: mesh(1), wingLeft: mesh(1), wingRight: mesh(1), tail: mesh(1) };
    const { body, tail } = poseOnce(set, birdLikeMotion);

    // The bug: the tail matrix was never written, so it stayed at the identity
    // and every tail rendered clumped at the world origin.
    expect(tail.equals(new THREE.Matrix4())).toBe(false);
    expect(tail.elements).toEqual(body.elements);
  });

  it('carries the rigless tail to the creature position, not the origin', () => {
    const set: BoidRenderBatch = { body: mesh(1), wingLeft: mesh(1), wingRight: mesh(1), tail: mesh(1) };
    const { tail } = poseOnce(set, birdLikeMotion);
    const tailOrigin = new THREE.Vector3().setFromMatrixPosition(tail);
    expect(tailOrigin.distanceTo(new THREE.Vector3(3, 2, 1))).toBeLessThan(1e-6);
  });

  it('still lets a rigged tail sway away from the body pose', () => {
    const set: BoidRenderBatch = {
      body: mesh(1),
      wingLeft: mesh(1),
      wingRight: mesh(1),
      tail: mesh(1),
      tailRig: swayingTailRig({ pivot: [0, -0.5, 0], axis: [1, 0, 0] }),
    };
    const { body, tail } = poseOnce(set, { ...birdLikeMotion, uprightStyle: 'dragon', tailSwayAmplitude: 0.5 });

    const probe = new THREE.Vector3(0, -1.5, 0);
    const onBody = probe.clone().applyMatrix4(body);
    const onTail = probe.clone().applyMatrix4(tail);
    expect(onTail.distanceTo(onBody)).toBeGreaterThan(1e-3);
  });

  it('keeps a rigless tail matrix welded to the body while fish undulation phases advance', () => {
    const set: BoidRenderBatch = {
      body: mesh(1),
      wingLeft: mesh(1),
      wingRight: mesh(1),
      tail: mesh(1),
      fishUndulation: makeFishUndulationState(1),
    };
    const creature = makeCreature(13);
    creature.velocity = { x: 0, y: 1, z: 0 };
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    const bodyMatrix = new THREE.Matrix4();
    const tailMatrix = new THREE.Matrix4();

    for (let step = 0; step < 6; step++) {
      renderer.updateInstances(set, [creature], 2, step * 0.15, 0.15, colors, birdLikeMotion);
      set.body.getMatrixAt(0, bodyMatrix);
      set.tail!.getMatrixAt(0, tailMatrix);
      expect(tailMatrix.elements).toEqual(bodyMatrix.elements);
    }
  });
});

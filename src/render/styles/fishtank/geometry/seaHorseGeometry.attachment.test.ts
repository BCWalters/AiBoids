/**
 * Seahorse geometry attachment invariants.
 *
 * Two historically disconnected parts are guarded here:
 *
 *  1. Pectoral fins (wingLeft / wingRight): their roots sit on the body's
 *     side surface at x = ±surfaceX, not at the model origin. Before the
 *     pivot fix (PR that introduced wingPivotLeft/Right) the shared engine
 *     articulated them about the model origin, sweeping the root through
 *     an arc and detaching it from the body mid-flap.
 *
 *  2. Snout fin (beak): a small nasal-crown fin returned as the `beak` field
 *     of CreatureGeometries. Without it the creature is missing the part
 *     entirely ("disconnected" = absent). The engine's unconditional beak weld
 *     in applyCreatureBodyMatrices keeps it attached once it exists.
 *
 * ## Falsifiability table
 *
 * | Test                                    | Sabotage                                     | Result before fix | After fix |
 * |-----------------------------------------|----------------------------------------------|-------------------|-----------|
 * | snout fin exists (beak)                 | remove `beak` from createSeaHorseGeometries  | FAIL              | PASS      |
 * | pectoral fin root stays welded          | remove wingPivotLeft/Right from geometry     | FAIL              | PASS      |
 * | fin-root distance is below tight bound  | same as above                                | FAIL              | PASS      |
 * | wing pivot X matches absolute constant  | change FIN_SURFACE_X_FRAC to 0              | FAIL              | PASS      |
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Boid } from '../../../../sim/Boid';
import {
  CreatureInstanceRenderer,
  type BoidRenderBatch,
} from '../../../CreatureInstanceRenderer';
import type { ColorStrategy, MotionConfig } from '../../../sceneRenderers/createSceneRendererHooks';
import {
  createSeaHorseGeometries,
  FIN_ROOT_Y_FRAC,
  FIN_ROOT_Z_FRAC,
  seaHorsePectoralRootX,
} from './seaHorseGeometry';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const LENGTH = 36;    // matches FishtankSceneRenderer3D seahorse size
const WIDTH  = 14.85;

/** World position far from origin — a part at (0,0,0) will be ~270 units away. */
const BODY_POS = { x: 200, y: 100, z: 150 };

const DT     = 1 / 60;
const FRAMES = 30;

const FLAT_COLORS: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

const SEAHORSE_MOTION: MotionConfig = {
  flapFrequency: 3.2,
  flapIdleAmplitude: 0.1,
  flapSpeedAmplitude: 0.18,
  keepUpright: true,
  uprightStyle: 'unicorn',
  worldScale: 4,
  meshScaleBoost: 2.2,
  restOnFloor: true,
};

function makeCreature(): Boid {
  return {
    id: 42,
    species: 'normal',
    position: { ...BODY_POS },
    velocity: { x: 1.5, y: 0.5, z: 0.3 },
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

function makeMesh(geo: THREE.BufferGeometry): THREE.InstancedMesh {
  return new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 1);
}

/** World-space position of `point` (model space) under the given instanced mesh's matrix. */
function worldPos(mesh: THREE.InstancedMesh, point: THREE.Vector3, index = 0): THREE.Vector3 {
  const mat = new THREE.Matrix4();
  mesh.getMatrixAt(index, mat);
  return point.clone().applyMatrix4(mat);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seahorse geometry attachment invariants', () => {

  it('createSeaHorseGeometries returns a snout-fin beak geometry (Issue #261)', () => {
    const geom = createSeaHorseGeometries(LENGTH, WIDTH);
    // Before fix: beak is undefined → this assertion fails.
    // After fix: beak is the snout fin geometry.
    expect(geom.beak, 'seahorse geometry must include a snout-fin beak part').toBeDefined();
    expect(geom.beak).not.toBeNull();
  });

  it('wing pivot X coordinate is the declared surface-X constant (absolute anchor)', () => {
    const geom = createSeaHorseGeometries(LENGTH, WIDTH);
    // Import the shipped root rather than copying a literal — a copied constant
    // cannot detect a change to the original.
    const expectedX = seaHorsePectoralRootX(LENGTH, WIDTH);
    // Independent sanity bound, so this cannot pass vacuously if the root
    // collapses to zero: the root must be a real distance out on the flank.
    expect(expectedX).toBeGreaterThan(1.0);
    // ...and it must be INSIDE the skin, which is the property that keeps the
    // blade seated. A root proud of the flank is what made the fins look
    // detached before.
    expect(expectedX).toBeLessThan(WIDTH * 0.15);
    expect(geom.wingPivotLeft).toBeDefined();
    expect(geom.wingPivotRight).toBeDefined();
    expect(geom.wingPivotLeft![0]).toBeCloseTo(expectedX, 5);
    expect(geom.wingPivotRight![0]).toBeCloseTo(-expectedX, 5);
  });

  it('pectoral fin root stays welded to the body through the flap cycle (Issue #261)', () => {
    const geom = createSeaHorseGeometries(LENGTH, WIDTH);
    const batch: BoidRenderBatch = {
      body:      makeMesh(geom.body),
      wingLeft:  makeMesh(geom.wingLeft),
      wingRight: makeMesh(geom.wingRight),
      tail:      geom.tail ? makeMesh(geom.tail) : undefined,
      beak:      geom.beak ? makeMesh(geom.beak) : undefined,
      wingPivotLeft:  geom.wingPivotLeft,
      wingPivotRight: geom.wingPivotRight,
    };

    const boid    = makeCreature();
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
    for (let f = 0; f < FRAMES; f++) {
      renderer.updateInstances(batch, [boid], 5, f * DT, DT, FLAT_COLORS, SEAHORSE_MOTION);
    }

    // The fin root in model space — imported constants keep this expression live
    // if the geometry changes.
    const finRootY = LENGTH * FIN_ROOT_Y_FRAC;
    const finRootZ = LENGTH * FIN_ROOT_Z_FRAC;
    const surfaceX = seaHorsePectoralRootX(LENGTH, WIDTH);

    const pivotLeft  = new THREE.Vector3( surfaceX, finRootY, finRootZ);
    const pivotRight = new THREE.Vector3(-surfaceX, finRootY, finRootZ);

    const bodyPivotLeft  = worldPos(batch.body,     pivotLeft);
    const wingPivotLeft  = worldPos(batch.wingLeft, pivotLeft);
    const distLeft       = bodyPivotLeft.distanceTo(wingPivotLeft);

    const bodyPivotRight  = worldPos(batch.body,      pivotRight);
    const wingPivotRight  = worldPos(batch.wingRight, pivotRight);
    const distRight       = bodyPivotRight.distanceTo(wingPivotRight);

    // Tight absolute tolerance (0.15 model units). The body bounding sphere is
    // ~12+ units in radius, so 0.25× radius ≈ 3 — four orders of magnitude
    // wider than the limit here. With the correct pivot the measured distance is
    // < 1e-12; without it (pivot=null, root swings in an arc) it reaches 0.3+.
    const TIGHT_TOL = 0.15;

    expect(distLeft,  `wingLeft root drifted ${distLeft.toFixed(4)} units from body`).toBeLessThan(TIGHT_TOL);
    expect(distRight, `wingRight root drifted ${distRight.toFixed(4)} units from body`).toBeLessThan(TIGHT_TOL);
  });

});

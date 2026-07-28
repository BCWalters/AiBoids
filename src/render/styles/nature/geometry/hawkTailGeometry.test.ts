/**
 * Geometry and attachment regression tests for the hawk's fan tail (#254).
 *
 * ## What the old geometry looked like (kite/diamond):
 *
 *   4 vertices: root(0,−4.55) → leftTip(−5.62,−7.11) → backPoint(0,−8.51) → rightTip(5.62,−7.11)
 *
 *   The tail was a diamond/kite shape — widest at ~57% of the way back, then
 *   narrowing to a **single rear vertex** at the far end. The trailing edge had
 *   zero width (one point), not the broad rectangular fan of a real raptor tail.
 *
 * ## New geometry (fan/trapezoid):
 *
 *   6 vertices: root → left-mid → left-rear-corner → center-rear → right-rear-corner → right-mid
 *
 *   The trailing edge carries full half-span so the tail reads as a broad,
 *   flat, fanned rectangle from below — an airbrake/steering surface.
 *
 * ## Sway axis note:
 *
 *   The tailRig sway axis [1,0,0] is X = MODEL_RIGHT, which produces a pitch
 *   (up/down) motion — the tail tips up as the hawk climbs and down as it dives.
 *   This is correct for a raptor using its tail as an elevator. Axis [0,1,0]
 *   would roll the tail about its own spine (the shark-tail X-pattern bug);
 *   [0,0,1] would yaw it. Pitch on X is intentional and unchanged from before.
 *
 * ## Falsification table (each sabotage reverts a specific change):
 *
 *   | Test                          | Sabotage                                            | Result  |
 *   |-------------------------------|-----------------------------------------------------|---------|
 *   | Fan shape (trailing ≥ 90%)    | Revert to buildTailGeometry kite (trailing span = 0)| FAIL    |
 *   | Flatness (Z < 10% of X span)  | Set thickness = width * 0.5 (10× thicker)           | FAIL    |
 *   | No forward widening           | Set midY = rootY + length * 0.1 (forward of root)  | FAIL    |
 *   | Tail attachment (hinge)       | Remove tailRig from batch so tail uses identity mat | FAIL    |
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Boid } from '../../../../sim/Boid';
import {
  CreatureInstanceRenderer,
  type BoidRenderBatch,
} from '../../../CreatureInstanceRenderer';
import type {
  ColorStrategy,
  MotionConfig,
} from '../../../sceneRenderers/createSceneRendererHooks';
import {
  HAWK_TAIL_SWAY_AMPLITUDE,
  HAWK_FLAP_FREQUENCY,
  FLAP_IDLE_AMPLITUDE,
  FLAP_SPEED_AMPLITUDE,
} from '../../../sceneRenderers/NatureSceneRenderer3D';
import { createHawkGeometries } from './hawkGeometry';
import { getBirdBodyRearTipY } from './birdSharedGeometry';

// ---------------------------------------------------------------------------
// Reference dimensions — match the live hawk scale from NatureSceneRenderer3D
// (NATURE_CREATURE_SIZES.predatorNormal = { length: 9.1, width: 6.24 }).
// ---------------------------------------------------------------------------

const LENGTH = 9.1;
const WIDTH  = 6.24;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tailGeom(): THREE.BufferGeometry {
  return createHawkGeometries(LENGTH, WIDTH).tail!;
}

function tailBounds(): THREE.Box3 {
  const box = new THREE.Box3();
  box.setFromBufferAttribute(tailGeom().getAttribute('position') as THREE.BufferAttribute);
  return box;
}

/**
 * Returns 2× the maximum |x| of all tail vertices whose Y is ≤ yThreshold.
 * Used to measure the span of the trailing edge.
 */
function spanAtOrBehind(geo: THREE.BufferGeometry, yThreshold: number): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let maxAbsX = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= yThreshold) {
      maxAbsX = Math.max(maxAbsX, Math.abs(pos.getX(i)));
    }
  }
  return maxAbsX * 2;
}

/**
 * Returns the rearmost Y at which any non-root flank vertex (|x| > tolerance) lies.
 * Used to assert that the tail does not widen forward of the body rear.
 */
function maxFlankY(geo: THREE.BufferGeometry, xTolerance = 1e-4): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) > xTolerance) {
      maxY = Math.max(maxY, pos.getY(i));
    }
  }
  return maxY;
}

// ---------------------------------------------------------------------------
// Geometric tests
// ---------------------------------------------------------------------------

describe('hawk tail geometry — shape assertions', () => {
  it('is a fan, not a kite: trailing-edge span ≥ 90 % of max span', () => {
    // The old kite had a single rear vertex at X=0, giving trailing span = 0.
    // The new fan has full half-span at the trailing edge, so this ratio → 1.
    const geo = tailGeom();
    const box = new THREE.Box3();
    box.setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    const maxSpan = box.max.x - box.min.x;
    // "Trailing edge" = vertices in the rear 10 % of the tail's Y extent.
    const yExtent   = box.max.y - box.min.y;
    const trailing10pctY = box.min.y + yExtent * 0.10;
    const trailingSpan = spanAtOrBehind(geo, trailing10pctY);
    expect(trailingSpan / maxSpan).toBeGreaterThanOrEqual(0.9);
  });

  it('is flat: Z-thickness < 10 % of X-span (horizontal surface)', () => {
    // The tail lies in the XY plane (MODEL_UP=Z, spine=Y) and is extruded a
    // small amount along Z for solid silhouette.  Excessive Z depth would make
    // it read as a block, not a flat airbrake surface.
    const box = tailBounds();
    const zThickness = box.max.z - box.min.z;
    const xSpan      = box.max.x - box.min.x;
    expect(zThickness / xSpan).toBeLessThan(0.10);
  });

  it('does not widen forward of the body rear tip', () => {
    // Matches the analogous assertion in birdTailAttachment.test.ts but for
    // the hawk-specific geometry factory path.
    const bodyRearY = getBirdBodyRearTipY(LENGTH);
    expect(maxFlankY(tailGeom())).toBeLessThanOrEqual(bodyRearY + 1e-3);
  });
});

// ---------------------------------------------------------------------------
// Attachment regression (mirrors partProximity.test.ts pattern, #215)
// ---------------------------------------------------------------------------

const DT     = 1 / 60;
const FRAMES = 30;
/** World position far from origin — a tail that regresses to identity matrix
 * sits ~271 units away, always beyond any tolerance. */
const BODY_POSITION = { x: 200, y: 100, z: 150 };

const FLAT_COLORS: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

/**
 * Hawk MotionConfig mirroring the live NatureSceneRenderer3D values.
 * Imported (not hard-coded) so this test stays in sync if the amplitudes change.
 */
const HAWK_MOTION: MotionConfig = {
  flapFrequency: HAWK_FLAP_FREQUENCY,
  flapIdleAmplitude: FLAP_IDLE_AMPLITUDE,
  flapSpeedAmplitude: FLAP_SPEED_AMPLITUDE,
  tailSwayAmplitude: HAWK_TAIL_SWAY_AMPLITUDE,
  preferUpright: true,
  worldScale: 1,
  meshScaleBoost: 1,
};

function makeHawkBoid(id: number): Boid {
  return {
    id,
    species: 'normal',
    position: { ...BODY_POSITION },
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

describe('hawk tail attachment — hinge stays near body', () => {
  it(`tail rig hinge stays within 0.25 × body-radius after ${FRAMES} frames`, () => {
    const geom     = createHawkGeometries(LENGTH, WIDTH);
    const bodyMesh = makeMesh(geom.body);
    const tailMesh = makeMesh(geom.tail!);
    const batch: BoidRenderBatch = {
      body:      bodyMesh,
      wingLeft:  makeMesh(geom.wingLeft),
      wingRight: makeMesh(geom.wingRight),
      tail:      tailMesh,
      tailRig:   geom.tailRig,
    };

    if (!geom.body.boundingSphere) geom.body.computeBoundingSphere();
    const bodyRadius = geom.body.boundingSphere!.radius;
    const tolerance  = bodyRadius * 0.25;

    const boid     = makeHawkBoid(1);
    const renderer = new CreatureInstanceRenderer(new THREE.Vector3());

    for (let frame = 0; frame < FRAMES; frame++) {
      renderer.updateInstances(batch, [boid], 5, frame * DT, DT, FLAT_COLORS, HAWK_MOTION);
    }

    // Check the hinge point (rig pivot) rather than the matrix origin.
    // This is the correct pattern for rigged tails — the origin swings on a
    // lever arm while only the declared pivot stays welded to the body.
    // See partProximity.test.ts → partHingeWorldPosition() for the rationale.
    const pivot    = geom.tailRig!.pivot;
    const hingeVec = new THREE.Vector3(pivot[0], pivot[1], pivot[2]);

    const bodyMat  = new THREE.Matrix4();
    bodyMesh.getMatrixAt(0, bodyMat);
    const bodyHingeWorld = hingeVec.clone().applyMatrix4(bodyMat);

    const tailMat  = new THREE.Matrix4();
    tailMesh.getMatrixAt(0, tailMat);
    const tailHingeWorld = hingeVec.clone().applyMatrix4(tailMat);

    const dist = tailHingeWorld.distanceTo(bodyHingeWorld);
    expect(
      dist,
      `tail hinge distance ${dist.toFixed(4)} exceeds tolerance ${tolerance.toFixed(4)} ` +
      `(bodyRadius=${bodyRadius.toFixed(4)} × 0.25)`,
    ).toBeLessThan(tolerance);
  });
});

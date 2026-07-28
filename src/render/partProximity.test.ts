/**
 * Part-proximity invariant: every instanced part's world-space position must
 * stay within a sane radius of its own body's world-space position.
 *
 * This single check would have caught three separate shipped bugs:
 *   - #200: rigless tails (all nature birds, all fishtank boid fish) rendered
 *           at the world origin, a full body-length from the creature
 *   - #207: bird hip pivot placed at the model origin, swinging legs about a
 *           hinge half a body-length in front of the real hip
 *   - #210: bird tail root mis-positioned during sway
 *
 * The tolerance is keyed to each creature's body bounding sphere so the
 * invariant stays correct when creature sizes change. A part may legitimately
 * sit one body-length away (wing spread, dangling legs, flowing tail), but it
 * can never be at the world origin (0,0,0) while the body sits at
 * (200, 100, 150).
 *
 * ## Falsifiability
 * Reverting the one-line fix from PR #215 — restoring the old sway-gated
 * tail write in applyCreatureBodyMatrices — makes the nature-parrot and
 * fishtank-fish entries (which declare no tailRig) fail immediately:
 *   AssertionError: part 'tail' in 'nature parrot' exceeds tolerance
 *     distance 271 > tolerance 23 (bodyRadius=7.8 × 3)
 * The shark and barracuda entries still pass because they have a tailRig and
 * go through the sway path, which was never broken.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Boid } from '../sim/Boid';
import {
  CreatureInstanceRenderer,
  type BoidRenderBatch,
  type LegPartMesh,
} from './CreatureInstanceRenderer';
import type { ColorStrategy, MotionConfig } from './sceneRenderers/createSceneRendererHooks';
import type { CreatureGeometries, CreatureLegPart } from './geometry/sharedGeometry';
import type { Triple } from './motion/rig';
// Nature geometries (unrestricted files)
import { createParrotGeometries } from './styles/nature/geometry/parrotGeometry';
import { createUnicornGeometries } from './styles/nature/geometry/unicornGeometry';
// Fishtank geometries
import {
  createPlainFishGeometries,
  createGoldfishGeometries,
} from './styles/fishtank/geometry/smallFishGeometry';
import { createButterflyfishGeometries } from './styles/fishtank/geometry/butterflyfishGeometry';
import { createSharkGeometries } from './styles/fishtank/geometry/sharkGeometry';
import { createBarracudaGeometries } from './styles/fishtank/geometry/barracudaGeometry';
import { createSeaHorseGeometries } from './styles/fishtank/geometry/seaHorseGeometry';
// The shipped sway amplitudes, imported rather than copied: a local copy let
// this harness keep exercising 0.5 rad long after the shark shipped 0.06.
import {
  SHARK_TAIL_SWAY_AMPLITUDE,
  BARRACUDA_TAIL_SWAY_AMPLITUDE,
} from './sceneRenderers/FishtankSceneRenderer3D';

// -------------------------------------------------------------------
// Shared test helpers
// -------------------------------------------------------------------

const DT = 1 / 60;
const FRAMES = 30;
const MAX_SPEED = 5;
/** World position far from the origin — any part teleporting to (0,0,0)
 * will be ~271 units away, comfortably beyond any tolerance derived from
 * the creature's own geometry. */
const BODY_POSITION = { x: 200, y: 100, z: 150 };

const FLAT_COLORS: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

function makeCreature(id: number): Boid {
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

function makeBatch(geom: CreatureGeometries): BoidRenderBatch {
  const batch: BoidRenderBatch = {
    body: makeMesh(geom.body),
    wingLeft: makeMesh(geom.wingLeft),
    wingRight: makeMesh(geom.wingRight),
  };
  if (geom.tail) batch.tail = makeMesh(geom.tail);
  if (geom.tailRig) batch.tailRig = geom.tailRig;
  if (geom.legs?.length) {
    batch.legs = geom.legs.map((part: CreatureLegPart): LegPartMesh => ({
      ...part,
      mesh: makeMesh(part.geometry),
    }));
  }
  if (geom.beak) batch.beak = makeMesh(geom.beak);
  if (geom.wingPivotLeft) batch.wingPivotLeft = geom.wingPivotLeft;
  if (geom.wingPivotRight) batch.wingPivotRight = geom.wingPivotRight;
  return batch;
}

/** Radius of the body geometry's bounding sphere — the creature's natural
 * scale anchor. Parts that are legitimately offset (spread wings, dangling
 * legs) sit within one radius; a part at the world origin while the body is
 * at (200,100,150) sits 271 units away. */
function bodyRadius(geom: CreatureGeometries): number {
  const body = geom.body;
  if (!body.boundingSphere) body.computeBoundingSphere();
  return body.boundingSphere?.radius ?? 10;
}

/** Collect every optional part mesh in the batch as labelled entries. */
function collectParts(
  batch: BoidRenderBatch,
  geometries: CreatureGeometries,
): Array<{ label: string; mesh: THREE.InstancedMesh; pivot?: Triple }> {
  const parts: Array<{ label: string; mesh: THREE.InstancedMesh; pivot?: Triple }> = [
    { label: 'wingLeft', mesh: batch.wingLeft, pivot: geometries.wingPivotLeft },
    { label: 'wingRight', mesh: batch.wingRight, pivot: geometries.wingPivotRight },
  ];
  if (batch.tail) parts.push({ label: 'tail', mesh: batch.tail, pivot: geometries.tailRig?.pivot });
  if (batch.legs) {
    batch.legs.forEach((legPart, i) =>
      parts.push({ label: `leg[${i}]`, mesh: legPart.mesh, pivot: geometries.legs?.[i]?.pivot }),
    );
  }
  if (batch.beak) parts.push({ label: 'beak', mesh: batch.beak });
  return parts;
}

/**
 * World-space position of a part's declared hinge point.
 *
 * This deliberately does NOT just read the instance matrix's translation
 * column. That column is where the part's *model origin* lands, which tracks
 * the part faithfully only while the transform is a rotation about that
 * origin. Once a rig hinges a part about a pivot offset perpendicular to its
 * sway axis — as the shark and barracuda caudal fins do since the axis fix —
 * the origin swings on a long lever arm while the geometry stays welded at
 * the pivot, and the translation column reports a large displacement for a
 * fin that has barely moved.
 *
 * Transforming the declared pivot instead measures the one point that must
 * stay attached to the body no matter how the part articulates. For parts
 * with no pivot the pivot IS the model origin, so this reduces exactly to the
 * original check and every previously-calibrated tolerance still applies.
 */
function partHingeWorldPosition({
  mesh,
  pivot,
  index = 0,
}: {
  mesh: THREE.InstancedMesh;
  pivot?: Triple;
  index?: number;
}): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const hinge = pivot
    ? new THREE.Vector3(pivot[0], pivot[1], pivot[2])
    : new THREE.Vector3();
  return hinge.applyMatrix4(matrix);
}

/** Collect every optional part mesh in the batch as labelled entries. */

// -------------------------------------------------------------------
// Creature table
// -------------------------------------------------------------------

const NATURE_BASE = { length: 9.1, width: 6.24 };
const FISH_BASE = { length: 9.1, width: 6.24 };
const TANK_VISUAL_SCALE = 4;

interface CreatureCase {
  name: string;
  makeGeometries: () => CreatureGeometries;
  motion: MotionConfig;
}

/**
 * Nature boid (parrot) motion config — the bird family defaults.
 * Deliberately omits uprightStyle: MotionConfig defaults it to 'dragon',
 * exactly what caused the sway-gate to silently skip rigless-tail birds.
 */
const NATURE_BIRD_MOTION: MotionConfig = {
  flapFrequency: 7.6,
  flapIdleAmplitude: 0.25,
  flapSpeedAmplitude: 0.9,
  tailSwayAmplitude: 0.22,
  worldScale: 1,
  meshScaleBoost: 1,
  preferUpright: true,
};

const NATURE_UNICORN_MOTION: MotionConfig = {
  flapFrequency: 3.2,
  flapIdleAmplitude: 0.22,
  flapSpeedAmplitude: 0.5,
  legSwingAmplitude: 0.13,
  legTuckRad: 0.3,
  keepUpright: true,
  uprightStyle: 'unicorn',
  worldScale: 1,
  meshScaleBoost: 1,
};

/**
 * Fishtank boid (small fish) motion config.
 * Also omits uprightStyle — these were the other casualties of #200.
 */
const FISHTANK_FISH_MOTION: MotionConfig = {
  flapFrequency: 3.0,
  flapIdleAmplitude: 0.15,
  flapSpeedAmplitude: 0.4,
  tailSwayAmplitude: 0.06,
  tailSwayFrequency: 2.2,
  worldScale: TANK_VISUAL_SCALE,
  meshScaleBoost: 2.2,
  preferUpright: true,
};

const FISHTANK_SEAHORSE_MOTION: MotionConfig = {
  flapFrequency: 3.2,
  flapIdleAmplitude: 0.1,
  flapSpeedAmplitude: 0.18,
  keepUpright: true,
  uprightStyle: 'unicorn',
  worldScale: TANK_VISUAL_SCALE,
  meshScaleBoost: 2.2,
  restOnFloor: true,
};

const FISHTANK_SHARK_MOTION: MotionConfig = {
  flapFrequency: 2.2,
  flapIdleAmplitude: 0.05,
  flapSpeedAmplitude: 0.09,
  keepUpright: true,
  uprightStyle: 'shark',
  finRestBiasRad: 0.4,
  tailSwayAmplitude: SHARK_TAIL_SWAY_AMPLITUDE,
  tailSwayFrequency: 3.4,
  worldScale: TANK_VISUAL_SCALE,
  meshScaleBoost: 2.42,
  containWithinTankWalls: true,
};

const FISHTANK_BARRACUDA_MOTION: MotionConfig = {
  flapFrequency: 2.5,
  flapIdleAmplitude: 0.04,
  flapSpeedAmplitude: 0.08,
  keepUpright: true,
  uprightStyle: 'shark',
  finRestBiasRad: 0.32,
  tailSwayAmplitude: BARRACUDA_TAIL_SWAY_AMPLITUDE,
  tailSwayFrequency: 3.9,
  worldScale: TANK_VISUAL_SCALE,
  meshScaleBoost: 1.936,
  containWithinTankWalls: true,
};

const CREATURE_TABLE: CreatureCase[] = [
  // --- Nature scene ---

  // Rigless-tail boid — the canonical #200 regression case for nature.
  // uprightStyle omitted (defaults to 'dragon') to match the live boid config.
  {
    name: 'nature parrot',
    makeGeometries: () => createParrotGeometries(NATURE_BASE.length, NATURE_BASE.width, 'neutral'),
    motion: NATURE_BIRD_MOTION,
  },

  // Unicorn: uprightStyle: 'unicorn', rigless tail, jointed legs.
  {
    name: 'nature unicorn',
    makeGeometries: () => createUnicornGeometries(
      36 / 9.1 * NATURE_BASE.length,
      14.85 / 6.24 * NATURE_BASE.width,
      new THREE.Color(0xc9a8f0),
    ),
    motion: NATURE_UNICORN_MOTION,
  },

  // --- Fishtank scene ---

  // Plain fish (Tetra): rigless tail, no uprightStyle — the canonical #200
  // regression case for the fishtank.
  {
    name: 'fishtank plain fish',
    makeGeometries: () => createPlainFishGeometries(
      FISH_BASE.length * 0.525 * 0.75 * 2,
      FISH_BASE.width * 0.525 * 0.75 * 2,
    ),
    motion: FISHTANK_FISH_MOTION,
  },

  // Goldfish: rigless tail, scales differently from plain fish.
  {
    name: 'fishtank goldfish',
    makeGeometries: () => createGoldfishGeometries(
      FISH_BASE.length * 0.525 * 0.75 * 0.5 * 2,
      FISH_BASE.width * 0.525 * 0.75 * 0.5 * 2,
    ),
    motion: FISHTANK_FISH_MOTION,
  },

  // Butterflyfish (parrot reskin): rigless tail, uprightStyle omitted.
  {
    name: 'fishtank butterflyfish',
    makeGeometries: () => createButterflyfishGeometries(FISH_BASE.length, FISH_BASE.width),
    motion: FISHTANK_FISH_MOTION,
  },

  // Seahorse (unicorn reskin): rigless tail, uprightStyle: 'unicorn'.
  {
    name: 'fishtank seahorse',
    makeGeometries: () => createSeaHorseGeometries(
      36 / 9.1 * FISH_BASE.length,
      14.85 / 6.24 * FISH_BASE.width,
    ),
    motion: FISHTANK_SEAHORSE_MOTION,
  },

  // Shark: rigged tail (swayed), uprightStyle: 'shark'.
  // Included to verify that rigged tails also stay near the body after sway.
  {
    name: 'fishtank shark',
    makeGeometries: () => createSharkGeometries(
      36 / 9.1 * FISH_BASE.length,
      15.84 / 6.24 * FISH_BASE.width,
    ),
    motion: FISHTANK_SHARK_MOTION,
  },

  // Barracuda: rigged tail (swayed), uprightStyle: 'shark'.
  {
    name: 'fishtank barracuda',
    makeGeometries: () => createBarracudaGeometries(
      27 / 9.1 * FISH_BASE.length,
      9.6 / 6.24 * FISH_BASE.width,
    ),
    motion: FISHTANK_BARRACUDA_MOTION,
  },
];

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('part proximity invariant — every part stays near its body', () => {
  for (const creature of CREATURE_TABLE) {
    it(`${creature.name}: all parts within 0.25× body-radius after ${FRAMES} frames`, () => {
      const geom = creature.makeGeometries();
      const batch = makeBatch(geom);
      const radius = bodyRadius(geom);
      /**
       * Tolerance: 0.25× the body's bounding-sphere radius.
       *
       * This checks that every part's **instance matrix translation** stays
       * close to the body's instance matrix translation — i.e. the transform
       * written by updateInstances is anchored to the creature's world
       * position. It does not assert geometry separation or visual
       * interpenetration.
       *
       * Calibration: the worst observed distance/radius ratio across all 29
       * part checks is ≈ 0.029 (unicorn hoof after 30 frames of leg swing),
       * giving ~8× headroom at this multiplier. A tail that reverts to the
       * identity matrix sits ~271 units from the creature at BODY_POSITION —
       * always beyond this threshold regardless of creature size.
       */
      const tolerance = radius * 0.25;

      const boid = makeCreature(creature.name.charCodeAt(0));
      const renderer = new CreatureInstanceRenderer(new THREE.Vector3());

      for (let frame = 0; frame < FRAMES; frame++) {
        renderer.updateInstances(
          batch,
          [boid],
          MAX_SPEED,
          frame * DT,
          DT,
          FLAT_COLORS,
          creature.motion,
        );
      }

      // Assert every part's hinge point lands where the BODY places that same
      // point. A part is attached exactly when its own transform and the
      // body's agree about where the hinge is; how the part swings beyond the
      // hinge is articulation, not detachment. Parts with no declared pivot
      // use the model origin, which is the original form of this check.
      for (const { label, mesh, pivot } of collectParts(batch, geom)) {
        const bodyPos = partHingeWorldPosition({ mesh: batch.body, pivot });
        const partPos = partHingeWorldPosition({ mesh, pivot });
        const dist = partPos.distanceTo(bodyPos);
        expect(
          dist,
          `part '${label}' in '${creature.name}': distance ${dist.toFixed(4)} exceeds tolerance ${tolerance.toFixed(4)} (bodyRadius=${radius.toFixed(4)} × 0.25)`,
        ).toBeLessThan(tolerance);
      }
    });
  }
});

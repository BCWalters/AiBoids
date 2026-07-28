/**
 * THROWAWAY PROBE — delete this directory before committing.
 *
 * Measures what fraction of frames each hawk (and small-bird boid for comparison)
 * spends inverted (dorsal world-Y < 0) under the current orientation logic.
 * Averaged over 6 seeds x 30 simulated seconds.
 */

import { it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../sim/Simulation';
import { params, resetParams } from '../sim/params';
import type { Predator } from '../sim/Predator';
import type { Boid } from '../sim/Boid';
import { CreatureInstanceRenderer, type BoidRenderBatch } from '../render/CreatureInstanceRenderer';
import type { ColorStrategy, MotionConfig } from '../render/sceneRenderers/createSceneRendererHooks';
import { getPredatorCatchProfilesForStyle } from '../render/sceneRenderers/predatorCatchProfiles';
import { HAWK_FLAP_FREQUENCY, FLAP_FREQUENCY } from '../render/sceneRenderers/NatureSceneRenderer3D';

const REAL_RANDOM = Math.random;

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const FLAT_COLORS: ColorStrategy = {
  baseColor: new THREE.Color(0xffffff),
  highlightColor: new THREE.Color(0xffffff),
  getIntensity: () => 0,
  colorMode: 'flat',
};

// Hawk motion config matching NatureSceneRenderer3D (current, without preferUpright)
const HAWK_MOTION_CURRENT: MotionConfig = {
  flapFrequency: HAWK_FLAP_FREQUENCY,
  flapIdleAmplitude: 0.22,
  flapSpeedAmplitude: 0.55,
  flapDownstrokeFraction: 0.4,
  keepUpright: false,
  tailSwayAmplitude: 0.08,
  worldScale: 1,
  meshScaleBoost: 1,
  // No preferUpright — this is the CURRENT (broken) config
};

// Hawk motion config with fix applied (preferUpright: true)
const HAWK_MOTION_FIXED: MotionConfig = {
  flapFrequency: HAWK_FLAP_FREQUENCY,
  flapIdleAmplitude: 0.22,
  flapSpeedAmplitude: 0.55,
  flapDownstrokeFraction: 0.4,
  keepUpright: false,
  preferUpright: true,
  tailSwayAmplitude: 0.08,
  worldScale: 1,
  meshScaleBoost: 1,
};

// Nature small-bird boid motion (for comparison — has preferUpright: true)
const BIRD_MOTION: MotionConfig = {
  flapFrequency: FLAP_FREQUENCY,
  flapIdleAmplitude: 0.25,
  flapSpeedAmplitude: 0.9,
  tailSwayAmplitude: 0.22,
  worldScale: 1,
  meshScaleBoost: 1,
  preferUpright: true,
};

function createMesh(count: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    count,
  );
}

function createBatch(count: number): BoidRenderBatch {
  return {
    body: createMesh(count),
    wingLeft: createMesh(count),
    wingRight: createMesh(count),
  };
}

/** Model +Z (dorsal/up) direction — when Y < 0, creature is inverted. */
function isDorsalInverted(mesh: THREE.InstancedMesh, index: number): boolean {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  // Column 3 (z-column) of the rotation matrix = world direction of model +Z
  // In Three.js column-major storage: [m0..m3 = col0, m4..m7 = col1, m8..m11 = col2, m12..m15 = col3]
  // Wait: Three.js elements are row-major conceptually but stored:
  // elements[0..3] = col 0, elements[4..7] = col 1, elements[8..11] = col 2, elements[12..15] = col 3
  // So dorsal (model +Z) is mapped to world via col 2: elements[8, 9, 10]
  return m.elements[9] < 0; // world-Y of the dorsal direction
}

function measureInversionRate(
  motion: MotionConfig,
  creatures: (Boid | Predator)[],
  sim: Simulation,
  seconds: number,
): number {
  const renderer = new CreatureInstanceRenderer(new THREE.Vector3());
  const count = creatures.length;
  const set = createBatch(count);
  const maxSpeed = 15;

  let totalFrames = 0;
  let invertedFrames = 0;

  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(1 / 60);
    renderer.updateInstances(set, creatures, maxSpeed, i / 60, 1 / 60, FLAT_COLORS, motion);
    for (let j = 0; j < count; j++) {
      if (isDorsalInverted(set.body, j)) invertedFrames++;
      totalFrames++;
    }
  }

  return totalFrames > 0 ? invertedFrames / totalFrames : 0;
}

it(
  'probe: measure hawk inversion fraction vs small-bird inversion fraction',
  () => {
    const SEEDS = [1, 2, 3, 4, 5, 6];
    const SECONDS = 30;

    let hawkTotal = 0;
    let hawkFixedTotal = 0;
    let birdTotal = 0;
    let hawkRuns = 0;
    let birdRuns = 0;

    for (const seed of SEEDS) {
      // --- Broken hawk ---
      seedRandom(seed * 100 + 1);
      resetParams();
      params.mode = '3d';
      params.visualStyle = 'nature';
      params.boidCount = 30;
      params.predatorCount = 3;
      params.monsterCount = 0;
      params.horseCount = 0;
      params.multicolorCount = 0;
      params.goldCount = 0;
      params.redCount = 0;
      params.blueCount = 0;
      {
        const sim = new Simulation(1000, 1000);
        sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle('nature'));
        const hawks = sim.predators.filter(p => p.species === 'normal');
        if (hawks.length > 0) {
          const rate = measureInversionRate(HAWK_MOTION_CURRENT, hawks, sim, SECONDS);
          hawkTotal += rate;
          hawkRuns++;
        }
      }

      // --- Fixed hawk ---
      seedRandom(seed * 100 + 3);
      resetParams();
      params.mode = '3d';
      params.visualStyle = 'nature';
      params.boidCount = 30;
      params.predatorCount = 3;
      params.monsterCount = 0;
      params.horseCount = 0;
      params.multicolorCount = 0;
      params.goldCount = 0;
      params.redCount = 0;
      params.blueCount = 0;
      {
        const sim3 = new Simulation(1000, 1000);
        sim3.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle('nature'));
        const hawks3 = sim3.predators.filter(p => p.species === 'normal');
        if (hawks3.length > 0) {
          const rateFixed = measureInversionRate(HAWK_MOTION_FIXED, hawks3, sim3, SECONDS);
          hawkFixedTotal += rateFixed;
        }
      }

      // --- Small bird ---
      seedRandom(seed * 100 + 2);
      resetParams();
      params.mode = '3d';
      params.visualStyle = 'nature';
      params.boidCount = 30;
      params.predatorCount = 0;
      params.monsterCount = 0;
      params.horseCount = 0;
      params.multicolorCount = 0;
      params.goldCount = 0;
      params.redCount = 0;
      params.blueCount = 0;
      {
        const sim2 = new Simulation(1000, 1000);
        const birds = sim2.boids.slice(0, 5);
        if (birds.length > 0) {
          const rate = measureInversionRate(BIRD_MOTION, birds, sim2, SECONDS);
          birdTotal += rate;
          birdRuns++;
        }
      }
    }

    Math.random = REAL_RANDOM;
    resetParams();

    const hawkAvg = hawkRuns > 0 ? hawkTotal / hawkRuns : 0;
    const hawkFixedAvg = hawkRuns > 0 ? hawkFixedTotal / hawkRuns : 0;
    const birdAvg = birdRuns > 0 ? birdTotal / birdRuns : 0;

    console.log(`\n=== HAWK INVERSION PROBE RESULTS ===`);
    console.log(`Hawk (current, no preferUpright):  ${(hawkAvg * 100).toFixed(1)}% inverted`);
    console.log(`Hawk (fixed, preferUpright: true): ${(hawkFixedAvg * 100).toFixed(1)}% inverted`);
    console.log(`Small bird (preferUpright: true):  ${(birdAvg * 100).toFixed(1)}% inverted`);
    console.log(`====================================\n`);

    // This is a probe — no assertions, just measuring
  },
  120_000,
);

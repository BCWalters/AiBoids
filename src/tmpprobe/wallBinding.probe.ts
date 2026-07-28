/**
 * Temporary diagnostic probe for Issue #253: predator wall-binding.
 * Run with: npx tsx src/tmpprobe/wallBinding.probe.ts
 * DELETE before committing.
 */

import { params, resetParams } from '../sim/params';
import { Simulation } from '../sim/Simulation';
import { Boid } from '../sim/Boid';
import { Predator, PredatorSpecies } from '../sim/Predator';
import { create } from '../sim/vector';
import type { WorldBounds } from '../sim/boundary';

/** Deterministic LCG so numbers are reproducible. */
function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface FaceOccupancy {
  xMin: number;  // x < margin
  xMax: number;  // x > width - margin
  yMin: number;  // y < margin  (bottom)
  yMax: number;  // y > height - margin  (top)
  zMin: number;  // z < margin
  zMax: number;  // z > depth - margin
  total: number; // frames in ANY boundary layer
  frames: number;
}

function countFaceOccupancy(pos: { x: number; y: number; z: number }, bounds: WorldBounds, margin: number, occ: FaceOccupancy): void {
  occ.frames++;
  const inX = pos.x < margin;
  const inXMax = pos.x > bounds.width - margin;
  const inY = pos.y < margin;
  const inYMax = pos.y > bounds.height - margin;
  const inZ = pos.z < margin;
  const inZMax = pos.z > bounds.depth - margin;
  if (inX) occ.xMin++;
  if (inXMax) occ.xMax++;
  if (inY) occ.yMin++;
  if (inYMax) occ.yMax++;
  if (inZ) occ.zMin++;
  if (inZMax) occ.zMax++;
  if (inX || inXMax || inY || inYMax || inZ || inZMax) occ.total++;
}

function newOccupancy(): FaceOccupancy {
  return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0, total: 0, frames: 0 };
}

function printOccupancy(label: string, occ: FaceOccupancy, bounds: WorldBounds, margin: number): void {
  const f = occ.frames;
  const p = (n: number) => ((n / f) * 100).toFixed(1) + '%';
  console.log(`\n=== ${label} (${f} frames, margin=${margin}) ===`);
  console.log(`  ANY wall:  ${p(occ.total)} (${occ.total}/${f})`);
  console.log(`  x=0  (xMin): ${p(occ.xMin)}`);
  console.log(`  x=W  (xMax): ${p(occ.xMax)} [W=${bounds.width}]`);
  console.log(`  y=0  (BOTTOM): ${p(occ.yMin)} *** FLOOR ***`);
  console.log(`  y=H  (TOP):    ${p(occ.yMax)} [H=${bounds.height}]`);
  console.log(`  z=0  (zMin): ${p(occ.zMin)}`);
  console.log(`  z=D  (zMax): ${p(occ.zMax)} [D=${bounds.depth}]`);
}

function runProbe(seed: number, seconds: number, worldW: number, worldH: number): void {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.boidCount = 60;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.horseCount = 0;
  params.multicolorCount = 0;
  params.goldCount = 0;
  params.redCount = 0;
  params.blueCount = 0;
  params.predatorCatchEnabled = false; // Must be false per issue #253 measurement requirements

  const sim = new Simulation(worldW, worldH);
  const bounds: WorldBounds = { width: worldW, height: worldH, depth: params.worldDepth };
  const margin = params.boundaryMargin;

  const predOcc = newOccupancy();
  const boidOcc = newOccupancy();

  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(dt);
    for (const predator of sim.predators) {
      countFaceOccupancy(predator.position, bounds, margin, predOcc);
    }
    for (const boid of sim.boids) {
      countFaceOccupancy(boid.position, bounds, margin, boidOcc);
    }
  }

  const desc = `${worldW}x${worldH}x${params.worldDepth}, seed=${seed}, ${seconds}s`;
  console.log(`\n\n============================================================`);
  console.log(`PROBE: ${desc}`);
  printOccupancy('PREDATORS', predOcc, bounds, margin);
  printOccupancy('BOIDS (control)', boidOcc, bounds, margin);
}

// Run for several seeds
for (const seed of [1, 2, 3]) {
  runProbe(seed, 30, 1000, 1000);
}

// Also run with a "non-square" canvas to simulate realistic usage
for (const seed of [1, 2]) {
  runProbe(seed, 30, 1200, 600);
}

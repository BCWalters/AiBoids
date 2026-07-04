// Single source of truth for tunable simulation parameters.
// Both the ControlPanel (writer) and the Simulation/Boid/Predator (readers)
// share this object, so slider changes take effect immediately without
// resetting the simulation.

export type SimMode = '2d' | '3d';

export interface SimParams {
  // Rendering / dimensionality mode
  mode: SimMode;

  // Population
  boidCount: number;
  predatorCount: number;

  // Movement
  boidMaxSpeed: number;
  predatorMaxSpeed: number;
  maxForce: number; // steering force clamp, shared by boids and predators

  // Perception (boids)
  perceptionRadius: number;
  perceptionAngleDeg: number; // full field-of-view angle, centered on heading

  // Flocking rule weights (boids)
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  separationRadius: number; // distance at which separation kicks in (<= perceptionRadius)

  // Predator interaction
  panicRadius: number;
  fleeWeight: number;

  // Predator perception/behavior
  predatorPerceptionRadius: number;

  // 3D world bounds: a bounded box (not wraparound). Boids/predators steer
  // away softly as they approach a wall, rather than teleporting like the
  // 2D torus wraparound does.
  worldDepth: number; // z-axis size of the 3D world (x/y come from canvas size)
  boundaryMargin: number; // distance from a wall at which steer-away begins
  boundaryWeight: number; // strength of the steer-away force

  // 3D-only: a gentle, constant seek-to-center force, always active
  // (unlike boundaryWeight, which only kicks in near a wall). Without
  // this, cohesion tends to pin the whole flock against a wall or in a
  // corner once it drifts there, since only entities right at the edge
  // feel any push back — this keeps the flock cycling through open space.
  centerPullWeight: number;

  // Visuals (shared by both renderers): how strongly previous frames
  // persist, producing motion trails behind moving entities. 0 = no
  // trail (hard clear each frame). Keep below 1 (full persistence, trail
  // that never fades).
  trailAmount: number;

  // Simulation control
  running: boolean;
  showDebugOverlay: boolean;
}

export const defaultParams: SimParams = {
  mode: '2d',

  boidCount: 150,
  predatorCount: 2,

  boidMaxSpeed: 120,
  predatorMaxSpeed: 150,
  maxForce: 250,

  perceptionRadius: 70,
  perceptionAngleDeg: 270,

  separationWeight: 1.6,
  alignmentWeight: 1.0,
  cohesionWeight: 1.0,
  separationRadius: 24,

  panicRadius: 90,
  fleeWeight: 3.5,

  predatorPerceptionRadius: 220,

  worldDepth: 600,
  boundaryMargin: 120,
  boundaryWeight: 3.5,
  centerPullWeight: 0.1,

  trailAmount: 0.82,

  running: true,
  showDebugOverlay: false,
};

/** Mutable shared params instance. Mutate fields directly; do not reassign. */
export const params: SimParams = { ...defaultParams };

export function resetParams(): void {
  Object.assign(params, defaultParams);
}

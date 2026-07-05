// Single source of truth for tunable simulation parameters.
// Both the ControlPanel (writer) and the Simulation/Boid/Predator (readers)
// share this object, so slider changes take effect immediately without
// resetting the simulation.

export type SimMode = '2d' | '3d';

// 3D-only visual style: 'arcade' is the original glowing/neon instanced
// look; 'nature' swaps in a blue sky, drifting clouds, a ground plane,
// and more bird-like (earth-toned, fingered-wingtip) geometry aiming for
// "looks plausible from a distance" rather than true photo-realism.
export type VisualStyle = 'arcade' | 'nature';

export interface SimParams {
  // Rendering / dimensionality mode
  mode: SimMode;

  // Population
  boidCount: number;
  parrotCount: number;
  goldfinchCount: number;
  cardinalCount: number;
  bluejayCount: number;
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

  // 3D-only: which visual style Renderer3D uses. Purely cosmetic — has
  // no effect on simulation behavior.
  visualStyle: VisualStyle;

  // Nature-style only: render predators as large purple dragons (bat-like
  // membrane wings, long whip tail) instead of the default hawk geometry.
  // Purely cosmetic.
  dragonPredators: boolean;

  // Nature-style only: whether distance fog is applied in the 3D nature
  // scene. Fog hides seams at the world's edge (ground/mountains/ocean
  // fading into the sky), but disabling it is useful for inspecting
  // distant geometry (e.g. the ocean) that's otherwise heavily faded.
  fogEnabled: boolean;

  // When true (default), a predator that gets close enough to a boid
  // catches it — the boid is removed (with a brief cartoony "swallowed"
  // shrink + blood-splatter effect) and the predator pauses to glide to a
  // stop and "digest" for a few seconds before resuming the hunt. When
  // false, predators can chase boids forever but never actually catch them.
  predatorCatchEnabled: boolean;

  // Simulation control
  running: boolean;
  showDebugOverlay: boolean;
}

export const defaultParams: SimParams = {
  mode: '3d',

  boidCount: 150,
  parrotCount: 30,
  goldfinchCount: 25,
  cardinalCount: 25,
  bluejayCount: 25,
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

  visualStyle: 'nature',
  dragonPredators: true,
  fogEnabled: true,
  predatorCatchEnabled: true,

  running: true,
  showDebugOverlay: false,
};

/** Mutable shared params instance. Mutate fields directly; do not reassign. */
export const params: SimParams = { ...defaultParams };

export function resetParams(): void {
  Object.assign(params, defaultParams);
}

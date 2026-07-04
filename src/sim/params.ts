// Single source of truth for tunable simulation parameters.
// Both the ControlPanel (writer) and the Simulation/Boid/Predator (readers)
// share this object, so slider changes take effect immediately without
// resetting the simulation.

export interface SimParams {
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

  // Simulation control
  running: boolean;
  showDebugOverlay: boolean;
}

export const defaultParams: SimParams = {
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

  running: true,
  showDebugOverlay: false,
};

/** Mutable shared params instance. Mutate fields directly; do not reassign. */
export const params: SimParams = { ...defaultParams };

export function resetParams(): void {
  Object.assign(params, defaultParams);
}

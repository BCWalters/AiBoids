import * as V from './vector';
import type { Vec3 } from './vector';
import { params } from './params';
import type { Predator } from './Predator';
import { boundarySteer, type WorldBounds } from './boundary';

let nextId = 1;

/** How long (seconds) the "caught" shrink-and-slide-into-mouth animation lasts. */
export const DYING_DURATION = 0.35;

/**
 * Which flock a boid belongs to. Boids only align/cohere with same-species
 * neighbors (see the flocking loop in update()) — a mixed sparrow+parrot
 * scene reads as two independently-flocking groups sharing the same sky,
 * rather than one uniform flock, which is both more visually interesting
 * and closer to how real mixed-species bird gatherings behave. Separation
 * (basic collision avoidance) still applies across species, since birds of
 * any species still dodge each other rather than flying straight through.
 */
export type BoidSpecies = 'sparrow' | 'parrot' | 'goldfinch' | 'cardinal' | 'bluejay';

export class Boid {
  readonly id: number;
  readonly species: BoidSpecies;
  position: Vec3;
  velocity: Vec3;

  /**
   * Smoothed 0..1 "how panicked am I right now" level, driven by proximity
   * to the nearest threatening predator. Smoothed (rather than instant)
   * so the color-by-state rendering doesn't flicker as a boid crosses the
   * panic radius boundary. Read by both renderers to tint boids as they flee.
   */
  panicLevel = 0;

  /**
   * Set true the instant a predator catches this boid (see
   * Simulation.checkCatches). While dying, the boid ignores all normal
   * flocking/steering and instead animates a brief "swallowed" sequence:
   * shrinking and sliding toward the predator's position. Simulation
   * removes the boid from the active array once `dyingElapsed` passes
   * DYING_DURATION; syncPopulation() then naturally spawns a fresh boid
   * to replace it, keeping the population count stable.
   */
  dying = false;
  dyingElapsed = 0;
  deathTarget: Vec3 | null = null;
  /** 1 = full size, shrinks to 0 over the dying animation. Read by renderers. */
  scale = 1;
  /**
   * Last known non-zero velocity direction (unit vector), read only by
   * the 3D renderer to orient this boid's model. Kept as its own field
   * (rather than derived fresh from velocity every frame) so that once
   * velocity drops to ~0 — e.g. mid-"swallowed" animation — the model
   * keeps facing the direction it was last actually moving in instead of
   * snapping to some arbitrary default or bleeding another entity's
   * heading (see updateInstances in Renderer3D.ts).
   */
  renderHeading: Vec3 = { x: 0, y: 1, z: 0 };

  constructor(position: Vec3, velocity: Vec3, species: BoidSpecies = 'sparrow') {
    this.id = nextId++;
    this.species = species;
    this.position = position;
    this.velocity = velocity;
  }

  /** 2D heading angle, used only by the 2D canvas renderer. */
  get headingAngle(): number {
    return V.heading2D(this.velocity);
  }

  /**
   * Is `otherPos` within this boid's vision cone (radius + angle, centered
   * on current heading)? Works in both 2D and 3D since it's based on the
   * angle between the heading and direction-to-neighbor vectors, not atan2.
   * Neighbors directly on top of us (distance ~0) are always visible.
   */
  private canSee(otherPos: Vec3, radius: number, fovDeg: number): boolean {
    const toOther = V.sub(otherPos, this.position);
    const distSq = V.magnitudeSq(toOther);
    if (distSq > radius * radius) return false;
    if (distSq < 1e-6) return true;

    const speedSq = V.magnitudeSq(this.velocity);
    if (speedSq < 1e-6) return true; // stationary boid: treat as omnidirectional

    const angle = V.angleBetween(this.velocity, toOther);
    return angle <= (fovDeg * Math.PI) / 180 / 2;
  }

  /**
   * Compute one frame of steering + integration for this boid.
   * `allBoids` includes this boid itself (filtered out internally).
   * `bounds` is only used in 3D mode for wall steer-away.
   */
  update(dt: number, allBoids: Boid[], predators: Predator[], bounds: WorldBounds): void {
    if (this.dying) {
      // Ignore all normal flocking/steering — just slide toward the
      // predator's mouth and shrink away over DYING_DURATION. Simulation
      // removes this boid from the active array once dyingElapsed passes
      // DYING_DURATION.
      this.dyingElapsed += dt;
      const t = Math.min(1, this.dyingElapsed / DYING_DURATION);
      if (this.deathTarget) {
        this.position = V.add(this.position, V.scale(V.sub(this.deathTarget, this.position), Math.min(1, dt * 10)));
      }
      this.scale = Math.max(0, 1 - t);
      this.velocity = V.create();
      return;
    }

    const p = params;
    let acceleration = V.create();

    // --- Gather visible boid neighbors ---
    let sepSum = V.create();
    let sepCount = 0;
    let alignSum = V.create();
    let alignCount = 0;
    let cohesionSum = V.create();
    let cohesionCount = 0;

    for (const other of allBoids) {
      if (other === this) continue;
      if (!this.canSee(other.position, p.perceptionRadius, p.perceptionAngleDeg)) continue;

      const d = V.distance(this.position, other.position);

      if (d < p.separationRadius && d > 1e-6) {
        // Basic collision avoidance applies regardless of species — a
        // sparrow still dodges a nearby parrot, it just doesn't try to
        // align/flock with it.
        const away = V.scale(V.sub(this.position, other.position), 1 / d);
        sepSum = V.add(sepSum, away);
        sepCount++;
      }

      // Alignment/cohesion ("flocking" proper) only counts same-species
      // neighbors, so mixed-species scenes read as separate flocks sharing
      // the same sky rather than one uniform blended flock.
      if (other.species !== this.species) continue;

      alignSum = V.add(alignSum, other.velocity);
      alignCount++;

      cohesionSum = V.add(cohesionSum, other.position);
      cohesionCount++;
    }

    if (sepCount > 0) {
      const desired = V.setMagnitude(V.scale(sepSum, 1 / sepCount), p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration = V.add(acceleration, V.scale(steer, p.separationWeight));
    }

    if (alignCount > 0) {
      const avgVel = V.scale(alignSum, 1 / alignCount);
      const desired = V.setMagnitude(avgVel, p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration = V.add(acceleration, V.scale(steer, p.alignmentWeight));
    }

    if (cohesionCount > 0) {
      const center = V.scale(cohesionSum, 1 / cohesionCount);
      const desired = V.setMagnitude(V.sub(center, this.position), p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration = V.add(acceleration, V.scale(steer, p.cohesionWeight));
    }

    // --- Predator avoidance (flee): overrides other rules when close ---
    let fleeSum = V.create();
    let fleeCount = 0;
    let maxProximity = 0;
    for (const predator of predators) {
      const d = V.distance(this.position, predator.position);
      if (d < p.panicRadius && d > 1e-6) {
        // Closer predators produce a proportionally stronger push.
        const proximity = 1 - d / p.panicRadius; // 0..1, 1 = right on top of us
        const away = V.scale(V.sub(this.position, predator.position), proximity / d);
        fleeSum = V.add(fleeSum, away);
        fleeCount++;
        if (proximity > maxProximity) maxProximity = proximity;
      }
    }
    if (fleeCount > 0) {
      const desired = V.setMagnitude(fleeSum, p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration = V.add(acceleration, V.scale(steer, p.fleeWeight));
    }

    // Smooth panic level toward the current threat level (exponential
    // smoothing, framerate-independent) rather than snapping instantly.
    const panicSmoothing = 1 - Math.exp(-dt * 6);
    this.panicLevel += (maxProximity - this.panicLevel) * panicSmoothing;

    // --- 3D mode: steer away from the bounded world's walls, plus a
    // constant gentle pull toward the center so the flock keeps roaming
    // through open space instead of settling permanently at a wall/corner.
    if (p.mode === '3d') {
      const wallPush = boundarySteer(this.position, bounds, p.boundaryMargin);
      acceleration = V.add(acceleration, V.scale(wallPush, p.boundaryWeight));

      if (p.centerPullWeight > 0) {
        const center = V.create(bounds.width / 2, bounds.height / 2, bounds.depth / 2);
        const toCenter = V.sub(center, this.position);
        if (V.magnitudeSq(toCenter) > 1e-6) {
          const desired = V.setMagnitude(toCenter, p.boidMaxSpeed);
          const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
          acceleration = V.add(acceleration, V.scale(steer, p.centerPullWeight));
        }
      }
    }

    // --- Integrate ---
    this.velocity = V.limit(
      V.add(this.velocity, V.scale(acceleration, dt)),
      p.boidMaxSpeed,
    );
    this.position = V.add(this.position, V.scale(this.velocity, dt));
  }
}

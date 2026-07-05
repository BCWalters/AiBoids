import * as V from './vector';
import { params } from './params';
import { Boid, DYING_DURATION, type BoidSpecies } from './Boid';
import { Predator } from './Predator';
import { clampToBounds, type WorldBounds } from './boundary';

/** A single "predator caught a boid" moment — read by renderers to spawn a one-shot cartoony blood-splatter effect. Capped/pruned so the array never grows unbounded. */
export interface CatchEvent {
  id: number;
  position: V.Vec3;
  direction: V.Vec3;
}

// How close a predator must get to a boid to catch it. Deliberately a
// fixed sim-space distance (not tied to any renderer's visual predator
// size, since "dragon" predators are just a cosmetic geometry swap) —
// roughly on the same order as the boids' own separation radius, so a
// predator has to really close the gap, not just graze the flock.
const CATCH_RADIUS = 18;
// Bounded so a long-idle tab doesn't let this grow forever.
const MAX_CATCH_EVENTS = 16;

export class Simulation {
  width: number;
  height: number;
  boids: Boid[] = [];
  predators: Predator[] = [];
  catchEvents: CatchEvent[] = [];
  private nextCatchId = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.syncPopulation();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Current world bounds box, used for 3D wall steer-away. */
  private get bounds(): WorldBounds {
    return { width: this.width, height: this.height, depth: params.worldDepth };
  }

  private randomPosition() {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      z: params.mode === '3d' ? Math.random() * params.worldDepth : 0,
    };
  }

  private randomVelocity(maxSpeed: number) {
    const speed = maxSpeed * (0.4 + Math.random() * 0.6);
    if (params.mode === '3d') {
      return V.scale(V.randomUnit3D(), speed);
    }
    const angle = Math.random() * Math.PI * 2;
    return V.fromAngle2D(angle, speed);
  }

  /**
   * Adds/removes boids of one species to match a target count, leaving
   * the other species' boids untouched. Removals splice out matching-
   * species boids from wherever they happen to sit in the shared array
   * (order doesn't matter to the simulation or renderers) rather than
   * assuming they're contiguous.
   */
  private syncSpecies(species: BoidSpecies, targetCount: number): void {
    let count = 0;
    for (const boid of this.boids) if (boid.species === species) count++;

    while (count < targetCount) {
      this.boids.push(new Boid(this.randomPosition(), this.randomVelocity(params.boidMaxSpeed), species));
      count++;
    }

    let toRemove = count - targetCount;
    for (let i = this.boids.length - 1; i >= 0 && toRemove > 0; i--) {
      if (this.boids[i].species === species) {
        this.boids.splice(i, 1);
        toRemove--;
      }
    }
  }

  /** Adds/removes boids and predators to match params.<species>Count / predatorCount. */
  syncPopulation(): void {
    this.syncSpecies('sparrow', params.boidCount);
    this.syncSpecies('parrot', params.parrotCount);
    this.syncSpecies('goldfinch', params.goldfinchCount);
    this.syncSpecies('cardinal', params.cardinalCount);
    this.syncSpecies('bluejay', params.bluejayCount);

    while (this.predators.length < params.predatorCount) {
      this.predators.push(
        new Predator(this.randomPosition(), this.randomVelocity(params.predatorMaxSpeed)),
      );
    }
    while (this.predators.length > params.predatorCount) {
      this.predators.pop();
    }
  }

  /** Resets all entities to fresh random positions (used by the Reset button). */
  reset(): void {
    this.boids = [];
    this.predators = [];
    this.catchEvents = [];
    this.syncPopulation();
  }

  /** 2D mode only: torus wraparound at the world edges. */
  private wrap(pos: { x: number; y: number }): void {
    if (pos.x < 0) pos.x += this.width;
    else if (pos.x >= this.width) pos.x -= this.width;
    if (pos.y < 0) pos.y += this.height;
    else if (pos.y >= this.height) pos.y -= this.height;
  }

  /**
   * Any predator within CATCH_RADIUS of a (not-already-dying) boid catches
   * it: the boid enters its shrink-and-slide "swallowed" animation (see
   * Boid.update) and a CatchEvent is recorded for the renderers to spawn a
   * one-shot blood-splatter effect at. The catching predator then enters
   * its own "digesting" state (see Predator.updateDigesting) instead of
   * immediately continuing the hunt. Skipped entirely if the user has
   * turned off predatorCatchEnabled, and a predator that's already
   * digesting can't catch again until it resumes hunting.
   */
  private checkCatches(): void {
    if (!params.predatorCatchEnabled) return;

    for (const predator of this.predators) {
      if (predator.digesting) continue;
      for (const boid of this.boids) {
        if (boid.dying) continue;
        if (V.distanceSq(predator.position, boid.position) > CATCH_RADIUS * CATCH_RADIUS) continue;

        boid.dying = true;
        boid.dyingElapsed = 0;
        boid.deathTarget = { ...predator.position };

        const speed = V.magnitude(predator.velocity);
        const direction = speed > 1e-6 ? V.scale(predator.velocity, 1 / speed) : V.create(0, 0, 1);
        this.catchEvents.push({ id: this.nextCatchId++, position: { ...boid.position }, direction });
        if (this.catchEvents.length > MAX_CATCH_EVENTS) {
          this.catchEvents.splice(0, this.catchEvents.length - MAX_CATCH_EVENTS);
        }

        predator.beginDigesting();
        // A predator only catches one boid per catch check — break out
        // to its next iteration rather than immediately gobbling every
        // boid within range in the same frame.
        break;
      }
    }
  }

  update(dt: number): void {
    this.syncPopulation();
    if (!params.running) return;

    const bounds = this.bounds;
    const is3D = params.mode === '3d';

    for (const boid of this.boids) {
      boid.update(dt, this.boids, this.predators, bounds);
      if (is3D) clampToBounds(boid.position, bounds);
      else this.wrap(boid.position);
    }
    for (const predator of this.predators) {
      predator.update(dt, this.boids, bounds);
      if (is3D) clampToBounds(predator.position, bounds);
      else this.wrap(predator.position);
    }

    this.checkCatches();

    // Remove boids whose "swallowed" animation has finished; syncPopulation
    // will spawn a fresh replacement boid next frame automatically.
    this.boids = this.boids.filter((boid) => !boid.dying || boid.dyingElapsed < DYING_DURATION);
  }
}

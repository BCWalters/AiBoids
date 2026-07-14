import * as V from './vector';
import { params } from './params';
import { Boid, DYING_DURATION, type BoidSpecies } from './Boid';
import { Predator, type PredatorKind } from './Predator';
import { clampToBounds, type WorldBounds } from './boundary';
import { UFO, createUFO } from './UFO';
import { SpatialGrid } from './spatialGrid';

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

// How many alien-invasion saucers can be active at once. Each one is
// fully independent (its own descend/beam/ascend lifecycle and flock-
// centroid tracking), so multiple can be in flight simultaneously.
export const MAX_CONCURRENT_UFOS = 5;

// How long a UFO-abducted boid stays "gone" before flying back out of the
// coop — instant respawn (still used for ordinary predator catches, which
// weren't part of this complaint) read as barely-noticeable population
// churn, but for a dramatic "the flock gets sucked into a spaceship" event
// popping a replacement back in immediately undercut it entirely.
const UFO_RESPAWN_DELAY = 15;
// How long a freshly coop-spawned boid keeps its own outward heading (see
// Boid.spawnBurstRemaining) before rejoining normal flocking.
const SPAWN_BURST_DURATION = 2;
// Speed range (as a fraction of boidMaxSpeed) for the coop "fly-out" burst.
const SPAWN_BURST_SPEED_MIN = 0.5;
const SPAWN_BURST_SPEED_MAX = 0.8;

/** A boid removed via UFO abduction, waiting to fly back out of the coop. */
interface PendingRespawn {
  species: BoidSpecies;
  readyAt: number;
}

export class Simulation {
  width: number;
  height: number;
  boids: Boid[] = [];
  predators: Predator[] = [];
  catchEvents: CatchEvent[] = [];
  /** Active "Alien Invasion" saucers (up to MAX_CONCURRENT_UFOS at once). Read directly by Renderer3D. */
  ufos: UFO[] = [];
  /** Total sim time elapsed (seconds), used to time delayed coop respawns. Only advances while running. */
  elapsedTime = 0;
  /** Boids abducted by the UFO, waiting on their delayed coop respawn. Read by the UI to enable a manual "respawn now" action. */
  pendingRespawns: PendingRespawn[] = [];
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
   *
   * Pending coop respawns (see pendingRespawns) count toward the target
   * just like live boids do — otherwise, the instant a UFO-abducted boid
   * is actually removed from `this.boids`, this would see the population
   * dip below target and spawn an *immediate* replacement, defeating the
   * whole point of the delayed coop respawn.
   */
  private syncSpecies(species: BoidSpecies, targetCount: number): void {
    let count = 0;
    for (const boid of this.boids) if (boid.species === species) count++;
    for (const pending of this.pendingRespawns) if (pending.species === species) count++;

    while (count < targetCount) {
      this.boids.push(new Boid(this.randomPosition(), this.randomVelocity(params.boidMaxSpeed), species));
      count++;
    }

    let toRemove = count - targetCount;
    // Cancel pending respawns first — they don't exist as boids yet, so
    // dropping one is cheaper/less disruptive than despawning a live boid.
    for (let i = this.pendingRespawns.length - 1; i >= 0 && toRemove > 0; i--) {
      if (this.pendingRespawns[i].species === species) {
        this.pendingRespawns.splice(i, 1);
        toRemove--;
      }
    }
    for (let i = this.boids.length - 1; i >= 0 && toRemove > 0; i--) {
      if (this.boids[i].species === species) {
        this.boids.splice(i, 1);
        toRemove--;
      }
    }
  }

  /**
   * Spawns one boid at the ground-level "coop" location with an outward,
   * randomized-direction burst velocity and a brief spawnBurstRemaining
   * window (flocking suspended — see Boid.spawnBurstRemaining) rather
   * than just popping into a random spot mid-air already flocking.
   */
  private spawnFromCoop(species: BoidSpecies): void {
    const bounds = this.bounds;
    // Ground level, roughly centered — a fixed, single "coop" spot rather
    // than a random position, so it reads as one consistent place birds
    // fly out from rather than scattered mid-air pop-ins.
    const coopPosition: V.Vec3 = {
      x: bounds.width / 2 + (Math.random() - 0.5) * 20,
      y: Math.max(5, bounds.height * 0.05),
      z: bounds.depth / 2 + (Math.random() - 0.5) * 20,
    };

    // Mostly-horizontal random direction with a bit of upward tilt, so
    // the burst reads as birds scattering outward from the coop rather
    // than shooting straight up or staying flat along the ground.
    const angle = Math.random() * Math.PI * 2;
    const upBias = 0.25 + Math.random() * 0.35;
    const horizontalScale = Math.sqrt(Math.max(0, 1 - upBias * upBias));
    const dir = V.normalize(
      V.create(Math.cos(angle) * horizontalScale, upBias, Math.sin(angle) * horizontalScale),
    );
    const speed = params.boidMaxSpeed * (SPAWN_BURST_SPEED_MIN + Math.random() * (SPAWN_BURST_SPEED_MAX - SPAWN_BURST_SPEED_MIN));

    const boid = new Boid(coopPosition, V.scale(dir, speed), species);
    boid.spawnBurstRemaining = SPAWN_BURST_DURATION;
    this.boids.push(boid);
  }

  /** Moves any pending coop respawns whose delay has elapsed into actual boids. */
  private processPendingRespawns(): void {
    if (this.pendingRespawns.length === 0) return;
    const remaining: PendingRespawn[] = [];
    for (const pending of this.pendingRespawns) {
      if (pending.readyAt <= this.elapsedTime) {
        this.spawnFromCoop(pending.species);
      } else {
        remaining.push(pending);
      }
    }
    this.pendingRespawns = remaining;
  }

  /**
   * Manual "respawn now" action — immediately flies every currently
   * pending abducted boid back out of the coop, instead of waiting out
   * UFO_RESPAWN_DELAY. A no-op when nothing is pending.
   */
  respawnPendingNow(): void {
    if (this.pendingRespawns.length === 0) return;
    for (const pending of this.pendingRespawns) this.spawnFromCoop(pending.species);
    this.pendingRespawns = [];
  }

  /**
   * Adds/removes predators of one kind to match a target count, leaving
   * the other kind's predators untouched — mirrors syncSpecies' approach
   * for boids, since hawks/dragons and unicorns are independent
   * populations that can coexist (see Predator.kind).
   */
  private syncPredatorKind(kind: PredatorKind, targetCount: number): void {
    let count = 0;
    for (const predator of this.predators) if (predator.kind === kind) count++;

    while (count < targetCount) {
      this.predators.push(
        new Predator(this.randomPosition(), this.randomVelocity(params.predatorMaxSpeed), kind),
      );
      count++;
    }

    let toRemove = count - targetCount;
    for (let i = this.predators.length - 1; i >= 0 && toRemove > 0; i--) {
      if (this.predators[i].kind === kind) {
        this.predators.splice(i, 1);
        toRemove--;
      }
    }
  }

  /** Adds/removes boids and predators to match params.<species>Count / predatorCount / unicornCount. */
  syncPopulation(): void {
    this.syncSpecies('sparrow', params.boidCount);
    this.syncSpecies('parrot', params.parrotCount);
    this.syncSpecies('goldfinch', params.goldfinchCount);
    this.syncSpecies('cardinal', params.cardinalCount);
    this.syncSpecies('bluejay', params.bluejayCount);

    this.syncPredatorKind('hawk', params.predatorCount);
    this.syncPredatorKind('unicorn', params.unicornCount);
  }

  /** Resets all entities to fresh random positions (used by the Reset button). */
  reset(): void {
    this.boids = [];
    this.predators = [];
    this.catchEvents = [];
    this.ufos = [];
    this.pendingRespawns = [];
    this.syncPopulation();
  }

  /**
   * Triggers a one-shot "Alien Invasion": a flying saucer descends from
   * high above at a somewhat random angle, hovers over the flock,
   * tractor-beams nearby boids aboard for a few seconds, then leaves.
   * 3D-mode only (a saucer "descending from above" has no sensible
   * meaning in the top-down 2D view). Up to MAX_CONCURRENT_UFOS saucers
   * can be active at once — a no-op once that many are already in
   * flight.
   */
  spawnUFO(): void {
    if (params.mode !== '3d' || this.ufos.length >= MAX_CONCURRENT_UFOS) return;
    this.ufos.push(createUFO(this.boids, this.bounds, this.ufos));
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
      // Unicorns gently chase boids but never catch them — see
      // Predator.kind's doc comment.
      if (predator.kind === 'unicorn') continue;
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
    if (params.running) {
      this.elapsedTime += dt;
      this.processPendingRespawns();
    }
    this.syncPopulation();
    if (!params.running) return;

    const bounds = this.bounds;
    const is3D = params.mode === '3d';

    // Broad-phase spatial index so each boid's neighbor search only
    // checks nearby candidates instead of scanning every boid in the
    // flock (O(n) per boid instead of O(n) full-array, i.e. overall
    // O(n) rather than O(n^2) — this matters a lot once population
    // sliders are pushed toward their max, where a full-array scan per
    // boid becomes the dominant per-frame cost). Cell size matches
    // perceptionRadius (the largest radius a boid ever queries with),
    // which is the standard choice for a uniform grid: checking a
    // point's cell plus its immediate neighborhood is then guaranteed
    // to capture every boid within perceptionRadius, same as before —
    // Boid.canSee still applies the exact distance/FOV filter on the
    // smaller candidate set, so results are unchanged, just faster.
    // Rebuilt fresh every frame since boids move continuously.
    const neighborGrid = new SpatialGrid<Boid>(params.perceptionRadius);
    for (const boid of this.boids) neighborGrid.insert(boid);

    for (const boid of this.boids) {
      const candidates = neighborGrid.queryNearby(boid.position);
      boid.update(dt, candidates, this.predators, bounds);
      if (is3D) clampToBounds(boid.position, bounds);
      else this.wrap(boid.position);
    }
    for (const predator of this.predators) {
      predator.update(dt, this.boids, this.predators, bounds);
      if (is3D) clampToBounds(predator.position, bounds);
      else this.wrap(predator.position);
    }

    this.checkCatches();

    if (this.ufos.length > 0) {
      for (const ufo of this.ufos) ufo.update(dt, this.boids, bounds);
      this.ufos = this.ufos.filter((ufo) => !ufo.done);
    }

    // Remove boids whose "swallowed" animation has finished. UFO-abducted
    // ones go into the delayed coop-respawn queue (see pendingRespawns/
    // spawnFromCoop) instead of syncPopulation instantly refilling them
    // next frame the way ordinary predator catches still do.
    const stillAlive: Boid[] = [];
    for (const boid of this.boids) {
      const finishedDying = boid.dying && boid.dyingElapsed >= DYING_DURATION;
      if (finishedDying && boid.abductedByUFO) {
        this.pendingRespawns.push({ species: boid.species, readyAt: this.elapsedTime + UFO_RESPAWN_DELAY });
      }
      if (!finishedDying) stillAlive.push(boid);
    }
    this.boids = stillAlive;
  }
}

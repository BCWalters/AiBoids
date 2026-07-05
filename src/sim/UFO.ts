import * as V from './vector';
import type { Vec3 } from './vector';
import type { Boid } from './Boid';
import type { WorldBounds } from './boundary';

export type UFOPhase = 'descending' | 'beaming' | 'ascending';

const DESCEND_SPEED = 220;
const ASCEND_SPEED = 300;
// How long the saucer lingers over the flock actively abducting boids
// before giving up and heading back out, even if it hasn't caught many.
const BEAM_DURATION = 8;
// Horizontal (xz) radius of the tractor beam's pull cone, centered under
// the saucer — boids inside this radius (and below the saucer) get
// dragged upward/inward regardless of their own flocking urges. Kept
// fairly tight so the beam reads as a focused shaft rather than
// vacuuming the whole sky at once.
const BEAM_RADIUS = 85;
// Acceleration applied to boids caught in the beam, scaled by the beam's
// smoothed on/off strength so the pull ramps in rather than snapping on.
// Tuned to be a strong, unmistakable pull without being so fast that a
// boid crosses the whole beam radius in a single frame or two.
const BEAM_PULL_FORCE = 500;
// Distance from the saucer at which a boid is considered "aboard" and
// removed from the simulation (reuses Boid's existing shrink-and-slide
// "dying" animation, same one predators use when they catch prey).
const ABDUCTION_RADIUS = 40;
// Caps how many boids one invasion can abduct before departing early —
// without this, since Simulation.syncPopulation() instantly respawns a
// fresh boid elsewhere to replace each abducted one, a long beam session
// would cycle through (and visually scatter) far more boids than the
// flock actually contains, reading as chaotic rather than a dramatic
// "the flock gets sucked up" moment.
const MAX_ABDUCTIONS = 40;
// How far above the flock's altitude the saucer hovers while beaming —
// high enough to look like it's scooping them up from above, not just
// sitting in the middle of the flock.
const HOVER_MARGIN = 170;
// Exported so Renderer3D can size the visual tractor-beam cone to
// plausibly reach from the saucer's hover altitude down to the flock,
// without needing to duplicate this tuning constant.
export const UFO_BEAM_REACH = HOVER_MARGIN * 1.4;

/**
 * A flying-saucer "alien invasion" one-shot event: descends from high
 * above at a somewhat random angle, hovers over the flock and engages a
 * tractor beam that abducts nearby boids, then flies back off. Purely a
 * 3D-mode feature (no 2D representation) — see Simulation.spawnUFO for
 * how one gets created, and Renderer3D for the saucer/beam visuals.
 *
 * Lifecycle is driven entirely by `update()`; Simulation discards this
 * object once `done` becomes true.
 */
export class UFO {
  position: Vec3;
  velocity: Vec3;
  phase: UFOPhase = 'descending';
  beamElapsed = 0;
  abductedCount = 0;
  /** Smoothed 0..1 beam on/off strength — read by the renderer to fade the beam cone in/out rather than popping. */
  beamStrength = 0;
  /** Set true once the saucer has climbed back out of the world; Simulation drops the reference at that point. */
  done = false;

  private hoverY: number;

  constructor(position: Vec3, velocity: Vec3, hoverY: number) {
    this.position = position;
    this.velocity = velocity;
    this.hoverY = hoverY;
  }

  private flockCentroid(boids: Boid[]): Vec3 | null {
    if (boids.length === 0) return null;
    let sum = V.create();
    let count = 0;
    for (const boid of boids) {
      if (boid.dying) continue;
      sum = V.add(sum, boid.position);
      count++;
    }
    if (count === 0) return null;
    return V.scale(sum, 1 / count);
  }

  update(dt: number, boids: Boid[], bounds: WorldBounds): void {
    if (this.phase === 'descending') {
      this.position = V.add(this.position, V.scale(this.velocity, dt));
      if (this.position.y <= this.hoverY) {
        this.phase = 'beaming';
      }
      return;
    }

    if (this.phase === 'beaming') {
      this.beamElapsed += dt;
      const smoothing = 1 - Math.exp(-dt * 4);
      this.beamStrength += (1 - this.beamStrength) * smoothing;

      // Gently drift to stay over the flock's current centroid rather than
      // hovering at a fixed point while boids flee out from underneath.
      const centroid = this.flockCentroid(boids);
      if (centroid) {
        const toCentroid = V.sub(V.create(centroid.x, this.position.y, centroid.z), this.position);
        this.position = V.add(this.position, V.scale(toCentroid, Math.min(1, dt * 0.6)));
      }

      for (const boid of boids) {
        if (boid.dying) continue;
        if (boid.position.y > this.position.y) continue; // beam only pulls things below the saucer

        const dx = boid.position.x - this.position.x;
        const dz = boid.position.z - this.position.z;
        if (dx * dx + dz * dz > BEAM_RADIUS * BEAM_RADIUS) continue;

        const toUfo = V.sub(this.position, boid.position);
        const dist = V.magnitude(toUfo);
        if (dist < ABDUCTION_RADIUS) {
          boid.dying = true;
          boid.dyingElapsed = 0;
          boid.deathTarget = { ...this.position };
          this.abductedCount++;
          continue;
        }

        const pull = V.scale(V.normalize(toUfo), BEAM_PULL_FORCE * this.beamStrength);
        boid.velocity = V.add(boid.velocity, V.scale(pull, dt));
      }

      if (this.beamElapsed > BEAM_DURATION || this.abductedCount >= MAX_ABDUCTIONS) {
        this.phase = 'ascending';
        // Keep a bit of horizontal drift so it doesn't snap to a perfectly
        // vertical exit, but climb steeply.
        this.velocity = V.create(this.velocity.x * 0.25, ASCEND_SPEED, this.velocity.z * 0.25);
      }
      return;
    }

    // Ascending: climb straight out, fading the beam as it goes.
    this.beamStrength = Math.max(0, this.beamStrength - this.beamStrength * Math.min(1, dt * 3));
    this.position = V.add(this.position, V.scale(this.velocity, dt));
    if (this.position.y > bounds.height + HOVER_MARGIN * 6) {
      this.done = true;
    }
  }
}

/**
 * Builds a fresh UFO positioned high above (and somewhat to the side of)
 * the current flock centroid, descending at a somewhat random angle
 * rather than dropping straight down. `bounds` gives the world's current
 * size so the spawn/hover altitudes scale sensibly with worldDepth/height.
 */
export function createUFO(boids: Boid[], bounds: WorldBounds): UFO {
  let centroid = V.create(bounds.width / 2, bounds.height / 2, bounds.depth / 2);
  if (boids.length > 0) {
    let sum = V.create();
    for (const boid of boids) sum = V.add(sum, boid.position);
    centroid = V.scale(sum, 1 / boids.length);
  }

  const spawnHeight = bounds.height + HOVER_MARGIN * 5;
  const hoverY = Math.min(spawnHeight - HOVER_MARGIN, centroid.y + HOVER_MARGIN);

  // Random horizontal offset so the saucer doesn't always appear directly
  // over the flock's centroid — it has to travel to find it, giving the
  // "somewhat random angle from above" look the user asked for.
  const offsetAngle = Math.random() * Math.PI * 2;
  const offsetRadius = Math.max(bounds.width, bounds.depth) * (0.3 + Math.random() * 0.3);
  const startX = centroid.x + Math.cos(offsetAngle) * offsetRadius;
  const startZ = centroid.z + Math.sin(offsetAngle) * offsetRadius;
  const start = V.create(startX, spawnHeight, startZ);

  const toTarget = V.sub(V.create(centroid.x, hoverY, centroid.z), start);
  const dir = V.normalize(toTarget);
  const velocity = V.scale(dir, DESCEND_SPEED);

  return new UFO(start, velocity, hoverY);
}

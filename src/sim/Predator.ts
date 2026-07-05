import * as V from './vector';
import type { Vec3 } from './vector';
import { params } from './params';
import { Boid } from './Boid';
import { boundarySteer, type WorldBounds } from './boundary';

let nextId = 1;

// How long (seconds) a predator takes to glide to a full stop after
// catching prey, and how long it then rests in place "digesting" before
// resuming the hunt. Kept as module-level tuning constants rather than
// exposed params since the user only asked for an on/off toggle for the
// catch mechanic itself, not fine control over the timing.
export const DIGEST_GLIDE_DURATION = 0.6;
export const DIGEST_WAIT_DURATION = 3.5;

export class Predator {
  readonly id: number;
  position: Vec3;
  velocity: Vec3;

  /**
   * Smoothed 0..1 "how locked-on am I right now" level, driven by how
   * close the nearest visible boid is. 0 when no prey is visible at all.
   * Read by both renderers to make an actively hunting predator visually
   * more intense than one that's just cruising/searching.
   */
  huntIntensity = 0;

  /**
   * Set true the instant this predator catches a boid (see
   * Simulation.checkCatches). While digesting, the predator ignores prey
   * pursuit entirely: it glides to a stop over DIGEST_GLIDE_DURATION, then
   * sits still for DIGEST_WAIT_DURATION before resuming the hunt (picking
   * up the nearest boid if one's visible, or heading off in a fresh
   * random direction otherwise).
   */
  digesting = false;
  digestElapsed = 0;

  /**
   * Last known non-zero velocity direction (unit vector), read only by
   * the 3D renderer to orient this predator's model — see
   * Boid.renderHeading for why this needs to be its own per-entity field
   * rather than derived fresh from velocity every frame (velocity is ~0
   * for the whole digesting glide-to-stop + rest period).
   */
  renderHeading: Vec3 = { x: 0, y: 1, z: 0 };

  /**
   * Unit heading captured at the moment of catching prey (before the
   * glide-to-stop decay begins touching velocity). Used to resume on the
   * same trajectory afterwards instead of picking an arbitrary new one,
   * so the predator doesn't visually snap/flip direction on waking.
   */
  private preDigestHeading: Vec3 = V.create(0, 0, 1);

  /**
   * True for the brief window after digesting ends but before the
   * predator has spun back up to a reasonable cruising speed (only used
   * when no boid was visible to chase immediately on waking). While true,
   * update() gently accelerates along preDigestHeading using the same
   * maxForce-limited steering as normal pursuit, so speed ramps up
   * smoothly instead of snapping straight to full speed.
   */
  private resuming = false;

  constructor(position: Vec3, velocity: Vec3) {
    this.id = nextId++;
    this.position = position;
    this.velocity = velocity;
  }

  /**
   * Called by Simulation right when this predator catches a boid, before
   * updateDigesting starts decaying velocity, so the heading it captures
   * reflects the direction the predator was actually flying at the
   * moment of the catch.
   */
  beginDigesting(): void {
    this.digesting = true;
    this.digestElapsed = 0;
    const speed = V.magnitude(this.velocity);
    this.preDigestHeading = speed > 1e-6 ? V.scale(this.velocity, 1 / speed) : this.preDigestHeading;
  }

  /** 2D heading angle, used only by the 2D canvas renderer. */
  get headingAngle(): number {
    return V.heading2D(this.velocity);
  }

  /**
   * Simple pursuit: steer toward the nearest visible boid. If none are
   * within perception range, steer toward the center of mass of visible
   * boids instead. If no boids are visible at all, keep drifting on the
   * current heading. `bounds` is only used in 3D mode for wall steer-away.
   */
  update(dt: number, boids: Boid[], bounds: WorldBounds): void {
    if (this.digesting) {
      this.updateDigesting(dt, boids, bounds);
      return;
    }

    const p = params;
    let nearest: Boid | null = null;
    let nearestDistSq = p.predatorPerceptionRadius * p.predatorPerceptionRadius;
    let centerSum = V.create();
    let centerCount = 0;

    for (const boid of boids) {
      const distSq = V.distanceSq(this.position, boid.position);
      if (distSq > p.predatorPerceptionRadius * p.predatorPerceptionRadius) continue;

      centerSum = V.add(centerSum, boid.position);
      centerCount++;

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = boid;
      }
    }

    let acceleration = V.create();
    const target = nearest
      ? nearest.position
      : centerCount > 0
        ? V.scale(centerSum, 1 / centerCount)
        : null;

    if (target) {
      const desired = V.setMagnitude(V.sub(target, this.position), p.predatorMaxSpeed);
      acceleration = V.limit(V.sub(desired, this.velocity), p.maxForce);
      // A boid came into view — no need to keep spooling up along the
      // old pre-digest heading, normal pursuit takes over.
      this.resuming = false;
    } else if (this.resuming) {
      // No prey visible yet after waking from digesting: keep gently
      // accelerating along the trajectory we were on right before the
      // catch, using the same maxForce-limited steering as a normal
      // chase so the speed-up reads as smooth rather than an instant jump.
      const desired = V.scale(this.preDigestHeading, p.predatorMaxSpeed);
      acceleration = V.limit(V.sub(desired, this.velocity), p.maxForce);
      if (V.magnitude(this.velocity) >= p.predatorMaxSpeed * 0.9) {
        this.resuming = false;
      }
    }

    // Smooth hunt intensity toward how close the nearest prey is (0 if
    // none visible), so the color-by-state highlight fades in/out smoothly.
    const targetIntensity = nearest
      ? 1 - Math.sqrt(nearestDistSq) / p.predatorPerceptionRadius
      : 0;
    const huntSmoothing = 1 - Math.exp(-dt * 4);
    this.huntIntensity += (targetIntensity - this.huntIntensity) * huntSmoothing;

    if (p.mode === '3d') {
      const wallPush = boundarySteer(this.position, bounds, p.boundaryMargin, p.maxForce);
      acceleration = V.add(acceleration, V.scale(wallPush, p.boundaryWeight));

      if (p.centerPullWeight > 0) {
        const center = V.create(bounds.width / 2, bounds.height / 2, bounds.depth / 2);
        const toCenter = V.sub(center, this.position);
        if (V.magnitudeSq(toCenter) > 1e-6) {
          const desired = V.setMagnitude(toCenter, p.predatorMaxSpeed);
          const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
          // Predators get a lighter pull than boids so it doesn't fight
          // active pursuit, just prevents idle corner-parking when no
          // prey is nearby.
          acceleration = V.add(acceleration, V.scale(steer, p.centerPullWeight * 0.5));
        }
      }
    }

    this.velocity = V.limit(
      V.add(this.velocity, V.scale(acceleration, dt)),
      p.predatorMaxSpeed,
    );
    this.position = V.add(this.position, V.scale(this.velocity, dt));
  }

  /**
   * "Caught prey" behavior: glide smoothly to a stop, then sit still for
   * a few seconds before resuming the hunt. Runs instead of the normal
   * pursuit/flocking-avoidance logic while `digesting` is true.
   */
  private updateDigesting(dt: number, boids: Boid[], bounds: WorldBounds): void {
    const p = params;
    this.digestElapsed += dt;

    if (this.digestElapsed <= DIGEST_GLIDE_DURATION) {
      // Exponential decay brings velocity smoothly to (near) zero well
      // within the glide window, reading as "gliding to a stop" rather
      // than an abrupt halt.
      this.velocity = V.scale(this.velocity, Math.exp(-dt * 6));
      // Still gently steer off a wall even while gliding to a stop, so a
      // predator that catches prey right at the world's edge doesn't
      // visually clip through it.
      if (p.mode === '3d') {
        const wallPush = boundarySteer(this.position, bounds, p.boundaryMargin, p.maxForce);
        this.velocity = V.add(this.velocity, V.scale(wallPush, p.boundaryWeight * dt));
      }
      this.position = V.add(this.position, V.scale(this.velocity, dt));
    } else {
      // Fully stopped and resting/"digesting" — no movement at all.
      this.velocity = V.create();
    }

    // Hunt intensity relaxes to 0 while digesting — a resting predator
    // shouldn't read as actively locked-on.
    const huntSmoothing = 1 - Math.exp(-dt * 4);
    this.huntIntensity += (0 - this.huntIntensity) * huntSmoothing;

    const totalDigestDuration = DIGEST_GLIDE_DURATION + DIGEST_WAIT_DURATION;
    if (this.digestElapsed >= totalDigestDuration) {
      this.digesting = false;
      this.digestElapsed = 0;

      // Resume the hunt: if a boid is currently visible, normal pursuit
      // logic (next frame's update()) will immediately steer toward it,
      // ramping up smoothly from zero via the usual maxForce-limited
      // steering. Otherwise, spool back up along the same heading the
      // predator was flying right before it caught its prey — `resuming`
      // tells update() to keep accelerating along preDigestHeading
      // (rather than snapping straight to speed) until back up to a
      // reasonable cruising velocity.
      const hasVisibleBoid = boids.some(
        (boid) => V.distanceSq(this.position, boid.position) <= p.predatorPerceptionRadius * p.predatorPerceptionRadius,
      );
      this.resuming = !hasVisibleBoid;
    }
  }
}

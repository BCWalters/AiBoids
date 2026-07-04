import * as V from './vector';
import type { Vec3 } from './vector';
import { params } from './params';
import { Boid } from './Boid';
import { boundarySteer, type WorldBounds } from './boundary';

let nextId = 1;

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

  constructor(position: Vec3, velocity: Vec3) {
    this.id = nextId++;
    this.position = position;
    this.velocity = velocity;
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
    }

    // Smooth hunt intensity toward how close the nearest prey is (0 if
    // none visible), so the color-by-state highlight fades in/out smoothly.
    const targetIntensity = nearest
      ? 1 - Math.sqrt(nearestDistSq) / p.predatorPerceptionRadius
      : 0;
    const huntSmoothing = 1 - Math.exp(-dt * 4);
    this.huntIntensity += (targetIntensity - this.huntIntensity) * huntSmoothing;

    if (p.mode === '3d') {
      const wallPush = boundarySteer(this.position, bounds, p.boundaryMargin);
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
}

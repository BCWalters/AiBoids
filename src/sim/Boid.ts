import * as V from './vector';
import type { Vec3 } from './vector';
import { params } from './params';
import type { Predator } from './Predator';
import { boundarySteer, type WorldBounds } from './boundary';

let nextId = 1;

export class Boid {
  readonly id: number;
  position: Vec3;
  velocity: Vec3;

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
        // Push away, weighted more strongly the closer the neighbor is.
        const away = V.scale(V.sub(this.position, other.position), 1 / d);
        sepSum = V.add(sepSum, away);
        sepCount++;
      }

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
    for (const predator of predators) {
      const d = V.distance(this.position, predator.position);
      if (d < p.panicRadius && d > 1e-6) {
        // Closer predators produce a proportionally stronger push.
        const proximity = 1 - d / p.panicRadius; // 0..1, 1 = right on top of us
        const away = V.scale(V.sub(this.position, predator.position), proximity / d);
        fleeSum = V.add(fleeSum, away);
        fleeCount++;
      }
    }
    if (fleeCount > 0) {
      const desired = V.setMagnitude(fleeSum, p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration = V.add(acceleration, V.scale(steer, p.fleeWeight));
    }

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

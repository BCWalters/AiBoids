import * as V from './vector';
import type { Vec2 } from './vector';
import { params } from './params';
import type { Predator } from './Predator';

let nextId = 1;

export class Boid {
  readonly id: number;
  position: Vec2;
  velocity: Vec2;

  constructor(position: Vec2, velocity: Vec2) {
    this.id = nextId++;
    this.position = position;
    this.velocity = velocity;
  }

  get headingAngle(): number {
    return V.heading(this.velocity);
  }

  /**
   * Is `otherPos` within this boid's vision cone (radius + angle, centered
   * on current heading)? Neighbors directly on top of us (distance ~0) are
   * always considered visible regardless of angle.
   */
  private canSee(otherPos: Vec2, radius: number, fovDeg: number): boolean {
    const toOther = V.sub(otherPos, this.position);
    const distSq = V.magnitudeSq(toOther);
    if (distSq > radius * radius) return false;
    if (distSq < 1e-6) return true;

    const speedSq = V.magnitudeSq(this.velocity);
    if (speedSq < 1e-6) return true; // stationary boid: treat as omnidirectional

    const angleToOther = V.heading(toOther);
    const diff = Math.abs(V.angleDiff(this.headingAngle, angleToOther));
    return diff <= (fovDeg * Math.PI) / 180 / 2;
  }

  /**
   * Compute one frame of steering + integration for this boid.
   * `allBoids` includes this boid itself (filtered out internally).
   */
  update(dt: number, allBoids: Boid[], predators: Predator[]): void {
    const p = params;
    const acceleration = V.create();

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
      acceleration.x += steer.x * p.separationWeight;
      acceleration.y += steer.y * p.separationWeight;
    }

    if (alignCount > 0) {
      const avgVel = V.scale(alignSum, 1 / alignCount);
      const desired = V.setMagnitude(avgVel, p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration.x += steer.x * p.alignmentWeight;
      acceleration.y += steer.y * p.alignmentWeight;
    }

    if (cohesionCount > 0) {
      const center = V.scale(cohesionSum, 1 / cohesionCount);
      const desired = V.setMagnitude(V.sub(center, this.position), p.boidMaxSpeed);
      const steer = V.limit(V.sub(desired, this.velocity), p.maxForce);
      acceleration.x += steer.x * p.cohesionWeight;
      acceleration.y += steer.y * p.cohesionWeight;
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
      acceleration.x += steer.x * p.fleeWeight;
      acceleration.y += steer.y * p.fleeWeight;
    }

    // --- Integrate ---
    this.velocity = V.limit(
      V.add(this.velocity, V.scale(acceleration, dt)),
      p.boidMaxSpeed,
    );
    this.position = V.add(this.position, V.scale(this.velocity, dt));
  }
}

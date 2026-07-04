import * as V from './vector';
import type { Vec2 } from './vector';
import { params } from './params';
import { Boid } from './Boid';

let nextId = 1;

export class Predator {
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
   * Simple pursuit: steer toward the nearest visible boid. If none are
   * within perception range, steer toward the center of mass of visible
   * boids instead. If no boids are visible at all, keep drifting on the
   * current heading.
   */
  update(dt: number, boids: Boid[]): void {
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

    this.velocity = V.limit(
      V.add(this.velocity, V.scale(acceleration, dt)),
      p.predatorMaxSpeed,
    );
    this.position = V.add(this.position, V.scale(this.velocity, dt));
  }
}

import * as V from './vector';
import { params } from './params';
import { Boid } from './Boid';
import { Predator } from './Predator';

export class Simulation {
  width: number;
  height: number;
  boids: Boid[] = [];
  predators: Predator[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.syncPopulation();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  private randomPosition(): { x: number; y: number } {
    return { x: Math.random() * this.width, y: Math.random() * this.height };
  }

  private randomVelocity(maxSpeed: number): { x: number; y: number } {
    const angle = Math.random() * Math.PI * 2;
    const speed = maxSpeed * (0.4 + Math.random() * 0.6);
    return V.fromAngle(angle, speed);
  }

  /** Adds/removes boids and predators to match params.boidCount / predatorCount. */
  syncPopulation(): void {
    while (this.boids.length < params.boidCount) {
      this.boids.push(new Boid(this.randomPosition(), this.randomVelocity(params.boidMaxSpeed)));
    }
    while (this.boids.length > params.boidCount) {
      this.boids.pop();
    }

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
    this.syncPopulation();
  }

  private wrap(pos: { x: number; y: number }): void {
    if (pos.x < 0) pos.x += this.width;
    else if (pos.x >= this.width) pos.x -= this.width;
    if (pos.y < 0) pos.y += this.height;
    else if (pos.y >= this.height) pos.y -= this.height;
  }

  update(dt: number): void {
    this.syncPopulation();
    if (!params.running) return;

    for (const boid of this.boids) {
      boid.update(dt, this.boids, this.predators);
      this.wrap(boid.position);
    }
    for (const predator of this.predators) {
      predator.update(dt, this.boids);
      this.wrap(predator.position);
    }
  }
}

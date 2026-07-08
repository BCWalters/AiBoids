import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Boid, DYING_DURATION } from './Boid';
import { Predator } from './Predator';
import { params, resetParams } from './params';
import { create, distance } from './vector';
import type { WorldBounds } from './boundary';

const bounds: WorldBounds = { width: 1000, height: 1000, depth: 1000 };

describe('Boid.update', () => {
  beforeEach(() => {
    resetParams();
    // Use 2D mode by default so boundary/center-pull forces (3D-only)
    // don't interfere with the flocking-rule assertions below.
    params.mode = '2d';
  });
  afterEach(() => {
    resetParams();
  });

  it('a lone boid with no neighbors just coasts (no steering applied)', () => {
    const b = new Boid(create(0, 0, 0), create(10, 0, 0));
    b.update(1 / 60, [b], [], bounds);
    // Velocity direction should be unchanged; only integration happened.
    expect(b.velocity.x).toBeCloseTo(10);
    expect(b.velocity.y).toBeCloseTo(0);
  });

  it('separation pushes two overlapping same-species boids apart', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    const b = new Boid(create(5, 0, 0), create(0, 0, 0));
    const all = [a, b];
    a.update(1 / 60, all, [], bounds);
    // a should now be steering away from b, i.e. in the -x direction.
    expect(a.velocity.x).toBeLessThan(0);
  });

  it('alignment pulls a boid toward the average heading of same-species neighbors', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    // Neighbor far enough away that separation doesn't dominate, but well
    // within perceptionRadius (default 70).
    const neighbor = new Boid(create(40, 0, 0), create(0, 50, 0));
    a.update(1 / 60, [a, neighbor], [], bounds);
    expect(a.velocity.y).toBeGreaterThan(0);
  });

  it('cohesion pulls a boid toward a same-species neighbor', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    const neighbor = new Boid(create(40, 0, 0), create(0, 0, 0));
    a.update(1 / 60, [a, neighbor], [], bounds);
    // Neighbor is directly ahead on +x with no relative velocity to align
    // with, and far enough away that separation doesn't apply — net
    // steering should be toward the neighbor (+x).
    expect(a.velocity.x).toBeGreaterThan(0);
  });

  it('a different-species neighbor does not contribute to alignment/cohesion', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0), 'sparrow');
    // Far enough to be outside interspeciesAvoidRadius (default 45) so
    // only alignment/cohesion could move it, and those must be skipped
    // for a different species.
    const other = new Boid(create(60, 0, 0), create(0, 50, 0), 'parrot');
    a.update(1 / 60, [a, other], [], bounds);
    expect(a.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a nearby predator triggers a flee force away from it', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    const predator = new Predator(create(20, 0, 0), create(0, 0, 0), 'hawk');
    a.update(1 / 60, [a], [predator], bounds);
    expect(a.velocity.x).toBeLessThan(0);
    expect(a.panicLevel).toBeGreaterThan(0);
  });

  it('a unicorn "predator" nearby raises panicLevel far less than a hawk would', () => {
    const a1 = new Boid(create(0, 0, 0), create(0, 0, 0));
    const hawk = new Predator(create(20, 0, 0), create(0, 0, 0), 'hawk');
    a1.update(1 / 60, [a1], [hawk], bounds);

    const a2 = new Boid(create(0, 0, 0), create(0, 0, 0));
    const unicorn = new Predator(create(20, 0, 0), create(0, 0, 0), 'unicorn');
    a2.update(1 / 60, [a2], [unicorn], bounds);

    expect(a2.panicLevel).toBeLessThan(a1.panicLevel);
  });

  it('a predator outside panicRadius has no effect', () => {
    const a = new Boid(create(0, 0, 0), create(1, 0, 0));
    const predator = new Predator(create(10000, 0, 0), create(0, 0, 0), 'hawk');
    a.update(1 / 60, [a], [predator], bounds);
    expect(a.panicLevel).toBe(0);
  });

  it('a dying boid ignores flocking and slides toward its death target while shrinking', () => {
    const a = new Boid(create(0, 0, 0), create(5, 0, 0));
    a.dying = true;
    a.deathTarget = create(100, 0, 0);
    const neighbor = new Boid(create(1, 0, 0), create(0, 100, 0));

    a.update(DYING_DURATION / 2, [a, neighbor], [], bounds);
    expect(a.scale).toBeCloseTo(0.5, 1);
    expect(a.position.x).toBeGreaterThan(0);
    // Velocity is force-zeroed while dying, regardless of neighbors.
    expect(a.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a dying boid reaches scale 0 once DYING_DURATION has elapsed', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    a.dying = true;
    a.deathTarget = create(0, 0, 0);
    a.update(DYING_DURATION, [a], [], bounds);
    expect(a.scale).toBe(0);
  });

  it('a boid in its spawn burst window ignores alignment/cohesion but still separates', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    a.spawnBurstRemaining = 1;
    const neighbor = new Boid(create(40, 0, 0), create(0, 50, 0));
    a.update(1 / 60, [a, neighbor], [], bounds);
    // Cohesion/alignment would normally pull toward +x/+y; during the
    // burst window neither should apply, so velocity stays at zero.
    expect(a.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('velocity is clamped to boidMaxSpeed even under strong steering', () => {
    const a = new Boid(create(0, 0, 0), create(0, 0, 0));
    const neighbor = new Boid(create(1, 0, 0), create(0, 0, 0));
    a.update(1, [a, neighbor], [], bounds);
    expect(distance(create(0, 0, 0), a.velocity)).toBeLessThanOrEqual(params.boidMaxSpeed + 1e-6);
  });
});

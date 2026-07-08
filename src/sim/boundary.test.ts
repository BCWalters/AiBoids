import { describe, it, expect } from 'vitest';
import { boundarySteer, clampToBounds, nearWallAxisCount, type WorldBounds } from './boundary';
import { create } from './vector';

const bounds: WorldBounds = { width: 100, height: 100, depth: 100 };

describe('boundarySteer', () => {
  it('returns zero force when margin is disabled', () => {
    expect(boundarySteer(create(1, 1, 1), bounds, 0, 250)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns zero force when far from every wall', () => {
    expect(boundarySteer(create(50, 50, 50), bounds, 20, 250)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('pushes positively away from a near-zero wall', () => {
    const steer = boundarySteer(create(5, 50, 50), bounds, 20, 250);
    expect(steer.x).toBeGreaterThan(0);
    expect(steer.y).toBe(0);
    expect(steer.z).toBe(0);
  });

  it('pushes negatively away from a near-max wall', () => {
    const steer = boundarySteer(create(95, 50, 50), bounds, 20, 250);
    expect(steer.x).toBeLessThan(0);
  });

  it('scales up to maxForce/10 right at a wall', () => {
    const steer = boundarySteer(create(0, 50, 50), bounds, 20, 250);
    expect(steer.x).toBeCloseTo(250 / 10);
  });

  it('combines pushes from multiple nearby walls (corner case)', () => {
    const steer = boundarySteer(create(2, 2, 50), bounds, 20, 250);
    expect(steer.x).toBeGreaterThan(0);
    expect(steer.y).toBeGreaterThan(0);
    expect(steer.z).toBe(0);
  });
});

describe('clampToBounds', () => {
  it('leaves in-range positions untouched', () => {
    const p = create(50, 50, 50);
    clampToBounds(p, bounds);
    expect(p).toEqual({ x: 50, y: 50, z: 50 });
  });

  it('clamps below-zero coordinates up to 0', () => {
    const p = create(-5, -1, 50);
    clampToBounds(p, bounds);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('clamps above-max coordinates down to the bound', () => {
    const p = create(150, 50, 200);
    clampToBounds(p, bounds);
    expect(p.x).toBe(100);
    expect(p.z).toBe(100);
  });
});

describe('nearWallAxisCount', () => {
  it('returns 0 when margin is disabled or far from all walls', () => {
    expect(nearWallAxisCount(create(50, 50, 50), bounds, 0)).toBe(0);
    expect(nearWallAxisCount(create(50, 50, 50), bounds, 20)).toBe(0);
  });

  it('counts exactly one axis near a single wall', () => {
    expect(nearWallAxisCount(create(5, 50, 50), bounds, 20)).toBe(1);
  });

  it('counts 2+ axes when pinned into a corner', () => {
    expect(nearWallAxisCount(create(5, 5, 50), bounds, 20)).toBe(2);
    expect(nearWallAxisCount(create(5, 5, 95), bounds, 20)).toBe(3);
  });
});

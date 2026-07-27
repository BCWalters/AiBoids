import { describe, it, expect } from 'vitest';
import * as V from './vector';

describe('vector', () => {
  it('add/sub/scale do plain componentwise math', () => {
    const a = V.create(1, 2, 3);
    const b = V.create(4, -1, 2);
    expect(V.add(a, b)).toEqual({ x: 5, y: 1, z: 5 });
    expect(V.sub(a, b)).toEqual({ x: -3, y: 3, z: 1 });
    expect(V.scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('magnitude and magnitudeSq are consistent', () => {
    const a = V.create(3, 4, 0);
    expect(V.magnitude(a)).toBeCloseTo(5);
    expect(V.magnitudeSq(a)).toBeCloseTo(25);
  });

  it('normalize produces a unit vector preserving direction', () => {
    const a = V.create(0, 5, 0);
    const n = V.normalize(a);
    expect(V.magnitude(n)).toBeCloseTo(1);
    expect(n).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('normalize of the zero vector returns zero (no NaN/divide-by-zero)', () => {
    expect(V.normalize(V.create(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('limit leaves vectors under the cap untouched', () => {
    const a = V.create(1, 0, 0);
    expect(V.limit(a, 5)).toEqual(a);
  });

  it('limit clamps magnitude down to max, preserving direction', () => {
    const a = V.create(10, 0, 0);
    const limited = V.limit(a, 4);
    expect(V.magnitude(limited)).toBeCloseTo(4);
    expect(limited.x).toBeCloseTo(4);
  });

  it('limit treats a zero vector as already within any cap', () => {
    expect(V.limit(V.create(0, 0, 0), 4)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('setMagnitude rescales to an exact length', () => {
    const a = V.create(0, 2, 0);
    const scaled = V.setMagnitude(a, 10);
    expect(scaled).toEqual({ x: 0, y: 10, z: 0 });
  });

  it('dot product of perpendicular vectors is zero', () => {
    expect(V.dot(V.create(1, 0, 0), V.create(0, 1, 0))).toBe(0);
  });

  it('heading2D / fromAngle2D round-trip', () => {
    const angle = Math.PI / 3;
    const v = V.fromAngle2D(angle, 2);
    expect(V.heading2D(v)).toBeCloseTo(angle);
    expect(v.z).toBe(0);
  });

  it('randomUnit3D always returns a unit vector', () => {
    for (let i = 0; i < 50; i++) {
      const v = V.randomUnit3D();
      expect(V.magnitude(v)).toBeCloseTo(1, 5);
    }
  });

  it('distance / distanceSq agree with magnitude of the difference', () => {
    const a = V.create(0, 0, 0);
    const b = V.create(3, 4, 0);
    expect(V.distance(a, b)).toBeCloseTo(5);
    expect(V.distanceSq(a, b)).toBeCloseTo(25);
  });

  it('angleBetween returns 0 for parallel vectors and PI/2 for perpendicular', () => {
    expect(V.angleBetween(V.create(1, 0, 0), V.create(2, 0, 0))).toBeCloseTo(0);
    expect(V.angleBetween(V.create(1, 0, 0), V.create(0, 1, 0))).toBeCloseTo(Math.PI / 2);
    expect(V.angleBetween(V.create(1, 0, 0), V.create(-1, 0, 0))).toBeCloseTo(Math.PI);
  });

  it('angleBetween returns 0 for a zero-length input rather than NaN', () => {
    expect(V.angleBetween(V.create(0, 0, 0), V.create(1, 0, 0))).toBe(0);
  });

  describe('limitTurn', () => {
    it('returns the target unchanged when the turn is within the cap', () => {
      const from = V.create(1, 0, 0);
      const to = V.create(1, 0.1, 0);
      // ~5.7° turn, cap of 45° — no clamping.
      expect(V.limitTurn(from, to, Math.PI / 4)).toEqual(to);
    });

    it('clamps the heading change to maxAngle, preserving target speed', () => {
      const from = V.create(1, 0, 0);
      const to = V.create(0, 5, 0); // 90° turn, speed 5
      const maxAngle = Math.PI / 6; // 30°
      const result = V.limitTurn(from, to, maxAngle);
      // Heading rotated only 30° away from `from`, speed follows `to`.
      expect(V.angleBetween(from, result)).toBeCloseTo(maxAngle);
      expect(V.magnitude(result)).toBeCloseTo(5);
    });

    it('is disabled when maxAngle <= 0 (returns target unchanged)', () => {
      const from = V.create(1, 0, 0);
      const to = V.create(0, 1, 0);
      expect(V.limitTurn(from, to, 0)).toEqual(to);
      expect(V.limitTurn(from, to, -1)).toEqual(to);
    });

    it('returns the target when there is no defined prior heading', () => {
      const to = V.create(0, 3, 0);
      expect(V.limitTurn(V.create(0, 0, 0), to, Math.PI / 8)).toEqual(to);
    });

    it('accepts a near-antiparallel target rather than producing NaN', () => {
      const from = V.create(1, 0, 0);
      const to = V.create(-2, 0, 0);
      const result = V.limitTurn(from, to, Math.PI / 6);
      expect(Number.isNaN(result.x)).toBe(false);
      expect(result).toEqual(to);
    });
  });
});

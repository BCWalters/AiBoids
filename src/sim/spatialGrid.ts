import type { Vec3 } from './vector';

/** Minimal interface for anything a SpatialGrid can index by position. */
export interface Positioned {
  position: Vec3;
}

/**
 * A simple uniform-grid spatial index used to avoid an O(n^2) full-array
 * scan when each boid looks for nearby neighbors every frame. Choose
 * `cellSize` close to the largest radius callers will query with (e.g.
 * perceptionRadius) — querying a point's own cell plus its immediate
 * neighborhood (27 cells in 3D; effectively 9 in 2D mode, since z is
 * always 0 there) is then guaranteed to return every item within
 * `cellSize` of that point, at the cost of some false positives near
 * the neighborhood's outer edge that callers filter out with their own
 * exact distance/FOV check afterward (see Boid.canSee) — the same
 * two-stage "broad phase then exact check" pattern already used by the
 * old full-array scan (which checked distance against every boid).
 *
 * Deliberately NOT wraparound/torus-aware: a query near a 2D-mode wrap
 * edge won't reach across to the opposite edge. The previous full-array
 * scan had the same limitation (plain Euclidean distance, no wrap), so
 * this preserves existing behavior rather than changing it.
 */
export class SpatialGrid<T extends Positioned> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, T[]>();

  constructor(cellSize: number) {
    // Guard against a degenerate (zero/negative) size, which would hash
    // every item to the same bucket key computation (division by ~0).
    this.cellSize = cellSize > 1e-6 ? cellSize : 1;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private key(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  insert(item: T): void {
    const { x, y, z } = item.position;
    const key = this.key(this.cellCoord(x), this.cellCoord(y), this.cellCoord(z));
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  /**
   * Returns every item in `position`'s cell plus its neighboring cells —
   * a superset of anything within `cellSize` of `position`. Callers
   * apply their own exact distance/FOV check to the (much smaller)
   * result to get a precise neighbor set.
   */
  queryNearby(position: Vec3): T[] {
    const cx = this.cellCoord(position.x);
    const cy = this.cellCoord(position.y);
    const cz = this.cellCoord(position.z);
    const results: T[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
          if (bucket) results.push(...bucket);
        }
      }
    }
    return results;
  }
}

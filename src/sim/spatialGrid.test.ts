import { describe, it, expect } from 'vitest';
import { SpatialGrid } from './spatialGrid';
import { create } from './vector';

interface Item {
  id: number;
  position: ReturnType<typeof create>;
}

describe('SpatialGrid', () => {
  it('returns items inserted into the same cell', () => {
    const grid = new SpatialGrid<Item>(10);
    const a: Item = { id: 1, position: create(1, 1, 1) };
    const b: Item = { id: 2, position: create(2, 2, 2) };
    grid.insert(a);
    grid.insert(b);

    const found = grid.queryNearby(create(0, 0, 0));
    expect(found).toContain(a);
    expect(found).toContain(b);
  });

  it('finds items in the 26 neighboring cells, not just the exact cell', () => {
    const grid = new SpatialGrid<Item>(10);
    // Cell (0,0,0) spans [0,10). Cell (1,0,0) spans [10,20).
    const neighbor: Item = { id: 1, position: create(11, 1, 1) };
    grid.insert(neighbor);

    const found = grid.queryNearby(create(9, 1, 1));
    expect(found).toContain(neighbor);
  });

  it('does not return items far outside the 3x3x3 neighborhood', () => {
    const grid = new SpatialGrid<Item>(10);
    const farItem: Item = { id: 1, position: create(1000, 1000, 1000) };
    grid.insert(farItem);

    const found = grid.queryNearby(create(0, 0, 0));
    expect(found).not.toContain(farItem);
  });

  it('returns an empty array for a query with no nearby items', () => {
    const grid = new SpatialGrid<Item>(10);
    expect(grid.queryNearby(create(0, 0, 0))).toEqual([]);
  });

  it('guards against a degenerate (zero) cell size instead of dividing by zero', () => {
    const grid = new SpatialGrid<Item>(0);
    const a: Item = { id: 1, position: create(5, 5, 5) };
    grid.insert(a);
    // Should not throw and should still be able to find the item back in its own cell.
    expect(grid.queryNearby(create(5, 5, 5))).toContain(a);
  });

  it('handles negative coordinates without throwing', () => {
    const grid = new SpatialGrid<Item>(10);
    const a: Item = { id: 1, position: create(-15, -15, -15) };
    grid.insert(a);
    expect(grid.queryNearby(create(-11, -11, -11))).toContain(a);
  });
});

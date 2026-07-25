import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CreatureGalleryController, type CreatureGalleryControllerDeps } from './CreatureGalleryController';
import { params, resetParams, type GalleryCreature } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

/**
 * These tests drive the gallery purely through `params.galleryCreature`
 * (the same field the ControlPanel dropdown writes) + the per-frame
 * `applySelectionChanges()` hook, so no real Simulation/Renderer3D is
 * needed — a null renderer and no-op mode/panel callbacks exercise the
 * snapshot/restore logic in isolation.
 */
function makeController(): CreatureGalleryController {
  const deps: CreatureGalleryControllerDeps = {
    sim: {} as unknown as Simulation,
    getRenderer3D: () => null,
    applyMode: vi.fn(),
    refreshControlPanel: vi.fn(),
  };
  return new CreatureGalleryController(deps);
}

function selectGalleryCreature(controller: CreatureGalleryController, creature: GalleryCreature | null): void {
  params.galleryCreature = creature;
  controller.applySelectionChanges();
}

describe('CreatureGalleryController snapshot/restore', () => {
  beforeEach(() => {
    resetParams();
  });
  afterEach(() => {
    resetParams();
  });

  it('restores the original population after selecting a single creature then None', () => {
    params.mode = '2d';
    params.boidCount = 50;
    params.predatorCount = 3;
    params.running = true;

    const controller = makeController();

    selectGalleryCreature(controller, 'normal');
    expect(params.boidCount).toBe(1);
    expect(params.predatorCount).toBe(0);
    expect(params.mode).toBe('3d');

    selectGalleryCreature(controller, null);
    expect(params.boidCount).toBe(50);
    expect(params.predatorCount).toBe(3);
    expect(params.mode).toBe('2d');
    expect(params.running).toBe(true);
  });

  it('restores the original population after switching directly between two creatures then None', () => {
    // Regression test: previously, selecting a second creature without
    // returning to "None" first re-snapshotted the already-isolated
    // single-creature state, so exiting restored only that creature
    // instead of the full pre-gallery population.
    params.mode = '2d';
    params.boidCount = 50;
    params.predatorCount = 3;
    params.horseCount = 0;
    params.running = true;

    const controller = makeController();

    selectGalleryCreature(controller, 'normal');
    expect(params.boidCount).toBe(1);

    // Switch straight to a second creature (no "None" in between).
    selectGalleryCreature(controller, 'horse');
    expect(params.horseCount).toBe(1);
    expect(params.boidCount).toBe(0);

    selectGalleryCreature(controller, null);
    expect(params.boidCount).toBe(50);
    expect(params.predatorCount).toBe(3);
    expect(params.horseCount).toBe(0);
    expect(params.mode).toBe('2d');
    expect(params.running).toBe(true);
  });

  it('restores correctly after cycling through three creatures directly', () => {
    params.mode = '3d';
    params.boidCount = 20;
    params.goldCount = 5;
    params.monsterCount = 2;

    const controller = makeController();

    selectGalleryCreature(controller, 'normal');
    selectGalleryCreature(controller, 'gold');
    selectGalleryCreature(controller, 'monster');
    expect(params.monsterCount).toBe(1);
    expect(params.boidCount).toBe(0);
    expect(params.goldCount).toBe(0);

    selectGalleryCreature(controller, null);
    expect(params.boidCount).toBe(20);
    expect(params.goldCount).toBe(5);
    expect(params.monsterCount).toBe(2);
  });

  it('re-entering the gallery after exiting captures the freshly-restored population', () => {
    params.mode = '2d';
    params.boidCount = 40;
    params.blueCount = 0;

    const controller = makeController();

    selectGalleryCreature(controller, 'normal');
    selectGalleryCreature(controller, null);
    expect(params.boidCount).toBe(40);

    // A second, independent gallery visit must snapshot the real
    // population again (the guard must not leave a stale snapshot behind).
    selectGalleryCreature(controller, 'blue');
    expect(params.blueCount).toBe(1);
    expect(params.boidCount).toBe(0);

    selectGalleryCreature(controller, null);
    expect(params.boidCount).toBe(40);
    expect(params.blueCount).toBe(0);
    expect(params.mode).toBe('2d');
  });
});

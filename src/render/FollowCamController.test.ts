import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { FollowCamController, isDragMove, DRAG_THRESHOLD_PX } from './FollowCamController';
import { params, resetParams } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from './Renderer3D';

// ---------------------------------------------------------------------------
// isDragMove — pure function tests
// ---------------------------------------------------------------------------

describe('isDragMove', () => {
  it('returns false for zero movement', () => {
    expect(isDragMove(100, 200, 100, 200)).toBe(false);
  });

  it('returns false when movement is within the default threshold', () => {
    // Move exactly at threshold boundary (≤ threshold → not a drag)
    expect(isDragMove(0, 0, DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it('returns true when movement exceeds the default threshold', () => {
    expect(isDragMove(0, 0, DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
  });

  it('returns true for a large diagonal movement', () => {
    expect(isDragMove(100, 100, 200, 200)).toBe(true);
  });

  it('returns false for movement within a custom threshold', () => {
    expect(isDragMove(0, 0, 3, 3, 10)).toBe(false);
  });

  it('returns true for movement outside a custom threshold', () => {
    expect(isDragMove(0, 0, 8, 8, 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FollowCamController — drag-aware selection tests
// ---------------------------------------------------------------------------

/** Build a minimal PerspectiveCamera pointing along –Z, positioned at origin. */
function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 800 / 600, 1, 10000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  return cam;
}

/** Build a PointerEvent-like object with the given client coordinates. */
function makePointerEvent(clientX: number, clientY: number, button = 0): PointerEvent {
  return new PointerEvent('pointerup', { clientX, clientY, button, bubbles: true });
}

function makePointerDownEvent(clientX: number, clientY: number, button = 0): PointerEvent {
  return new PointerEvent('pointerdown', { clientX, clientY, button, bubbles: true });
}

describe('FollowCamController drag-aware selection', () => {
  let container: HTMLElement;
  let controller: FollowCamController;
  let canvas: HTMLCanvasElement;
  let sim: Simulation;
  let renderer3D: Renderer3D;
  let smoothOrbitTarget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetParams();
    params.followCamMode = 'orbit';

    container = document.createElement('div');
    document.body.appendChild(container);
    controller = new FollowCamController(container);

    // Canvas whose CSS rect starts at origin, 800×600.
    canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 600,
      right: 800, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Sim with a single boid at (0, 0, -100) — projects to screen centre.
    sim = {
      boids: [
        {
          id: 42,
          position: { x: 0, y: 0, z: -100 },
          velocity: { x: 0, y: 0, z: 0 },
          species: 'normal',
          panicLevel: 0,
        },
      ],
      predators: [],
    } as unknown as Simulation;

    const camera = makeCamera();
    smoothOrbitTarget = vi.fn();

    renderer3D = {
      getCamera: () => camera,
      // toRenderedPosition is the identity here — sim-space === render-space.
      toRenderedPosition: (x: number, y: number, z: number) => ({ x, y, z }),
      smoothOrbitTarget,
      getCreatureLabels: () => ({ boid: {}, predator: {} }),
    } as unknown as Renderer3D;
  });

  afterEach(() => {
    container.remove();
    resetParams();
    vi.restoreAllMocks();
  });

  it('selects the nearest creature on a stationary click', () => {
    // Click exactly at screen centre (400, 300) — boid is there.
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    controller.handlePointerUp(makePointerEvent(400, 300), canvas, sim, renderer3D);

    // A selection was made if update() drives the orbit target.
    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).toHaveBeenCalled();
  });

  it('does NOT change the selection when the pointer moves beyond the drag threshold', () => {
    // Start with no selection. Drag 20 px — should remain unselected.
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    controller.handlePointerUp(makePointerEvent(420, 320), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    // No selection → update returns early, smoothOrbitTarget never called.
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('preserves an existing selection when the user drags to orbit', () => {
    // First, make a stationary click to lock onto the boid.
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    controller.handlePointerUp(makePointerEvent(400, 300), canvas, sim, renderer3D);

    // Now drag to orbit (large movement) — selection should be retained.
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    controller.handlePointerUp(makePointerEvent(450, 350), canvas, sim, renderer3D);

    // update() should still smooth toward the originally-selected boid.
    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).toHaveBeenCalled();
  });

  it('ignores non-primary button pointerdown/pointerup events', () => {
    // Right-click (button=2) should not trigger selection.
    controller.handlePointerDown(makePointerDownEvent(400, 300, 2));
    controller.handlePointerUp(makePointerEvent(400, 300, 2), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('does not select when followCamMode is not orbit', () => {
    params.followCamMode = 'off';

    controller.handlePointerDown(makePointerDownEvent(400, 300));
    controller.handlePointerUp(makePointerEvent(400, 300), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });
});

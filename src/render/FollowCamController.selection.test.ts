// @vitest-environment jsdom
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
      resetOrbitTarget: vi.fn(),
      getCreatureLabels: () => ({ boid: {}, predator: {} }),
      enterPovMode: vi.fn(),
      exitPovMode: vi.fn(),
      setPovCamera: vi.fn(),
      getCreatureForwardExtent: () => 0,
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

  it('does NOT select after pointercancel clears the pointer-down state', () => {
    // Start a pointer-down gesture near the boid...
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    // ...then abort it (e.g. OrbitControls captures the pointer).
    controller.handlePointerCancel();
    // A subsequent pointerup within the drag threshold must not trigger selection.
    controller.handlePointerUp(makePointerEvent(402, 301), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('does NOT select after pointerleave clears the pointer-down state', () => {
    // Start a pointer-down gesture near the boid...
    controller.handlePointerDown(makePointerDownEvent(400, 300));
    // ...then the pointer leaves the canvas element.
    controller.handlePointerCancel();
    // A pointerup within the drag threshold must not trigger selection.
    controller.handlePointerUp(makePointerEvent(401, 300), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FollowCamController — deselect → orbit target reset tests (#119)
// ---------------------------------------------------------------------------

/** Minimal Simulation stub with two boids. */
function makeSim(width = 800, height = 600): Simulation {
  return {
    width,
    height,
    boids: [
      { id: 1, position: { x: 100, y: 100, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, species: 'normal', panicLevel: 0 },
      { id: 2, position: { x: 200, y: 200, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, species: 'normal', panicLevel: 0 },
    ],
    predators: [],
  } as unknown as Simulation;
}

/** Minimal Renderer3D stub whose key methods are vi.fn() spies. */
function makeRenderer(): Renderer3D {
  const cam = new THREE.PerspectiveCamera(60, 1, 1, 10000);
  cam.position.set(0, 0, 500);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return {
    getCamera: () => cam,
    toRenderedPosition: (x: number, y: number, z: number) => new THREE.Vector3(x, y, z),
    smoothOrbitTarget: vi.fn(),
    resetOrbitTarget: vi.fn(),
    getCreatureLabels: () => ({ boid: {}, predator: {} }),
    enterPovMode: vi.fn(),
    exitPovMode: vi.fn(),
    setPovCamera: vi.fn(),
    getCreatureForwardExtent: () => 0,
  } as unknown as Renderer3D;
}

describe('FollowCamController deselect → orbit target reset', () => {
  let controller: FollowCamController;
  let container: HTMLElement;

  beforeEach(() => {
    resetParams();
    params.followCamMode = 'orbit';
    container = document.createElement('div');
    controller = new FollowCamController(container);
  });

  it('resets orbit target when handleCanvasClick misses all entities', () => {
    const sim = makeSim();
    const renderer = makeRenderer();

    // Build a fake canvas whose bounding rect maps the click to a point far
    // from any projected entity so pickEntity returns null.
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 } as DOMRect);

    // Click at top-left corner — entities project near the centre so this misses.
    const event = new MouseEvent('click', { clientX: 0, clientY: 0 });

    controller.handleCanvasClick(event, canvas, sim, renderer);

    expect(renderer.resetOrbitTarget).toHaveBeenCalledOnce();
    expect(renderer.resetOrbitTarget).toHaveBeenCalledWith(sim);
  });

  it('resets orbit target when update() finds the selected entity has been removed', () => {
    const sim = makeSim();
    const renderer = makeRenderer();

    // First update with nothing selected: resolveSelected returns null immediately,
    // but since selectedId is already null the reset must NOT fire.
    controller.update(0.016, sim, renderer);
    expect(renderer.resetOrbitTarget).not.toHaveBeenCalled();

    // Force-select boid id=1 by writing private state directly.
    (controller as unknown as { selectedId: number | null }).selectedId = 1;
    (controller as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;

    // Now remove boid 1 from the sim and run update — the graceful-deselect
    // path should fire resetOrbitTarget exactly once.
    const simWithoutBoid1 = { ...sim, boids: [sim.boids[1]], predators: [] } as unknown as Simulation;
    controller.update(0.016, simWithoutBoid1, renderer);

    expect(renderer.resetOrbitTarget).toHaveBeenCalledOnce();
    expect(renderer.resetOrbitTarget).toHaveBeenCalledWith(simWithoutBoid1);
  });

  it('resets orbit target when deselect() is called explicitly', () => {
    const sim = makeSim();
    const renderer = makeRenderer();

    controller.deselect(renderer, sim);

    expect(renderer.resetOrbitTarget).toHaveBeenCalledOnce();
    expect(renderer.resetOrbitTarget).toHaveBeenCalledWith(sim);
  });
});

// ---------------------------------------------------------------------------
// FollowCamController — POV (first-person) mode tests
// ---------------------------------------------------------------------------

describe('FollowCamController POV mode', () => {
  let controller: FollowCamController;
  let container: HTMLElement;

  beforeEach(() => {
    resetParams();
    params.followCamMode = 'orbit';
    params.showCreatureInspector = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    controller = new FollowCamController(container);
  });

  afterEach(() => {
    container.remove();
    resetParams();
    vi.restoreAllMocks();
  });

  /** Force-select a boid by writing private state directly. */
  function selectBoid(ctrl: FollowCamController, id: number): void {
    (ctrl as unknown as { selectedId: number | null }).selectedId = id;
    (ctrl as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;
  }

  it('enterPov() calls renderer3D.enterPovMode() and updates button text', () => {
    const renderer = makeRenderer();
    selectBoid(controller, 1);
    controller.enterPov(renderer);

    expect(renderer.enterPovMode).toHaveBeenCalledOnce();
    const btn = container.querySelector('.hud-pov-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Exit POV (Esc)');
  });

  it('enterPov() is a no-op when no creature is selected', () => {
    const renderer = makeRenderer();
    // No selection — selectedId is null.
    controller.enterPov(renderer);
    expect(renderer.enterPovMode).not.toHaveBeenCalled();
  });

  it('enterPov() is a no-op when already in POV mode', () => {
    const renderer = makeRenderer();
    selectBoid(controller, 1);
    controller.enterPov(renderer);
    controller.enterPov(renderer); // second call should no-op
    expect(renderer.enterPovMode).toHaveBeenCalledTimes(1);
  });

  it('exitPov() calls renderer3D.exitPovMode() and resets button text', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);
    controller.enterPov(renderer);
    controller.exitPov(renderer, sim);

    expect(renderer.exitPovMode).toHaveBeenCalledOnce();
    const btn = container.querySelector('.hud-pov-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Enter POV');
  });

  it('exitPov() is a no-op when not in POV mode', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    controller.exitPov(renderer, sim);
    expect(renderer.exitPovMode).not.toHaveBeenCalled();
  });

  it('handleEscKey() exits POV mode', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);
    controller.enterPov(renderer);
    controller.handleEscKey(renderer, sim);
    expect(renderer.exitPovMode).toHaveBeenCalledOnce();
  });

  it('handleEscKey() is a no-op when not in POV mode', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    controller.handleEscKey(renderer, sim);
    expect(renderer.exitPovMode).not.toHaveBeenCalled();
  });

  it('update() calls setPovCamera each frame when POV is active', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);

    // Attach renderHeading to the boid stub (matches what Boid has in production).
    (sim.boids[0] as unknown as { renderHeading: { x: number; y: number; z: number } }).renderHeading = { x: 0, y: 0, z: -1 };

    controller.enterPov(renderer);
    controller.update(0.016, sim, renderer);

    expect(renderer.setPovCamera).toHaveBeenCalled();
    // Orbit target smoothing must NOT be called in POV mode.
    expect(renderer.smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('update() exits POV when followCamMode switches to off', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);
    (sim.boids[0] as unknown as { renderHeading: { x: number; y: number; z: number } }).renderHeading = { x: 0, y: 0, z: -1 };

    controller.enterPov(renderer);
    params.followCamMode = 'off';
    controller.update(0.016, sim, renderer);

    expect(renderer.exitPovMode).toHaveBeenCalledOnce();
  });

  it('creature despawn during POV exits cleanly', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);
    (sim.boids[0] as unknown as { renderHeading: { x: number; y: number; z: number } }).renderHeading = { x: 0, y: 0, z: -1 };

    controller.enterPov(renderer);
    // Remove boid 1 from the simulation.
    const simWithoutBoid1 = { ...sim, boids: [sim.boids[1]], predators: [] } as unknown as Simulation;
    controller.update(0.016, simWithoutBoid1, renderer);

    // clearSelection is called which resets POV and orbit target.
    expect(renderer.exitPovMode).toHaveBeenCalledOnce();
    expect(renderer.resetOrbitTarget).toHaveBeenCalledOnce();
  });

  it('clearSelection via empty-space click exits POV', () => {
    const renderer = makeRenderer();
    const sim = makeSim();
    selectBoid(controller, 1);
    (sim.boids[0] as unknown as { renderHeading: { x: number; y: number; z: number } }).renderHeading = { x: 0, y: 0, z: -1 };
    controller.enterPov(renderer);

    // Simulate deselect.
    controller.deselect(renderer, sim);

    expect(renderer.exitPovMode).toHaveBeenCalledOnce();
    expect(renderer.resetOrbitTarget).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
      setOrbitControlsEnabled: vi.fn(),
      setCameraPose: vi.fn(),
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
    setOrbitControlsEnabled: vi.fn(),
    setCameraPose: vi.fn(),
    getCreatureLabels: () => ({ boid: {}, predator: {} }),
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

describe('FollowCamController POV mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetParams();
    params.followCamMode = 'orbit';
    params.showCreatureInspector = true;
  });

  it('enters POV from HUD and exits on Escape', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = new FollowCamController(container);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const boid = {
      id: 1,
      species: 'normal',
      position: { x: 10, y: 20, z: 30 },
      velocity: { x: 0, y: 1, z: 0 },
      renderHeading: { x: 0, y: 1, z: 0 },
      panicLevel: 0,
    };
    const renderer = {
      toRenderedPosition: (x: number, y: number, z: number) => new THREE.Vector3(x * 4, y * 4, z * 4),
      smoothOrbitTarget: vi.fn(),
      resetOrbitTarget: vi.fn(),
      getCamera: () => camera,
      getCreatureLabels: () => ({
        boid: { normal: 'Sparrow' },
        predator: { normal: 'Hawk', monster: 'Dragon', horse: 'Unicorn' },
      }),
      setOrbitControlsEnabled: vi.fn(),
      setCameraPose: vi.fn(),
    } as unknown as Renderer3D;
    const sim = { boids: [boid], predators: [] } as unknown as Simulation;

    (controller as unknown as { selectedId: number | null }).selectedId = 1;
    (controller as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;

    controller.update(1 / 60, sim, renderer);
    const button = container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle');
    expect(button?.textContent).toBe('Enter POV');

    button?.click();
    controller.update(1 / 60, sim, renderer);
    expect(button?.textContent).toBe('Exit POV (Esc)');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    controller.update(1 / 60, sim, renderer);
    expect(button?.textContent).toBe('Enter POV');
  });

  it('keeps POV camera inside minDistance by disabling real OrbitControls update path', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = new FollowCamController(container);

    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    camera.position.set(600, 300, 900);
    const controls = new OrbitControls(camera, canvas);
    controls.enabled = true;
    controls.target.set(0, 0, 0);
    controls.minDistance = 120;
    controls.maxDistance = 5000;
    controls.update();

    const renderer = {
      toRenderedPosition: (x: number, y: number, z: number) => new THREE.Vector3(x * 4, y * 4, z * 4),
      smoothOrbitTarget: (x: number, y: number, z: number, alpha: number) => {
        controls.target.x += (x - controls.target.x) * alpha;
        controls.target.y += (y - controls.target.y) * alpha;
        controls.target.z += (z - controls.target.z) * alpha;
      },
      resetOrbitTarget: vi.fn(),
      setOrbitControlsEnabled: (enabled: boolean) => {
        controls.enabled = enabled;
      },
      setCameraPose: (position: THREE.Vector3, lookTarget: THREE.Vector3) => {
        camera.position.copy(position);
        camera.lookAt(lookTarget);
        camera.updateMatrixWorld();
      },
      getCamera: () => camera,
      getCreatureLabels: () => ({ boid: { normal: 'Sparrow' }, predator: { normal: 'Hawk', monster: 'Dragon', horse: 'Unicorn' } }),
    } as unknown as Renderer3D;

    const sim = {
      boids: [{
        id: 1,
        species: 'normal',
        position: { x: 10, y: 20, z: 30 },
        velocity: { x: 0, y: 0, z: -1 },
        renderHeading: { x: 0, y: 0, z: -1 },
        panicLevel: 0,
      }],
      predators: [],
    } as unknown as Simulation;

    (controller as unknown as { selectedId: number | null }).selectedId = 1;
    (controller as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;

    controller.update(1 / 60, sim, renderer);
    container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle')?.click();

    controller.update(1 / 60, sim, renderer);
    controls.update();

    expect(controls.enabled).toBe(false);
    const expectedPovPosition = new THREE.Vector3(40, 82, 110);
    expect(camera.position.distanceTo(expectedPovPosition)).toBeLessThan(1e-6);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    expect(direction.dot(new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0.7);
  });
});

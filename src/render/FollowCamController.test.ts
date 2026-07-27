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

function makeRendererForDrag(camera: THREE.PerspectiveCamera) {
  const smoothOrbitTarget = vi.fn();
  const renderer3D = {
    getCamera: () => camera,
    toRenderedPosition: (x: number, y: number, z: number) => ({ x, y, z }),
    smoothOrbitTarget,
    getCreatureLabels: () => ({ boid: {}, predator: {} }),
    setOrbitControlsEnabled: vi.fn(),
    setCameraPose: vi.fn(),
  };
  return { renderer3D: renderer3D as unknown as Renderer3D, smoothOrbitTarget };
}

function makeBoid() {
  return {
    id: 42,
    position: { x: 0, y: 0, z: -100 },
    velocity: { x: 0, y: 0, z: 0 },
    renderHeading: { x: 0, y: 0, z: -1 },
    species: 'normal',
    panicLevel: 0,
  };
}

function makePointerEvent(type: 'pointerdown' | 'pointerup', clientX: number, clientY: number, button = 0): PointerEvent {
  return new PointerEvent(type, { clientX, clientY, button, bubbles: true });
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

    canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 600,
      right: 800, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    sim = { boids: [makeBoid()], predators: [] } as unknown as Simulation;

    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 1, 10000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();

    const renderer = makeRendererForDrag(camera);
    renderer3D = renderer.renderer3D;
    smoothOrbitTarget = renderer.smoothOrbitTarget;
  });

  afterEach(() => {
    container.remove();
    resetParams();
    vi.restoreAllMocks();
  });

  it('selects the nearest creature on a stationary click', () => {
    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300));
    controller.handlePointerUp(makePointerEvent('pointerup', 400, 300), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).toHaveBeenCalled();
  });

  it('does NOT change the selection when the pointer moves beyond the drag threshold', () => {
    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300));
    controller.handlePointerUp(makePointerEvent('pointerup', 420, 320), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('preserves an existing selection when the user drags to orbit', () => {
    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300));
    controller.handlePointerUp(makePointerEvent('pointerup', 400, 300), canvas, sim, renderer3D);

    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300));
    controller.handlePointerUp(makePointerEvent('pointerup', 450, 350), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).toHaveBeenCalled();
  });

  it('ignores non-primary button pointerdown/pointerup events', () => {
    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300, 2));
    controller.handlePointerUp(makePointerEvent('pointerup', 400, 300, 2), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
  });

  it('does not select when followCamMode is not orbit', () => {
    params.followCamMode = 'off';

    controller.handlePointerDown(makePointerEvent('pointerdown', 400, 300));
    controller.handlePointerUp(makePointerEvent('pointerup', 400, 300), canvas, sim, renderer3D);

    controller.update(0.016, sim, renderer3D);
    expect(smoothOrbitTarget).not.toHaveBeenCalled();
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
      getCamera: () => camera,
      getCreatureLabels: () => ({
        boid: { normal: 'Sparrow' },
        predator: { normal: 'Hawk', monster: 'Dragon', horse: 'Unicorn' },
      }),
      setOrbitControlsEnabled: vi.fn(),
      setCameraPose: vi.fn(),
    } as unknown as Renderer3D;
    const sim = { boids: [boid], predators: [] } as unknown as Simulation;

    (controller as any).selectedId = 1;
    (controller as any).selectedIsPredator = false;

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
        velocity: { x: 0, y: 1, z: 0 },
        renderHeading: { x: 0, y: 1, z: 0 },
        panicLevel: 0,
      }],
      predators: [],
    } as unknown as Simulation;

    (controller as any).selectedId = 1;
    (controller as any).selectedIsPredator = false;

    controller.update(1 / 60, sim, renderer);
    container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle')?.click();

    controller.update(1 / 60, sim, renderer);
    if (controls.enabled) controls.update();

    const distanceToTarget = camera.position.distanceTo(controls.target);
    expect(distanceToTarget).toBeLessThan(controls.minDistance);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    expect(direction.y).toBeGreaterThan(0.7);
  });
});

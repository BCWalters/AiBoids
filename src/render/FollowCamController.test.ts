import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FollowCamController } from './FollowCamController';
import { params, resetParams } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from './Renderer3D';
import { pickEntity } from './EntityPicker';

vi.mock('./EntityPicker', async () => ({
  pickEntity: vi.fn(),
}));

function makeBoid() {
  return {
    id: 1,
    species: 'normal',
    position: { x: 10, y: 20, z: 30 },
    velocity: { x: 0, y: 1, z: 0 },
    renderHeading: { x: 0, y: 1, z: 0 },
    panicLevel: 0,
  };
}

function makeRenderer(camera: THREE.PerspectiveCamera) {
  const smoothOrbitTarget = vi.fn();
  const renderer = {
    toRenderedPosition: (x: number, y: number, z: number) => new THREE.Vector3(x * 4, y * 4, z * 4),
    smoothOrbitTarget,
    getCamera: () => camera,
    getCreatureLabels: () => ({
      boid: { normal: 'Sparrow' },
      predator: { normal: 'Hawk', monster: 'Dragon', horse: 'Unicorn' },
    }),
  };
  return { renderer: renderer as unknown as Renderer3D, smoothOrbitTarget };
}

describe('FollowCamController POV mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetParams();
    params.followCamMode = 'orbit';
    params.showCreatureInspector = true;
    vi.mocked(pickEntity).mockReset();
  });

  it('enters POV from HUD and updates camera to a damped forward view', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = new FollowCamController(container);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(200, 200, 200);
    const initialCameraPosition = camera.position.clone();
    const { renderer, smoothOrbitTarget } = makeRenderer(camera);
    const sim = { boids: [makeBoid()], predators: [] } as unknown as Simulation;

    (controller as any).selectedId = 1;
    (controller as any).selectedIsPredator = false;

    controller.update(1 / 60, sim, renderer);
    const button = container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle');
    expect(button?.textContent).toBe('Enter POV');

    button?.click();
    controller.update(1 / 60, sim, renderer);

    expect(button?.textContent).toBe('Exit POV (Esc)');
    expect(camera.position.distanceTo(initialCameraPosition)).toBeGreaterThan(0);
    const lastCall = smoothOrbitTarget.mock.calls.at(-1);
    expect(lastCall?.[3]).toBe(1);
  });

  it('exits POV on Escape and returns to orbit-lock target smoothing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = new FollowCamController(container);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const { renderer, smoothOrbitTarget } = makeRenderer(camera);
    const sim = { boids: [makeBoid()], predators: [] } as unknown as Simulation;

    (controller as any).selectedId = 1;
    (controller as any).selectedIsPredator = false;

    controller.update(1 / 60, sim, renderer);
    const button = container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle');
    button?.click();
    controller.update(1 / 60, sim, renderer);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    controller.update(1 / 60, sim, renderer);

    expect(button?.textContent).toBe('Enter POV');
    const lastCall = smoothOrbitTarget.mock.calls.at(-1);
    expect((lastCall?.[3] as number) < 1).toBe(true);
  });

  it('exits POV when clicking empty space (deselect)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = new FollowCamController(container);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const { renderer } = makeRenderer(camera);
    const boid = makeBoid();
    const sim = { boids: [boid], predators: [] } as unknown as Simulation;
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });

    vi.mocked(pickEntity).mockReturnValue({ id: 1, isPredator: false });
    controller.handleCanvasClick(new MouseEvent('click', { clientX: 50, clientY: 50 }), canvas, sim, renderer);
    controller.update(1 / 60, sim, renderer);
    container.querySelector<HTMLButtonElement>('.creature-inspector-pov-toggle')?.click();
    controller.update(1 / 60, sim, renderer);
    expect((controller as any).povActive).toBe(true);

    vi.mocked(pickEntity).mockReturnValue(null);
    controller.handleCanvasClick(new MouseEvent('click', { clientX: 5, clientY: 5 }), canvas, sim, renderer);
    controller.update(1 / 60, sim, renderer);

    expect((controller as any).povActive).toBe(false);
    expect(container.querySelector<HTMLElement>('#creature-inspector')?.style.display).toBe('none');
  });
});

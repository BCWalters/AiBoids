// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { LazyEnvProvider } from './rendererSceneAssets';
import type { NatureEnvironment } from './styles/nature/environment';
import type { FishtankEnvironment } from './styles/fishtank/environment';

// ---------------------------------------------------------------------------
// Helpers: build lightweight mock envs that track scene presence via a single
// sentinel Object3D added on creation and removed on dispose.
// ---------------------------------------------------------------------------

function makeNatureEnvFactory() {
  const createCount = { value: 0 };
  const disposeCount = { value: 0 };

  const factory = vi.fn((scene: THREE.Scene): NatureEnvironment => {
    createCount.value++;
    const sentinel = new THREE.Object3D();
    sentinel.name = 'nature-sentinel';
    scene.add(sentinel);
    return {
      sky: {} as ReturnType<typeof Object>,
      ground: {} as THREE.Mesh,
      sunLight: new THREE.DirectionalLight(),
      sunHalo: {} as THREE.Sprite,
      lightShafts: [],
      sunDirection: new THREE.Vector3(),
      fog: new THREE.Fog(0x000000),
      rocks: [],
      forestPatches: [],
      sunSprite: {} as THREE.Sprite,
      update: vi.fn(),
      setVisible: vi.fn(),
      setFogEnabled: vi.fn(),
      setTimeOfDay: vi.fn(),
      setLightShaftsEnabled: vi.fn(),
      dispose: vi.fn(() => {
        disposeCount.value++;
        scene.remove(sentinel);
      }),
    } as unknown as NatureEnvironment;
  });

  return { factory, createCount, disposeCount };
}

function makeFishtankEnvFactory() {
  const createCount = { value: 0 };
  const disposeCount = { value: 0 };

  const factory = vi.fn((scene: THREE.Scene): FishtankEnvironment => {
    createCount.value++;
    const sentinel = new THREE.Object3D();
    sentinel.name = 'fishtank-sentinel';
    scene.add(sentinel);
    return {
      keyLight: new THREE.DirectionalLight(),
      setVisible: vi.fn(),
      setFogEnabled: vi.fn(),
      setTimeOfDay: vi.fn(),
      setWaterEffectsEnabled: vi.fn(),
      setRoomVisible: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(() => {
        disposeCount.value++;
        scene.remove(sentinel);
      }),
    } as unknown as FishtankEnvironment;
  });

  return { factory, createCount, disposeCount };
}

function countSentinels(scene: THREE.Scene): { nature: number; fishtank: number } {
  let nature = 0;
  let fishtank = 0;
  scene.traverse((obj) => {
    if (obj.name === 'nature-sentinel') nature++;
    if (obj.name === 'fishtank-sentinel') fishtank++;
  });
  return { nature, fishtank };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LazyEnvProvider', () => {
  let scene: THREE.Scene;
  let natFactory: ReturnType<typeof makeNatureEnvFactory>;
  let tankFactory: ReturnType<typeof makeFishtankEnvFactory>;
  let provider: LazyEnvProvider;

  beforeEach(() => {
    scene = new THREE.Scene();
    natFactory = makeNatureEnvFactory();
    tankFactory = makeFishtankEnvFactory();
    provider = new LazyEnvProvider(
      scene,
      {} as THREE.WebGLRenderer,
      natFactory.factory,
      tankFactory.factory,
    );
  });

  it('starts with no environments and no scene children', () => {
    expect(provider.getNatureEnv()).toBeNull();
    expect(provider.getFishtankEnv()).toBeNull();
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 0 });
  });

  it('creates the nature env and adds it to the scene on switchToStyle("nature")', () => {
    provider.switchToStyle('nature');
    expect(natFactory.createCount.value).toBe(1);
    expect(provider.getNatureEnv()).not.toBeNull();
    expect(provider.getFishtankEnv()).toBeNull();
    expect(countSentinels(scene)).toEqual({ nature: 1, fishtank: 0 });
  });

  it('creates the fishtank env and adds it to the scene on switchToStyle("fishtank")', () => {
    provider.switchToStyle('fishtank');
    expect(tankFactory.createCount.value).toBe(1);
    expect(provider.getFishtankEnv()).not.toBeNull();
    expect(provider.getNatureEnv()).toBeNull();
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 1 });
  });

  it('arcade leaves neither env in the scene graph', () => {
    provider.switchToStyle('nature');
    provider.switchToStyle('arcade');
    expect(provider.getNatureEnv()).toBeNull();
    expect(provider.getFishtankEnv()).toBeNull();
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 0 });
  });

  it('disposes nature env and creates fishtank env when switching nature → fishtank', () => {
    provider.switchToStyle('nature');
    const natEnv = provider.getNatureEnv()!;

    provider.switchToStyle('fishtank');

    expect(natEnv.dispose).toHaveBeenCalledOnce();
    expect(natFactory.disposeCount.value).toBe(1);
    expect(tankFactory.createCount.value).toBe(1);
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 1 });
  });

  it('disposes fishtank env and creates nature env when switching fishtank → nature', () => {
    provider.switchToStyle('fishtank');
    const tankEnv = provider.getFishtankEnv()!;

    provider.switchToStyle('nature');

    expect(tankEnv.dispose).toHaveBeenCalledOnce();
    expect(tankFactory.disposeCount.value).toBe(1);
    expect(natFactory.createCount.value).toBe(1);
    expect(countSentinels(scene)).toEqual({ nature: 1, fishtank: 0 });
  });

  it('is idempotent: repeated switchToStyle with the same style is a no-op', () => {
    provider.switchToStyle('nature');
    const natEnv = provider.getNatureEnv();
    provider.switchToStyle('nature');
    provider.switchToStyle('nature');

    expect(natFactory.createCount.value).toBe(1);
    expect(natFactory.disposeCount.value).toBe(0);
    expect(provider.getNatureEnv()).toBe(natEnv); // same instance
    expect(countSentinels(scene)).toEqual({ nature: 1, fishtank: 0 });
  });

  it('disposes the active env on provider.dispose()', () => {
    provider.switchToStyle('nature');
    provider.dispose();

    expect(natFactory.disposeCount.value).toBe(1);
    expect(provider.getNatureEnv()).toBeNull();
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 0 });
  });

  it('does not double-dispose on provider.dispose() called twice', () => {
    provider.switchToStyle('fishtank');
    provider.dispose();
    provider.dispose(); // second call should be a no-op

    expect(tankFactory.disposeCount.value).toBe(1);
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 0 });
  });

  it('switch-cycle test: at most one env exists in the scene graph at any time', () => {
    const styles: Array<'nature' | 'fishtank' | 'arcade'> = [
      'nature', 'fishtank', 'arcade', 'nature', 'arcade', 'fishtank', 'nature', 'fishtank',
    ];
    for (const style of styles) {
      provider.switchToStyle(style);
      const { nature, fishtank } = countSentinels(scene);
      // At most one env present (nature XOR fishtank; arcade has neither)
      expect(nature + fishtank).toBeLessThanOrEqual(1);
      // The active env matches the style
      if (style === 'nature') expect(nature).toBe(1);
      if (style === 'fishtank') expect(fishtank).toBe(1);
      if (style === 'arcade') expect(nature + fishtank).toBe(0);
    }
  });

  it('switch-cycle test: no resource growth — dispose count matches create count minus active env', () => {
    const N = 5;
    // Cycle nature → fishtank → arcade N times then end on arcade
    for (let i = 0; i < N; i++) {
      provider.switchToStyle('nature');
      provider.switchToStyle('fishtank');
      provider.switchToStyle('arcade');
    }
    // Each cycle: 1 nature create+dispose, 1 fishtank create+dispose
    expect(natFactory.createCount.value).toBe(N);
    expect(natFactory.disposeCount.value).toBe(N);
    expect(tankFactory.createCount.value).toBe(N);
    expect(tankFactory.disposeCount.value).toBe(N);
    // Scene is clean
    expect(countSentinels(scene)).toEqual({ nature: 0, fishtank: 0 });
  });
});

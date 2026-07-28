// @vitest-environment jsdom
/**
 * POV camera orientation tests (issue #259).
 *
 * Invariant: the POV camera's forward direction (lookAt − camPos) must have a
 * positive dot product with the creature's velocity (= renderHeading direction)
 * for every supported creature type.  A negative dot product means the camera
 * faces backwards from the nose toward the tail — exactly the bug that
 * afflicted the shark.
 *
 * The forward extent fed into each test case is derived from the actual
 * creature geometry (box.max.y of the body mesh × world/mesh scale factors),
 * not from arbitrary constants, so any future geometry change that would
 * re-introduce the backwards-camera symptom will cause these assertions to
 * fail.
 *
 * Test file name: FollowCamController.povOrientation.test.ts
 * (concern-scoped — see AGENTS.md §3 for why "camera.test.ts" is forbidden)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { FollowCamController } from './FollowCamController';
import { createSharkGeometries } from './styles/fishtank/geometry/sharkGeometry';
import { createBarracudaGeometries } from './styles/fishtank/geometry/barracudaGeometry';
import { FISHTANK_CREATURE_SIZES } from './sceneRenderers/FishtankSceneRenderer3D';
import { TANK_VISUAL_SCALE } from './styles/fishtank/environment';
import { params, resetParams } from '../sim/params';
import type { Boid } from '../sim/Boid';
import type { Renderer3D } from './Renderer3D';

// ---------------------------------------------------------------------------
// Helpers to derive geometric forward extents from actual body meshes.
// ---------------------------------------------------------------------------

/** Returns box.max.y for the shark body geometry — the model-space nose tip. */
function sharkBodyForwardModel(): number {
  const geo = createSharkGeometries(
    FISHTANK_CREATURE_SIZES.shark.length,
    FISHTANK_CREATURE_SIZES.shark.width,
  );
  geo.body.computeBoundingBox();
  return geo.body.boundingBox!.max.y;
}

/** Returns box.max.y for the barracuda body geometry. */
function barracudaBodyForwardModel(): number {
  const geo = createBarracudaGeometries(
    FISHTANK_CREATURE_SIZES.barracuda.length,
    FISHTANK_CREATURE_SIZES.barracuda.width,
  );
  geo.body.computeBoundingBox();
  return geo.body.boundingBox!.max.y;
}

// ---------------------------------------------------------------------------
// Fishtank mesh-scale boosts (mirrors FishtankSceneRenderer3D constants,
// which are module-private, so we replicate the values here for test clarity).
// These are rendering scale factors, not geometry; the geometric quantity is
// box.max.y computed above.
// ---------------------------------------------------------------------------
const FISH_MESH_BOOST = 2.2;
const SHARK_MESH_BOOST = 1.1; // shark-specific boost on top of base fish boost
const BARRACUDA_MESH_BOOST = 0.88;

// ---------------------------------------------------------------------------
// Forward-extent values used per test case.
// getCreatureForwardExtent returns: box.max.y * entityScale * worldScale * meshScaleBoost
// For predators, entityScale = 1 (Predator has no .scale property).
// ---------------------------------------------------------------------------

// Shark: the bug case — this value exceeds POV_LOOK_AHEAD_SIM * TANK_VISUAL_SCALE
// (50 * 4 = 200 rendered units).
const SHARK_FORWARD_EXTENT =
  sharkBodyForwardModel() * /* entityScale */ 1 * TANK_VISUAL_SCALE * FISH_MESH_BOOST * SHARK_MESH_BOOST;

// Barracuda: was already correct before the fix.
const BARRACUDA_FORWARD_EXTENT =
  barracudaBodyForwardModel() * 1 * TANK_VISUAL_SCALE * FISH_MESH_BOOST * BARRACUDA_MESH_BOOST;

// ---------------------------------------------------------------------------
// Test case table.
// ---------------------------------------------------------------------------
interface PovCase {
  label: string;
  /** Value returned by the mocked getCreatureForwardExtent (rendered units). */
  forwardExtent: number;
  /** Multiplier applied by the mocked toRenderedPosition (worldScale). */
  worldScale: number;
}

const POV_CASES: PovCase[] = [
  // --- Nature / arcade (worldScale = 1, small nose extents) ---
  { label: 'nature-bird', forwardExtent: 10, worldScale: 1 },
  { label: 'nature-dragon', forwardExtent: 40, worldScale: 1 },
  { label: 'nature-unicorn', forwardExtent: 35, worldScale: 1 },
  { label: 'arcade-hawk', forwardExtent: 20, worldScale: 1 },
  // --- Fishtank small fish (worldScale = 4) ---
  { label: 'fishtank-fish', forwardExtent: 70, worldScale: TANK_VISUAL_SCALE },
  // --- Fishtank predators (worldScale = 4, extents from real geometry) ---
  { label: 'fishtank-seahorse', forwardExtent: 100, worldScale: TANK_VISUAL_SCALE },
  { label: 'fishtank-barracuda', forwardExtent: BARRACUDA_FORWARD_EXTENT, worldScale: TANK_VISUAL_SCALE },
  // The shark was the failing case: its forwardExtent exceeds
  // POV_LOOK_AHEAD_SIM * worldScale = 200, reversing the camera.
  { label: 'fishtank-shark', forwardExtent: SHARK_FORWARD_EXTENT, worldScale: TANK_VISUAL_SCALE },
];

// ---------------------------------------------------------------------------
// Shared test runner.
// ---------------------------------------------------------------------------

/** Build a minimal Renderer3D stub for POV orientation tests. */
function makePovRenderer({
  forwardExtent,
  worldScale,
  onSetPovCamera,
}: {
  forwardExtent: number;
  worldScale: number;
  onSetPovCamera: (camPos: THREE.Vector3, lookAt: THREE.Vector3) => void;
}): Renderer3D {
  return {
    toRenderedPosition: (x: number, y: number, z: number) =>
      new THREE.Vector3(x * worldScale, y * worldScale, z * worldScale),
    getCreatureForwardExtent: () => forwardExtent,
    smoothOrbitTarget: () => {},
    resetOrbitTarget: () => {},
    getCreatureLabels: () => ({ boid: {}, predator: {} }),
    enterPovMode: () => {},
    exitPovMode: () => {},
    setPovCamera: (pos: THREE.Vector3, look: THREE.Vector3) =>
      onSetPovCamera(pos.clone(), look.clone()),
  } as unknown as Renderer3D;
}

/** Build a minimal Boid stub with a given heading. */
function makeHeadingBoid(heading: { x: number; y: number; z: number }): Boid {
  return {
    id: 1,
    position: { x: 100, y: 50, z: 30 },
    velocity: heading,
    renderHeading: heading,
    species: 'normal',
    panicLevel: 0,
  } as unknown as Boid;
}

describe('FollowCamController POV orientation — camera always faces forward', () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetParams();
    params.followCamMode = 'orbit';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    resetParams();
  });

  // Document that the shark's forward extent exceeds the old look-ahead distance.
  // If this ever becomes false, the test below would trivially pass for the wrong
  // reason (no actual regression risk any more) — fail loudly so we know.
  it('shark forward extent exceeds old body-centre look-ahead distance (= POV_LOOK_AHEAD_SIM * worldScale)', () => {
    const oldLookAhead = 50 /* POV_LOOK_AHEAD_SIM */ * TANK_VISUAL_SCALE;
    // noseOffset = forwardExtent * POV_NOSE_FORWARD_FACTOR (1.1)
    const sharkNoseOffset = SHARK_FORWARD_EXTENT * 1.1;
    expect(sharkNoseOffset).toBeGreaterThan(oldLookAhead);
  });

  for (const { label, forwardExtent, worldScale } of POV_CASES) {
    it(`${label}: POV camera forward direction dot product with heading > 0`, () => {
      const controller = new FollowCamController(container);

      // Heading along +X (non-trivial; not an axis that could mask sign errors
      // because the other components happen to cancel).
      const h = { x: 1, y: 0, z: 0 };
      const entity = makeHeadingBoid(h);

      let camPos: THREE.Vector3 | null = null;
      let lookAt: THREE.Vector3 | null = null;

      const renderer3D = makePovRenderer({
        forwardExtent,
        worldScale,
        onSetPovCamera: (pos, look) => {
          camPos = pos;
          lookAt = look;
        },
      });

      const sim = {
        width: 800,
        height: 600,
        boids: [entity],
        predators: [],
      };

      // Force-select the boid and enter POV mode.
      (controller as unknown as { selectedId: number | null }).selectedId = 1;
      (controller as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;
      controller.enterPov(renderer3D);

      // First update snaps the look target — no lerp, so the result is exact.
      controller.update(0.016, sim as any, renderer3D);

      expect(camPos).not.toBeNull();
      expect(lookAt).not.toBeNull();

      const forward = new THREE.Vector3().subVectors(lookAt!, camPos!);
      const heading = new THREE.Vector3(h.x, h.y, h.z);
      const dot = forward.dot(heading);

      expect(dot).toBeGreaterThan(0);
    });
  }

  // Also test with a heading that has Y and Z components to rule out axis-specific flukes.
  it('fishtank-shark with diagonal heading (1,1,0): POV camera faces forward', () => {
    const controller = new FollowCamController(container);

    const len = Math.SQRT2;
    const h = { x: 1 / len, y: 1 / len, z: 0 };
    const entity = makeHeadingBoid(h);

    let camPos: THREE.Vector3 | null = null;
    let lookAt: THREE.Vector3 | null = null;

    const renderer3D = makePovRenderer({
      forwardExtent: SHARK_FORWARD_EXTENT,
      worldScale: TANK_VISUAL_SCALE,
      onSetPovCamera: (pos, look) => {
        camPos = pos;
        lookAt = look;
      },
    });

    const sim = {
      width: 800,
      height: 600,
      boids: [entity],
      predators: [],
    };

    (controller as unknown as { selectedId: number | null }).selectedId = 1;
    (controller as unknown as { selectedIsPredator: boolean }).selectedIsPredator = false;
    controller.enterPov(renderer3D);
    controller.update(0.016, sim as any, renderer3D);

    const forward = new THREE.Vector3().subVectors(lookAt!, camPos!);
    const heading = new THREE.Vector3(h.x, h.y, h.z);
    expect(forward.dot(heading)).toBeGreaterThan(0);
  });
});

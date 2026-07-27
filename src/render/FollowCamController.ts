import * as THREE from 'three';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from './Renderer3D';
import { params } from '../sim/params';
import { pickEntity, type EntityForPicking } from './EntityPicker';
import { CreatureHud } from './CreatureHud';

/** Exponential-smoothing rate (1/s) for damping the orbit-controls target. */
const TARGET_DAMP_RATE = 8;

/** Exponential-smoothing rate (1/s) for damping the POV camera position and look target. */
const POV_CAM_DAMP_RATE = 6;

/**
 * How far ahead of the creature (in sim-space units) to place the POV
 * look-ahead target.  Mapped through toRenderedPosition so it is correct
 * for every scene (fishtank 4× scale is automatic).
 */
const POV_LOOK_AHEAD_SIM = 50;

/**
 * Fraction of the creature's forward (nose) extent to push the POV camera past
 * the model origin, so it sits just ahead of the head looking out — rather than
 * rendering from inside the body (issue #159). Slightly >1 keeps a small margin
 * so the beak/snout never pokes into the camera's near plane.
 */
const POV_NOSE_FORWARD_FACTOR = 1.1;

/** CSS-pixel radius within which a pointer-up is considered a stationary click. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Returns true when the pointer moved more than `thresholdPx` CSS pixels
 * between a pointerdown and the matching pointerup.
 *
 * Pure function — no DOM dependencies, safe to unit-test directly.
 */
export function isDragMove(
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  thresholdPx = DRAG_THRESHOLD_PX,
): boolean {
  const dx = upX - downX;
  const dy = upY - downY;
  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}

/**
 * Implements the Creature View (Lane A, Tier 1 "orbit-lock") follow-cam
 * feature. When `params.followCamMode === 'orbit'`:
 *  - A left-click on the 3D canvas selects the creature nearest the cursor
 *    (screen-space projection, no raycasting).
 *  - Each frame the OrbitControls target is exponentially smoothed toward
 *    the selected creature's position, keeping it centred while the user
 *    retains full orbit/zoom interactivity.
 *  - If a creature is selected and `params.showCreatureInspector` is true,
 *    a small HUD overlay shows species, speed, and a coarse state label.
 *
 * When `followCamMode === 'off'` the controller is entirely inert.
 */
export class FollowCamController {
  private selectedId: number | null = null;
  private selectedIsPredator = false;
  private readonly hud: CreatureHud;

  // Pointer-down coordinates for drag-vs-click discrimination.
  private _pointerDownX = 0;
  private _pointerDownY = 0;
  private _hasPointerDown = false;

  // POV (cockpit) mode state.
  private _povActive = false;
  private _povInitialized = false;
  private readonly _povCamPos = new THREE.Vector3();
  private readonly _povLookPos = new THREE.Vector3();

  // Latest renderer3D + sim from update() — used by the POV button handler
  // so the button can act without needing them injected at construction time.
  private _latestRenderer3D: Renderer3D | null = null;
  private _latestSim: Simulation | null = null;

  constructor(container: HTMLElement) {
    this.hud = new CreatureHud(container, () => {
      if (!this._latestRenderer3D || !this._latestSim) return;
      if (this._povActive) {
        this.exitPov(this._latestRenderer3D, this._latestSim);
      } else {
        this.enterPov(this._latestRenderer3D);
      }
    });
  }

  /**
   * Call from a `pointerdown` event listener on the 3D canvas.
   * Records the start position for drag-vs-click discrimination.
   * Only the primary (left) button participates.
   */
  handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this._pointerDownX = event.clientX;
    this._pointerDownY = event.clientY;
    this._hasPointerDown = true;
  }

  /**
   * Call from a `pointerup` event listener on the 3D canvas.
   * Runs the creature-selection path only when the pointer has not moved
   * beyond `DRAG_THRESHOLD_PX` since the matching `handlePointerDown`.
   * Movements above the threshold (orbit/pan drags) leave the current
   * selection untouched.
   */
  handlePointerUp(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    sim: Simulation,
    renderer3D: Renderer3D,
  ): void {
    if (event.button !== 0 || !this._hasPointerDown) return;
    this._hasPointerDown = false;
    if (isDragMove(this._pointerDownX, this._pointerDownY, event.clientX, event.clientY)) return;
    this.handleCanvasClick(event, canvas, sim, renderer3D);
  }

  /**
   * Picks the creature nearest the pointer (within the default threshold)
   * or deselects if the pointer is too far from any entity.
   *
   * Called internally by `handlePointerUp` for stationary clicks.
   * May also be called directly when drag detection is handled upstream.
   */
  handleCanvasClick(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    sim: Simulation,
    renderer3D: Renderer3D,
  ): void {
    if (params.followCamMode !== 'orbit') return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const entities = this.buildEntityList(sim, renderer3D);
    const picked = pickEntity(mouseX, mouseY, rect.width, rect.height, renderer3D.getCamera(), entities);

    if (picked) {
      this.selectedId = picked.id;
      this.selectedIsPredator = picked.isPredator;
    } else {
      this.clearSelection(renderer3D, sim);
    }
  }

  /**
   * Per-frame update — call before `renderer3D.render()` so the orbit target
   * is current when OrbitControls.update() runs inside renderOutput().
   */
  update(dt: number, sim: Simulation, renderer3D: Renderer3D): void {
    // Cache for use by the POV button click handler.
    this._latestRenderer3D = renderer3D;
    this._latestSim = sim;

    if (params.followCamMode !== 'orbit') {
      if (this._povActive) this.exitPov(renderer3D, sim);
      this.hud.hide();
      return;
    }

    const entity = this.resolveSelected(sim);
    if (!entity) {
      if (this.selectedId !== null) {
        // Entity was removed (population change) — gracefully deselect and
        // reset the orbit target back to scene centre so the user isn't left
        // orbiting an off-centre point near the boundary.
        this.clearSelection(renderer3D, sim);
      }
      this.hud.hide();
      return;
    }

    if (this._povActive) {
      // POV mode: drive camera directly along the creature's smoothed heading.
      this.updatePovCamera(entity, dt, renderer3D);
    } else {
      // Orbit-lock: exponentially smooth the orbit target toward the selected
      // creature's render-space position so it stays centred while the user
      // orbits/zooms.
      const alpha = 1 - Math.exp(-dt * TARGET_DAMP_RATE);
      const renderedPos = renderer3D.toRenderedPosition(
        entity.position.x,
        entity.position.y,
        entity.position.z,
      );
      renderer3D.smoothOrbitTarget(renderedPos.x, renderedPos.y, renderedPos.z, alpha);
    }

    if (params.showCreatureInspector) {
      this.hud.sync(entity, this.selectedIsPredator, renderer3D);
    } else {
      this.hud.hide();
    }
  }

  /** Clears the current selection and resets the orbit target to scene center. */
  deselect(renderer3D: Renderer3D, sim: Simulation): void {
    this.clearSelection(renderer3D, sim);
  }

  /**
   * Enters first-person / POV mode for the currently selected creature.
   * No-op if no creature is selected or POV is already active.
   * POV places the camera at the creature, oriented along its smoothed
   * `renderHeading`, with exponential position damping for comfort.
   */
  enterPov(renderer3D: Renderer3D): void {
    if (this._povActive || this.selectedId === null) return;
    this._povActive = true;
    this._povInitialized = false;
    renderer3D.enterPovMode();
    this.hud.setPovButtonText('Exit POV (Esc)');
  }

  /**
   * Exits POV mode and returns to orbit-lock on the selected creature,
   * or to free orbit if the selection has been cleared. No-op when not
   * in POV mode.
   */
  exitPov(renderer3D: Renderer3D, sim: Simulation): void {
    if (!this._povActive) return;
    this._povActive = false;
    this._povInitialized = false;
    this.hud.setPovButtonText('Enter POV');
    // Restore orbit centered on the creature (or scene center if gone).
    const entity = this.resolveSelected(sim);
    const orbitTarget = entity
      ? renderer3D.toRenderedPosition(entity.position.x, entity.position.y, entity.position.z)
      : renderer3D.toRenderedPosition(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    renderer3D.exitPovMode(orbitTarget);
  }

  /**
   * Exits POV mode when the Escape key is pressed.
   * Wire this to a `keydown` event listener on the document in main.ts.
   */
  handleEscKey(renderer3D: Renderer3D, sim: Simulation): void {
    if (this._povActive) this.exitPov(renderer3D, sim);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Shared "on deselect" path — exits POV if active, clears selection state,
   * hides the HUD, and resets the OrbitControls target back to the scene
   * center so the user doesn't orbit around a stale off-centre point after
   * the creature is gone.
   */
  private clearSelection(renderer3D: Renderer3D, sim: Simulation): void {
    if (this._povActive) {
      // Exit POV without full orbit setup — resetOrbitTarget below handles target.
      this._povActive = false;
      this._povInitialized = false;
      this.hud.setPovButtonText('Enter POV');
      renderer3D.exitPovMode(renderer3D.toRenderedPosition(sim.width / 2, sim.height / 2, params.worldDepth / 2));
    }
    this.selectedId = null;
    this.selectedIsPredator = false;
    this.hud.hide();
    renderer3D.resetOrbitTarget(sim);
  }

  /**
   * Per-frame POV camera update: rigidly locks the camera to the creature's
   * rendered nose (so it always looks out from the head, never from inside or
   * behind the body — issue #159) and orients it along the smoothed
   * `renderHeading`. Only the look-ahead target is exponentially damped, which
   * smooths turning without letting the camera lag behind the body. On the first
   * POV frame the look target snaps so there is no visible fly-in.
   */
  private updatePovCamera(entity: Boid | Predator, dt: number, renderer3D: Renderer3D): void {
    const renderedPos = renderer3D.toRenderedPosition(
      entity.position.x,
      entity.position.y,
      entity.position.z,
    );
    // Push the camera from the model origin (body centre) forward to the
    // creature's nose so it looks out from the head instead of from inside the
    // body (issue #159). renderHeading is a unit direction that is identical in
    // sim and render space (scene worldScale is uniform), and getCreatureForwardExtent
    // already returns the nose offset in world units, so we can add it directly.
    const h = entity.renderHeading;
    const entityScale = 'scale' in entity ? entity.scale : 1;
    const noseOffset =
      renderer3D.getCreatureForwardExtent(entity.species, this.selectedIsPredator, entityScale) *
      POV_NOSE_FORWARD_FACTOR;
    // Camera position is rigid (no damping): the creature moves smoothly from
    // the sim and renderHeading is already smoothed, so locking the camera to
    // the nose every frame keeps the body consistently behind the camera. Any
    // position damping here lets the body pull ahead of the lagging camera,
    // which is exactly what showed the bird's beak/interior.
    this._povCamPos.set(
      renderedPos.x + h.x * noseOffset,
      renderedPos.y + h.y * noseOffset,
      renderedPos.z + h.z * noseOffset,
    );
    // Map the look-ahead point through toRenderedPosition so fishtank's 4×
    // scale is applied to both position and direction offset uniformly.
    const lookAheadRender = renderer3D.toRenderedPosition(
      entity.position.x + h.x * POV_LOOK_AHEAD_SIM,
      entity.position.y + h.y * POV_LOOK_AHEAD_SIM,
      entity.position.z + h.z * POV_LOOK_AHEAD_SIM,
    );

    if (!this._povInitialized) {
      // Snap the look target on the very first POV frame so the camera doesn't
      // interpolate its aim from whatever it was in orbit mode.
      this._povLookPos.copy(lookAheadRender);
      this._povInitialized = true;
    } else {
      const alpha = 1 - Math.exp(-dt * POV_CAM_DAMP_RATE);
      this._povLookPos.lerp(lookAheadRender, alpha);
    }

    renderer3D.setPovCamera(this._povCamPos, this._povLookPos);
  }

  private buildEntityList(sim: Simulation, renderer3D: Renderer3D): EntityForPicking[] {
    const entities: EntityForPicking[] = [];
    for (const boid of sim.boids) {
      const pos = renderer3D.toRenderedPosition(boid.position.x, boid.position.y, boid.position.z);
      entities.push({ id: boid.id, position: pos, isPredator: false });
    }
    for (const predator of sim.predators) {
      const pos = renderer3D.toRenderedPosition(predator.position.x, predator.position.y, predator.position.z);
      entities.push({ id: predator.id, position: pos, isPredator: true });
    }
    return entities;
  }

  private resolveSelected(sim: Simulation): Boid | Predator | null {
    if (this.selectedId === null) return null;
    if (this.selectedIsPredator) {
      return sim.predators.find((p) => p.id === this.selectedId) ?? null;
    }
    return sim.boids.find((b) => b.id === this.selectedId) ?? null;
  }
}

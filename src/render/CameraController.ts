import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

/**
 * Owns the Creature Gallery / deep-link camera-framing helpers. These all
 * operate purely on the shared perspective camera + OrbitControls (held by
 * reference, not owned — Renderer3D creates them and still drives the
 * per-scene auto-framing), so grouping them here keeps that self-contained
 * concern out of Renderer3D's main body.
 */
export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;

  // Saved OrbitControls distance bounds, restored when POV mode exits.
  private _povSavedMinDist = 0;
  private _povSavedMaxDist = Infinity;

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
  }

  /**
   * Creature Gallery / debug-QA helper: point the camera at a fixed
   * world-space position from a pleasant, fixed elevated 3/4 angle
   * (roughly matching a typical reference-photo framing of a flying
   * creature) and hold it there. Used by main.ts's Creature Gallery feature
   * (`params.galleryCreature`, also drivable via the `?galleryCreature=`
   * URL param) which isolates a single creature, freezes the sim, and
   * poses it at a known position — the combination gives a clean,
   * well-framed view/screenshot for comparing a creature's geometry
   * against a reference image, and for orbiting it with the mouse
   * (OrbitControls stays enabled/interactive throughout).
   *
   * Safe to call any time: it has no effect on ensureScene's own camera
   * auto-framing, which only runs once per distinct world size (not
   * every frame), so a framing set here persists across subsequent
   * render() calls as long as the world dimensions don't change. The
   * user can still freely orbit/zoom from here via OrbitControls.
   */
  debugFrameCamera(x: number, y: number, z: number, distance: number): void {
    const target = new THREE.Vector3(x, y, z);
    this.camera.position.set(target.x + distance * 0.7, target.y + distance * 0.35, target.z + distance * 0.9);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    // ensureScene's world-scale zoom clamp (controls.minDistance =
    // maxDim * 0.05) is tuned for the whole-world view and is often far
    // larger than a small creature's tight gallery framing distance
    // (e.g. a sparrow vs. a 1000-unit-deep world) — OrbitControls.update()
    // would otherwise silently push the camera back out past that floor,
    // undoing the close-up framing entirely. Relax the floor down to
    // this call's own distance (never *raise* it, since that's still
    // meaningful for normal, non-gallery browsing) so the requested
    // distance actually sticks. resetCameraFraming restores the normal
    // world-scale floor when the gallery closes.
    const effectiveDistance = target.distanceTo(this.camera.position);
    this.controls.minDistance = Math.min(this.controls.minDistance, effectiveDistance * 0.5);
    this.controls.update();
  }

  /**
   * Restores the default whole-world camera framing (same computation
   * ensureScene applies the first time it sees a given world size) —
   * used when exiting the Creature Gallery to put the camera back where a
   * normal, non-isolated simulation view expects it, since
   * debugFrameCamera's close-up framing would otherwise persist
   * (ensureScene only re-frames automatically when world dimensions
   * change, which exiting the gallery doesn't do).
   */
  resetCameraFraming(sim: Simulation): void {
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    this.camera.position.set(center.x + maxDim * 0.6, center.y + maxDim * 0.4, center.z + maxDim * 0.9);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    // Undo debugFrameCamera's possible relaxation of the zoom-in floor
    // (see its comment) — restores the normal world-scale clamp so
    // regular, non-gallery browsing can't zoom the camera through the
    // ground/boundary box.
    this.controls.minDistance = maxDim * 0.05;
    this.controls.update();
  }

  /**
   * Snapshot of the exact current camera position + OrbitControls
   * target, as plain [x, y, z] tuples — used by main.ts's "Copy deep
   * link" feature to serialize the current view into a shareable URL
   * (see setCameraState for the restore side). Deliberately returns
   * plain tuples rather than THREE.Vector3 so the caller can JSON.stringify
   * it directly without a custom serializer.
   */
  getCameraState(): { position: [number, number, number]; target: [number, number, number] } {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    };
  }

  /**
   * Restores an exact camera position + orbit target previously captured
   * via getCameraState — used when loading a "Copy deep link" URL, so
   * the view on load matches exactly what was captured, not just an
   * auto-framed approximation. Like debugFrameCamera, this is safe to
   * call any time and doesn't fight ensureScene's one-time auto-framing
   * as long as it's called after that first render() call has run (see
   * main.ts's pendingCameraState handling).
   */
  setCameraState(position: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.updateProjectionMatrix();
    this.controls.target.set(target[0], target[1], target[2]);
    this.controls.update();
  }

  /**
   * Exponentially smooth the OrbitControls orbit target toward a world-space
   * position — used by FollowCamController's orbit-lock mode.
   * `alpha` is the per-frame blend factor (0 = no movement, 1 = snap).
   * OrbitControls.update() is NOT called here; Renderer3D.renderOutput() calls
   * it every frame so the smooth motion is picked up automatically.
   */
  smoothOrbitTarget(x: number, y: number, z: number, alpha: number): void {
    const t = this.controls.target;
    t.x += (x - t.x) * alpha;
    t.y += (y - t.y) * alpha;
    t.z += (z - t.z) * alpha;
  }

  /** Returns the perspective camera — used by the screen-space entity picker. */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Enters POV mode: saves OrbitControls distance bounds so they can be
   * fully restored on exit. While POV is active, Renderer3D skips
   * OrbitControls.update() so the camera can be driven directly without
   * the min/max-distance constraints fighting each frame.
   */
  enterPovMode(): void {
    this._povSavedMinDist = this.controls.minDistance;
    this._povSavedMaxDist = this.controls.maxDistance;
  }

  /**
   * Exits POV mode: restores saved distance bounds and sets the orbit
   * target to `orbitTarget` so OrbitControls resumes orbiting around
   * the creature (or scene center when the selection is cleared).
   * Calls controls.update() once to synchronise internal spherical state
   * from the current camera position before the render loop resumes
   * normal OrbitControls updates.
   */
  exitPovMode(orbitTarget: THREE.Vector3): void {
    this.controls.minDistance = this._povSavedMinDist;
    this.controls.maxDistance = this._povSavedMaxDist;
    this.controls.target.copy(orbitTarget);
    this.controls.update();
  }

  /**
   * Directly positions the camera for POV mode.
   * OrbitControls.update() must be skipped on the same frame (ensured
   * by Renderer3D._povActive) so OrbitControls does not immediately
   * recompute and overwrite the camera position.
   */
  setPovCamera(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(lookAt);
    this.camera.updateMatrixWorld();
  }
}

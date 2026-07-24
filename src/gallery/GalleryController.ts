import { params, type SimMode, type SimParams, type GalleryCreature } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from '../render/Renderer3D';

/**
 * External wiring the gallery/deep-link subsystem needs back from the app
 * entry point. Kept as small callbacks (rather than importing the concrete
 * objects) so this module stays decoupled from how main.ts constructs and
 * owns them:
 *  - `getRenderer3D` is a getter, not the instance, because the 3D
 *    renderer is created lazily and reassigned when the user first enters
 *    3D mode (see main.ts applyMode) — the controller must always read the
 *    current one.
 *  - `applyMode`/`refreshControlPanel` let entering/exiting the gallery
 *    drive the same mode-switch and panel re-render paths a user action
 *    would, without this module depending on ControlPanel or the canvas
 *    plumbing directly.
 */
export interface GalleryControllerDeps {
  sim: Simulation;
  getRenderer3D: () => Renderer3D | null;
  applyMode: (mode: SimMode) => void;
  refreshControlPanel: () => void;
}

/**
 * "Copy deep link" full-state restore: captures every tunable SimParams
 * field plus the exact 3D camera position/orbit target into a single
 * `?state=` URL query param (see buildDeepLinkURL below, wired to a
 * button in ControlPanel). Unlike the `?galleryCreature=` shortcut
 * (which only isolates one creature for close inspection), this
 * reproduces the exact simulation the user had running — full
 * population mix, every slider, and the exact camera framing — making it
 * trivial to share a precise repro/debugging setup via a single link.
 * Deliberately a one-shot capture triggered by a button click, not a
 * continuously-synced URL, per explicit request — the address bar
 * doesn't rewrite itself on every param change.
 */
interface DeepLinkState {
  params: SimParams;
  camera: { position: [number, number, number]; target: [number, number, number] } | null;
}

const GALLERY_PREDATOR_KINDS = new Set<GalleryCreature>(['horse', 'dragon', 'predator']);
const GALLERY_BOID_SPECIES = new Set<GalleryCreature>(['normal', 'multicolor', 'gold', 'red', 'blue']);

function readGalleryCreatureFromURL(): { kind: GalleryCreature; distance: number | null } | null {
  const searchParams = new URLSearchParams(window.location.search);
  const kind = searchParams.get('galleryCreature')?.toLowerCase() ?? null;
  if (!kind || !(GALLERY_PREDATOR_KINDS.has(kind as GalleryCreature) || GALLERY_BOID_SPECIES.has(kind as GalleryCreature))) {
    return null;
  }
  const distanceParam = Number(searchParams.get('galleryDistance'));
  // null (rather than a flat default) when the URL doesn't explicitly
  // request a distance — poseGalleryEntityIfReady then computes a
  // per-creature "as zoomed in as possible" distance instead (see
  // Renderer3D.getGalleryFramingDistance), since a single flat default
  // only ever looks right for whichever creature it happened to be
  // tuned against.
  const distance = Number.isFinite(distanceParam) && distanceParam > 0 ? distanceParam : null;
  return { kind: kind as GalleryCreature, distance };
}

function readStateFromURL(): DeepLinkState | null {
  const searchParams = new URLSearchParams(window.location.search);
  const raw = searchParams.get('state');
  if (!raw) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(raw)) as Partial<DeepLinkState> | null;
    if (decoded && typeof decoded === 'object' && decoded.params && typeof decoded.params === 'object') {
      return { params: decoded.params as SimParams, camera: decoded.camera ?? null };
    }
  } catch {
    // Malformed/truncated state param (e.g. hand-edited or a mangled
    // copy/paste) — fall through to a normal, un-restored startup rather
    // than throwing.
  }
  return null;
}

/**
 * Model Gallery + "Copy deep link" controller.
 *
 * Model Gallery isolates a single creature (zeroing every other
 * population), freezes it mid-flight at the world center with a fixed
 * pose, and frames the 3D camera on it — makes it trivial to inspect,
 * orbit (OrbitControls stays fully interactive), or screenshot a single
 * creature's geometry without fighting flocking/wander motion or camera
 * drift. Useful for comparing geometry against a reference image, or
 * simply showing off a model. Reused across creature kinds (unicorns,
 * dragons, hawks, boid species) rather than being unicorn-specific, so
 * any future creature gets this for free.
 *
 * Driven by `params.galleryCreature` (see sim/params.ts), settable two
 * ways:
 *  - Interactively, via the "Model Gallery" dropdown in the control
 *    panel (see ui/ControlPanel.ts) — pick a creature, inspect it, pick
 *    "None" to return to the normal simulation.
 *  - Via the `?galleryCreature=<kind>` URL param (optionally paired with
 *    `?galleryDistance=<number>` to override the default camera
 *    distance) — meant for scripted/automated screenshot tooling (e.g. a
 *    short Playwright script) that needs a stable, repeatable framing
 *    without clicking through the UI.
 *
 * Entering the gallery snapshots the current population/mode/style
 * params so exiting (setting galleryCreature back to null) restores
 * exactly what the user had running before.
 *
 * The constructor reads both URL entry points once (deep link takes
 * precedence over the `?galleryCreature=` shortcut) and applies any
 * restored params immediately, before the ControlPanel is built, so the
 * panel renders the restored state. The per-frame hooks
 * `applySelectionChanges()` (before sim.update) and
 * `poseAndRestoreCameraIfReady()` (after render) drive the rest.
 */
export class GalleryController {
  private readonly sim: Simulation;
  private readonly getRenderer3D: () => Renderer3D | null;
  private readonly applyMode: (mode: SimMode) => void;
  private readonly refreshControlPanel: () => void;

  // Applied once, on the first frame after the initial render() call sets
  // up the scene (see poseAndRestoreCameraIfReady) — applying any earlier
  // would be clobbered by ensureScene's own one-time auto-framing.
  private pendingCameraState: DeepLinkState['camera'] = null;
  // Only URL-driven entry auto-collapses the panel (clean shot for
  // automation) — the interactive dropdown leaves the panel exactly as
  // the user had it, since they need it open to use the dropdown itself.
  private readonly _launchedFromURL: boolean;
  // null means "no explicit override" — poseGalleryEntityIfReady computes
  // a tight, per-creature distance in that case (see
  // Renderer3D.getGalleryFramingDistance).
  private galleryDistanceOverride: number | null;

  private previousGalleryCreature: GalleryCreature | null = null;
  // Tracks the visual style last posed/framed for, while the gallery is
  // active — lets applySelectionChanges detect a mid-gallery style switch
  // (e.g. via the "Visual style" dropdown, which stays fully usable while
  // isolating a creature) and re-pose/re-frame for the new style, since
  // the tank/ground environments differ enough in scale and layout that
  // the old camera framing would otherwise leave the creature off-center
  // or absurdly tiny in a corner of the new environment.
  private previousGalleryVisualStyle: SimParams['visualStyle'] | null = null;
  // Tracks the last mode seen so gallery pose state can be invalidated when
  // switching away from 3D and back again. Without this, the gallery's
  // one-shot pose would stay marked "done" across a 2D detour, so returning
  // to 3D would not re-frame the isolated creature.
  private previousMode: SimMode = params.mode;
  private galleryPosed = false;
  private gallerySnapshot: Pick<
    SimParams,
    | 'mode'
    | 'visualStyle'
    | 'boidCount'
    | 'multicolorCount'
    | 'goldCount'
    | 'redCount'
    | 'blueCount'
    | 'predatorCount'
    | 'horseCount'
    | 'dragonPredators'
    | 'running'
  > | null = null;

  constructor(deps: GalleryControllerDeps) {
    this.sim = deps.sim;
    this.getRenderer3D = deps.getRenderer3D;
    this.applyMode = deps.applyMode;
    this.refreshControlPanel = deps.refreshControlPanel;

    const stateFromURL = readStateFromURL();
    if (stateFromURL) Object.assign(params, stateFromURL.params);
    this.pendingCameraState = stateFromURL?.camera ?? null;

    // The simpler `?galleryCreature=` shortcut is only consulted when a
    // full `?state=` deep link isn't present, since the latter already
    // carries params.galleryCreature (if any) as part of its full
    // snapshot.
    const galleryFromURL = stateFromURL ? null : readGalleryCreatureFromURL();
    this._launchedFromURL = galleryFromURL !== null || (stateFromURL?.params.galleryCreature ?? null) !== null;
    this.galleryDistanceOverride = galleryFromURL?.distance ?? null;
    if (galleryFromURL) params.galleryCreature = galleryFromURL.kind;
  }

  /**
   * Whether the gallery/deep link was launched from a URL param. main.ts
   * uses this to auto-collapse the control panel for a clean,
   * unobstructed automated screenshot — only for the URL-driven entry
   * point, never the interactive dropdown.
   */
  get launchedFromURL(): boolean {
    return this._launchedFromURL;
  }

  /**
   * Builds the shareable "Copy deep link" URL: every current SimParams
   * field plus (if in 3D mode) the exact live camera position/orbit
   * target, packed into a single `?state=` query param. Read back by
   * readStateFromURL/poseAndRestoreCameraIfReady on page load.
   * Intentionally a one-shot snapshot computed on demand (see the
   * ControlPanel button that calls this) rather than a continuously
   * updated URL — the address bar should stay quiet while the user works.
   */
  buildDeepLinkURL(): string {
    const renderer3D = this.getRenderer3D();
    const camera = params.mode === '3d' && renderer3D ? renderer3D.getCameraState() : null;
    const payload: DeepLinkState = { params: { ...params }, camera };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `${window.location.origin}${window.location.pathname}?state=${encoded}`;
  }

  /**
   * Per-frame hook to run *before* sim.update. Detects Model Gallery
   * selection changes (from the control panel dropdown or the initial
   * `?galleryCreature=` URL param) and snapshots/isolates or restores
   * population params accordingly. Polled here rather than via a params
   * change-event system (none exists for most of SimParams) since the
   * main loop is the one place already running every frame.
   */
  applySelectionChanges(): void {
    if (params.mode !== this.previousMode) {
      // Gallery framing is 3D-specific, so any mode flip should clear the
      // one-shot pose flag and let the creature be re-framed when 3D comes
      // back.
      if (params.galleryCreature) {
        this.galleryPosed = false;
        this.previousGalleryVisualStyle = null;
      }
      this.previousMode = params.mode;
    }

    if (params.galleryCreature !== this.previousGalleryCreature) {
      if (params.galleryCreature) this.enterGallery(params.galleryCreature);
      else this.exitGallery();
      this.previousGalleryCreature = params.galleryCreature;
    }

    // Detect a visual style switch made *while* the gallery is active (the
    // "Visual style" dropdown stays fully interactive during gallery mode
    // — see ControlPanel's render()) and force a re-pose/re-frame for it.
    // Without this, switching styles mid-gallery leaves the camera at its
    // old framing while the environment underneath changes shape/scale
    // (e.g. nature's open ground vs. fishtank's room-and-tank), so the
    // creature can end up tiny and off-center in a corner instead of
    // nicely centered for the newly-selected style.
    if (params.galleryCreature && params.visualStyle !== this.previousGalleryVisualStyle) {
      this.galleryPosed = false;
    }
  }

  /**
   * Per-frame hook to run *after* this frame's render() call. Poses the
   * isolated gallery creature and frames the camera on it (once ready),
   * then applies any pending `?state=` deep-link camera.
   *
   * Ordering matters: render()'s internal ensureScene does a one-time
   * initial camera auto-frame the very first time it runs (guarded by a
   * world-size key, not by frame count), which would otherwise clobber
   * debugFrameCamera's framing if the pose ran first on the same frame
   * render() first initializes things. The deep-link camera restore runs
   * *after* the gallery pose so a restored `?state=` deep link's exact
   * camera wins over the Model Gallery's own auto-framing when both apply
   * on the same load (e.g. a deep link captured while the gallery was
   * isolating a creature) — both are one-shot (each clears its own
   * "already applied" flag), so this ordering only matters on the very
   * first frame.
   */
  poseAndRestoreCameraIfReady(): void {
    this.poseGalleryEntityIfReady();
    this.applyPendingCameraStateIfReady();
  }

  private enterGallery(kind: GalleryCreature): void {
    this.gallerySnapshot = {
      mode: params.mode,
      // Snapshotted (and restored on exit) same as the other fields below,
      // but deliberately *not* reset to a fixed style here — the gallery
      // keeps whatever visual style was already active, and the "Visual
      // style" dropdown stays fully usable while the gallery is open (see
      // the previousGalleryVisualStyle check in applySelectionChanges) so
      // a model can be inspected/compared across nature, fishtank, and
      // arcade without ever leaving gallery mode.
      visualStyle: params.visualStyle,
      boidCount: params.boidCount,
      multicolorCount: params.multicolorCount,
      goldCount: params.goldCount,
      redCount: params.redCount,
      blueCount: params.blueCount,
      predatorCount: params.predatorCount,
      horseCount: params.horseCount,
      dragonPredators: params.dragonPredators,
      running: params.running,
    };

    params.mode = '3d';
    params.boidCount = 0;
    params.multicolorCount = 0;
    params.goldCount = 0;
    params.redCount = 0;
    params.blueCount = 0;
    params.predatorCount = 0;
    params.horseCount = 0;
    params.dragonPredators = false;

    if (kind === 'horse') params.horseCount = 1;
    else if (kind === 'dragon') {
      params.predatorCount = 1;
      params.dragonPredators = true;
    } else if (kind === 'predator') params.predatorCount = 1;
    else if (kind === 'normal') params.boidCount = 1;
    else if (kind === 'multicolor') params.multicolorCount = 1;
    else if (kind === 'gold') params.goldCount = 1;
    else if (kind === 'red') params.redCount = 1;
    else if (kind === 'blue') params.blueCount = 1;

    this.galleryPosed = false;
    this.previousGalleryVisualStyle = null;
    this.applyMode(params.mode);
    this.refreshControlPanel();
  }

  private exitGallery(): void {
    if (this.gallerySnapshot) Object.assign(params, this.gallerySnapshot);
    this.gallerySnapshot = null;
    this.galleryPosed = false;
    this.previousGalleryVisualStyle = null;
    this.applyMode(params.mode);
    this.getRenderer3D()?.resetCameraFraming(this.sim);
    this.refreshControlPanel();
  }

  /**
   * Runs once per gallery visit (and again whenever the visual style is
   * switched while the gallery is active — see the previousGalleryVisualStyle
   * check in applySelectionChanges, which clears galleryPosed to force a
   * re-run), as soon as the isolated creature has actually spawned
   * (syncPopulation runs synchronously inside sim.update, so this is
   * typically ready by the very first frame after entering). Poses it at
   * world center with a fixed, camera-friendly velocity (facing
   * right/slightly up, for a 3/4 climbing-flight look), then freezes the
   * whole sim (params.running = false) so the pose and camera framing hold
   * steady. Wing/tail flap animation still plays (it's driven by elapsed
   * time, not sim.update), so the creature doesn't look like a static
   * prop. The camera stays fully orbit/zoom-able afterward via
   * OrbitControls.
   */
  private poseGalleryEntityIfReady(): void {
    const renderer3D = this.getRenderer3D();
    if (!params.galleryCreature || this.galleryPosed || !renderer3D || params.mode !== '3d') return;
    const kind = params.galleryCreature;
    const entity = GALLERY_PREDATOR_KINDS.has(kind) ? this.sim.predators[0] : this.sim.boids[0];
    if (!entity) return;

    const center = { x: this.sim.width / 2, y: this.sim.height / 2, z: params.worldDepth / 2 };
    entity.position.x = center.x;
    entity.position.y = center.y;
    entity.position.z = center.z;

    const speed = GALLERY_PREDATOR_KINDS.has(kind) ? params.predatorMaxSpeed : params.boidMaxSpeed;
    entity.velocity.x = speed * 0.9;
    entity.velocity.y = speed * 0.12;
    entity.velocity.z = speed * 0.35;

    params.running = false;
    this.galleryPosed = true;
    this.previousGalleryVisualStyle = params.visualStyle;

    // Dragons render through the 'normal' predator instance slot (see Predator.kind/dragonPredators),
    // and 'predator' gallery kind also maps to the 'normal' predator slot.
    const instanceKind = (kind === 'dragon' || kind === 'predator') ? 'normal' : kind;
    const distance = this.galleryDistanceOverride ?? renderer3D.getGalleryFramingDistance(instanceKind);
    // The camera must target where the creature actually *renders*, not
    // its raw sim-space position — fishtank style inflates every fish/
    // predator's rendered position around fishtankCenter by
    // TANK_VISUAL_SCALE (see toRenderedPosition's doc comment), so without
    // this conversion the close-up gallery framing aims at empty space
    // next to the creature in fishtank style instead of the creature
    // itself.
    const renderTarget = renderer3D.toRenderedPosition(center.x, center.y, center.z);
    renderer3D.debugFrameCamera(renderTarget.x, renderTarget.y, renderTarget.z, distance);

    // Exposed for an external screenshot/automation script to poll for
    // readiness and to inspect/tweak the posed entity directly.
    (window as unknown as { __debugEntity?: unknown; __debugPosed?: boolean; __debugRenderer?: unknown }).__debugEntity = entity;
    (window as unknown as { __debugPosed?: boolean }).__debugPosed = true;
    (window as unknown as { __debugRenderer?: unknown }).__debugRenderer = renderer3D;
  }

  /**
   * Applies a `?state=` deep link's captured camera position/orbit target
   * exactly once, on the first frame after renderer3D exists and has run
   * its first render() call — any earlier and ensureScene's own one-time
   * auto-framing (keyed on world size, ambient to render()) would
   * immediately clobber it. Mirrors poseGalleryEntityIfReady's same
   * "apply once, right after render()" pattern for the same reason.
   */
  private applyPendingCameraStateIfReady(): void {
    const renderer3D = this.getRenderer3D();
    if (!this.pendingCameraState || !renderer3D || params.mode !== '3d') return;
    renderer3D.setCameraState(this.pendingCameraState.position, this.pendingCameraState.target);
    this.pendingCameraState = null;
  }
}

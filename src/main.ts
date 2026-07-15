import './style.css';
import { Simulation } from './sim/Simulation';
import { Renderer } from './render/Renderer';
import { Renderer3D } from './render/Renderer3D';
import { ControlPanel } from './ui/ControlPanel';
import { params, type SimMode, type SimParams, type GalleryCreature } from './sim/params';
import { onLanguageChange } from './i18n/language';
import { t } from './i18n/translations';

const canvas2D = document.querySelector<HTMLCanvasElement>('#sim-canvas-2d')!;
const canvas3D = document.querySelector<HTMLCanvasElement>('#sim-canvas-3d')!;
const controlPanelBody = document.querySelector<HTMLElement>('#control-panel-body')!;
const controlPanel_el = document.querySelector<HTMLElement>('#control-panel')!;
const controlPanelToggle = document.querySelector<HTMLButtonElement>('#control-panel-toggle')!;
const canvasStack = document.querySelector<HTMLElement>('#canvas-stack')!;
const appTitle = document.querySelector<HTMLElement>('#app-title')!;
const appSubtitle = document.querySelector<HTMLElement>('#app-subtitle')!;
const controlPanelHeading = document.querySelector<HTMLElement>('#control-panel-heading')!;
const renderingStatsOverlay = document.createElement('pre');
renderingStatsOverlay.id = 'rendering-stats-overlay';
renderingStatsOverlay.className = 'rendering-stats-overlay';
renderingStatsOverlay.style.display = 'none';
canvasStack.appendChild(renderingStatsOverlay);

const FRAME_STATS_WINDOW = 120;
const OVERLAY_UPDATE_INTERVAL_MS = 200;
const FRAME_STATS_WARMUP_MS = 4000;
const DIAGNOSTIC_LOG_MAX_ENTRIES = 6000;
const DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES = 2048;
const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 250;
const DIAGNOSTIC_SPIKE_THRESHOLD_MS = 40;
const DIAGNOSTIC_RUNTIME_WINDOW_MS = 1000;
const FRAME_GAP_ELEVATED_MS = 25;
const FRAME_GAP_STALLED_MS = 40;
type DiagnosticEventKind = 'sample' | 'spike';
type FrameGapClass = 'steady' | 'elevated' | 'stalled';
type RuntimeEventKind = 'longtask' | 'gc' | 'visibility' | 'focus';
interface DiagnosticRecord {
  event: DiagnosticEventKind;
  tsMs: number;
  frameMs: number;
  frameGapClass: FrameGapClass;
  simMs: number;
  uiMs: number;
  renderMs: number;
  postMs: number;
  unaccountedMs: number;
  recentLongTaskMs: number;
  recentLongTaskCount: number;
  recentGcMs: number;
  recentGcCount: number;
  visibility: DocumentVisibilityState;
  hasFocus: boolean;
  jsHeapUsedMB: number | null;
  jsHeapTotalMB: number | null;
  jsHeapLimitMB: number | null;
  boids: number;
  predators: number;
  ufos: number;
  mode: SimMode;
  visualStyle: SimParams['visualStyle'] | null;
}
interface DiagnosticRuntimeEventRecord {
  kind: RuntimeEventKind;
  tsMs: number;
  durationMs: number;
  visibility: DocumentVisibilityState | null;
  hasFocus: boolean | null;
}
interface RuntimeWindowStats {
  longTaskMs: number;
  longTaskCount: number;
  gcMs: number;
  gcCount: number;
}
interface HeapSnapshotMb {
  usedMB: number | null;
  totalMB: number | null;
  limitMB: number | null;
}
interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}
interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}
const frameDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
const simDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
const uiDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
const renderDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
const postDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
const unaccountedDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
let frameDurationsCount = 0;
let frameDurationsCursor = 0;
let frameDurationsSum = 0;
let simDurationsSum = 0;
let uiDurationsSum = 0;
let renderDurationsSum = 0;
let postDurationsSum = 0;
let unaccountedDurationsSum = 0;
let overlayLastUpdatedAt = 0;
let statsCaptureStartedAt = performance.now();
let renderingStatsVisibleLastFrame = false;
const diagnosticRecords = new Array<DiagnosticRecord>(DIAGNOSTIC_LOG_MAX_ENTRIES);
const diagnosticRuntimeEvents = new Array<DiagnosticRuntimeEventRecord>(DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES);
let diagnosticCount = 0;
let diagnosticCursor = 0;
let diagnosticRuntimeEventCount = 0;
let diagnosticRuntimeEventCursor = 0;
let lastDiagnosticSampleAt = performance.now();
let diagnosticsCaptureEnabledLastFrame = false;
let diagnosticsCaptureStartedAt: number | null = null;
let diagnosticsLongTaskSupported = false;
let diagnosticsGcSupported = false;
let diagnosticsLongTaskObservedCount = 0;
let diagnosticsGcObservedCount = 0;
let lastFrameGapClass: FrameGapClass = 'steady';
const diagnosticPerformanceObservers: PerformanceObserver[] = [];

function classifyFrameGap(frameMs: number): FrameGapClass {
  if (frameMs >= FRAME_GAP_STALLED_MS) return 'stalled';
  if (frameMs >= FRAME_GAP_ELEVATED_MS) return 'elevated';
  return 'steady';
}

function formatTraceElapsed(now: number): string {
  if (!params.enableDiagnosticsCapture || diagnosticsCaptureStartedAt === null) return 'off';
  const seconds = Math.max(0, (now - diagnosticsCaptureStartedAt) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  return `${minutes}:${String(remSeconds).padStart(2, '0')}`;
}

function appendDiagnosticRuntimeEvent(record: DiagnosticRuntimeEventRecord): void {
  if (!params.enableDiagnosticsCapture) return;
  if (diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES) {
    diagnosticRuntimeEvents[diagnosticRuntimeEventCount++] = record;
    return;
  }
  diagnosticRuntimeEvents[diagnosticRuntimeEventCursor] = record;
  diagnosticRuntimeEventCursor = (diagnosticRuntimeEventCursor + 1) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES;
}

function getDiagnosticRuntimeEventsOrdered(): DiagnosticRuntimeEventRecord[] {
  if (diagnosticRuntimeEventCount === 0) return [];
  if (diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES) {
    return diagnosticRuntimeEvents.slice(0, diagnosticRuntimeEventCount);
  }
  const ordered = new Array<DiagnosticRuntimeEventRecord>(DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES);
  for (let i = 0; i < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES; i++) {
    ordered[i] = diagnosticRuntimeEvents[(diagnosticRuntimeEventCursor + i) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES];
  }
  return ordered;
}

function getRuntimeWindowStats(now: number, windowMs: number): RuntimeWindowStats {
  const cutoff = now - windowMs;
  const stats: RuntimeWindowStats = { longTaskMs: 0, longTaskCount: 0, gcMs: 0, gcCount: 0 };
  for (let i = 0; i < diagnosticRuntimeEventCount; i++) {
    const idx =
      diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES
        ? i
        : (diagnosticRuntimeEventCursor + i) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES;
    const event = diagnosticRuntimeEvents[idx];
    if (!event || event.tsMs < cutoff) continue;
    if (event.kind === 'longtask') {
      stats.longTaskCount++;
      stats.longTaskMs += event.durationMs;
    } else if (event.kind === 'gc') {
      stats.gcCount++;
      stats.gcMs += event.durationMs;
    }
  }
  return stats;
}

function getHeapSnapshotMb(): HeapSnapshotMb {
  const perf = performance as PerformanceWithMemory;
  const memory = perf.memory;
  if (!memory) return { usedMB: null, totalMB: null, limitMB: null };
  const mb = 1024 * 1024;
  return {
    usedMB: memory.usedJSHeapSize / mb,
    totalMB: memory.totalJSHeapSize / mb,
    limitMB: memory.jsHeapSizeLimit / mb,
  };
}

function setupRuntimeDiagnosticsObservers(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const supportedTypes = Array.isArray(PerformanceObserver.supportedEntryTypes) ? PerformanceObserver.supportedEntryTypes : [];
  diagnosticsLongTaskSupported = supportedTypes.includes('longtask');
  diagnosticsGcSupported = supportedTypes.includes('gc');

  if (diagnosticsLongTaskSupported) {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!params.enableDiagnosticsCapture) continue;
        diagnosticsLongTaskObservedCount++;
        appendDiagnosticRuntimeEvent({
          kind: 'longtask',
          tsMs: entry.startTime + entry.duration,
          durationMs: entry.duration,
          visibility: null,
          hasFocus: null,
        });
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
    diagnosticPerformanceObservers.push(longTaskObserver);
  }

  if (diagnosticsGcSupported) {
    const gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!params.enableDiagnosticsCapture) continue;
        diagnosticsGcObservedCount++;
        appendDiagnosticRuntimeEvent({
          kind: 'gc',
          tsMs: entry.startTime + entry.duration,
          durationMs: entry.duration,
          visibility: null,
          hasFocus: null,
        });
      }
    });
    gcObserver.observe({ entryTypes: ['gc'] });
    diagnosticPerformanceObservers.push(gcObserver);
  }

  const recordVisibilityChange = (): void => {
    appendDiagnosticRuntimeEvent({
      kind: 'visibility',
      tsMs: performance.now(),
      durationMs: 0,
      visibility: document.visibilityState,
      hasFocus: null,
    });
  };
  const recordFocusChange = (hasFocus: boolean): void => {
    appendDiagnosticRuntimeEvent({
      kind: 'focus',
      tsMs: performance.now(),
      durationMs: 0,
      visibility: null,
      hasFocus,
    });
  };
  document.addEventListener('visibilitychange', recordVisibilityChange);
  window.addEventListener('focus', () => recordFocusChange(true));
  window.addEventListener('blur', () => recordFocusChange(false));
  recordVisibilityChange();
  recordFocusChange(document.hasFocus());
}

function getAppTitle(): string {
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const branch = import.meta.env.DEV && isLocalHost ? import.meta.env.VITE_GIT_BRANCH?.trim() : '';
  return branch ? `AiBoids - ${branch}` : 'AiBoids';
}

/**
 * Applies the current language to the handful of static (non-ControlPanel)
 * DOM strings that live directly in index.html. Called once at startup
 * and again on every language change (see onLanguageChange below) — the
 * ControlPanel handles its own re-render for everything inside it.
 */
function applyStaticTranslations(): void {
  document.title = t('documentTitle');
  appTitle.textContent = getAppTitle();
  appSubtitle.textContent = t('subtitle');
  controlPanelHeading.textContent = t('controlsHeading');
  controlPanelToggle.title = t('togglePanelTitle');
  controlPanelToggle.setAttribute('aria-label', t('togglePanelTitle'));
}

applyStaticTranslations();
onLanguageChange(applyStaticTranslations);
setupRuntimeDiagnosticsObservers();

const sim = new Simulation(canvas2D.clientWidth || 800, canvas2D.clientHeight || 600);

let renderer2D: Renderer | null = null;
let renderer3D: Renderer3D | null = null;

/**
 * Model Gallery: isolates a single creature (zeroing every other
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
 */
const GALLERY_PREDATOR_KINDS = new Set<GalleryCreature>(['unicorn', 'dragon', 'hawk']);
const GALLERY_BOID_SPECIES = new Set<GalleryCreature>(['sparrow', 'parrot', 'goldfinch', 'cardinal', 'bluejay']);

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

/**
 * "Copy deep link" full-state restore: captures every tunable SimParams
 * field plus the exact 3D camera position/orbit target into a single
 * `?state=` URL query param (see buildDeepLinkURL below, wired to a
 * button in ControlPanel). Unlike the `?galleryCreature=` shortcut above
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

const stateFromURL = readStateFromURL();
if (stateFromURL) Object.assign(params, stateFromURL.params);
// Applied once, on the first frame after the initial render() call sets
// up the scene (see the loop below) — applying any earlier would be
// clobbered by ensureScene's own one-time auto-framing.
let pendingCameraState = stateFromURL?.camera ?? null;

// The simpler `?galleryCreature=` shortcut is only consulted when a full
// `?state=` deep link isn't present, since the latter already carries
// params.galleryCreature (if any) as part of its full snapshot.
const galleryFromURL = stateFromURL ? null : readGalleryCreatureFromURL();
// Only URL-driven entry auto-collapses the panel (clean shot for
// automation) — the interactive dropdown leaves the panel exactly as
// the user had it, since they need it open to use the dropdown itself.
const galleryLaunchedFromURL = galleryFromURL !== null || (stateFromURL?.params.galleryCreature ?? null) !== null;
// null means "no explicit override" — poseGalleryEntityIfReady computes
// a tight, per-creature distance in that case (see galleryDistanceOverride
// usage below and Renderer3D.getGalleryFramingDistance).
let galleryDistanceOverride = galleryFromURL?.distance ?? null;
if (galleryFromURL) params.galleryCreature = galleryFromURL.kind;

let previousGalleryCreature: GalleryCreature | null = null;
// Tracks the visual style last posed/framed for, while the gallery is
// active — lets the loop below detect a mid-gallery style switch (e.g.
// via the "Visual style" dropdown, which stays fully usable while
// isolating a creature) and re-pose/re-frame for the new style, since
// the tank/ground environments differ enough in scale and layout that
// the old camera framing would otherwise leave the creature off-center
// or absurdly tiny in a corner of the new environment.
let previousGalleryVisualStyle: SimParams['visualStyle'] | null = null;
// Tracks the last mode seen so gallery pose state can be invalidated when
// switching away from 3D and back again. Without this, the gallery's
// one-shot pose would stay marked "done" across a 2D detour, so returning
// to 3D would not re-frame the isolated creature.
let previousMode: SimMode = params.mode;
let galleryPosed = false;
let gallerySnapshot: Pick<
  SimParams,
  | 'mode'
  | 'visualStyle'
  | 'boidCount'
  | 'parrotCount'
  | 'goldfinchCount'
  | 'cardinalCount'
  | 'bluejayCount'
  | 'predatorCount'
  | 'unicornCount'
  | 'dragonPredators'
  | 'running'
> | null = null;

function enterGallery(kind: GalleryCreature): void {
  gallerySnapshot = {
    mode: params.mode,
    // Snapshotted (and restored on exit) same as the other fields below,
    // but deliberately *not* reset to a fixed style here — the gallery
    // keeps whatever visual style was already active, and the "Visual
    // style" dropdown stays fully usable while the gallery is open (see
    // the previousGalleryVisualStyle check in the main loop) so a model
    // can be inspected/compared across nature, fishtank, and arcade
    // without ever leaving gallery mode.
    visualStyle: params.visualStyle,
    boidCount: params.boidCount,
    parrotCount: params.parrotCount,
    goldfinchCount: params.goldfinchCount,
    cardinalCount: params.cardinalCount,
    bluejayCount: params.bluejayCount,
    predatorCount: params.predatorCount,
    unicornCount: params.unicornCount,
    dragonPredators: params.dragonPredators,
    running: params.running,
  };

  params.mode = '3d';
  params.boidCount = 0;
  params.parrotCount = 0;
  params.goldfinchCount = 0;
  params.cardinalCount = 0;
  params.bluejayCount = 0;
  params.predatorCount = 0;
  params.unicornCount = 0;
  params.dragonPredators = false;

  if (kind === 'unicorn') params.unicornCount = 1;
  else if (kind === 'dragon') {
    params.predatorCount = 1;
    params.dragonPredators = true;
  } else if (kind === 'hawk') params.predatorCount = 1;
  else if (kind === 'sparrow') params.boidCount = 1;
  else if (kind === 'parrot') params.parrotCount = 1;
  else if (kind === 'goldfinch') params.goldfinchCount = 1;
  else if (kind === 'cardinal') params.cardinalCount = 1;
  else if (kind === 'bluejay') params.bluejayCount = 1;

  galleryPosed = false;
  previousGalleryVisualStyle = null;
  applyMode(params.mode);
  controlPanel.refresh();
}

function exitGallery(): void {
  if (gallerySnapshot) Object.assign(params, gallerySnapshot);
  gallerySnapshot = null;
  galleryPosed = false;
  previousGalleryVisualStyle = null;
  applyMode(params.mode);
  renderer3D?.resetCameraFraming(sim);
  controlPanel.refresh();
}

/**
 * Runs once per gallery visit (and again whenever the visual style is
 * switched while the gallery is active — see the previousGalleryVisualStyle
 * check in the main loop, which clears galleryPosed to force a re-run),
 * as soon as the isolated creature has actually spawned (syncPopulation
 * runs synchronously inside sim.update, so this is typically ready by
 * the very first frame after entering). Poses it at world center with a
 * fixed, camera-friendly velocity (facing right/slightly up, for a 3/4
 * climbing-flight look), then freezes the whole sim (params.running =
 * false) so the pose and camera framing hold steady. Wing/tail flap
 * animation still plays (it's driven by elapsed time, not sim.update),
 * so the creature doesn't look like a static prop. The camera stays
 * fully orbit/zoom-able afterward via OrbitControls.
 */
function poseGalleryEntityIfReady(): void {
  if (!params.galleryCreature || galleryPosed || !renderer3D || params.mode !== '3d') return;
  const kind = params.galleryCreature;
  const entity = GALLERY_PREDATOR_KINDS.has(kind) ? sim.predators[0] : sim.boids[0];
  if (!entity) return;

  const center = { x: sim.width / 2, y: sim.height / 2, z: params.worldDepth / 2 };
  entity.position.x = center.x;
  entity.position.y = center.y;
  entity.position.z = center.z;

  const speed = GALLERY_PREDATOR_KINDS.has(kind) ? params.predatorMaxSpeed : params.boidMaxSpeed;
  entity.velocity.x = speed * 0.9;
  entity.velocity.y = speed * 0.12;
  entity.velocity.z = speed * 0.35;

  params.running = false;
  galleryPosed = true;
  previousGalleryVisualStyle = params.visualStyle;

  // Unlike normal (non-gallery) fishtank browsing — which frames the
  // camera outside the tank looking in — the gallery keeps the same
  // close, creature-relative distance across all styles so the model
  // stays large and inspectable regardless of the (much bigger) tank/
  // world scale. This puts the camera inside the tank/water volume for
  // fishtank style; Renderer3D.setRoomVisible(false) (see ensureScene)
  // hides the surrounding room while gallery is active so the
  // transparent glass/water doesn't show the room incongruously right
  // behind the creature.
  //
  // Distance is per-creature (tightest zoom that fits its actual
  // rendered size) unless the URL explicitly overrode it — see
  // getGalleryFramingDistance for why a single flat distance doesn't
  // work across wildly different creature sizes. Dragons render through
  // the 'hawk' predator instance slot (see Predator.kind/dragonPredators),
  // so they key off 'hawk' here too.
  const instanceKind = kind === 'dragon' ? 'hawk' : kind;
  const distance = galleryDistanceOverride ?? renderer3D.getGalleryFramingDistance(instanceKind);
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
function applyPendingCameraStateIfReady(): void {
  if (!pendingCameraState || !renderer3D || params.mode !== '3d') return;
  renderer3D.setCameraState(pendingCameraState.position, pendingCameraState.target);
  pendingCameraState = null;
}

function recordFrameDuration(frameMs: number): void {
  const clamped = Math.max(0, frameMs);
  if (frameDurationsCount < FRAME_STATS_WINDOW) {
    frameDurationsMs[frameDurationsCount++] = clamped;
    frameDurationsSum += clamped;
    return;
  }
  const old = frameDurationsMs[frameDurationsCursor];
  frameDurationsSum += clamped - old;
  frameDurationsMs[frameDurationsCursor] = clamped;
  frameDurationsCursor = (frameDurationsCursor + 1) % FRAME_STATS_WINDOW;
}

function resetFrameStats(now: number): void {
  frameDurationsCount = 0;
  frameDurationsCursor = 0;
  frameDurationsSum = 0;
  simDurationsSum = 0;
  uiDurationsSum = 0;
  renderDurationsSum = 0;
  postDurationsSum = 0;
  unaccountedDurationsSum = 0;
  statsCaptureStartedAt = now;
}

function appendDiagnosticRecord(record: DiagnosticRecord): void {
  if (diagnosticCount < DIAGNOSTIC_LOG_MAX_ENTRIES) {
    diagnosticRecords[diagnosticCount++] = record;
    return;
  }
  diagnosticRecords[diagnosticCursor] = record;
  diagnosticCursor = (diagnosticCursor + 1) % DIAGNOSTIC_LOG_MAX_ENTRIES;
}

function getDiagnosticRecordsOrdered(): DiagnosticRecord[] {
  if (diagnosticCount === 0) return [];
  if (diagnosticCount < DIAGNOSTIC_LOG_MAX_ENTRIES) return diagnosticRecords.slice(0, diagnosticCount);
  const ordered = new Array<DiagnosticRecord>(DIAGNOSTIC_LOG_MAX_ENTRIES);
  for (let i = 0; i < DIAGNOSTIC_LOG_MAX_ENTRIES; i++) {
    ordered[i] = diagnosticRecords[(diagnosticCursor + i) % DIAGNOSTIC_LOG_MAX_ENTRIES];
  }
  return ordered;
}

function clearDiagnosticRecords(): number {
  const cleared = diagnosticCount + diagnosticRuntimeEventCount;
  diagnosticCount = 0;
  diagnosticCursor = 0;
  diagnosticRuntimeEventCount = 0;
  diagnosticRuntimeEventCursor = 0;
  diagnosticsLongTaskObservedCount = 0;
  diagnosticsGcObservedCount = 0;
  return cleared;
}

function downloadDiagnostics(): 'downloaded' | 'no_data' | 'error' {
  const records = getDiagnosticRecordsOrdered();
  if (records.length === 0) return 'no_data';
  try {
    const payload = {
      meta: {
        version: 2,
        exportedAt: new Date().toISOString(),
        maxEntries: DIAGNOSTIC_LOG_MAX_ENTRIES,
        maxRuntimeEntries: DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES,
        sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
        spikeThresholdMs: DIAGNOSTIC_SPIKE_THRESHOLD_MS,
        runtimeWindowMs: DIAGNOSTIC_RUNTIME_WINDOW_MS,
        frameGapElevatedMs: FRAME_GAP_ELEVATED_MS,
        frameGapStalledMs: FRAME_GAP_STALLED_MS,
        supportsLongTaskObserver: diagnosticsLongTaskSupported,
        supportsGcObserver: diagnosticsGcSupported,
        observedLongTaskCount: diagnosticsLongTaskObservedCount,
        observedGcCount: diagnosticsGcObservedCount,
      },
      records,
      runtimeEvents: getDiagnosticRuntimeEventsOrdered(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aiboids-diagnostics-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return 'downloaded';
  } catch {
    return 'error';
  }
}

function recordPhaseDuration(kind: 'sim' | 'ui' | 'render' | 'post', valueMs: number): void {
  if (frameDurationsCount === 0) return;
  const idx = frameDurationsCount < FRAME_STATS_WINDOW ? frameDurationsCount - 1 : (frameDurationsCursor + FRAME_STATS_WINDOW - 1) % FRAME_STATS_WINDOW;
  const clamped = Math.max(0, valueMs);
  if (kind === 'sim') {
    const old = simDurationsMs[idx] ?? 0;
    simDurationsMs[idx] = clamped;
    simDurationsSum += clamped - old;
    return;
  }
  if (kind === 'ui') {
    const old = uiDurationsMs[idx] ?? 0;
    uiDurationsMs[idx] = clamped;
    uiDurationsSum += clamped - old;
    return;
  }
  if (kind === 'render') {
    const old = renderDurationsMs[idx] ?? 0;
    renderDurationsMs[idx] = clamped;
    renderDurationsSum += clamped - old;
    return;
  }
  const old = postDurationsMs[idx] ?? 0;
  postDurationsMs[idx] = clamped;
  postDurationsSum += clamped - old;
}

function recordUnaccountedDuration(valueMs: number): void {
  if (frameDurationsCount === 0) return;
  const idx = frameDurationsCount < FRAME_STATS_WINDOW ? frameDurationsCount - 1 : (frameDurationsCursor + FRAME_STATS_WINDOW - 1) % FRAME_STATS_WINDOW;
  const clamped = Math.max(0, valueMs);
  const old = unaccountedDurationsMs[idx] ?? 0;
  unaccountedDurationsMs[idx] = clamped;
  unaccountedDurationsSum += clamped - old;
}

function captureDiagnosticRecord(
  now: number,
  frameMs: number,
  simMs: number,
  uiMs: number,
  renderMs: number,
  postMs: number,
  unaccountedMs: number,
): void {
  if (!params.enableDiagnosticsCapture) return;
  const isSpike = frameMs >= DIAGNOSTIC_SPIKE_THRESHOLD_MS;
  const shouldSample = now - lastDiagnosticSampleAt >= DIAGNOSTIC_SAMPLE_INTERVAL_MS;
  if (!isSpike && !shouldSample) return;
  if (shouldSample) lastDiagnosticSampleAt = now;
  const runtimeWindow = getRuntimeWindowStats(now, DIAGNOSTIC_RUNTIME_WINDOW_MS);
  const heapSnapshot = getHeapSnapshotMb();
  const visibility = document.visibilityState;
  const hasFocus = document.hasFocus();
  const frameGapClass = classifyFrameGap(frameMs);
  appendDiagnosticRecord({
    event: isSpike ? 'spike' : 'sample',
    tsMs: now,
    frameMs,
    frameGapClass,
    simMs,
    uiMs,
    renderMs,
    postMs,
    unaccountedMs,
    recentLongTaskMs: runtimeWindow.longTaskMs,
    recentLongTaskCount: runtimeWindow.longTaskCount,
    recentGcMs: runtimeWindow.gcMs,
    recentGcCount: runtimeWindow.gcCount,
    visibility,
    hasFocus,
    jsHeapUsedMB: heapSnapshot.usedMB,
    jsHeapTotalMB: heapSnapshot.totalMB,
    jsHeapLimitMB: heapSnapshot.limitMB,
    boids: sim.boids.length,
    predators: sim.predators.length,
    ufos: sim.ufos.length,
    mode: params.mode,
    visualStyle: params.mode === '3d' ? params.visualStyle : null,
  });
}

function getFramePercentile(percentile: number): number {
  if (frameDurationsCount === 0) return 0;
  const sorted = frameDurationsMs.slice(0, frameDurationsCount).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index];
}

function getRollingPeakFrameMs(): number {
  let peak = 0;
  for (let i = 0; i < frameDurationsCount; i++) {
    if (frameDurationsMs[i] > peak) peak = frameDurationsMs[i];
  }
  return peak;
}

function getAverage(valuesSum: number): number {
  if (frameDurationsCount === 0) return 0;
  return valuesSum / frameDurationsCount;
}

function getPeak(values: number[]): number {
  let peak = 0;
  for (let i = 0; i < frameDurationsCount; i++) {
    if ((values[i] ?? 0) > peak) peak = values[i];
  }
  return peak;
}

function syncRenderingStatsOverlay(now: number): void {
  if (!params.showRenderingStats) {
    renderingStatsVisibleLastFrame = false;
    renderingStatsOverlay.style.display = 'none';
    return;
  }
  if (!renderingStatsVisibleLastFrame) {
    renderingStatsVisibleLastFrame = true;
    resetFrameStats(now);
  }
  renderingStatsOverlay.style.display = 'block';
  if (now - overlayLastUpdatedAt < OVERLAY_UPDATE_INTERVAL_MS) return;
  overlayLastUpdatedAt = now;
  const warmupRemainingMs = Math.max(0, FRAME_STATS_WARMUP_MS - (now - statsCaptureStartedAt));
  if (warmupRemainingMs > 0) {
    renderingStatsOverlay.textContent = [
      'Rendering stats',
      `mode: ${params.mode}${params.mode === '3d' ? ` (${params.visualStyle})` : ''}`,
      `warming up: ${(warmupRemainingMs / 1000).toFixed(1)}s`,
      `trace active: ${formatTraceElapsed(now)}`,
      `diagnostics: ${params.enableDiagnosticsCapture ? 'on' : 'off'} (frames ${diagnosticCount}/${DIAGNOSTIC_LOG_MAX_ENTRIES}, runtime ${diagnosticRuntimeEventCount}/${DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES})`,
    ].join('\n');
    return;
  }

  const averageFrameMs = frameDurationsCount > 0 ? frameDurationsSum / frameDurationsCount : 0;
  const averageFps = averageFrameMs > 1e-6 ? 1000 / averageFrameMs : 0;
  const p95FrameMs = getFramePercentile(0.95);
  const rollingPeakFrameMs = getRollingPeakFrameMs();
  const simAvgMs = getAverage(simDurationsSum);
  const uiAvgMs = getAverage(uiDurationsSum);
  const renderAvgMs = getAverage(renderDurationsSum);
  const postAvgMs = getAverage(postDurationsSum);
  const unaccountedAvgMs = getAverage(unaccountedDurationsSum);
  const simPeakMs = getPeak(simDurationsMs);
  const uiPeakMs = getPeak(uiDurationsMs);
  const renderPeakMs = getPeak(renderDurationsMs);
  const postPeakMs = getPeak(postDurationsMs);
  const unaccountedPeakMs = getPeak(unaccountedDurationsMs);
  const totalAgents = sim.boids.length + sim.predators.length + sim.ufos.length;
  const runtimeWindow = getRuntimeWindowStats(now, DIAGNOSTIC_RUNTIME_WINDOW_MS);
  const focusState = document.hasFocus() ? 'focused' : 'blurred';

  renderingStatsOverlay.textContent = [
    'Rendering stats',
    `mode: ${params.mode}${params.mode === '3d' ? ` (${params.visualStyle})` : ''}`,
    `frame ms: avg ${averageFrameMs.toFixed(2)} | p95 ${p95FrameMs.toFixed(2)} | peak ${rollingPeakFrameMs.toFixed(2)}`,
    `fps: ${averageFps.toFixed(1)}`,
    `phase avg ms: sim ${simAvgMs.toFixed(2)} | render ${renderAvgMs.toFixed(2)} | ui ${uiAvgMs.toFixed(2)} | post ${postAvgMs.toFixed(2)}`,
    `phase peak ms: sim ${simPeakMs.toFixed(2)} | render ${renderPeakMs.toFixed(2)} | ui ${uiPeakMs.toFixed(2)} | post ${postPeakMs.toFixed(2)}`,
    `unaccounted ms: avg ${unaccountedAvgMs.toFixed(2)} | peak ${unaccountedPeakMs.toFixed(2)}`,
    `runtime (${DIAGNOSTIC_RUNTIME_WINDOW_MS}ms): longtask ${runtimeWindow.longTaskCount}/${runtimeWindow.longTaskMs.toFixed(2)}ms | gc ${runtimeWindow.gcCount}/${runtimeWindow.gcMs.toFixed(2)}ms`,
    `page: ${document.visibilityState} | ${focusState} | gap ${lastFrameGapClass}`,
    `trace active: ${formatTraceElapsed(now)}`,
    `diagnostics: ${params.enableDiagnosticsCapture ? 'on' : 'off'} (frames ${diagnosticCount}/${DIAGNOSTIC_LOG_MAX_ENTRIES}, runtime ${diagnosticRuntimeEventCount}/${DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES})`,
    `entities: boids ${sim.boids.length} | predators ${sim.predators.length} | ufos ${sim.ufos.length} | total ${totalAgents}`,
  ].join('\n');
}

/**
 * Builds the shareable "Copy deep link" URL: every current SimParams
 * field plus (if in 3D mode) the exact live camera position/orbit
 * target, packed into a single `?state=` query param. Read back by
 * readStateFromURL/applyPendingCameraStateIfReady above on page load.
 * Intentionally a one-shot snapshot computed on demand (see the
 * ControlPanel button that calls this) rather than a continuously
 * updated URL — the address bar should stay quiet while the user works.
 */
function buildDeepLinkURL(): string {
  const camera = params.mode === '3d' && renderer3D ? renderer3D.getCameraState() : null;
  const payload: DeepLinkState = { params: { ...params }, camera };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `${window.location.origin}${window.location.pathname}?state=${encoded}`;
}

// Once the user manually toggles the panel, their choice is respected on
// future resizes — only before that do we keep auto-collapsing/expanding
// based on the 40%-of-viewport-width rule below.
let userToggledPanel = false;

// The panel's own natural (expanded) width, read once from CSS rather
// than hardcoded, so this stays correct if the stylesheet width changes.
const EXPANDED_PANEL_WIDTH = 300;

function setPanelCollapsed(collapsed: boolean): void {
  controlPanel_el.classList.toggle('collapsed', collapsed);
  controlPanelToggle.setAttribute('aria-expanded', String(!collapsed));
  resizeCanvases();
}

function isPanelCollapsed(): boolean {
  return controlPanel_el.classList.contains('collapsed');
}

/**
 * Auto-collapses the controls panel when it would cover more than 40% of
 * the viewport's horizontal width (e.g. testing in a half-width browser
 * window) so the 3D scene is still usable without the user needing to
 * find and click the toggle first. Only runs before the user has ever
 * manually toggled the panel, so it never fights a deliberate choice.
 */
function applySmartPanelDefault(): void {
  if (userToggledPanel) return;
  const shouldCollapse = EXPANDED_PANEL_WIDTH / window.innerWidth > 0.4;
  if (shouldCollapse !== isPanelCollapsed()) setPanelCollapsed(shouldCollapse);
}

controlPanelToggle.addEventListener('click', () => {
  userToggledPanel = true;
  setPanelCollapsed(!isPanelCollapsed());
});

applySmartPanelDefault();

function applyMode(mode: SimMode): void {
  canvas2D.classList.toggle('active', mode === '2d');
  canvas3D.classList.toggle('active', mode === '3d');

  if (mode === '3d') {
    if (!renderer3D) renderer3D = new Renderer3D(canvas3D);
  } else {
    if (!renderer2D) renderer2D = new Renderer(canvas2D);
  }
  resizeCanvases();
}

function resizeCanvases(): void {
  const rect = canvasStack.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  canvas2D.width = width;
  canvas2D.height = height;
  renderer3D?.resize(width, height);

  sim.resize(width, height);
}

const controlPanel = new ControlPanel(
  controlPanelBody,
  sim,
  applyMode,
  buildDeepLinkURL,
  downloadDiagnostics,
  clearDiagnosticRecords,
);
applyMode(params.mode);

if (galleryLaunchedFromURL) {
  // Collapsing the panel gives a clean, unobstructed shot and a wider
  // canvas for the debugFrameCamera framing — done after applyMode so
  // resizeCanvases (called by setPanelCollapsed) sees the final,
  // gallery-mode canvas. userToggledPanel = true so the width-based
  // auto-collapse/expand logic below never fights this deliberate
  // choice. Only applies to the URL-driven entry point — the
  // interactive dropdown leaves the panel exactly as the user had it.
  userToggledPanel = true;
  setPanelCollapsed(true);
}

window.addEventListener('resize', () => {
  applySmartPanelDefault();
  resizeCanvases();
});

let lastTime = performance.now();

function loop(now: number): void {
  const rawFrameMs = Math.max(0, now - lastTime);
  lastFrameGapClass = classifyFrameGap(rawFrameMs);
  const dt = Math.min(rawFrameMs / 1000, 1 / 20); // clamp dt to avoid big jumps on tab-away
  lastTime = now;
  if (params.enableDiagnosticsCapture !== diagnosticsCaptureEnabledLastFrame) {
    diagnosticsCaptureEnabledLastFrame = params.enableDiagnosticsCapture;
    if (params.enableDiagnosticsCapture) {
      diagnosticsCaptureStartedAt = now;
      lastDiagnosticSampleAt = now - DIAGNOSTIC_SAMPLE_INTERVAL_MS;
      appendDiagnosticRuntimeEvent({
        kind: 'visibility',
        tsMs: now,
        durationMs: 0,
        visibility: document.visibilityState,
        hasFocus: null,
      });
      appendDiagnosticRuntimeEvent({
        kind: 'focus',
        tsMs: now,
        durationMs: 0,
        visibility: null,
        hasFocus: document.hasFocus(),
      });
    } else {
      diagnosticsCaptureStartedAt = null;
    }
  }
  if (params.showRenderingStats && now - statsCaptureStartedAt >= FRAME_STATS_WARMUP_MS) {
    recordFrameDuration(rawFrameMs);
  }

  // Detect Model Gallery selection changes (from the control panel
  // dropdown or the initial `?galleryCreature=` URL param) and
  // snapshot/isolate or restore population params accordingly. Polled
  // here rather than via a params change-event system (none exists for
  // most of SimParams) since this is the one place already running
  // every frame.
  if (params.mode !== previousMode) {
    // Gallery framing is 3D-specific, so any mode flip should clear the
    // one-shot pose flag and let the creature be re-framed when 3D comes
    // back.
    if (params.galleryCreature) {
      galleryPosed = false;
      previousGalleryVisualStyle = null;
    }
    previousMode = params.mode;
  }

  if (params.galleryCreature !== previousGalleryCreature) {
    if (params.galleryCreature) enterGallery(params.galleryCreature);
    else exitGallery();
    previousGalleryCreature = params.galleryCreature;
  }

  // Detect a visual style switch made *while* the gallery is active (the
  // "Visual style" dropdown stays fully interactive during gallery mode
  // — see ControlPanel's render()) and force a re-pose/re-frame for it.
  // Without this, switching styles mid-gallery leaves the camera at its
  // old framing while the environment underneath changes shape/scale
  // (e.g. nature's open ground vs. fishtank's room-and-tank), so the
  // creature can end up tiny and off-center in a corner instead of
  // nicely centered for the newly-selected style.
  if (params.galleryCreature && params.visualStyle !== previousGalleryVisualStyle) {
    galleryPosed = false;
  }

  const simStart = performance.now();
  sim.update(dt);
  const simEnd = performance.now();
  controlPanel.syncAlienInvasionButton();
  controlPanel.syncRespawnButton();
  const uiEnd = performance.now();

  if (params.mode === '3d') {
    renderer3D?.render(sim);
  } else {
    renderer2D?.render(sim);
  }
  const renderEnd = performance.now();

  // Posed/camera-framed *after* this frame's render() call — render()'s
  // internal ensureScene does a one-time initial camera auto-frame the
  // very first time it runs (guarded by a world-size key, not by frame
  // count), which would otherwise clobber debugFrameCamera's framing if
  // this ran first on the same frame render() first initializes things.
  poseGalleryEntityIfReady();

  // Runs *after* poseGalleryEntityIfReady so a restored `?state=` deep
  // link's exact camera wins over the Model Gallery's own auto-framing
  // when both apply on the same load (e.g. a deep link captured while
  // the gallery was isolating a creature) — both are one-shot (each
  // clears its own "already applied" flag), so this ordering only
  // matters on the very first frame.
  applyPendingCameraStateIfReady();
  const postEnd = performance.now();
  const simMs = simEnd - simStart;
  const uiMs = uiEnd - simEnd;
  const renderMs = renderEnd - uiEnd;
  const postMs = postEnd - renderEnd;
  const measuredMs = simMs + uiMs + renderMs + postMs;
  const unaccountedMs = Math.max(0, rawFrameMs - measuredMs);

  captureDiagnosticRecord(now, rawFrameMs, simMs, uiMs, renderMs, postMs, unaccountedMs);

  if (params.showRenderingStats && now - statsCaptureStartedAt >= FRAME_STATS_WARMUP_MS) {
    recordPhaseDuration('sim', simMs);
    recordPhaseDuration('ui', uiMs);
    recordPhaseDuration('render', renderMs);
    recordPhaseDuration('post', postMs);
    recordUnaccountedDuration(unaccountedMs);
  }
  syncRenderingStatsOverlay(now);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

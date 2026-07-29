import './style.css';
import { Simulation } from './sim/Simulation';
import { Renderer } from './render/Renderer';
import { Renderer3D } from './render/Renderer3D';
import { ControlPanel } from './ui/ControlPanel';
import { Diagnostics } from './diagnostics/Diagnostics';
import { readDebugOverlayOverride } from './diagnostics/debugOverlayFlag';
import { CreatureGalleryController } from './gallery/CreatureGalleryController';
import { FollowCamController } from './render/FollowCamController';
import { getPredatorCatchProfilesForStyle } from './render/sceneRenderers/predatorCatchProfiles';
import { params, mobileCreatureCounts, installDefaultOverrides, type SimMode } from './sim/params';
import { isMobileDevice } from './render/graphicsQuality';
import { onLanguageChange, getLanguage, setLanguage, SUPPORTED_LANGUAGES, type Language } from './i18n/language';
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
const appHeader = document.querySelector<HTMLElement>('#app-header')!;

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

/**
 * Builds the compact language selector in the app header and keeps it
 * in sync when the language changes. The <select id="param-language"> id
 * is stable so the e2e suite can target it reliably.
 */
function setupHeaderLanguageSelector(): void {
  const wrapper = document.createElement('div');
  wrapper.id = 'header-lang-wrapper';

  const select = document.createElement('select');
  select.id = 'param-language';
  const currentLanguage = getLanguage();
  for (const { value, nativeName } of SUPPORTED_LANGUAGES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = nativeName;
    if (value === currentLanguage) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    setLanguage(select.value as Language);
  });

  wrapper.appendChild(select);
  appHeader.appendChild(wrapper);

  // Keep the selected option in sync if language changes via another path.
  onLanguageChange(() => {
    select.value = getLanguage();
  });
}

setupHeaderLanguageSelector();

// Phone/tablet-class devices start with a smaller flock (see
// mobileCreatureCounts). Installed as overrides rather than assigned directly
// so the control panel's Reset button restores these too. Applied before
// CreatureGalleryController is constructed below, because that reads any
// `?state=` deep link and its explicit counts must win over these defaults.
if (isMobileDevice()) installDefaultOverrides(mobileCreatureCounts);

// Applied before the control panel is built, so the Diagnostics checkbox
// renders already ticked and stays the source of truth from then on.
// Targets showRenderingStats (the "Rendering stats" panel), NOT
// showDebugOverlay — that is the separate 2D-renderer debug drawing.
const debugOverlayOverride = readDebugOverlayOverride();
if (debugOverlayOverride !== null) params.showRenderingStats = debugOverlayOverride;

const sim = new Simulation(canvas2D.clientWidth || 800, canvas2D.clientHeight || 600);
sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle(params.visualStyle));
const diagnostics = new Diagnostics(sim, canvasStack);

let renderer2D: Renderer | null = null;
let renderer3D: Renderer3D | null = null;

// Last box resizeCanvases() actually applied, used to skip redundant work.
// Declared here rather than beside resizeCanvases because applySmartPanelDefault()
// runs (and resizes) well before that point in module evaluation.
let lastCanvasWidth = -1;
let lastCanvasHeight = -1;

// Creature View follow-cam controller — manages click-to-select, per-frame
// orbit-lock damping, and the creature inspector HUD overlay. Constructed
// here so the HUD element is appended to canvasStack early (before applyMode
// creates renderer3D). The click listener is registered below, after canvas3D
// is known.
const followCamController = new FollowCamController(canvasStack);

// Creature Gallery + "Copy deep link" subsystem (see gallery/CreatureGalleryController).
// Constructed here — before ControlPanel and the initial applyMode below —
// so its constructor can apply any `?state=` deep-link params (and the
// `?galleryCreature=` shortcut) up front, letting the panel render the
// restored state. renderer3D is passed as a getter because applyMode
// creates/reassigns it lazily; controlPanel.refresh is wrapped in a
// closure since controlPanel is constructed further below.
const creatureGallery = new CreatureGalleryController({
  sim,
  getRenderer3D: () => renderer3D,
  applyMode,
  refreshControlPanel: () => controlPanel.refresh(),
});

// Once the user manually toggles the panel, their choice is respected on
// future resizes — only before that do we keep auto-collapsing/expanding
// based on the narrow-layout rule below.
let userToggledPanel = false;

/**
 * The viewport width at or below which the layout is considered "narrow".
 *
 * This must stay identical to the `max-width` of the narrow-layout block at
 * the bottom of style.css, which floats the panel over the scene instead of
 * giving it a share of the flex row. When the two disagreed (JS collapsed
 * below 750px, CSS overlaid below 700px) viewports in the 701–749px band got
 * an auto-collapsing panel that still stole canvas width — the same defect
 * class as issue #304, just in a narrower band.
 *
 * 750px is where the panel's natural 300px width reaches 40% of the viewport,
 * which is the proportion the previous arithmetic rule used.
 */
const NARROW_LAYOUT_MEDIA_QUERY = '(max-width: 750px)';

function setPanelCollapsed(collapsed: boolean): void {
  controlPanel_el.classList.toggle('collapsed', collapsed);
  controlPanelToggle.setAttribute('aria-expanded', String(!collapsed));
  resizeCanvases();
}

function isPanelCollapsed(): boolean {
  return controlPanel_el.classList.contains('collapsed');
}

/**
 * Auto-collapses the controls panel on narrow layouts (a phone, or a
 * half-width desktop window) so the 3D scene is usable without the user
 * needing to find and click the toggle first. Only runs before the user has
 * ever manually toggled the panel, so it never fights a deliberate choice.
 *
 * Uses the same media query as the stylesheet's narrow-layout block so the
 * two can never drift apart — see NARROW_LAYOUT_MEDIA_QUERY.
 */
function applySmartPanelDefault(): void {
  if (userToggledPanel) return;
  const shouldCollapse = window.matchMedia(NARROW_LAYOUT_MEDIA_QUERY).matches;
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
  resizeCanvases(true);
}

function resizeCanvases(force = false): void {
  const rect = canvasStack.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  // The observer below fires on every animation frame of the panel's 0.15s
  // width transition. Reallocating the composer's render targets that often
  // is a visible hitch on mobile GPUs, so ignore repeats of a size we have
  // already applied. `force` exists for callers that changed something other
  // than the box — notably applyMode, which may have just constructed a
  // renderer that has never been sized at all.
  if (!force && width === lastCanvasWidth && height === lastCanvasHeight) return;
  lastCanvasWidth = width;
  lastCanvasHeight = height;

  canvas2D.width = width;
  canvas2D.height = height;
  renderer3D?.resize(width, height);

  sim.resize(width, height);
}

/**
 * The canvas stack's size is not knowable synchronously at every point we'd
 * like to react to it. The controls panel animates its width over 0.15s
 * (see style.css), so measuring immediately after toggling `.collapsed`
 * reads the *pre*-transition layout. On a narrow viewport that is not a
 * cosmetic error: the panel occupies 300 of an iPhone's 390 CSS px, so the
 * canvas measured 90px wide while it ended up 330px. Both the WebGL drawing
 * buffer (stretched horizontally across the real canvas) and the simulation's
 * world bounds (a 90-unit-wide vertical slab the flock could not leave) were
 * sized from that stale number — issue #304.
 *
 * A ResizeObserver reports the settled box whenever it actually changes, so
 * it covers the panel transition, window resizes, orientation changes, and
 * iOS Safari's dynamic URL bar collapsing on scroll — none of which reliably
 * produce a correctly-timed `resize` event.
 */
const canvasStackResizeObserver = new ResizeObserver(() => resizeCanvases());
canvasStackResizeObserver.observe(canvasStack);

const controlPanel = new ControlPanel(
  controlPanelBody,
  sim,
  applyMode,
  () => creatureGallery.buildDeepLinkURL(),
  () => diagnostics.downloadDiagnostics(),
  () => diagnostics.clearRecords(),
  () => renderer3D?.getCreatureLabels() ?? null,
);
applyMode(params.mode);
// Refresh the panel now that renderer3D may have been created by applyMode,
// so scene-specific creature labels are available on first render.
if (renderer3D) controlPanel.refresh();

if (creatureGallery.launchedFromURL) {
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

// Creature View: pointer-aware selection on the 3D canvas.
// pointerdown records the start position; pointerup selects only when the
// pointer has not moved beyond the drag threshold (stationary click).
// Drags used to orbit/pan the camera are silently ignored.
// (Only active when followCamMode === 'orbit'; inert otherwise.)
canvas3D.addEventListener('pointerdown', (e) => {
  followCamController.handlePointerDown(e);
});
canvas3D.addEventListener('pointerup', (e) => {
  if (renderer3D) {
    followCamController.handlePointerUp(e, canvas3D, sim, renderer3D);
  }
});
// Defensive cleanup: cancel or leave events abort any in-flight pointer-down
// so an OrbitControls-captured gesture cannot be misread as a stationary click.
canvas3D.addEventListener('pointercancel', () => {
  followCamController.handlePointerCancel();
});
canvas3D.addEventListener('pointerleave', () => {
  followCamController.handlePointerCancel();
});

// Escape key exits POV mode (if active) without clearing the selection,
// returning the user to orbit-lock on the same creature.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && renderer3D) {
    followCamController.handleEscKey(renderer3D, sim);
  }
});

let lastTime = performance.now();
let lastPredatorCatchStyle = params.visualStyle;

function syncPredatorCatchProfiles(): void {
  if (lastPredatorCatchStyle === params.visualStyle) return;
  sim.setPredatorCatchProfiles(getPredatorCatchProfilesForStyle(params.visualStyle));
  lastPredatorCatchStyle = params.visualStyle;
}

function loop(now: number): void {
  const rawFrameMs = Math.max(0, now - lastTime);
  const dt = Math.min(rawFrameMs / 1000, 1 / 20); // clamp dt to avoid big jumps on tab-away
  lastTime = now;
  diagnostics.beginFrame(now, rawFrameMs);

  // Detect Creature Gallery selection/mode/style changes and snapshot,
  // isolate, or restore population params accordingly (see
  // gallery/CreatureGalleryController). Runs before sim.update so the isolated
  // population is in place for this frame.
  creatureGallery.applySelectionChanges();
  syncPredatorCatchProfiles();

  const simStart = performance.now();
  sim.update(dt);
  const simEnd = performance.now();
  controlPanel.syncAlienInvasionButton();
  controlPanel.syncRespawnButton();
  const uiEnd = performance.now();

  if (params.mode === '3d') {
    if (renderer3D) {
      // Creature View orbit-lock: smooth the orbit target before render so
      // OrbitControls.update() inside renderOutput() picks up the new target.
      followCamController.update(dt, sim, renderer3D);
      renderer3D.render(sim);
    }
  } else {
    renderer2D?.render(sim);
  }
  const renderEnd = performance.now();

  // Pose the isolated gallery creature and apply any pending `?state=`
  // deep-link camera — must run *after* this frame's render() call so
  // render()'s one-time initial auto-frame doesn't clobber the gallery/
  // deep-link framing (see CreatureGalleryController.poseAndRestoreCameraIfReady).
  creatureGallery.poseAndRestoreCameraIfReady();
  const postEnd = performance.now();
  const simMs = simEnd - simStart;
  const uiMs = uiEnd - simEnd;
  const renderMs = renderEnd - uiEnd;
  const postMs = postEnd - renderEnd;
  const measuredMs = simMs + uiMs + renderMs + postMs;
  const unaccountedMs = Math.max(0, rawFrameMs - measuredMs);

  diagnostics.captureRecord(now, rawFrameMs, simMs, uiMs, renderMs, postMs, unaccountedMs);
  diagnostics.recordPhases(now, simMs, uiMs, renderMs, postMs, unaccountedMs);
  diagnostics.syncOverlay(now);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

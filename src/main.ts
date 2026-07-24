import './style.css';
import { Simulation } from './sim/Simulation';
import { Renderer } from './render/Renderer';
import { Renderer3D } from './render/Renderer3D';
import { ControlPanel } from './ui/ControlPanel';
import { Diagnostics } from './diagnostics/Diagnostics';
import { GalleryController } from './gallery/GalleryController';
import { params, type SimMode } from './sim/params';
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

const sim = new Simulation(canvas2D.clientWidth || 800, canvas2D.clientHeight || 600);
const diagnostics = new Diagnostics(sim, canvasStack);

let renderer2D: Renderer | null = null;
let renderer3D: Renderer3D | null = null;

// Model Gallery + "Copy deep link" subsystem (see gallery/GalleryController).
// Constructed here — before ControlPanel and the initial applyMode below —
// so its constructor can apply any `?state=` deep-link params (and the
// `?galleryCreature=` shortcut) up front, letting the panel render the
// restored state. renderer3D is passed as a getter because applyMode
// creates/reassigns it lazily; controlPanel.refresh is wrapped in a
// closure since controlPanel is constructed further below.
const gallery = new GalleryController({
  sim,
  getRenderer3D: () => renderer3D,
  applyMode,
  refreshControlPanel: () => controlPanel.refresh(),
});

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
  () => gallery.buildDeepLinkURL(),
  () => diagnostics.downloadDiagnostics(),
  () => diagnostics.clearRecords(),
  () => renderer3D?.getCreatureLabels() ?? null,
);
applyMode(params.mode);
// Refresh the panel now that renderer3D may have been created by applyMode,
// so scene-specific creature labels are available on first render.
if (renderer3D) controlPanel.refresh();

if (gallery.launchedFromURL) {
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
  const dt = Math.min(rawFrameMs / 1000, 1 / 20); // clamp dt to avoid big jumps on tab-away
  lastTime = now;
  diagnostics.beginFrame(now, rawFrameMs);

  // Detect Model Gallery selection/mode/style changes and snapshot,
  // isolate, or restore population params accordingly (see
  // gallery/GalleryController). Runs before sim.update so the isolated
  // population is in place for this frame.
  gallery.applySelectionChanges();

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

  // Pose the isolated gallery creature and apply any pending `?state=`
  // deep-link camera — must run *after* this frame's render() call so
  // render()'s one-time initial auto-frame doesn't clobber the gallery/
  // deep-link framing (see GalleryController.poseAndRestoreCameraIfReady).
  gallery.poseAndRestoreCameraIfReady();
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

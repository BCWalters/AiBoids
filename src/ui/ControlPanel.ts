import { params, resetParams, type SimMode } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import { onLanguageChange } from '../i18n/language';
import { t, type TranslationKey } from '../i18n/translations';
import type { CreatureLabels } from '../render/sceneRenderers/createSceneRendererHooks';
import type { BooleanParamKey, SliderSpec, SectionContext } from './sections/sectionContext';
import { buildModeToggle, buildVisualStyleToggle } from './sections/simulationSection';
import { buildCreatureGallerySection } from './sections/creatureGallerySection';
import { buildPopulationSection } from './sections/populationSection';
import { buildVisualSection } from './sections/visualSection';
import { buildCameraSection } from './sections/cameraSection';
import { buildBehaviorSection } from './sections/behaviorSection';
import { buildWorldBoundariesSection } from './sections/worldBoundariesSection';
import { buildDiagnosticsSection } from './sections/diagnosticsSection';

export class ControlPanel {
  private container: HTMLElement;
  private sim: Simulation;
  private onModeChange: (mode: SimMode) => void;
  private getDeepLinkURL: () => string;
  private onDownloadDiagnostics: () => 'downloaded' | 'no_data' | 'error';
  private onClearDiagnostics: () => number;
  private getCreatureLabels: () => CreatureLabels | null;
  private alienButton: HTMLButtonElement | null = null;
  private respawnButton: HTMLButtonElement | null = null;
  private unsubscribeLanguage: () => void;
  private lastAlienButtonState: { activeCount: number; wrongMode: boolean; atCapacity: boolean } | null = null;
  private lastRespawnPendingCount: number | null = null;
  // Tracks each collapsible section's open/closed state across re-renders
  // (keyed by a stable section id, not the translated title — titles
  // change with language). Without this, buildSection's `defaultOpen`
  // was re-applied on every single render() call, so any change that
  // triggers a full re-render (e.g. selecting a Creature Gallery creature,
  // which calls refresh() from main.ts) would snap every section back to
  // its default state, closing sections the user had deliberately opened
  // — most noticeably the Creature Gallery section itself right after
  // picking a creature from its own dropdown.
  private sectionOpenState = new Map<string, boolean>();

  constructor(
    container: HTMLElement,
    sim: Simulation,
    onModeChange: (mode: SimMode) => void,
    getDeepLinkURL: () => string,
    onDownloadDiagnostics: () => 'downloaded' | 'no_data' | 'error',
    onClearDiagnostics: () => number,
    getCreatureLabels: () => CreatureLabels | null = () => null,
  ) {
    this.container = container;
    this.sim = sim;
    this.onModeChange = onModeChange;
    this.getDeepLinkURL = getDeepLinkURL;
    this.onDownloadDiagnostics = onDownloadDiagnostics;
    this.onClearDiagnostics = onClearDiagnostics;
    this.getCreatureLabels = getCreatureLabels;
    // Full re-render on language change — simplest way to refresh every
    // label/title in the panel, consistent with how other setting
    // changes (mode, visual style) already trigger a re-render.
    this.unsubscribeLanguage = onLanguageChange(() => this.render());
    this.render();
  }

  /** Call when the panel is being torn down, to avoid a leaked language-change subscription. */
  dispose(): void {
    this.unsubscribeLanguage();
  }

  /**
   * Public re-render, for callers outside the panel (main.ts) that
   * change params in ways the panel needs to reflect immediately — e.g.
   * entering/exiting the Creature Gallery, which rewrites several
   * population/mode/style params at once outside of any control the
   * panel itself owns.
   */
  refresh(): void {
    this.render();
  }

  private buildContext(): SectionContext {
    return {
      buildSection: (key, title, children, defaultOpen) => this.buildSection(key, title, children, defaultOpen),
      buildSubsection: (title, children) => this.buildSubsection(title, children),
      buildSlider: (spec, disabled, labelOverride) => this.buildSlider(spec, disabled, labelOverride),
      buildBooleanToggle: (labelKey, id, key) => this.buildBooleanToggle(labelKey, id, key),
      flashButtonLabel: (btn, def, flash) => this.flashButtonLabel(btn, def, flash),
      sim: this.sim,
      onModeChange: this.onModeChange,
      getDeepLinkURL: this.getDeepLinkURL,
      onDownloadDiagnostics: this.onDownloadDiagnostics,
      onClearDiagnostics: this.onClearDiagnostics,
      getCreatureLabels: this.getCreatureLabels,
      render: () => this.render(),
      setAlienButton: (btn) => { this.alienButton = btn; },
      setRespawnButton: (btn) => { this.respawnButton = btn; },
    };
  }

  private render(): void {
    this.container.innerHTML = '';
    this.lastAlienButtonState = null;
    this.lastRespawnPendingCount = null;

    const ctx = this.buildContext();

    this.container.appendChild(buildModeToggle(ctx));

    if (params.mode === '3d') {
      this.container.appendChild(buildVisualStyleToggle(ctx));
      this.container.appendChild(buildCreatureGallerySection(ctx));
    }

    this.container.appendChild(buildPopulationSection(ctx));
    this.container.appendChild(buildVisualSection(ctx));

    if (params.mode === '3d') {
      this.container.appendChild(buildCameraSection(ctx));
    }

    this.container.appendChild(buildBehaviorSection(ctx));

    if (params.mode === '3d') {
      this.container.appendChild(buildWorldBoundariesSection(ctx));
    }

    this.container.appendChild(buildDiagnosticsSection(ctx));
    this.container.appendChild(this.buildButtons());
  }

  /**
   * Refreshes the invasion button's disabled/title state to reflect
   * whether the max number of concurrent saucers is already active —
   * called every animation frame from main.ts rather than only on
   * control-panel re-render, so the button greys out immediately when
   * spawned and re-enables the moment one flies off, without needing a
   * full (state-resetting) re-render.
   */
  syncAlienInvasionButton(): void {
    const button = this.alienButton;
    if (!button) return;
    const activeCount = this.sim.ufos.length;
    const wrongMode = params.mode !== '3d';
    const atCapacity = activeCount >= MAX_CONCURRENT_UFOS;
    const prev = this.lastAlienButtonState;
    if (
      prev
      && prev.activeCount === activeCount
      && prev.wrongMode === wrongMode
      && prev.atCapacity === atCapacity
    ) {
      return;
    }
    this.lastAlienButtonState = { activeCount, wrongMode, atCapacity };
    const disabled = wrongMode || atCapacity;
    button.disabled = disabled;
    // Once at least one saucer is active, show the live count right on
    // the button — ongoing confirmation that the click(s) worked, not
    // just a one-off flash, since the saucer itself can take a moment
    // to descend into view.
    button.textContent =
      activeCount > 0 ? t('alienInvasionButtonActive', { count: activeCount, max: MAX_CONCURRENT_UFOS }) : t('alienInvasionButton');
    button.title = wrongMode
      ? t('alienInvasionTitleWrongMode')
      : atCapacity
        ? t('alienInvasionTitleAtCapacity', { max: MAX_CONCURRENT_UFOS })
        : t('alienInvasionTitleReady');
  }

  /**
   * Refreshes the "respawn now" button's label/disabled state every
   * frame (see main.ts) to reflect how many abducted boids are currently
   * waiting out their coop-respawn delay.
   */
  syncRespawnButton(): void {
    const button = this.respawnButton;
    if (!button) return;
    const pendingCount = this.sim.pendingRespawns.length;
    if (this.lastRespawnPendingCount === pendingCount) return;
    this.lastRespawnPendingCount = pendingCount;
    button.disabled = pendingCount === 0;
    button.textContent = pendingCount > 0 ? t('respawnButtonPending', { count: pendingCount }) : t('respawnButtonIdle');
    button.title = pendingCount > 0 ? t('respawnTitlePending') : t('respawnTitleIdle');
  }

  /** A native <details>/<summary> collapsible group — no extra JS state, resets to defaultOpen on full re-render. */
  private buildSection(sectionKey: string, title: string, children: HTMLElement[], defaultOpen: boolean): HTMLElement {
    const details = document.createElement('details');
    details.className = 'control-section';
    details.open = this.sectionOpenState.get(sectionKey) ?? defaultOpen;
    details.addEventListener('toggle', () => this.sectionOpenState.set(sectionKey, details.open));

    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'control-section-body';
    for (const child of children) {
      body.appendChild(child);
    }
    details.appendChild(body);

    return details;
  }

  /**
   * Builds a titled, outlined group used to cluster related controls inside a
   * larger section (e.g. "Lighting & atmosphere" within the Visual section).
   */
  private buildSubsection(title: string, children: HTMLElement[]): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-subsection';

    const heading = document.createElement('div');
    heading.className = 'control-subsection-title';
    heading.textContent = title;
    group.appendChild(heading);

    for (const child of children) {
      group.appendChild(child);
    }
    return group;
  }

  private buildSlider(spec: SliderSpec, disabled: boolean = false, labelOverride?: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';
    if (disabled) wrapper.classList.add('control-row-disabled');

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';

    const label = document.createElement('label');
    label.textContent = labelOverride ?? t(spec.labelKey);
    label.htmlFor = `param-${spec.key}`;

    const valueOut = document.createElement('span');
    valueOut.className = 'control-value';
    valueOut.textContent = String(params[spec.key]);

    labelRow.appendChild(label);
    labelRow.appendChild(valueOut);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `param-${spec.key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(params[spec.key]);
    input.disabled = disabled;

    input.addEventListener('input', () => {
      const value = Number(input.value);
      (params[spec.key] as number) = value;
      valueOut.textContent = String(value);
    });

    wrapper.appendChild(labelRow);
    wrapper.appendChild(input);
    return wrapper;
  }

  /**
   * Generic boolean checkbox toggle bound to a boolean-valued SimParams key.
   * Reduces duplication for the growing set of on/off visual feature flags.
   */
  private buildBooleanToggle(labelKey: TranslationKey, id: string, key: BooleanParamKey): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t(labelKey);
    label.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = params[key];
    input.addEventListener('change', () => {
      params[key] = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildButtons(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-buttons';

    const playPause = document.createElement('button');
    playPause.textContent = params.running ? t('pauseButton') : t('playButton');
    playPause.addEventListener('click', () => {
      params.running = !params.running;
      playPause.textContent = params.running ? t('pauseButton') : t('playButton');
    });

    const reset = document.createElement('button');
    reset.textContent = t('resetButton');
    reset.addEventListener('click', () => {
      this.sim.reset();
    });

    const restoreDefaults = document.createElement('button');
    restoreDefaults.textContent = t('restoreDefaultsButton');
    restoreDefaults.addEventListener('click', () => {
      resetParams();
      this.render();
    });

    wrapper.appendChild(playPause);
    wrapper.appendChild(reset);
    wrapper.appendChild(restoreDefaults);
    wrapper.appendChild(this.buildDeepLinkButton());
    return wrapper;
  }

  /**
   * "Copy deep link" button: captures the exact current settings + (in
   * 3D) camera position/orbit target into a URL (see main.ts's
   * buildDeepLinkURL) and copies it to the clipboard. A one-shot,
   * explicit action rather than a continuously-synced URL, per explicit
   * request — the address bar shouldn't rewrite itself on every slider
   * drag. Intended for sharing a precise repro/debugging setup (this is
   * a generalization of the `?galleryCreature=` URL shortcut used
   * earlier to zoom in on individual creature models).
   */
  private buildDeepLinkButton(): HTMLButtonElement {
    const button = document.createElement('button');
    const defaultLabel = t('deepLinkButton');
    button.textContent = defaultLabel;
    button.title = t('deepLinkButtonTitle');

    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const flash = (label: string) => {
      button.textContent = label;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        button.textContent = defaultLabel;
      }, 2000);
    };

    button.addEventListener('click', () => {
      const url = this.getDeepLinkURL();
      this.copyToClipboard(url).then(
        () => flash(t('deepLinkCopied')),
        () => flash(t('deepLinkCopyFailed')),
      );
    });

    return button;
  }

  /**
   * Copies text via the async Clipboard API where available, falling
   * back to a hidden, selected <textarea> + execCommand('copy') — some
   * browsing contexts (older browsers, denied clipboard permission)
   * don't support/allow navigator.clipboard.writeText.
   */
  private copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('execCommand copy failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
      }
    });
  }

  private flashButtonLabel(button: HTMLButtonElement, defaultLabel: string, flashLabel: string): void {
    button.textContent = flashLabel;
    setTimeout(() => {
      button.textContent = defaultLabel;
    }, 1800);
  }
}

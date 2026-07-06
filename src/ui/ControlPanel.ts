import { params, resetParams, type SimParams, type SimMode, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import { getLanguage, setLanguage, onLanguageChange, SUPPORTED_LANGUAGES, type Language } from '../i18n/language';
import { t, type TranslationKey } from '../i18n/translations';

interface SliderSpec {
  key: keyof SimParams;
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
}

// Population/speed: the settings the user tunes most often — shown
// ungrouped at the top (always visible, not tucked behind a collapsible
// section) rather than folded away with everything else.
const populationSpeedSpecs: SliderSpec[] = [
  { key: 'boidCount', labelKey: 'boidCount', min: 0, max: 500, step: 1 },
  { key: 'parrotCount', labelKey: 'parrotCount', min: 0, max: 300, step: 1 },
  { key: 'goldfinchCount', labelKey: 'goldfinchCount', min: 0, max: 300, step: 1 },
  { key: 'cardinalCount', labelKey: 'cardinalCount', min: 0, max: 300, step: 1 },
  { key: 'bluejayCount', labelKey: 'bluejayCount', min: 0, max: 300, step: 1 },
  { key: 'predatorCount', labelKey: 'predatorCount', min: 0, max: 10, step: 1 },
  { key: 'boidMaxSpeed', labelKey: 'boidMaxSpeed', min: 20, max: 300, step: 5 },
  { key: 'predatorMaxSpeed', labelKey: 'predatorMaxSpeed', min: 20, max: 350, step: 5 },
];

// Flocking-rule tuning: perception, the three classic boid rule weights,
// and predator-panic response. Collapsed by default — fiddly to tune but
// nowhere near as frequently touched as population/speed.
const behaviorSpecs: SliderSpec[] = [
  { key: 'perceptionRadius', labelKey: 'perceptionRadius', min: 10, max: 200, step: 5 },
  { key: 'perceptionAngleDeg', labelKey: 'perceptionAngleDeg', min: 30, max: 360, step: 10 },
  { key: 'separationWeight', labelKey: 'separationWeight', min: 0, max: 4, step: 0.1 },
  { key: 'alignmentWeight', labelKey: 'alignmentWeight', min: 0, max: 4, step: 0.1 },
  { key: 'cohesionWeight', labelKey: 'cohesionWeight', min: 0, max: 4, step: 0.1 },
  { key: 'separationRadius', labelKey: 'separationRadius', min: 5, max: 100, step: 1 },
  { key: 'panicRadius', labelKey: 'panicRadius', min: 10, max: 300, step: 5 },
  { key: 'fleeWeight', labelKey: 'fleeWeight', min: 0, max: 8, step: 0.1 },
];

// 3D-mode-only world settings, kept separate from the wall/boundary
// steer-away tuning below since they're conceptually different (world
// size vs. how entities react near its edges). Just world depth for now
// — room to grow without cluttering the population/speed section.
const threeDSliderSpecs: SliderSpec[] = [{ key: 'worldDepth', labelKey: 'worldDepth', min: 100, max: 1500, step: 50 }];

// 3D-only: bounded-box wall steer-away behavior.
const boundarySliderSpecs: SliderSpec[] = [
  { key: 'boundaryMargin', labelKey: 'boundaryMargin', min: 10, max: 300, step: 10 },
  { key: 'boundaryWeight', labelKey: 'boundaryWeight', min: 0, max: 10, step: 0.5 },
  { key: 'centerPullWeight', labelKey: 'centerPullWeight', min: 0, max: 0.5, step: 0.01 },
];

// Cosmetic motion-trail effect (afterimage fade) — not a "behavior" setting,
// kept ungrouped near the top alongside the mode/style toggles.
const trailSliderSpec: SliderSpec = { key: 'trailAmount', labelKey: 'trailAmount', min: 0, max: 0.95, step: 0.01 };

export class ControlPanel {
  private container: HTMLElement;
  private sim: Simulation;
  private onModeChange: (mode: SimMode) => void;
  private alienButton: HTMLButtonElement | null = null;
  private respawnButton: HTMLButtonElement | null = null;
  private unsubscribeLanguage: () => void;

  constructor(container: HTMLElement, sim: Simulation, onModeChange: (mode: SimMode) => void) {
    this.container = container;
    this.sim = sim;
    this.onModeChange = onModeChange;
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

  private render(): void {
    this.container.innerHTML = '';

    this.container.appendChild(this.buildModeToggle());

    if (params.mode === '3d') {
      this.container.appendChild(this.buildVisualStyleToggle());
    }

    this.container.appendChild(
      this.buildSection(
        t('sectionPopulationSpeed'),
        [...populationSpeedSpecs.map((spec) => this.buildSlider(spec)), this.buildAlienInvasionButton()],
        true,
      ),
    );

    // Motion trail only has a visible effect in 2D and 3D-arcade — the
    // nature style's afterimage/bloom pass is disabled outright (see
    // Renderer3D's currentStyle switch), so grey it out there rather than
    // let it silently do nothing. Perception/panic radii are drawn only by
    // the 2D canvas renderer, so grey that out whenever 3D mode is active.
    const trailDisabled = params.mode === '3d' && params.visualStyle === 'nature';
    const debugDisabled = params.mode === '3d';
    const visualSettingsChildren = [this.buildSlider(trailSliderSpec, trailDisabled), this.buildDebugToggle(debugDisabled)];
    if (params.mode === '3d' && params.visualStyle === 'nature') {
      visualSettingsChildren.push(this.buildDragonPredatorsToggle());
      visualSettingsChildren.push(this.buildFogToggle());
    }
    this.container.appendChild(this.buildSection(t('sectionVisualSettings'), visualSettingsChildren, false));

    this.container.appendChild(
      this.buildSection(
        t('sectionBehavior'),
        [this.buildPredatorCatchToggle(), ...behaviorSpecs.map((spec) => this.buildSlider(spec))],
        false,
      ),
    );

    if (params.mode === '3d') {
      this.container.appendChild(
        this.buildSection(
          t('section3DSettings'),
          threeDSliderSpecs.map((spec) => this.buildSlider(spec)),
          false,
        ),
      );
      this.container.appendChild(
        this.buildSection(
          t('sectionBoundaryBehavior'),
          boundarySliderSpecs.map((spec) => this.buildSlider(spec)),
          false,
        ),
      );
    }

    this.container.appendChild(this.buildLanguageToggle());
    this.container.appendChild(this.buildButtons());
  }

  private buildLanguageToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = t('languageLabel');
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

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
      // No explicit render() call here — setLanguage() notifies the
      // onLanguageChange subscription set up in the constructor, which
      // re-renders the whole panel (and main.ts's own static strings).
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  private buildModeToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = t('modeLabel');
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-mode';
    for (const mode of ['2d', '3d'] as SimMode[]) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode === '2d' ? t('mode2d') : t('mode3d');
      if (mode === params.mode) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      params.mode = select.value as SimMode;
      this.sim.reset();
      this.onModeChange(params.mode);
      this.render();
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  private buildVisualStyleToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = t('visualStyleLabel');
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-visual-style';
    const options: { value: VisualStyle; textKey: TranslationKey }[] = [
      { value: 'arcade', textKey: 'visualStyleArcade' },
      { value: 'nature', textKey: 'visualStyleNature' },
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = t(opt.textKey);
      if (opt.value === params.visualStyle) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      params.visualStyle = select.value as VisualStyle;
      // Re-render so the dragon-predators toggle (nature-only) appears/
      // disappears immediately rather than only after some other change.
      this.render();
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  private buildDragonPredatorsToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('dragonPredatorsLabel');
    label.htmlFor = 'param-dragon-predators';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-dragon-predators';
    input.checked = params.dragonPredators;
    input.addEventListener('change', () => {
      params.dragonPredators = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildFogToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('fogEnabledLabel');
    label.htmlFor = 'param-fog-enabled';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-fog-enabled';
    input.checked = params.fogEnabled;
    input.addEventListener('change', () => {
      params.fogEnabled = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildAlienInvasionButton(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-buttons';

    const button = document.createElement('button');
    button.textContent = t('alienInvasionButton');
    button.addEventListener('click', () => {
      this.sim.spawnUFO();
    });
    this.alienButton = button;
    wrapper.appendChild(button);

    // Abducted boids wait out a delay before flying back out of the coop
    // (see Simulation.pendingRespawns) — this lets the user skip the wait
    // instead of only ever watching a timer. Greyed out/disabled whenever
    // nothing is currently pending.
    const respawnButton = document.createElement('button');
    respawnButton.addEventListener('click', () => {
      this.sim.respawnPendingNow();
    });
    this.respawnButton = respawnButton;
    wrapper.appendChild(respawnButton);

    this.syncAlienInvasionButton();
    this.syncRespawnButton();
    return wrapper;
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
    const wrongMode = params.mode !== '3d';
    const atCapacity = this.sim.ufos.length >= MAX_CONCURRENT_UFOS;
    const disabled = wrongMode || atCapacity;
    button.disabled = disabled;
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
    button.disabled = pendingCount === 0;
    button.textContent = pendingCount > 0 ? t('respawnButtonPending', { count: pendingCount }) : t('respawnButtonIdle');
    button.title = pendingCount > 0 ? t('respawnTitlePending') : t('respawnTitleIdle');
  }

  private buildPredatorCatchToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('predatorCatchLabel');
    label.htmlFor = 'param-predator-catch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-predator-catch';
    input.checked = params.predatorCatchEnabled;
    input.addEventListener('change', () => {
      params.predatorCatchEnabled = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  /** A native <details>/<summary> collapsible group — no extra JS state, resets to defaultOpen on full re-render. */
  private buildSection(title: string, children: HTMLElement[], defaultOpen: boolean): HTMLElement {
    const details = document.createElement('details');
    details.className = 'control-section';
    details.open = defaultOpen;

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

  private buildSlider(spec: SliderSpec, disabled: boolean = false): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';
    if (disabled) wrapper.classList.add('control-row-disabled');

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';

    const label = document.createElement('label');
    label.textContent = t(spec.labelKey);
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
    return wrapper;
  }

  private buildDebugToggle(disabled: boolean = false): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';
    if (disabled) wrapper.classList.add('control-row-disabled');

    const label = document.createElement('label');
    label.textContent = t('debugToggleLabel');
    label.htmlFor = 'param-debug';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-debug';
    input.checked = params.showDebugOverlay;
    input.disabled = disabled;
    input.addEventListener('change', () => {
      params.showDebugOverlay = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }
}

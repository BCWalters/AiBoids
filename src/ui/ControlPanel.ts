import { params, resetParams, type SimParams, type SimMode, type VisualStyle, type GalleryCreature, type TimeOfDayPreset } from '../sim/params';
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
  { key: 'predatorCount', labelKey: 'predatorCount', min: 0, max: 25, step: 1 },
  { key: 'unicornCount', labelKey: 'unicornCount', min: 0, max: 25, step: 1 },
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
  { key: 'interspeciesAvoidWeight', labelKey: 'interspeciesAvoidWeight', min: 0, max: 4, step: 0.1 },
  { key: 'interspeciesAvoidRadius', labelKey: 'interspeciesAvoidRadius', min: 5, max: 150, step: 1 },
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
const animationBlendSliderSpec: SliderSpec = { key: 'animationBlendStrength', labelKey: 'animationBlendStrength', min: 0, max: 1, step: 0.05 };

// Fishtank swims with a much smaller population than the wide-open
// outdoor styles by default — a giant public-aquarium tank reads oddly
// crowded at the same counts that look right scattered across an open
// sky/field. Snapshotted alongside savedOutdoorPopulation below so each
// style's own counts (including any manual tweaks) are preserved across
// repeated switches, without ever touching defaultParams itself (the
// "outdoor" default counts must stay exactly as they were).
type PopulationSnapshot = Pick<
  SimParams,
  'boidCount' | 'parrotCount' | 'goldfinchCount' | 'cardinalCount' | 'bluejayCount' | 'predatorCount' | 'unicornCount'
>;
const POPULATION_KEYS: (keyof PopulationSnapshot)[] = [
  'boidCount',
  'parrotCount',
  'goldfinchCount',
  'cardinalCount',
  'bluejayCount',
  'predatorCount',
  'unicornCount',
];
const FISHTANK_DEFAULT_POPULATION: PopulationSnapshot = {
  boidCount: 40,
  parrotCount: 20,
  goldfinchCount: 20,
  cardinalCount: 20,
  bluejayCount: 20,
  predatorCount: 1,
  unicornCount: 2,
};
let savedOutdoorPopulation: PopulationSnapshot | null = null;
let savedFishtankPopulation: PopulationSnapshot | null = null;

function snapshotPopulation(): PopulationSnapshot {
  const snapshot = {} as PopulationSnapshot;
  for (const key of POPULATION_KEYS) snapshot[key] = params[key];
  return snapshot;
}

export class ControlPanel {
  private container: HTMLElement;
  private sim: Simulation;
  private onModeChange: (mode: SimMode) => void;
  private getDeepLinkURL: () => string;
  private onDownloadDiagnostics: () => 'downloaded' | 'no_data' | 'error';
  private onClearDiagnostics: () => number;
  private alienButton: HTMLButtonElement | null = null;
  private respawnButton: HTMLButtonElement | null = null;
  private unsubscribeLanguage: () => void;
  private lastAlienButtonState: { activeCount: number; wrongMode: boolean; atCapacity: boolean } | null = null;
  private lastRespawnPendingCount: number | null = null;
  // Tracks each collapsible section's open/closed state across re-renders
  // (keyed by a stable section id, not the translated title — titles
  // change with language). Without this, buildSection's `defaultOpen`
  // was re-applied on every single render() call, so any change that
  // triggers a full re-render (e.g. selecting a Model Gallery creature,
  // which calls refresh() from main.ts) would snap every section back to
  // its default state, closing sections the user had deliberately opened
  // — most noticeably the Model Gallery section itself right after
  // picking a creature from its own dropdown.
  private sectionOpenState = new Map<string, boolean>();

  constructor(
    container: HTMLElement,
    sim: Simulation,
    onModeChange: (mode: SimMode) => void,
    getDeepLinkURL: () => string,
    onDownloadDiagnostics: () => 'downloaded' | 'no_data' | 'error',
    onClearDiagnostics: () => number,
  ) {
    this.container = container;
    this.sim = sim;
    this.onModeChange = onModeChange;
    this.getDeepLinkURL = getDeepLinkURL;
    this.onDownloadDiagnostics = onDownloadDiagnostics;
    this.onClearDiagnostics = onClearDiagnostics;
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
   * entering/exiting the Model Gallery, which rewrites several
   * population/mode/style params at once outside of any control the
   * panel itself owns.
   */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';
    this.lastAlienButtonState = null;
    this.lastRespawnPendingCount = null;

    this.container.appendChild(this.buildModeToggle());

    if (params.mode === '3d') {
      this.container.appendChild(this.buildVisualStyleToggle());
      this.container.appendChild(this.buildSection('modelGallery', t('sectionModelGallery'), [this.buildGalleryDropdown()], false));
    }

    // Population sliders are greyed out (not removed) while the Model
    // Gallery has isolated a single creature — main.ts zeroes these
    // params itself while active, so a live slider drag would otherwise
    // silently fight the isolation until Gallery is exited.
    const galleryActive = params.galleryCreature !== null;
    this.container.appendChild(
      this.buildSection(
        'populationSpeed',
        t('sectionPopulationSpeed'),
        [...populationSpeedSpecs.map((spec) => this.buildSlider(spec, galleryActive)), this.buildAlienInvasionButton()],
        true,
      ),
    );

    // Motion trail only has a visible effect in 2D and 3D-arcade — the
    // nature style's afterimage/bloom pass is disabled outright (see
    // Renderer3D's currentStyle switch), so grey it out there rather than
    // let it silently do nothing. Perception/panic radii are drawn only by
    // the 2D canvas renderer, so grey that out whenever 3D mode is active.
    const trailDisabled = params.mode === '3d' && params.visualStyle !== 'arcade';
    const debugDisabled = params.mode === '3d';
    const visualSettingsChildren = [
      this.buildSlider(trailSliderSpec, trailDisabled),
      this.buildDebugToggle(debugDisabled),
      this.buildRenderingStatsToggle(),
      this.buildDiagnosticsCaptureToggle(),
      this.buildDiagnosticsButtons(),
    ];
    if (params.mode === '3d' && params.visualStyle !== 'arcade') {
      visualSettingsChildren.push(this.buildTimeOfDayToggle());
      visualSettingsChildren.push(this.buildSoftShadowsToggle());
      visualSettingsChildren.push(this.buildDragonPredatorsToggle());
      visualSettingsChildren.push(this.buildLightShaftsToggle());
      visualSettingsChildren.push(this.buildFogToggle());
      visualSettingsChildren.push(this.buildSlider(animationBlendSliderSpec));
      if (params.visualStyle === 'fishtank') visualSettingsChildren.push(this.buildWaterEffectsToggle());
    }
    this.container.appendChild(this.buildSection('visualSettings', t('sectionVisualSettings'), visualSettingsChildren, false));

    this.container.appendChild(
      this.buildSection(
        'behavior',
        t('sectionBehavior'),
        [this.buildPredatorCatchToggle(), ...behaviorSpecs.map((spec) => this.buildSlider(spec))],
        false,
      ),
    );

    if (params.mode === '3d') {
      this.container.appendChild(
        this.buildSection(
          '3dSettings',
          t('section3DSettings'),
          threeDSliderSpecs.map((spec) => this.buildSlider(spec)),
          false,
        ),
      );
      this.container.appendChild(
        this.buildSection(
          'boundaryBehavior',
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
      { value: 'fishtank', textKey: 'visualStyleFishtank' },
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = t(opt.textKey);
      if (opt.value === params.visualStyle) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const newStyle = select.value as VisualStyle;
      const oldStyle = params.visualStyle;
      if (newStyle !== oldStyle) {
        if (oldStyle === 'fishtank' && newStyle !== 'fishtank') {
          savedFishtankPopulation = snapshotPopulation();
          if (savedOutdoorPopulation) Object.assign(params, savedOutdoorPopulation);
        } else if (oldStyle !== 'fishtank' && newStyle === 'fishtank') {
          savedOutdoorPopulation = snapshotPopulation();
          Object.assign(params, savedFishtankPopulation ?? FISHTANK_DEFAULT_POPULATION);
        }
      }
      params.visualStyle = newStyle;
      // Re-render so the dragon-predators toggle (nature-only) appears/
      // disappears immediately, and so the population sliders reflect
      // the just-swapped-in per-style counts above.
      this.render();
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  /**
   * Model Gallery: isolates a single creature front-and-center (all
   * other populations temporarily zeroed, sim frozen, camera framed on
   * it), for inspecting/orbiting/screenshotting one model's geometry
   * cleanly — reused across creature kinds so any future addition (e.g.
   * dragons being iterated on in parallel) gets this for free. Picking
   * "None" restores exactly the population/mode/style params that were
   * active before entering (see main.ts's enterGallery/exitGallery).
   */
  private buildGalleryDropdown(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = t('galleryLabel');
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-gallery-creature';
    const options: { value: GalleryCreature | 'none'; textKey: TranslationKey }[] = [
      { value: 'none', textKey: 'galleryNone' },
      { value: 'unicorn', textKey: 'galleryUnicorn' },
      { value: 'dragon', textKey: 'galleryDragon' },
      { value: 'hawk', textKey: 'galleryHawk' },
      { value: 'sparrow', textKey: 'gallerySparrow' },
      { value: 'parrot', textKey: 'galleryParrot' },
      { value: 'goldfinch', textKey: 'galleryGoldfinch' },
      { value: 'cardinal', textKey: 'galleryCardinal' },
      { value: 'bluejay', textKey: 'galleryBluejay' },
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = t(opt.textKey);
      if (opt.value === (params.galleryCreature ?? 'none')) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      // main.ts's per-frame loop notices this change and does the actual
      // snapshot/isolate (or restore) + camera framing work — this
      // control only ever writes the one param.
      params.galleryCreature = select.value === 'none' ? null : (select.value as GalleryCreature);
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

  private buildTimeOfDayToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = t('timeOfDayLabel');
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-time-of-day';
    const options: { value: TimeOfDayPreset; textKey: TranslationKey }[] = [
      { value: 'dawn', textKey: 'timeOfDayDawn' },
      { value: 'noon', textKey: 'timeOfDayNoon' },
      { value: 'sunset', textKey: 'timeOfDaySunset' },
      { value: 'night', textKey: 'timeOfDayNight' },
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = t(opt.textKey);
      if (opt.value === params.timeOfDay) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      params.timeOfDay = select.value as TimeOfDayPreset;
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  private buildSoftShadowsToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('softShadowsLabel');
    label.htmlFor = 'param-soft-shadows-enabled';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-soft-shadows-enabled';
    input.checked = params.softShadowsEnabled;
    input.addEventListener('change', () => {
      params.softShadowsEnabled = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildLightShaftsToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('lightShaftsLabel');
    label.htmlFor = 'param-light-shafts-enabled';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-light-shafts-enabled';
    input.checked = params.lightShaftsEnabled;
    input.addEventListener('change', () => {
      params.lightShaftsEnabled = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildWaterEffectsToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('waterEffectsLabel');
    label.htmlFor = 'param-water-effects-enabled';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-water-effects-enabled';
    input.checked = params.waterEffectsEnabled;
    input.addEventListener('change', () => {
      params.waterEffectsEnabled = input.checked;
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
      // Immediate, unmistakable feedback that the click registered —
      // the saucer itself takes a moment to descend into view, and the
      // button doesn't visibly grey out until the cap is reached, so without
      // this a click can otherwise feel like it did nothing.
      button.classList.remove('button-pulse');
      // Force a reflow so re-adding the class restarts the animation
      // even on rapid repeated clicks.
      void button.offsetWidth;
      button.classList.add('button-pulse');
      this.syncAlienInvasionButton();
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

  private buildRenderingStatsToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('showRenderingStatsLabel');
    label.htmlFor = 'param-rendering-stats';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-rendering-stats';
    input.checked = params.showRenderingStats;
    input.addEventListener('change', () => {
      params.showRenderingStats = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildDiagnosticsCaptureToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = t('enableDiagnosticsCaptureLabel');
    label.htmlFor = 'param-diagnostics-capture';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-diagnostics-capture';
    input.checked = params.enableDiagnosticsCapture;
    input.addEventListener('change', () => {
      params.enableDiagnosticsCapture = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  private buildDiagnosticsButtons(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-buttons';

    const downloadButton = document.createElement('button');
    const downloadDefault = t('downloadDiagnosticsButton');
    downloadButton.textContent = downloadDefault;
    downloadButton.addEventListener('click', () => {
      const result = this.onDownloadDiagnostics();
      if (result === 'downloaded') this.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsDownloaded'));
      else if (result === 'no_data') this.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsNoData'));
      else this.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsDownloadFailed'));
    });

    const clearButton = document.createElement('button');
    const clearDefault = t('clearDiagnosticsButton');
    clearButton.textContent = clearDefault;
    clearButton.addEventListener('click', () => {
      const cleared = this.onClearDiagnostics();
      this.flashButtonLabel(clearButton, clearDefault, t('diagnosticsCleared', { count: cleared }));
    });

    wrapper.appendChild(downloadButton);
    wrapper.appendChild(clearButton);
    return wrapper;
  }

  private flashButtonLabel(button: HTMLButtonElement, defaultLabel: string, flashLabel: string): void {
    button.textContent = flashLabel;
    setTimeout(() => {
      button.textContent = defaultLabel;
    }, 1800);
  }
}

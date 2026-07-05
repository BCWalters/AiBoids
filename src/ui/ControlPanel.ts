import { params, resetParams, type SimParams, type SimMode, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

interface SliderSpec {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

// Population/speed: the settings the user tunes most often — shown
// ungrouped at the top (always visible, not tucked behind a collapsible
// section) rather than folded away with everything else.
const populationSpeedSpecs: SliderSpec[] = [
  { key: 'boidCount', label: 'Boid count (sparrows)', min: 0, max: 500, step: 1 },
  { key: 'parrotCount', label: 'Parrot count', min: 0, max: 300, step: 1 },
  { key: 'goldfinchCount', label: 'Goldfinch count', min: 0, max: 300, step: 1 },
  { key: 'cardinalCount', label: 'Cardinal count', min: 0, max: 300, step: 1 },
  { key: 'bluejayCount', label: 'Blue jay count', min: 0, max: 300, step: 1 },
  { key: 'predatorCount', label: 'Predator count', min: 0, max: 10, step: 1 },
  { key: 'boidMaxSpeed', label: 'Boid max speed', min: 20, max: 300, step: 5 },
  { key: 'predatorMaxSpeed', label: 'Predator max speed', min: 20, max: 350, step: 5 },
];

// Flocking-rule tuning: perception, the three classic boid rule weights,
// and predator-panic response. Collapsed by default — fiddly to tune but
// nowhere near as frequently touched as population/speed.
const behaviorSpecs: SliderSpec[] = [
  { key: 'perceptionRadius', label: 'Perception radius', min: 10, max: 200, step: 5 },
  { key: 'perceptionAngleDeg', label: 'Perception angle (°)', min: 30, max: 360, step: 10 },
  { key: 'separationWeight', label: 'Separation weight', min: 0, max: 4, step: 0.1 },
  { key: 'alignmentWeight', label: 'Alignment weight', min: 0, max: 4, step: 0.1 },
  { key: 'cohesionWeight', label: 'Cohesion weight', min: 0, max: 4, step: 0.1 },
  { key: 'separationRadius', label: 'Separation radius', min: 5, max: 100, step: 1 },
  { key: 'panicRadius', label: 'Predator panic radius', min: 10, max: 300, step: 5 },
  { key: 'fleeWeight', label: 'Flee weight', min: 0, max: 8, step: 0.1 },
];

// 3D-mode-only world settings, kept separate from the wall/boundary
// steer-away tuning below since they're conceptually different (world
// size vs. how entities react near its edges). Just world depth for now
// — room to grow without cluttering the population/speed section.
const threeDSliderSpecs: SliderSpec[] = [{ key: 'worldDepth', label: 'World depth (z)', min: 100, max: 1500, step: 50 }];

// 3D-only: bounded-box wall steer-away behavior.
const boundarySliderSpecs: SliderSpec[] = [
  { key: 'boundaryMargin', label: 'Wall steer-away margin', min: 10, max: 300, step: 10 },
  { key: 'boundaryWeight', label: 'Wall steer-away strength', min: 0, max: 10, step: 0.5 },
  { key: 'centerPullWeight', label: 'Center pull (avoids corner-camping)', min: 0, max: 0.5, step: 0.01 },
];

// Cosmetic motion-trail effect (afterimage fade) — not a "behavior" setting,
// kept ungrouped near the top alongside the mode/style toggles.
const trailSliderSpec: SliderSpec = { key: 'trailAmount', label: 'Motion trail amount', min: 0, max: 0.95, step: 0.01 };

export class ControlPanel {
  private container: HTMLElement;
  private sim: Simulation;
  private onModeChange: (mode: SimMode) => void;

  constructor(container: HTMLElement, sim: Simulation, onModeChange: (mode: SimMode) => void) {
    this.container = container;
    this.sim = sim;
    this.onModeChange = onModeChange;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';

    this.container.appendChild(this.buildModeToggle());

    if (params.mode === '3d') {
      this.container.appendChild(this.buildVisualStyleToggle());
    }

    this.container.appendChild(
      this.buildSection(
        'Population & speed',
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
    this.container.appendChild(this.buildSection('Visual settings', visualSettingsChildren, false));

    this.container.appendChild(
      this.buildSection(
        'Behavior',
        [this.buildPredatorCatchToggle(), ...behaviorSpecs.map((spec) => this.buildSlider(spec))],
        false,
      ),
    );

    if (params.mode === '3d') {
      this.container.appendChild(
        this.buildSection(
          '3D settings',
          threeDSliderSpecs.map((spec) => this.buildSlider(spec)),
          false,
        ),
      );
      this.container.appendChild(
        this.buildSection(
          'Boundary behavior',
          boundarySliderSpecs.map((spec) => this.buildSlider(spec)),
          false,
        ),
      );
    }

    this.container.appendChild(this.buildButtons());
  }

  private buildModeToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label-row';
    const label = document.createElement('label');
    label.textContent = 'Mode';
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-mode';
    for (const mode of ['2d', '3d'] as SimMode[]) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode === '2d' ? '2D (top-down)' : '3D (orbit camera)';
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
    label.textContent = 'Visual style';
    labelRow.appendChild(label);
    wrapper.appendChild(labelRow);

    const select = document.createElement('select');
    select.id = 'param-visual-style';
    const options: { value: VisualStyle; text: string }[] = [
      { value: 'arcade', text: 'Arcade (neon glow)' },
      { value: 'nature', text: 'Nature (sky & hawks)' },
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.text;
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
    label.textContent = 'There be dragons';
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
    label.textContent = 'Distance fog';
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

    const disabled = params.mode !== '3d';
    const button = document.createElement('button');
    button.textContent = 'Send alien invasion 🛸';
    button.disabled = disabled;
    button.title = disabled
      ? 'Switch to 3D mode to send a flying saucer'
      : 'A flying saucer descends, tractor-beams nearby boids aboard, then departs';
    button.addEventListener('click', () => {
      this.sim.spawnUFO();
    });
    if (disabled) wrapper.classList.add('control-row-disabled');

    wrapper.appendChild(button);
    return wrapper;
  }

  private buildPredatorCatchToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = 'Predators can catch prey';
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
    label.textContent = spec.label;
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
    playPause.textContent = params.running ? 'Pause' : 'Play';
    playPause.addEventListener('click', () => {
      params.running = !params.running;
      playPause.textContent = params.running ? 'Pause' : 'Play';
    });

    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      this.sim.reset();
    });

    const restoreDefaults = document.createElement('button');
    restoreDefaults.textContent = 'Restore defaults';
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
    label.textContent = 'Show perception/panic radii';
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

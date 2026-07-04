import { params, resetParams, type SimParams } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

interface SliderSpec {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

const sliderSpecs: SliderSpec[] = [
  { key: 'boidCount', label: 'Boid count', min: 0, max: 500, step: 1 },
  { key: 'predatorCount', label: 'Predator count', min: 0, max: 10, step: 1 },
  { key: 'boidMaxSpeed', label: 'Boid max speed', min: 20, max: 300, step: 5 },
  { key: 'predatorMaxSpeed', label: 'Predator max speed', min: 20, max: 350, step: 5 },
  { key: 'perceptionRadius', label: 'Perception radius', min: 10, max: 200, step: 5 },
  { key: 'perceptionAngleDeg', label: 'Perception angle (°)', min: 30, max: 360, step: 10 },
  { key: 'separationWeight', label: 'Separation weight', min: 0, max: 4, step: 0.1 },
  { key: 'alignmentWeight', label: 'Alignment weight', min: 0, max: 4, step: 0.1 },
  { key: 'cohesionWeight', label: 'Cohesion weight', min: 0, max: 4, step: 0.1 },
  { key: 'separationRadius', label: 'Separation radius', min: 5, max: 100, step: 1 },
  { key: 'panicRadius', label: 'Predator panic radius', min: 10, max: 300, step: 5 },
  { key: 'fleeWeight', label: 'Flee weight', min: 0, max: 8, step: 0.1 },
];

export class ControlPanel {
  private container: HTMLElement;
  private sim: Simulation;

  constructor(container: HTMLElement, sim: Simulation) {
    this.container = container;
    this.sim = sim;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';

    for (const spec of sliderSpecs) {
      this.container.appendChild(this.buildSlider(spec));
    }

    this.container.appendChild(this.buildButtons());
    this.container.appendChild(this.buildDebugToggle());
  }

  private buildSlider(spec: SliderSpec): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row';

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

  private buildDebugToggle(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-row control-checkbox-row';

    const label = document.createElement('label');
    label.textContent = 'Show perception/panic radii';
    label.htmlFor = 'param-debug';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param-debug';
    input.checked = params.showDebugOverlay;
    input.addEventListener('change', () => {
      params.showDebugOverlay = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }
}

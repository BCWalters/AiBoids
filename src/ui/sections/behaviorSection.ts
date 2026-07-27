/**
 * Behavior section: flocking-rule tuning (perception, the three classic boid
 * rule weights, and predator-panic response). Collapsed by default — fiddly to
 * tune but nowhere near as frequently touched as population/speed.
 */

import { params } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SliderSpec, SectionContext } from './sectionContext';

// ------------------------------------------------------------------
// Slider specs
// ------------------------------------------------------------------

// Flocking-rule tuning: perception, the three classic boid rule weights,
// and predator-panic response. Collapsed by default — fiddly to tune but
// nowhere near as frequently touched as population/speed.
const behaviorSpecs: SliderSpec[] = [
  { key: 'perceptionRadius',        labelKey: 'perceptionRadius',        min: 10, max: 200,  step: 5   },
  { key: 'perceptionAngleDeg',      labelKey: 'perceptionAngleDeg',      min: 30, max: 360,  step: 10  },
  { key: 'boidTurnRateDeg',         labelKey: 'boidTurnRateDeg',         min: 0,  max: 720,  step: 10  },
  { key: 'separationWeight',        labelKey: 'separationWeight',        min: 0,  max: 4,    step: 0.1 },
  { key: 'alignmentWeight',         labelKey: 'alignmentWeight',         min: 0,  max: 4,    step: 0.1 },
  { key: 'cohesionWeight',          labelKey: 'cohesionWeight',          min: 0,  max: 4,    step: 0.1 },
  { key: 'separationRadius',        labelKey: 'separationRadius',        min: 5,  max: 100,  step: 1   },
  { key: 'interspeciesAvoidWeight', labelKey: 'interspeciesAvoidWeight', min: 0,  max: 4,    step: 0.1 },
  { key: 'interspeciesAvoidRadius', labelKey: 'interspeciesAvoidRadius', min: 5,  max: 150,  step: 1   },
  { key: 'panicRadius',             labelKey: 'panicRadius',             min: 10, max: 300,  step: 5   },
  { key: 'fleeWeight',              labelKey: 'fleeWeight',              min: 0,  max: 8,    step: 0.1 },
];

// ------------------------------------------------------------------
// Per-control builders
// ------------------------------------------------------------------

function buildPredatorCatchToggle(): HTMLElement {
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

// ------------------------------------------------------------------
// Section builder
// ------------------------------------------------------------------

export function buildBehaviorSection(ctx: SectionContext): HTMLElement {
  return ctx.buildSection(
    'behavior',
    t('sectionBehavior'),
    [buildPredatorCatchToggle(), ...behaviorSpecs.map((spec) => ctx.buildSlider(spec))],
    false,
  );
}

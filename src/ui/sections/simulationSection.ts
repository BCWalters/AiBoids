/**
 * Simulation-level controls: the mode select and (in 3D) the visual-style
 * select. These appear ungrouped at the very top of the panel, above all
 * collapsible sections. The visual-style toggle owns the fishtank↔outdoor
 * population-snapshot logic so switching styles preserves each style's own
 * creature counts across repeated switches.
 */

import { params, type SimParams, type SimMode, type VisualStyle } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SectionContext } from './sectionContext';

// ------------------------------------------------------------------
// Fishtank population-snapshot state
// ------------------------------------------------------------------

type PopulationSnapshot = Pick<
  SimParams,
  'boidCount' | 'multicolorCount' | 'goldCount' | 'redCount' | 'blueCount' | 'predatorCount' | 'monsterCount' | 'horseCount'
>;

const POPULATION_KEYS: (keyof PopulationSnapshot)[] = [
  'boidCount',
  'multicolorCount',
  'goldCount',
  'redCount',
  'blueCount',
  'predatorCount',
  'monsterCount',
  'horseCount',
];

// Fishtank swims with a much smaller population than the wide-open
// outdoor styles by default — a giant public-aquarium tank reads oddly
// crowded at the same counts that look right scattered across an open
// sky/field. Snapshotted alongside savedOutdoorPopulation below so each
// style's own counts (including any manual tweaks) are preserved across
// repeated switches, without ever touching defaultParams itself.
const FISHTANK_DEFAULT_POPULATION: PopulationSnapshot = {
  boidCount: 40,
  multicolorCount: 20,
  goldCount: 20,
  redCount: 20,
  blueCount: 20,
  predatorCount: 2,
  monsterCount: 1,
  horseCount: 2,
};

let savedOutdoorPopulation: PopulationSnapshot | null = null;
let savedFishtankPopulation: PopulationSnapshot | null = null;

function snapshotPopulation(): PopulationSnapshot {
  const snapshot = {} as PopulationSnapshot;
  for (const key of POPULATION_KEYS) snapshot[key] = params[key];
  return snapshot;
}

// ------------------------------------------------------------------
// Builders
// ------------------------------------------------------------------

export function buildModeToggle(ctx: SectionContext): HTMLElement {
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
    ctx.sim.reset();
    ctx.onModeChange(params.mode);
    ctx.render();
  });

  wrapper.appendChild(select);
  return wrapper;
}

export function buildVisualStyleToggle(ctx: SectionContext): HTMLElement {
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
  const options: { value: VisualStyle; textKey: Parameters<typeof t>[0] }[] = [
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
    ctx.render();
  });

  wrapper.appendChild(select);
  return wrapper;
}

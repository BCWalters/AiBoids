/**
 * Population & Speed section: boid/predator counts, max-speed sliders, and
 * the alien-invasion/respawn buttons. Population sliders are greyed out (not
 * removed) while the Creature Gallery has isolated a single creature — main.ts
 * zeroes these params itself while active, so a live slider drag would
 * otherwise silently fight the isolation until Gallery is exited.
 */

import { params } from '../../sim/params';
import { t } from '../../i18n/translations';
import { MAX_CONCURRENT_UFOS } from '../../sim/Simulation';
import type { SliderSpec, SectionContext } from './sectionContext';
import type { CreatureLabels } from '../../render/sceneRenderers/createSceneRendererHooks';

// ------------------------------------------------------------------
// Slider specs
// ------------------------------------------------------------------

// Population/speed: the settings the user tunes most often — shown
// ungrouped at the top (always visible, not tucked behind a collapsible
// section) rather than folded away with everything else.
const boidPopulationSpecs: SliderSpec[] = [
  { key: 'boidCount',      labelKey: 'boidCount',      min: 0,  max: 500, step: 1 },
  { key: 'multicolorCount',labelKey: 'multicolorCount',min: 0,  max: 300, step: 1 },
  { key: 'goldCount',      labelKey: 'goldCount',       min: 0,  max: 300, step: 1 },
  { key: 'redCount',       labelKey: 'redCount',        min: 0,  max: 300, step: 1 },
  { key: 'blueCount',      labelKey: 'blueCount',       min: 0,  max: 300, step: 1 },
  { key: 'boidMaxSpeed',   labelKey: 'boidMaxSpeed',    min: 20, max: 300, step: 5 },
];
const predatorPopulationSpecs: SliderSpec[] = [
  { key: 'predatorCount',   labelKey: 'predatorCount',   min: 0,  max: 25,  step: 1 },
  { key: 'monsterCount',    labelKey: 'monsterCount',    min: 0,  max: 25,  step: 1 },
  { key: 'horseCount',      labelKey: 'horseCount',      min: 0,  max: 25,  step: 1 },
  { key: 'predatorMaxSpeed',labelKey: 'predatorMaxSpeed',min: 20, max: 350, step: 5 },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Maps a population slider's param key to a scene-specific creature label when available. */
function resolvePopulationSliderLabel(spec: SliderSpec, labels: CreatureLabels | null): string | undefined {
  if (!labels) return undefined;
  const count = (text: string) => `${text} count`;
  switch (spec.key) {
    case 'boidCount':       return count(labels.boid.normal);
    case 'multicolorCount': return count(labels.boid.multicolor);
    case 'goldCount':       return count(labels.boid.gold);
    case 'redCount':        return count(labels.boid.red);
    case 'blueCount':       return count(labels.boid.blue);
    case 'predatorCount':   return count(labels.predator.normal);
    case 'monsterCount':    return count(labels.predator.monster);
    case 'horseCount':      return count(labels.predator.horse);
    default:                return undefined;
  }
}

/** Builds an outlined group of population sliders with a visible border. */
function buildPopulationGroup(
  ctx: SectionContext,
  specs: SliderSpec[],
  galleryActive: boolean,
  creatureLabels: CreatureLabels | null,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'population-group';
  for (const spec of specs) {
    group.appendChild(ctx.buildSlider(spec, galleryActive, resolvePopulationSliderLabel(spec, creatureLabels)));
  }
  return group;
}

function buildAlienInvasionButton(ctx: SectionContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'control-buttons';

  const button = document.createElement('button');
  button.textContent = t('alienInvasionButton');
  button.addEventListener('click', () => {
    ctx.sim.spawnUFO();
    // Immediate, unmistakable feedback that the click registered —
    // the saucer itself takes a moment to descend into view, and the
    // button doesn't visibly grey out until the cap is reached, so without
    // this a click can otherwise feel like it did nothing.
    button.classList.remove('button-pulse');
    // Force a reflow so re-adding the class restarts the animation
    // even on rapid repeated clicks.
    void button.offsetWidth;
    button.classList.add('button-pulse');
    syncAlienButton(button, ctx);
  });
  ctx.setAlienButton(button);
  wrapper.appendChild(button);

  // Abducted boids wait out a delay before flying back out of the coop
  // (see Simulation.pendingRespawns) — this lets the user skip the wait
  // instead of only ever watching a timer. Greyed out/disabled whenever
  // nothing is currently pending.
  const respawnButton = document.createElement('button');
  respawnButton.addEventListener('click', () => {
    ctx.sim.respawnPendingNow();
  });
  ctx.setRespawnButton(respawnButton);
  wrapper.appendChild(respawnButton);

  syncAlienButton(button, ctx);
  syncRespawnButton(respawnButton, ctx);
  return wrapper;
}

function syncAlienButton(button: HTMLButtonElement, ctx: SectionContext): void {
  const activeCount = ctx.sim.ufos.length;
  const wrongMode = params.mode !== '3d';
  const atCapacity = activeCount >= MAX_CONCURRENT_UFOS;
  const disabled = wrongMode || atCapacity;
  button.disabled = disabled;
  button.textContent =
    activeCount > 0 ? t('alienInvasionButtonActive', { count: activeCount, max: MAX_CONCURRENT_UFOS }) : t('alienInvasionButton');
  button.title = wrongMode
    ? t('alienInvasionTitleWrongMode')
    : atCapacity
      ? t('alienInvasionTitleAtCapacity', { max: MAX_CONCURRENT_UFOS })
      : t('alienInvasionTitleReady');
}

function syncRespawnButton(button: HTMLButtonElement, ctx: SectionContext): void {
  const pendingCount = ctx.sim.pendingRespawns.length;
  button.disabled = pendingCount === 0;
  button.textContent = pendingCount > 0 ? t('respawnButtonPending', { count: pendingCount }) : t('respawnButtonIdle');
  button.title = pendingCount > 0 ? t('respawnTitlePending') : t('respawnTitleIdle');
}

// ------------------------------------------------------------------
// Section builder
// ------------------------------------------------------------------

export function buildPopulationSection(ctx: SectionContext): HTMLElement {
  const galleryActive = params.galleryCreature !== null;
  const creatureLabels = ctx.getCreatureLabels();
  const boidGroup = buildPopulationGroup(ctx, boidPopulationSpecs, galleryActive, creatureLabels);
  const predatorGroup = buildPopulationGroup(ctx, predatorPopulationSpecs, galleryActive, creatureLabels);

  return ctx.buildSection(
    'populationSpeed',
    t('sectionPopulationSpeed'),
    [boidGroup, predatorGroup, buildAlienInvasionButton(ctx)],
    true,
  );
}

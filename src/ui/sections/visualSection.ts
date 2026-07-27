/**
 * Visual section: every aesthetic control, grouped into themed subsections
 * (lighting/atmosphere, water, post-processing) so the distinction between
 * "settings" and "FX" no longer has to be guessed. Non-aesthetic tooling
 * lives in its own Camera and Diagnostics sections.
 */

import { params, type TimeOfDayPreset } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SliderSpec, SectionContext } from './sectionContext';

// ------------------------------------------------------------------
// Slider specs
// ------------------------------------------------------------------

// Cosmetic motion-trail effect (afterimage fade) — not a "behavior" setting,
// kept ungrouped near the top alongside the mode/style toggles.
const trailSliderSpec: SliderSpec = { key: 'trailAmount', labelKey: 'trailAmount', min: 0, max: 0.95, step: 0.01 };
const animationBlendSliderSpec: SliderSpec = { key: 'animationBlendStrength', labelKey: 'animationBlendStrength', min: 0, max: 1, step: 0.05 };

// ------------------------------------------------------------------
// Per-control builders
// ------------------------------------------------------------------

function buildParrotReviewHoverToggle(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'control-row control-checkbox-row';

  const label = document.createElement('label');
  label.textContent = t('multicolorReviewHoverLabel');
  label.htmlFor = 'param-multicolor-review-hover';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'param-multicolor-review-hover';
  input.checked = params.galleryCreature === 'multicolor';
  input.addEventListener('change', () => {
    if (input.checked) params.galleryCreature = 'multicolor';
    else if (params.galleryCreature === 'multicolor') params.galleryCreature = null;
  });

  wrapper.appendChild(input);
  wrapper.appendChild(label);
  return wrapper;
}

function buildFogToggle(): HTMLElement {
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

function buildTimeOfDayToggle(): HTMLElement {
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
  const options: { value: TimeOfDayPreset; textKey: Parameters<typeof t>[0] }[] = [
    { value: 'dawn',   textKey: 'timeOfDayDawn' },
    { value: 'noon',   textKey: 'timeOfDayNoon' },
    { value: 'sunset', textKey: 'timeOfDaySunset' },
    { value: 'night',  textKey: 'timeOfDayNight' },
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

function buildSoftShadowsToggle(): HTMLElement {
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

function buildLightShaftsToggle(): HTMLElement {
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

function buildWaterEffectsToggle(): HTMLElement {
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

// ------------------------------------------------------------------
// Section builder
// ------------------------------------------------------------------

export function buildVisualSection(ctx: SectionContext): HTMLElement {
  // Motion trail only has a visible effect in 2D and 3D-arcade — the
  // nature style's afterimage/bloom pass is disabled outright (see
  // Renderer3D's currentStyle switch), so grey it out there rather than
  // let it silently do nothing.
  const trailDisabled = params.mode === '3d' && params.visualStyle !== 'arcade';
  // Visual section — one home for every aesthetic control, grouped into
  // themed subsections (lighting/atmosphere, water, post-processing) so the
  // distinction between "settings" and "FX" no longer has to be guessed.
  const is3DScene = params.mode === '3d' && params.visualStyle !== 'arcade';
  const visualChildren: HTMLElement[] = [ctx.buildSlider(trailSliderSpec, trailDisabled)];
  if (is3DScene) {
    visualChildren.push(ctx.buildSlider(animationBlendSliderSpec));
    if (params.visualStyle === 'nature') {
      visualChildren.push(buildParrotReviewHoverToggle());
    }
    visualChildren.push(
      ctx.buildSubsection(t('subsectionLighting'), [
        buildTimeOfDayToggle(),
        buildSoftShadowsToggle(),
        buildLightShaftsToggle(),
        buildFogToggle(),
      ]),
    );
    const waterChildren: HTMLElement[] = [];
    if (params.visualStyle === 'fishtank') {
      waterChildren.push(buildWaterEffectsToggle());
    }
    if (params.visualStyle === 'nature') {
      waterChildren.push(ctx.buildBooleanToggle('waterWavesEnabledLabel', 'param-water-waves-enabled', 'waterWavesEnabled'));
      waterChildren.push(ctx.buildBooleanToggle('waterReflectionsEnabledLabel', 'param-water-reflections-enabled', 'waterReflectionsEnabled'));
    }
    if (params.visualStyle === 'fishtank') {
      waterChildren.push(ctx.buildBooleanToggle('depthMurkEnabledLabel', 'param-depth-murk-enabled', 'depthMurkEnabled'));
    }
    if (waterChildren.length > 0) {
      visualChildren.push(ctx.buildSubsection(t('subsectionWater'), waterChildren));
    }
  }
  if (params.mode === '3d') {
    visualChildren.push(
      ctx.buildSubsection(t('subsectionPostProcessing'), [
        ctx.buildBooleanToggle('colorGradingEnabledLabel', 'param-color-grading-enabled', 'colorGradingEnabled'),
        ctx.buildBooleanToggle('depthOfFieldEnabledLabel', 'param-depth-of-field-enabled', 'depthOfFieldEnabled'),
      ]),
    );
  }

  return ctx.buildSection('visual', t('sectionVisual'), visualChildren, false);
}

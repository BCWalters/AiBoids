/**
 * World Boundaries section (3D only): world depth and bounded-box wall
 * steer-away behavior (margin, weight, center-pull).
 */

import { t } from '../../i18n/translations';
import type { SliderSpec, SectionContext } from './sectionContext';

// ------------------------------------------------------------------
// Slider specs
// ------------------------------------------------------------------

// 3D-mode-only world settings, kept separate from the wall/boundary
// steer-away tuning below since they're conceptually different (world
// size vs. how entities react near its edges).
const threeDSliderSpecs: SliderSpec[] = [
  { key: 'worldDepth', labelKey: 'worldDepth', min: 100, max: 1500, step: 50 },
];

// 3D-only: bounded-box wall steer-away behavior.
const boundarySliderSpecs: SliderSpec[] = [
  { key: 'boundaryMargin',    labelKey: 'boundaryMargin',    min: 10, max: 300,  step: 10   },
  { key: 'boundaryWeight',    labelKey: 'boundaryWeight',    min: 0,  max: 10,   step: 0.5  },
  { key: 'centerPullWeight',  labelKey: 'centerPullWeight',  min: 0,  max: 0.5,  step: 0.01 },
];

// ------------------------------------------------------------------
// Section builder
// ------------------------------------------------------------------

export function buildWorldBoundariesSection(ctx: SectionContext): HTMLElement {
  return ctx.buildSection(
    'worldBoundaries',
    t('sectionWorldBoundaries'),
    [
      ...threeDSliderSpecs.map((spec) => ctx.buildSlider(spec)),
      ...boundarySliderSpecs.map((spec) => ctx.buildSlider(spec)),
    ],
    false,
  );
}

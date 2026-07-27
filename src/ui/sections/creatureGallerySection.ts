/**
 * Creature Gallery section: isolates a single creature front-and-center (all
 * other populations temporarily zeroed, sim frozen, camera framed on it), for
 * inspecting/orbiting/screenshotting one model's geometry cleanly. Picking
 * "None" restores exactly the population/mode/style params that were active
 * before entering (see main.ts's enterGallery/exitGallery).
 */

import { params, type GalleryCreature } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SectionContext } from './sectionContext';

export function buildCreatureGallerySection(ctx: SectionContext): HTMLElement {
  return ctx.buildSection('creatureGallery', t('sectionCreatureGallery'), [buildCreatureGalleryDropdown(ctx)], false);
}

function buildCreatureGalleryDropdown(ctx: SectionContext): HTMLElement {
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
  const sceneLabels = ctx.getCreatureLabels();
  const galleryLabel = (key: GalleryCreature | 'none', textKey: Parameters<typeof t>[0]): string => {
    if (!sceneLabels || key === 'none') return t(textKey);
    if (key === 'monster')    return sceneLabels.predator.monster;
    if (key === 'predator')   return sceneLabels.predator.normal;
    if (key === 'horse')      return sceneLabels.predator.horse;
    if (key === 'normal')     return sceneLabels.boid.normal;
    if (key === 'multicolor') return sceneLabels.boid.multicolor;
    if (key === 'gold')       return sceneLabels.boid.gold;
    if (key === 'red')        return sceneLabels.boid.red;
    if (key === 'blue')       return sceneLabels.boid.blue;
    return t(textKey);
  };
  const options: { value: GalleryCreature | 'none'; textKey: Parameters<typeof t>[0] }[] = [
    { value: 'none',       textKey: 'galleryNone' },
    { value: 'horse',      textKey: 'galleryHorse' },
    { value: 'monster',    textKey: 'galleryMonster' },
    { value: 'predator',   textKey: 'galleryPredator' },
    { value: 'normal',     textKey: 'galleryNormal' },
    { value: 'multicolor', textKey: 'galleryMulticolor' },
    { value: 'gold',       textKey: 'galleryGold' },
    { value: 'red',        textKey: 'galleryRed' },
    { value: 'blue',       textKey: 'galleryBlue' },
  ];
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = galleryLabel(opt.value, opt.textKey);
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

/**
 * Camera section (3D only): creature-follow camera and the inspector HUD.
 */

import { params, type FollowCamMode } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SectionContext } from './sectionContext';

function buildFollowCamModeToggle(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'control-row';

  const labelRow = document.createElement('div');
  labelRow.className = 'control-label-row';
  const label = document.createElement('label');
  label.textContent = t('followCamModeLabel');
  labelRow.appendChild(label);
  wrapper.appendChild(labelRow);

  const select = document.createElement('select');
  select.id = 'param-follow-cam-mode';
  const options: { value: FollowCamMode; textKey: Parameters<typeof t>[0] }[] = [
    { value: 'off',   textKey: 'followCamModeOff' },
    { value: 'orbit', textKey: 'followCamModeOrbit' },
  ];
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = t(opt.textKey);
    if (opt.value === params.followCamMode) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    params.followCamMode = select.value as FollowCamMode;
  });

  wrapper.appendChild(select);
  return wrapper;
}

export function buildCameraSection(ctx: SectionContext): HTMLElement {
  return ctx.buildSection(
    'camera',
    t('sectionCamera'),
    [
      buildFollowCamModeToggle(),
      ctx.buildBooleanToggle('showCreatureInspectorLabel', 'param-show-creature-inspector', 'showCreatureInspector'),
    ],
    false,
  );
}

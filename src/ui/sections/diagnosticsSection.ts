/**
 * Diagnostics section: dev tooling (perception radii, render stats,
 * diagnostics capture). Not aesthetic, so kept out of the Visual section.
 */

import { params } from '../../sim/params';
import { t } from '../../i18n/translations';
import type { SectionContext } from './sectionContext';

// ------------------------------------------------------------------
// Per-control builders
// ------------------------------------------------------------------

function buildDebugToggle(disabled: boolean = false): HTMLElement {
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

function buildRenderingStatsToggle(): HTMLElement {
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

function buildDiagnosticsCaptureToggle(): HTMLElement {
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

function buildDiagnosticsButtons(ctx: SectionContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'control-buttons';

  const downloadButton = document.createElement('button');
  const downloadDefault = t('downloadDiagnosticsButton');
  downloadButton.textContent = downloadDefault;
  downloadButton.addEventListener('click', () => {
    const result = ctx.onDownloadDiagnostics();
    if (result === 'downloaded') ctx.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsDownloaded'));
    else if (result === 'no_data') ctx.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsNoData'));
    else ctx.flashButtonLabel(downloadButton, downloadDefault, t('diagnosticsDownloadFailed'));
  });

  const clearButton = document.createElement('button');
  const clearDefault = t('clearDiagnosticsButton');
  clearButton.textContent = clearDefault;
  clearButton.addEventListener('click', () => {
    const cleared = ctx.onClearDiagnostics();
    ctx.flashButtonLabel(clearButton, clearDefault, t('diagnosticsCleared', { count: cleared }));
  });

  wrapper.appendChild(downloadButton);
  wrapper.appendChild(clearButton);
  return wrapper;
}

// ------------------------------------------------------------------
// Section builder
// ------------------------------------------------------------------

export function buildDiagnosticsSection(ctx: SectionContext): HTMLElement {
  // Perception/panic radii are drawn only by the 2D canvas renderer, so
  // grey that out whenever 3D mode is active.
  const debugDisabled = params.mode === '3d';

  return ctx.buildSection(
    'diagnostics',
    t('sectionDiagnostics'),
    [
      buildDebugToggle(debugDisabled),
      buildRenderingStatsToggle(),
      buildDiagnosticsCaptureToggle(),
      buildDiagnosticsButtons(ctx),
    ],
    false,
  );
}

const OVERLAY_UPDATE_INTERVAL_MS = 200;

/**
 * Tiny UI surface for the diagnostics overlay so diagnostics data collection
 * can stay in diagnostics/ while DOM concerns live in ui/.
 */
export class DiagnosticsPanel {
  private readonly overlay: HTMLPreElement;
  private lastUpdatedAt = 0;
  private visibleLastFrame = false;

  constructor(host: HTMLElement) {
    this.overlay = document.createElement('pre');
    this.overlay.id = 'rendering-stats-overlay';
    this.overlay.className = 'rendering-stats-overlay';
    this.overlay.style.display = 'none';
    host.appendChild(this.overlay);
  }

  hide(): void {
    this.visibleLastFrame = false;
    this.overlay.style.display = 'none';
  }

  show(now: number, onFirstShow: () => void, buildText: () => string): void {
    if (!this.visibleLastFrame) {
      this.visibleLastFrame = true;
      onFirstShow();
    }
    this.overlay.style.display = 'block';
    if (now - this.lastUpdatedAt < OVERLAY_UPDATE_INTERVAL_MS) return;
    this.lastUpdatedAt = now;
    this.overlay.textContent = buildText();
  }
}

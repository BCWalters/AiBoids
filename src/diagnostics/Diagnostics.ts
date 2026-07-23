import { params, type SimMode, type SimParams } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { DiagnosticsPanel } from '../ui/DiagnosticsPanel';

const FRAME_STATS_WINDOW = 120;
const FRAME_STATS_WARMUP_MS = 4000;
const DIAGNOSTIC_LOG_MAX_ENTRIES = 6000;
const DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES = 2048;
const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 250;
const DIAGNOSTIC_SPIKE_THRESHOLD_MS = 40;
const DIAGNOSTIC_RUNTIME_WINDOW_MS = 1000;
const FRAME_GAP_ELEVATED_MS = 25;
const FRAME_GAP_STALLED_MS = 40;

type DiagnosticEventKind = 'sample' | 'spike';
type FrameGapClass = 'steady' | 'elevated' | 'stalled';
type RuntimeEventKind = 'longtask' | 'gc' | 'visibility' | 'focus';

interface DiagnosticRecord {
  event: DiagnosticEventKind;
  tsMs: number;
  frameMs: number;
  frameGapClass: FrameGapClass;
  simMs: number;
  uiMs: number;
  renderMs: number;
  postMs: number;
  unaccountedMs: number;
  recentLongTaskMs: number;
  recentLongTaskCount: number;
  recentGcMs: number;
  recentGcCount: number;
  visibility: DocumentVisibilityState;
  hasFocus: boolean;
  jsHeapUsedMB: number | null;
  jsHeapTotalMB: number | null;
  jsHeapLimitMB: number | null;
  boids: number;
  predators: number;
  ufos: number;
  mode: SimMode;
  visualStyle: SimParams['visualStyle'] | null;
}

interface DiagnosticRuntimeEventRecord {
  kind: RuntimeEventKind;
  tsMs: number;
  durationMs: number;
  visibility: DocumentVisibilityState | null;
  hasFocus: boolean | null;
}

interface RuntimeWindowStats {
  longTaskMs: number;
  longTaskCount: number;
  gcMs: number;
  gcCount: number;
}

interface HeapSnapshotMb {
  usedMB: number | null;
  totalMB: number | null;
  limitMB: number | null;
}

interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

/**
 * Owns all performance/runtime diagnostics: the rolling per-phase frame
 * timing window behind the "Rendering stats" overlay, the ring-buffered
 * spike/sample trace log (plus longtask/gc/visibility/focus runtime
 * events) captured while diagnostics capture is enabled, and the JSON
 * export/clear actions wired to the control panel.
 *
 * Extracted wholesale out of main.ts so the entry point can stay a thin
 * wiring layer. The public surface mirrors the original call sites so
 * behavior is unchanged:
 *  - beginFrame() at the top of the RAF loop (frame-gap classification,
 *    capture-enable transition bookkeeping, rolling frame-duration
 *    sampling once warmed up),
 *  - captureRecord()/recordPhases() after the frame's work is measured,
 *  - syncOverlay() to refresh the on-screen overlay,
 *  - downloadDiagnostics()/clearRecords() for the control panel buttons.
 */
export class Diagnostics {
  private readonly sim: Simulation;
  private readonly panel: DiagnosticsPanel;

  private readonly frameDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private readonly simDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private readonly uiDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private readonly renderDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private readonly postDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private readonly unaccountedDurationsMs = new Array<number>(FRAME_STATS_WINDOW);
  private frameDurationsCount = 0;
  private frameDurationsCursor = 0;
  private frameDurationsSum = 0;
  private simDurationsSum = 0;
  private uiDurationsSum = 0;
  private renderDurationsSum = 0;
  private postDurationsSum = 0;
  private unaccountedDurationsSum = 0;
  private statsCaptureStartedAt = performance.now();

  private readonly diagnosticRecords = new Array<DiagnosticRecord>(DIAGNOSTIC_LOG_MAX_ENTRIES);
  private readonly diagnosticRuntimeEvents = new Array<DiagnosticRuntimeEventRecord>(DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES);
  private diagnosticCount = 0;
  private diagnosticCursor = 0;
  private diagnosticRuntimeEventCount = 0;
  private diagnosticRuntimeEventCursor = 0;
  private lastDiagnosticSampleAt = performance.now();
  private diagnosticsCaptureEnabledLastFrame = false;
  private diagnosticsCaptureStartedAt: number | null = null;
  private diagnosticsLongTaskSupported = false;
  private diagnosticsGcSupported = false;
  private diagnosticsLongTaskObservedCount = 0;
  private diagnosticsGcObservedCount = 0;
  private lastFrameGapClass: FrameGapClass = 'steady';
  private readonly diagnosticPerformanceObservers: PerformanceObserver[] = [];

  constructor(sim: Simulation, host: HTMLElement) {
    this.sim = sim;
    this.panel = new DiagnosticsPanel(host);
    this.setupRuntimeDiagnosticsObservers();
  }

  private classifyFrameGap(frameMs: number): FrameGapClass {
    if (frameMs >= FRAME_GAP_STALLED_MS) return 'stalled';
    if (frameMs >= FRAME_GAP_ELEVATED_MS) return 'elevated';
    return 'steady';
  }

  private formatTraceElapsed(now: number): string {
    if (!params.enableDiagnosticsCapture || this.diagnosticsCaptureStartedAt === null) return 'off';
    const seconds = Math.max(0, (now - this.diagnosticsCaptureStartedAt) / 1000);
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remSeconds = totalSeconds % 60;
    return `${minutes}:${String(remSeconds).padStart(2, '0')}`;
  }

  private appendDiagnosticRuntimeEvent(record: DiagnosticRuntimeEventRecord): void {
    if (!params.enableDiagnosticsCapture) return;
    if (this.diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES) {
      this.diagnosticRuntimeEvents[this.diagnosticRuntimeEventCount++] = record;
      return;
    }
    this.diagnosticRuntimeEvents[this.diagnosticRuntimeEventCursor] = record;
    this.diagnosticRuntimeEventCursor = (this.diagnosticRuntimeEventCursor + 1) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES;
  }

  private getDiagnosticRuntimeEventsOrdered(): DiagnosticRuntimeEventRecord[] {
    if (this.diagnosticRuntimeEventCount === 0) return [];
    if (this.diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES) {
      return this.diagnosticRuntimeEvents.slice(0, this.diagnosticRuntimeEventCount);
    }
    const ordered = new Array<DiagnosticRuntimeEventRecord>(DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES);
    for (let i = 0; i < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES; i++) {
      ordered[i] = this.diagnosticRuntimeEvents[(this.diagnosticRuntimeEventCursor + i) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES];
    }
    return ordered;
  }

  private getRuntimeWindowStats(now: number, windowMs: number): RuntimeWindowStats {
    const cutoff = now - windowMs;
    const stats: RuntimeWindowStats = { longTaskMs: 0, longTaskCount: 0, gcMs: 0, gcCount: 0 };
    for (let i = 0; i < this.diagnosticRuntimeEventCount; i++) {
      const idx =
        this.diagnosticRuntimeEventCount < DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES
          ? i
          : (this.diagnosticRuntimeEventCursor + i) % DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES;
      const event = this.diagnosticRuntimeEvents[idx];
      if (!event || event.tsMs < cutoff) continue;
      if (event.kind === 'longtask') {
        stats.longTaskCount++;
        stats.longTaskMs += event.durationMs;
      } else if (event.kind === 'gc') {
        stats.gcCount++;
        stats.gcMs += event.durationMs;
      }
    }
    return stats;
  }

  private getHeapSnapshotMb(): HeapSnapshotMb {
    const perf = performance as PerformanceWithMemory;
    const memory = perf.memory;
    if (!memory) return { usedMB: null, totalMB: null, limitMB: null };
    const mb = 1024 * 1024;
    return {
      usedMB: memory.usedJSHeapSize / mb,
      totalMB: memory.totalJSHeapSize / mb,
      limitMB: memory.jsHeapSizeLimit / mb,
    };
  }

  private setupRuntimeDiagnosticsObservers(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    const supportedTypes = Array.isArray(PerformanceObserver.supportedEntryTypes) ? PerformanceObserver.supportedEntryTypes : [];
    this.diagnosticsLongTaskSupported = supportedTypes.includes('longtask');
    this.diagnosticsGcSupported = supportedTypes.includes('gc');

    if (this.diagnosticsLongTaskSupported) {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!params.enableDiagnosticsCapture) continue;
          this.diagnosticsLongTaskObservedCount++;
          this.appendDiagnosticRuntimeEvent({
            kind: 'longtask',
            tsMs: entry.startTime + entry.duration,
            durationMs: entry.duration,
            visibility: null,
            hasFocus: null,
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      this.diagnosticPerformanceObservers.push(longTaskObserver);
    }

    if (this.diagnosticsGcSupported) {
      const gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!params.enableDiagnosticsCapture) continue;
          this.diagnosticsGcObservedCount++;
          this.appendDiagnosticRuntimeEvent({
            kind: 'gc',
            tsMs: entry.startTime + entry.duration,
            durationMs: entry.duration,
            visibility: null,
            hasFocus: null,
          });
        }
      });
      gcObserver.observe({ entryTypes: ['gc'] });
      this.diagnosticPerformanceObservers.push(gcObserver);
    }

    const recordVisibilityChange = (): void => {
      this.appendDiagnosticRuntimeEvent({
        kind: 'visibility',
        tsMs: performance.now(),
        durationMs: 0,
        visibility: document.visibilityState,
        hasFocus: null,
      });
    };
    const recordFocusChange = (hasFocus: boolean): void => {
      this.appendDiagnosticRuntimeEvent({
        kind: 'focus',
        tsMs: performance.now(),
        durationMs: 0,
        visibility: null,
        hasFocus,
      });
    };
    document.addEventListener('visibilitychange', recordVisibilityChange);
    window.addEventListener('focus', () => recordFocusChange(true));
    window.addEventListener('blur', () => recordFocusChange(false));
    recordVisibilityChange();
    recordFocusChange(document.hasFocus());
  }

  private recordFrameDuration(frameMs: number): void {
    const clamped = Math.max(0, frameMs);
    if (this.frameDurationsCount < FRAME_STATS_WINDOW) {
      this.frameDurationsMs[this.frameDurationsCount++] = clamped;
      this.frameDurationsSum += clamped;
      return;
    }
    const old = this.frameDurationsMs[this.frameDurationsCursor];
    this.frameDurationsSum += clamped - old;
    this.frameDurationsMs[this.frameDurationsCursor] = clamped;
    this.frameDurationsCursor = (this.frameDurationsCursor + 1) % FRAME_STATS_WINDOW;
  }

  private resetFrameStats(now: number): void {
    this.frameDurationsCount = 0;
    this.frameDurationsCursor = 0;
    this.frameDurationsSum = 0;
    this.simDurationsSum = 0;
    this.uiDurationsSum = 0;
    this.renderDurationsSum = 0;
    this.postDurationsSum = 0;
    this.unaccountedDurationsSum = 0;
    this.statsCaptureStartedAt = now;
  }

  private appendDiagnosticRecord(record: DiagnosticRecord): void {
    if (this.diagnosticCount < DIAGNOSTIC_LOG_MAX_ENTRIES) {
      this.diagnosticRecords[this.diagnosticCount++] = record;
      return;
    }
    this.diagnosticRecords[this.diagnosticCursor] = record;
    this.diagnosticCursor = (this.diagnosticCursor + 1) % DIAGNOSTIC_LOG_MAX_ENTRIES;
  }

  private getDiagnosticRecordsOrdered(): DiagnosticRecord[] {
    if (this.diagnosticCount === 0) return [];
    if (this.diagnosticCount < DIAGNOSTIC_LOG_MAX_ENTRIES) return this.diagnosticRecords.slice(0, this.diagnosticCount);
    const ordered = new Array<DiagnosticRecord>(DIAGNOSTIC_LOG_MAX_ENTRIES);
    for (let i = 0; i < DIAGNOSTIC_LOG_MAX_ENTRIES; i++) {
      ordered[i] = this.diagnosticRecords[(this.diagnosticCursor + i) % DIAGNOSTIC_LOG_MAX_ENTRIES];
    }
    return ordered;
  }

  clearRecords(): number {
    const cleared = this.diagnosticCount + this.diagnosticRuntimeEventCount;
    this.diagnosticCount = 0;
    this.diagnosticCursor = 0;
    this.diagnosticRuntimeEventCount = 0;
    this.diagnosticRuntimeEventCursor = 0;
    this.diagnosticsLongTaskObservedCount = 0;
    this.diagnosticsGcObservedCount = 0;
    return cleared;
  }

  downloadDiagnostics(): 'downloaded' | 'no_data' | 'error' {
    const records = this.getDiagnosticRecordsOrdered();
    if (records.length === 0) return 'no_data';
    try {
      const payload = {
        meta: {
          version: 2,
          exportedAt: new Date().toISOString(),
          maxEntries: DIAGNOSTIC_LOG_MAX_ENTRIES,
          maxRuntimeEntries: DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES,
          sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
          spikeThresholdMs: DIAGNOSTIC_SPIKE_THRESHOLD_MS,
          runtimeWindowMs: DIAGNOSTIC_RUNTIME_WINDOW_MS,
          frameGapElevatedMs: FRAME_GAP_ELEVATED_MS,
          frameGapStalledMs: FRAME_GAP_STALLED_MS,
          supportsLongTaskObserver: this.diagnosticsLongTaskSupported,
          supportsGcObserver: this.diagnosticsGcSupported,
          observedLongTaskCount: this.diagnosticsLongTaskObservedCount,
          observedGcCount: this.diagnosticsGcObservedCount,
        },
        records,
        runtimeEvents: this.getDiagnosticRuntimeEventsOrdered(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aiboids-diagnostics-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return 'downloaded';
    } catch {
      return 'error';
    }
  }

  private recordPhaseDuration(kind: 'sim' | 'ui' | 'render' | 'post', valueMs: number): void {
    if (this.frameDurationsCount === 0) return;
    const idx = this.frameDurationsCount < FRAME_STATS_WINDOW ? this.frameDurationsCount - 1 : (this.frameDurationsCursor + FRAME_STATS_WINDOW - 1) % FRAME_STATS_WINDOW;
    const clamped = Math.max(0, valueMs);
    if (kind === 'sim') {
      const old = this.simDurationsMs[idx] ?? 0;
      this.simDurationsMs[idx] = clamped;
      this.simDurationsSum += clamped - old;
      return;
    }
    if (kind === 'ui') {
      const old = this.uiDurationsMs[idx] ?? 0;
      this.uiDurationsMs[idx] = clamped;
      this.uiDurationsSum += clamped - old;
      return;
    }
    if (kind === 'render') {
      const old = this.renderDurationsMs[idx] ?? 0;
      this.renderDurationsMs[idx] = clamped;
      this.renderDurationsSum += clamped - old;
      return;
    }
    const old = this.postDurationsMs[idx] ?? 0;
    this.postDurationsMs[idx] = clamped;
    this.postDurationsSum += clamped - old;
  }

  private recordUnaccountedDuration(valueMs: number): void {
    if (this.frameDurationsCount === 0) return;
    const idx = this.frameDurationsCount < FRAME_STATS_WINDOW ? this.frameDurationsCount - 1 : (this.frameDurationsCursor + FRAME_STATS_WINDOW - 1) % FRAME_STATS_WINDOW;
    const clamped = Math.max(0, valueMs);
    const old = this.unaccountedDurationsMs[idx] ?? 0;
    this.unaccountedDurationsMs[idx] = clamped;
    this.unaccountedDurationsSum += clamped - old;
  }

  private captureDiagnosticRecord(
    now: number,
    frameMs: number,
    simMs: number,
    uiMs: number,
    renderMs: number,
    postMs: number,
    unaccountedMs: number,
  ): void {
    if (!params.enableDiagnosticsCapture) return;
    const isSpike = frameMs >= DIAGNOSTIC_SPIKE_THRESHOLD_MS;
    const shouldSample = now - this.lastDiagnosticSampleAt >= DIAGNOSTIC_SAMPLE_INTERVAL_MS;
    if (!isSpike && !shouldSample) return;
    if (shouldSample) this.lastDiagnosticSampleAt = now;
    const runtimeWindow = this.getRuntimeWindowStats(now, DIAGNOSTIC_RUNTIME_WINDOW_MS);
    const heapSnapshot = this.getHeapSnapshotMb();
    const visibility = document.visibilityState;
    const hasFocus = document.hasFocus();
    const frameGapClass = this.classifyFrameGap(frameMs);
    this.appendDiagnosticRecord({
      event: isSpike ? 'spike' : 'sample',
      tsMs: now,
      frameMs,
      frameGapClass,
      simMs,
      uiMs,
      renderMs,
      postMs,
      unaccountedMs,
      recentLongTaskMs: runtimeWindow.longTaskMs,
      recentLongTaskCount: runtimeWindow.longTaskCount,
      recentGcMs: runtimeWindow.gcMs,
      recentGcCount: runtimeWindow.gcCount,
      visibility,
      hasFocus,
      jsHeapUsedMB: heapSnapshot.usedMB,
      jsHeapTotalMB: heapSnapshot.totalMB,
      jsHeapLimitMB: heapSnapshot.limitMB,
      boids: this.sim.boids.length,
      predators: this.sim.predators.length,
      ufos: this.sim.ufos.length,
      mode: params.mode,
      visualStyle: params.mode === '3d' ? params.visualStyle : null,
    });
  }

  private getFramePercentile(percentile: number): number {
    if (this.frameDurationsCount === 0) return 0;
    const sorted = this.frameDurationsMs.slice(0, this.frameDurationsCount).sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
    return sorted[index];
  }

  private getRollingPeakFrameMs(): number {
    let peak = 0;
    for (let i = 0; i < this.frameDurationsCount; i++) {
      if (this.frameDurationsMs[i] > peak) peak = this.frameDurationsMs[i];
    }
    return peak;
  }

  private getAverage(valuesSum: number): number {
    if (this.frameDurationsCount === 0) return 0;
    return valuesSum / this.frameDurationsCount;
  }

  private getPeak(values: number[]): number {
    let peak = 0;
    for (let i = 0; i < this.frameDurationsCount; i++) {
      if ((values[i] ?? 0) > peak) peak = values[i];
    }
    return peak;
  }

  /**
   * Top-of-frame bookkeeping: classify the raw frame gap (for the
   * overlay's page/gap line), handle the diagnostics-capture enable/
   * disable transition (trace start marker + seeded runtime events), and
   * sample the rolling frame duration once past the warmup window while
   * the rendering-stats overlay is showing.
   */
  beginFrame(now: number, rawFrameMs: number): void {
    this.lastFrameGapClass = this.classifyFrameGap(rawFrameMs);
    if (params.enableDiagnosticsCapture !== this.diagnosticsCaptureEnabledLastFrame) {
      this.diagnosticsCaptureEnabledLastFrame = params.enableDiagnosticsCapture;
      if (params.enableDiagnosticsCapture) {
        this.diagnosticsCaptureStartedAt = now;
        this.lastDiagnosticSampleAt = now - DIAGNOSTIC_SAMPLE_INTERVAL_MS;
        this.appendDiagnosticRuntimeEvent({
          kind: 'visibility',
          tsMs: now,
          durationMs: 0,
          visibility: document.visibilityState,
          hasFocus: null,
        });
        this.appendDiagnosticRuntimeEvent({
          kind: 'focus',
          tsMs: now,
          durationMs: 0,
          visibility: null,
          hasFocus: document.hasFocus(),
        });
      } else {
        this.diagnosticsCaptureStartedAt = null;
      }
    }
    if (params.showRenderingStats && now - this.statsCaptureStartedAt >= FRAME_STATS_WARMUP_MS) {
      this.recordFrameDuration(rawFrameMs);
    }
  }

  /**
   * Records the per-phase (sim/ui/render/post/unaccounted) millisecond
   * breakdown for the frame just measured. No-op until the rendering-stats
   * overlay is showing and past its warmup window, matching beginFrame's
   * frame-duration sampling so the phase series stays aligned with the
   * frame series.
   */
  recordPhases(now: number, simMs: number, uiMs: number, renderMs: number, postMs: number, unaccountedMs: number): void {
    if (!(params.showRenderingStats && now - this.statsCaptureStartedAt >= FRAME_STATS_WARMUP_MS)) return;
    this.recordPhaseDuration('sim', simMs);
    this.recordPhaseDuration('ui', uiMs);
    this.recordPhaseDuration('render', renderMs);
    this.recordPhaseDuration('post', postMs);
    this.recordUnaccountedDuration(unaccountedMs);
  }

  /** Captures a trace record (spike or interval sample) when diagnostics capture is enabled. */
  captureRecord(
    now: number,
    frameMs: number,
    simMs: number,
    uiMs: number,
    renderMs: number,
    postMs: number,
    unaccountedMs: number,
  ): void {
    this.captureDiagnosticRecord(now, frameMs, simMs, uiMs, renderMs, postMs, unaccountedMs);
  }

  /** Shows/hides and refreshes the on-screen "Rendering stats" overlay. */
  syncOverlay(now: number): void {
    if (!params.showRenderingStats) {
      this.panel.hide();
      return;
    }
    this.panel.show(now, () => this.resetFrameStats(now), () => this.buildOverlayText(now));
  }

  private buildOverlayText(now: number): string {
    const warmupRemainingMs = Math.max(0, FRAME_STATS_WARMUP_MS - (now - this.statsCaptureStartedAt));
    if (warmupRemainingMs > 0) {
      return [
        'Rendering stats',
        `mode: ${params.mode}${params.mode === '3d' ? ` (${params.visualStyle})` : ''}`,
        `warming up: ${(warmupRemainingMs / 1000).toFixed(1)}s`,
        `trace active: ${this.formatTraceElapsed(now)}`,
        `diagnostics: ${params.enableDiagnosticsCapture ? 'on' : 'off'} (frames ${this.diagnosticCount}/${DIAGNOSTIC_LOG_MAX_ENTRIES}, runtime ${this.diagnosticRuntimeEventCount}/${DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES})`,
      ].join('\n');
    }

    const averageFrameMs = this.frameDurationsCount > 0 ? this.frameDurationsSum / this.frameDurationsCount : 0;
    const averageFps = averageFrameMs > 1e-6 ? 1000 / averageFrameMs : 0;
    const p95FrameMs = this.getFramePercentile(0.95);
    const rollingPeakFrameMs = this.getRollingPeakFrameMs();
    const simAvgMs = this.getAverage(this.simDurationsSum);
    const uiAvgMs = this.getAverage(this.uiDurationsSum);
    const renderAvgMs = this.getAverage(this.renderDurationsSum);
    const postAvgMs = this.getAverage(this.postDurationsSum);
    const unaccountedAvgMs = this.getAverage(this.unaccountedDurationsSum);
    const simPeakMs = this.getPeak(this.simDurationsMs);
    const uiPeakMs = this.getPeak(this.uiDurationsMs);
    const renderPeakMs = this.getPeak(this.renderDurationsMs);
    const postPeakMs = this.getPeak(this.postDurationsMs);
    const unaccountedPeakMs = this.getPeak(this.unaccountedDurationsMs);
    const totalAgents = this.sim.boids.length + this.sim.predators.length + this.sim.ufos.length;
    const runtimeWindow = this.getRuntimeWindowStats(now, DIAGNOSTIC_RUNTIME_WINDOW_MS);
    const focusState = document.hasFocus() ? 'focused' : 'blurred';

    return [
      'Rendering stats',
      `mode: ${params.mode}${params.mode === '3d' ? ` (${params.visualStyle})` : ''}`,
      `frame ms: avg ${averageFrameMs.toFixed(2)} | p95 ${p95FrameMs.toFixed(2)} | peak ${rollingPeakFrameMs.toFixed(2)}`,
      `fps: ${averageFps.toFixed(1)}`,
      `phase avg ms: sim ${simAvgMs.toFixed(2)} | render ${renderAvgMs.toFixed(2)} | ui ${uiAvgMs.toFixed(2)} | post ${postAvgMs.toFixed(2)}`,
      `phase peak ms: sim ${simPeakMs.toFixed(2)} | render ${renderPeakMs.toFixed(2)} | ui ${uiPeakMs.toFixed(2)} | post ${postPeakMs.toFixed(2)}`,
      `unaccounted ms: avg ${unaccountedAvgMs.toFixed(2)} | peak ${unaccountedPeakMs.toFixed(2)}`,
      `runtime (${DIAGNOSTIC_RUNTIME_WINDOW_MS}ms): longtask ${runtimeWindow.longTaskCount}/${runtimeWindow.longTaskMs.toFixed(2)}ms | gc ${runtimeWindow.gcCount}/${runtimeWindow.gcMs.toFixed(2)}ms`,
      `page: ${document.visibilityState} | ${focusState} | gap ${this.lastFrameGapClass}`,
      `trace active: ${this.formatTraceElapsed(now)}`,
      `diagnostics: ${params.enableDiagnosticsCapture ? 'on' : 'off'} (frames ${this.diagnosticCount}/${DIAGNOSTIC_LOG_MAX_ENTRIES}, runtime ${this.diagnosticRuntimeEventCount}/${DIAGNOSTIC_RUNTIME_EVENT_MAX_ENTRIES})`,
      `entities: boids ${this.sim.boids.length} | predators ${this.sim.predators.length} | ufos ${this.sim.ufos.length} | total ${totalAgents}`,
    ].join('\n');
  }
}

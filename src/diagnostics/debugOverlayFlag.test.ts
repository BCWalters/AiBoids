import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The module reads `window.location.search` at call time, so each case just
 * stubs the location and re-imports nothing — the function is pure w.r.t. the
 * current URL.
 */
async function readWithSearch(search: string) {
  vi.stubGlobal('window', { location: { search } });
  const { readDebugOverlayOverride } = await import('./debugOverlayFlag');
  return readDebugOverlayOverride();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readDebugOverlayOverride', () => {
  it('turns the overlay on for ?debug=1', async () => {
    expect(await readWithSearch('?debug=1')).toBe(true);
  });

  it('turns the overlay off for ?debug=0', async () => {
    // Distinct from "absent": ?debug=0 must be able to beat a stored default
    // that had it on, otherwise the flag is only half a switch.
    expect(await readWithSearch('?debug=0')).toBe(false);
  });

  it('declines to decide when the param is absent', async () => {
    expect(await readWithSearch('')).toBeNull();
    expect(await readWithSearch('?lowfx=1')).toBeNull();
  });

  it('declines to decide for values that are not 0 or 1', async () => {
    // Guards against a truthiness shortcut: `debug=false` and `debug=off` read
    // as "on" under `Boolean(value)`, which is the opposite of the intent.
    for (const search of ['?debug=', '?debug=false', '?debug=off', '?debug=true', '?debug=yes']) {
      expect.soft(await readWithSearch(search), search).toBeNull();
    }
  });

  it('survives an unreadable location rather than breaking startup', async () => {
    vi.stubGlobal('window', {
      get location(): never {
        throw new Error('cross-origin');
      },
    });
    const { readDebugOverlayOverride } = await import('./debugOverlayFlag');
    expect(readDebugOverlayOverride()).toBeNull();
  });
});

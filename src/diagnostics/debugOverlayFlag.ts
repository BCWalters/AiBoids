/**
 * `?debug=1` / `?debug=0` — start with the rendering-stats overlay on or off.
 *
 * The overlay is otherwise only reachable through a checkbox in the control
 * panel's Diagnostics section. That is easy enough to find, but a URL flag
 * makes the overlay something you can put in a link and send to a device,
 * which is the case that matters when the question is "what is this phone
 * actually doing?".
 *
 * Only an override: returning null leaves the stored default untouched.
 */
export function readDebugOverlayOverride(): boolean | null {
  try {
    const value = new URLSearchParams(window.location.search).get('debug');
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

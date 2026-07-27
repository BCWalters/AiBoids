import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createColorGradingPass,
  applyColorGradingPreset,
  COLOR_GRADING_PRESETS,
  type ColorGradingPreset,
} from './colorGradingPass';

// ---------------------------------------------------------------------------
// COLOR_GRADING_PRESETS — completeness and value-range checks
// ---------------------------------------------------------------------------

describe('COLOR_GRADING_PRESETS', () => {
  it('defines a preset for every visual style', () => {
    const styles: Array<keyof typeof COLOR_GRADING_PRESETS> = ['arcade', 'nature', 'fishtank'];
    for (const style of styles) {
      expect(COLOR_GRADING_PRESETS).toHaveProperty(style);
    }
  });

  it.each(Object.entries(COLOR_GRADING_PRESETS))(
    '%s preset has valid, display-referred ranges',
    (_style, preset: ColorGradingPreset) => {
      // contrast and saturation must be positive multipliers
      expect(preset.contrast).toBeGreaterThan(0);
      expect(preset.saturation).toBeGreaterThan(0);

      // lift is a small additive shadow offset — keep it gentle
      expect(Math.abs(preset.lift.x)).toBeLessThan(0.1);
      expect(Math.abs(preset.lift.y)).toBeLessThan(0.1);
      expect(Math.abs(preset.lift.z)).toBeLessThan(0.1);

      // gamma and gain should stay near 1.0 to avoid extreme tone shifts
      for (const component of ['x', 'y', 'z'] as const) {
        expect(preset.gamma[component]).toBeGreaterThan(0.5);
        expect(preset.gamma[component]).toBeLessThan(2.0);
        expect(preset.gain[component]).toBeGreaterThan(0.5);
        expect(preset.gain[component]).toBeLessThan(2.0);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// createColorGradingPass — disabled by default, correct uniform defaults
// ---------------------------------------------------------------------------

describe('createColorGradingPass', () => {
  it('returns a pass that is disabled by default', () => {
    const pass = createColorGradingPass();
    // Pass must be off until params.colorGradingEnabled = true so the image
    // is visually identical to the ungraded output when the feature is off.
    expect(pass.enabled).toBe(false);
  });

  it('exposes all required uniforms', () => {
    const pass = createColorGradingPass();
    for (const name of ['contrast', 'saturation', 'lift', 'gamma', 'gain']) {
      expect(pass.uniforms).toHaveProperty(name);
    }
  });

  it('default uniforms are identity (no grading applied)', () => {
    const pass = createColorGradingPass();
    // Neutral values: contrast=1, saturation=1, lift=0,0,0, gamma=1,1,1, gain=1,1,1
    expect(pass.uniforms['contrast'].value).toBe(1.0);
    expect(pass.uniforms['saturation'].value).toBe(1.0);

    const lift = pass.uniforms['lift'].value as THREE.Vector3;
    expect(lift.x).toBe(0.0);
    expect(lift.y).toBe(0.0);
    expect(lift.z).toBe(0.0);

    const gamma = pass.uniforms['gamma'].value as THREE.Vector3;
    expect(gamma.x).toBe(1.0);
    expect(gamma.y).toBe(1.0);
    expect(gamma.z).toBe(1.0);

    const gain = pass.uniforms['gain'].value as THREE.Vector3;
    expect(gain.x).toBe(1.0);
    expect(gain.y).toBe(1.0);
    expect(gain.z).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// applyColorGradingPreset — uniform propagation
// ---------------------------------------------------------------------------

describe('applyColorGradingPreset', () => {
  it('copies scalar values (contrast, saturation) into pass uniforms', () => {
    const pass = createColorGradingPass();
    const preset = COLOR_GRADING_PRESETS.arcade;
    applyColorGradingPreset(pass, preset);

    expect(pass.uniforms['contrast'].value).toBe(preset.contrast);
    expect(pass.uniforms['saturation'].value).toBe(preset.saturation);
  });

  it('copies vector values (lift, gamma, gain) into pass uniforms', () => {
    const pass = createColorGradingPass();
    const preset = COLOR_GRADING_PRESETS.nature;
    applyColorGradingPreset(pass, preset);

    const lift = pass.uniforms['lift'].value as THREE.Vector3;
    expect(lift.x).toBeCloseTo(preset.lift.x);
    expect(lift.y).toBeCloseTo(preset.lift.y);
    expect(lift.z).toBeCloseTo(preset.lift.z);

    const gamma = pass.uniforms['gamma'].value as THREE.Vector3;
    expect(gamma.x).toBeCloseTo(preset.gamma.x);
    expect(gamma.y).toBeCloseTo(preset.gamma.y);
    expect(gamma.z).toBeCloseTo(preset.gamma.z);

    const gain = pass.uniforms['gain'].value as THREE.Vector3;
    expect(gain.x).toBeCloseTo(preset.gain.x);
    expect(gain.y).toBeCloseTo(preset.gain.y);
    expect(gain.z).toBeCloseTo(preset.gain.z);
  });

  it('correctly applies each visual style preset without error', () => {
    const pass = createColorGradingPass();
    for (const [, preset] of Object.entries(COLOR_GRADING_PRESETS)) {
      expect(() => applyColorGradingPreset(pass, preset)).not.toThrow();
      expect(pass.uniforms['contrast'].value).toBe(preset.contrast);
    }
  });
});

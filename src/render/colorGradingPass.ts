/**
 * Filmic color grading post-processing pass.
 *
 * Implements a contrast / saturation / lift-gamma-gain shader as a ShaderPass
 * that can be inserted into the EffectComposer chain after tone mapping. Each
 * visual style has a tasteful preset; when the pass is disabled
 * (colorGradingEnabled = false) the image is visually identical to the
 * ungraded output.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { VisualStyle } from '../sim/params';

/** Per-channel lift-gamma-gain + contrast/saturation uniforms. */
export interface ColorGradingPreset {
  /** Contrast multiplier around mid-grey (1.0 = unchanged). */
  contrast: number;
  /** Saturation multiplier (1.0 = unchanged, 0 = greyscale). */
  saturation: number;
  /** Per-channel additive shadow lift (shifts dark tones; neutral = 0,0,0). */
  lift: THREE.Vector3;
  /** Per-channel midtone gamma (>1 brightens; neutral = 1,1,1). */
  gamma: THREE.Vector3;
  /** Per-channel highlight gain (>1 boosts; neutral = 1,1,1). */
  gain: THREE.Vector3;
}

/** Tasteful per-style defaults. All values stay close to neutral so the
 *  graded result enhances rather than dramatically alters each scene. */
export const COLOR_GRADING_PRESETS: Record<VisualStyle, ColorGradingPreset> = {
  arcade: {
    // Punchy neon aesthetic: slightly higher contrast, tiny cool-teal bias in
    // highlights to complement the existing neon palette.
    contrast: 1.10,
    saturation: 0.95,
    lift: new THREE.Vector3(0.0, 0.0, 0.012),
    gamma: new THREE.Vector3(1.0, 1.0, 1.0),
    gain: new THREE.Vector3(1.0, 1.02, 1.08),
  },
  nature: {
    // Warm/natural look: gentle saturation boost, warm shadow lift, slightly
    // golden highlights to evoke dappled sunlight.
    contrast: 1.05,
    saturation: 1.08,
    lift: new THREE.Vector3(0.005, 0.003, 0.0),
    gamma: new THREE.Vector3(1.01, 1.0, 0.99),
    gain: new THREE.Vector3(1.06, 1.02, 0.95),
  },
  fishtank: {
    // Cool/underwater aesthetic: slight desaturation for murky-water feel,
    // teal-shifted shadows and highlights.
    contrast: 1.03,
    saturation: 0.88,
    lift: new THREE.Vector3(0.0, 0.007, 0.018),
    gamma: new THREE.Vector3(0.98, 1.0, 1.02),
    gain: new THREE.Vector3(0.95, 1.0, 1.07),
  },
};

const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1.0 },
    saturation: { value: 1.0 },
    lift: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    gamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    gain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 color = tex.rgb;

      // --- Contrast (S-curve pivot at 0.5) ---
      color = (color - 0.5) * contrast + 0.5;
      // --- Saturation via luminance ---
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);

      // --- Lift / Gamma / Gain ---
      // gain scales highlights, lift shifts shadows
      color = color * gain + lift;
      color = max(color, vec3(0.0));
      // per-channel gamma (exponent = 1/gamma so >1 brightens midtones)
      color = vec3(
        pow(color.r, 1.0 / max(gamma.r, 0.001)),
        pow(color.g, 1.0 / max(gamma.g, 0.001)),
        pow(color.b, 1.0 / max(gamma.b, 0.001))
      );

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), tex.a);
    }
  `,
};

/** Create a new color grading ShaderPass (disabled by default). */
export function createColorGradingPass(): ShaderPass {
  const pass = new ShaderPass(ColorGradingShader);
  pass.enabled = false;
  return pass;
}

/**
 * Copy a preset's values into the live pass uniforms.
 * Safe to call every frame since it only updates numbers/Vector3s.
 */
export function applyColorGradingPreset(pass: ShaderPass, preset: ColorGradingPreset): void {
  pass.uniforms['contrast'].value = preset.contrast;
  pass.uniforms['saturation'].value = preset.saturation;
  (pass.uniforms['lift'].value as THREE.Vector3).copy(preset.lift);
  (pass.uniforms['gamma'].value as THREE.Vector3).copy(preset.gamma);
  (pass.uniforms['gain'].value as THREE.Vector3).copy(preset.gain);
}

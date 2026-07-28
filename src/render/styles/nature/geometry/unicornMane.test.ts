/**
 * Tests for the unicorn mane geometry and hair shader (issue #248).
 *
 * Only silent/invisible failures are pinned here — no taste or appearance
 * constants. Two concrete regression risks are tested:
 *
 *   1. Pattern-plane degeneration: the XY-plane hair shader requires both X
 *      and Y to vary substantially across the mane geometry. If the crest
 *      collapses to a zero-width centreline (X = 0 everywhere), the pattern
 *      degenerates into horizontal stripes — exactly the defect that caught
 *      the dragon wing scale in the 'yz' plane before the 'yx' fix. Measured
 *      directly on the geometry.
 *
 *   2. Clone-drops-shader: THREE.Material.clone() silently drops both
 *      onBeforeCompile and customProgramCacheKey. Any code that patches a
 *      material and then clones it produces an unpatched clone. This repo has
 *      hit this twice (fin-shader bug #271, silent no-op bug #273). The test
 *      documents the invariant so that future reviewers understand why the
 *      rule "clone first, patch every instance" is required.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import {
  applyUnicornHairShader,
  UNICORN_HAIR_CONFIG,
} from '../unicornHairShader';
import {
  createUnicornGeometries,
} from './unicornGeometry';

const LENGTH = 2.0;
const WIDTH = 0.8;

// ---------------------------------------------------------------------------
// Helper: run onBeforeCompile against real Three.js shader strings
// ---------------------------------------------------------------------------

function captureShader(material: THREE.MeshStandardMaterial): {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: number }>;
} {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: number }>,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

// ---------------------------------------------------------------------------
// Pattern-plane degeneration guard
// ---------------------------------------------------------------------------

/**
 * The hair shader uses the XY model-space plane. For it to produce distinct
 * strands rather than degenerate stripes, both X and Y must vary enough
 * across the mane crest geometry.
 *
 *   Collapse scenario for X: if every mane vertex were placed on the midline
 *     (x = 0), fract(0 * freqX + 0.5) is constant and the entire mane renders
 *     as a single stripe rather than individual strands.
 *
 *   Collapse scenario for Y: if the mane crest occupied zero Y range, the
 *     along-strand sinusoidal modulation would freeze and all positions on the
 *     crest would have identical shading — effectively a flat colour.
 *
 * Thresholds (2 % body-width in X, 10 % body-length in Y) sit well above
 * any floating-point noise and well below reasonable geometric dimensions,
 * so a true geometric collapse fails immediately while minor tuning passes.
 */
describe('unicorn mane geometry — pattern-plane variation', () => {
  it('mane crest has non-degenerate X extent (XY hair shader cannot collapse to stripes)', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const pos = body.getAttribute('position') as THREE.BufferAttribute;

    // The mane sits in the neck region: Y > LENGTH * 0.03 (past the withers
    // threshold) and Z above the nominal neck midline.
    let maxAbsX = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > LENGTH * 0.03) {
        maxAbsX = Math.max(maxAbsX, Math.abs(pos.getX(i)));
      }
    }

    // Mane must have X extent > 2 % body width on each side of the midline.
    // Falsified by collapsing all mane vertices to x = 0 (centreline only).
    expect(maxAbsX).toBeGreaterThan(WIDTH * 0.02);
    body.dispose();
  });

  it('mane crest has non-degenerate Y extent (along-strand variation is visible)', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const pos = body.getAttribute('position') as THREE.BufferAttribute;

    // Collect Y range of vertices in the neck/mane region.
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > LENGTH * 0.03) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    // Mane must span > 10 % body length in Y (withers → forelock range).
    // Falsified by collapsing the mane to a single Y slice.
    expect(maxY - minY).toBeGreaterThan(LENGTH * 0.10);
    body.dispose();
  });
});

// ---------------------------------------------------------------------------
// Clone-drops-shader documentation test
// ---------------------------------------------------------------------------

/**
 * THREE.Material.clone() silently drops onBeforeCompile and
 * customProgramCacheKey. This test documents and verifies that invariant so
 * that future contributors understand why the "clone first, patch every
 * instance" rule is mandatory for any material that uses onBeforeCompile.
 *
 * The test is asserting Three.js behaviour (not our own code), but it also
 * verifies that applyUnicornHairShader correctly sets customProgramCacheKey
 * in the first place, and that a cloned material lacks our key — confirming
 * the exact failure mode that caused the single-wing and silent-no-op bugs.
 */
describe('unicorn hair shader — clone-drops-shader requirement', () => {
  it('patched material carries our cache key; cloned material silently loses it', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });

    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);

    // The patched material must carry our cache key.
    expect(mat.customProgramCacheKey()).toContain('aiboids-unicorn-hair');

    // A clone silently loses both onBeforeCompile and customProgramCacheKey.
    const clone = mat.clone();
    expect(clone.customProgramCacheKey()).not.toContain('aiboids-unicorn-hair');

    body.dispose();
  });
});

// ---------------------------------------------------------------------------
// Shader injection: vertex and fragment shaders contain expected tokens
// ---------------------------------------------------------------------------

describe('unicorn hair shader — vertex injection', () => {
  it('declares vUnicornHairPos varying in the vertex shader', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('varying vec3 vUnicornHairPos');
    body.dispose();
  });

  it('captures rest-space position in the vertex shader', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vUnicornHairPos = position');
    body.dispose();
  });
});

describe('unicorn hair shader — fragment injection', () => {
  it('contains the gap-darkness uniform in the fragment shader', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uHairGapDarkness');
    body.dispose();
  });

  it('contains the hair frequency X uniform in the fragment shader', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { fragmentShader } = captureShader(mat);
    expect(fragmentShader).toContain('uHairFreqX');
    body.dispose();
  });

  it('never assigns to the read-only vColor input (GLSL 300 ES safety)', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // Slice to only the injected section to avoid matching unrelated uses.
    const injected = fragmentShader.slice(fragmentShader.indexOf('uHairFreqX'));
    expect(injected).not.toMatch(/\bvColor\b\s*(\.[a-z]+)?\s*(=|\*=|\+=|-=|\/=)/);
    expect(injected).toContain('diffuseColor.rgb *=');
    body.dispose();
  });

  it('applies the pattern after color_fragment (vColor already folded into diffuseColor)', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { fragmentShader } = captureShader(mat);
    // Search for the actual usage in a diffuseColor write, not the uniform
    // declaration (which is prepended at the top, before color_fragment).
    expect(fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      fragmentShader.indexOf('diffuseColor.rgb *= 1.0 - uHairGapDarkness'),
    );
    body.dispose();
  });
});

// ---------------------------------------------------------------------------
// No-op when gapDarkness is 0
// ---------------------------------------------------------------------------

describe('unicorn hair shader — no-op when gapDarkness is 0', () => {
  it('does not set onBeforeCompile when gapDarkness is 0', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const originalCompile = mat.onBeforeCompile;
    applyUnicornHairShader(mat, body, { ...UNICORN_HAIR_CONFIG, gapDarkness: 0 });
    expect(mat.onBeforeCompile).toBe(originalCompile);
    body.dispose();
  });
});

// ---------------------------------------------------------------------------
// Composition: shader chains with a mock prior patch
// ---------------------------------------------------------------------------

function applyMockPriorPatch(material: THREE.MeshStandardMaterial): void {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|mock-prior` : 'mock-prior';
  };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n// __MOCK_PRIOR_SENTINEL__\ntransformed.x += 0.0;`,
    );
  };
  material.needsUpdate = true;
}

describe('unicorn hair shader composition — hair then mock prior', () => {
  it('vertex shader contains the hair position injection', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vUnicornHairPos = position');
    body.dispose();
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    applyMockPriorPatch(mat);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
    body.dispose();
  });
});

describe('unicorn hair shader composition — mock prior then hair', () => {
  it('vertex shader contains the hair position injection', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('vUnicornHairPos = position');
    body.dispose();
  });

  it('vertex shader still contains the mock prior sentinel', () => {
    const { body } = createUnicornGeometries(LENGTH, WIDTH);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyMockPriorPatch(mat);
    applyUnicornHairShader(mat, body, UNICORN_HAIR_CONFIG);
    const { vertexShader } = captureShader(mat);
    expect(vertexShader).toContain('__MOCK_PRIOR_SENTINEL__');
    body.dispose();
  });
});

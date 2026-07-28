import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyBirdFeatherShader,
  BIRD_FEATHER_MASK_ATTRIBUTE,
  PARROT_FEATHER_CONFIG,
} from '../birdFeatherShader';
import {
  createParrotGeometries,
  parrotPaletteFor,
  type ParrotPaletteProfile,
} from './parrotGeometry';

const PALETTES: ParrotPaletteProfile[] = [
  'green-focus',
  'blue-gold-focus',
  'scarlet-focus',
  'purple-lavender-focus',
];

describe('parrot bare-part feather mask', () => {
  it.each(PALETTES)('leaves the beak and eyes with no plumage on %s', (palette) => {
    const geometries = createParrotGeometries(9.1, 6.24, palette);
    const mask = geometries.body.getAttribute(BIRD_FEATHER_MASK_ATTRIBUTE);
    const color = geometries.body.getAttribute('color');
    expect(mask).toBeDefined();
    expect(mask.count).toBe(color.count);

    const paletteColors = parrotPaletteFor(palette);
    // Deliberately excludes eyeOuter: on the green palette the eye ring is the
    // same green as the plumage, so matching on it would sweep in body
    // vertices and the assertion would fail on a correct mask.
    const keratinColors = [paletteColors.beakUpper, paletteColors.beakLower];

    let keratin = 0;
    for (let i = 0; i < mask.count; i++) {
      const isKeratin = keratinColors.some(
        (c) =>
          Math.hypot(color.getX(i) - c.r, color.getY(i) - c.g, color.getZ(i) - c.b) < 0.02,
      );
      const isPupil = color.getX(i) < 0.06 && color.getY(i) < 0.06 && color.getZ(i) < 0.06;
      if (!isKeratin && !isPupil) continue;
      keratin++;
      // Exactly 0, not merely below a threshold: keratin opts out of the
      // pattern entirely, it does not merely fade.
      expect(mask.getX(i)).toBe(0);
    }
    expect(keratin).toBeGreaterThan(0);
  });

  it.each(PALETTES)('fades plumage out where the body lathe collapses on %s', (palette) => {
    const geometries = createParrotGeometries(9.1, 6.24, palette);
    const mask = geometries.body.getAttribute(BIRD_FEATHER_MASK_ATTRIBUTE);

    let full = 0;
    let partial = 0;
    for (let i = 0; i < mask.count; i++) {
      const value = mask.getX(i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      if (value > 0.999) full++;
      else if (value > 0.001) partial++;
    }

    // Most of the bird is plainly feathered, but there must be a genuine ramp
    // as well. A binary mask would smear the pattern into stripes over the
    // face, which is the artefact this fade exists to remove.
    expect(full).toBeGreaterThan(mask.count * 0.5);
    expect(partial).toBeGreaterThan(0);
  });

  it('gates the plumage pattern on the mask and stays brace-balanced', () => {
    const geometries = createParrotGeometries(9.1, 6.24, 'green-focus');
    const material = new THREE.MeshStandardMaterial();
    applyBirdFeatherShader(material, geometries.body, PARROT_FEATHER_CONFIG, 'yz');

    const shader = {
      vertexShader: '#include <color_vertex>',
      fragmentShader: '#include <roughnessmap_fragment>',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile!(shader, {} as THREE.WebGLRenderer);

    expect(shader.vertexShader).toContain(`vBirdFeatherMask = ${BIRD_FEATHER_MASK_ATTRIBUTE}`);
    expect(shader.fragmentShader).toContain('clamp( vBirdFeatherMask, 0.0, 1.0 )');
    // Every pattern term must be scaled, or a faded region would keep part of
    // the pattern and still show the smear it exists to hide.
    expect(shader.fragmentShader).toContain('uBarbDarkness * edge * visible * featherStrength');
    expect(shader.fragmentShader).toContain('uBarbRachis * rachis * featherStrength');
    expect(shader.fragmentShader).toContain('* visible * featherStrength');
    // An unbalanced brace here is a link failure that blacks out the scene, and
    // nothing else in the suite compiles the generated GLSL.
    expect((shader.fragmentShader.match(/\{/g) ?? []).length).toBe(
      (shader.fragmentShader.match(/\}/g) ?? []).length,
    );
  });

  it('does not inject the mask branch for geometry without the attribute', () => {
    const plain = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    applyBirdFeatherShader(material, plain, PARROT_FEATHER_CONFIG, 'yz');

    const shader = {
      vertexShader: '#include <color_vertex>',
      fragmentShader: '#include <roughnessmap_fragment>',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile!(shader, {} as THREE.WebGLRenderer);

    // Declaring the attribute unconditionally would make unmasked meshes read 0
    // and lose their plumage entirely.
    expect(shader.fragmentShader).not.toContain('vBirdFeatherMask');
    expect(shader.vertexShader).not.toContain(BIRD_FEATHER_MASK_ATTRIBUTE);
  });
});

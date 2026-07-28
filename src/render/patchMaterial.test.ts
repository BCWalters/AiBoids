import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { patchMaterial } from './patchMaterial';

/**
 * `onBeforeCompile` and `customProgramCacheKey` are single-valued slots. Every
 * shader patch in this codebase has to chain them rather than replace them, and
 * nothing in the type system says so — the failure mode of getting it wrong is a
 * plausible-looking render and a green suite.
 *
 * Two of these tests cover the helper's behaviour; the last one covers the thing
 * that actually regresses, which is somebody writing a twelfth patcher by hand.
 */

function runCompile(material: THREE.Material): {
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    vertexShader: 'VERT',
    fragmentShader: 'FRAG',
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

describe('patchMaterial', () => {
  it('runs every patch, in application order, on a twice-patched material', () => {
    const material = new THREE.MeshStandardMaterial();
    patchMaterial({
      material,
      cacheKey: 'first',
      patch: (shader) => {
        shader.vertexShader += '|one';
      },
    });
    patchMaterial({
      material,
      cacheKey: 'second',
      patch: (shader) => {
        shader.vertexShader += '|two';
      },
    });

    // Order matters for real patches: several of them String.replace the same
    // stock chunk, and the second only finds it if the first left it in place.
    expect(runCompile(material).vertexShader).toBe('VERT|one|two');
  });

  it('composes both cache keys, so neither patch can be served the other program', () => {
    const material = new THREE.MeshStandardMaterial();
    patchMaterial({ material, cacheKey: 'first', patch: () => {} });
    patchMaterial({ material, cacheKey: 'second', patch: () => {} });

    const key = material.customProgramCacheKey!();
    expect(key).toContain('first');
    expect(key).toContain('second');

    // A material carrying only one of the patches must not collide with this
    // one. three.js's program cache is global and keyed on this string alone
    // (WebGLPrograms.acquireProgram), so an equal key means a SHARED compiled
    // program — the second material's GLSL is discarded outright.
    const single = new THREE.MeshStandardMaterial();
    patchMaterial({ material: single, cacheKey: 'first', patch: () => {} });
    expect(single.customProgramCacheKey!()).not.toBe(key);
  });

  it('preserves a pre-existing cache key set outside the helper', () => {
    const material = new THREE.MeshStandardMaterial();
    material.customProgramCacheKey = () => 'legacy';
    patchMaterial({ material, cacheKey: 'added', patch: () => {} });

    expect(material.customProgramCacheKey()).toContain('legacy');
    expect(material.customProgramCacheKey()).toContain('added');
  });

  it('is still dropped by clone(), so patch-then-clone stays wrong', () => {
    const material = new THREE.MeshStandardMaterial();
    patchMaterial({ material, cacheKey: 'kept', patch: () => {} });

    // Pinned deliberately. The helper cannot fix this — clone() copies neither
    // slot — so the clone-first rule survives the refactor and this test says so
    // rather than leaving the next reader to assume the helper handles it.
    expect(material.clone().customProgramCacheKey?.() ?? '').not.toContain('kept');
  });

  it('is the only way shader patches are installed', () => {
    // import.meta.glob rather than fs: it needs no @types/node, and it is
    // resolved by vite at transform time so a new file cannot escape the sweep
    // by being missed at runtime.
    const sources = import.meta.glob('/src/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith('.test.ts') || file.endsWith('/patchMaterial.ts')) continue;
      // Assigning either slot directly discards whatever was already installed.
      // Two materials in this codebase carry two patches at once (the unicorn's
      // body has both the mane hair and the horn metal), and a replacement
      // removes one of them silently.
      for (const [index, line] of source.split('\n').entries()) {
        if (/\.(onBeforeCompile|customProgramCacheKey)\s*=[^=]/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    // Sanity-check the sweep itself: a glob that silently matches nothing would
    // make this test vacuously green forever.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});

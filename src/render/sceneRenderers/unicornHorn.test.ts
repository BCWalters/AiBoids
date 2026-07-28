import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';
import type { DriftingClouds } from '../styles/nature/clouds';
import type { FireBreathEffects } from '../styles/nature/fireBreath';
import { PredatorSpecies } from './createSceneRendererHooks';
import {
  applyUnicornHornShader,
  UNICORN_HORN_CONFIG,
  UNICORN_HORN_MASK_ATTRIBUTE,
} from '../styles/nature/unicornHornShader';

/**
 * The unicorn's horn is shaded as polished gold metal from within the shared
 * body material, keyed on a per-vertex mask.
 *
 * Two things can silently break this and neither raises an error:
 *
 *  - the mask range. The horn is merged into the body at a fixed position in
 *    the merge list; if that list is reordered and the fill range is not, the
 *    metal lands on some other body part. Nothing type-checks that.
 *  - the shader chain. The body material ALREADY carries the hair shader, so
 *    the horn patch must chain rather than replace. Replacing it removes the
 *    mane texture, leaving a plausible-looking creature and a green suite.
 *
 * These tests route through NatureSceneRenderer3D rather than calling
 * applyUnicornHornShader directly, for the same reason dragonWingScales.test.ts
 * does: the helper is trivially correct, the wiring is what regresses.
 */
function makeNatureRenderer(): NatureSceneRenderer3D {
  return new NatureSceneRenderer3D({
    camera: new THREE.PerspectiveCamera(),
    controls: {} as OrbitControls,
    driftingClouds: {
      dispose: () => {},
      setVisible: () => {},
    } as unknown as DriftingClouds,
    getNatureEnv: () => null,
    fireBreathEffects: {
      spawn: () => {},
      update: () => {},
      setVisible: () => {},
      dispose: () => {},
    } as unknown as FireBreathEffects,
  });
}

const NATURE_FLAGS = { isNature: true, isFishtank: false, isOrganic: true };
const HORSE_PRED_FLAGS = { isMonster: false, isShark: false };

function unicornSetup() {
  const renderer = makeNatureRenderer();
  const { geometries } = renderer.getPredatorInstanceConfig(
    PredatorSpecies.Horse,
    NATURE_FLAGS,
    HORSE_PRED_FLAGS,
  );
  return { renderer, geometries };
}

/** Runs a patched material's injection and returns the generated GLSL. */
function compiled(material: THREE.MeshStandardMaterial): { vertex: string; fragment: string } {
  const shader = {
    vertexShader: '#include <color_vertex>',
    fragmentShader:
      '#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <opaque_fragment>',
    uniforms: {} as Record<string, THREE.IUniform>,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader };
}

describe('unicorn horn', () => {
  it('tags exactly the horn vertices, and they are the topmost forward-raked ones', () => {
    const { geometries } = unicornSetup();
    const mask = geometries.body.getAttribute(UNICORN_HORN_MASK_ATTRIBUTE);
    const position = geometries.body.getAttribute('position');

    expect(mask).toBeTruthy();
    expect(mask.count).toBe(position.count);

    let tagged = 0;
    let taggedMaxZ = -Infinity;
    let untaggedMaxZ = -Infinity;
    for (let i = 0; i < mask.count; i++) {
      if (mask.getX(i) === 1) {
        tagged++;
        taggedMaxZ = Math.max(taggedMaxZ, position.getZ(i));
      } else {
        untaggedMaxZ = Math.max(untaggedMaxZ, position.getZ(i));
      }
    }

    // A cone, so a small slice of a body that is thousands of vertices. The
    // bound catches a fill range that has run away across the whole buffer.
    expect(tagged).toBeGreaterThan(0);
    expect(tagged / mask.count).toBeLessThan(0.2);

    // The horn's apex must be the highest point on the whole creature. If the
    // fill range slipped onto the ears or the mane instead, this fails — those
    // sit below the horn tip by construction.
    expect(taggedMaxZ).toBeGreaterThan(untaggedMaxZ);
  });

  it('rakes the horn forward without lifting its base off the skull', () => {
    const { geometries } = unicornSetup();
    const mask = geometries.body.getAttribute(UNICORN_HORN_MASK_ATTRIBUTE);
    const position = geometries.body.getAttribute('position');

    // Base = the horn's lowest ring; apex = its single highest vertex.
    let apex = new THREE.Vector3(0, 0, -Infinity);
    let baseZ = Infinity;
    let baseYSum = 0;
    let baseCount = 0;
    const horn: THREE.Vector3[] = [];
    for (let i = 0; i < mask.count; i++) {
      if (mask.getX(i) !== 1) continue;
      const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
      horn.push(v);
      if (v.z > apex.z) apex = v;
      baseZ = Math.min(baseZ, v.z);
    }
    for (const v of horn) {
      if (v.z < baseZ + 1e-3) {
        baseYSum += v.y;
        baseCount++;
      }
    }
    const baseY = baseYSum / baseCount;

    // The apex must sit FORWARD (+Y, toward the muzzle) of the base. Rotating
    // about +X instead of -X lays the horn back over the neck and this is the
    // only thing that catches it — the horn is still a plausible cone either way.
    expect(apex.y).toBeGreaterThan(baseY);

    // And the rake must be the ~20 degrees asked for, measured from vertical.
    const rakeDeg = THREE.MathUtils.radToDeg(Math.atan2(apex.y - baseY, apex.z - baseZ));
    expect(rakeDeg).toBeGreaterThan(15);
    expect(rakeDeg).toBeLessThan(25);
  });

  it('shades the masked fragments as metal, chained after the hair shader', () => {
    const { renderer, geometries } = unicornSetup();
    const material = new THREE.MeshStandardMaterial();
    renderer.patchBodyMaterial!(material, geometries);
    const { vertex, fragment } = compiled(material);

    // Metal is a material response, not a colour: a gold hue on a rough
    // dielectric reads as mustard paint. Both factors must be overridden.
    expect(fragment).toContain('metalnessFactor = mix(');
    expect(fragment).toContain('roughnessFactor = mix(');
    expect(fragment).toContain('uHornMetalness');

    // Chained, not replaced — the mane texture must survive.
    expect(vertex).toContain('vHairMask');
    expect(vertex).toContain('vHornMask');
    expect(fragment).toContain('uHairGapDarkness');

    // Both patches must be represented in the cache key. three.js reuses a
    // program whenever the key matches, so a key that names only one of them
    // can serve a program compiled without the other.
    const key = material.customProgramCacheKey!();
    expect(key).toContain('aiboids-unicorn-hair');
    expect(key).toContain('aiboids-unicorn-horn');
  });

  it('skips any body that carries no horn mask, rather than binding a missing attribute', () => {
    const { renderer } = unicornSetup();
    const { geometries } = renderer.getPredatorInstanceConfig(
      PredatorSpecies.Monster,
      NATURE_FLAGS,
      { isMonster: true, isShark: false },
    );

    // This is the guard, not the dispatch: an earlier version of this test
    // claimed to prove the renderer only patches the unicorn, and stayed green
    // when the patch was moved to every creature — because the dragon has no
    // mask and the shader declines. That decline is the property worth pinning.
    // Declaring `attribute float aHornMask` on a geometry that lacks it leaves
    // three.js with an unbindable attribute and the whole body disappears.
    expect(geometries.body.getAttribute(UNICORN_HORN_MASK_ATTRIBUTE)).toBeUndefined();

    const material = new THREE.MeshStandardMaterial();
    applyUnicornHornShader(material, geometries.body, UNICORN_HORN_CONFIG);
    expect(material.customProgramCacheKey?.() ?? '').not.toContain('aiboids-unicorn-horn');

    renderer.patchBodyMaterial!(material, geometries);
    expect(material.customProgramCacheKey!()).not.toContain('aiboids-unicorn-horn');
  });
});

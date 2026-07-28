import * as THREE from 'three';
import { patchMaterial } from '../../patchMaterial';

/**
 * Per-vertex tag marking which of the merged unicorn body's vertices belong to
 * the horn. Written by buildUnicornBodyGeometry; read here. Shared as a named
 * constant so the two ends cannot drift apart on a typo — the same arrangement
 * BIRD_FEATHER_MASK_ATTRIBUTE uses.
 */
export const UNICORN_HORN_MASK_ATTRIBUTE = 'aHornMask';

export interface UnicornHornConfig {
  /**
   * Metalness on the horn. 1 is a full conductor, which is what makes gold read
   * as gold: a metal reflects its environment tinted by its own colour and has
   * essentially no white diffuse component. Below about 0.8 it starts to look
   * like painted plastic again.
   */
  metalness: number;
  /**
   * Roughness on the horn. Low values give the tight, bright highlight of
   * polished metal; the body around it stays at the material's own roughness.
   */
  roughness: number;
  /**
   * Self-lit boost, as a fraction of the horn's own colour, added on top of the
   * lit result.
   *
   * A pure metal is only as bright as what it reflects, and this scene's sky is
   * dim enough that a physically-correct gold horn reads almost black from
   * below. A small emissive term keeps it reading as bright gold from every
   * angle without turning it into a light source. 0 disables it.
   */
  glow: number;
}

/**
 * Shipped values. Tuned so the horn reads as polished gold rather than as a
 * yellow-painted spike, which is what the plain vertex colour gave.
 */
export const UNICORN_HORN_CONFIG: UnicornHornConfig = {
  metalness: 0.95,
  roughness: 0.18,
  glow: 0.35,
};

/**
 * Shades the unicorn's horn as polished metal within the shared body material.
 *
 * The horn is merged into the body mesh (it is a handful of triangles; giving it
 * its own InstancedMesh part would cost a draw call per creature for nothing),
 * so it cannot simply be given a second, metallic material. Instead the merged
 * geometry tags the horn's vertices and this patch swaps the metalness and
 * roughness inputs on exactly those fragments.
 *
 * Injection point: immediately after `#include <metalnessmap_fragment>`, which
 * is the last chunk to write `metalnessFactor`, and which runs after
 * `roughnessmap_fragment` writes `roughnessFactor`. Both are mutable locals
 * there, and both are consumed by the lighting chunks further down, so writing
 * to them here is the whole effect. Patching earlier would have the stock
 * chunks overwrite it; patching after the lighting chunks would do nothing.
 *
 * The glow is added at `#include <output_fragment>`'s predecessor
 * `<opaque_fragment>` (three.js renamed the chunk in r152), so it lands on the
 * final lit colour rather than on the albedo, where it would just be multiplied
 * back down by the lighting.
 *
 * Composes safely with any previously-installed patch: installed via
 * patchMaterial, which chains onBeforeCompile and composes the cache key. On the
 * unicorn the body material already carries the hair shader, so this is not
 * hypothetical.
 *
 * ⚠️  Clone-before-patch rule: THREE.Material.clone() silently drops both
 * onBeforeCompile and customProgramCacheKey. Clone first, then patch each clone.
 */
export function applyUnicornHornShader(
  material: THREE.MeshStandardMaterial,
  bodyGeometry: THREE.BufferGeometry,
  config: UnicornHornConfig,
): void {
  // Nothing to shade if the geometry never tagged a horn. Patching anyway would
  // declare an attribute three.js cannot bind, and the whole body would vanish.
  if (bodyGeometry.getAttribute(UNICORN_HORN_MASK_ATTRIBUTE) == null) return;

  // Every value below changes the emitted GLSL (they are folded in as literals
  // via uniforms, but the uniform *set* and the glow branch depend on them), so
  // all three belong in the cache key. Omitting one makes three.js reuse a
  // program compiled for different settings.
  const cacheKey = `aiboids-unicorn-horn-v1:${config.metalness.toFixed(4)}:${config.roughness.toFixed(4)}:${config.glow.toFixed(4)}`;

  patchMaterial({
    material,
    cacheKey,
    patch: (shader) => {

      shader.vertexShader =
        `varying float vHornMask;\nattribute float ${UNICORN_HORN_MASK_ATTRIBUTE};\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `vHornMask = ${UNICORN_HORN_MASK_ATTRIBUTE};\n#include <color_vertex>`,
      );

      shader.fragmentShader =
        `varying float vHornMask;\nuniform float uHornMetalness;\nuniform float uHornRoughness;\nuniform float uHornGlow;\n` +
        shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
    {
      // vHornMask interpolates to a fraction across the ring of triangles where
      // the horn's base meets the skull, which is exactly what we want: the metal
      // fades into the coat over one band rather than stopping on a hard line.
      float hornMask = clamp(vHornMask, 0.0, 1.0);
      metalnessFactor = mix(metalnessFactor, uHornMetalness, hornMask);
      roughnessFactor = mix(roughnessFactor, uHornRoughness, hornMask);
    }`,
      );

      if (config.glow > 0) {
        // Chunk name differs across three.js versions; patch whichever is present
        // rather than assuming, so a dependency bump degrades to "no glow"
        // instead of to a silently unpatched shader.
        const glowSnippet = (chunk: string) => `${chunk}
    {
      // diffuseColor.rgb still holds the horn's baked gold at this point, so the
      // glow is tinted by the horn's own colour instead of washing it toward white.
      gl_FragColor.rgb += diffuseColor.rgb * uHornGlow * clamp(vHornMask, 0.0, 1.0);
    }`;
        for (const chunk of ['#include <opaque_fragment>', '#include <output_fragment>']) {
          if (shader.fragmentShader.includes(chunk)) {
            shader.fragmentShader = shader.fragmentShader.replace(chunk, glowSnippet(chunk));
            break;
          }
        }
      }

      Object.assign(shader.uniforms, {
        uHornMetalness: { value: config.metalness },
        uHornRoughness: { value: config.roughness },
        uHornGlow: { value: config.glow },
      });
    },
  });
}

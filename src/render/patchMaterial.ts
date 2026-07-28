import type * as THREE from 'three';

/**
 * The one safe way to inject custom GLSL into a three.js material.
 *
 * `onBeforeCompile` and `customProgramCacheKey` are single-valued slots on a
 * material. Every patcher in this codebase therefore has to obey the same four
 * rules, and the compiler enforces none of them:
 *
 *  1. **Chain, never replace.** Assigning `material.onBeforeCompile = ...`
 *     silently discards whatever was already there. Materials here routinely
 *     carry two patches — the unicorn's body has both the mane hair texture and
 *     the horn's metal — and a replacement removes one of them with no error
 *     and a still-plausible render.
 *
 *  2. **Compose the cache key.** three.js reuses a compiled program whenever
 *     the key matches. A patch that adds GLSL without extending the key can be
 *     served a program compiled *without* its injection, so the effect vanishes
 *     on some meshes and not others depending on draw order.
 *
 *  3. **Put every source-affecting value in the key.** Anything baked into the
 *     emitted GLSL, or that changes which branches are emitted, has to appear.
 *     Two configs that differ only in an omitted field will share one program.
 *
 *  4. **Patch each material instance exactly once.** Patching is not
 *     idempotent: a second application chains a second copy of the same
 *     injection, and `String.replace` on an already-substituted chunk either
 *     duplicates the code or silently no-ops.
 *
 * Rules 1 and 2 are structural once a patcher goes through this helper: it is
 * not possible to express "replace" here. Rules 3 and 4 remain the caller's,
 * but the key is now a required argument rather than something easy to forget.
 *
 * ⚠️  Clone-before-patch: `THREE.Material.clone()` drops BOTH slots. If a
 * material needs a per-side or per-variant copy, clone first and patch each
 * clone. Never patch and then clone — that produced a real "only one wing has
 * the shader" defect in this repo.
 */
export interface PatchMaterialOptions {
  material: THREE.Material;
  /**
   * Uniquely identifies the emitted GLSL. Must include every value that
   * affects the generated source (rule 3 above). Conventionally
   * `aiboids-<name>-v<n>:<field>:<field>`, with the version bumped whenever the
   * emitted source changes shape.
   */
  cacheKey: string;
  /** Receives the shader exactly as `onBeforeCompile` would. */
  patch: NonNullable<THREE.Material['onBeforeCompile']>;
}

export function patchMaterial({ material, cacheKey, patch }: PatchMaterialOptions): void {
  const previousCompile = material.onBeforeCompile;
  // Bound before reassignment: three.js calls customProgramCacheKey as a method
  // on the material, and several existing keys read `this`. Capturing it
  // unbound and calling it from the closure below would change what `this` is.
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () => {
    const base = previousCacheKey?.() ?? '';
    return base.length ? `${base}|${cacheKey}` : cacheKey;
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    patch(shader, renderer);
  };

  material.needsUpdate = true;
}

import * as THREE from 'three';
import type { BoidRenderBatch } from '../CreatureInstanceRenderer';

/**
 * Tints every part of a creature's leg chain.
 *
 * All six colour strategies treated legs identically — pass white when the
 * geometry carries baked vertex colours so that palette shows through,
 * otherwise take the supplied flat colour — and each had its own copy of that
 * rule written against a single legs mesh. Legs are now a rig chain whose
 * length varies per creature, so the rule lives here once and iterates. That
 * keeps splitting a creature's legs into more parts from rippling back into
 * colour code that doesn't care how many parts there are.
 */
export function applyLegChainColor({
  set,
  index,
  scratch,
  flatColor,
  forceWhite = false,
}: {
  set: BoidRenderBatch;
  index: number;
  /** Caller-owned scratch colour, so this allocates nothing per instance. */
  scratch: THREE.Color;
  /** Used when the part has no baked vertex colours of its own. */
  flatColor: THREE.Color;
  /** Forces the baked-palette passthrough regardless of the geometry. */
  forceWhite?: boolean;
}): void {
  for (const part of set.legs ?? []) {
    if (forceWhite || part.mesh.geometry.getAttribute('color')) {
      scratch.setRGB(1, 1, 1);
    } else {
      scratch.copy(flatColor);
    }
    part.mesh.setColorAt(index, scratch);
  }
}

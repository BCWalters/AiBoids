import * as THREE from 'three';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';
import { applyLegChainColor } from './legColorApplication';

/**
 * Owns the nature dragon (Monster predator) color path. Dragons carry no
 * per-species color set and no individual variation — the whole creature is
 * driven by a single base color lerped toward the hunt highlight. The body
 * bakes a vertex gradient (the base color tints it) and the whip tail bakes its
 * own gradient (white passthrough so it shows unchanged); the membrane wings
 * and clawed legs are un-baked and take the flat state color.
 *
 * Pulled out of the generic creature color applicator so the dragon's simple
 * solid-tint policy reads on its own rather than as the "no species colors, no
 * individual variation" fall-through arm of the shared conditional tree. The
 * tail/legs baked-attribute checks stay runtime-detected to remain byte-for-
 * byte faithful to the former shared path.
 */
export class DragonColorApplicator {
  private stateColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();

  apply(args: CreatureInstanceColorArgs): void {
    const { set, index, creature, baseColor, highlightColor, getIntensity } = args;

    this.stateColor.copy(baseColor).lerp(highlightColor, getIntensity(creature));
    set.body.setColorAt(index, this.stateColor);
    set.wingLeft.setColorAt(index, this.stateColor);
    set.wingRight.setColorAt(index, this.stateColor);

    if (set.tail) {
      // Baked gradient tail (violet root → red tip): pass white so it shows
      // through unchanged; otherwise fall back to the flat state color.
      if (set.tail.geometry.getAttribute('color')) {
        this.tailColor.setRGB(1, 1, 1);
      } else {
        this.tailColor.copy(this.stateColor);
      }
      set.tail.setColorAt(index, this.tailColor);
    }

    applyLegChainColor({ set, index, scratch: this.legsColor, flatColor: this.stateColor });
  }
}

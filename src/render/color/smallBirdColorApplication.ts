import * as THREE from 'three';
import { jitterHSL } from './colorJitter';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';
import { applyLegChainColor } from './legColorApplication';

/**
 * Owns the nature small-songbird color path (sparrow / goldfinch / cardinal /
 * blue-jay). These species bake their entire plumage — body, wings, tail, and
 * legs — as per-vertex gradients into their geometry (see smallBirdGeometry.ts
 * and each SmallBirdPalette). The instance color therefore just passes white so
 * the baked palette shows through unchanged, lerped toward the panic highlight;
 * only the beak, a separate un-baked part, takes a per-individual jittered hue.
 *
 * Pulled out of the generic creature color applicator so this family's simple,
 * baked-passthrough policy reads on its own instead of threading through the
 * shared species-jitter / individual-variation conditionals it never used.
 * Behavior is intentionally identical to the former shared baked-gradient path.
 */
export class SmallBirdColorApplicator {
  private bodyColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();

  apply(args: CreatureInstanceColorArgs): void {
    const {
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    } = args;
    const intensity = getIntensity(creature);

    // Body / wings / tail: baked gradient passes white so the palette shows
    // through, lerped toward the panic highlight. Small-bird geometry always
    // bakes these parts; the non-baked fallback is defensive only.
    if (hasBakedBodyVertexColors) {
      this.bodyColor.setRGB(1, 1, 1).lerp(highlightColor, intensity);
    } else {
      this.bodyColor.copy(baseColor).lerp(highlightColor, intensity);
    }
    set.body.setColorAt(index, this.bodyColor);

    if (hasBakedWingVertexColors) {
      this.wingColor.setRGB(1, 1, 1).lerp(highlightColor, intensity);
    } else {
      this.wingColor.copy(baseColor).lerp(highlightColor, intensity);
    }
    set.wingLeft.setColorAt(index, this.wingColor);
    set.wingRight.setColorAt(index, this.wingColor);

    if (set.tail) {
      if (hasBakedTailVertexColors) {
        this.tailColor.setRGB(1, 1, 1).lerp(highlightColor, intensity);
      } else {
        this.tailColor.copy(this.wingColor);
      }
      set.tail.setColorAt(index, this.tailColor);
    }

    // Legs bake the species foot color; pass pure white so it shows unchanged.
    applyLegChainColor({
      set,
      index,
      scratch: this.legsColor,
      flatColor: this.legsColor,
      forceWhite: true,
    });

    // Beak is a separate un-baked part: a small per-individual jitter keeps a
    // flock's beaks from all being the exact same pixel color.
    if (set.beak && beakColor) {
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

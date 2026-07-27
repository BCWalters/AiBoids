import * as THREE from 'three';
import { idHash, jitterHSL } from './colorJitter';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';
import { applyLegChainColor } from './legColorApplication';

/**
 * Owns the "songbird individual-variation" color class — creatures that take
 * their scene base color and give each individual a runtime HSL jitter, with a
 * few rare morph rolls (pale, dark, rusty) so a flock shows natural variety.
 * Wings and tail render a shade darker than the body (real songbird wing
 * feathers are almost always darker than the breast). Legs pass white when the
 * geometry baked its own foot color, else take the body's state color.
 *
 * Unlike the nature small birds (which bake their whole plumage as a gradient
 * and only need a white passthrough — see SmallBirdColorApplicator), these
 * species carry a single flat base color and compute all variation at runtime.
 * Covers the arcade Gold/Red/Blue finch/cardinal/jay boids.
 *
 * Split out of the generic creature color applicator so this runtime-variation
 * policy reads on its own rather than as the individualVariation arms of the
 * shared conditional tree. Byte-identical output.
 */
export class SongbirdColorApplicator {
  private variantColor = new THREE.Color();
  private stateColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();
  private hsl = { h: 0, s: 0, l: 0 };

  apply(args: CreatureInstanceColorArgs): void {
    const {
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      beakColor,
    } = args;
    const intensity = getIntensity(creature);

    baseColor.getHSL(this.hsl);
    let { h, s, l } = this.hsl;
    h = (h + (idHash(creature.id, 1) - 0.5) * 0.05 + 1) % 1;
    s = Math.max(0, Math.min(1, s + (idHash(creature.id, 2) - 0.5) * 0.16));
    l = Math.max(0, Math.min(1, l + (idHash(creature.id, 3) - 0.5) * 0.18));
    const morphRoll = idHash(creature.id, 4);
    if (morphRoll < 0.06) {
      // Pale/leucistic-like morph: much lighter, slightly desaturated.
      l = Math.max(0, Math.min(0.92, l + 0.28));
      s *= 0.6;
    } else if (morphRoll < 0.1) {
      // Dark/melanistic-like morph: noticeably darker.
      l = Math.max(0.05, l - 0.22);
    } else if (morphRoll < 0.16) {
      // Warmer, rustier-toned morph: shift hue toward red-orange.
      h = (h + 0.03) % 1;
      s = Math.min(1, s + 0.15);
    }
    this.variantColor.setHSL(h, s, l);

    this.stateColor.copy(this.variantColor).lerp(highlightColor, intensity);
    set.body.setColorAt(index, this.stateColor);

    // Wings/tail render a touch darker than the body — real bird wing feathers
    // are almost always a shade or two darker than the breast/body plumage.
    this.wingColor.copy(this.stateColor).multiplyScalar(0.82);
    set.wingLeft.setColorAt(index, this.wingColor);
    set.wingRight.setColorAt(index, this.wingColor);
    if (set.tail) set.tail.setColorAt(index, this.wingColor);

    applyLegChainColor({ set, index, scratch: this.legsColor, flatColor: this.stateColor });

    if (set.beak && beakColor) {
      // Small per-individual jitter, same treatment as the other parts (salt 5)
      // — keeps a flock of e.g. cardinals from looking like every single beak
      // is the identical exact pixel color.
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

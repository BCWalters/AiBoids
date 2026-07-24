import * as THREE from 'three';
import { jitterHSL } from './colorJitter';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';

/**
 * Owns the nature parrot color path — pulled out of the generic creature color
 * applicator so this family's decisions live in one straight-line place rather
 * than as one arm of a shared conditional tree. Parrots always supply a
 * per-creature species color set (their profile variant) and tint the body with
 * it, while wings/tail/legs pass white so any baked per-part palette shows
 * through untouched. Behavior is intentionally identical to the former shared
 * path; only the code location changed.
 */
export class ParrotColorApplicator {
  private stateColor = new THREE.Color();
  private variantColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();

  apply(args: CreatureInstanceColorArgs): void {
    const {
      set,
      index,
      creature,
      highlightColor,
      getIntensity,
      getSpeciesColors,
      preserveBakedPartPalette,
      lockSpeciesPalette,
      beakColor,
    } = args;

    // Parrots always provide a per-creature species color set (their profile
    // variant); getSpeciesColors is guaranteed to be present for this family.
    const speciesColors = getSpeciesColors!(creature)!;
    let effectiveBase: THREE.Color;
    let effectiveWing: THREE.Color;
    let effectiveTail: THREE.Color;
    if (lockSpeciesPalette) {
      effectiveBase = speciesColors.body;
      effectiveWing = speciesColors.wing;
      effectiveTail = speciesColors.tail;
    } else {
      jitterHSL(this.variantColor, speciesColors.body, creature.id, 1, 0.05, 0.12, 0.1);
      jitterHSL(this.wingColor, speciesColors.wing, creature.id, 2, 0.05, 0.12, 0.1);
      jitterHSL(this.tailColor, speciesColors.tail, creature.id, 3, 0.05, 0.12, 0.1);
      effectiveBase = this.variantColor;
      effectiveWing = this.wingColor;
      effectiveTail = this.tailColor;
    }

    const intensity = getIntensity(creature);
    this.stateColor.copy(effectiveBase).lerp(highlightColor, intensity);
    set.body.setColorAt(index, this.stateColor);

    const preserveWingPalette = preserveBakedPartPalette
      && !!set.wingLeft.geometry.getAttribute('color');
    const preserveTailPalette = preserveWingPalette
      && !!set.tail?.geometry.getAttribute('color');
    const preserveLegPalette = preserveWingPalette
      && !!set.legs?.geometry.getAttribute('color');

    // Species with their own distinct wing/tail base colors keep those hues
    // rather than just darkening the body color.
    if (preserveWingPalette) {
      this.wingColor.setRGB(1, 1, 1);
    } else {
      this.wingColor.copy(effectiveWing).lerp(highlightColor, intensity);
    }
    set.wingLeft.setColorAt(index, this.wingColor);
    set.wingRight.setColorAt(index, this.wingColor);
    if (set.tail) {
      if (preserveTailPalette) {
        this.tailColor.setRGB(1, 1, 1);
      } else {
        this.tailColor.copy(effectiveTail).lerp(highlightColor, intensity);
      }
      set.tail.setColorAt(index, this.tailColor);
    }

    if (set.legs) {
      if (preserveLegPalette || set.legs.geometry.getAttribute('color')) {
        // Parrot legs: baked palette feet color, pass through with white.
        this.legsColor.setRGB(1, 1, 1);
      } else {
        this.legsColor.copy(this.stateColor);
      }
      set.legs.setColorAt(index, this.legsColor);
    }

    if (set.beak && beakColor) {
      // Small per-individual jitter so a flock's beaks aren't all the exact
      // same pixel color.
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

import * as THREE from 'three';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';
import { jitterHSL } from './colorJitter';

/**
 * Owns the "species tint" color class — creatures that carry a per-species
 * body/wing/tail color set with no baked body gradient. Each part takes its
 * species color (jittered per individual, unless the palette is locked) lerped
 * toward the highlight. Baked legs (hooves / talons) pass white to show
 * through; an optional beak takes a small per-individual jitter of its color.
 *
 * Covers nature unicorns/hawks (no beak), plus the fishtank seahorse and
 * butterflyfish and arcade rainbow variants (which add a beak).
 *
 * Split out of the generic creature color applicator so this straightforward
 * three-part species tint reads on its own rather than as the
 * getSpeciesColors + effectiveWing arms of the shared conditional tree.
 * Byte-identical output.
 */
export class SpeciesTintColorApplicator {
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
      getSpeciesColors,
      lockSpeciesPalette,
      beakColor,
    } = args;

    const species = getSpeciesColors?.(creature);
    const intensity = getIntensity(creature);

    let effectiveBase: THREE.Color;
    let effectiveWing: THREE.Color;
    let effectiveTail: THREE.Color;
    if (species) {
      if (lockSpeciesPalette) {
        effectiveBase = species.body;
        effectiveWing = species.wing;
        effectiveTail = species.tail;
      } else {
        jitterHSL(this.bodyColor, species.body, creature.id, 1, 0.05, 0.12, 0.1);
        jitterHSL(this.wingColor, species.wing, creature.id, 2, 0.05, 0.12, 0.1);
        jitterHSL(this.tailColor, species.tail, creature.id, 3, 0.05, 0.12, 0.1);
        effectiveBase = this.bodyColor;
        effectiveWing = this.wingColor;
        effectiveTail = this.tailColor;
      }
    } else {
      // No species colors resolved for this creature — fall back to the flat
      // base color for every part (matches the shared path's neutral arm).
      effectiveBase = baseColor;
      effectiveWing = baseColor;
      effectiveTail = baseColor;
    }

    this.bodyColor.copy(effectiveBase).lerp(highlightColor, intensity);
    set.body.setColorAt(index, this.bodyColor);

    this.wingColor.copy(effectiveWing).lerp(highlightColor, intensity);
    set.wingLeft.setColorAt(index, this.wingColor);
    set.wingRight.setColorAt(index, this.wingColor);

    if (set.tail) {
      this.tailColor.copy(effectiveTail).lerp(highlightColor, intensity);
      set.tail.setColorAt(index, this.tailColor);
    }

    if (set.legs) {
      // Hooves / talons bake their own vertex color — pass white so it shows
      // through; otherwise use the body's state color.
      if (set.legs.geometry.getAttribute('color')) {
        this.legsColor.setRGB(1, 1, 1);
      } else {
        this.legsColor.copy(this.bodyColor);
      }
      set.legs.setColorAt(index, this.legsColor);
    }

    if (set.beak && beakColor) {
      // Small per-individual jitter so a school doesn't share one exact beak
      // pixel color — matches the shared path's beak treatment (salt 5).
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

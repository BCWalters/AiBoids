import * as THREE from 'three';
import type { Boid } from '../../sim/Boid';
import type { Predator } from '../../sim/Predator';
import type { SpeciesColorSet, CreatureColorMode } from '../sceneRenderers/createSceneRendererHooks';
import type { BoidRenderBatch } from '../CreatureInstanceRenderer';
import { idHash, jitterHSL } from './colorJitter';
import { ParrotColorApplicator } from './parrotColorApplication';
import { SmallBirdColorApplicator } from './smallBirdColorApplication';
import { DragonColorApplicator } from './dragonColorApplication';
import { SpeciesTintColorApplicator } from './speciesTintColorApplication';

/**
 * All inputs needed to color one creature instance for a single frame. The
 * runtime color inputs (base/highlight/intensity, per-species/individual
 * variation) come from the scene's ColourStrategy; the baked-vertex flags
 * describe what the creature's geometry already carries.
 */
export interface CreatureInstanceColorArgs {
  set: BoidRenderBatch;
  index: number;
  creature: Boid | Predator;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((creature: Boid | Predator) => SpeciesColorSet | null) | undefined;
  preserveBakedPartPalette: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
  hasBakedBodyVertexColors: boolean;
  hasBakedWingVertexColors: boolean;
  hasBakedTailVertexColors: boolean;
  /** Selects a dedicated per-family color path. When set (e.g. 'parrot'), the
   * generic conditional path is bypassed in favor of that family's applicator. */
  colorMode?: CreatureColorMode;
}

/**
 * Owns all per-instance creature color decisions — which body part takes the
 * effective species/individual color, which passes white so a baked vertex
 * palette shows through, and the small per-individual HSL jitter. Kept out of
 * the central instance renderer (which only resolves the runtime color inputs
 * and supplies them here) so color policy lives next to the geometry layer it
 * describes rather than in the frame loop.
 */
export class CreatureColorApplicator {
  private parrot = new ParrotColorApplicator();
  private smallBird = new SmallBirdColorApplicator();
  private dragon = new DragonColorApplicator();
  private speciesTint = new SpeciesTintColorApplicator();
  private stateColor = new THREE.Color();
  private variantColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();
  private hsl = { h: 0, s: 0, l: 0 };

  /**
   * Baked-vertex-color detection for a batch: a geometry that baked its own
   * gradient wants a white passthrough instead of a solid tint. Only honored
   * when the scene marked the species as using a baked body gradient.
   */
  getBakedColorAttributeFlags(
    set: BoidRenderBatch,
    bakedBodyGradient: boolean,
  ): {
    hasBakedBodyVertexColors: boolean;
    hasBakedWingVertexColors: boolean;
    hasBakedTailVertexColors: boolean;
  } {
    return {
      hasBakedBodyVertexColors: bakedBodyGradient && !!set.body.geometry.getAttribute('color'),
      hasBakedWingVertexColors: bakedBodyGradient && !!set.wingLeft.geometry.getAttribute('color'),
      hasBakedTailVertexColors: bakedBodyGradient && !!set.tail?.geometry.getAttribute('color'),
    };
  }

  apply(args: CreatureInstanceColorArgs): void {
    if (args.colorMode === 'parrot') {
      this.parrot.apply(args);
      return;
    }
    if (args.colorMode === 'smallBird') {
      this.smallBird.apply(args);
      return;
    }
    if (args.colorMode === 'dragon') {
      this.dragon.apply(args);
      return;
    }
    if (args.colorMode === 'speciesTint') {
      this.speciesTint.apply(args);
      return;
    }
    const {
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      preserveBakedPartPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    } = args;
    const speciesColors = getSpeciesColors?.(creature);
    let effectiveBase = baseColor;
    let effectiveWing: THREE.Color | null = null;
    let effectiveTail: THREE.Color | null = null;
    let preserveLegPalette = false;

    if (speciesColors) {
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
    } else if (individualVariation) {
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
      effectiveBase = this.variantColor;
    }
    if (hasBakedBodyVertexColors) {
      // Baked gradient body — pass white so the vertex colours show through.
      this.stateColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
    } else {
      this.stateColor.copy(effectiveBase).lerp(highlightColor, getIntensity(creature));
    }
    set.body.setColorAt(index, this.stateColor);
    if (hasBakedWingVertexColors) {
      // Baked gradient wings — white passthrough; same for tail if baked.
      this.wingColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (hasBakedTailVertexColors) {
          this.tailColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
        } else {
          this.tailColor.copy(this.wingColor);
        }
        set.tail.setColorAt(index, this.tailColor);
      }
    } else if (effectiveWing) {
      const preserveWingPalette = preserveBakedPartPalette
        && !!set.wingLeft.geometry.getAttribute('color');
      const preserveTailPalette = preserveWingPalette
        && !!set.tail?.geometry.getAttribute('color');
      preserveLegPalette = preserveWingPalette
        && !!set.legs?.geometry.getAttribute('color');
      // Species with their own distinct wing/tail base colors keep those
      // hues rather than just darkening the body color.
      if (preserveWingPalette) {
        this.wingColor.setRGB(1, 1, 1);
      } else {
        this.wingColor.copy(effectiveWing).lerp(highlightColor, getIntensity(creature));
      }
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (effectiveTail) {
          if (preserveTailPalette) {
            this.tailColor.setRGB(1, 1, 1);
          } else {
            this.tailColor.copy(effectiveTail).lerp(highlightColor, getIntensity(creature));
          }
          set.tail.setColorAt(index, this.tailColor);
        } else {
          set.tail.setColorAt(index, this.wingColor);
        }
      }
    } else if (individualVariation) {
      // Wings/tail render a touch darker than the body — real bird wing
      // feathers are almost always a shade or two darker than the breast/
      // body plumage, and this reads clearly even at a distance.
      this.wingColor.copy(this.stateColor).multiplyScalar(0.82);
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) set.tail.setColorAt(index, this.wingColor);
    } else {
      set.wingLeft.setColorAt(index, this.stateColor);
      set.wingRight.setColorAt(index, this.stateColor);
      if (set.tail) {
        // Auto-detect baked vertex colours on the tail (e.g. dragon gradient
        // tail). Pass white so the gradient shows through; otherwise use
        // stateColor like the wings.
        if (set.tail.geometry.getAttribute('color')) {
          this.tailColor.setRGB(1, 1, 1);
        } else {
          this.tailColor.copy(this.stateColor);
        }
        set.tail.setColorAt(index, this.tailColor);
      }
    }
    if (set.legs) {
      if (preserveLegPalette || set.legs.geometry.getAttribute('color')) {
        // Parrot legs: baked palette feet color, pass through with white.
        // Small-bird legs: baked species leg color, same white pass-through.
        this.legsColor.setRGB(1, 1, 1);
      } else {
        this.legsColor.copy(this.stateColor);
      }
      set.legs.setColorAt(index, this.legsColor);
    }
    if (set.beak && beakColor) {
      // Small per-individual jitter, same treatment as the other parts
      // — keeps a flock of e.g. cardinals from looking like every
      // single beak is the identical exact pixel color.
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

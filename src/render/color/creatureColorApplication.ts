import * as THREE from 'three';
import type { Boid } from '../../sim/Boid';
import type { Predator } from '../../sim/Predator';
import type { SpeciesColorSet, CreatureColorMode } from '../sceneRenderers/createSceneRendererHooks';
import type { BoidRenderBatch } from '../CreatureInstanceRenderer';
import { ParrotColorApplicator } from './parrotColorApplication';
import { SmallBirdColorApplicator } from './smallBirdColorApplication';
import { DragonColorApplicator } from './dragonColorApplication';
import { SpeciesTintColorApplicator } from './speciesTintColorApplication';
import { SongbirdColorApplicator } from './songbirdColorApplication';
import { FlatColorApplicator } from './flatColorApplication';

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
  /** Selects the dedicated per-family color path that applies this strategy. */
  colorMode: CreatureColorMode;
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
  private songbird = new SongbirdColorApplicator();
  private flat = new FlatColorApplicator();

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
    switch (args.colorMode) {
      case 'parrot':
        this.parrot.apply(args);
        return;
      case 'smallBird':
        this.smallBird.apply(args);
        return;
      case 'dragon':
        this.dragon.apply(args);
        return;
      case 'speciesTint':
        this.speciesTint.apply(args);
        return;
      case 'songbird':
        this.songbird.apply(args);
        return;
      case 'flat':
        this.flat.apply(args);
        return;
      default: {
        const impossibleMode: never = args.colorMode;
        throw new Error(`Unhandled creature color mode: ${String(impossibleMode)}`);
      }
    }
  }
}

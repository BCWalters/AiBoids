import { BoidSpecies } from '../sim/Boid';

/**
 * The boid species Renderer3D reconciles/updates each frame. This is
 * deliberately just the species identities — per-scene visual config (colors,
 * geometry selection, motion) is owned by each scene renderer, so this file
 * has no knowledge of any individual scene.
 */
export const RENDERER_BOID_SPECIES: readonly BoidSpecies[] = [
  BoidSpecies.Normal,
  BoidSpecies.Multicolor,
  BoidSpecies.Gold,
  BoidSpecies.Red,
  BoidSpecies.Blue,
];

export const PROFILED_BOID_SPECIES: BoidSpecies = BoidSpecies.Multicolor;
export const PROFILED_BOID_NEUTRAL_PROFILE = 'neutral';

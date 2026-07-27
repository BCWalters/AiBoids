import type { VisualStyle } from '../../sim/params';
import { PredatorSpecies } from '../../sim/Predator';
import type { PredatorCatchProfiles } from '../../sim/predatorCatchProfiles';
import { ARCADE_CREATURE_SIZES } from './ArcadeSceneRenderer3D';
import { FISHTANK_CREATURE_SIZES } from './FishtankSceneRenderer3D';
import { NATURE_CREATURE_SIZES } from './NatureSceneRenderer3D';

const BASE_BITE_RADIUS_FRACTION = 0.16;

function biteRadiusFraction(bodyLength: number, largestPreyLength: number): number {
  return Math.max(BASE_BITE_RADIUS_FRACTION, largestPreyLength / (2 * bodyLength));
}

function createPredatorCatchProfile(
  bodyLength: number,
  mouthOffsetFraction: number,
  largestPreyLength: number,
) {
  return {
    bodyLength,
    mouthOffsetFraction,
    biteRadiusFraction: biteRadiusFraction(bodyLength, largestPreyLength),
  };
}

const FISHTANK_LARGEST_PREY_LENGTH = Math.max(
  FISHTANK_CREATURE_SIZES.fish.length,
  FISHTANK_CREATURE_SIZES.butterflyfish.length,
);

// Measured from the authored local geometry: the fishtank barracuda's jaws sit
// ~0.675 body-lengths ahead of the model origin, and the shark's snout tip sits
// ~0.655 body-lengths ahead of it after SHARK_LENGTH_SCALE is applied.
export const FISHTANK_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: createPredatorCatchProfile(
    FISHTANK_CREATURE_SIZES.barracuda.length,
    0.675,
    FISHTANK_LARGEST_PREY_LENGTH,
  ),
  [PredatorSpecies.Monster]: createPredatorCatchProfile(
    FISHTANK_CREATURE_SIZES.shark.length,
    0.655,
    FISHTANK_LARGEST_PREY_LENGTH,
  ),
};

const NATURE_LARGEST_PREY_LENGTH = Math.max(
  NATURE_CREATURE_SIZES.boid.length,
  NATURE_CREATURE_SIZES.parrot.length,
);

// Measured from the authored local geometry: the hawk beak tip sits ~0.538
// body-lengths ahead of the origin, and the dragon's bent snout lands at
// ~0.532 body-lengths forward after the neck/head rotations.
export const NATURE_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: createPredatorCatchProfile(
    NATURE_CREATURE_SIZES.hawk.length,
    0.538,
    NATURE_LARGEST_PREY_LENGTH,
  ),
  [PredatorSpecies.Monster]: createPredatorCatchProfile(
    NATURE_CREATURE_SIZES.dragon.length,
    0.532,
    NATURE_LARGEST_PREY_LENGTH,
  ),
};

const ARCADE_LARGEST_PREY_LENGTH = Math.max(
  ARCADE_CREATURE_SIZES.boid.length,
  ARCADE_CREATURE_SIZES.parrot.length,
);

// Measured from the authored local geometry: the arcade predator's forward-most
// body vertex lands one full nominal body length ahead of the origin because
// createBirdGeometries spans the body from -length to +length along forward Y.
export const ARCADE_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: createPredatorCatchProfile(
    ARCADE_CREATURE_SIZES.predator.length,
    1,
    ARCADE_LARGEST_PREY_LENGTH,
  ),
  [PredatorSpecies.Monster]: createPredatorCatchProfile(
    ARCADE_CREATURE_SIZES.predator.length,
    1,
    ARCADE_LARGEST_PREY_LENGTH,
  ),
};

export function getPredatorCatchProfilesForStyle(style: VisualStyle): PredatorCatchProfiles {
  switch (style) {
    case 'fishtank':
      return FISHTANK_PREDATOR_CATCH_PROFILES;
    case 'nature':
      return NATURE_PREDATOR_CATCH_PROFILES;
    case 'arcade':
      return ARCADE_PREDATOR_CATCH_PROFILES;
    default:
      return {};
  }
}

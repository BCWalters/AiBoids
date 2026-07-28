import type { VisualStyle } from '../../sim/params';
import { PredatorSpecies } from '../../sim/Predator';
import type { PredatorCatchProfiles } from '../../sim/predatorCatchProfiles';
import { ARCADE_CREATURE_SIZES } from './ArcadeSceneRenderer3D';
import { FISHTANK_CREATURE_SIZES } from './FishtankSceneRenderer3D';
import { NATURE_CREATURE_SIZES } from './NatureSceneRenderer3D';

const BASE_BITE_RADIUS_FRACTION = 0.16;

/**
 * Absolute lower bound, in world units, on a predator's bite radius.
 *
 * #221 moved catches from an 18-unit sphere at the predator's centre to a much
 * smaller sphere at its mouth. That was right anatomically and catastrophic
 * behaviourally: predators went from ~6 catches per minute to 0.3 in arcade
 * (#237).
 *
 * The cause is not steering lag. Sampling every predator-frame over 5 seeds,
 * the mouth point gets within 3.5 units of a live boid in **0.00%** of frames;
 * even the closest 0.1% of approaches sit at ~6 units. A chase simply does not
 * produce closer passes than that under the current maxForce, so a 3.5-unit
 * bite sphere is almost never satisfied. First-order intercept prediction was
 * tried and rejected — it moved the catch rate by less than seed noise at
 * every lead-time cap from 0.25 s to 1 s.
 *
 * 12 was chosen by measurement as the smallest floor that restores the
 * pre-#221 rate: it yields 5.7 / 5.2 / 5.3 catches per minute in
 * arcade / nature / fishtank against a 6.0 / 6.0 / 6.0 baseline. The forward
 * mouth offset is retained, so catches still register at the head rather than
 * the belly — this only widens the gape.
 */
const MIN_BITE_RADIUS = 12;

function biteRadiusFraction(bodyLength: number, largestPreyLength: number): number {
  return Math.max(
    BASE_BITE_RADIUS_FRACTION,
    largestPreyLength / (2 * bodyLength),
    MIN_BITE_RADIUS / bodyLength,
  );
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

// Measured from the authored local geometry: the hawk beak tip sits ~0.558
// body-lengths ahead of the origin, and the dragon's bent snout lands at
// ~0.532 body-lengths forward after the neck/head rotations.
//
// The hawk figure moved from 0.538 when its beak was lengthened and hooked;
// predatorCatchProfiles.mouthOffset.test.ts re-measures the shipped geometry,
// so this constant has to be kept honest rather than left at its old value.
export const NATURE_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: createPredatorCatchProfile(
    NATURE_CREATURE_SIZES.hawk.length,
    0.558,
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

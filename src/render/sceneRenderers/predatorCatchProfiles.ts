import type { VisualStyle } from '../../sim/params';
import { PredatorSpecies } from '../../sim/Predator';
import type { PredatorCatchProfiles } from '../../sim/predatorCatchProfiles';
import { ARCADE_CREATURE_SIZES } from './ArcadeSceneRenderer3D';
import { FISHTANK_CREATURE_SIZES } from './FishtankSceneRenderer3D';
import { NATURE_CREATURE_SIZES } from './NatureSceneRenderer3D';

const BITE_RADIUS_FRACTION = 0.16;

// Measured from the authored local geometry: the fishtank barracuda's jaws sit
// ~0.675 body-lengths ahead of the model origin, and the shark's snout tip sits
// ~0.655 body-lengths ahead of it after SHARK_LENGTH_SCALE is applied.
export const FISHTANK_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: {
    bodyLength: FISHTANK_CREATURE_SIZES.barracuda.length,
    mouthOffsetFraction: 0.675,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
  [PredatorSpecies.Monster]: {
    bodyLength: FISHTANK_CREATURE_SIZES.shark.length,
    mouthOffsetFraction: 0.655,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
};

// Measured from the authored local geometry: the hawk beak tip sits ~0.538
// body-lengths ahead of the origin, and the dragon's bent snout lands at
// ~0.532 body-lengths forward after the neck/head rotations.
export const NATURE_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: {
    bodyLength: NATURE_CREATURE_SIZES.hawk.length,
    mouthOffsetFraction: 0.538,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
  [PredatorSpecies.Monster]: {
    bodyLength: NATURE_CREATURE_SIZES.dragon.length,
    mouthOffsetFraction: 0.532,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
};

export const ARCADE_PREDATOR_CATCH_PROFILES: PredatorCatchProfiles = {
  [PredatorSpecies.Normal]: {
    bodyLength: ARCADE_CREATURE_SIZES.predator.length,
    mouthOffsetFraction: 0.5,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
  [PredatorSpecies.Monster]: {
    bodyLength: ARCADE_CREATURE_SIZES.predator.length,
    mouthOffsetFraction: 0.5,
    biteRadiusFraction: BITE_RADIUS_FRACTION,
  },
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

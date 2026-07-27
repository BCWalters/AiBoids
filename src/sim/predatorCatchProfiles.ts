import type { PredatorSpecies } from './Predator';

export interface PredatorCatchProfile {
  bodyLength: number;
  mouthOffsetFraction: number;
  biteRadiusFraction: number;
}

export type PredatorCatchProfiles = Partial<Record<PredatorSpecies, PredatorCatchProfile>>;

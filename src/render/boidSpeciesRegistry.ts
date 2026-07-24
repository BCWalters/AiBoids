import * as THREE from 'three';
import { BoidSpecies } from '../sim/Boid';
import {
  NATURE_BOID_BASE,
  PARROT_NATURE_VARIANTS,
  GOLDFINCH_BODY_BASE,
  GOLDFINCH_WING_BASE,
  GOLDFINCH_TAIL_BASE,
  CARDINAL_BODY_BASE,
  CARDINAL_WING_BASE,
  CARDINAL_TAIL_BASE,
  BLUEJAY_BODY_BASE,
  BLUEJAY_WING_BASE,
  BLUEJAY_TAIL_BASE,
} from './sceneRenderers/NatureSceneRenderer3D';
import {
  ARCADE_BOID_EMISSIVE,
  ARCADE_BOID_BASE,
  ARCADE_PARROT_EMISSIVE,
  ARCADE_PARROT_BASE,
  ARCADE_GOLDFINCH_EMISSIVE,
  ARCADE_GOLDFINCH_BASE,
  ARCADE_CARDINAL_EMISSIVE,
  ARCADE_CARDINAL_BASE,
  ARCADE_BLUEJAY_EMISSIVE,
  ARCADE_BLUEJAY_BASE,
} from './sceneRenderers/ArcadeSceneRenderer3D';
import type { SpeciesColorSet } from './sceneRenderers/createSceneRendererHooks';

export interface RendererBoidSpeciesConfig {
  species: BoidSpecies;
  arcadeEmissive: THREE.Color;
  arcadeBase: THREE.Color;
  natureBase: THREE.Color;
  colors?: SpeciesColorSet;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
  beakColor?: THREE.Color;
  tailSwayPivotY?: number;
}

export const PROFILED_BOID_SPECIES: BoidSpecies = BoidSpecies.Multicolor;
export const PROFILED_BOID_NEUTRAL_PROFILE = 'neutral';

export const RENDERER_BOID_SPECIES_CONFIGS: RendererBoidSpeciesConfig[] = [
  {
    species: BoidSpecies.Normal,
    arcadeEmissive: ARCADE_BOID_EMISSIVE,
    arcadeBase: ARCADE_BOID_BASE,
    natureBase: NATURE_BOID_BASE,
    useSmallGeometry: true,
    beakColor: new THREE.Color(0x6b5a4a),
  },
  {
    species: BoidSpecies.Multicolor,
    arcadeEmissive: ARCADE_PARROT_EMISSIVE,
    arcadeBase: ARCADE_PARROT_BASE,
    natureBase: PARROT_NATURE_VARIANTS[0].colors.body,
    useSmallGeometry: false,
    useParrotGeometry: true,
    tailSwayPivotY: -4.186,
  },
  {
    species: BoidSpecies.Gold,
    arcadeEmissive: ARCADE_GOLDFINCH_EMISSIVE,
    arcadeBase: ARCADE_GOLDFINCH_BASE,
    natureBase: GOLDFINCH_BODY_BASE,
    colors: { body: GOLDFINCH_BODY_BASE, wing: GOLDFINCH_WING_BASE, tail: GOLDFINCH_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xf07820),
  },
  {
    species: BoidSpecies.Red,
    arcadeEmissive: ARCADE_CARDINAL_EMISSIVE,
    arcadeBase: ARCADE_CARDINAL_BASE,
    natureBase: CARDINAL_BODY_BASE,
    colors: { body: CARDINAL_BODY_BASE, wing: CARDINAL_WING_BASE, tail: CARDINAL_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xe84040),
  },
  {
    species: BoidSpecies.Blue,
    arcadeEmissive: ARCADE_BLUEJAY_EMISSIVE,
    arcadeBase: ARCADE_BLUEJAY_BASE,
    natureBase: BLUEJAY_BODY_BASE,
    colors: { body: BLUEJAY_BODY_BASE, wing: BLUEJAY_WING_BASE, tail: BLUEJAY_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0x8c8c8c),
  },
];

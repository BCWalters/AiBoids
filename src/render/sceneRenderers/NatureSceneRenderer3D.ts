import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import type { Boid, BoidSpecies } from '../../sim/Boid';
import type { DriftingClouds } from '../styles/nature/clouds';
import { placeNatureEnvironment, type NatureEnvironment } from '../styles/nature/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import type {
  FishtankBounds,
  SceneCreatureMaterialDefaults,
  SceneEnvironmentToggles,
  ScenePresentationSettings,
  SceneRendererHooks,
  ColourStrategy,
  MotionConfig,
  PredatorRenderFlags,
  StyleFlags,
  BoidMotionStyleFlags,
  BoidSpeciesConfig,
  SceneBoidInstanceConfig,
  ScenePredatorInstanceConfig,
  SpeciesColorSet,
} from './createSceneRendererHooks';

// --- Nature style color constants: matte, earth-toned plumage with realistic gradients
const NATURE_BOID_BASE = new THREE.Color(0xab8f68); // sandy tan-brown, contrasts against green ground
const NATURE_BOID_PANIC = new THREE.Color(0xf2e6c8); // paler alarm plumage
const NATURE_PREDATOR_BASE = new THREE.Color(0x7a3b22); // hawk rust-brown
const NATURE_PREDATOR_HUNT = new THREE.Color(0xc75a2e); // brighter when locked on

// Nature-style hawk (bald-eagle-inspired): body/wing/tail split
const NATURE_HAWK_HEAD_TINT = new THREE.Color(0xefece2); // near-white so baked head/torso/beak colors read as-authored
const NATURE_HAWK_WING = new THREE.Color(0x2a2018); // dark blackish-brown, matches the baked torso color
const NATURE_HAWK_TAIL = new THREE.Color(0xf2efe6); // genuinely white, matches the baked head color

const NATURE_HAWK_COLORS: SpeciesColorSet = { body: NATURE_HAWK_HEAD_TINT, wing: NATURE_HAWK_WING, tail: NATURE_HAWK_TAIL };

// Nature-style motion constants for predators and boids
const FLAP_FREQUENCY = 7.6; // radians/sec-ish; controls flap speed
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.9;
const DRAGON_FLAP_FREQUENCY = 2.15;
const DRAGON_FLAP_IDLE_AMPLITUDE = 0.4;
const DRAGON_FLAP_SPEED_AMPLITUDE = 0.85;
const DRAGON_TAIL_SWAY_AMPLITUDE = 0.22;
const _UNICORN_FLAP_FREQUENCY = 3.2;
const _UNICORN_FLAP_IDLE_AMPLITUDE = 0.22;
const _UNICORN_FLAP_SPEED_AMPLITUDE = 0.5;
const _UNICORN_BANK_SCALE = 0.35;
// Motion constants for boid/creature configuration
const _PARROT_FLAP_FREQUENCY = 5.4;
const _PARROT_FLAP_IDLE_AMPLITUDE = 0.4;
const _PARROT_FLAP_SPEED_AMPLITUDE = 0.95;
const _PARROT_TAIL_SWAY_AMPLITUDE = 0.12;

type ParrotGeometryProfile = 'neutral' | 'green-focus' | 'blue-gold-focus' | 'scarlet-focus' | 'purple-lavender-focus';

interface NatureParrotVariant {
  colors: SpeciesColorSet;
  geometryProfile: ParrotGeometryProfile;
}

const PARROT_NATURE_VARIANTS: NatureParrotVariant[] = [
  // Blue-and-gold macaw
  { colors: { body: new THREE.Color(0xffffff), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0xffffff) }, geometryProfile: 'blue-gold-focus' },
  // Scarlet-style red parrot with dedicated red/blue body gradient and blue/yellow wing gradient.
  { colors: { body: new THREE.Color(0xffffff), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0xffffff) }, geometryProfile: 'scarlet-focus' },
  // Purple parrot variant with purple/lavender gradients and lavender accents.
  { colors: { body: new THREE.Color(0xffffff), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0xffffff) }, geometryProfile: 'purple-lavender-focus' },
  // Focus pattern slot: pure green body/wing regions are driven by
  // parrotGeometry vertex tints; this stays near-white so those region
  // tints read as-authored. Tail keeps its own medium-bright green tint.
  {
    colors: { body: new THREE.Color(0xffffff), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0x44b749) },
    geometryProfile: 'green-focus',
  },
];
const NON_NEUTRAL_PARROT_PROFILES: ParrotGeometryProfile[] = ['green-focus', 'blue-gold-focus', 'scarlet-focus', 'purple-lavender-focus'];
// Keep null in normal operation so parrots rotate through all configured
// nature variants. Set to an index temporarily only during palette tuning.
const PARROT_FOCUS_PATTERN_INDEX: number | null = null;

// Small songbird nature-style vertex colour palettes (baked into geometry)
interface SmallBirdPalette {
  headBack: THREE.Color;
  tailBack: THREE.Color;
  headBelly: THREE.Color;
  tailBelly: THREE.Color;
  wing: THREE.Color;
  wingTip: THREE.Color;
  tail: THREE.Color;
  tailTip: THREE.Color;
  dorsalGradient: boolean;
  wingGradient: boolean;
  tailGradient: boolean;
}

const SPARROW_NATURE_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0x7a4a28), // rich warm brown on the head/crown
  tailBack:  new THREE.Color(0x6a6050), // gray-brown near the rump/tail
  headBelly: new THREE.Color(0x8c8070), // gray near the throat
  tailBelly: new THREE.Color(0xd8cfc0), // off-white on the lower belly/vent
  wing:    new THREE.Color(0x6a4832), // dark warm brown at wing root
  wingTip: new THREE.Color(0x2a1408), // very dark brown at tip
  tail:    new THREE.Color(0x584030), // dark brown tail base
  tailTip: new THREE.Color(0x281408), // near-black tail tip
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   true,
};

const GOLDFINCH_NATURE_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xf5d327), // bright yellow on crown/back
  tailBack:  new THREE.Color(0x1c1c1c), // black at rump
  headBelly: new THREE.Color(0xf5d327), // yellow near the breast
  tailBelly: new THREE.Color(0xf8ec80), // lighter/paler yellow toward lower belly
  wing:    new THREE.Color(0xf5d327), // gold at wing root (matches back/belly colour)
  wingTip: new THREE.Color(0x151505), // near-black at wing tip
  tail:    new THREE.Color(0x3a3a3a), // dark gray tail base (not pure black)
  tailTip: new THREE.Color(0x0d0d0d), // near-black tail tip
  dorsalGradient: true,
  wingGradient:   true, // yellow→black gradient on wings
  tailGradient:   true, // dark gray→black gradient on tail
};

const CARDINAL_NATURE_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xcc2936), // vivid deep red on the head/back
  tailBack:  new THREE.Color(0xe06070), // lighter/pinker red near the rump
  headBelly: new THREE.Color(0xd03545), // vivid red at the breast
  tailBelly: new THREE.Color(0xf09098), // salmon-pink at the lower belly/vent
  wing:    new THREE.Color(0x8f1f28), // dark red at wing root
  wingTip: new THREE.Color(0x3d0f14), // near-black red at tip
  tail:    new THREE.Color(0x8f1f28), // dark red tail base
  tailTip: new THREE.Color(0x3d0f14), // very dark red at tail tip
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   true,
};

const BLUEJAY_NATURE_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0x3b6fa0), // pure medium blue on the crown/back
  tailBack:  new THREE.Color(0x50a0d8), // brighter vivid blue near the rump/tail
  headBelly: new THREE.Color(0xb0c8df), // light blue-gray at throat/breast
  tailBelly: new THREE.Color(0xf0f4f8), // near-white on the lower belly/vent
  wing:    new THREE.Color(0x4070a8), // medium blue at wing root
  wingTip: new THREE.Color(0x1c3350), // navy blue at tip
  tail:    new THREE.Color(0x50a0d8), // bright blue tail base (matches tailBack)
  tailTip: new THREE.Color(0x1c3350), // navy at tail tip
  dorsalGradient: true,
  wingGradient:   true,
  tailGradient:   true,
};

// Dragon predator variant (nature style only): purple, leathery-winged
const DRAGON_PREDATOR_BASE = new THREE.Color(0x61339b); // matched to the visible root tone at the tail base
const DRAGON_PREDATOR_HUNT = new THREE.Color(0x7b4fc2); // brighter chase tint while staying in the same palette

// Unicorn predator (all styles): light lavender body, always upright
const NATURE_UNICORN_BODY = new THREE.Color(0xc9a8f0); // light lavender
const NATURE_UNICORN_HUNT = new THREE.Color(0xe8c9ff); // brighter pale lavender-pink when locked on
const NATURE_UNICORN_WING = new THREE.Color(0xf3ecff); // near-white so the rainbow vertex gradient reads clearly

// Nature-style unicorn predator colors
const NATURE_UNICORN_COLORS: SpeciesColorSet = { body: NATURE_UNICORN_BODY, wing: NATURE_UNICORN_WING, tail: NATURE_UNICORN_BODY };

// Small songbird base colors (used in species configs)
const GOLDFINCH_BODY_BASE = new THREE.Color(0xf5d327); // bright yellow chest/back
const GOLDFINCH_WING_BASE = new THREE.Color(0x1c1c1c); // black wings with contrast
const GOLDFINCH_TAIL_BASE = new THREE.Color(0x1c1c1c); // black tail

const CARDINAL_BODY_BASE = new THREE.Color(0xcc2936); // vivid red body
const CARDINAL_WING_BASE = new THREE.Color(0x8f1f28); // darker red wings
const CARDINAL_TAIL_BASE = new THREE.Color(0x3d0f14); // near-black red tail

const BLUEJAY_BODY_BASE = new THREE.Color(0x3b6fa0); // jay blue back
const BLUEJAY_WING_BASE = new THREE.Color(0xdfe8ef); // pale/white wing bars
const BLUEJAY_TAIL_BASE = new THREE.Color(0x1c3350); // navy tail

// Utility function for deterministic per-entity hashing (used for variant selection)
function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function getNatureParrotVariants(): NatureParrotVariant[] {
  if (PARROT_FOCUS_PATTERN_INDEX === null) return PARROT_NATURE_VARIANTS;
  return [PARROT_NATURE_VARIANTS[THREE.MathUtils.clamp(PARROT_FOCUS_PATTERN_INDEX, 0, PARROT_NATURE_VARIANTS.length - 1)]];
}

function getNatureParrotVariant(entity: Boid | Predator): NatureParrotVariant {
  const variants = getNatureParrotVariants();
  const baseIndex = Math.floor(idHash(entity.id, 42) * variants.length) % variants.length;
  if (params.galleryCreature === 'parrot') {
    const cycleStep = Math.floor(performance.now() / 3200);
    return variants[(baseIndex + cycleStep) % variants.length];
  }
  return variants[baseIndex];
}

interface NatureSceneRendererDependencies {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  driftingClouds: DriftingClouds;
  fishtankEnv: { setVisible: (visible: boolean) => void };
  natureEnv: NatureEnvironment;
  updateTransientEffects: (sim: Simulation, elapsed: number) => void;
  natureSparrowGeometries: CreatureGeometries;
  natureParrotGeometries: CreatureGeometries;
  natureParrotBlueGoldGeometries: CreatureGeometries;
  natureParrotScarletGeometries: CreatureGeometries;
  natureParrotPurpleLavenderGeometries: CreatureGeometries;
  natureParrotNeutralGeometries: CreatureGeometries;
  natureBoidGeometries: CreatureGeometries;
  natureSmallSpeciesGeometries: Map<BoidSpecies, CreatureGeometries>;
  naturePredatorGeometries: CreatureGeometries;
  dragonPredatorGeometries: CreatureGeometries;
  unicornPredatorGeometries: CreatureGeometries;
}

export class NatureSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: NatureSceneRendererDependencies;

  constructor(deps: NatureSceneRendererDependencies) {
    this.deps = deps;
  }

  setStyleVisibility(): void {
    this.deps.natureEnv.setVisible(true);
    this.deps.fishtankEnv.setVisible(false);
    this.deps.driftingClouds.setVisible(true);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
    _fishtankBounds: FishtankBounds,
  ): void {
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6,
      center.y + maxDim * 0.4,
      center.z + maxDim * 0.9,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  applyStyleTransition(
    sim: Simulation,
    maxDim: number,
    _fishtankBounds: FishtankBounds,
    wasFishtank: boolean,
  ): void {
    this.deps.controls.maxDistance = maxDim * 5.5;
    this.deps.controls.minPolarAngle = 0;
    this.deps.controls.maxPolarAngle = Math.PI;
    if (!wasFishtank) return;
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.deps.camera.position.set(
      center.x + maxDim * 0.6,
      center.y + maxDim * 0.4,
      center.z + maxDim * 0.9,
    );
    this.deps.controls.target.copy(center);
    this.deps.controls.update();
  }

  updateEnvironment(elapsed: number): void {
    this.deps.natureEnv.update(elapsed);
  }

  updateTransientEffects(sim: Simulation, elapsed: number): void {
    this.deps.updateTransientEffects(sim, elapsed);
  }

  configureEnvironmentAnchors(_sim: Simulation, center: THREE.Vector3, maxDim: number): void {
    placeNatureEnvironment(this.deps.natureEnv, center, maxDim * 30);
    this.deps.driftingClouds.configure(center, maxDim);
  }

  updateFrameAnchors(_sim: Simulation): void {}

  updateCameraClamp(_sim: Simulation): void {}

  applyEnvironmentToggles(toggles: SceneEnvironmentToggles): void {
    this.deps.natureEnv.setFogEnabled(toggles.fogEnabled);
    this.deps.natureEnv.setTimeOfDay(toggles.timeOfDay);
    this.deps.natureEnv.setLightShaftsEnabled(toggles.lightShaftsEnabled);
  }

  setShadowsEnabled(enabled: boolean): void {
    this.deps.natureEnv.sunLight.castShadow = enabled;
  }

  setGalleryCreatureActive(_active: boolean): void {}

  getPresentationSettings(): ScenePresentationSettings {
    return {
      bloomEnabled: false,
      afterimageEnabled: false,
      boundsHelperVisible: false,
      ambientLightIntensity: 0.55,
      keyLightVisible: false,
    };
  }

  getWorldScale(): number {
    return 1;
  }

  mapPositionToRenderSpace(x: number, y: number, z: number, target: THREE.Vector3): void {
    target.set(x, y, z);
  }

  getCreatureMaterialDefaults(): SceneCreatureMaterialDefaults {
    return {
      bodyEmissive: 0x000000,
      bodyEmissiveIntensity: 0,
      bodyRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingEmissive: 0x000000,
      wingEmissiveIntensity: 0,
      wingRoughness: (isDragon: boolean) => isDragon ? 0.65 : 0.9,
      wingColor: (_isDragon: boolean, _isFishtank: boolean) => 0xffffff,
    };
  }

  getPredatorColourStrategy(kind: string, renderFlags: PredatorRenderFlags): ColourStrategy {
    const { isDragon } = renderFlags;
    
    switch (kind) {
      case 'unicorn':
        return {
          baseColor: NATURE_UNICORN_BODY,
          highlightColor: NATURE_UNICORN_HUNT,
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
          getSpeciesColors: () => NATURE_UNICORN_COLORS,
        };
      
      case 'hawk':
        return {
          baseColor: isDragon ? DRAGON_PREDATOR_BASE : NATURE_PREDATOR_BASE,
          highlightColor: isDragon ? DRAGON_PREDATOR_HUNT : NATURE_PREDATOR_HUNT,
          getIntensity: (entity: Predator | Boid) => (entity as Predator).huntIntensity,
          // Plain nature hawks (not dragon) get the bald-eagle body/wing/tail colour split.
          getSpeciesColors: !isDragon ? () => NATURE_HAWK_COLORS : undefined,
        };
      
      default:
        throw new Error(`Unknown predator kind: ${kind}`);
    }
  }

  getPredatorMotionConfig(kind: string, renderFlags: PredatorRenderFlags): MotionConfig {
    const { isDragon } = renderFlags;
    
    switch (kind) {
      case 'unicorn':
        return {
          flapFrequency: _UNICORN_FLAP_FREQUENCY,
          flapIdleAmplitude: _UNICORN_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: _UNICORN_FLAP_SPEED_AMPLITUDE,
          keepUpright: true,
          uprightStyle: 'unicorn',
          bankScale: _UNICORN_BANK_SCALE,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      case 'hawk':
        return {
          flapFrequency: isDragon ? DRAGON_FLAP_FREQUENCY : FLAP_FREQUENCY,
          flapIdleAmplitude: isDragon ? DRAGON_FLAP_IDLE_AMPLITUDE : FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: isDragon ? DRAGON_FLAP_SPEED_AMPLITUDE : FLAP_SPEED_AMPLITUDE,
          keepUpright: isDragon,
          uprightStyle: 'dragon',
          tailSwayAxis: new THREE.Vector3(1, 0, 0), // MODEL_RIGHT_AXIS
          tailSwayAmplitude: isDragon ? DRAGON_TAIL_SWAY_AMPLITUDE : 0,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      default:
        throw new Error(`Unknown predator kind: ${kind}`);
    }
  }

  getBoidColourStrategy(species: string, config: BoidSpeciesConfig, flags: StyleFlags): ColourStrategy {
    const { isOrganic, isNature } = flags;
    const getColors = config.getColors;
    return {
      baseColor: isOrganic ? config.natureBase : config.arcadeBase,
      highlightColor: isOrganic ? NATURE_BOID_PANIC : new THREE.Color(0xffcc00), // arcade panic placeholder
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: config.colors || config.getColors ? true : isOrganic,
      getSpeciesColors: getColors
        ? (entity) => getColors(entity, flags)
        : (config.colors ? () => config.colors! : undefined),
      beakColor: config.beakColor,
      bakedWingPalette: true,
      bakedBodyGradient: isNature && (species === 'sparrow' || species === 'goldfinch' || species === 'cardinal' || species === 'bluejay'),
    };
  }

  getBoidMotionConfig(species: string, config: BoidSpeciesConfig, _flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const { isFishTail, isProfiledParrot } = boidMotionFlags;
    const isParrot = species === 'parrot';
    const tailSwayPivot = config.tailSwayPivotY ?? 0;
    
    return {
      flapFrequency: isParrot && isProfiledParrot ? _PARROT_FLAP_FREQUENCY : FLAP_FREQUENCY,
      flapIdleAmplitude: isParrot && isProfiledParrot ? _PARROT_FLAP_IDLE_AMPLITUDE : FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: isParrot && isProfiledParrot ? _PARROT_FLAP_SPEED_AMPLITUDE : FLAP_SPEED_AMPLITUDE,
      getScale: (entity) => (entity as Boid).scale,
      tailSwayAxis: isFishTail ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), // MODEL_UP_AXIS : MODEL_RIGHT_AXIS
      tailSwayAmplitude: isFishTail
        ? 0.06 // FISH_TAIL_SWAY_AMPLITUDE placeholder
        : isParrot && isProfiledParrot
          ? _PARROT_TAIL_SWAY_AMPLITUDE
          : DRAGON_TAIL_SWAY_AMPLITUDE,
      tailSwayFrequency: isFishTail ? 2.2 : undefined, // FISH_TAIL_SWAY_FREQUENCY placeholder
      tailSwayPivotY: isFishTail ? 0 : tailSwayPivot,
      worldScale: 1,
      meshScaleBoost: 1,
      preferUpright: true,
    };
  }

  getParrotColourStrategy(config: BoidSpeciesConfig, _flags: StyleFlags, bakedWingPalette: boolean): ColourStrategy {
    return {
      baseColor: config.natureBase,
      highlightColor: NATURE_BOID_PANIC,
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: (entity) => this.getParrotColorVariant(entity),
      beakColor: config.beakColor,
      bakedWingPalette,
      useNatureParrotPalette: true, // Always use nature parrot palette in nature renderer
      lockSpeciesPalette: PARROT_FOCUS_PATTERN_INDEX !== null,
    };
  }

  private getParrotColorVariant(entity: Boid | Predator): SpeciesColorSet {
    return getNatureParrotVariant(entity).colors;
  }

  getParrotGeometryProfile(entity: Boid | Predator, _flags: StyleFlags): string {
    return getNatureParrotVariant(entity).geometryProfile;
  }

  getParrotProfileNames(_flags: StyleFlags): string[] {
    return NON_NEUTRAL_PARROT_PROFILES;
  }

  getParrotProfileInstanceConfig(profile: string, _flags: StyleFlags): SceneBoidInstanceConfig {
    switch (profile) {
      case 'green-focus':
        return { geometries: this.deps.natureParrotGeometries, bodyVertexColors: true };
      case 'blue-gold-focus':
        return { geometries: this.deps.natureParrotBlueGoldGeometries, bodyVertexColors: true };
      case 'scarlet-focus':
        return { geometries: this.deps.natureParrotScarletGeometries, bodyVertexColors: true };
      case 'purple-lavender-focus':
        return { geometries: this.deps.natureParrotPurpleLavenderGeometries, bodyVertexColors: true };
      case 'neutral':
        return { geometries: this.deps.natureParrotNeutralGeometries, bodyVertexColors: true };
      default:
        throw new Error(`Unknown parrot profile: ${profile}`);
    }
  }

  getBoidInstanceConfig(species: BoidSpecies, config: BoidSpeciesConfig, _flags: StyleFlags): SceneBoidInstanceConfig {
    if (config.useSmallGeometry) {
      return { geometries: this.deps.natureSparrowGeometries, bodyVertexColors: true };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.deps.natureParrotGeometries, bodyVertexColors: true };
    }
    return {
      geometries: this.deps.natureSmallSpeciesGeometries.get(species) ?? this.deps.natureBoidGeometries,
      bodyVertexColors: true,
    };
  }

  getPredatorInstanceConfig(
    kind: 'hawk' | 'unicorn',
    _flags: StyleFlags,
    renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (kind) {
      case 'hawk':
        return {
          geometries: renderFlags.isDragon ? this.deps.dragonPredatorGeometries : this.deps.naturePredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case 'unicorn':
        return {
          geometries: this.deps.unicornPredatorGeometries,
          rainbowWings: true,
          bodyVertexColors: true,
        };
      default:
        throw new Error(`Unknown predator kind: ${kind}`);
    }
  }

  dispose(): void {
    this.deps.natureEnv.dispose();
    this.deps.driftingClouds.dispose();
  }
}

// Export nature-style color constants and types for use in Renderer3D
export {
  NATURE_BOID_BASE,
  NATURE_BOID_PANIC,
  NATURE_PREDATOR_BASE,
  NATURE_PREDATOR_HUNT,
  NATURE_HAWK_COLORS,
  PARROT_NATURE_VARIANTS,
  NON_NEUTRAL_PARROT_PROFILES,
  PARROT_FOCUS_PATTERN_INDEX,
  SPARROW_NATURE_PALETTE,
  GOLDFINCH_NATURE_PALETTE,
  CARDINAL_NATURE_PALETTE,
  BLUEJAY_NATURE_PALETTE,
  DRAGON_PREDATOR_BASE,
  DRAGON_PREDATOR_HUNT,
  NATURE_UNICORN_BODY,
  NATURE_UNICORN_HUNT,
  NATURE_UNICORN_WING,
  GOLDFINCH_BODY_BASE,
  GOLDFINCH_WING_BASE,
  GOLDFINCH_TAIL_BASE,
  CARDINAL_BODY_BASE,
  CARDINAL_WING_BASE,
  CARDINAL_TAIL_BASE,
  BLUEJAY_BODY_BASE,
  BLUEJAY_WING_BASE,
  BLUEJAY_TAIL_BASE,
  type ParrotGeometryProfile,
  type NatureParrotVariant,
  type SpeciesColorSet,
  type SmallBirdPalette,
};

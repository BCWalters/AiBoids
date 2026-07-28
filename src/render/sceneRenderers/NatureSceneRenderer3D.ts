import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../../sim/params';
import type { Simulation } from '../../sim/Simulation';
import type { Predator } from '../../sim/Predator';
import { type Boid, BoidSpecies } from '../../sim/Boid';
import type { DriftingClouds } from '../styles/nature/clouds';
import { placeNatureEnvironment, type NatureEnvironment } from '../styles/nature/environment';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import { disposeCreatureGeometries } from '../geometry/sharedGeometry';
import { computeDragonMouthTransform, createDragonGeometries } from '../styles/nature/geometry/dragonGeometry';
import { createHawkGeometries } from '../styles/nature/geometry/hawkGeometry';
import { createParrotGeometries } from '../styles/nature/geometry/parrotGeometry';
import { createRealisticBirdGeometries } from '../styles/nature/geometry/smallBirdGeometry';
import { createUnicornGeometries } from '../styles/nature/geometry/unicornGeometry';
import { DragonFireBreathController } from '../dragonFireBreathController';
import type { FireBreathEffects } from '../styles/nature/fireBreath';
import { applyDragonScaleShader, DRAGON_SCALE_CONFIG } from '../styles/nature/dragonScaleShader';
import { type CreatureSize, createCreatureSizer } from './creatureSizing';
import {
  PredatorSpecies,
  type SceneCreatureMaterialDefaults,
  type SceneEnvironmentToggles,
  type ScenePresentationSettings,
  type SceneRendererHooks,
  type ColorStrategy,
  type MotionConfig,
  type PredatorRenderFlags,
  type StyleFlags,
  type BoidMotionStyleFlags,
  type SceneBoidInstanceConfig,
  type ScenePredatorInstanceConfig,
  type SpeciesColorSet,
  type CreatureLabels,
} from './createSceneRendererHooks';

// --- Nature creature sizing: every nature creature is a factor of this
// single base creature size (the standard songbird/boid). No nature creature
// is sized relative to another creature or to another scene.
const NATURE_BASE_CREATURE: CreatureSize = { length: 9.1, width: 6.24 };
const natureSize = createCreatureSizer(NATURE_BASE_CREATURE);

export const NATURE_CREATURE_SIZES = {
  boid: natureSize(1),
  parrot: natureSize(1),
  // Small songbirds (goldfinch/cardinal/bluejay) read as noticeably smaller.
  smallBird: natureSize(0.75),
  // Sparrow — smaller still.
  sparrow: natureSize(0.525),
  // Hawk predator — 15.6 x 7.48 world units.
  hawk: natureSize(15.6 / NATURE_BASE_CREATURE.length, 7.48 / NATURE_BASE_CREATURE.width),
  // Dragon — a dramatically large beast, 45 x 19.8 world units.
  dragon: natureSize(45 / NATURE_BASE_CREATURE.length, 19.8 / NATURE_BASE_CREATURE.width),
  // Unicorn — a large, substantial creature, 36 x 14.85 world units.
  unicorn: natureSize(36 / NATURE_BASE_CREATURE.length, 14.85 / NATURE_BASE_CREATURE.width),
} as const;

// Blood-splatter burst world size for nature catches. Owned per-scene so it
// can be tuned independently of the other scenes.
const NATURE_BLOOD_SPLATTER_SCALE = 6.3;

/** Dragon mouth transform (fire-breath emit point), derived from the nature
 * dragon's own length — kept here so the fire-breath origin stays in sync
 * with the nature dragon geometry regardless of what that size is. */
const NATURE_DRAGON_MOUTH = computeDragonMouthTransform(NATURE_CREATURE_SIZES.dragon.length);

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
/**
 * Birds spend less of the beat on the power stroke than on the recovery, so
 * the wing snaps down and eases back up rather than tracing a pure sine.
 * Feathered birds are the most pronounced; the dragon's heavy membrane wings
 * and the unicorn's smaller wings are closer to even.
 */
const BIRD_DOWNSTROKE_FRACTION = 0.37;
const DRAGON_DOWNSTROKE_FRACTION = 0.43;
const UNICORN_DOWNSTROKE_FRACTION = 0.42;
/**
 * Legs were welded rigidly to the body. These give them a fore/aft swing off
 * the flap clock plus a speed-proportional backward tuck, so a creature at
 * cruise draws its legs up instead of dangling them. Birds tuck hard (it's most
 * of what real birds do with their legs in flight).
 *
 * The unicorn tucks nearly as hard despite being a horse, because it *flies* —
 * a galloping gait would read as wrong on a creature that never touches the
 * ground, so it retracts like landing gear instead. Its legs are a jointed
 * chain (see unicornGeometry's rig), and the knee amplifies whatever the hip
 * does, so these values produce a noticeably larger fold than the raw numbers
 * suggest.
 */
const BIRD_LEG_SWING_AMPLITUDE = 0.1;
const BIRD_LEG_TUCK_RAD = 0.34;
const DRAGON_LEG_SWING_AMPLITUDE = 0.13;
const DRAGON_LEG_TUCK_RAD = 0.22;
const UNICORN_LEG_SWING_AMPLITUDE = 0.13;
const UNICORN_LEG_TUCK_RAD = 0.3;
const DRAGON_FLAP_FREQUENCY = 2.15;
const DRAGON_FLAP_IDLE_AMPLITUDE = 0.4;
const DRAGON_FLAP_SPEED_AMPLITUDE = 0.85;
/**
 * Raises the bottom of the dragon's wingbeat by this many radians, leaving the
 * top of the stroke exactly unchanged at every speed (approach (a) from issue
 * #199). With the clip, the new max downstroke is 0.95 rad at full speed.
 *
 * Geometry rationale: the back leg claws extend to Z = −13.95 model units. The
 * wing's inner boundary at the back-leg Y (Y ≈ −12.24, wristAnchor X = 16.2)
 * reaches Z = −16.2 × sin(0.95) ≈ −13.19 units at the new stroke floor —
 * clearing the claws by ~0.76 units. Without the clip the same point sweeps to
 * Z ≈ −15.37 units (θ = 1.25 rad), well past the claw depth.
 */
const DRAGON_BOTTOM_CLIP_RAD = 0.30;
const DRAGON_TAIL_SWAY_AMPLITUDE = 0.22;
const HAWK_TAIL_SWAY_AMPLITUDE = 0.08;
// Hawks are large soaring raptors — they flap noticeably slower than the small
// passerines (FLAP_FREQUENCY = 7.6) or even parrots (_PARROT_FLAP_FREQUENCY =
// 5.4). A value of 3.5 rad/s sits between the dragon (2.15) and parrot (5.4)
// and reads as a heavy, powerful wingbeat rather than a frantic small-bird flap.
const HAWK_FLAP_FREQUENCY = 3.5;
const _UNICORN_FLAP_FREQUENCY = 3.2;
const _UNICORN_FLAP_IDLE_AMPLITUDE = 0.22;
const _UNICORN_FLAP_SPEED_AMPLITUDE = 0.5;
const _UNICORN_BANK_SCALE = 0.35;
// Motion constants for boid/creature configuration
const _PARROT_FLAP_FREQUENCY = 5.4;
const _PARROT_FLAP_IDLE_AMPLITUDE = 0.4;
const _PARROT_FLAP_SPEED_AMPLITUDE = 0.95;
const BIRD_TAIL_SWAY_AMPLITUDE = 0.07;
const PARROT_TAIL_SWAY_AMPLITUDE = 0.06;
const BIRD_TAIL_FLARE_STRENGTH = 0.3;

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

// Small songbird nature-style vertex color palettes (baked into geometry)
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
  tailGradientRootColor?: THREE.Color;
  tailGradientInterpolation?: 'rgb' | 'hsl';
  tailGradientRootHold?: number;
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

const GOLDFINCH_BACK_PLUMAGE_NEAR_TAIL = new THREE.Color(0x1c1c1c);
const GOLDFINCH_TAIL_REAR_TIP = new THREE.Color(0x000000);

export const GOLDFINCH_NATURE_PALETTE: SmallBirdPalette = {
  headBack:  new THREE.Color(0xf5d327), // bright yellow on crown/back
  tailBack:  GOLDFINCH_BACK_PLUMAGE_NEAR_TAIL, // black at rump
  headBelly: new THREE.Color(0xf5d327), // yellow near the breast
  tailBelly: new THREE.Color(0xf8ec80), // lighter/paler yellow toward lower belly
  wing:    new THREE.Color(0xf5d327), // gold at wing root (matches back/belly color)
  wingTip: new THREE.Color(0x151505), // near-black at wing tip
  tail:    new THREE.Color(0x3a3a3a), // dark gray tail base (not pure black)
  tailTip: GOLDFINCH_TAIL_REAR_TIP, // black tail tip
  dorsalGradient: true,
  wingGradient:   true, // yellow→black gradient on wings
  tailGradient:   true, // darkening back→black gradient on tail
  tailGradientRootColor: GOLDFINCH_BACK_PLUMAGE_NEAR_TAIL,
  tailGradientInterpolation: 'hsl',
  tailGradientRootHold: 0.08,
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
// Deepened one quarter of the way from the former 0x502a7f/0x7b4fc2 pair
// toward the near-black the tail fades to, which reads as a slightly richer
// purple while staying clearly purple. Going a full half of that distance was
// tried and is far too dark — at that point the whole dragon reads as black
// against the nature sky, because the tail's dark end is very close to black
// and the midpoint inherits most of that. Keep any further tuning well under
// ~0.3 of this span. The hunt tint is scaled by the same per-channel ratio so
// the rest/chase contrast is preserved rather than flattened by the darkening.
//
// These two now drive the whole dragon. The tail bakes a darkening MULTIPLIER
// (1 at the rump) rather than absolute colors, so its root follows whatever
// these resolve to and it darkens from there — no separate tail palette to
// keep in sync.
export const DRAGON_PREDATOR_BASE = new THREE.Color(0x3e2064); // deep body purple (per issue #73)
const DRAGON_PREDATOR_HUNT = new THREE.Color(0x5f3c99); // brighter chase tint in the same palette

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

// Per-species nature boid config. Owned by this scene so nature plumage, beaks
// and geometry selection can be tuned without touching other scenes.
interface NatureSpeciesConfig {
  natureBase: THREE.Color;
  colors?: SpeciesColorSet;
  beakColor?: THREE.Color;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
}

const NATURE_SPECIES_CONFIG: Record<BoidSpecies, NatureSpeciesConfig> = {
  [BoidSpecies.Normal]: {
    natureBase: NATURE_BOID_BASE,
    beakColor: new THREE.Color(0x6b5a4a),
    useSmallGeometry: true,
  },
  [BoidSpecies.Multicolor]: {
    natureBase: PARROT_NATURE_VARIANTS[0].colors.body,
    useParrotGeometry: true,
    useSmallGeometry: false,
  },
  [BoidSpecies.Gold]: {
    natureBase: GOLDFINCH_BODY_BASE,
    colors: { body: GOLDFINCH_BODY_BASE, wing: GOLDFINCH_WING_BASE, tail: GOLDFINCH_TAIL_BASE },
    beakColor: new THREE.Color(0x8a6446),
    useSmallGeometry: false,
  },
  [BoidSpecies.Red]: {
    natureBase: CARDINAL_BODY_BASE,
    colors: { body: CARDINAL_BODY_BASE, wing: CARDINAL_WING_BASE, tail: CARDINAL_TAIL_BASE },
    beakColor: new THREE.Color(0xe84040),
    useSmallGeometry: false,
  },
  [BoidSpecies.Blue]: {
    natureBase: BLUEJAY_BODY_BASE,
    colors: { body: BLUEJAY_BODY_BASE, wing: BLUEJAY_WING_BASE, tail: BLUEJAY_TAIL_BASE },
    beakColor: new THREE.Color(0x8c8c8c),
    useSmallGeometry: false,
  },
};

// Small-bird leg colors, baked into the small-bird geometry at construction
// time (see createRealisticBirdGeometries). Owned here because leg color is a
// nature small-bird geometry input, not a shared/runtime tint.
const SPARROW_LEGS_COLOR = new THREE.Color(0x7a6450);
const GOLDFINCH_LEGS_COLOR = new THREE.Color(0x8a7060);
const CARDINAL_LEGS_COLOR = new THREE.Color(0x8a6a5a);
const BLUEJAY_LEGS_COLOR = new THREE.Color(0x7a7060);

// Utility function for deterministic per-creature hashing (used for variant selection)
function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function getNatureParrotVariants(): NatureParrotVariant[] {
  if (PARROT_FOCUS_PATTERN_INDEX === null) return PARROT_NATURE_VARIANTS;
  return [PARROT_NATURE_VARIANTS[THREE.MathUtils.clamp(PARROT_FOCUS_PATTERN_INDEX, 0, PARROT_NATURE_VARIANTS.length - 1)]];
}

function getNatureParrotVariant(creature: Boid | Predator): NatureParrotVariant {
  const variants = getNatureParrotVariants();
  const baseIndex = Math.floor(idHash(creature.id, 42) * variants.length) % variants.length;
  if (params.galleryCreature === 'multicolor') {
    const cycleStep = Math.floor(performance.now() / 3200);
    return variants[(baseIndex + cycleStep) % variants.length];
  }
  return variants[baseIndex];
}

interface NatureSceneRendererDependencies {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  driftingClouds: DriftingClouds;
  /**
   * Lazy getter for the active NatureEnvironment.  Returns null when nature
   * is not the active style (env is disposed).  All methods that touch the
   * env must null-guard before use.
   */
  getNatureEnv: () => NatureEnvironment | null;
  fireBreathEffects: FireBreathEffects;
}

export class NatureSceneRenderer3D implements SceneRendererHooks {
  private readonly deps: NatureSceneRendererDependencies;

  // Nature owns and disposes its own creature geometries, sized from
  // NATURE_CREATURE_SIZES and colored from nature-local palettes/leg colors.
  // No other scene knows about these.
  private readonly boidGeometries: CreatureGeometries;
  private readonly sparrowGeometries: CreatureGeometries;
  private readonly smallSpeciesGeometries: Map<BoidSpecies, CreatureGeometries>;
  private readonly parrotGeometries: CreatureGeometries;
  private readonly parrotBlueGoldGeometries: CreatureGeometries;
  private readonly parrotScarletGeometries: CreatureGeometries;
  private readonly parrotPurpleLavenderGeometries: CreatureGeometries;
  private readonly parrotNeutralGeometries: CreatureGeometries;
  private readonly predatorGeometries: CreatureGeometries;
  private readonly dragonPredatorGeometries: CreatureGeometries;
  private readonly unicornPredatorGeometries: CreatureGeometries;

  // Nature owns its dragon fire-breath effect: the scene knows its creatures
  // breathe fire, so Renderer3D doesn't have to. Built from nature's own
  // dragon size + mouth transform and the shared fire-breath effect pool.
  private readonly dragonFireBreathController: DragonFireBreathController;

  constructor(deps: NatureSceneRendererDependencies) {
    this.deps = deps;

    this.dragonFireBreathController = new DragonFireBreathController({
      fireBreathEffects: deps.fireBreathEffects,
      dragonMouth: NATURE_DRAGON_MOUTH,
      dragonLength: NATURE_CREATURE_SIZES.dragon.length,
    });

    this.boidGeometries = createRealisticBirdGeometries(NATURE_CREATURE_SIZES.boid.length, NATURE_CREATURE_SIZES.boid.width);
    this.sparrowGeometries = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.sparrow.length,
      NATURE_CREATURE_SIZES.sparrow.width,
      SPARROW_LEGS_COLOR,
      SPARROW_NATURE_PALETTE,
    );
    const goldfinchGeometries = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
      GOLDFINCH_LEGS_COLOR,
      GOLDFINCH_NATURE_PALETTE,
    );
    const cardinalGeometries = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
      CARDINAL_LEGS_COLOR,
      CARDINAL_NATURE_PALETTE,
    );
    const bluejayGeometries = createRealisticBirdGeometries(
      NATURE_CREATURE_SIZES.smallBird.length,
      NATURE_CREATURE_SIZES.smallBird.width,
      BLUEJAY_LEGS_COLOR,
      BLUEJAY_NATURE_PALETTE,
    );
    this.smallSpeciesGeometries = new Map<BoidSpecies, CreatureGeometries>([
      [BoidSpecies.Gold, goldfinchGeometries],
      [BoidSpecies.Red, cardinalGeometries],
      [BoidSpecies.Blue, bluejayGeometries],
    ]);

    this.parrotGeometries = createParrotGeometries(NATURE_CREATURE_SIZES.parrot.length, NATURE_CREATURE_SIZES.parrot.width, 'green-focus');
    this.parrotBlueGoldGeometries = createParrotGeometries(NATURE_CREATURE_SIZES.parrot.length, NATURE_CREATURE_SIZES.parrot.width, 'blue-gold-focus');
    this.parrotScarletGeometries = createParrotGeometries(NATURE_CREATURE_SIZES.parrot.length, NATURE_CREATURE_SIZES.parrot.width, 'scarlet-focus');
    this.parrotPurpleLavenderGeometries = createParrotGeometries(NATURE_CREATURE_SIZES.parrot.length, NATURE_CREATURE_SIZES.parrot.width, 'purple-lavender-focus');
    this.parrotNeutralGeometries = createParrotGeometries(NATURE_CREATURE_SIZES.parrot.length, NATURE_CREATURE_SIZES.parrot.width, 'neutral');

    this.predatorGeometries = createHawkGeometries(NATURE_CREATURE_SIZES.hawk.length, NATURE_CREATURE_SIZES.hawk.width);
    this.dragonPredatorGeometries = createDragonGeometries(NATURE_CREATURE_SIZES.dragon.length, NATURE_CREATURE_SIZES.dragon.width);
    this.unicornPredatorGeometries = createUnicornGeometries(NATURE_CREATURE_SIZES.unicorn.length, NATURE_CREATURE_SIZES.unicorn.width);
  }

  setStyleVisibility(): void {
    // The nature env is created and revealed by LazyEnvProvider on switch.
    // The fishtank env has been disposed (null); nothing to hide here.
    this.deps.driftingClouds.setVisible(true);
  }

  configureInitialFraming(
    sim: Simulation,
    maxDim: number,
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
    wasFishtank: boolean,
  ): void {
    this.deps.controls.maxDistance = maxDim * 2.5;
    this.deps.controls.minPolarAngle = 0;
    // Prevent the camera from orbiting far below the horizon — extreme
    // sub-ground angles expose the terrain plane's edge from beneath.
    // PI * 0.75 = 135° from zenith, i.e. 45° below the horizon.
    this.deps.controls.maxPolarAngle = Math.PI * 0.75;
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
    this.deps.getNatureEnv()?.update(elapsed);
  }

  updateSpecialCreatureEffects(
    sim: Simulation,
    elapsed: number,
    dragonDisplayQuats: Map<number, THREE.Quaternion>,
  ): void {
    this.dragonFireBreathController.update(
      sim.predators,
      elapsed,
      dragonDisplayQuats,
      params.predatorMaxSpeed,
    );
  }

  configureEnvironmentAnchors(_sim: Simulation, center: THREE.Vector3, maxDim: number): void {
    const env = this.deps.getNatureEnv();
    if (env) {
      placeNatureEnvironment(env, center, maxDim * 30);
    }
    // Always configure drifting clouds regardless of whether the nature env
    // exists — clouds are always-resident and need positioning for when nature
    // is next activated.
    this.deps.driftingClouds.configure(center, maxDim);
  }

  updateFrameAnchors(_sim: Simulation): void {}

  updateCameraClamp(_sim: Simulation): void {}

  applyEnvironmentToggles(toggles: SceneEnvironmentToggles): void {
    const env = this.deps.getNatureEnv();
    if (!env) return;
    env.setFogEnabled(toggles.fogEnabled);
    env.setTimeOfDay(toggles.timeOfDay);
    env.setLightShaftsEnabled(toggles.lightShaftsEnabled);
  }

  setShadowsEnabled(enabled: boolean): void {
    const env = this.deps.getNatureEnv();
    if (!env) return;
    env.sunLight.castShadow = enabled;
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

  getCreatureMeshScaleBoost(): number {
    // Nature renders creatures at their base geometry scale (no per-species boost).
    return 1;
  }

  getBloodSplatterScale(): number {
    return NATURE_BLOOD_SPLATTER_SCALE;
  }

  mapPositionToRenderSpace(x: number, y: number, z: number, target: THREE.Vector3): void {
    target.set(x, y, z);
  }

  getCreatureMaterialDefaults(): SceneCreatureMaterialDefaults {
    return {
      bodyEmissive: 0x000000,
      bodyEmissiveIntensity: 0,
      bodyRoughness: (isMonster: boolean) => isMonster ? 0.65 : 0.9,
      wingEmissive: 0x000000,
      wingEmissiveIntensity: 0,
      wingRoughness: (isMonster: boolean) => isMonster ? 0.65 : 0.9,
      wingColor: (_isMonster: boolean, _isFishtank: boolean) => 0xffffff,
    };
  }

  getPredatorColorStrategy(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): ColorStrategy {
    
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          baseColor: NATURE_UNICORN_BODY,
          highlightColor: NATURE_UNICORN_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          getSpeciesColors: () => NATURE_UNICORN_COLORS,
          colorMode: 'speciesTint',
        };
      
      case PredatorSpecies.Monster:
        return {
          baseColor: DRAGON_PREDATOR_BASE,
          highlightColor: DRAGON_PREDATOR_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          colorMode: 'dragon',
        };
      
      case PredatorSpecies.Normal:
        return {
          baseColor: NATURE_PREDATOR_BASE,
          highlightColor: NATURE_PREDATOR_HUNT,
          getIntensity: (creature: Predator | Boid) => (creature as Predator).huntIntensity,
          getSpeciesColors: () => NATURE_HAWK_COLORS,
          colorMode: 'speciesTint',
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getPredatorMotionConfig(species: PredatorSpecies, _renderFlags: PredatorRenderFlags): MotionConfig {
    
    switch (species) {
      case PredatorSpecies.Horse:
        return {
          flapFrequency: _UNICORN_FLAP_FREQUENCY,
          flapIdleAmplitude: _UNICORN_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: _UNICORN_FLAP_SPEED_AMPLITUDE,
          flapDownstrokeFraction: UNICORN_DOWNSTROKE_FRACTION,
          legSwingAmplitude: UNICORN_LEG_SWING_AMPLITUDE,
          legTuckRad: UNICORN_LEG_TUCK_RAD,
          keepUpright: true,
          uprightStyle: 'unicorn',
          bankScale: _UNICORN_BANK_SCALE,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      case PredatorSpecies.Monster:
        return {
          flapFrequency: DRAGON_FLAP_FREQUENCY,
          flapIdleAmplitude: DRAGON_FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: DRAGON_FLAP_SPEED_AMPLITUDE,
          flapDownstrokeFraction: DRAGON_DOWNSTROKE_FRACTION,
          flapBottomClipRad: DRAGON_BOTTOM_CLIP_RAD,
          legSwingAmplitude: DRAGON_LEG_SWING_AMPLITUDE,
          legTuckRad: DRAGON_LEG_TUCK_RAD,
          keepUpright: true,
          uprightStyle: 'dragon',
          tailSwayAmplitude: DRAGON_TAIL_SWAY_AMPLITUDE,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      case PredatorSpecies.Normal:
        return {
          flapFrequency: HAWK_FLAP_FREQUENCY,
          flapIdleAmplitude: FLAP_IDLE_AMPLITUDE,
          flapSpeedAmplitude: FLAP_SPEED_AMPLITUDE,
          flapDownstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
          legSwingAmplitude: BIRD_LEG_SWING_AMPLITUDE,
          legTuckRad: BIRD_LEG_TUCK_RAD,
          keepUpright: false,
          // preferUpright anchors the hawk's dorsal to world-up each frame via
          // setPersistedUprightBasis (cross-product basis from world-up). Without
          // this, setFromUnitVectors((0,1,0), heading) is used instead — that
          // produces the minimal rotation between those two vectors, which does
          // NOT preserve world-up alignment for arbitrary headings, resulting in
          // the hawk spending ~43% of frames inverted. With preferUpright the
          // hawk still banks up to ±42° in turns and pitches ±18° during climbs/
          // dives, giving plenty of dynamic lean without ever flipping upside down.
          preferUpright: true,
          tailSwayAmplitude: HAWK_TAIL_SWAY_AMPLITUDE,
          worldScale: 1,
          meshScaleBoost: 1,
        };
      
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getBoidColorStrategy(species: BoidSpecies, _flags: StyleFlags): ColorStrategy {
    // Nature scene is always organic — baseColor uses each species' nature
    // plumage, songbirds get individual HSL variation, and the small-bird
    // species render through a baked body/wing/tail vertex gradient.
    const config = NATURE_SPECIES_CONFIG[species];
    const isBakedSmallBird = species === BoidSpecies.Normal
      || species === BoidSpecies.Gold
      || species === BoidSpecies.Red
      || species === BoidSpecies.Blue;
    return {
      baseColor: config.natureBase,
      highlightColor: NATURE_BOID_PANIC,
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: species === BoidSpecies.Multicolor
        ? (creature) => this.getParrotColorVariant(creature)
        : (config.colors ? () => config.colors! : undefined),
      beakColor: config.beakColor,
      bakedBodyGradient: isBakedSmallBird,
      colorMode: isBakedSmallBird ? 'smallBird' : 'parrot',
    };
  }

  getBoidMotionConfig(species: BoidSpecies, _flags: StyleFlags, boidMotionFlags: BoidMotionStyleFlags): MotionConfig {
    const { isProfiledParrot } = boidMotionFlags;
    const isParrot = species === BoidSpecies.Multicolor;

    return {
      flapFrequency: isParrot && isProfiledParrot ? _PARROT_FLAP_FREQUENCY : FLAP_FREQUENCY,
      flapIdleAmplitude: isParrot && isProfiledParrot ? _PARROT_FLAP_IDLE_AMPLITUDE : FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: isParrot && isProfiledParrot ? _PARROT_FLAP_SPEED_AMPLITUDE : FLAP_SPEED_AMPLITUDE,
      flapDownstrokeFraction: BIRD_DOWNSTROKE_FRACTION,
      legSwingAmplitude: BIRD_LEG_SWING_AMPLITUDE,
      legTuckRad: BIRD_LEG_TUCK_RAD,
      getScale: (creature) => (creature as Boid).scale,
      tailSwayAmplitude: isParrot && isProfiledParrot
        ? PARROT_TAIL_SWAY_AMPLITUDE
        : BIRD_TAIL_SWAY_AMPLITUDE,
      tailSwayFrequency: undefined,
      tailFlareStrength: BIRD_TAIL_FLARE_STRENGTH,
      worldScale: 1,
      meshScaleBoost: 1,
      preferUpright: true,
    };
  }

  getParrotColorStrategy(_flags: StyleFlags, bakedWingPalette: boolean): ColorStrategy {
    const parrotConfig = NATURE_SPECIES_CONFIG[BoidSpecies.Multicolor];
    return {
      baseColor: parrotConfig.natureBase,
      highlightColor: NATURE_BOID_PANIC,
      getIntensity: (creature) => (creature as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: (creature) => this.getParrotColorVariant(creature),
      beakColor: parrotConfig.beakColor,
      preserveBakedPartPalette: bakedWingPalette,
      lockSpeciesPalette: PARROT_FOCUS_PATTERN_INDEX !== null,
      colorMode: 'parrot',
    };
  }

  private getParrotColorVariant(creature: Boid | Predator): SpeciesColorSet {
    return getNatureParrotVariant(creature).colors;
  }

  getParrotGeometryProfile(creature: Boid | Predator, _flags: StyleFlags): string {
    return getNatureParrotVariant(creature).geometryProfile;
  }

  getParrotProfileNames(_flags: StyleFlags): string[] {
    return NON_NEUTRAL_PARROT_PROFILES;
  }

  getParrotProfileInstanceConfig(profile: string, _flags: StyleFlags): SceneBoidInstanceConfig {
    switch (profile) {
      case 'green-focus':
        return { geometries: this.parrotGeometries, bodyVertexColors: true };
      case 'blue-gold-focus':
        return { geometries: this.parrotBlueGoldGeometries, bodyVertexColors: true };
      case 'scarlet-focus':
        return { geometries: this.parrotScarletGeometries, bodyVertexColors: true };
      case 'purple-lavender-focus':
        return { geometries: this.parrotPurpleLavenderGeometries, bodyVertexColors: true };
      case 'neutral':
        return { geometries: this.parrotNeutralGeometries, bodyVertexColors: true };
      default:
        throw new Error(`Unknown parrot profile: ${profile}`);
    }
  }

  getBoidInstanceConfig(species: BoidSpecies, _flags: StyleFlags): SceneBoidInstanceConfig {
    const config = NATURE_SPECIES_CONFIG[species];
    if (config.useSmallGeometry) {
      return { geometries: this.sparrowGeometries, bodyVertexColors: true };
    }
    if (config.useParrotGeometry) {
      return { geometries: this.parrotGeometries, bodyVertexColors: true };
    }
    return {
      geometries: this.smallSpeciesGeometries.get(species) ?? this.boidGeometries,
      bodyVertexColors: true,
    };
  }

  getPredatorInstanceConfig(
    species: PredatorSpecies,
    _flags: StyleFlags,
    _renderFlags: PredatorRenderFlags,
  ): ScenePredatorInstanceConfig {
    switch (species) {
      case PredatorSpecies.Normal:
        return {
          geometries: this.predatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case PredatorSpecies.Monster:
        return {
          geometries: this.dragonPredatorGeometries,
          rainbowWings: false,
          bodyVertexColors: true,
        };
      case PredatorSpecies.Horse:
        return {
          geometries: this.unicornPredatorGeometries,
          rainbowWings: true,
          bodyVertexColors: true,
        };
      default:
        throw new Error(`Unknown predator species: ${species}`);
    }
  }

  getCreatureLabels(): CreatureLabels {
    return {
      boid: {
        normal: 'Sparrow',
        multicolor: 'Parrot',
        gold: 'Goldfinch',
        red: 'Cardinal',
        blue: 'Blue Jay',
      },
      predator: {
        normal: 'Hawk',
        monster: 'Dragon',
        horse: 'Unicorn',
      },
    };
  }

  patchBodyMaterial(material: THREE.MeshStandardMaterial, geometries: CreatureGeometries): void {
    if (geometries === this.dragonPredatorGeometries) {
      applyDragonScaleShader(material, geometries.body, DRAGON_SCALE_CONFIG);
    }
  }

  patchTailMaterial(material: THREE.MeshStandardMaterial, geometries: CreatureGeometries): void {
    if (geometries === this.dragonPredatorGeometries) {
      // Deliberately passes the BODY geometry, not the tail's own. The shader
      // derives its cell size from the geometry's Z span, and the tail's span
      // (1.490 wu) is 2.2x the body's (0.672) because the tail sweeps far in Z
      // while the body is a slim tube. Passing the tail here would render its
      // scales 2.2x oversized and the mismatch would land right at the joint.
      //
      // The pattern is keyed on rest-space model position and both geometries
      // are authored in the same model space, so one shared frequency also
      // makes the scale rows run continuously from body onto tail rather than
      // restarting at the seam.
      applyDragonScaleShader(material, geometries.body, DRAGON_SCALE_CONFIG);
    }
  }

  patchWingMaterial(material: THREE.MeshStandardMaterial, geometries: CreatureGeometries): void {
    if (geometries === this.dragonPredatorGeometries) {
      // Body geometry again, for the same shared-cell-size reason as the tail.
      //
      // The 'yx' plane is required here: the wing is a near-flat panel in XY
      // (Z span 0.138 against X 2.796 / Y 2.527), so the body's 'yz' plane
      // would freeze the pattern's second coordinate and render stripes
      // running out along the span instead of scales.
      applyDragonScaleShader(material, geometries.body, DRAGON_SCALE_CONFIG, 'yx');
    }
  }

  dispose(): void {
    // The nature env is owned by LazyEnvProvider and disposed there — do not
    // call dispose() on it here to avoid a double-dispose.
    this.deps.driftingClouds.dispose();
    disposeCreatureGeometries(this.boidGeometries);
    disposeCreatureGeometries(this.sparrowGeometries);
    for (const geometries of this.smallSpeciesGeometries.values()) {
      disposeCreatureGeometries(geometries);
    }
    disposeCreatureGeometries(this.parrotGeometries);
    disposeCreatureGeometries(this.parrotBlueGoldGeometries);
    disposeCreatureGeometries(this.parrotScarletGeometries);
    disposeCreatureGeometries(this.parrotPurpleLavenderGeometries);
    disposeCreatureGeometries(this.parrotNeutralGeometries);
    disposeCreatureGeometries(this.predatorGeometries);
    disposeCreatureGeometries(this.dragonPredatorGeometries);
    disposeCreatureGeometries(this.unicornPredatorGeometries);
  }
}

// NATURE_HAWK_COLORS is consumed by the hawk geometry builder.
export { NATURE_HAWK_COLORS };
// Exported for unit tests that assert hawk flap frequency intent is preserved.
export { HAWK_FLAP_FREQUENCY, FLAP_FREQUENCY };
// Exported for unit tests that assert gallery flap amplitude tracks simulation.
export { FLAP_IDLE_AMPLITUDE, FLAP_SPEED_AMPLITUDE };

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { params, type TimeOfDayPreset, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import type { Boid, BoidSpecies } from '../sim/Boid';
import type { Predator, PredatorKind } from '../sim/Predator';
import { createBirdGeometries, createRealisticBirdGeometries } from './styles/nature/geometry/smallBirdGeometry';
import type { SmallBirdPalette } from './styles/nature/geometry/smallBirdGeometry';
import { createHawkGeometries } from './styles/nature/geometry/hawkGeometry';
import { createParrotGeometries } from './styles/nature/geometry/parrotGeometry';
import { createDragonGeometries, computeDragonMouthTransform } from './styles/nature/geometry/dragonGeometry';
import { createUnicornGeometries } from './styles/nature/geometry/unicornGeometry';
import type { CreatureGeometries } from './geometry/sharedGeometry';
import { createNatureEnvironment, placeNatureEnvironment, type NatureEnvironment } from './styles/nature/environment';
import {
  createFishtankEnvironment,
  placeFishtankEnvironment,
  computeFishtankRoomBounds,
  TANK_VISUAL_SCALE,
  type FishtankEnvironment,
} from './styles/fishtank/environment';
import { createFishGeometries as createFishtankFishGeometries } from './styles/fishtank/geometry/smallFishGeometry';
import { createButterflyfishGeometries } from './styles/fishtank/geometry/butterflyfishGeometry';
import { createSharkGeometries as createFishtankSharkGeometries, getSharkTailPivotY } from './styles/fishtank/geometry/sharkGeometry';
import { createSeaHorseGeometries as createFishtankSeaHorseGeometries } from './styles/fishtank/geometry/seaHorseGeometry';
import { createDriftingClouds, type DriftingClouds } from './styles/nature/clouds';
import { createBloodEffects, type BloodEffects } from './bloodEffects';
import { createFireBreathEffects, type FireBreathEffects } from './styles/nature/fireBreath';
import { createUFOVisual, type UFOVisual } from './ufoEffects';
import { UFO_BEAM_REACH } from '../sim/UFO';

// --- "Arcade" style: bright, saturated emissive colors so the bloom pass
// has something to glow — base material color stays neutral (driven
// per-instance) so contrast against the dark background comes mostly
// from emissive light.
const ARCADE_BOID_EMISSIVE = new THREE.Color(0x5ad1ff);
const ARCADE_PREDATOR_EMISSIVE = new THREE.Color(0xff2a2a);
const ARCADE_BOID_BASE = new THREE.Color(0x2ab6e8);
const ARCADE_BOID_PANIC = new THREE.Color(0xffe066);
const ARCADE_PREDATOR_BASE = new THREE.Color(0xb31f1f);
const ARCADE_PREDATOR_HUNT = new THREE.Color(0xffffff);

// --- "Nature" style: matte, earth-toned plumage. No emissive glow —
// contrast comes from the sun-lit sky/ground environment instead.
const NATURE_BOID_BASE = new THREE.Color(0xab8f68); // sandy tan-brown, contrasts against green ground
const NATURE_BOID_PANIC = new THREE.Color(0xf2e6c8); // paler alarm plumage
const NATURE_PREDATOR_BASE = new THREE.Color(0x7a3b22); // hawk rust-brown
const NATURE_PREDATOR_HUNT = new THREE.Color(0xc75a2e); // brighter when locked on

// --- Nature-style hawk (bald-eagle-inspired, see geometry/hawkGeometry.ts):
// body/wing/tail split, mirroring the parrot/goldfinch/cardinal/bluejay
// pattern, rather than one flat NATURE_PREDATOR_BASE tint (the hawk now
// has its own dedicated geometry with baked white-head/dark-torso/yellow-
// beak vertex colors, which only show through correctly if the per-
// instance "body" tint stays close to white — see hawkGeometry.ts's doc
// comment on the tint-multiplies-vertex-color math). Wing and tail are
// separate InstancedMesh parts (no vertex-bake needed there), so they can
// just get plain, genuinely dark-brown/white instance tints directly —
// a real bald eagle's tail is white too, a free extra accuracy win.
const NATURE_HAWK_HEAD_TINT = new THREE.Color(0xefece2); // near-white so baked head/torso/beak colors read as-authored
const NATURE_HAWK_WING = new THREE.Color(0x2a2018); // dark blackish-brown, matches the baked torso color
const NATURE_HAWK_TAIL = new THREE.Color(0xf2efe6); // genuinely white, matches the baked head color
const NATURE_HAWK_COLORS: SpeciesColorSet = { body: NATURE_HAWK_HEAD_TINT, wing: NATURE_HAWK_WING, tail: NATURE_HAWK_TAIL };

// --- Parrot boid species: vivid multi-hued macaw-style plumage instead of
// the sparrow-type boid's earth tones. Body/wing/tail get distinct colors
// (rather than one flat tint) since that's the single biggest visual cue
// that reads as "parrot" vs. "sparrow" from a distance — see updateInstances'
// getSpeciesColors handling. Rendered via their own InstancedMesh set (see
// parrotInstances) rather than sharing the sparrow-type boid's instances,
// specifically so arcade style can give them a distinct emissive color too
// (emissive is a material-level property — shared instances would force
// identical bloom-glow color regardless of per-instance diffuse tint).
//
// Rather than one flat parrot palette, pick from a handful of real-world
// macaw/parrot color patterns per-individual (see PARROT_NATURE_VARIANTS'
// use in getParrotColors below) so the flock reads as visually diverse
// rather than a uniform species, the way small songbirds do (goldfinch/
// cardinal/bluejay are each their own distinct color already; a single-
// hue parrot stood out as flatter/less varied than those by comparison).
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
const ARCADE_PARROT_EMISSIVE = new THREE.Color(0xe030c8);
const ARCADE_PARROT_BASE = new THREE.Color(0xd048c0);

// Fish tank style only: the parrot species' butterflyfish reskin gets its
// own distinct set of color patterns (real-world butterflyfish are
// commonly yellow/white/orange/blue, often striped combinations of
// those) rather than reusing the nature style's macaw palette above —
// see getParrotColors' visualStyle branch below. `body` is the tinted,
// stripe-alternating hue (multiplied onto WHITE_VERTEX_COLOR in
// butterflyfishGeometry.ts); `wing`/`tail` pick complementary accent
// colors for the pectoral fins and caudal fin.
const BUTTERFLYFISH_COLOR_PATTERNS: SpeciesColorSet[] = [
  // Yellow longnose-style: golden body, blue accents
  { body: new THREE.Color(0xf5c518), wing: new THREE.Color(0x1f6fd8), tail: new THREE.Color(0xf5c518) },
  // Orange/white banded
  { body: new THREE.Color(0xf07a1f), wing: new THREE.Color(0xffffff), tail: new THREE.Color(0xf07a1f) },
  // Blue-and-yellow (raccoon-style)
  { body: new THREE.Color(0x2f8fd0), wing: new THREE.Color(0xf5c518), tail: new THREE.Color(0x2f8fd0) },
  // White with orange accents
  { body: new THREE.Color(0xf2ede0), wing: new THREE.Color(0xf07a1f), tail: new THREE.Color(0xf2ede0) },
  // Orange-and-blue (copperband-style)
  { body: new THREE.Color(0xe8981a), wing: new THREE.Color(0x2f6fdc), tail: new THREE.Color(0xe8981a) },
];

// --- Three more songbird species, each with distinct multi-part plumage
// (body/wing/tail) and their own arcade emissive/base color so every
// species reads as visually distinct in both visual styles. Each gets its
// own InstancedMesh set for the same reason parrots do (see above).
const GOLDFINCH_BODY_BASE = new THREE.Color(0xf5d327); // bright yellow chest/back
const GOLDFINCH_WING_BASE = new THREE.Color(0x1c1c1c); // black wings with contrast
const GOLDFINCH_TAIL_BASE = new THREE.Color(0x1c1c1c); // black tail
const ARCADE_GOLDFINCH_EMISSIVE = new THREE.Color(0xffe017);
const ARCADE_GOLDFINCH_BASE = new THREE.Color(0xc7b21a);

const CARDINAL_BODY_BASE = new THREE.Color(0xcc2936); // vivid red body
const CARDINAL_WING_BASE = new THREE.Color(0x8f1f28); // darker red wings
const CARDINAL_TAIL_BASE = new THREE.Color(0x3d0f14); // near-black red tail
const ARCADE_CARDINAL_EMISSIVE = new THREE.Color(0xff8c1a); // orange-red, distinct from predator red
const ARCADE_CARDINAL_BASE = new THREE.Color(0xcc5c14);

const BLUEJAY_BODY_BASE = new THREE.Color(0x3b6fa0); // jay blue back
const BLUEJAY_WING_BASE = new THREE.Color(0xdfe8ef); // pale/white wing bars
const BLUEJAY_TAIL_BASE = new THREE.Color(0x1c3350); // navy tail
const ARCADE_BLUEJAY_EMISSIVE = new THREE.Color(0x3aa0ff);
const ARCADE_BLUEJAY_BASE = new THREE.Color(0x2d6fb0);

// Per-species nature-style vertex colour palettes for small songbirds.
// Baked into dedicated per-species geometry instances so each flock has a
// realistic gradient instead of a flat per-instance tint.
const SPARROW_NATURE_PALETTE: SmallBirdPalette = {
  // Back: warm brown at head → gray-brown toward tail
  headBack:  new THREE.Color(0x7a4a28), // rich warm brown on the head/crown
  tailBack:  new THREE.Color(0x6a6050), // gray-brown near the rump/tail
  // Belly: cool gray at beak → off-white toward tail
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
  // Back: bright yellow at head → black toward tail (classic goldfinch pattern)
  headBack:  new THREE.Color(0xf5d327), // bright yellow on crown/back
  tailBack:  new THREE.Color(0x1c1c1c), // black at rump
  // Belly: yellow at beak → lighter yellow toward tail
  headBelly: new THREE.Color(0xf5d327), // yellow near the breast
  tailBelly: new THREE.Color(0xf8ec80), // lighter/paler yellow toward lower belly
  wing:    new THREE.Color(0xf5d327), // gold at wing root (matches back/belly colour)
  wingTip: new THREE.Color(0x151505), // near-black at wing tip
  // Tail: dark gray base → black tip
  tail:    new THREE.Color(0x3a3a3a), // dark gray tail base (not pure black)
  tailTip: new THREE.Color(0x0d0d0d), // near-black tail tip
  dorsalGradient: true,
  wingGradient:   true, // yellow→black gradient on wings
  tailGradient:   true, // dark gray→black gradient on tail
};
const CARDINAL_NATURE_PALETTE: SmallBirdPalette = {
  // Both back and belly are red; gradient lightens toward the tail
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
  // Back: pure/cool blue at head → brighter/more vivid blue toward tail
  headBack:  new THREE.Color(0x3b6fa0), // pure medium blue on the crown/back
  tailBack:  new THREE.Color(0x50a0d8), // brighter vivid blue near the rump/tail
  // Belly: light blue/gray near beak → white toward tail
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

// --- Optional "dragon" predator variant (nature style only): much larger,
// purple, leathery-winged silhouette instead of the hawk geometry.
// Brightened from an earlier, much darker pair (0x4a2270/0x9c43be) — those,
// combined with the wing material's own darkening multiply below, crushed
// the wings/tail to near-solid black under normal lighting, hiding all the
// scallop/bone-tube surface detail added to the wing geometry. These stay
// deep and saturated (a "black dragon" should still read dark) but leave
// enough headroom for facet-by-facet lighting variation to show through.
const DRAGON_PREDATOR_BASE = new THREE.Color(0x61339b); // matched to the visible root tone at the tail base
const DRAGON_PREDATOR_HUNT = new THREE.Color(0x7b4fc2); // brighter chase tint while staying in the same palette
// Fish tank sharks reuse the dragon's geometry-selection path (isDragon)
// but must not inherit its purple scale coloring — real sharks read as
// medium gray, not violet. Kept as separate constants (rather than
// reusing DRAGON_PREDATOR_BASE/HUNT for both styles) so nature's dragon
// and fishtank's shark can be tinted independently.
const SHARK_PREDATOR_BASE = new THREE.Color(0x6e7278); // medium slate-gray hide
const SHARK_PREDATOR_HUNT = new THREE.Color(0xa8adb3); // lighter, brighter gray when locked on

// --- "Unicorn" predator kind (all styles): light lavender body, always
// upright (see keepUpright), gentle-chase-only — see Predator.kind. Wings
// get a baked rainbow vertex-color gradient (nature style only, see
// creatureGeometry's addRainbowVertexColors) rather than a flat tint, so the
// body/tail colors here are deliberately close to white — a strongly
// tinted body color would multiply against the rainbow vertex colors and
// wash them out (InstancedMesh's per-instance color multiplies with the
// material's vertexColors output).
const NATURE_UNICORN_BODY = new THREE.Color(0xc9a8f0); // light lavender
const NATURE_UNICORN_HUNT = new THREE.Color(0xe8c9ff); // brighter pale lavender-pink when locked on
const NATURE_UNICORN_WING = new THREE.Color(0xf3ecff); // near-white so the rainbow vertex gradient reads clearly
const ARCADE_UNICORN_EMISSIVE = new THREE.Color(0xd6a8ff);
const ARCADE_UNICORN_BASE = new THREE.Color(0xc9a0f0);
const ARCADE_UNICORN_HUNT = new THREE.Color(0xffffff);

const BOID_LENGTH = 7;
const BOID_WIDTH = 2.6;
// Sparrows render a bit smaller than parrots — parrots keep the
// "reference" boid size, sparrows are scaled down from it (see
// arcadeSparrowGeometries/natureSparrowGeometries below).
const SPARROW_SIZE_SCALE = 0.7;
// Nature small songbirds (sparrow/goldfinch/cardinal/bluejay) are 25% smaller
// than the base nature boid scale — they should read as noticeably smaller than
// parrots in the same scene without shrinking so far they lose their silhouette.
const NATURE_SMALL_BIRD_SIZE = 0.975; // 1.3 * 0.75
const NATURE_SMALL_BIRD_WIDTH = 1.8;  // 2.4 * 0.75
const PREDATOR_LENGTH = 12;
const PREDATOR_WIDTH = 4.4;
// Dragons should read as dramatically larger than boids, not just a
// slightly bigger hawk — roughly 2x the nature-style hawk's footprint.
const DRAGON_SIZE_SCALE = 1.25;
const DRAGON_LENGTH_BASE = PREDATOR_LENGTH * 3.0;
const DRAGON_WIDTH_BASE = PREDATOR_WIDTH * 3.6;
const DRAGON_LENGTH = DRAGON_LENGTH_BASE * DRAGON_SIZE_SCALE;
const DRAGON_WIDTH = DRAGON_WIDTH_BASE * DRAGON_SIZE_SCALE;
const DRAGON_MOUTH = computeDragonMouthTransform(DRAGON_LENGTH);
const SHARK_LENGTH = DRAGON_LENGTH_BASE;
const SHARK_WIDTH = DRAGON_WIDTH_BASE;
// Unicorns: a large, substantial creature — a little smaller than the
// dragon, not just a slightly bigger hawk (the earlier hawk-relative
// sizing read as bird-sized, not horse-sized).
const UNICORN_LENGTH = DRAGON_LENGTH * 0.8;
const UNICORN_WIDTH = DRAGON_WIDTH * 0.75;

// Wing-flap tuning: base idle flutter plus extra amplitude proportional to
// how fast the entity is currently moving (relative to its own max speed).
const FLAP_FREQUENCY = 7.6; // radians/sec-ish; controls flap speed
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.9;
// Nature parrots should read as heavier, broad-winged fliers than the
// smaller songbirds, with slower, wider wingbeats.
const PARROT_FLAP_FREQUENCY = 5.4;
const PARROT_FLAP_IDLE_AMPLITUDE = 0.4;
const PARROT_FLAP_SPEED_AMPLITUDE = 0.95;
const CLIMB_FLAP_FREQ_BOOST = 0.12;
const DIVE_FLAP_FREQ_CUT = 0.1;
const TURN_FLAP_FREQ_BOOST = 0.06;
const PANIC_FLAP_FREQ_BOOST = 0.1;
const CLIMB_FLAP_AMP_BOOST = 0.12;
const DIVE_FLAP_AMP_BOOST = 0.08;
const TURN_FLAP_AMP_BOOST = 0.1;
const PANIC_FLAP_AMP_BOOST = 0.12;
const STATE_PITCH_SCALE = THREE.MathUtils.degToRad(18);

// Fishtank-only mesh-size boost applied on top of TANK_VISUAL_SCALE (see
// updateInstances' meshScaleBoost param). TANK_VISUAL_SCALE alone grows
// fish position spread and mesh size by the *same* factor as the tank/
// room around them, which is a pure uniform zoom — it doesn't change how
// large a fish reads *relative to the tank*, since the camera framing
// scales right along with it. That's why fish still looked bug-sized
// once the tank/room got big enough to need a real room around it: the
// ratio of "fish size" to "tank size" was never actually changed, only
// the absolute number of world units both were measured in. This boost
// is mesh-only (position spread still uses worldScale alone, see
// updateInstances' worldScale doc comment) so fish read as chunkier,
// more real-aquarium-fish-sized individuals without also making them
// range farther apart / more sparse-looking inside the tank.
const FISHTANK_FISH_MESH_BOOST = 2.2;

// Sharks (predators using dragon geometry while fishtank is active — see
// isShark below) get an extra size boost on top of FISHTANK_FISH_MESH_BOOST
// — real sharks read as noticeably larger apex predators next to the
// schooling fish, not just a same-scaled reskin of the dragon.
const FISHTANK_SHARK_MESH_BOOST = 1.5;

// Dragons are ~2.5-3x the size of the hawk predator, so flapping at the
// same fast hummingbird-like frequency read as a tiny insect (dragonfly/
// hummingbird) rather than a huge beast — big wings should beat slower
// and sweep through a wider arc.
const DRAGON_FLAP_FREQUENCY = 2.15;
const DRAGON_FLAP_IDLE_AMPLITUDE = 0.4;
const DRAGON_FLAP_SPEED_AMPLITUDE = 0.85;

// Unicorns flap more gracefully/slowly than the hawk — now sized close to
// the dragon, so a fast hummingbird-like flap would look just as wrong as
// it would on a dragon. Amplitude eased down from an earlier pass (0.35
// idle / 0.8 speed) — a large horse-scale wing swinging a full ~45-65deg
// past horizontal on the downstroke read as an aggressive flap and, at
// certain viewing angles, foreshortened into a thin edge-on "blade"
// silhouette. A gentler swing suits a serene, floaty pegasus better and
// keeps the wing panel closer to broadside-on to the camera throughout
// the cycle.
const UNICORN_FLAP_FREQUENCY = 3.2;
const UNICORN_FLAP_IDLE_AMPLITUDE = 0.22;
const UNICORN_FLAP_SPEED_AMPLITUDE = 0.5;

// Dragon tail sway: on-screen references (movies/TV) almost always show a
// dragon's tail undulating up and down as it flies, driven by the same
// wingbeat that powers the body through the air, rather than trailing
// perfectly rigid behind it like a glider's tailplane. Reuses the wing's
// flap phase (so the whole silhouette reads as one coordinated wingbeat)
// but at a smaller amplitude and a phase offset, so the tail lags/leads
// the wings rather than moving in a way that looks mechanically identical
// to them.
const DRAGON_TAIL_SWAY_AMPLITUDE = 0.22; // radians; smaller than the wing flap itself
const DRAGON_TAIL_SWAY_PHASE_OFFSET = Math.PI * 0.6; // lags the wingbeat rather than mirroring it exactly
const PARROT_TAIL_SWAY_AMPLITUDE = 0.12;
const PARROT_TAIL_SWAY_PIVOT_Y = -(BOID_LENGTH * 1.3) * 0.46;

// Fish tank sharks: unlike a dragon's flapping bat wings, a shark's
// pectoral fins (which reuse the wingLeft/wingRight slots) are rigid
// steering/lift planes that barely move — just a gentle up/down wobble,
// not a real flap — and they're held tilted down from horizontal at
// rest rather than level, the way a swimming shark's pectoral fins
// naturally droop. The tail, meanwhile, is the shark's actual means of
// propulsion and should swing side to side (a yaw, around the model's
// local up axis) rather than up and down like the dragon's whip tail —
// see the tailSwayAxis parameter on updateInstances.
const SHARK_FLAP_FREQUENCY = 2.2;
const SHARK_FLAP_IDLE_AMPLITUDE = 0.05;
const SHARK_FLAP_SPEED_AMPLITUDE = 0.09;
const SHARK_FIN_REST_TILT_RAD = 0.35; // ~20 degrees, tips angled down from horizontal
const SHARK_TAIL_SWAY_AMPLITUDE = 0.5; // radians; a visibly wide side-to-side beat
const SHARK_TAIL_SWAY_FREQUENCY = 3.4; // faster than the subtle fin wobble — the main swimming motion

// Fish tank small fish (sparrow/goldfinch/cardinal/bluejay's fishtank
// silhouette, and the plain fishtank predator): like the shark, a real
// fish's tail beats side to side (a yaw around the model's local up
// axis) rather than undulating up and down like the dragon's whip tail.
// A small fish's tail beats noticeably faster than a shark's — quicker,
// shorter strokes rather than the shark's slower, wider sweep — so this
// uses a smaller amplitude but a distinctly higher frequency. Unlike the
// shark's tail, this fish's caudal fin geometry is already rooted at the
// model's own local origin (see fishGeometry.ts's buildCaudalFinGeometry),
// so no separate tailSwayPivotY compensation is needed — the default 0
// (rotate around the origin) already matches the fin's own attachment
// point exactly.
const FISH_TAIL_SWAY_AMPLITUDE = 0.4; // radians; a brisk but not exaggerated side-to-side flick
const FISH_TAIL_SWAY_FREQUENCY = 5.2; // noticeably quicker than the shark's slower tail beat

// Unicorns get their own dedicated "stay upright" orientation model in
// updateInstances (uprightStyle === 'unicorn'), deliberately NOT a
// smaller-numbers reuse of the dragon's keepUpright path (see
// DRAGON_HEADING_SMOOTHING_RATE / near-pole handling below) — a
// pegasus/unicorn should never pitch its nose up/down or roll far
// enough to need that machinery at all; it's a fundamentally flatter,
// gentler flight style, not the same math dialed down.
//
// Pitch (nose up/down) is hard-clamped, asymmetrically, based on
// whether the entity is climbing or sinking:
// - Ascending: pitch is clamped to exactly 0 — "they stay flat rather
//   than turning upward", no nose-up tilt at all while climbing.
// - Descending: pitch is allowed a small nose-down droop, capped well
//   below the overall tilt ceiling below, so sinking reads as a gentle
//   "floating down" rather than either a flat glide or a diving swoop.
const UNICORN_ASCEND_PITCH_RADIANS = 0;
const UNICORN_DESCEND_PITCH_RADIANS = THREE.MathUtils.degToRad(10);
// Hard ceiling on how far the model's up/legs axis is ever allowed to
// tilt away from true vertical — "legs toward the ground, no more than
// 30 degrees from vertical" — enforced as a final safety clamp after
// pitch *and* bank are both baked into the orientation (see
// clampUpTilt), so it holds regardless of how those two combine. The
// pitch/bank constants here are tuned to stay comfortably under it on
// their own; this is the hard guarantee behind that tuning.
const UNICORN_MAX_UP_TILT_RADIANS = THREE.MathUtils.degToRad(30);
// Unicorns lean into turns much less than a dragon (see the shared
// MAX_BANK_RADIANS / BANK_GAIN bank-into-turns code, used by every
// entity) — a small, horse-like lean rather than a dramatic dragon roll.
const UNICORN_BANK_SCALE = 0.35;
// Unicorns smooth their heading direction before use, same idea as
// DRAGON_HEADING_SMOOTHING_RATE (removes per-frame jitter at the
// source) but with its own rate constant — kept separate rather than
// shared so each creature's feel can be tuned independently, and
// because unicorns don't need the dragon's near-pole instability fix at
// all (their pitch is hard-clamped small, so it never gets anywhere
// near vertical to begin with).
const UNICORN_HEADING_SMOOTHING_RATE = 5;
// Final safety-net turn-rate cap, same purpose as
// DRAGON_MAX_TURN_RADIANS_PER_SEC (see its doc comment) but tracked in
// its own per-unicorn map (unicornDisplayQuats) with its own constant,
// rather than sharing the dragon's.
const UNICORN_MAX_TURN_RADIANS_PER_SEC = THREE.MathUtils.degToRad(540);
// Flap speed scales with vertical velocity instead of horizontal speed
// — "flap faster as they go up, slower as they descend". climbFrac is
// vel.y / maxSpeed clamped to [-1, 1]; frequency scales up while
// climbing and down while sinking, independent of horizontal speed.
const UNICORN_CLIMB_FLAP_BOOST = 0.9; // up to +90% frequency at full climb
const UNICORN_DESCEND_FLAP_CUT = 0.55; // down to -55% frequency at full descent

// Dragons additionally low-pass filter their heading direction (not just
// their bank angle) before it's used for orientation — see the
// keepUpright branch in updateInstances for why: near a near-vertical
// heading, the *raw* per-frame velocity direction itself is unstable
// (tiny, essentially-noise-level sideways velocity components swing the
// horizontal/azimuthal component of the direction wildly, the same way a
// compass spins wildly near the magnetic pole), independent of how
// robustly "right"/"up" are then derived from it. Smoothing the heading
// itself removes this jitter at its source rather than just downstream.
// Non-dragon entities intentionally skip this (see keepUpright) since
// they don't anchor to world-up and so have no equivalent instability.
const DRAGON_HEADING_SMOOTHING_RATE = 6;
// Final safety net: caps how fast a dragon's *displayed* orientation can
// rotate per second, regardless of how the target orientation for this
// frame was computed — see dragonDisplayQuats' doc comment for why this
// structurally prevents any visible instant flip/flatten. Generous
// enough that legitimate sharp turns/dives still look immediate (a
// 180-degree reversal completes in a small fraction of a second), but
// bounded so a computational glitch can only ever show up as a brief,
// smooth correction rather than a snap.
const DRAGON_MAX_TURN_RADIANS_PER_SEC = THREE.MathUtils.degToRad(720);

// Fishtank sharks reuse the dragon's keepUpright entity/animation plumbing
// (same predator, same instance set — see isShark above) but get their
// own "stay upright" orientation model instead of the dragon's free-pitch
// one: real sharks (and the "shark" archetype generally) read as wrong
// when they point steeply up or down for the swoop/dive dragons are
// allowed, so — similar to unicorns — pitch is hard-clamped to a shallow
// range around level. Unlike unicorns, sharks are allowed a small amount
// of both nose-up and nose-down tilt (symmetric), since a shark gently
// angling up/down while cruising still reads as natural, just never the
// steep near-vertical dive/climb a dragon can do.
const SHARK_ASCEND_PITCH_RADIANS = THREE.MathUtils.degToRad(15);
const SHARK_DESCEND_PITCH_RADIANS = THREE.MathUtils.degToRad(15);
// Same purpose as UNICORN_MAX_UP_TILT_RADIANS: a final hard ceiling on
// how far the dorsal/up axis is ever allowed to tilt from true vertical,
// applied after pitch and bank are both baked in.
const SHARK_MAX_UP_TILT_RADIANS = THREE.MathUtils.degToRad(30);
// Own heading-smoothing rate, same idea as DRAGON_HEADING_SMOOTHING_RATE/
// UNICORN_HEADING_SMOOTHING_RATE but tuned separately rather than shared,
// and noticeably faster than either: the fishtank is a small, cramped
// space compared to the open sky dragons/unicorns fly in, so sharks
// bounce off the boundary and reverse course far more often. A slow
// heading-smoothing rate combined with a slow turn-rate cap (below) made
// the displayed body lag well behind the sim's actual (unsmoothed)
// position for a noticeable stretch after every reversal — reported as
// the shark appearing to "swim backwards", nose still pointing the old
// way while it visibly slides off in the new direction. Speeding both up
// keeps the visible facing glued much more tightly to the actual
// direction of travel.
const SHARK_HEADING_SMOOTHING_RATE = 14;
// Final safety-net turn-rate cap, tracked in its own per-shark map
// (sharkDisplayQuats) — see dragonDisplayQuats'/unicornDisplayQuats' doc
// comments for why this is kept independent rather than shared. Set
// higher than the dragon's — see SHARK_HEADING_SMOOTHING_RATE's doc
// comment for why sharks need to snap around faster than a large dragon
// in open sky.
const SHARK_MAX_TURN_RADIANS_PER_SEC = THREE.MathUtils.degToRad(1080);

// Three.js cones/octahedra/lathes point along +Y by default; that's the
// "forward" direction we rotate onto each entity's velocity vector.
const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
// The bodies' wings lie flat in the local Z=0 plane (see geometry/birdGeometry.ts, geometry/dragonGeometry.ts, geometry/unicornGeometry.ts)
// — local +Z is therefore the model's own "dorsal/up" direction when
// level, used below to build an orientation that stays right-side-up
// rather than picking an arbitrary roll.
const MODEL_UP_AXIS = new THREE.Vector3(0, 0, 1);
// Local "right" — used to pitch the tail up/down for the dragon tail-sway
// animation (a rotation around the model's own left-right axis tilts its
// forward/up plane, i.e. swings the tail, which trails behind along -Y).
const MODEL_RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
// When an entity's heading points anywhere near straight up/down,
// world-up stops being a good reference for "which way is level": the
// cross product used to derive "right" (cross(WORLD_UP_AXIS, forward))
// shrinks toward zero as forward approaches parallel to WORLD_UP_AXIS.
// The earlier fix here only special-cased the *exact* zero-length case
// (a literal, single-point singularity essentially never hit by a real
// heading) and otherwise always normalized whatever tiny cross product
// resulted — but normalizing an already-tiny vector amplifies ordinary
// per-frame floating-point noise into a visibly different direction each
// frame, which reads as boids/predators flattening/flickering between
// 2D/3D any time a heading spent a while within roughly this many
// degrees of vertical, not just at the literal pole. A prior attempt to
// smooth this out by blending WORLD_UP_AXIS with a fallback axis across
// this whole range reintroduced its own, differently-located version of
// the same problem (see git history) since the blended reference could
// itself land parallel to forward for various headings inside the range.
//
// Fixed instead by keeping a per-entity persisted "right" vector
// (Boid/Predator.renderRight): outside this cone, it's discarded and
// freshly recomputed straight from WORLD_UP_AXIS every single frame (no
// blending, no drift). Only *inside* the cone does the renderer reuse
// last frame's right vector (re-orthogonalized against the current
// forward via Gram-Schmidt) rather than recomputing a numerically
// unstable one from scratch — a form of parallel transport, but one
// that's safe against the long-term roll drift that sank the earlier
// persisted-state attempt, since it only ever runs for the brief stretch
// an entity's heading actually stays inside this narrow near-vertical
// cone, immediately re-anchoring to WORLD_UP_AXIS the instant it exits.
const NEAR_POLE_RIGHT_LENGTH_THRESHOLD = 0.15; // ~= sin(8.6°) from vertical
const NEAR_POLE_RIGHT_LENGTH_THRESHOLD_SQ = NEAR_POLE_RIGHT_LENGTH_THRESHOLD * NEAR_POLE_RIGHT_LENGTH_THRESHOLD;
// Only used as a last-ditch fallback when even the re-orthogonalized
// persisted right vector has collapsed (forward changed so much frame to
// frame that it's no longer even approximately valid) — vanishingly rare
// in practice, but keeps the math well-defined in all cases.
const UP_REFERENCE_FALLBACK_AXIS = new THREE.Vector3(0, 0, 1);
// Roll (bank) applied when turning is smoothed and clamped well short of
// fully inverted — a dramatic-but-still-clearly-banking lean, not a
// literal flip, per the "prefer to be right-side up" request.
const MAX_BANK_RADIANS = THREE.MathUtils.degToRad(42);
const BANK_GAIN = 2.6;
const BANK_SMOOTHING_RATE = 5;

/**
 * Cheap deterministic pseudo-random hash from an integer id + a small
 * "salt" (so multiple independent random-ish values can be derived from
 * the same id) into [0, 1). Used to give each boid a *stable* (no
 * per-frame flicker, no extra state to track) individual color variation
 * derived purely from its id — real flocks aren't perfectly uniform in
 * plumage, and a small per-individual jitter plus occasional distinct
 * "morphs" reads as much more natural than one flat color repeated
 * hundreds of times.
 */
function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Distinct body/wing/tail base colors for a boid species with non-uniform
 * plumage (e.g. the parrot's macaw-style coloring), used by updateInstances
 * in place of its default single-baseColor scheme. */
interface SpeciesColorSet {
  body: THREE.Color;
  wing: THREE.Color;
  tail: THREE.Color;
}

/**
 * All colour-related parameters for one `updateInstances` call.
 * Bundled as a named-field object so call sites are self-documenting and
 * immune to positional-parameter order bugs.
 */
interface ColourStrategy {
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (entity: Boid | Predator) => number;
  /** Each entity gets a small HSL jitter + occasional rare morph around
   * baseColor (sparrow-style individual variation). Default false. */
  individualVariation?: boolean;
  /** Per-entity body/wing/tail hue function (parrot/hawk plumage).
   * Overrides individualVariation when provided. */
  getSpeciesColors?: (entity: Boid | Predator) => SpeciesColorSet | null;
  /** True for parrot profile variants whose geometry has baked vertex colours
   * on wings/tail/legs — passes white so the vertex palette shows through. */
  bakedWingPalette?: boolean;
  /** True for nature small songbirds with a SmallBirdPalette baked into body/
   * wing/tail geometry — passes white so the gradient shows through. */
  bakedBodyGradient?: boolean;
  beakColor?: THREE.Color;
}

/**
 * Per-species animation/motion parameters for one `updateInstances` call.
 * All fields are optional; defaults match the original parameter defaults so
 * call sites can omit anything they don't need to override.
 */
interface MotionConfig {
  flapFrequency?: number;
  flapIdleAmplitude?: number;
  flapSpeedAmplitude?: number;
  getScale?: (entity: Boid | Predator) => number;
  keepUpright?: boolean;
  uprightStyle?: 'dragon' | 'unicorn' | 'shark';
  bankScale?: number;
  finRestBiasRad?: number;
  tailSwayAxis?: THREE.Vector3;
  tailSwayAmplitude?: number;
  tailSwayFrequency?: number;
  tailSwayPivotY?: number;
  worldScale?: number;
  meshScaleBoost?: number;
  preferUpright?: boolean;
}
type UprightStyle = NonNullable<MotionConfig['uprightStyle']>;

interface EntityInstanceMatrixArgs {
  set: BirdInstanceSet;
  index: number;
  entity: Boid | Predator;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number;
  maxSpeed: number;
  elapsed: number;
  dt: number;
  entityScale: number;
  blendStrength: number;
  climbWeight: number;
  diveWeight: number;
  turnWeight: number;
  panicWeight: number;
  cruiseWeight: number;
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  uprightStyle: UprightStyle;
}

interface EntityInstanceColorArgs {
  set: BirdInstanceSet;
  index: number;
  entity: Boid | Predator;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (entity: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((entity: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  beakColor: THREE.Color | undefined;
  isNatureSmallBirdBody: boolean;
  isNatureSmallBirdWing: boolean;
  isNatureSmallBirdTail: boolean;
}

interface ResolvedMotionConfig {
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  getScale: (entity: Boid | Predator) => number;
  keepUpright: boolean;
  uprightStyle: UprightStyle;
  bankScale: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  preferUpright: boolean;
}

interface ResolvedColourStrategy {
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (entity: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((entity: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  bakedBodyGradient: boolean;
  beakColor: THREE.Color | undefined;
}

interface UpdateEntityInstanceArgs {
  set: BirdInstanceSet;
  index: number;
  entity: Boid | Predator;
  maxSpeed: number;
  elapsed: number;
  dt: number;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (entity: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((entity: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  beakColor: THREE.Color | undefined;
  isNatureSmallBirdBody: boolean;
  isNatureSmallBirdWing: boolean;
  isNatureSmallBirdTail: boolean;
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  getScale: (entity: Boid | Predator) => number;
  keepUpright: boolean;
  uprightStyle: UprightStyle;
  bankScale: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  preferUpright: boolean;
}
type UpdateEntitySharedArgs = Omit<UpdateEntityInstanceArgs, 'index' | 'entity'>;

interface StyleFlags {
  isNature: boolean;
  isFishtank: boolean;
  isOrganic: boolean;
}

interface PredatorRenderFlags {
  isDragon: boolean;
  isShark: boolean;
}

interface PredatorUpdateContext {
  hawks: Predator[];
  unicorns: Predator[];
  renderFlags: PredatorRenderFlags;
}

interface PredatorCounts {
  hawkCount: number;
  unicornCount: number;
}

interface BirdMaterialTuning {
  bodyTint?: THREE.Color;
  wingTint?: THREE.Color;
  tailTint?: THREE.Color;
  bodyRoughness?: number;
  wingRoughness?: number;
  tailRoughness?: number;
  bodyMetalness?: number;
  wingMetalness?: number;
  tailMetalness?: number;
}

const NATURE_PARROT_MATERIAL_TUNING: BirdMaterialTuning = {
  bodyRoughness: 0.78,
  wingRoughness: 0.74,
  tailRoughness: 0.74,
  bodyMetalness: 0.02,
  wingMetalness: 0.01,
  tailMetalness: 0.01,
};

const FISHTANK_PARROT_MATERIAL_TUNING: BirdMaterialTuning = {
  bodyRoughness: 0.68,
  wingRoughness: 0.62,
  tailRoughness: 0.62,
  bodyMetalness: 0.04,
  wingMetalness: 0.03,
  tailMetalness: 0.03,
};

const ARCADE_PARROT_MATERIAL_TUNING: BirdMaterialTuning = {
  bodyRoughness: 0.42,
  wingRoughness: 0.38,
  tailRoughness: 0.38,
};

// Unicorns reuse the same body/wing/tail split (lavender body+tail, near-
// white wings so the baked rainbow vertex gradient shows through) in nature
// style — see NATURE_UNICORN_WING's doc comment above. The fishtank seahorse
// reuses this same predator-kind/color pipeline but its "wing" slot is
// repurposed as solid-colored pectoral fins (no rainbow gradient baked in),
// so its wing/tail tint should match the body instead of the near-white
// rainbow-reading tint, or the fins render as washed-out white flags that
// look detached from the body.
const NATURE_UNICORN_COLORS: SpeciesColorSet = { body: NATURE_UNICORN_BODY, wing: NATURE_UNICORN_WING, tail: NATURE_UNICORN_BODY };
const FISHTANK_SEAHORSE_COLORS: SpeciesColorSet = { body: NATURE_UNICORN_BODY, wing: NATURE_UNICORN_BODY, tail: NATURE_UNICORN_BODY };
const ARCADE_UNICORN_COLORS: SpeciesColorSet = { body: ARCADE_UNICORN_BASE, wing: ARCADE_UNICORN_BASE, tail: ARCADE_UNICORN_BASE };

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

/**
 * Picks one nature parrot variant (colors + geometry profile) or one fish
 * tank butterflyfish pattern per individual.
 */
function getParrotColors(entity: Boid | Predator): SpeciesColorSet {
  if (params.visualStyle === 'fishtank') {
    const baseIndex = Math.floor(idHash(entity.id, 42) * BUTTERFLYFISH_COLOR_PATTERNS.length) % BUTTERFLYFISH_COLOR_PATTERNS.length;
    if (params.galleryCreature === 'parrot') {
      const cycleStep = Math.floor(performance.now() / 3200);
      return BUTTERFLYFISH_COLOR_PATTERNS[(baseIndex + cycleStep) % BUTTERFLYFISH_COLOR_PATTERNS.length];
    }
    return BUTTERFLYFISH_COLOR_PATTERNS[baseIndex];
  }
  return getNatureParrotVariant(entity).colors;
}

function getParrotMaterialTuning(style: VisualStyle): BirdMaterialTuning | undefined {
  if (style === 'nature') return NATURE_PARROT_MATERIAL_TUNING;
  if (style === 'fishtank') return FISHTANK_PARROT_MATERIAL_TUNING;
  return ARCADE_PARROT_MATERIAL_TUNING;
}

interface BirdInstanceSet {
  body: THREE.InstancedMesh;
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
  tail?: THREE.InstancedMesh;
  legs?: THREE.InstancedMesh;
  /** Small-bird-only: see CreatureGeometries.beak's doc comment. */
  beak?: THREE.InstancedMesh;
}

/** Per-species rendering config: which population param drives its count,
 * which colors/geometry it uses, and whether it gets the sparrow's
 * shrunken geometry, the parrot's dedicated macaw-style geometry, or the
 * shared "reference" small-bird geometry (goldfinch/cardinal/bluejay).
 * Non-'sparrow' multi-colored species use either a static `colors` set or
 * a per-entity `getColors` function (parrot only, for its multi-pattern
 * flock) for distinct body/wing/tail plumage instead of one flat tint. */
interface BoidSpeciesConfig {
  species: BoidSpecies;
  countParam: 'boidCount' | 'parrotCount' | 'goldfinchCount' | 'cardinalCount' | 'bluejayCount';
  arcadeEmissive: THREE.Color;
  arcadeBase: THREE.Color;
  natureBase: THREE.Color;
  colors?: SpeciesColorSet;
  getColors?: (entity: Boid | Predator) => SpeciesColorSet;
  useSmallGeometry: boolean;
  useParrotGeometry?: boolean;
  /** Small-bird species only (nature style): the beak's own instance
   * color, distinct from the body — see CreatureGeometries.beak's doc
   * comment on why this can't just be baked into the shared body
   * geometry's vertex colors the way parrot/hawk beaks are. */
  beakColor?: THREE.Color;
  /** Small-bird species only (nature style): fixed leg/foot color baked into
   * the shared legs geometry. Defaults to SMALL_BIRD_DEFAULT_LEGS_COLOR when
   * not set. Override per-species to give e.g. a cardinal its orange-red legs. */
  legsColor?: THREE.Color;
  /** Small-bird species only (nature style): per-species baked vertex colour
   * palette for body/wing/tail gradients. When set, createRealisticBirdGeometries
   * is called with this palette and the species gets its own dedicated geometry
   * instance in Renderer3D (rather than sharing natureBoidGeometries). */
  natureSmallBirdPalette?: SmallBirdPalette;
  /** Nature-style local-Y tail joint pivot for tail sway compensation. */
  tailSwayPivotY?: number;
  /** Optional per-style material tuning for this species' body/wing/tail meshes. */
  getMaterialTuning?: (style: VisualStyle) => BirdMaterialTuning | undefined;
}

const BOID_SPECIES_CONFIGS: BoidSpeciesConfig[] = [
  {
    species: 'sparrow',
    countParam: 'boidCount',
    arcadeEmissive: ARCADE_BOID_EMISSIVE,
    arcadeBase: ARCADE_BOID_BASE,
    natureBase: NATURE_BOID_BASE,
    useSmallGeometry: true,
    beakColor: new THREE.Color(0x6b5a4a), // dark brownish-gray, typical sparrow beak
    legsColor: new THREE.Color(0x7a6450), // brownish-gray, typical sparrow leg
    natureSmallBirdPalette: SPARROW_NATURE_PALETTE,
  },
  {
    species: 'parrot',
    countParam: 'parrotCount',
    arcadeEmissive: ARCADE_PARROT_EMISSIVE,
    arcadeBase: ARCADE_PARROT_BASE,
    natureBase: PARROT_NATURE_VARIANTS[0].colors.body,
    getColors: getParrotColors,
    useSmallGeometry: false,
    useParrotGeometry: true,
    tailSwayPivotY: PARROT_TAIL_SWAY_PIVOT_Y,
    getMaterialTuning: getParrotMaterialTuning,
  },
  {
    species: 'goldfinch',
    countParam: 'goldfinchCount',
    arcadeEmissive: ARCADE_GOLDFINCH_EMISSIVE,
    arcadeBase: ARCADE_GOLDFINCH_BASE,
    natureBase: GOLDFINCH_BODY_BASE,
    colors: { body: GOLDFINCH_BODY_BASE, wing: GOLDFINCH_WING_BASE, tail: GOLDFINCH_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xf07820), // vivid orange, goldfinch's distinctive beak
    legsColor: new THREE.Color(0x8a7060), // warm brownish-gray
    natureSmallBirdPalette: GOLDFINCH_NATURE_PALETTE,
  },
  {
    species: 'cardinal',
    countParam: 'cardinalCount',
    arcadeEmissive: ARCADE_CARDINAL_EMISSIVE,
    arcadeBase: ARCADE_CARDINAL_BASE,
    natureBase: CARDINAL_BODY_BASE,
    colors: { body: CARDINAL_BODY_BASE, wing: CARDINAL_WING_BASE, tail: CARDINAL_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xe84040), // lighter red, cardinal's signature beak
    legsColor: new THREE.Color(0x8a6a5a), // brownish-gray with slight warm tint
    natureSmallBirdPalette: CARDINAL_NATURE_PALETTE,
  },
  {
    species: 'bluejay',
    countParam: 'bluejayCount',
    arcadeEmissive: ARCADE_BLUEJAY_EMISSIVE,
    arcadeBase: ARCADE_BLUEJAY_BASE,
    natureBase: BLUEJAY_BODY_BASE,
    colors: { body: BLUEJAY_BODY_BASE, wing: BLUEJAY_WING_BASE, tail: BLUEJAY_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0x8c8c8c), // medium-light gray, blue jay beak
    legsColor: new THREE.Color(0x7a7060), // neutral brownish-gray
    natureSmallBirdPalette: BLUEJAY_NATURE_PALETTE,
  },
];

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private afterimagePass: AfterimagePass;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private natureEnv: NatureEnvironment;
  private fishtankEnv: FishtankEnvironment;
  private driftingClouds: DriftingClouds;
  private bloodEffects: BloodEffects;
  private fireBreathEffects: FireBreathEffects;
  private ufoVisuals: UFOVisual[];

  private arcadeBoidGeometries: CreatureGeometries;
  private arcadeSparrowGeometries: CreatureGeometries;
  private arcadeParrotGeometries: CreatureGeometries;
  private arcadePredatorGeometries: CreatureGeometries;
  private natureBoidGeometries: CreatureGeometries;
  private natureSparrowGeometries: CreatureGeometries;
  private natureGoldfinchGeometries: CreatureGeometries;
  private natureCardinalGeometries: CreatureGeometries;
  private natureBluejayGeometries: CreatureGeometries;
  /** Quick-lookup map from BoidSpecies → per-species nature geometry for non-sparrow small birds. */
  private readonly natureSmallSpeciesGeometries = new Map<BoidSpecies, CreatureGeometries>();
  private natureParrotGeometries: CreatureGeometries;
  private natureParrotBlueGoldGeometries: CreatureGeometries;
  private natureParrotScarletGeometries: CreatureGeometries;
  private natureParrotPurpleLavenderGeometries: CreatureGeometries;
  private natureParrotNeutralGeometries: CreatureGeometries;
  private naturePredatorGeometries: CreatureGeometries;
  private dragonPredatorGeometries: CreatureGeometries;
  private unicornPredatorGeometries: CreatureGeometries;
  private fishtankBoidGeometries: CreatureGeometries;
  private fishtankSparrowGeometries: CreatureGeometries;
  private fishtankButterflyfishGeometries: CreatureGeometries;
  private fishtankPredatorGeometries: CreatureGeometries;
  private fishtankSharkPredatorGeometries: CreatureGeometries;
  private fishtankUnicornPredatorGeometries: CreatureGeometries;

  private speciesInstances = new Map<BoidSpecies, BirdInstanceSet | null>();
  private speciesInstanceKeys = new Map<BoidSpecies, string | null>();
  private parrotProfileInstances = new Map<ParrotGeometryProfile, BirdInstanceSet | null>();
  private parrotProfileKeys = new Map<ParrotGeometryProfile, string | null>();
  /**
   * Predator instances are split by kind (mirrors speciesInstances above)
   * so hawks/dragons and unicorns can coexist as independent populations
   * with entirely different geometries/materials — see Predator.kind.
   */
  private predatorInstances = new Map<PredatorKind, BirdInstanceSet | null>();
  private predatorInstanceKeys = new Map<PredatorKind, string | null>();
  /**
   * Persisted, per-dragon *displayed* orientation — see the keepUpright
   * branch in updateInstances for why this exists as a final safety net
   * on top of the heading smoothing / near-pole "right" vector logic:
   * no matter how the ideal target orientation for a given frame was
   * computed (and no matter what instability that computation might
   * still have in some edge case we haven't found yet), the mesh is
   * only ever allowed to rotate toward it at a bounded angular rate, via
   * THREE.Quaternion.rotateTowards. A valid unit quaternion can't
   * represent a "flattened" orientation, and interpolating between two
   * valid quaternions can't pass through one either — so bounding the
   * turn rate this way makes any remaining glitch show up as, at worst,
   * a brief pause before the model continues turning smoothly, never a
   * visible instant flip or flattening snap. Cleared whenever the
   * predator instance set is rebuilt (species/count/dragon-mode change).
   */
  private dragonDisplayQuats = new Map<number, THREE.Quaternion>();
  /**
   * Same turn-rate-limiting safety net as dragonDisplayQuats, but kept
   * as its own map/constant (UNICORN_MAX_TURN_RADIANS_PER_SEC) rather
   * than shared with dragons — unicorns have an entirely different
   * upright/pitch model (see updateInstances' uprightStyle === 'unicorn'
   * branch) and shouldn't inherit dragon-tuned behavior just because the
   * final turn-rate clamp happens to be structurally similar.
   */
  private unicornDisplayQuats = new Map<number, THREE.Quaternion>();
  /**
   * Same turn-rate-limiting safety net again, this time for fishtank
   * sharks (uprightStyle === 'shark') — kept as its own map/constant
   * (SHARK_MAX_TURN_RADIANS_PER_SEC) rather than reusing dragonDisplayQuats
   * even though sharks and dragons are the very same predator entities
   * (see isShark above): the two styles clamp pitch completely
   * differently, so sharing a display-quaternion map would let a stale
   * dragon-style orientation (or vice versa) leak in as the rotateTowards
   * starting point on a style switch. Cleared alongside dragonDisplayQuats
   * whenever the shared hawk/dragon/shark instance set is rebuilt.
   */
  private sharkDisplayQuats = new Map<number, THREE.Quaternion>();
  /** Per-entity accumulated flap phase (radians), integrated every frame. */
  private flapPhase = new WeakMap<Boid | Predator, number>();
  private boundsHelper: THREE.LineSegments | null = null;
  private currentStyle: VisualStyle | null = null;
  private warmedShaderStyles = new Set<VisualStyle>();
  private pendingShaderWarmupStyles = new Set<VisualStyle>();

  private lastSeenCatchId = 0;
  private nextFireBreathTime = new WeakMap<Predator, number>();
  private dummy = new THREE.Object3D();
  private bodyQuat = new THREE.Quaternion();
  private flapQuat = new THREE.Quaternion();
  private tailSwayQuat = new THREE.Quaternion();
  private pitchQuat = new THREE.Quaternion();
  // Scratch objects for composing "rotate the tail around its own
  // attachment point rather than the model's shared local origin" (see
  // tailSwayPivotY's doc comment on updateInstances).
  private tailPivotMatrix = new THREE.Matrix4();
  private tailPivotToOrigin = new THREE.Matrix4();
  private tailOriginToPivot = new THREE.Matrix4();
  private rollQuat = new THREE.Quaternion();
  private tmpVec3 = new THREE.Vector3();
  private tmpSpawnPosition = new THREE.Vector3();
  private tmpSpawnDirection = new THREE.Vector3();
  private tmpFireOrigin = new THREE.Vector3();
  private tmpFireDirection = new THREE.Vector3();
  private tmpFireOffset = new THREE.Vector3();
  private tmpFireEmitterVelocity = new THREE.Vector3();
  // Sim world center, recomputed once per frame in render() while
  // fishtank style is active — used to "grow" fishtank's boid positions
  // symmetrically around the tank's true center (see TANK_VISUAL_SCALE's
  // doc comment / updateInstances' worldScale param) rather than around
  // the coordinate origin, which would shift the whole flock away from
  // where the tank/camera actually are.
  private fishtankCenter = new THREE.Vector3();
  private tmpForward = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpPersistedRight = new THREE.Vector3();
  private tmpPrevDir = new THREE.Vector3();
  private tmpBasisMatrix = new THREE.Matrix4();
  // Unicorn-only scratch objects for the pitch clamp / up-tilt safety
  // clamp in updateInstances — kept separate from the dragon-path tmp
  // vectors above since the unicorn orientation math is its own thing.
  private tmpUnicornHorizontal = new THREE.Vector3();
  private tmpUnicornUpWorld = new THREE.Vector3();
  private tmpUnicornTiltAxis = new THREE.Vector3();
  private unicornTiltCorrection = new THREE.Quaternion();
  private stateColor = new THREE.Color();
  private variantColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();
  private hsl = { h: 0, s: 0, l: 0 };
  private startTime = performance.now();
  private lastElapsed = 0;
  private appliedFogEnabled: boolean | null = null;
  private appliedTimeOfDay: TimeOfDayPreset | null = null;
  private appliedLightShaftsEnabled: boolean | null = null;
  private appliedWaterEffectsEnabled: boolean | null = null;
  private appliedShadowsEnabled: boolean | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // logarithmicDepthBuffer: the camera's near/far planes span a huge
    // ratio (1 to 30000, for the nature sky dome) — with a standard
    // depth buffer that leaves almost no precision at typical fishtank
    // viewing distances, causing z-fighting on any thin, closely-stacked
    // surfaces (e.g. the tank windows' frame/backdrop/glass layers),
    // which shows up as flickering/jumping that gets worse the farther
    // the camera zooms or orbits. A logarithmic depth buffer distributes
    // precision far more evenly across that whole range.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // ACES tone mapping keeps the physically-based Sky shader from blowing
    // out to solid white and gives the nature-style earth tones more depth.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    // Far plane large enough to contain the nature sky dome (scaled 20000).
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.keyLight.position.set(1, 1, 1);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1536, 1536);
    this.keyLight.shadow.radius = 3;
    this.scene.add(this.ambientLight, this.keyLight);

    this.natureEnv = createNatureEnvironment(this.scene, this.renderer);
    this.fishtankEnv = createFishtankEnvironment(this.scene);
    this.driftingClouds = createDriftingClouds(this.scene);
    this.bloodEffects = createBloodEffects(this.scene);
    this.fireBreathEffects = createFireBreathEffects(this.scene);
    this.ufoVisuals = Array.from({ length: MAX_CONCURRENT_UFOS }, () => createUFOVisual(this.scene));

    this.arcadeBoidGeometries = createBirdGeometries(BOID_LENGTH, BOID_WIDTH);
    this.arcadeSparrowGeometries = createBirdGeometries(BOID_LENGTH * SPARROW_SIZE_SCALE, BOID_WIDTH * SPARROW_SIZE_SCALE);
    this.arcadeParrotGeometries = createBirdGeometries(BOID_LENGTH, BOID_WIDTH);
    this.arcadePredatorGeometries = createBirdGeometries(PREDATOR_LENGTH, PREDATOR_WIDTH);
    // The lathed "nature" body/wings have noticeably less surface area per
    // unit width/length than the arcade octahedron+flat-triangle shapes, so
    // scale them up to read clearly at the same viewing distance.
    this.natureBoidGeometries = createRealisticBirdGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
    this.natureSparrowGeometries = createRealisticBirdGeometries(
      BOID_LENGTH * NATURE_SMALL_BIRD_SIZE * SPARROW_SIZE_SCALE,
      BOID_WIDTH * NATURE_SMALL_BIRD_WIDTH * SPARROW_SIZE_SCALE,
      new THREE.Color(0x7a6450),
      SPARROW_NATURE_PALETTE,
    );
    // Per-species geometry for goldfinch/cardinal/bluejay — each bakes its
    // own gradient palette into the vertex colours so the flock doesn't need
    // a flat per-instance tint (and gains the body/wing/tail gradient look).
    this.natureGoldfinchGeometries = createRealisticBirdGeometries(
      BOID_LENGTH * NATURE_SMALL_BIRD_SIZE, BOID_WIDTH * NATURE_SMALL_BIRD_WIDTH, new THREE.Color(0x8a7060), GOLDFINCH_NATURE_PALETTE,
    );
    this.natureCardinalGeometries = createRealisticBirdGeometries(
      BOID_LENGTH * NATURE_SMALL_BIRD_SIZE, BOID_WIDTH * NATURE_SMALL_BIRD_WIDTH, new THREE.Color(0x8a6a5a), CARDINAL_NATURE_PALETTE,
    );
    this.natureBluejayGeometries = createRealisticBirdGeometries(
      BOID_LENGTH * NATURE_SMALL_BIRD_SIZE, BOID_WIDTH * NATURE_SMALL_BIRD_WIDTH, new THREE.Color(0x7a7060), BLUEJAY_NATURE_PALETTE,
    );
    this.natureSmallSpeciesGeometries.set('goldfinch', this.natureGoldfinchGeometries);
    this.natureSmallSpeciesGeometries.set('cardinal',  this.natureCardinalGeometries);
    this.natureSmallSpeciesGeometries.set('bluejay',   this.natureBluejayGeometries);
    // Parrot's dedicated macaw-style geometry (curved beak, rounder body,
    // long tail streamers) — only used in nature style; arcade style still
    // shares the simple flat-diamond silhouette with every other species
    // (arcade's whole aesthetic is bloom-glow blobs, not anatomical detail).
    this.natureParrotGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4, 'green-focus');
    this.natureParrotBlueGoldGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4, 'blue-gold-focus');
    this.natureParrotScarletGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4, 'scarlet-focus');
    this.natureParrotPurpleLavenderGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4, 'purple-lavender-focus');
    this.natureParrotNeutralGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4, 'neutral');
    this.naturePredatorGeometries = createHawkGeometries(PREDATOR_LENGTH * 1.3, PREDATOR_WIDTH * 1.7);
    this.dragonPredatorGeometries = createDragonGeometries(DRAGON_LENGTH, DRAGON_WIDTH);
    this.unicornPredatorGeometries = createUnicornGeometries(UNICORN_LENGTH, UNICORN_WIDTH);

    // Fish tank style geometries: independent duplicates of the nature
    // ones above (see src/render/styles/fishtank/), built with the exact
    // same sizing so they slot into the same instancing code paths — a
    // future reskinning pass can freely change proportions/shapes here
    // without touching nature's geometry at all.
    this.fishtankBoidGeometries = createFishtankFishGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
    this.fishtankSparrowGeometries = createFishtankFishGeometries(
      BOID_LENGTH * NATURE_SMALL_BIRD_SIZE * SPARROW_SIZE_SCALE,
      BOID_WIDTH * NATURE_SMALL_BIRD_WIDTH * SPARROW_SIZE_SCALE,
    );
    this.fishtankButterflyfishGeometries = createButterflyfishGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
    this.fishtankPredatorGeometries = createFishtankFishGeometries(PREDATOR_LENGTH * 1.3, PREDATOR_WIDTH * 2.4);
    this.fishtankSharkPredatorGeometries = createFishtankSharkGeometries(SHARK_LENGTH, SHARK_WIDTH);
    this.fishtankUnicornPredatorGeometries = createFishtankSeaHorseGeometries(UNICORN_LENGTH, UNICORN_WIDTH);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.afterimagePass = new AfterimagePass();
    this.composer.addPass(this.afterimagePass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.4, 0.15);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  private buildInstanceSet(
    geometries: CreatureGeometries,
    style: VisualStyle,
    emissive: THREE.Color,
    count: number,
    isDragon: boolean = false,
    rainbowWings: boolean = false,
    bodyVertexColors: boolean = false,
  ): BirdInstanceSet {
    // Diffuse color starts white; the actual visible tint is driven entirely
    // per-instance via setColorAt in updateInstances (base <-> state color).
    const isOrganic = style === 'nature' || style === 'fishtank';
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: isOrganic ? 0x000000 : emissive,
      emissiveIntensity: isOrganic ? 0 : 1.4,
      // Dragons get a slightly glossier (lower-roughness) finish than the
      // fully matte default nature/fishtank look — with the dark scale
      // color, a fully matte 0.9 roughness barely differentiates facets
      // under the key light, so faceted geometry (frill spikes, neck bend,
      // leg joints) reads as flat black regardless of angle. A touch of
      // sheen gives visible specular highlights that vary with facet normal.
      roughness: isOrganic ? (isDragon ? 0.65 : 0.9) : 0.5,
      metalness: 0,
      // Unicorns only: the body geometry bakes a gold vertex color onto
      // just the horn (see creatureGeometry's mergeGeometriesWithColor) so it
      // stands out from the rest of the (white-vertex-colored, so
      // unaffected) body — this just tells the material to actually read
      // and multiply by that per-vertex 'color' attribute.
      vertexColors: bodyVertexColors,
    });
    const wingMaterial = new THREE.MeshStandardMaterial({
      // Dragons: tint the membrane/tail material itself darker (multiplies
      // against the per-instance purple state color set in updateInstances)
      // so the leathery wings/tail read visibly darker than the scaly body
      // — a classic bat-wing-on-dragon cue — for free, with no extra
      // per-instance color bookkeeping. Kept much lighter than the earlier
      // 0x554466: that value, multiplied against the (also dark) dragon
      // body color, crushed the wings to near-solid black regardless of
      // facet angle or lighting, hiding the scallop/bone-tube geometry
      // detail — this stays visibly darker than the body without losing
      // all lit-surface contrast. Fish tank sharks get their own neutral
      // light-gray tint instead: 0x9c86ab is a lavender tuned to sit well
      // against the dragon's purple body, and multiplying it against the
      // shark's gray body would leak a visible purple/pink cast into the
      // fins/tail instead of the intended plain gray.
      color: isDragon ? (style === 'fishtank' ? 0xb8bcc0 : 0x9c86ab) : 0xffffff,
      emissive: isOrganic ? 0x000000 : emissive,
      emissiveIntensity: isOrganic ? 0 : 1.1,
      roughness: isOrganic ? (isDragon ? 0.65 : 0.9) : 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
      // Enable wing vertex colors whenever that geometry actually carries
      // a baked 'color' attribute (e.g. unicorn rainbow wings or parrot
      // underside/front-back wing gradients). Keep it off otherwise, since
      // enabling vertexColors on color-less geometry renders black.
      vertexColors: rainbowWings || !!geometries.wingLeft.getAttribute('color'),
    });

    const body = new THREE.InstancedMesh(geometries.body, bodyMaterial, Math.max(count, 1));
    const wingLeft = new THREE.InstancedMesh(geometries.wingLeft, wingMaterial, Math.max(count, 1));
    const wingRight = new THREE.InstancedMesh(geometries.wingRight, wingMaterial.clone(), Math.max(count, 1));
    body.count = count;
    wingLeft.count = count;
    wingRight.count = count;
    // InstancedMesh's default frustum culling tests the *mesh's own*
    // (identity/near-origin) transform + geometry.boundingSphere against
    // the view frustum — it has no idea individual instances are
    // scattered all over the world via per-instance matrices. Since our
    // instances can be anywhere in a large world box, that culling sphere
    // essentially never lines up with where the entities actually are,
    // so the whole population can wrongly vanish depending on camera
    // angle/framing (most obvious with a tightly-framed camera, e.g. the
    // Model Gallery, but the same wrong culling can affect the normal
    // orbit camera too). Disable it — with population counts this small
    // (at most a few hundred instances total), per-instance culling
    // isn't worth the complexity/risk of getting it wrong again.
    body.frustumCulled = false;
    wingLeft.frustumCulled = false;
    wingRight.frustumCulled = false;
    body.castShadow = true;
    body.receiveShadow = true;
    wingLeft.castShadow = true;
    wingLeft.receiveShadow = true;
    wingRight.castShadow = true;
    wingRight.receiveShadow = true;
    this.scene.add(body, wingLeft, wingRight);

    let tail: THREE.InstancedMesh | undefined;
    if (geometries.tail) {
      const tailMaterial = wingMaterial.clone();
      // Only the unicorn tail bakes its own rainbow 'color' attribute
      // (see buildUnicornTailGeometry); other tails (e.g. none currently
      // used elsewhere) have no color data, and a vertexColors-enabled
      // material with no 'color' attribute on its geometry would render
      // solid black, so only enable it when the geometry actually has one.
      tailMaterial.vertexColors = !!geometries.tail.getAttribute('color');
      tailMaterial.needsUpdate = true;
      tail = new THREE.InstancedMesh(geometries.tail, tailMaterial, Math.max(count, 1));
      tail.count = count;
      tail.frustumCulled = false;
      tail.castShadow = true;
      tail.receiveShadow = true;
      this.scene.add(tail);
    }

    let legs: THREE.InstancedMesh | undefined;
    if (geometries.legs) {
      // Legs are scaly like the body, not membranous like wings/tail, so
      // clone the body material (not the wing material) to pick up matching
      // per-instance scale-color tinting.
      const legsMaterial = bodyMaterial.clone();
      legs = new THREE.InstancedMesh(geometries.legs, legsMaterial, Math.max(count, 1));
      legs.count = count;
      legs.frustumCulled = false;
      legs.castShadow = true;
      legs.receiveShadow = true;
      this.scene.add(legs);
    }

    let beak: THREE.InstancedMesh | undefined;
    if (geometries.beak) {
      // Small-bird-only part (see CreatureGeometries.beak) — a plain,
      // non-vertex-colored material (this.beakMaterial has no vertex data
      // to read; its whole point is getting its own flat per-instance
      // color, set in updateInstances).
      const beakMaterial = bodyMaterial.clone();
      beakMaterial.vertexColors = false;
      beak = new THREE.InstancedMesh(geometries.beak, beakMaterial, Math.max(count, 1));
      beak.count = count;
      beak.frustumCulled = false;
      beak.castShadow = true;
      beak.receiveShadow = true;
      this.scene.add(beak);
    }

    return { body, wingLeft, wingRight, tail, legs, beak };
  }

  /**
   * Nudges `target` to a small, stable-per-id HSL jitter around `base`
   * (mutates `target` in place so callers can reuse a scratch THREE.Color
   * without allocating). Shared by the sparrow-type "shades of brown"
   * individual variation and the parrot species' per-individual jitter —
   * only the base color and jitter magnitudes differ between the two.
   */
  private jitterHSL(
    target: THREE.Color,
    base: THREE.Color,
    id: number,
    salt: number,
    hueAmt: number,
    satAmt: number,
    lightAmt: number,
  ): void {
    base.getHSL(this.hsl);
    let { h, s, l } = this.hsl;
    h = (h + (idHash(id, salt) - 0.5) * hueAmt + 1) % 1;
    s = Math.max(0, Math.min(1, s + (idHash(id, salt + 10) - 0.5) * satAmt));
    l = Math.max(0, Math.min(1, l + (idHash(id, salt + 20) - 0.5) * lightAmt));
    target.setHSL(h, s, l);
  }

  private disposeInstanceSet(set: BirdInstanceSet | null): void {
    if (!set) return;
    const meshes = [
      set.body,
      set.wingLeft,
      set.wingRight,
      ...(set.tail ? [set.tail] : []),
      ...(set.legs ? [set.legs] : []),
      ...(set.beak ? [set.beak] : []),
    ];
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** Defers a one-time shader/material compile for the currently active visual style. */
  private scheduleShaderWarmup(style: VisualStyle): void {
    if (this.warmedShaderStyles.has(style) || this.pendingShaderWarmupStyles.has(style)) return;
    this.pendingShaderWarmupStyles.add(style);
    window.setTimeout(() => {
      this.pendingShaderWarmupStyles.delete(style);
      if (this.currentStyle !== style) return;
      this.renderer.compile(this.scene, this.camera);
      this.warmedShaderStyles.add(style);
    }, 0);
  }

  private getStyleFlags(style: VisualStyle): StyleFlags {
    const isNature = style === 'nature';
    const isFishtank = style === 'fishtank';
    return {
      isNature,
      isFishtank,
      // Both "organic" styles (nature/fishtank) use the same instancing
      // pattern (realistic/lathed geometry, vertex-colored variants, etc.)
      // — only which concrete geometry set/environment is picked differs.
      isOrganic: isNature || isFishtank,
    };
  }

  private applyStyleTransitionOnStyleChange(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    if (this.currentStyle === style) return;
    const { isNature, isFishtank, isOrganic } = flags;
    const wasFishtank = this.currentStyle === 'fishtank';
    this.currentStyle = style;
    this.bloomPass.enabled = !isOrganic;
    // The screen-space afterimage/motion-trail effect persists whole
    // previous frames — great for arcade neon trails, but when the
    // camera pans in an organic (fog-using) style it drags a ghost
    // trail of the bright sky/water (especially the sun disc in nature)
    // across the frame, looking like a smeary lens flare and leaving
    // "hovering circle" afterimages.
    this.afterimagePass.enabled = !isOrganic;
    this.natureEnv.setVisible(isNature);
    this.fishtankEnv.setVisible(isFishtank);
    this.driftingClouds.setVisible(isNature);
    // Fishtank has its own dedicated glass-box wireframe (frameEdges,
    // see styles/fishtank/environment.ts) so the generic debug
    // boundsHelper stays hidden for both organic styles, same as before.
    if (this.boundsHelper) this.boundsHelper.visible = !isOrganic;
    this.ambientLight.intensity = isOrganic ? 0.55 : 0.35;
    this.keyLight.visible = !isOrganic;

    // Re-apply the zoom clamp for the new style: nature's distance fog
    // needs a tight max zoom-out, while fishtank now has real geometry
    // (a table + room) around the tank that's worth seeing when zoomed
    // out further, so it gets a much looser clamp than nature.
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    const fishtankBounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    this.controls.maxDistance = isFishtank ? fishtankBounds.maxCameraDistance : isNature ? maxDim * 5.5 : maxDim * 25;
    this.controls.minPolarAngle = isFishtank ? Math.PI / 2 - fishtankBounds.cameraTiltUpRad : 0;
    this.controls.maxPolarAngle = isFishtank ? Math.PI / 2 + fishtankBounds.cameraTiltDownRad : Math.PI;

    // Re-frame the camera when crossing into/out of fishtank specifically.
    if (isFishtank !== wasFishtank) {
      const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
      if (isFishtank) center.y = fishtankBounds.tankCenterY;
      const cameraDistScale = isFishtank ? TANK_VISUAL_SCALE : 1;
      this.camera.position.set(
        center.x + maxDim * 0.6 * cameraDistScale,
        center.y + maxDim * 0.4 * cameraDistScale,
        center.z + maxDim * 0.9 * cameraDistScale,
      );
      this.controls.target.copy(center);
      this.controls.update();
    }
  }

  private updateEnvironmentParameterToggles(): void {
    if (this.appliedFogEnabled !== params.fogEnabled) {
      this.natureEnv.setFogEnabled(params.fogEnabled);
      this.fishtankEnv.setFogEnabled(params.fogEnabled);
      this.appliedFogEnabled = params.fogEnabled;
    }
    if (this.appliedTimeOfDay !== params.timeOfDay) {
      this.natureEnv.setTimeOfDay(params.timeOfDay);
      this.fishtankEnv.setTimeOfDay(params.timeOfDay);
      this.appliedTimeOfDay = params.timeOfDay;
    }
    if (this.appliedLightShaftsEnabled !== params.lightShaftsEnabled) {
      this.natureEnv.setLightShaftsEnabled(params.lightShaftsEnabled);
      this.appliedLightShaftsEnabled = params.lightShaftsEnabled;
    }
    if (this.appliedWaterEffectsEnabled !== params.waterEffectsEnabled) {
      this.fishtankEnv.setWaterEffectsEnabled(params.waterEffectsEnabled);
      this.appliedWaterEffectsEnabled = params.waterEffectsEnabled;
    }
    const shadowsEnabled = params.mode === '3d' && params.softShadowsEnabled;
    if (this.appliedShadowsEnabled !== shadowsEnabled) {
      this.renderer.shadowMap.enabled = shadowsEnabled;
      this.keyLight.castShadow = shadowsEnabled;
      this.natureEnv.sunLight.castShadow = shadowsEnabled;
      this.fishtankEnv.keyLight.castShadow = shadowsEnabled;
      this.appliedShadowsEnabled = shadowsEnabled;
    }
  }

  private ensureBoundsHelperAndFraming(sim: Simulation, flags: StyleFlags): void {
    const { isNature, isFishtank, isOrganic } = flags;
    const expectedKey = `${sim.width}x${sim.height}x${params.worldDepth}`;
    if (this.boundsHelper?.userData.key === expectedKey) return;
    if (this.boundsHelper) {
      this.scene.remove(this.boundsHelper);
      this.boundsHelper.geometry.dispose();
      (this.boundsHelper.material as THREE.Material).dispose();
    }
    const box = new THREE.BoxGeometry(sim.width, sim.height, params.worldDepth);
    const edges = new THREE.EdgesGeometry(box);
    const material = new THREE.LineBasicMaterial({ color: 0x30363d });
    this.boundsHelper = new THREE.LineSegments(edges, material);
    this.boundsHelper.position.set(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.boundsHelper.userData.key = expectedKey;
    this.boundsHelper.visible = !isOrganic;
    this.scene.add(this.boundsHelper);
    box.dispose();

    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    const fishtankBounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    const cameraTarget = center.clone();
    if (isFishtank) cameraTarget.y = fishtankBounds.tankCenterY;
    const cameraDistScale = isFishtank ? TANK_VISUAL_SCALE : 1;
    this.camera.position.set(
      cameraTarget.x + maxDim * 0.6 * cameraDistScale,
      cameraTarget.y + maxDim * 0.4 * cameraDistScale,
      cameraTarget.z + maxDim * 0.9 * cameraDistScale,
    );
    this.controls.target.copy(cameraTarget);
    this.controls.update();

    placeNatureEnvironment(this.natureEnv, center, maxDim * 30);
    placeFishtankEnvironment(this.fishtankEnv, sim.width, sim.height, params.worldDepth);
    this.driftingClouds.configure(center, maxDim);

    const flockScale = maxDim;
    this.controls.minDistance = maxDim * 0.05;
    this.controls.maxDistance = isFishtank ? fishtankBounds.maxCameraDistance : isNature ? flockScale * 5.5 : maxDim * 25;
  }

  private reconcileBoidInstanceSets(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    const { isNature, isFishtank, isOrganic } = flags;
    const countsBySpecies = new Map<BoidSpecies, number>();
    for (const boid of sim.boids) {
      countsBySpecies.set(boid.species, (countsBySpecies.get(boid.species) ?? 0) + 1);
    }
    const parrotProfileCounts = new Map<ParrotGeometryProfile, number>();
    if (isNature) {
      for (const boid of sim.boids) {
        if (boid.species !== 'parrot') continue;
        const profile = getNatureParrotVariant(boid).geometryProfile;
        parrotProfileCounts.set(profile, (parrotProfileCounts.get(profile) ?? 0) + 1);
      }
    }
    if (!isNature) {
      for (const profile of NON_NEUTRAL_PARROT_PROFILES) {
        this.disposeInstanceSet(this.parrotProfileInstances.get(profile) ?? null);
        this.parrotProfileInstances.set(profile, null);
        this.parrotProfileKeys.set(profile, null);
      }
    }

    for (const config of BOID_SPECIES_CONFIGS) {
      const count = countsBySpecies.get(config.species) ?? 0;
      if (config.species === 'parrot' && isNature) {
        const nonNeutralCount = NON_NEUTRAL_PARROT_PROFILES
          .reduce((sum, profile) => sum + (parrotProfileCounts.get(profile) ?? 0), 0);
        const neutralCount = Math.max(0, count - nonNeutralCount);
        const neutralKey = `${neutralCount}:${style}:neutral`;
        if (this.speciesInstanceKeys.get('parrot') !== neutralKey) {
          this.disposeInstanceSet(this.speciesInstances.get('parrot') ?? null);
          this.speciesInstances.set(
            'parrot',
            this.buildInstanceSet(this.natureParrotNeutralGeometries, style, config.arcadeEmissive, neutralCount, false, false, true),
          );
          this.speciesInstanceKeys.set('parrot', neutralKey);
        }
        const geometryForProfile = (profile: ParrotGeometryProfile): CreatureGeometries => {
          if (profile === 'green-focus') return this.natureParrotGeometries;
          if (profile === 'blue-gold-focus') return this.natureParrotBlueGoldGeometries;
          if (profile === 'scarlet-focus') return this.natureParrotScarletGeometries;
          if (profile === 'purple-lavender-focus') return this.natureParrotPurpleLavenderGeometries;
          return this.natureParrotNeutralGeometries;
        };
        for (const profile of NON_NEUTRAL_PARROT_PROFILES) {
          const profileCount = parrotProfileCounts.get(profile) ?? 0;
          const profileKey = `${profileCount}:${style}:${profile}`;
          if (this.parrotProfileKeys.get(profile) !== profileKey) {
            this.disposeInstanceSet(this.parrotProfileInstances.get(profile) ?? null);
            this.parrotProfileInstances.set(
              profile,
              this.buildInstanceSet(
                geometryForProfile(profile),
                style,
                config.arcadeEmissive,
                profileCount,
                false,
                false,
                true,
              ),
            );
            this.parrotProfileKeys.set(profile, profileKey);
          }
        }
        continue;
      }
      const key = `${count}:${style}`;
      if (this.speciesInstanceKeys.get(config.species) !== key) {
        this.disposeInstanceSet(this.speciesInstances.get(config.species) ?? null);
        const geometries = config.useSmallGeometry
          ? isNature
            ? this.natureSparrowGeometries
            : isFishtank
              ? this.fishtankSparrowGeometries
              : this.arcadeSparrowGeometries
          : config.useParrotGeometry
            ? isNature
              ? this.natureParrotGeometries
              : isFishtank
                ? this.fishtankButterflyfishGeometries
                : this.arcadeParrotGeometries
            : isNature
              ? (this.natureSmallSpeciesGeometries.get(config.species) ?? this.natureBoidGeometries)
              : isFishtank
                ? this.fishtankBoidGeometries
                : this.arcadeBoidGeometries;
        const bodyVertexColors = isOrganic;
        this.speciesInstances.set(
          config.species,
          this.buildInstanceSet(geometries, style, config.arcadeEmissive, count, false, false, bodyVertexColors),
        );
        this.speciesInstanceKeys.set(config.species, key);
      }
    }
  }

  private reconcilePredatorInstanceSets(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    const { isNature, isFishtank, isOrganic } = flags;
    const { hawkCount, unicornCount } = this.getPredatorCounts(sim.predators);
 
    const isDragon = isOrganic && params.dragonPredators;
    const hawkKey = `${hawkCount}:${style}:${isDragon}`;
    if (this.predatorInstanceKeys.get('hawk') !== hawkKey) {
      this.disposeInstanceSet(this.predatorInstances.get('hawk') ?? null);
      const geometries = isDragon
        ? isFishtank
          ? this.fishtankSharkPredatorGeometries
          : this.dragonPredatorGeometries
        : isNature
          ? this.naturePredatorGeometries
          : isFishtank
            ? this.fishtankPredatorGeometries
            : this.arcadePredatorGeometries;
      this.predatorInstances.set(
        'hawk',
        this.buildInstanceSet(geometries, style, ARCADE_PREDATOR_EMISSIVE, hawkCount, isDragon, false, isDragon || isOrganic),
      );
      this.predatorInstanceKeys.set('hawk', hawkKey);
      this.dragonDisplayQuats.clear();
      this.sharkDisplayQuats.clear();
    }

    const unicornKey = `${unicornCount}:${style}`;
    if (this.predatorInstanceKeys.get('unicorn') !== unicornKey) {
      this.disposeInstanceSet(this.predatorInstances.get('unicorn') ?? null);
      const geometries = isNature
        ? this.unicornPredatorGeometries
        : isFishtank
          ? this.fishtankUnicornPredatorGeometries
          : this.arcadePredatorGeometries;
      const rainbowWings = isNature;
      const bodyVertexColors = isOrganic;
      this.predatorInstances.set(
        'unicorn',
        this.buildInstanceSet(
          geometries,
          style,
          ARCADE_UNICORN_EMISSIVE,
          unicornCount,
          false,
          rainbowWings,
          bodyVertexColors,
        ),
      );
      this.predatorInstanceKeys.set('unicorn', unicornKey);
      this.unicornDisplayQuats.clear();
    }
  }

  private getPredatorCounts(predators: Predator[]): PredatorCounts {
    let hawkCount = 0;
    let unicornCount = 0;
    for (const predator of predators) {
      if (predator.kind === 'unicorn') unicornCount++;
      else hawkCount++;
    }
    return { hawkCount, unicornCount };
  }

  /** Recreates instanced meshes, environment, and world-bounds wireframe as population/world/style change. */
  private ensureScene(sim: Simulation): void {
    const style = params.visualStyle;
    const flags = this.getStyleFlags(style);
    this.reconcileBoidInstanceSets(sim, style, flags);

    this.reconcilePredatorInstanceSets(sim, style, flags);

    this.applyStyleTransitionOnStyleChange(sim, style, flags);

    this.updateEnvironmentParameterToggles();

    // Model Gallery uses a close, creature-relative camera distance that
    // sits *inside* the tank/water volume (see main.ts's
    // poseGalleryEntityIfReady) rather than the far-outside "view the
    // whole tank" distance normal fishtank browsing uses — hide the
    // surrounding room while it's active so the transparent glass/water
    // doesn't show the room incongruously right behind the creature.
    this.fishtankEnv.setRoomVisible(params.galleryCreature === null);

    this.ensureBoundsHelperAndFraming(sim, flags);

    this.scheduleShaderWarmup(style);
  }

  private getUprightHeadingSmoothingRate(style: UprightStyle): number {
    if (style === 'unicorn') return UNICORN_HEADING_SMOOTHING_RATE;
    if (style === 'shark') return SHARK_HEADING_SMOOTHING_RATE;
    return DRAGON_HEADING_SMOOTHING_RATE;
  }

  private updateEntityRenderHeading(
    entity: Boid | Predator,
    speed: number,
    dt: number,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
  ): void {
    if (speed <= 1e-6) return;
    const invSpeed = 1 / speed;
    const targetX = entity.velocity.x * invSpeed;
    const targetY = entity.velocity.y * invSpeed;
    const targetZ = entity.velocity.z * invSpeed;
    if (keepUpright) {
      const rate = 1 - Math.exp(-dt * this.getUprightHeadingSmoothingRate(uprightStyle));
      let hx = entity.renderHeading.x + (targetX - entity.renderHeading.x) * rate;
      let hy = entity.renderHeading.y + (targetY - entity.renderHeading.y) * rate;
      let hz = entity.renderHeading.z + (targetZ - entity.renderHeading.z) * rate;
      const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      entity.renderHeading.x = hx / len;
      entity.renderHeading.y = hy / len;
      entity.renderHeading.z = hz / len;
      return;
    }
    entity.renderHeading.x = targetX;
    entity.renderHeading.y = targetY;
    entity.renderHeading.z = targetZ;
  }

  private clampForwardPitchForUprightStyle(uprightStyle: UprightStyle): void {
    this.tmpUnicornHorizontal.set(this.tmpForward.x, 0, this.tmpForward.z);
    const horizontalLen = this.tmpUnicornHorizontal.length();
    if (horizontalLen <= 1e-6) return;
    this.tmpUnicornHorizontal.divideScalar(horizontalLen);
    const rawPitch = Math.atan2(this.tmpForward.y, horizontalLen);
    const ascendLimit = uprightStyle === 'shark' ? SHARK_ASCEND_PITCH_RADIANS : UNICORN_ASCEND_PITCH_RADIANS;
    const descendLimit = uprightStyle === 'shark' ? SHARK_DESCEND_PITCH_RADIANS : UNICORN_DESCEND_PITCH_RADIANS;
    const clampedPitch = THREE.MathUtils.clamp(rawPitch, -descendLimit, ascendLimit);
    this.tmpForward.copy(this.tmpUnicornHorizontal).multiplyScalar(Math.cos(clampedPitch));
    this.tmpForward.y = Math.sin(clampedPitch);
  }

  private setPersistedUprightBasis(entity: Boid | Predator): void {
    this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS);
    if (this.tmpRight.lengthSq() < NEAR_POLE_RIGHT_LENGTH_THRESHOLD_SQ) {
      this.tmpPersistedRight.set(entity.renderRight.x, entity.renderRight.y, entity.renderRight.z);
      this.tmpPersistedRight.addScaledVector(this.tmpForward, -this.tmpPersistedRight.dot(this.tmpForward));
      if (this.tmpPersistedRight.lengthSq() < 1e-10) {
        this.tmpPersistedRight.crossVectors(this.tmpForward, UP_REFERENCE_FALLBACK_AXIS);
      }
      this.tmpRight.copy(this.tmpPersistedRight);
    }
    this.tmpRight.normalize();
    entity.renderRight.x = this.tmpRight.x;
    entity.renderRight.y = this.tmpRight.y;
    entity.renderRight.z = this.tmpRight.z;
    this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
    this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
    this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
  }

  private setSimpleUprightBasis(entity: Boid | Predator): void {
    this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS).normalize();
    entity.renderRight.x = this.tmpRight.x;
    entity.renderRight.y = this.tmpRight.y;
    entity.renderRight.z = this.tmpRight.z;
    this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
    this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
    this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
  }

  private clampDisplayUpTilt(displayQuat: THREE.Quaternion, maxUpTiltRadians: number): void {
    this.tmpUnicornUpWorld.copy(MODEL_UP_AXIS).applyQuaternion(displayQuat);
    const upTilt = this.tmpUnicornUpWorld.angleTo(WORLD_UP_AXIS);
    if (upTilt <= maxUpTiltRadians) return;
    this.tmpUnicornTiltAxis.crossVectors(this.tmpUnicornUpWorld, WORLD_UP_AXIS);
    if (this.tmpUnicornTiltAxis.lengthSq() <= 1e-10) return;
    this.tmpUnicornTiltAxis.normalize();
    this.unicornTiltCorrection.setFromAxisAngle(this.tmpUnicornTiltAxis, upTilt - maxUpTiltRadians);
    displayQuat.premultiply(this.unicornTiltCorrection);
  }

  private applyUprightDisplaySmoothing(entity: Boid | Predator, dt: number, uprightStyle: UprightStyle): void {
    if (uprightStyle === 'dragon') {
      let displayQuat = this.dragonDisplayQuats.get(entity.id);
      if (!displayQuat) {
        displayQuat = this.bodyQuat.clone();
        this.dragonDisplayQuats.set(entity.id, displayQuat);
      } else {
        displayQuat.rotateTowards(this.bodyQuat, DRAGON_MAX_TURN_RADIANS_PER_SEC * dt);
      }
      this.bodyQuat.copy(displayQuat);
      return;
    }

    if (uprightStyle === 'unicorn') {
      let displayQuat = this.unicornDisplayQuats.get(entity.id);
      if (!displayQuat) {
        displayQuat = this.bodyQuat.clone();
        this.unicornDisplayQuats.set(entity.id, displayQuat);
      } else {
        displayQuat.rotateTowards(this.bodyQuat, UNICORN_MAX_TURN_RADIANS_PER_SEC * dt);
      }
      this.clampDisplayUpTilt(displayQuat, UNICORN_MAX_UP_TILT_RADIANS);
      this.bodyQuat.copy(displayQuat);
      return;
    }

    let displayQuat = this.sharkDisplayQuats.get(entity.id);
    if (!displayQuat) {
      displayQuat = this.bodyQuat.clone();
      this.sharkDisplayQuats.set(entity.id, displayQuat);
    } else {
      displayQuat.rotateTowards(this.bodyQuat, SHARK_MAX_TURN_RADIANS_PER_SEC * dt);
    }
    this.clampDisplayUpTilt(displayQuat, SHARK_MAX_UP_TILT_RADIANS);
    this.bodyQuat.copy(displayQuat);
  }

  private applyBodyOrientationBasis(
    entity: Boid | Predator,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
    preferUpright: boolean,
  ): void {
    if (keepUpright && (uprightStyle === 'unicorn' || uprightStyle === 'shark')) {
      this.clampForwardPitchForUprightStyle(uprightStyle);
    }

    if (keepUpright && uprightStyle === 'dragon') {
      this.setPersistedUprightBasis(entity);
    } else if (keepUpright && (uprightStyle === 'unicorn' || uprightStyle === 'shark')) {
      this.setSimpleUprightBasis(entity);
    } else if (preferUpright) {
      this.setPersistedUprightBasis(entity);
    } else {
      this.bodyQuat.setFromUnitVectors(FORWARD_AXIS, this.tmpForward);
    }
  }

  private applyTurnBankAndPitch(
    entity: Boid | Predator,
    vel: { x: number; y: number; z: number },
    maxSpeed: number,
    dt: number,
    bankScale: number,
    keepUpright: boolean,
    getIntensity: (entity: Boid | Predator) => number,
  ): {
    blendStrength: number;
    climbWeight: number;
    diveWeight: number;
    turnWeight: number;
    panicWeight: number;
    cruiseWeight: number;
  } {
    const turnSignal = this.tmpPrevDir.cross(this.tmpForward).y;
    const turnWeight = THREE.MathUtils.clamp(Math.abs(turnSignal) * 16, 0, 1);
    const climbWeight = maxSpeed > 0 ? THREE.MathUtils.clamp(vel.y / maxSpeed, 0, 1) : 0;
    const diveWeight = maxSpeed > 0 ? THREE.MathUtils.clamp(-vel.y / maxSpeed, 0, 1) : 0;
    const panicWeight = THREE.MathUtils.clamp(getIntensity(entity), 0, 1);
    const cruiseWeight = Math.max(0, 1 - Math.max(climbWeight, diveWeight, turnWeight, panicWeight * 0.75));
    const blendStrength = THREE.MathUtils.clamp(params.animationBlendStrength, 0, 1);
    const targetBank = THREE.MathUtils.clamp(
      -turnSignal * BANK_GAIN * bankScale * (1 + turnWeight * 0.3 + panicWeight * 0.2),
      -MAX_BANK_RADIANS * bankScale,
      MAX_BANK_RADIANS * bankScale,
    );
    const bankSmoothing = 1 - Math.exp(-dt * BANK_SMOOTHING_RATE);
    entity.renderBank += (targetBank - entity.renderBank) * bankSmoothing;
    this.rollQuat.setFromAxisAngle(FORWARD_AXIS, entity.renderBank);
    this.bodyQuat.multiply(this.rollQuat);
    if (!keepUpright) {
      const blendedPitch = (diveWeight - climbWeight) * STATE_PITCH_SCALE * blendStrength;
      this.pitchQuat.setFromAxisAngle(MODEL_RIGHT_AXIS, blendedPitch);
      this.bodyQuat.multiply(this.pitchQuat);
    }
    return {
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
    };
  }

  private getSmallBirdBakedColorFlags(
    set: BirdInstanceSet,
    bakedBodyGradient: boolean,
  ): {
    isNatureSmallBirdBody: boolean;
    isNatureSmallBirdWing: boolean;
    isNatureSmallBirdTail: boolean;
  } {
    return {
      isNatureSmallBirdBody: bakedBodyGradient && !!set.body.geometry.getAttribute('color'),
      isNatureSmallBirdWing: bakedBodyGradient && !!set.wingLeft.geometry.getAttribute('color'),
      isNatureSmallBirdTail: bakedBodyGradient && !!set.tail?.geometry.getAttribute('color'),
    };
  }

  private applyInstanceColorsForEntity(args: EntityInstanceColorArgs): void {
    const {
      set,
      index,
      entity,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      beakColor,
      isNatureSmallBirdBody,
      isNatureSmallBirdWing,
      isNatureSmallBirdTail,
    } = args;
    const speciesColors = getSpeciesColors?.(entity);
    let effectiveBase = baseColor;
    let effectiveWing: THREE.Color | null = null;
    let effectiveTail: THREE.Color | null = null;
    let preserveParrotLegPalette = false;

    if (speciesColors) {
      const isGreenParrotVariant = getSpeciesColors === getParrotColors
        && params.visualStyle === 'nature'
        && speciesColors.body.getHex() === 0x44b749
        && speciesColors.wing.getHex() === 0x44b749;
      const lockParrotFocusPalette = getSpeciesColors === getParrotColors
        && params.visualStyle === 'nature'
        && PARROT_FOCUS_PATTERN_INDEX !== null;
      if (lockParrotFocusPalette || isGreenParrotVariant) {
        effectiveBase = speciesColors.body;
        effectiveWing = speciesColors.wing;
        effectiveTail = speciesColors.tail;
      } else {
        this.jitterHSL(this.variantColor, speciesColors.body, entity.id, 1, 0.05, 0.12, 0.1);
        this.jitterHSL(this.wingColor, speciesColors.wing, entity.id, 2, 0.05, 0.12, 0.1);
        this.jitterHSL(this.tailColor, speciesColors.tail, entity.id, 3, 0.05, 0.12, 0.1);
        effectiveBase = this.variantColor;
        effectiveWing = this.wingColor;
        effectiveTail = this.tailColor;
      }
    } else if (individualVariation) {
      baseColor.getHSL(this.hsl);
      let { h, s, l } = this.hsl;
      h = (h + (idHash(entity.id, 1) - 0.5) * 0.05 + 1) % 1;
      s = Math.max(0, Math.min(1, s + (idHash(entity.id, 2) - 0.5) * 0.16));
      l = Math.max(0, Math.min(1, l + (idHash(entity.id, 3) - 0.5) * 0.18));
      const morphRoll = idHash(entity.id, 4);
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
    if (isNatureSmallBirdBody) {
      // Baked gradient body — pass white so the vertex colours show through.
      this.stateColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(entity));
    } else {
      this.stateColor.copy(effectiveBase).lerp(highlightColor, getIntensity(entity));
    }
    set.body.setColorAt(index, this.stateColor);
    if (isNatureSmallBirdWing) {
      // Baked gradient wings — white passthrough; same for tail if baked.
      this.wingColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(entity));
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (isNatureSmallBirdTail) {
          this.tailColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(entity));
        } else {
          this.tailColor.copy(this.wingColor);
        }
        set.tail.setColorAt(index, this.tailColor);
      }
    } else if (effectiveWing) {
      const preserveParrotWingPalette = getSpeciesColors === getParrotColors
        && params.visualStyle === 'nature'
        && bakedWingPalette
        && !!set.wingLeft.geometry.getAttribute('color');
      const preserveParrotTailPalette = preserveParrotWingPalette
        && !!set.tail?.geometry.getAttribute('color');
      preserveParrotLegPalette = preserveParrotWingPalette
        && !!set.legs?.geometry.getAttribute('color');
      // Species with their own distinct wing/tail base colors keep those
      // hues rather than just darkening the body color.
      if (preserveParrotWingPalette) {
        this.wingColor.setRGB(1, 1, 1);
      } else {
        this.wingColor.copy(effectiveWing).lerp(highlightColor, getIntensity(entity));
      }
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (effectiveTail) {
          if (preserveParrotTailPalette) {
            this.tailColor.setRGB(1, 1, 1);
          } else {
            this.tailColor.copy(effectiveTail).lerp(highlightColor, getIntensity(entity));
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
      if (preserveParrotLegPalette || set.legs.geometry.getAttribute('color')) {
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
      this.jitterHSL(this.beakInstanceColor, beakColor, entity.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }

  private markInstanceSetNeedsUpdate(set: BirdInstanceSet): void {
    set.body.instanceMatrix.needsUpdate = true;
    set.wingLeft.instanceMatrix.needsUpdate = true;
    set.wingRight.instanceMatrix.needsUpdate = true;
    if (set.body.instanceColor) set.body.instanceColor.needsUpdate = true;
    if (set.wingLeft.instanceColor) set.wingLeft.instanceColor.needsUpdate = true;
    if (set.wingRight.instanceColor) set.wingRight.instanceColor.needsUpdate = true;
    if (set.tail) {
      set.tail.instanceMatrix.needsUpdate = true;
      if (set.tail.instanceColor) set.tail.instanceColor.needsUpdate = true;
    }
    if (set.legs) {
      set.legs.instanceMatrix.needsUpdate = true;
      if (set.legs.instanceColor) set.legs.instanceColor.needsUpdate = true;
    }
    if (set.beak) {
      set.beak.instanceMatrix.needsUpdate = true;
      if (set.beak.instanceColor) set.beak.instanceColor.needsUpdate = true;
    }
  }

  private applyEntityInstanceMatrices(args: EntityInstanceMatrixArgs): void {
    const {
      set,
      index,
      entity,
      position,
      velocity,
      speed,
      maxSpeed,
      elapsed,
      dt,
      entityScale,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      uprightStyle,
    } = args;
    this.applyEntityBodyMatrices(set, index, position, entityScale, worldScale, meshScaleBoost, uprightStyle);

    // Wings: apply an extra local flap rotation around the forward axis.
    const flapAngle = this.computeWingFlapAngle(
      entity,
      velocity,
      speed,
      maxSpeed,
      dt,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      uprightStyle,
    );
    this.applyWingFlapMatrices(set, index, flapAngle);

    this.applyEntityTailSwayMatrix(
      set,
      index,
      entity,
      elapsed,
      flapFrequency,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      uprightStyle,
    );
  }

  private applyEntityBodyMatrices(
    set: BirdInstanceSet,
    i: number,
    pos: { x: number; y: number; z: number },
    entityScale: number,
    worldScale: number,
    meshScaleBoost: number,
    uprightStyle: UprightStyle,
  ): void {
    // Body: just position + orientation, no flap.
    if (worldScale !== 1) {
      this.dummy.position.set(
        this.fishtankCenter.x + (pos.x - this.fishtankCenter.x) * worldScale,
        this.fishtankCenter.y + (pos.y - this.fishtankCenter.y) * worldScale,
        this.fishtankCenter.z + (pos.z - this.fishtankCenter.z) * worldScale,
      );
    } else {
      this.dummy.position.set(pos.x, pos.y, pos.z);
    }
    this.dummy.quaternion.copy(this.bodyQuat);
    this.dummy.scale.setScalar(entityScale * worldScale * meshScaleBoost);
    this.dummy.updateMatrix();
    set.body.setMatrixAt(i, this.dummy.matrix);
    if (set.legs) set.legs.setMatrixAt(i, this.dummy.matrix);
    if (set.beak) set.beak.setMatrixAt(i, this.dummy.matrix);
    if (set.tail && uprightStyle !== 'dragon' && uprightStyle !== 'shark') set.tail.setMatrixAt(i, this.dummy.matrix);
  }

  private computeWingFlapAngle(
    entity: Boid | Predator,
    vel: { x: number; y: number; z: number },
    speed: number,
    maxSpeed: number,
    dt: number,
    blendStrength: number,
    climbWeight: number,
    diveWeight: number,
    turnWeight: number,
    panicWeight: number,
    cruiseWeight: number,
    flapFrequency: number,
    flapIdleAmplitude: number,
    flapSpeedAmplitude: number,
    finRestBiasRad: number,
    uprightStyle: UprightStyle,
  ): number {
    const speedFrac = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
    const amplitudeBase = flapIdleAmplitude + flapSpeedAmplitude * speedFrac;
    const stateResponse = (uprightStyle === 'dragon' || uprightStyle === 'unicorn' || uprightStyle === 'shark') ? 0.55 : 0.75;
    const stateFrequencyMultRaw =
      1
      + blendStrength * stateResponse * (
        climbWeight * CLIMB_FLAP_FREQ_BOOST
        - diveWeight * DIVE_FLAP_FREQ_CUT
        + turnWeight * TURN_FLAP_FREQ_BOOST
        + panicWeight * PANIC_FLAP_FREQ_BOOST
        - cruiseWeight * 0.04
      );
    const stateAmplitudeMultRaw =
      1
      + blendStrength * stateResponse * (
        climbWeight * CLIMB_FLAP_AMP_BOOST
        + diveWeight * DIVE_FLAP_AMP_BOOST
        + turnWeight * TURN_FLAP_AMP_BOOST
        + panicWeight * PANIC_FLAP_AMP_BOOST
        - cruiseWeight * 0.06
      );
    const stateFrequencyMult = THREE.MathUtils.clamp(stateFrequencyMultRaw, 0.8, 1.18);
    const stateAmplitudeMult = THREE.MathUtils.clamp(stateAmplitudeMultRaw, 0.82, 1.24);
    const amplitude = amplitudeBase * stateAmplitudeMult;
    let effectiveFrequency = flapFrequency * stateFrequencyMult;
    if (uprightStyle === 'unicorn') {
      const climbFrac = maxSpeed > 0 ? THREE.MathUtils.clamp(vel.y / maxSpeed, -1, 1) : 0;
      const freqMultiplier = climbFrac >= 0
        ? 1 + UNICORN_CLIMB_FLAP_BOOST * climbFrac
        : 1 - UNICORN_DESCEND_FLAP_CUT * -climbFrac;
      effectiveFrequency = flapFrequency * freqMultiplier * stateFrequencyMult;
    }
    const prevPhase = this.flapPhase.get(entity) ?? entity.id * 1.7;
    const phase = prevPhase + effectiveFrequency * dt;
    this.flapPhase.set(entity, phase);
    return amplitude * Math.sin(phase) + finRestBiasRad;
  }

  private applyWingFlapMatrices(set: BirdInstanceSet, i: number, flapAngle: number): void {
    this.flapQuat.setFromAxisAngle(FORWARD_AXIS, flapAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
    this.dummy.updateMatrix();
    set.wingLeft.setMatrixAt(i, this.dummy.matrix);

    this.flapQuat.setFromAxisAngle(FORWARD_AXIS, -flapAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
    this.dummy.updateMatrix();
    set.wingRight.setMatrixAt(i, this.dummy.matrix);
  }

  private applyEntityTailSwayMatrix(
    set: BirdInstanceSet,
    i: number,
    entity: Boid | Predator,
    elapsed: number,
    flapFrequency: number,
    tailSwayAxis: THREE.Vector3,
    tailSwayAmplitude: number,
    tailSwayFrequency: number | undefined,
    tailSwayPivotY: number,
    uprightStyle: UprightStyle,
  ): void {
    // Tail sway (dragons/sharks only).
    if (!set.tail) return;
    if (!(uprightStyle === 'dragon' || uprightStyle === 'shark')) return;
    const tailPhase = elapsed * (tailSwayFrequency ?? flapFrequency) + entity.id * 1.7 + DRAGON_TAIL_SWAY_PHASE_OFFSET;
    const tailSwayAngle = tailSwayAmplitude * Math.sin(tailPhase);
    this.tailSwayQuat.setFromAxisAngle(tailSwayAxis, tailSwayAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.tailSwayQuat);
    this.dummy.updateMatrix();
    if (tailSwayPivotY !== 0) {
      this.dummy.quaternion.copy(this.bodyQuat);
      this.dummy.updateMatrix();
      this.tailPivotToOrigin.makeTranslation(0, -tailSwayPivotY, 0);
      this.tailOriginToPivot.makeTranslation(0, tailSwayPivotY, 0);
      this.tailPivotMatrix.makeRotationFromQuaternion(this.tailSwayQuat);
      this.tailPivotMatrix.premultiply(this.tailOriginToPivot);
      this.tailPivotMatrix.multiply(this.tailPivotToOrigin);
      this.dummy.matrix.multiply(this.tailPivotMatrix);
    }
    set.tail.setMatrixAt(i, this.dummy.matrix);
  }

  private applyEntityOrientationAndMotion(
    entity: Boid | Predator,
    speed: number,
    vel: { x: number; y: number; z: number },
    maxSpeed: number,
    dt: number,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
    preferUpright: boolean,
    bankScale: number,
    getIntensity: (entity: Boid | Predator) => number,
  ): {
    blendStrength: number;
    climbWeight: number;
    diveWeight: number;
    turnWeight: number;
    panicWeight: number;
    cruiseWeight: number;
  } {
    // Each entity keeps its own last-known heading (renderHeading)
    // rather than relying on this.bodyQuat carrying over between loop
    // iterations — otherwise an entity whose speed drops near zero
    // (e.g. a predator gliding to a stop / digesting) would silently
    // inherit whichever heading the *previous* entity in the array had
    // that frame, causing it to visually snap to an unrelated
    // direction instead of holding its own last heading.
    this.tmpPrevDir.set(entity.renderHeading.x, entity.renderHeading.y, entity.renderHeading.z);
    this.updateEntityRenderHeading(entity, speed, dt, keepUpright, uprightStyle);
    const dir = entity.renderHeading;
    this.tmpForward.set(dir.x, dir.y, dir.z);
    this.applyBodyOrientationBasis(entity, keepUpright, uprightStyle, preferUpright);

    const motionBlend = this.applyTurnBankAndPitch(
      entity,
      vel,
      maxSpeed,
      dt,
      bankScale,
      keepUpright,
      getIntensity,
    );
    if (keepUpright) this.applyUprightDisplaySmoothing(entity, dt, uprightStyle);
    return motionBlend;
  }

  private resolveMotionConfig(motion: MotionConfig): ResolvedMotionConfig {
    const {
      flapFrequency = FLAP_FREQUENCY,
      flapIdleAmplitude = FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude = FLAP_SPEED_AMPLITUDE,
      getScale = () => 1,
      keepUpright = false,
      uprightStyle = 'dragon' as const,
      bankScale = 1,
      finRestBiasRad = 0,
      tailSwayAxis = MODEL_RIGHT_AXIS,
      tailSwayAmplitude = DRAGON_TAIL_SWAY_AMPLITUDE,
      tailSwayFrequency,
      tailSwayPivotY = 0,
      worldScale = 1,
      meshScaleBoost = 1,
      preferUpright = false,
    } = motion;

    return {
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    };
  }

  private resolveColourStrategy(colours: ColourStrategy): ResolvedColourStrategy {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation = false,
      getSpeciesColors,
      bakedWingPalette = false,
      bakedBodyGradient = false,
      beakColor,
    } = colours;

    return {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      bakedBodyGradient,
      beakColor,
    };
  }

  private updateEntityInstance(args: UpdateEntityInstanceArgs): void {
    const {
      set,
      index,
      entity,
      maxSpeed,
      elapsed,
      dt,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      beakColor,
      isNatureSmallBirdBody,
      isNatureSmallBirdWing,
      isNatureSmallBirdTail,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    } = args;
    const pos = entity.position;
    const vel = entity.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const entityScale = getScale(entity);
    const {
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
    } = this.applyEntityOrientationAndMotion(
      entity,
      speed,
      vel,
      maxSpeed,
      dt,
      keepUpright,
      uprightStyle,
      preferUpright,
      bankScale,
      getIntensity,
    );
    this.applyEntityInstanceMatrices({
      set,
      index,
      entity,
      position: pos,
      velocity: vel,
      speed,
      maxSpeed,
      elapsed,
      dt,
      entityScale,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      uprightStyle,
    });

    this.applyInstanceColorsForEntity({
      set,
      index,
      entity,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      beakColor,
      isNatureSmallBirdBody,
      isNatureSmallBirdWing,
      isNatureSmallBirdTail,
    });
  }

  private updateEntityInstancesLoop(
    entities: (Boid | Predator)[],
    sharedArgs: UpdateEntitySharedArgs,
  ): void {
    for (let i = 0; i < entities.length; i++) {
      this.updateEntityInstance({
        ...sharedArgs,
        index: i,
        entity: entities[i],
      });
    }
  }

  private updateInstances(
    set: BirdInstanceSet,
    entities: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
    dt: number,
    colours: ColourStrategy,
    motion: MotionConfig = {},
  ): void {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      bakedBodyGradient,
      beakColor,
    } = this.resolveColourStrategy(colours);
    const {
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    } = this.resolveMotionConfig(motion);

    // Small songbirds (nature style) bake a SmallBirdPalette gradient into
    // their geometry. When bakedBodyGradient is true, pass white as the
    // instance colour so the vertex colours show through unchanged —
    // identical to the parrot wing-palette passthrough logic.
    // Note: we can't infer this from geometry.getAttribute('color') alone
    // because dragon/hawk geometry also carries vertex colours and would
    // incorrectly trigger the white-passthrough branch.
    const {
      isNatureSmallBirdBody,
      isNatureSmallBirdWing,
      isNatureSmallBirdTail,
    } = this.getSmallBirdBakedColorFlags(set, bakedBodyGradient);
    this.updateEntityInstancesLoop(entities, {
      set,
      maxSpeed,
      elapsed,
      dt,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      beakColor,
      isNatureSmallBirdBody,
      isNatureSmallBirdWing,
      isNatureSmallBirdTail,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    });

    this.markInstanceSetNeedsUpdate(set);
  }

  /** Spawns a 3D blood-splatter burst for every not-yet-seen Simulation.catchEvent. */
  private spawnBloodFromCatches(sim: Simulation): void {
    for (const catchEvent of sim.catchEvents) {
      if (catchEvent.id <= this.lastSeenCatchId) continue;
      this.lastSeenCatchId = catchEvent.id;
      this.tmpSpawnPosition.set(catchEvent.position.x, catchEvent.position.y, catchEvent.position.z);
      this.tmpSpawnDirection.set(catchEvent.direction.x, catchEvent.direction.y, catchEvent.direction.z);
      this.bloodEffects.spawn(this.tmpSpawnPosition, this.tmpSpawnDirection, BOID_LENGTH * 0.9);
    }
  }

  private getOrSeedNextFireBreathTime(predator: Predator, elapsed: number): number {
    let nextTime = this.nextFireBreathTime.get(predator);
    if (nextTime === undefined) {
      nextTime = elapsed + 1 + Math.random() * 2.5;
      this.nextFireBreathTime.set(predator, nextTime);
    }
    return nextTime;
  }

  private computeDragonFirePose(predator: Predator): void {
    // Anchor the flame to the dragon's actual *displayed* orientation
    // (dragonDisplayQuats — the same turn-rate-limited quaternion used
    // to draw the body mesh this frame) rather than the raw, unsmoothed
    // predator.renderHeading. During a hard turn mid-hunt (exactly when
    // fire is most likely to trigger), the raw target heading can point
    // well away from where the model is actually currently drawn facing
    // — using it made the flame appear to erupt from the dragon's back
    // and shoot off in an unrelated direction (reported as "shooting
    // upward like a whale spouting water") instead of out of the mouth
    // in the direction the visible snout is pointing. Falling back to
    // the raw heading only matters for a single early frame before any
    // display quaternion has been computed yet.
    const displayQuat = this.dragonDisplayQuats.get(predator.id);
    if (displayQuat) {
      this.tmpFireDirection.set(0, DRAGON_MOUTH.dirForward, DRAGON_MOUTH.dirUp).applyQuaternion(displayQuat).normalize();
      this.tmpFireOffset.set(0, DRAGON_MOUTH.offsetForward, DRAGON_MOUTH.offsetUp).applyQuaternion(displayQuat);
      this.tmpFireOrigin.set(predator.position.x, predator.position.y, predator.position.z).add(this.tmpFireOffset);
      return;
    }
    const dir = predator.renderHeading;
    this.tmpFireDirection.set(dir.x, dir.y, dir.z);
    this.tmpFireOrigin.set(
      predator.position.x + dir.x * DRAGON_LENGTH * 0.55,
      predator.position.y + dir.y * DRAGON_LENGTH * 0.55,
      predator.position.z + dir.z * DRAGON_LENGTH * 0.55,
    );
  }

  private spawnDragonFireBreath(predator: Predator): void {
    // Scale the flame's reach by how fast the dragon is actually
    // flying right now — a hovering/slow dragon gets a short puff close
    // to its mouth, while one at full speed gets a stream that stretches
    // well out ahead of it (see fireBreath.spawn's reach/emitterVelocity
    // doc comment) so it doesn't visually fly through its own fire.
    const vel = predator.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const speedFraction = THREE.MathUtils.clamp(speed / Math.max(params.predatorMaxSpeed, 1e-6), 0, 1);
    this.tmpFireEmitterVelocity.set(vel.x, vel.y, vel.z);

    this.fireBreathEffects.spawn(
      this.tmpFireOrigin,
      this.tmpFireDirection,
      DRAGON_LENGTH * 0.5,
      this.tmpFireEmitterVelocity,
      speedFraction,
    );
  }

  /**
   * Periodically breathes fire from each actively-hunting dragon. Each
   * dragon keeps its own randomized next-trigger time (desynced so a pack
   * of dragons doesn't all breathe fire in unison), only fires while
   * actually pursuing prey (huntIntensity above a threshold) and never
   * while digesting/resting.
   */
  private spawnFireFromDragons(sim: Simulation, elapsed: number): void {
    if (!(params.visualStyle === 'nature' && params.dragonPredators)) return;
    for (const predator of sim.predators) {
      // Unicorns are never rendered as dragons (they have their own
      // geometry) and shouldn't breathe fire regardless.
      if (predator.kind === 'unicorn') continue;
      if (predator.digesting) continue;
      const nextTime = this.getOrSeedNextFireBreathTime(predator, elapsed);
      if (elapsed < nextTime) continue;
      if (predator.huntIntensity < 0.45) {
        // Not excited enough to breathe fire right now — check again soon
        // rather than firing the instant intensity crosses the threshold.
        this.nextFireBreathTime.set(predator, elapsed + 0.5);
        continue;
      }

      this.computeDragonFirePose(predator);
      this.spawnDragonFireBreath(predator);
      this.nextFireBreathTime.set(predator, elapsed + 2 + Math.random() * 2.5);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Model Gallery: converts a *sim-space* position (e.g. an entity's raw
   * `entity.position`, in the same coordinate space as `sim.width` /
   * `sim.height` / `params.worldDepth`) into the actual rendered
   * world-space position it appears at. For nature/arcade styles this is
   * a no-op (identity), but fishtank style inflates both the tank and
   * every fish/predator's rendered position by TANK_VISUAL_SCALE, grown
   * outward from `fishtankCenter` (see updateInstances' `worldScale`
   * param and TANK_VISUAL_SCALE's doc comment) — so a creature posed at
   * the sim's raw center can render well away from that same point in
   * fishtank style. debugFrameCamera must target *this* position, not
   * the raw sim-space one, or the close-up gallery framing aims at empty
   * space next to the creature instead of the creature itself.
   */
  toRenderedPosition(x: number, y: number, z: number): THREE.Vector3 {
    const isFishtank = params.visualStyle === 'fishtank';
    if (!isFishtank) return new THREE.Vector3(x, y, z);
    const scale = TANK_VISUAL_SCALE;
    const c = this.fishtankCenter;
    return new THREE.Vector3(c.x + (x - c.x) * scale, c.y + (y - c.y) * scale, c.z + (z - c.z) * scale);
  }

  /**
   * Model Gallery / debug-QA helper: point the camera at a fixed
   * world-space position from a pleasant, fixed elevated 3/4 angle
   * (roughly matching a typical reference-photo framing of a flying
   * creature) and hold it there. Used by main.ts's Model Gallery feature
   * (`params.galleryCreature`, also drivable via the `?galleryCreature=`
   * URL param) which isolates a single creature, freezes the sim, and
   * poses it at a known position — the combination gives a clean,
   * well-framed view/screenshot for comparing a creature's geometry
   * against a reference image, and for orbiting it with the mouse
   * (OrbitControls stays enabled/interactive throughout).
   *
   * Safe to call any time: it has no effect on ensureScene's own camera
   * auto-framing, which only runs once per distinct world size (not
   * every frame), so a framing set here persists across subsequent
   * render() calls as long as the world dimensions don't change. The
   * user can still freely orbit/zoom from here via OrbitControls.
   */
  debugFrameCamera(x: number, y: number, z: number, distance: number): void {
    const target = new THREE.Vector3(x, y, z);
    this.camera.position.set(target.x + distance * 0.7, target.y + distance * 0.35, target.z + distance * 0.9);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    // ensureScene's world-scale zoom clamp (controls.minDistance =
    // maxDim * 0.05) is tuned for the whole-world view and is often far
    // larger than a small creature's tight gallery framing distance
    // (e.g. a sparrow vs. a 1000-unit-deep world) — OrbitControls.update()
    // would otherwise silently push the camera back out past that floor,
    // undoing the close-up framing entirely. Relax the floor down to
    // this call's own distance (never *raise* it, since that's still
    // meaningful for normal, non-gallery browsing) so the requested
    // distance actually sticks. resetCameraFraming restores the normal
    // world-scale floor when the gallery closes.
    const effectiveDistance = target.distanceTo(this.camera.position);
    this.controls.minDistance = Math.min(this.controls.minDistance, effectiveDistance * 0.5);
    this.controls.update();
  }

  /**
   * Model Gallery: computes a `debugFrameCamera` distance that frames the
   * *currently instanced* creature as tightly as the camera's field of
   * view allows (small margin so the silhouette doesn't clip), based on
   * the union of that creature's part geometries (body, wings, tail,
   * legs, beak). A single flat distance (the old approach) only ever
   * looked "maximally zoomed in" for whichever creature it happened to
   * be tuned against — every other kind, being a very different
   * physical size (a sparrow vs. a dragon, say), ended up looking
   * comparatively tiny/zoomed-out at that same distance. Falls back to
   * `fallbackDistance` if the instance set for `kind` doesn't exist yet
   * (e.g. called before the gallery entity has spawned on this frame).
   */
  getGalleryFramingDistance(kind: PredatorKind | BoidSpecies, fallbackDistance = 220): number {
    const set = (['hawk', 'unicorn'] as const).includes(kind as PredatorKind)
      ? this.predatorInstances.get(kind as PredatorKind)
      : this.speciesInstances.get(kind as BoidSpecies);
    if (!set) return fallbackDistance;

    // Union the bounding boxes of every part (body, wings, tail, legs,
    // beak) rather than just the body — a hawk/sparrow's wingspan or a
    // unicorn's tail reaches well past the body mesh alone, and using
    // only the body underestimates how large the creature actually
    // reads on screen. All parts share the same single-instance local
    // coordinate space, so their geometries combine directly.
    const box = new THREE.Box3();
    for (const mesh of [set.body, set.wingLeft, set.wingRight, set.tail, set.legs, set.beak]) {
      if (!mesh) continue;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    }
    if (box.isEmpty()) return fallbackDistance;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Fishtank style additionally scales every instance's mesh (not just
    // its position) by TANK_VISUAL_SCALE (see updateInstances' worldScale
    // param) — the geometry's own local bounding box doesn't reflect that,
    // so without this the fishtank creature would actually render larger
    // than this distance was solved for and clip out of frame.
    const worldScale = params.visualStyle === 'fishtank' ? TANK_VISUAL_SCALE : 1;
    const radius = sphere.radius * worldScale;
    if (!radius) return fallbackDistance;

    // Matches debugFrameCamera's (0.7, 0.35, 0.9) offset vector — the
    // actual camera-to-target distance is `distance * offsetMagnitude`,
    // not `distance` itself.
    const offsetMagnitude = Math.sqrt(0.7 ** 2 + 0.35 ** 2 + 0.9 ** 2);
    const verticalFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    // Small margin (1.15x) so the silhouette doesn't clip against the
    // frame edges when solving for the distance that makes the
    // bounding sphere fill the viewport height.
    const effectiveRadius = radius * 1.15;
    return effectiveRadius / Math.tan(verticalFovRad / 2) / offsetMagnitude;
  }

  /**
   * Restores the default whole-world camera framing (same computation
   * ensureScene applies the first time it sees a given world size) —
   * used when exiting the Model Gallery to put the camera back where a
   * normal, non-isolated simulation view expects it, since
   * debugFrameCamera's close-up framing would otherwise persist
   * (ensureScene only re-frames automatically when world dimensions
   * change, which exiting the gallery doesn't do).
   */
  resetCameraFraming(sim: Simulation): void {
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    this.camera.position.set(center.x + maxDim * 0.6, center.y + maxDim * 0.4, center.z + maxDim * 0.9);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    // Undo debugFrameCamera's possible relaxation of the zoom-in floor
    // (see its comment) — restores the normal world-scale clamp so
    // regular, non-gallery browsing can't zoom the camera through the
    // ground/boundary box.
    this.controls.minDistance = maxDim * 0.05;
    this.controls.update();
  }

  /**
   * Snapshot of the exact current camera position + OrbitControls
   * target, as plain [x, y, z] tuples — used by main.ts's "Copy deep
   * link" feature to serialize the current view into a shareable URL
   * (see setCameraState for the restore side). Deliberately returns
   * plain tuples rather than THREE.Vector3 so the caller can JSON.stringify
   * it directly without a custom serializer.
   */
  getCameraState(): { position: [number, number, number]; target: [number, number, number] } {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    };
  }

  /**
   * Restores an exact camera position + orbit target previously captured
   * via getCameraState — used when loading a "Copy deep link" URL, so
   * the view on load matches exactly what was captured, not just an
   * auto-framed approximation. Like debugFrameCamera, this is safe to
   * call any time and doesn't fight ensureScene's one-time auto-framing
   * as long as it's called after that first render() call has run (see
   * main.ts's pendingCameraState handling).
   */
  setCameraState(position: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.updateProjectionMatrix();
    this.controls.target.set(target[0], target[1], target[2]);
    this.controls.update();
  }

  private groupBoidsBySpecies(boids: Boid[]): Map<BoidSpecies, Boid[]> {
    const boidsBySpecies = new Map<BoidSpecies, Boid[]>();
    for (const boid of boids) {
      const bucket = boidsBySpecies.get(boid.species);
      if (bucket) bucket.push(boid);
      else boidsBySpecies.set(boid.species, [boid]);
    }
    return boidsBySpecies;
  }

  private partitionNatureParrotEntities(entities: Boid[]): {
    neutralEntities: Boid[];
    profileEntities: Map<ParrotGeometryProfile, Boid[]>;
  } {
    const profileEntities = new Map<ParrotGeometryProfile, Boid[]>();
    const neutralEntities: Boid[] = [];
    for (const entity of entities) {
      const profile = getNatureParrotVariant(entity).geometryProfile;
      if (profile === 'neutral') neutralEntities.push(entity);
      else {
        const bucket = profileEntities.get(profile);
        if (bucket) bucket.push(entity);
        else profileEntities.set(profile, [entity]);
      }
    }
    return { neutralEntities, profileEntities };
  }

  private getBoidEntitiesForSpecies(
    boidsBySpecies: Map<BoidSpecies, Boid[]>,
    species: BoidSpecies,
  ): Boid[] {
    return boidsBySpecies.get(species) ?? [];
  }

  private getPredatorRenderFlags(isOrganic: boolean, isFishtank: boolean): { isDragon: boolean; isShark: boolean } {
    const isDragon = isOrganic && params.dragonPredators;
    const isShark = isDragon && isFishtank;
    return { isDragon, isShark };
  }

  private partitionPredators(predators: Predator[]): { hawks: Predator[]; unicorns: Predator[] } {
    const hawks: Predator[] = [];
    const unicorns: Predator[] = [];
    for (const predator of predators) {
      if (predator.kind === 'unicorn') unicorns.push(predator);
      else hawks.push(predator);
    }
    return { hawks, unicorns };
  }

  private getHawkColourStrategy(isDragon: boolean, isFishtank: boolean, isOrganic: boolean, isNature: boolean): ColourStrategy {
    return {
      baseColor: isDragon
        ? (isFishtank ? SHARK_PREDATOR_BASE : DRAGON_PREDATOR_BASE)
        : isOrganic ? NATURE_PREDATOR_BASE : ARCADE_PREDATOR_BASE,
      highlightColor: isDragon
        ? (isFishtank ? SHARK_PREDATOR_HUNT : DRAGON_PREDATOR_HUNT)
        : isOrganic ? NATURE_PREDATOR_HUNT : ARCADE_PREDATOR_HUNT,
      getIntensity: (entity) => (entity as Predator).huntIntensity,
      // Plain nature hawks (not dragon/fishtank) get the bald-eagle
      // body/wing/tail colour split. See NATURE_HAWK_COLORS' doc comment.
      getSpeciesColors: !isDragon && isNature ? () => NATURE_HAWK_COLORS : undefined,
    };
  }

  private getHawkMotionConfig(isDragon: boolean, isShark: boolean, isFishtank: boolean): MotionConfig {
    return {
      flapFrequency: isDragon ? (isShark ? SHARK_FLAP_FREQUENCY : DRAGON_FLAP_FREQUENCY) : FLAP_FREQUENCY,
      flapIdleAmplitude: isDragon ? (isShark ? SHARK_FLAP_IDLE_AMPLITUDE : DRAGON_FLAP_IDLE_AMPLITUDE) : FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: isDragon ? (isShark ? SHARK_FLAP_SPEED_AMPLITUDE : DRAGON_FLAP_SPEED_AMPLITUDE) : FLAP_SPEED_AMPLITUDE,
      keepUpright: isDragon,
      uprightStyle: isShark ? 'shark' : 'dragon',
      // Sharks: fins droop at rest, tail yaws side-to-side (the actual
      // swimming stroke) instead of pitching up/down like a dragon.
      finRestBiasRad: isShark ? SHARK_FIN_REST_TILT_RAD : 0,
      tailSwayAxis: isShark ? MODEL_UP_AXIS : MODEL_RIGHT_AXIS,
      tailSwayAmplitude: isShark ? SHARK_TAIL_SWAY_AMPLITUDE : DRAGON_TAIL_SWAY_AMPLITUDE,
      tailSwayFrequency: isShark ? SHARK_TAIL_SWAY_FREQUENCY : undefined,
      tailSwayPivotY: isShark ? getSharkTailPivotY(SHARK_LENGTH) : 0,
      worldScale: isFishtank ? TANK_VISUAL_SCALE : 1,
      meshScaleBoost: isFishtank ? FISHTANK_FISH_MESH_BOOST * (isShark ? FISHTANK_SHARK_MESH_BOOST : 1) : 1,
    };
  }

  private getUnicornColourStrategy(isOrganic: boolean, isFishtank: boolean): ColourStrategy {
    return {
      baseColor: isOrganic ? NATURE_UNICORN_BODY : ARCADE_UNICORN_BASE,
      highlightColor: isOrganic ? NATURE_UNICORN_HUNT : ARCADE_UNICORN_HUNT,
      getIntensity: (entity) => (entity as Predator).huntIntensity,
      getSpeciesColors: () => isFishtank
        ? FISHTANK_SEAHORSE_COLORS
        : isOrganic
          ? NATURE_UNICORN_COLORS
          : ARCADE_UNICORN_COLORS,
    };
  }

  private getUnicornMotionConfig(isFishtank: boolean): MotionConfig {
    return {
      flapFrequency: UNICORN_FLAP_FREQUENCY,
      flapIdleAmplitude: UNICORN_FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: UNICORN_FLAP_SPEED_AMPLITUDE,
      // Unicorns always fly right-side-up in every style — it's a character
      // trait, not a nature-only cosmetic. Their own 'unicorn' orientation
      // model (hard pitch clamp + up-tilt safety) keeps them floaty/level.
      keepUpright: true,
      uprightStyle: 'unicorn',
      bankScale: UNICORN_BANK_SCALE,
      worldScale: isFishtank ? TANK_VISUAL_SCALE : 1,
      meshScaleBoost: isFishtank ? FISHTANK_FISH_MESH_BOOST : 1,
    };
  }

  private getBoidMotionConfig(
    config: BoidSpeciesConfig,
    isFishtank: boolean,
    isFishTail: boolean,
    isNatureParrot: boolean,
  ): MotionConfig {
    return {
      flapFrequency: isNatureParrot ? PARROT_FLAP_FREQUENCY : FLAP_FREQUENCY,
      flapIdleAmplitude: isNatureParrot ? PARROT_FLAP_IDLE_AMPLITUDE : FLAP_IDLE_AMPLITUDE,
      flapSpeedAmplitude: isNatureParrot ? PARROT_FLAP_SPEED_AMPLITUDE : FLAP_SPEED_AMPLITUDE,
      getScale: (entity) => (entity as Boid).scale,
      tailSwayAxis: isFishTail ? MODEL_UP_AXIS : MODEL_RIGHT_AXIS,
      tailSwayAmplitude: isFishTail
        ? FISH_TAIL_SWAY_AMPLITUDE
        : isNatureParrot
          ? PARROT_TAIL_SWAY_AMPLITUDE
          : DRAGON_TAIL_SWAY_AMPLITUDE,
      tailSwayFrequency: isFishTail ? FISH_TAIL_SWAY_FREQUENCY : undefined,
      tailSwayPivotY: isFishTail ? 0 : (config.tailSwayPivotY ?? 0),
      worldScale: isFishtank ? TANK_VISUAL_SCALE : 1,
      meshScaleBoost: isFishtank ? FISHTANK_FISH_MESH_BOOST : 1,
      preferUpright: true,
    };
  }

  private getParrotColourStrategy(config: BoidSpeciesConfig, bakedWingPalette: boolean): ColourStrategy {
    return {
      baseColor: config.natureBase,
      highlightColor: NATURE_BOID_PANIC,
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: true,
      getSpeciesColors: getParrotColors,
      beakColor: config.beakColor,
      bakedWingPalette,
    };
  }

  private getBoidColourStrategy(config: BoidSpeciesConfig, flags: StyleFlags): ColourStrategy {
    const { isOrganic, isNature } = flags;
    return {
      baseColor: isOrganic ? config.natureBase : config.arcadeBase,
      highlightColor: isOrganic ? NATURE_BOID_PANIC : ARCADE_BOID_PANIC,
      getIntensity: (entity) => (entity as Boid).panicLevel,
      individualVariation: config.colors || config.getColors ? true : isOrganic,
      getSpeciesColors: config.getColors ?? (config.colors ? () => config.colors! : undefined),
      beakColor: config.beakColor,
      // All nature boids with a baked wing vertex palette (currently only
      // parrots via getColors) pass white so the palette shows through.
      bakedWingPalette: true,
      // Small songbirds (sparrow/goldfinch/cardinal/bluejay) bake a
      // species-specific gradient into body/wing/tail geometry.
      bakedBodyGradient: isNature && !!config.natureSmallBirdPalette,
    };
  }

  private hasAnyBoidSpeciesInstances(): boolean {
    return BOID_SPECIES_CONFIGS.some((config) => this.speciesInstances.get(config.species));
  }

  private hasAnyPredatorInstances(): boolean {
    return this.predatorInstances.get('hawk') !== undefined
      || this.predatorInstances.get('unicorn') !== undefined;
  }

  private getPredatorUpdateContext(
    sim: Simulation,
    flags: StyleFlags,
  ): PredatorUpdateContext {
    const { isOrganic, isFishtank } = flags;
    const renderFlags = this.getPredatorRenderFlags(isOrganic, isFishtank);
    const { hawks, unicorns } = this.partitionPredators(sim.predators);
    return { hawks, unicorns, renderFlags };
  }

  private updatePredatorInstanceSets(
    context: PredatorUpdateContext,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    this.updateHawkPredatorInstances(
      context.hawks,
      elapsed,
      dt,
      flags,
      context.renderFlags,
    );
    this.updateUnicornPredatorInstances(context.unicorns, elapsed, dt, flags);
  }

  private updateNatureParrotInstances(
    config: BoidSpeciesConfig,
    instances: BirdInstanceSet,
    entities: Boid[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    const { isFishtank } = flags;
    const { neutralEntities, profileEntities } = this.partitionNatureParrotEntities(entities);
    this.updateInstances(
      instances,
      neutralEntities,
      params.boidMaxSpeed,
      elapsed,
      dt,
      this.getParrotColourStrategy(config, false),
      this.getBoidMotionConfig(config, isFishtank, false, true),
    );
    for (const profile of NON_NEUTRAL_PARROT_PROFILES) {
      const profileSet = this.parrotProfileInstances.get(profile);
      if (!profileSet) continue;
      this.updateInstances(
        profileSet,
        profileEntities.get(profile) ?? [],
        params.boidMaxSpeed,
        elapsed,
        dt,
        this.getParrotColourStrategy(config, true),
        this.getBoidMotionConfig(config, isFishtank, false, true),
      );
    }
  }

  private updateStandardBoidSpeciesInstances(
    config: BoidSpeciesConfig,
    instances: BirdInstanceSet,
    entities: Boid[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    isNatureParrot: boolean,
  ): void {
    const { isFishtank } = flags;
    const isFishTail = isFishtank;
    this.updateInstances(
      instances,
      entities,
      params.boidMaxSpeed,
      elapsed,
      dt,
      this.getBoidColourStrategy(config, flags),
      this.getBoidMotionConfig(config, isFishtank, isFishTail, isNatureParrot),
    );
  }

  private updateBoidSpeciesConfig(
    config: BoidSpeciesConfig,
    boidsBySpecies: Map<BoidSpecies, Boid[]>,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    const { isNature } = flags;
    const instances = this.speciesInstances.get(config.species);
    if (!instances) return;
    const entities = this.getBoidEntitiesForSpecies(boidsBySpecies, config.species);
    const isNatureParrot = config.species === 'parrot' && isNature;
    // Fish-tail wave (fishtank only): every fishtank species' caudal
    // fin is rooted at the model's own local origin (sparrow/
    // goldfinch/cardinal/bluejay's plain small-fish geometry, and
    // now the parrot species' butterflyfish geometry too), so it's
    // safe to sway around the shared pivot with no detachment risk
    // (see FISH_TAIL_SWAY_AMPLITUDE's doc comment).
    if (isNatureParrot) {
      this.updateNatureParrotInstances(config, instances, entities, elapsed, dt, flags);
      return;
    }
    this.updateStandardBoidSpeciesInstances(
      config,
      instances,
      entities,
      elapsed,
      dt,
      flags,
      isNatureParrot,
    );
  }

  private updateBoidSpeciesInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    if (!this.hasAnyBoidSpeciesInstances()) return;

    const boidsBySpecies = this.groupBoidsBySpecies(sim.boids);

    for (const config of BOID_SPECIES_CONFIGS) {
      this.updateBoidSpeciesConfig(config, boidsBySpecies, elapsed, dt, flags);
    }
  }

  private updatePredatorInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    if (!this.hasAnyPredatorInstances()) return;
    const context = this.getPredatorUpdateContext(sim, flags);
    this.updatePredatorInstanceSets(context, elapsed, dt, flags);
  }

  private updateHawkPredatorInstances(
    hawks: Predator[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    renderFlags: PredatorRenderFlags,
  ): void {
    const hawkInstances = this.predatorInstances.get('hawk');
    if (!hawkInstances) return;
    const { isNature, isFishtank, isOrganic } = flags;
    const { isDragon, isShark } = renderFlags;
    this.updateInstances(
      hawkInstances,
      hawks,
      params.predatorMaxSpeed,
      elapsed,
      dt,
      this.getHawkColourStrategy(isDragon, isFishtank, isOrganic, isNature),
      this.getHawkMotionConfig(isDragon, isShark, isFishtank),
    );
  }

  private updateUnicornPredatorInstances(
    unicorns: Predator[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    const unicornInstances = this.predatorInstances.get('unicorn');
    if (!unicornInstances) return;
    const { isFishtank, isOrganic } = flags;
    this.updateInstances(
      unicornInstances,
      unicorns,
      params.predatorMaxSpeed,
      elapsed,
      dt,
      this.getUnicornColourStrategy(isOrganic, isFishtank),
      this.getUnicornMotionConfig(isFishtank),
    );
  }

  private applyUfoVisualState(
    visual: UFOVisual,
    ufo: Simulation['ufos'][number] | undefined,
    flags: StyleFlags,
    ufoWorldScale: number,
    ufoBeamLength: number,
  ): void {
    const { isFishtank } = flags;
    if (ufo) {
      if (isFishtank) {
        this.tmpVec3.set(
          this.fishtankCenter.x + (ufo.position.x - this.fishtankCenter.x) * ufoWorldScale,
          this.fishtankCenter.y + (ufo.position.y - this.fishtankCenter.y) * ufoWorldScale,
          this.fishtankCenter.z + (ufo.position.z - this.fishtankCenter.z) * ufoWorldScale,
        );
      } else {
        this.tmpVec3.set(ufo.position.x, ufo.position.y, ufo.position.z);
      }
      visual.setState(true, this.tmpVec3, ufo.beamStrength, ufoBeamLength, ufoWorldScale);
      return;
    }
    visual.setState(false, this.tmpVec3, 0, 0);
  }

  private getUfoRenderScaleParams(flags: StyleFlags): { ufoWorldScale: number; ufoBeamLength: number } {
    const { isFishtank } = flags;
    const ufoWorldScale = isFishtank ? TANK_VISUAL_SCALE : 1;
    const ufoBeamLength = UFO_BEAM_REACH * ufoWorldScale;
    return { ufoWorldScale, ufoBeamLength };
  }

  private updateUfoVisuals(sim: Simulation, dt: number, flags: StyleFlags): void {
    // Each UFOVisual slot maps 1:1 by index to an active sim.ufos entry;
    // slots beyond the current active count are simply hidden.
    const { ufoWorldScale, ufoBeamLength } = this.getUfoRenderScaleParams(flags);
    for (let i = 0; i < this.ufoVisuals.length; i++) {
      const visual = this.ufoVisuals[i];
      this.applyUfoVisualState(visual, sim.ufos[i], flags, ufoWorldScale, ufoBeamLength);
      visual.update(dt);
    }
  }

  private getToneMappingExposureForTimeOfDay(timeOfDay: typeof params.timeOfDay): number {
    const exposureByTime = {
      dawn: 0.62,
      noon: 0.7,
      sunset: 0.6,
      night: 0.44,
    } as const;
    return exposureByTime[timeOfDay];
  }

  private updatePostProcessingAndEnvironment(
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    const { isNature, isFishtank } = flags;
    // AfterimagePass's damp uniform controls how strongly the previous
    // frame persists — same trailAmount knob used by the 2D renderer.
    this.afterimagePass.uniforms.damp.value = Math.max(0, Math.min(0.96, params.trailAmount));
    if (isNature) this.natureEnv.update(elapsed);
    if (isFishtank) this.fishtankEnv.update(elapsed);
    this.renderer.toneMappingExposure = this.getToneMappingExposureForTimeOfDay(params.timeOfDay);
    this.driftingClouds.update(dt);
  }

  private updateTransientSceneEffects(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    this.spawnBloodFromCatches(sim);
    this.bloodEffects.update(dt);
    this.spawnFireFromDragons(sim, elapsed);
    this.fireBreathEffects.update(dt);
    this.updateUfoVisuals(sim, dt, flags);
  }

  private updateSceneEffects(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    this.updatePostProcessingAndEnvironment(elapsed, dt, flags);
    this.updateTransientSceneEffects(sim, elapsed, dt, flags);
  }

  private updateFishtankCenter(sim: Simulation, flags: StyleFlags): void {
    const { isFishtank } = flags;
    if (!isFishtank) return;
    // Around the tank's true center (see updateInstances' worldScale
    // param / TANK_VISUAL_SCALE's doc comment). Horizontally (x/z) this
    // is the sim's raw center, matching placeFishtankEnvironment's
    // horizontal anchor; vertically (y) it's 0 — the tank's bottom,
    // resting on the table — NOT the sim's raw vertical center, matching
    // placeFishtankEnvironment's bottom-anchored vertical growth so fish
    // grow in lockstep with the glass box instead of drifting out of sync.
    this.fishtankCenter.set(sim.width / 2, 0, params.worldDepth / 2);
  }

  private computeFishtankMaxDistance(sim: Simulation): number {
    const bounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
    const polarAngle = this.controls.getPolarAngle();
    const elevation = Math.abs(polarAngle - Math.PI / 2);
    const distToCeiling = bounds.roomFloorY + bounds.roomHeight - bounds.tankCenterY;
    const distToFloor = bounds.tankCenterY - bounds.roomFloorY;
    const vertClearance = polarAngle < Math.PI / 2 ? distToCeiling : distToFloor;
    const sinE = Math.sin(elevation);
    const cosE = Math.cos(elevation);
    const vertCap = sinE > 1e-4 ? (vertClearance / sinE) * 0.92 : Infinity;
    const horizCap = (bounds.wallMargin / Math.max(cosE, 1e-4)) * 0.92;
    return Math.min(vertCap, horizCap);
  }

  private updateFishtankDynamicCameraClamp(sim: Simulation, flags: StyleFlags): void {
    const { isFishtank } = flags;
    if (!isFishtank) return;
    // Dynamic zoom-out clamp: computeFishtankRoomBounds' own
    // maxCameraDistance (set once, in ensureScene) has to satisfy the
    // *worst-case* permitted tilt at all times, which is overly
    // conservative at/near a level (untitled) view — there's no
    // floor/ceiling to clip through at all when looking straight
    // across the room. Recomputed every frame from the camera's current
    // polar angle so level view can zoom farther while steep tilts keep
    // safe clearance to walls/floor/ceiling.
    this.controls.maxDistance = this.computeFishtankMaxDistance(sim);
  }

  private updateCreatureInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    this.updateBoidSpeciesInstances(sim, elapsed, dt, flags);
    this.updatePredatorInstances(sim, elapsed, dt, flags);
  }

  private getRenderTiming(): { elapsed: number; dt: number } {
    const elapsed = (performance.now() - this.startTime) / 1000;
    const dt = Math.max(0, Math.min(elapsed - this.lastElapsed, 1 / 20));
    this.lastElapsed = elapsed;
    return { elapsed, dt };
  }

  private renderFrame(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    this.updateFishtankCenter(sim, flags);
    this.updateSceneEffects(sim, elapsed, dt, flags);
    this.updateCreatureInstances(sim, elapsed, dt, flags);
    this.updateFishtankDynamicCameraClamp(sim, flags);
    this.renderOutput();
  }

  private renderOutput(): void {
    this.controls.update();
    this.composer.render();
  }

  render(sim: Simulation): void {
    this.ensureScene(sim);
    const { elapsed, dt } = this.getRenderTiming();
    const flags = this.getStyleFlags(params.visualStyle);
    this.renderFrame(sim, elapsed, dt, flags);
  }

  private disposeBoidInstanceSets(): void {
    for (const config of BOID_SPECIES_CONFIGS) {
      this.disposeInstanceSet(this.speciesInstances.get(config.species) ?? null);
    }
  }

  private disposeParrotProfileInstanceSets(): void {
    for (const profile of NON_NEUTRAL_PARROT_PROFILES) {
      this.disposeInstanceSet(this.parrotProfileInstances.get(profile) ?? null);
      this.parrotProfileInstances.set(profile, null);
      this.parrotProfileKeys.set(profile, null);
    }
  }

  private disposePredatorInstanceSets(): void {
    for (const kind of this.predatorInstances.keys()) {
      this.disposeInstanceSet(this.predatorInstances.get(kind) ?? null);
    }
  }

  private disposeCreatureGeometries(geometries: CreatureGeometries): void {
    geometries.body.dispose();
    geometries.wingLeft.dispose();
    geometries.wingRight.dispose();
    geometries.tail?.dispose();
    geometries.legs?.dispose();
  }

  private disposeAllCreatureGeometrySets(): void {
    for (const geometries of [
      this.arcadeBoidGeometries,
      this.arcadeSparrowGeometries,
      this.arcadeParrotGeometries,
      this.arcadePredatorGeometries,
      this.natureBoidGeometries,
      this.natureSparrowGeometries,
      this.natureGoldfinchGeometries,
      this.natureCardinalGeometries,
      this.natureBluejayGeometries,
      this.natureParrotGeometries,
      this.natureParrotBlueGoldGeometries,
      this.natureParrotScarletGeometries,
      this.natureParrotPurpleLavenderGeometries,
      this.natureParrotNeutralGeometries,
      this.naturePredatorGeometries,
      this.dragonPredatorGeometries,
      this.unicornPredatorGeometries,
    ]) {
      this.disposeCreatureGeometries(geometries);
    }
  }

  dispose(): void {
    this.disposeBoidInstanceSets();
    this.disposeParrotProfileInstanceSets();
    this.disposePredatorInstanceSets();
    this.disposeAllCreatureGeometrySets();
    this.natureEnv.dispose();
    this.fishtankEnv.dispose();
    this.driftingClouds.dispose();
    this.bloodEffects.dispose();
    this.fireBreathEffects.dispose();
    this.ufoVisuals.forEach((visual) => visual.dispose());
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

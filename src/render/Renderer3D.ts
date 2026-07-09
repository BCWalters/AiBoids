import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { params, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { MAX_CONCURRENT_UFOS } from '../sim/Simulation';
import type { Boid, BoidSpecies } from '../sim/Boid';
import type { Predator, PredatorKind } from '../sim/Predator';
import { createBirdGeometries, createRealisticBirdGeometries } from './geometry/birdGeometry';
import { createHawkGeometries } from './styles/nature/geometry/hawkGeometry';
import { createParrotGeometries } from './styles/nature/geometry/parrotGeometry';
import { createDragonGeometries, computeDragonMouthTransform } from './styles/nature/geometry/dragonGeometry';
import { createUnicornGeometries } from './styles/nature/geometry/unicornGeometry';
import type { CreatureGeometries } from './geometry/creatureGeometry';
import { createNatureEnvironment, placeNatureEnvironment, type NatureEnvironment } from './styles/nature/environment';
import {
  createFishtankEnvironment,
  placeFishtankEnvironment,
  computeFishtankRoomBounds,
  TANK_VISUAL_SCALE,
  type FishtankEnvironment,
} from './styles/fishtank/environment';
import { createFishGeometries as createFishtankFishGeometries } from './styles/fishtank/geometry/fishGeometry';
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
// macaw/parrot color patterns per-individual (see PARROT_COLOR_PATTERNS'
// use in getParrotColors below) so the flock reads as visually diverse
// rather than a uniform species, the way small songbirds do (goldfinch/
// cardinal/bluejay are each their own distinct color already; a single-
// hue parrot stood out as flatter/less varied than those by comparison).
const PARROT_COLOR_PATTERNS: SpeciesColorSet[] = [
  // Blue-and-gold macaw
  { body: new THREE.Color(0xf0b429), wing: new THREE.Color(0x2f6fdc), tail: new THREE.Color(0x1c4fb0) },
  // Scarlet macaw
  { body: new THREE.Color(0xd8202a), wing: new THREE.Color(0x1f6fd8), tail: new THREE.Color(0xf0b429) },
  // Green-wing (military) macaw
  { body: new THREE.Color(0xc0242f), wing: new THREE.Color(0x1f9e58), tail: new THREE.Color(0x2f6fdc) },
  // Sun conure
  { body: new THREE.Color(0xf5d327), wing: new THREE.Color(0xe8791a), tail: new THREE.Color(0xd8202a) },
  // Hyacinth macaw
  { body: new THREE.Color(0x2f4fa0), wing: new THREE.Color(0x1c3878), tail: new THREE.Color(0xf0b429) },
];
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

// --- Optional "dragon" predator variant (nature style only): much larger,
// purple, leathery-winged silhouette instead of the hawk geometry.
// Brightened from an earlier, much darker pair (0x4a2270/0x9c43be) — those,
// combined with the wing material's own darkening multiply below, crushed
// the wings/tail to near-solid black under normal lighting, hiding all the
// scallop/bone-tube surface detail added to the wing geometry. These stay
// deep and saturated (a "black dragon" should still read dark) but leave
// enough headroom for facet-by-facet lighting variation to show through.
const DRAGON_PREDATOR_BASE = new THREE.Color(0x6a3399); // deep violet-purple scale
const DRAGON_PREDATOR_HUNT = new THREE.Color(0xb355d6); // brighter magenta-purple when locked on
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
const PREDATOR_LENGTH = 12;
const PREDATOR_WIDTH = 4.4;
// Dragons should read as dramatically larger than boids, not just a
// slightly bigger hawk — roughly 2x the nature-style hawk's footprint.
const DRAGON_LENGTH = PREDATOR_LENGTH * 3.0;
const DRAGON_WIDTH = PREDATOR_WIDTH * 3.6;
// Unicorns: a large, substantial creature — a little smaller than the
// dragon, not just a slightly bigger hawk (the earlier hawk-relative
// sizing read as bird-sized, not horse-sized).
const UNICORN_LENGTH = DRAGON_LENGTH * 0.8;
const UNICORN_WIDTH = DRAGON_WIDTH * 0.75;

// Wing-flap tuning: base idle flutter plus extra amplitude proportional to
// how fast the entity is currently moving (relative to its own max speed).
const FLAP_FREQUENCY = 9; // radians/sec-ish; controls flap speed
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.9;

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
const DRAGON_FLAP_FREQUENCY = 2.6;
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

/**
 * Deterministically picks one of PARROT_COLOR_PATTERNS (nature style) or
 * BUTTERFLYFISH_COLOR_PATTERNS (fish tank style) per individual (stable
 * across frames since it's keyed only on the entity's own id, not time)
 * so the flock reads as several distinct real-world color patterns
 * rather than one uniform hue jittered slightly — updateInstances layers
 * its own small per-individual jitter on top of whichever pattern this
 * returns, for the same "no two look identical" variety the other
 * species get. Branches on the current visual style since this is the
 * one species whose fish tank skin (a butterflyfish) is a completely
 * different creature from its nature skin (a macaw/conure), unlike
 * every other species sharing one palette across styles.
 */
function getParrotColors(entity: Boid | Predator): SpeciesColorSet {
  const patterns = params.visualStyle === 'fishtank' ? BUTTERFLYFISH_COLOR_PATTERNS : PARROT_COLOR_PATTERNS;
  const index = Math.floor(idHash(entity.id, 42) * patterns.length) % patterns.length;
  return patterns[index];
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
}

const BOID_SPECIES_CONFIGS: BoidSpeciesConfig[] = [
  {
    species: 'sparrow',
    countParam: 'boidCount',
    arcadeEmissive: ARCADE_BOID_EMISSIVE,
    arcadeBase: ARCADE_BOID_BASE,
    natureBase: NATURE_BOID_BASE,
    useSmallGeometry: true,
    beakColor: new THREE.Color(0x3a332b), // dark grayish-brown, typical sparrow beak
  },
  {
    species: 'parrot',
    countParam: 'parrotCount',
    arcadeEmissive: ARCADE_PARROT_EMISSIVE,
    arcadeBase: ARCADE_PARROT_BASE,
    natureBase: PARROT_COLOR_PATTERNS[0].body,
    getColors: getParrotColors,
    useSmallGeometry: false,
    useParrotGeometry: true,
  },
  {
    species: 'goldfinch',
    countParam: 'goldfinchCount',
    arcadeEmissive: ARCADE_GOLDFINCH_EMISSIVE,
    arcadeBase: ARCADE_GOLDFINCH_BASE,
    natureBase: GOLDFINCH_BODY_BASE,
    colors: { body: GOLDFINCH_BODY_BASE, wing: GOLDFINCH_WING_BASE, tail: GOLDFINCH_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xf0b96a), // pale orange-pink, a real goldfinch's distinctive beak color
  },
  {
    species: 'cardinal',
    countParam: 'cardinalCount',
    arcadeEmissive: ARCADE_CARDINAL_EMISSIVE,
    arcadeBase: ARCADE_CARDINAL_BASE,
    natureBase: CARDINAL_BODY_BASE,
    colors: { body: CARDINAL_BODY_BASE, wing: CARDINAL_WING_BASE, tail: CARDINAL_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0xe8672a), // bright orange-red, a real cardinal's signature thick beak color
  },
  {
    species: 'bluejay',
    countParam: 'bluejayCount',
    arcadeEmissive: ARCADE_BLUEJAY_EMISSIVE,
    arcadeBase: ARCADE_BLUEJAY_BASE,
    natureBase: BLUEJAY_BODY_BASE,
    colors: { body: BLUEJAY_BODY_BASE, wing: BLUEJAY_WING_BASE, tail: BLUEJAY_TAIL_BASE },
    useSmallGeometry: false,
    beakColor: new THREE.Color(0x1c1c1c), // near-black, matches a real blue jay's beak
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
  private natureParrotGeometries: CreatureGeometries;
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
  /**
   * Per-unicorn accumulated flap phase (radians) — unicorns modulate
   * their flap *frequency* by vertical velocity (see UNICORN_CLIMB_FLAP_
   * BOOST / UNICORN_DESCEND_FLAP_CUT), so unlike every other creature's
   * flap phase (which is just `elapsed * flapFrequency`, safe because
   * their frequency is a constant), the phase has to be integrated
   * frame-by-frame here — using a frequency that changes moment to
   * moment directly in an `elapsed * frequency` formula would make the
   * phase (and thus the wing angle) jump discontinuously every time the
   * frequency itself changed, rather than smoothly speeding up/slowing
   * down.
   */
  private unicornFlapPhase = new Map<number, number>();
  private boundsHelper: THREE.LineSegments | null = null;
  private currentStyle: VisualStyle | null = null;

  private lastSeenCatchId = 0;
  private nextFireBreathTime = new WeakMap<Predator, number>();
  private dummy = new THREE.Object3D();
  private bodyQuat = new THREE.Quaternion();
  private flapQuat = new THREE.Quaternion();
  private tailSwayQuat = new THREE.Quaternion();
  // Scratch objects for composing "rotate the tail around its own
  // attachment point rather than the model's shared local origin" (see
  // tailSwayPivotY's doc comment on updateInstances).
  private tailPivotMatrix = new THREE.Matrix4();
  private tailPivotToOrigin = new THREE.Matrix4();
  private tailOriginToPivot = new THREE.Matrix4();
  private rollQuat = new THREE.Quaternion();
  private tmpVec3 = new THREE.Vector3();
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
  private beakInstanceColor = new THREE.Color();
  private hsl = { h: 0, s: 0, l: 0 };
  private startTime = performance.now();
  private lastElapsed = 0;

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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    // Far plane large enough to contain the nature sky dome (scaled 20000).
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.keyLight.position.set(1, 1, 1);
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
      BOID_LENGTH * 1.3 * SPARROW_SIZE_SCALE,
      BOID_WIDTH * 2.4 * SPARROW_SIZE_SCALE,
    );
    // Parrot's dedicated macaw-style geometry (curved beak, rounder body,
    // long tail streamers) — only used in nature style; arcade style still
    // shares the simple flat-diamond silhouette with every other species
    // (arcade's whole aesthetic is bloom-glow blobs, not anatomical detail).
    this.natureParrotGeometries = createParrotGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
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
      BOID_LENGTH * 1.3 * SPARROW_SIZE_SCALE,
      BOID_WIDTH * 2.4 * SPARROW_SIZE_SCALE,
    );
    this.fishtankButterflyfishGeometries = createButterflyfishGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
    this.fishtankPredatorGeometries = createFishtankFishGeometries(PREDATOR_LENGTH * 1.3, PREDATOR_WIDTH * 2.4);
    this.fishtankSharkPredatorGeometries = createFishtankSharkGeometries(DRAGON_LENGTH, DRAGON_WIDTH);
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
      // Unicorns only: the wing geometry itself carries a baked rainbow
      // hue gradient (see creatureGeometry's addRainbowVertexColors) — this
      // just tells the material to actually read and multiply by that
      // per-vertex 'color' attribute rather than ignoring it.
      vertexColors: rainbowWings,
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

  /** Recreates instanced meshes, environment, and world-bounds wireframe as population/world/style change. */
  private ensureScene(sim: Simulation): void {
    const style = params.visualStyle;
    const isNature = style === 'nature';
    const isFishtank = style === 'fishtank';
    // Both "organic" styles (nature/fishtank) use the same instancing
    // pattern (realistic/lathed geometry, vertex-colored variants, etc.)
    // — only which concrete geometry set/environment is picked differs.
    const isOrganic = isNature || isFishtank;
    const countsBySpecies = new Map<BoidSpecies, number>();
    for (const boid of sim.boids) {
      countsBySpecies.set(boid.species, (countsBySpecies.get(boid.species) ?? 0) + 1);
    }

    // Each species gets its own InstancedMesh set — separate materials so
    // arcade style can give each a distinct emissive bloom color (emissive
    // is a material-level property; shared instances would force identical
    // bloom-glow color regardless of per-instance diffuse tint). Sparrows
    // use the shrunken geometry, parrots use their own dedicated macaw-
    // style geometry (nature/fishtank styles only), and everything else
    // uses the shared "reference" small-bird size/shape.
    for (const config of BOID_SPECIES_CONFIGS) {
      const count = countsBySpecies.get(config.species) ?? 0;
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
              ? this.natureBoidGeometries
              : isFishtank
                ? this.fishtankBoidGeometries
                : this.arcadeBoidGeometries;
        // Parrot geometry (nature + fishtank) bakes vertex colors for its
        // beak/eyes; small-bird geometry (sparrow/goldfinch/cardinal/
        // bluejay) now does too in both the nature-style file and the
        // fishtank small-fish reskin (fishGeometry.ts bakes its own eye
        // dots the same way), so vertex colors are safe to enable for
        // any organic (nature or fishtank) style, not just nature.
        const bodyVertexColors = isOrganic;
        this.speciesInstances.set(
          config.species,
          this.buildInstanceSet(geometries, style, config.arcadeEmissive, count, false, false, bodyVertexColors),
        );
        this.speciesInstanceKeys.set(config.species, key);
      }
    }

    // Predators are split by kind (see Predator.kind / predatorInstances'
    // doc comment) — hawks/dragons and unicorns are independent
    // populations, each with their own InstancedMesh set, so both can be
    // present in the scene at once.
    let hawkCount = 0;
    let unicornCount = 0;
    for (const predator of sim.predators) {
      if (predator.kind === 'unicorn') unicornCount++;
      else hawkCount++;
    }

    // dragonPredators is a generic "give the flying/swimming predator a
    // bigger bespoke silhouette" toggle: in nature it swaps hawks for
    // dragons, and in fishtank (reusing the same checkbox until a
    // dedicated tank-specific UI exists) it swaps the small fish-shaped
    // predator for the shark.
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

    // Unicorns get the full pegasus-with-rainbow-wings geometry in nature
    // style, and its fishtank-duplicate stand-in in fishtank style; arcade
    // style reuses the plain hawk silhouette (just tinted lavender via
    // updateInstances' color params) rather than a second bespoke
    // geometry, since arcade's glowing-instanced look doesn't call for the
    // same level of cosmetic detail.
    const unicornKey = `${unicornCount}:${style}`;
    if (this.predatorInstanceKeys.get('unicorn') !== unicornKey) {
      this.disposeInstanceSet(this.predatorInstances.get('unicorn') ?? null);
      const geometries = isNature
        ? this.unicornPredatorGeometries
        : isFishtank
          ? this.fishtankUnicornPredatorGeometries
          : this.arcadePredatorGeometries;
      // The fishtank seahorse's "wing" slot is solid-colored pectoral fins
      // (no baked rainbow gradient), unlike the nature unicorn's wings —
      // only enable the rainbow-wing vertex-color path for nature style.
      const rainbowWings = isNature;
      // The gold-horn vertex colors are only baked into the organic-style
      // horse geometry (unicornPredatorGeometries/fishtankUnicornPredator
      // Geometries) — arcade style reuses the plain hawk geometry, which
      // has no 'color' attribute at all, so enabling vertexColors there
      // would have nothing to read.
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
      this.unicornFlapPhase.clear();
    }

    if (this.currentStyle !== style) {
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
      // out further, so it gets a much looser clamp than nature. Fishtank's
      // clamp is derived from computeFishtankRoomBounds — the exact same
      // wallMargin/roomHeight formulas placeFishtankEnvironment uses to
      // build the room — so it stays in lockstep with the room's actual
      // size (see that function's maxCameraDistance doc comment).
      const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
      const fishtankBounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
      this.controls.maxDistance = isFishtank ? fishtankBounds.maxCameraDistance : isNature ? maxDim * 5.5 : maxDim * 25;
      // Fishtank's generous zoom-out range is only mathematically
      // guaranteed to clear the floor/ceiling up to cameraTiltUpRad/
      // cameraTiltDownRad of tilt away from horizontal (see
      // maxCameraDistance's and cameraTiltUpRad/cameraTiltDownRad's doc
      // comments in computeFishtankRoomBounds — all derived together so
      // they always stay in sync here). Other styles have no such
      // enclosing geometry to worry about, so they get OrbitControls'
      // unrestricted default range back.
      this.controls.minPolarAngle = isFishtank ? Math.PI / 2 - fishtankBounds.cameraTiltUpRad : 0;
      this.controls.maxPolarAngle = isFishtank ? Math.PI / 2 + fishtankBounds.cameraTiltDownRad : Math.PI;

      // Re-frame the camera when crossing into/out of fishtank
      // specifically (not just on world-dimension changes, handled
      // separately below) — fishtank renders at TANK_VISUAL_SCALE, so a
      // camera position/distance that was correct for arcade/nature
      // would otherwise end up far too close (effectively "inside" the
      // now much-bigger tank) the moment fishtank is selected, or too
      // far out the moment it's left again.
      if (isFishtank !== wasFishtank) {
        const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
        // Fishtank looks at the tank's true (bottom-anchored) vertical
        // center rather than the sim's raw center — see
        // computeFishtankRoomBounds' tankCenterY doc comment.
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

    // Applied every frame (cheap) rather than gated on style-change, so
    // toggling the fog checkbox takes effect immediately without needing
    // a full style switch.
    this.natureEnv.setFogEnabled(params.fogEnabled);
    this.fishtankEnv.setFogEnabled(params.fogEnabled);

    // Model Gallery uses a close, creature-relative camera distance that
    // sits *inside* the tank/water volume (see main.ts's
    // poseGalleryEntityIfReady) rather than the far-outside "view the
    // whole tank" distance normal fishtank browsing uses — hide the
    // surrounding room while it's active so the transparent glass/water
    // doesn't show the room incongruously right behind the creature.
    this.fishtankEnv.setRoomVisible(params.galleryCreature === null);

    const expectedKey = `${sim.width}x${sim.height}x${params.worldDepth}`;
    if (this.boundsHelper?.userData.key !== expectedKey) {
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

      // Frame the camera around the world box the first time we see it (or
      // whenever its size changes), centered on the box with orbit target
      // there. Fishtank's own visual scale (see TANK_VISUAL_SCALE) grows
      // the tank around this same center point horizontally without
      // moving it (see placeFishtankEnvironment's `center` doc comment),
      // so the target stays correct across styles — only the initial
      // camera *distance* needs to widen for fishtank so it doesn't start
      // inside the bigger tank, and (for fishtank specifically) the
      // target's vertical component needs to look at the tank's true
      // (bottom-anchored) center rather than the sim's raw center — see
      // computeFishtankRoomBounds' tankCenterY doc comment.
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

      // Nature/clouds always use the sim's raw (unscaled) center — only
      // fishtank's own target/framing (above) and glass box (below) use
      // the inflated TANK_VISUAL_SCALE geometry.
      placeNatureEnvironment(this.natureEnv, center, maxDim * 30);
      // Unlike nature's ground plane (an arbitrary-scale backdrop),
      // fishtank's glass box must match the sim's actual world bounds
      // exactly — it's a real container the fish swim inside, not just
      // scenery — so this takes the raw dimensions rather than a single
      // "groundSize" scalar. (placeFishtankEnvironment inflates its own
      // rendered size internally — see TANK_VISUAL_SCALE's doc comment.)
      placeFishtankEnvironment(this.fishtankEnv, sim.width, sim.height, params.worldDepth);
      this.driftingClouds.configure(center, maxDim);

      // Clamp orbit zoom to a sane range for this world's scale: never so
      // close the camera can slide through the ground/boundary box, and
      // never so far out that nature's distance fog reduces the whole
      // view to a flat, blown-out wall of fog color (which reads as a
      // rendering glitch rather than "zoomed out"). Fishtank gets a much
      // further max distance since zooming out is supposed to reveal the
      // tank sitting on its table in the room, not just hit a fog wall —
      // derived from computeFishtankRoomBounds (the real room size), like
      // the matching comment on the other maxDistance assignment above.
      const flockScale = maxDim;
      this.controls.minDistance = maxDim * 0.05;
      this.controls.maxDistance = isFishtank ? fishtankBounds.maxCameraDistance : isNature ? flockScale * 5.5 : maxDim * 25;
    }
  }

  private updateInstances(
    set: BirdInstanceSet,
    entities: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
    dt: number,
    baseColor: THREE.Color,
    highlightColor: THREE.Color,
    getIntensity: (entity: Boid | Predator) => number,
    flapFrequency: number = FLAP_FREQUENCY,
    flapIdleAmplitude: number = FLAP_IDLE_AMPLITUDE,
    flapSpeedAmplitude: number = FLAP_SPEED_AMPLITUDE,
    getScale: (entity: Boid | Predator) => number = () => 1,
    individualVariation: boolean = false,
    getSpeciesColors?: (entity: Boid | Predator) => SpeciesColorSet | null,
    keepUpright: boolean = false,
    // Which "stay upright" orientation model to use when keepUpright is
    // true — 'dragon' (near-pole-safe basis + free pitch, for full
    // swoop/dive/roll acrobatics), 'unicorn' (hard-clamped pitch + final
    // up-tilt safety clamp, for a flat, floaty pegasus-style flight), or
    // 'shark' (same hard-clamped-pitch shape as 'unicorn', but its own
    // shallower symmetric pitch range/constants — see SHARK_ASCEND_PITCH_
    // RADIANS' doc comment — for a shark that stays mostly horizontal
    // instead of pointing steeply up/down like a dragon). These are
    // deliberately separate code paths below, not a shared one
    // parameterized by a bias knob — see the UNICORN_*/SHARK_* tuning
    // constants' doc comments.
    uprightStyle: 'dragon' | 'unicorn' | 'shark' = 'dragon',
    bankScale: number = 1,
    // Small-bird-only: a flat, distinct instance color for the separate
    // `beak` InstancedMesh part (see BoidSpeciesConfig.beakColor's doc
    // comment on why this is a separate part rather than a body vertex
    // bake for these particular species).
    beakColor?: THREE.Color,
    // Fish tank shark-only: a constant downward tilt bias applied to both
    // pectoral fins (see SHARK_FIN_REST_TILT_RAD's doc comment) so they
    // rest angled below horizontal instead of dead level, on top of
    // whatever small oscillation flapIdleAmplitude/flapSpeedAmplitude add.
    finRestBiasRad: number = 0,
    // Which local axis the tail sway (dragon/shark only, uprightStyle ===
    // 'dragon') rotates around: MODEL_RIGHT_AXIS pitches it up/down (the
    // dragon's whip-tail undulation), MODEL_UP_AXIS yaws it side to side
    // (a shark's swimming tail beat).
    tailSwayAxis: THREE.Vector3 = MODEL_RIGHT_AXIS,
    tailSwayAmplitude: number = DRAGON_TAIL_SWAY_AMPLITUDE,
    // Defaults to flapFrequency (matching the dragon's original "reuse the
    // wingbeat phase" behavior) when left unset — pass an explicit value
    // (e.g. SHARK_TAIL_SWAY_FREQUENCY) to decouple the tail beat from the
    // fin wobble's own, much slower frequency.
    tailSwayFrequency?: number,
    // Fish tank shark-only: local-Y position of the tail's own
    // attachment point (see getSharkTailPivotY), used so the tail-sway
    // rotation below pivots around *that* point instead of the model's
    // shared local origin — see the pivot-matrix comment near
    // tailSwayQuat for why this matters. 0 (the origin itself) for every
    // other species, which keeps their existing behavior unchanged since
    // rotating "around the origin" and "around a pivot at the origin"
    // are the same thing.
    tailSwayPivotY: number = 0,
    // Fishtank-only: grows both position (around this.fishtankCenter,
    // set once per frame in render()) and mesh scale by this factor —
    // see TANK_VISUAL_SCALE's doc comment for why the tank/fish are
    // inflated independently of the sim's actual coordinate space.
    // Always 1 (no-op) for arcade/nature.
    worldScale: number = 1,
    // Fishtank-only: an *extra* mesh-only scale multiplier (does NOT
    // affect position spreading, unlike worldScale above) — see
    // FISHTANK_FISH_MESH_BOOST's doc comment for why fish need their own
    // size bump on top of worldScale to read as real aquarium fish
    // rather than tiny specks lost in a room-sized tank. Always 1
    // (no-op) for arcade/nature and for fishtank predators/species that
    // don't opt into the boost.
    meshScaleBoost: number = 1,
  ): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const pos = entity.position;
      const vel = entity.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const entityScale = getScale(entity);

      // Each entity keeps its own last-known heading (renderHeading)
      // rather than relying on this.bodyQuat carrying over between loop
      // iterations — otherwise an entity whose speed drops near zero
      // (e.g. a predator gliding to a stop / digesting) would silently
      // inherit whichever heading the *previous* entity in the array had
      // that frame, causing it to visually snap to an unrelated
      // direction instead of holding its own last heading.
      this.tmpPrevDir.set(entity.renderHeading.x, entity.renderHeading.y, entity.renderHeading.z);
      if (speed > 1e-6) {
        const invSpeed = 1 / speed;
        const targetX = vel.x * invSpeed;
        const targetY = vel.y * invSpeed;
        const targetZ = vel.z * invSpeed;
        if (keepUpright) {
          // Low-pass filter the heading itself — see
          // DRAGON_HEADING_SMOOTHING_RATE / UNICORN_HEADING_SMOOTHING_RATE
          // above for why this is needed in addition to whatever
          // per-style basis-building stabilization follows below. Each
          // style uses its own rate constant rather than sharing one.
          const rate = 1 - Math.exp(-dt * (uprightStyle === 'unicorn' ? UNICORN_HEADING_SMOOTHING_RATE : uprightStyle === 'shark' ? SHARK_HEADING_SMOOTHING_RATE : DRAGON_HEADING_SMOOTHING_RATE));
          let hx = entity.renderHeading.x + (targetX - entity.renderHeading.x) * rate;
          let hy = entity.renderHeading.y + (targetY - entity.renderHeading.y) * rate;
          let hz = entity.renderHeading.z + (targetZ - entity.renderHeading.z) * rate;
          const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
          entity.renderHeading = { x: hx / len, y: hy / len, z: hz / len };
        } else {
          entity.renderHeading = { x: targetX, y: targetY, z: targetZ };
        }
      }
      const dir = entity.renderHeading;
      this.tmpForward.set(dir.x, dir.y, dir.z);

      if (keepUpright && (uprightStyle === 'unicorn' || uprightStyle === 'shark')) {
        // Hard pitch clamp (not a proportional flatten) — see
        // UNICORN_ASCEND_PITCH_RADIANS / UNICORN_DESCEND_PITCH_RADIANS
        // (or SHARK_ASCEND_PITCH_RADIANS / SHARK_DESCEND_PITCH_RADIANS for
        // sharks) doc comments: unicorns clamp ascending to exactly flat
        // with a small allowed nose-down droop while descending; sharks
        // instead get a small *symmetric* range on both sides, since a
        // shark gently angling up as well as down still reads as natural.
        // Only the orientation basis is touched here, not
        // entity.renderHeading/velocity, so the actual flight path
        // (where the flock logic takes the entity) is unaffected — just
        // how level the model looks while following it.
        this.tmpUnicornHorizontal.set(this.tmpForward.x, 0, this.tmpForward.z);
        const horizontalLen = this.tmpUnicornHorizontal.length();
        if (horizontalLen > 1e-6) {
          this.tmpUnicornHorizontal.divideScalar(horizontalLen);
          const rawPitch = Math.atan2(this.tmpForward.y, horizontalLen);
          // Ceiling is UNICORN_ASCEND_PITCH_RADIANS (0 — never nose-up),
          // floor is -UNICORN_DESCEND_PITCH_RADIANS (a small allowed
          // nose-down droop while sinking). Sharks use their own shallow
          // symmetric ceiling/floor instead.
          const ascendLimit = uprightStyle === 'shark' ? SHARK_ASCEND_PITCH_RADIANS : UNICORN_ASCEND_PITCH_RADIANS;
          const descendLimit = uprightStyle === 'shark' ? SHARK_DESCEND_PITCH_RADIANS : UNICORN_DESCEND_PITCH_RADIANS;
          const clampedPitch = THREE.MathUtils.clamp(rawPitch, -descendLimit, ascendLimit);
          this.tmpForward.copy(this.tmpUnicornHorizontal).multiplyScalar(Math.cos(clampedPitch));
          this.tmpForward.y = Math.sin(clampedPitch);
        }
        // else: heading is already (near-)vertical with essentially no
        // horizontal component to anchor a clamped pitch to — vanishingly
        // rare given flock steering, and the final up-tilt safety clamp
        // below still bounds the result either way.
      }

      if (keepUpright && uprightStyle === 'dragon') {

        // Dragons only: build an orientation that keeps the model
        // right-side-up by construction, instead of the shortest-arc
        // rotation used below for everything else
        // (Quaternion.setFromUnitVectors(FORWARD_AXIS, dir)) — that
        // approach has an entire free degree of roll around `dir` that it
        // resolves arbitrarily, which reads as flying upside-down for long
        // stretches rather than just transiently while banking. Ordinary
        // boids/predators are fine flying upside-down sometimes (their
        // geometry doesn't make it obvious), but dragons are large and
        // wing-heavy enough that it looks very wrong, and the "hover-y,
        // always-upright" look is closer to how TV/movie dragons read
        // anyway — so this is applied to dragons only.
        //
        // Roll is always anchored to WORLD_UP_AXIS so dragons settle back
        // to level rather than free-drifting/precessing over time — an
        // earlier attempt derived right/up from each entity's own previous
        // frame instead of a fixed world reference, which avoided a hard
        // snap but had no anchor to correct back to level, so roll could
        // wander until an entity's heading happened to pass near its own
        // current up vector, hitting the exact same singularity at an
        // unpredictable, arbitrary orientation (reported as random jumpy
        // flips and entities going edge-on/"2D").
        //
        // A later attempt tried to soften the near-vertical singularity
        // (forward parallel to WORLD_UP_AXIS) by blending WORLD_UP_AXIS
        // with a fallback axis across a dot-product *range*. That backfired:
        // the blend factor only depends on |forward.y|, so the blended
        // reference can itself land parallel to forward for various
        // headings anywhere inside that range, collapsing the cross
        // product to ~zero and flattening the model.
        //
        // A third attempt only special-cased the *exact* zero-length cross
        // product (a literal single-point singularity real headings
        // essentially never hit) and otherwise always normalized whatever
        // tiny cross product resulted. That still flickered/flattened,
        // because normalizing an already-tiny vector amplifies ordinary
        // per-frame floating-point noise into a visibly different
        // direction each frame — a real problem for a several-degree cone
        // around the pole, not just the exact point.
        //
        // Fixed by keeping a per-entity persisted "right" vector
        // (entity.renderRight): outside the near-pole cone, it's discarded
        // and freshly recomputed straight from WORLD_UP_AXIS every frame
        // (no blending, no drift). Only inside the cone do we reuse last
        // frame's right vector, re-orthogonalized against the *current*
        // forward via Gram-Schmidt — smooth and numerically stable, and
        // safe against long-term drift since it's discarded the instant
        // the heading exits the cone.
        //
        // Restricting this whole approach to dragons also sidesteps the
        // original motivation for the wider rollout: since regular boids
        // are allowed to fly upside-down again, they no longer need (or
        // hit the singularity of) a world-up-anchored basis at all.
        // Right/up must be built so that Right x Forward = Up (matching
        // MODEL_RIGHT_AXIS x FORWARD_AXIS = MODEL_UP_AXIS, i.e. local
        // (1,0,0) x (0,1,0) = (0,0,1)) — otherwise the resulting basis
        // matrix is left-handed (determinant -1), which is not a valid
        // rotation. Quaternion.setFromRotationMatrix silently produces a
        // garbage orientation for such a matrix instead of erroring, so
        // this previously read `crossVectors(WORLD_UP_AXIS, tmpForward)`
        // (giving Right x Forward = -Up, det -1) and models ended up
        // facing a direction unrelated to their actual heading — most
        // visible as the fishtank seahorse (a unicorn reskin) appearing
        // to swim backwards, since its asymmetric head/tail shape makes
        // a wrong-facing orientation obvious in a way a roughly-
        // symmetric dragon/pegasus silhouette does not.
        this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS);
        if (this.tmpRight.lengthSq() < NEAR_POLE_RIGHT_LENGTH_THRESHOLD_SQ) {
          this.tmpPersistedRight.set(entity.renderRight.x, entity.renderRight.y, entity.renderRight.z);
          // Re-orthogonalize: remove any component along the *current*
          // forward so the persisted vector stays a valid "right" even as
          // forward keeps moving through the cone.
          this.tmpPersistedRight.addScaledVector(this.tmpForward, -this.tmpPersistedRight.dot(this.tmpForward));
          if (this.tmpPersistedRight.lengthSq() < 1e-10) {
            // Last-ditch fallback: the persisted vector itself has
            // collapsed (forward jumped drastically frame to frame) —
            // vanishingly rare, but keep the math well-defined.
            this.tmpPersistedRight.crossVectors(this.tmpForward, UP_REFERENCE_FALLBACK_AXIS);
          }
          this.tmpRight.copy(this.tmpPersistedRight);
        }
        this.tmpRight.normalize();
        entity.renderRight = { x: this.tmpRight.x, y: this.tmpRight.y, z: this.tmpRight.z };
        this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
        // Columns are where each local axis (X, Y, Z) maps to in world
        // space: local X -> right, local Y -> forward (matches
        // FORWARD_AXIS), local Z -> up (matches MODEL_UP_AXIS).
        this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
        this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
      } else if (keepUpright && (uprightStyle === 'unicorn' || uprightStyle === 'shark')) {
        // Unicorns/sharks: a much simpler basis than the dragon path
        // above, and deliberately so — since pitch was already
        // hard-clamped to a small angle further up, tmpForward here is
        // never anywhere near parallel to WORLD_UP_AXIS, so the near-pole
        // "right" vector instability the dragon path works around simply
        // doesn't arise for either of these styles. No persisted-right
        // fallback, no re-orthogonalization, just a direct cross product
        // every frame.
        // See the dragon branch above for why the operand order here
        // (Forward x WorldUp, then Right x Forward) matters — the
        // reversed order previously used produced a left-handed
        // (determinant -1) basis, which is what caused seahorses (the
        // fishtank reskin of unicorns) to visibly swim backwards.
        this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS).normalize();
        entity.renderRight = { x: this.tmpRight.x, y: this.tmpRight.y, z: this.tmpRight.z };
        this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
        this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
        this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
      } else {
        // Everyone else: simple shortest-arc rotation from the model's
        // rest forward axis to the current heading. This has a free
        // degree of roll around `dir` (so these entities can end up
        // flying upside-down sometimes), but it has no near-pole
        // singularity to speak of, so it never flickers/flattens —
        // acceptable here since non-dragon/unicorn geometry doesn't read
        // as obviously "wrong side up" the way a large dragon or a
        // horse-legged unicorn does.
        this.bodyQuat.setFromUnitVectors(FORWARD_AXIS, this.tmpForward);
      }


      // Cosmetic bank/roll: lean into turns rather than always flying
      // perfectly level. Estimated from how much the heading direction
      // rotated around the world-up axis since last frame (a simple
      // yaw-rate proxy), then smoothed and clamped well short of a full
      // flip — "it's fine if they bank hard, but they should prefer to
      // be right-side up" the rest of the time.
      const turnSignal = this.tmpPrevDir.cross(this.tmpForward).y;
      const targetBank = THREE.MathUtils.clamp(
        -turnSignal * BANK_GAIN * bankScale,
        -MAX_BANK_RADIANS * bankScale,
        MAX_BANK_RADIANS * bankScale,
      );
      const bankSmoothing = 1 - Math.exp(-dt * BANK_SMOOTHING_RATE);
      entity.renderBank += (targetBank - entity.renderBank) * bankSmoothing;
      this.rollQuat.setFromAxisAngle(FORWARD_AXIS, entity.renderBank);
      this.bodyQuat.multiply(this.rollQuat);

      if (keepUpright && uprightStyle === 'dragon') {
        // Final safety net (see dragonDisplayQuats doc comment): never
        // let the *displayed* orientation jump straight to this frame's
        // target — only rotate toward it at a bounded rate. This can't
        // eliminate a bad target computation, but it guarantees any such
        // glitch is never visible as an instant flip/flatten, only ever
        // as a smooth (if momentarily oddly-directed) turn.
        let displayQuat = this.dragonDisplayQuats.get(entity.id);
        if (!displayQuat) {
          displayQuat = this.bodyQuat.clone();
          this.dragonDisplayQuats.set(entity.id, displayQuat);
        } else {
          displayQuat.rotateTowards(this.bodyQuat, DRAGON_MAX_TURN_RADIANS_PER_SEC * dt);
        }
        this.bodyQuat.copy(displayQuat);
      } else if (keepUpright && uprightStyle === 'unicorn') {
        // Same turn-rate-limiting idea as the dragon branch above, but
        // its own map/constant (see unicornDisplayQuats' doc comment).
        let displayQuat = this.unicornDisplayQuats.get(entity.id);
        if (!displayQuat) {
          displayQuat = this.bodyQuat.clone();
          this.unicornDisplayQuats.set(entity.id, displayQuat);
        } else {
          displayQuat.rotateTowards(this.bodyQuat, UNICORN_MAX_TURN_RADIANS_PER_SEC * dt);
        }

        // Hard ceiling on how far the model's up/legs axis can end up
        // tilted from true vertical, applied last (after pitch clamp,
        // basis construction, bank, and the turn-rate smoothing above
        // have all already been baked in) — see
        // UNICORN_MAX_UP_TILT_RADIANS' doc comment for why this is a
        // belt-and-suspenders guarantee rather than just relying on the
        // upstream constants being tuned correctly. Applied directly to
        // the persisted displayQuat (not a local copy) so next frame's
        // rotateTowards target already reflects the clamp, rather than
        // fighting it back open every frame.
        this.tmpUnicornUpWorld.copy(MODEL_UP_AXIS).applyQuaternion(displayQuat);
        const upTilt = this.tmpUnicornUpWorld.angleTo(WORLD_UP_AXIS);
        if (upTilt > UNICORN_MAX_UP_TILT_RADIANS) {
          this.tmpUnicornTiltAxis.crossVectors(this.tmpUnicornUpWorld, WORLD_UP_AXIS);
          if (this.tmpUnicornTiltAxis.lengthSq() > 1e-10) {
            this.tmpUnicornTiltAxis.normalize();
            this.unicornTiltCorrection.setFromAxisAngle(this.tmpUnicornTiltAxis, upTilt - UNICORN_MAX_UP_TILT_RADIANS);
            displayQuat.premultiply(this.unicornTiltCorrection);
          }
        }
        this.bodyQuat.copy(displayQuat);
      } else if (keepUpright && uprightStyle === 'shark') {
        // Same turn-rate-limiting + final up-tilt safety clamp as the
        // unicorn branch above, reusing its own map/constants (see
        // sharkDisplayQuats' / SHARK_MAX_TURN_RADIANS_PER_SEC' /
        // SHARK_MAX_UP_TILT_RADIANS' doc comments) rather than sharing the
        // unicorn's, since sharks/unicorns are otherwise-unrelated
        // entities that just happen to use the same shape of orientation
        // model.
        let displayQuat = this.sharkDisplayQuats.get(entity.id);
        if (!displayQuat) {
          displayQuat = this.bodyQuat.clone();
          this.sharkDisplayQuats.set(entity.id, displayQuat);
        } else {
          displayQuat.rotateTowards(this.bodyQuat, SHARK_MAX_TURN_RADIANS_PER_SEC * dt);
        }

        this.tmpUnicornUpWorld.copy(MODEL_UP_AXIS).applyQuaternion(displayQuat);
        const upTilt = this.tmpUnicornUpWorld.angleTo(WORLD_UP_AXIS);
        if (upTilt > SHARK_MAX_UP_TILT_RADIANS) {
          this.tmpUnicornTiltAxis.crossVectors(this.tmpUnicornUpWorld, WORLD_UP_AXIS);
          if (this.tmpUnicornTiltAxis.lengthSq() > 1e-10) {
            this.tmpUnicornTiltAxis.normalize();
            this.unicornTiltCorrection.setFromAxisAngle(this.tmpUnicornTiltAxis, upTilt - SHARK_MAX_UP_TILT_RADIANS);
            displayQuat.premultiply(this.unicornTiltCorrection);
          }
        }
        this.bodyQuat.copy(displayQuat);
      }

      // Body: just position + orientation, no flap. Caught boids shrink
      // (entityScale -> 0) as they're "swallowed" — see Boid.dying.
      // worldScale !== 1 (fishtank only) grows the position outward from
      // fishtankCenter rather than the coordinate origin, so the whole
      // flock spreads to fill the visually-bigger tank symmetrically
      // instead of shifting toward one corner of it.
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
      // Dragon/shark tails get an extra sway (see DRAGON_TAIL_SWAY_
      // AMPLITUDE / SHARK_TAIL_SWAY_AMPLITUDE) computed below once the
      // wingbeat phase is known; every other creature's tail just
      // follows the body rigidly, as before.
      if (set.tail && uprightStyle !== 'dragon' && uprightStyle !== 'shark') set.tail.setMatrixAt(i, this.dummy.matrix);

      // Wings: apply an extra local flap rotation around the forward axis
      // before combining with the shared body orientation, so both wings
      // swing up/down in sync regardless of which way the bird is heading.
      const speedFrac = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
      const amplitude = flapIdleAmplitude + flapSpeedAmplitude * speedFrac;
      let phase: number;
      if (uprightStyle === 'unicorn') {
        // Flap frequency scales with vertical velocity instead of the
        // constant-frequency formula everyone else uses — "flap faster
        // as they go up, slower as they descend" — so the phase has to
        // be integrated (see unicornFlapPhase's doc comment) rather than
        // computed directly from elapsed time.
        const climbFrac = maxSpeed > 0 ? THREE.MathUtils.clamp(vel.y / maxSpeed, -1, 1) : 0;
        const freqMultiplier = climbFrac >= 0
          ? 1 + UNICORN_CLIMB_FLAP_BOOST * climbFrac
          : 1 - UNICORN_DESCEND_FLAP_CUT * -climbFrac;
        const effectiveFrequency = flapFrequency * freqMultiplier;
        const prevPhase = this.unicornFlapPhase.get(entity.id) ?? entity.id * 1.7;
        phase = prevPhase + effectiveFrequency * dt;
        this.unicornFlapPhase.set(entity.id, phase);
      } else {
        phase = elapsed * flapFrequency + entity.id * 1.7;
      }
      const flapAngle = amplitude * Math.sin(phase) + finRestBiasRad;

      this.flapQuat.setFromAxisAngle(FORWARD_AXIS, flapAngle);
      this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
      this.dummy.updateMatrix();
      set.wingLeft.setMatrixAt(i, this.dummy.matrix);

      this.flapQuat.setFromAxisAngle(FORWARD_AXIS, -flapAngle);
      this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
      this.dummy.updateMatrix();
      set.wingRight.setMatrixAt(i, this.dummy.matrix);

      // Tail sway (dragons/sharks only): swing the tail around
      // tailSwayAxis — pitch (up/down) for a dragon's whip tail, yaw
      // (side to side) for a shark's swimming tail beat — using its own
      // phase (independent frequency, but still offset from the fin/
      // wing motion) so the tail reads as part of the same continuous
      // motion rather than an unrelated animation, without necessarily
      // moving in lockstep with it.
      if (set.tail) {
        if (uprightStyle === 'dragon' || uprightStyle === 'shark') {
          const tailPhase = elapsed * (tailSwayFrequency ?? flapFrequency) + entity.id * 1.7 + DRAGON_TAIL_SWAY_PHASE_OFFSET;
          const tailSwayAngle = tailSwayAmplitude * Math.sin(tailPhase);
          this.tailSwayQuat.setFromAxisAngle(tailSwayAxis, tailSwayAngle);
          this.dummy.quaternion.copy(this.bodyQuat).multiply(this.tailSwayQuat);
          this.dummy.updateMatrix();
          if (tailSwayPivotY !== 0) {
            // The tail geometry's own root vertex sits at local
            // (0, tailSwayPivotY, 0) — the body's actual (static) tail
            // attachment point — not at the shared local origin. Simply
            // rotating around the origin (as above) would swing that
            // root vertex through an arc away from the body, since it's
            // some distance from the pivot, making the tail look
            // detached/loose rather than hinged at a fixed joint. So
            // instead of baking tailSwayQuat directly into dummy's own
            // quaternion, compose translate(+pivot) * rotate(tailSwayQuat)
            // * translate(-pivot) as an *extra* matrix applied in the
            // tail's own local space (before dummy's position/bodyQuat),
            // so the root vertex — which lands exactly on the pivot
            // point after that first translate — stays fixed under the
            // rotation, and only the fin's own outward geometry visibly
            // swings, matching how a real tail flexes at its base.
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
      }

      // Color-by-state: lerp toward the highlight color as intensity rises.
      // Three coloring modes, checked in priority order:
      //  1. getSpeciesColors: a species with distinct, non-uniform plumage
      //     (e.g. the parrot's macaw-style body/wing/tail colors) — each
      //     part gets its own small id-derived jitter for individual
      //     variety, but the three parts stay distinctly different hues
      //     from each other (that contrast IS the "parrot" visual cue).
      //  2. individualVariation: the sparrow-type "shades of brown" jitter
      //     around one shared base color, with occasional distinct morphs.
      //  3. Flat: every entity in this set renders identically.
      const speciesColors = getSpeciesColors?.(entity);
      let effectiveBase = baseColor;
      let effectiveWing: THREE.Color | null = null;
      let effectiveTail: THREE.Color | null = null;

      if (speciesColors) {
        this.jitterHSL(this.variantColor, speciesColors.body, entity.id, 1, 0.05, 0.12, 0.1);
        this.jitterHSL(this.wingColor, speciesColors.wing, entity.id, 2, 0.05, 0.12, 0.1);
        this.jitterHSL(this.tailColor, speciesColors.tail, entity.id, 3, 0.05, 0.12, 0.1);
        effectiveBase = this.variantColor;
        effectiveWing = this.wingColor;
        effectiveTail = this.tailColor;
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
      this.stateColor.copy(effectiveBase).lerp(highlightColor, getIntensity(entity));
      set.body.setColorAt(i, this.stateColor);
      if (effectiveWing) {
        // Species with their own distinct wing/tail base colors keep those
        // hues rather than just darkening the body color.
        this.wingColor.copy(effectiveWing).lerp(highlightColor, getIntensity(entity));
        set.wingLeft.setColorAt(i, this.wingColor);
        set.wingRight.setColorAt(i, this.wingColor);
        if (set.tail) {
          if (effectiveTail) {
            this.tailColor.copy(effectiveTail).lerp(highlightColor, getIntensity(entity));
            set.tail.setColorAt(i, this.tailColor);
          } else {
            set.tail.setColorAt(i, this.wingColor);
          }
        }
      } else if (individualVariation) {
        // Wings/tail render a touch darker than the body — real bird wing
        // feathers are almost always a shade or two darker than the breast/
        // body plumage, and this reads clearly even at a distance.
        this.wingColor.copy(this.stateColor).multiplyScalar(0.82);
        set.wingLeft.setColorAt(i, this.wingColor);
        set.wingRight.setColorAt(i, this.wingColor);
        if (set.tail) set.tail.setColorAt(i, this.wingColor);
      } else {
        set.wingLeft.setColorAt(i, this.stateColor);
        set.wingRight.setColorAt(i, this.stateColor);
        if (set.tail) set.tail.setColorAt(i, this.stateColor);
      }
      if (set.legs) set.legs.setColorAt(i, this.stateColor);
      if (set.beak && beakColor) {
        // Small per-individual jitter, same treatment as the other parts
        // — keeps a flock of e.g. cardinals from looking like every
        // single beak is the identical exact pixel color.
        this.jitterHSL(this.beakInstanceColor, beakColor, entity.id, 5, 0.04, 0.1, 0.08);
        set.beak.setColorAt(i, this.beakInstanceColor);
      }
    }

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

  /** Spawns a 3D blood-splatter burst for every not-yet-seen Simulation.catchEvent. */
  private spawnBloodFromCatches(sim: Simulation): void {
    for (const catchEvent of sim.catchEvents) {
      if (catchEvent.id <= this.lastSeenCatchId) continue;
      this.lastSeenCatchId = catchEvent.id;
      const position = new THREE.Vector3(catchEvent.position.x, catchEvent.position.y, catchEvent.position.z);
      const direction = new THREE.Vector3(catchEvent.direction.x, catchEvent.direction.y, catchEvent.direction.z);
      this.bloodEffects.spawn(position, direction, BOID_LENGTH * 0.9);
    }
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
      let nextTime = this.nextFireBreathTime.get(predator);
      if (nextTime === undefined) {
        nextTime = elapsed + 1 + Math.random() * 2.5;
        this.nextFireBreathTime.set(predator, nextTime);
      }
      if (elapsed < nextTime) continue;
      if (predator.huntIntensity < 0.45) {
        // Not excited enough to breathe fire right now — check again soon
        // rather than firing the instant intensity crosses the threshold.
        this.nextFireBreathTime.set(predator, elapsed + 0.5);
        continue;
      }

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
      const mouth = computeDragonMouthTransform(DRAGON_LENGTH);
      let direction: THREE.Vector3;
      let origin: THREE.Vector3;
      if (displayQuat) {
        direction = this.tmpVec3.set(0, mouth.dirForward, mouth.dirUp).applyQuaternion(displayQuat).normalize().clone();
        const localOffset = new THREE.Vector3(0, mouth.offsetForward, mouth.offsetUp).applyQuaternion(displayQuat);
        origin = new THREE.Vector3(predator.position.x, predator.position.y, predator.position.z).add(localOffset);
      } else {
        const dir = predator.renderHeading;
        direction = this.tmpVec3.set(dir.x, dir.y, dir.z).clone();
        origin = new THREE.Vector3(
          predator.position.x + dir.x * DRAGON_LENGTH * 0.55,
          predator.position.y + dir.y * DRAGON_LENGTH * 0.55,
          predator.position.z + dir.z * DRAGON_LENGTH * 0.55,
        );
      }

      // Scale the flame's reach by how fast the dragon is actually
      // flying right now — a hovering/slow dragon gets a short puff close
      // to its mouth, while one at full speed gets a stream that stretches
      // well out ahead of it (see fireBreath.spawn's reach/emitterVelocity
      // doc comment) so it doesn't visually fly through its own fire.
      const vel = predator.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const speedFraction = THREE.MathUtils.clamp(speed / Math.max(params.predatorMaxSpeed, 1e-6), 0, 1);
      const emitterVelocity = new THREE.Vector3(vel.x, vel.y, vel.z);

      this.fireBreathEffects.spawn(origin, direction, DRAGON_LENGTH * 0.5, emitterVelocity, speedFraction);
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

  render(sim: Simulation): void {
    this.ensureScene(sim);
    const elapsed = (performance.now() - this.startTime) / 1000;
    const dt = Math.max(0, Math.min(elapsed - this.lastElapsed, 1 / 20));
    this.lastElapsed = elapsed;
    const isNature = params.visualStyle === 'nature';
    const isFishtank = params.visualStyle === 'fishtank';
    const isOrganic = isNature || isFishtank;
    // Recomputed every frame (cheap) rather than cached, so it always
    // reflects the current sim/world params without needing extra
    // invalidation logic — used below to grow fishtank's boid positions
    // around the tank's true center (see updateInstances' worldScale
    // param / TANK_VISUAL_SCALE's doc comment). Horizontally (x/z) this
    // is the sim's raw center, matching placeFishtankEnvironment's
    // horizontal anchor; vertically (y) it's 0 — the tank's bottom,
    // resting on the table — NOT the sim's raw vertical center, matching
    // placeFishtankEnvironment's bottom-anchored vertical growth (see
    // its `center.y` doc comment) so fish grow in lockstep with the
    // glass box instead of drifting out of sync with it.
    if (isFishtank) {
      this.fishtankCenter.set(sim.width / 2, 0, params.worldDepth / 2);
    }

    // AfterimagePass's damp uniform controls how strongly the previous
    // frame persists — same trailAmount knob used by the 2D renderer.
    this.afterimagePass.uniforms.damp.value = Math.max(0, Math.min(0.96, params.trailAmount));
    this.natureEnv.update(elapsed);
    this.fishtankEnv.update(elapsed);
    this.driftingClouds.update(dt);
    this.spawnBloodFromCatches(sim);
    this.bloodEffects.update(dt);
    this.spawnFireFromDragons(sim, elapsed);
    this.fireBreathEffects.update(dt);

    // Each UFOVisual slot maps 1:1 by index to an active sim.ufos entry;
    // slots beyond the current active count are simply hidden.
    const ufoWorldScale = isFishtank ? TANK_VISUAL_SCALE : 1;
    const ufoBeamLength = UFO_BEAM_REACH * ufoWorldScale;
    for (let i = 0; i < this.ufoVisuals.length; i++) {
      const ufo = sim.ufos[i];
      const visual = this.ufoVisuals[i];
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
      } else {
        visual.setState(false, this.tmpVec3, 0, 0);
      }
      visual.update(dt);
    }

    const anySpeciesInstances = BOID_SPECIES_CONFIGS.some((config) => this.speciesInstances.get(config.species));
    if (anySpeciesInstances) {
      const boidsBySpecies = new Map<BoidSpecies, Boid[]>();
      for (const boid of sim.boids) {
        const bucket = boidsBySpecies.get(boid.species);
        if (bucket) bucket.push(boid);
        else boidsBySpecies.set(boid.species, [boid]);
      }
      for (const config of BOID_SPECIES_CONFIGS) {
        const instances = this.speciesInstances.get(config.species);
        if (!instances) continue;
        const entities = boidsBySpecies.get(config.species) ?? [];
        // Fish-tail wave (fishtank only): every fishtank species' caudal
        // fin is rooted at the model's own local origin (sparrow/
        // goldfinch/cardinal/bluejay's plain small-fish geometry, and
        // now the parrot species' butterflyfish geometry too), so it's
        // safe to sway around the shared pivot with no detachment risk
        // (see FISH_TAIL_SWAY_AMPLITUDE's doc comment).
        const isFishTail = isFishtank;
        this.updateInstances(
          instances,
          entities,
          params.boidMaxSpeed,
          elapsed,
          dt,
          isOrganic ? config.natureBase : config.arcadeBase,
          isOrganic ? NATURE_BOID_PANIC : ARCADE_BOID_PANIC,
          (entity) => (entity as Boid).panicLevel,
          FLAP_FREQUENCY,
          FLAP_IDLE_AMPLITUDE,
          FLAP_SPEED_AMPLITUDE,
          (entity) => (entity as Boid).scale,
          config.colors || config.getColors ? true : isOrganic,
          config.getColors ?? (config.colors ? () => config.colors! : undefined),
          false,
          'dragon',
          1,
          config.beakColor,
          0,
          isFishTail ? MODEL_UP_AXIS : MODEL_RIGHT_AXIS,
          isFishTail ? FISH_TAIL_SWAY_AMPLITUDE : DRAGON_TAIL_SWAY_AMPLITUDE,
          isFishTail ? FISH_TAIL_SWAY_FREQUENCY : undefined,
          0,
          isFishtank ? TANK_VISUAL_SCALE : 1,
          isFishtank ? FISHTANK_FISH_MESH_BOOST : 1,
        );
      }
    }
    const hawkInstances = this.predatorInstances.get('hawk');
    if (hawkInstances) {
      const isDragon = isOrganic && params.dragonPredators;
      const isShark = isDragon && isFishtank;
      const hawks = sim.predators.filter((predator) => predator.kind !== 'unicorn');
      this.updateInstances(
        hawkInstances,
        hawks,
        params.predatorMaxSpeed,
        elapsed,
        dt,
        isDragon ? (isFishtank ? SHARK_PREDATOR_BASE : DRAGON_PREDATOR_BASE) : isOrganic ? NATURE_PREDATOR_BASE : ARCADE_PREDATOR_BASE,
        isDragon ? (isFishtank ? SHARK_PREDATOR_HUNT : DRAGON_PREDATOR_HUNT) : isOrganic ? NATURE_PREDATOR_HUNT : ARCADE_PREDATOR_HUNT,
        (entity) => (entity as Predator).huntIntensity,
        isDragon ? (isShark ? SHARK_FLAP_FREQUENCY : DRAGON_FLAP_FREQUENCY) : FLAP_FREQUENCY,
        isDragon ? (isShark ? SHARK_FLAP_IDLE_AMPLITUDE : DRAGON_FLAP_IDLE_AMPLITUDE) : FLAP_IDLE_AMPLITUDE,
        isDragon ? (isShark ? SHARK_FLAP_SPEED_AMPLITUDE : DRAGON_FLAP_SPEED_AMPLITUDE) : FLAP_SPEED_AMPLITUDE,
        undefined,
        undefined,
        // Plain nature-style hawks (not dragon, not arcade/fishtank) get
        // the dedicated bald-eagle body/wing/tail color split — see
        // NATURE_HAWK_COLORS' doc comment. Must match the same isNature-
        // only gating used for bodyVertexColors above (fishtank's hawk
        // geometry has no baked vertex colors to read yet).
        !isDragon && isNature ? () => NATURE_HAWK_COLORS : undefined,
        isDragon,
        isShark ? 'shark' : 'dragon',
        1,
        undefined,
        // Sharks: fins droop down at rest and barely flap; the tail
        // yaws side to side (its actual swimming stroke) instead of
        // pitching up/down like the dragon's whip tail — see the
        // SHARK_* tuning constants' doc comment.
        isShark ? SHARK_FIN_REST_TILT_RAD : 0,
        isShark ? MODEL_UP_AXIS : MODEL_RIGHT_AXIS,
        isShark ? SHARK_TAIL_SWAY_AMPLITUDE : DRAGON_TAIL_SWAY_AMPLITUDE,
        isShark ? SHARK_TAIL_SWAY_FREQUENCY : undefined,
        isShark ? getSharkTailPivotY(DRAGON_LENGTH) : 0,
        isFishtank ? TANK_VISUAL_SCALE : 1,
        isFishtank ? FISHTANK_FISH_MESH_BOOST * (isShark ? FISHTANK_SHARK_MESH_BOOST : 1) : 1,
      );
    }

    const unicornInstances = this.predatorInstances.get('unicorn');
    if (unicornInstances) {
      const unicorns = sim.predators.filter((predator) => predator.kind === 'unicorn');
      this.updateInstances(
        unicornInstances,
        unicorns,
        params.predatorMaxSpeed,
        elapsed,
        dt,
        isOrganic ? NATURE_UNICORN_BODY : ARCADE_UNICORN_BASE,
        isOrganic ? NATURE_UNICORN_HUNT : ARCADE_UNICORN_HUNT,
        (entity) => (entity as Predator).huntIntensity,
        UNICORN_FLAP_FREQUENCY,
        UNICORN_FLAP_IDLE_AMPLITUDE,
        UNICORN_FLAP_SPEED_AMPLITUDE,
        undefined,
        undefined,
        () => (isFishtank ? FISHTANK_SEAHORSE_COLORS : isOrganic ? NATURE_UNICORN_COLORS : ARCADE_UNICORN_COLORS),
        // Unicorns always fly right-side-up, like dragons — see keepUpright's
        // doc comment. Unlike the dragon toggle, this applies in every 3D
        // style, not just nature, since it's a behavioral trait of the
        // character rather than a nature-style-only cosmetic flourish.
        true,
        // Unicorns get their own dedicated orientation model — see
        // updateInstances' uprightStyle === 'unicorn' branch and the
        // UNICORN_* constants near the top of this file — rather than
        // reusing the dragon path with different bias numbers.
        'unicorn',
        UNICORN_BANK_SCALE,
        undefined,
        0,
        MODEL_RIGHT_AXIS,
        DRAGON_TAIL_SWAY_AMPLITUDE,
        undefined,
        0,
        isFishtank ? TANK_VISUAL_SCALE : 1,
        isFishtank ? FISHTANK_FISH_MESH_BOOST : 1,
      );
    }

    if (isFishtank) {
      // Dynamic zoom-out clamp: computeFishtankRoomBounds' own
      // maxCameraDistance (set once, in ensureScene) has to satisfy the
      // *worst-case* permitted tilt at all times, which is overly
      // conservative at/near a level (untitled) view — there's no
      // floor/ceiling to clip through at all when looking straight
      // across the room. Recomputed every frame (cheap pure math, no
      // allocations worth caching) from the camera's *current* polar
      // angle via OrbitControls' own getPolarAngle(), so at level view
      // the camera can pull back much farther, right up near the far
      // wall (per an explicit ask to "zoom out farther... virtually
      // close to the wall behind"), while steeper tilts still clamp
      // down toward the same safe distance computed by
      // computeFishtankRoomBounds.
      const bounds = computeFishtankRoomBounds(sim.width, sim.height, params.worldDepth);
      const polarAngle = this.controls.getPolarAngle();
      // 0 at a level/horizontal view, growing toward cameraTiltUpRad
      // (looking down) or cameraTiltDownRad (looking up) at the tilt
      // extremes — see FishtankRoomBounds' cameraTiltUpRad/DownRad.
      const elevation = Math.abs(polarAngle - Math.PI / 2);
      const distToCeiling = bounds.roomFloorY + bounds.roomHeight - bounds.tankCenterY;
      const distToFloor = bounds.tankCenterY - bounds.roomFloorY;
      // Looking down (polarAngle < PI/2) rises toward the ceiling as
      // distance grows; looking up (polarAngle > PI/2) drops toward the
      // floor — each direction is clamped by its own clearance.
      const vertClearance = polarAngle < Math.PI / 2 ? distToCeiling : distToFloor;
      const sinE = Math.sin(elevation);
      const cosE = Math.cos(elevation);
      // Safety factor (0.92) matches computeFishtankRoomBounds' own 0.9,
      // just shy of 1 so the camera never grazes the actual floor/
      // ceiling/wall plane.
      const vertCap = sinE > 1e-4 ? (vertClearance / sinE) * 0.92 : Infinity;
      const horizCap = (bounds.wallMargin / Math.max(cosE, 1e-4)) * 0.92;
      this.controls.maxDistance = Math.min(vertCap, horizCap);
    }

    this.controls.update();
    this.composer.render();
  }

  dispose(): void {
    for (const config of BOID_SPECIES_CONFIGS) {
      this.disposeInstanceSet(this.speciesInstances.get(config.species) ?? null);
    }
    for (const kind of this.predatorInstances.keys()) {
      this.disposeInstanceSet(this.predatorInstances.get(kind) ?? null);
    }
    for (const geometries of [
      this.arcadeBoidGeometries,
      this.arcadeSparrowGeometries,
      this.arcadeParrotGeometries,
      this.arcadePredatorGeometries,
      this.natureBoidGeometries,
      this.natureSparrowGeometries,
      this.natureParrotGeometries,
      this.naturePredatorGeometries,
      this.dragonPredatorGeometries,
      this.unicornPredatorGeometries,
    ]) {
      geometries.body.dispose();
      geometries.wingLeft.dispose();
      geometries.wingRight.dispose();
      geometries.tail?.dispose();
      geometries.legs?.dispose();
    }
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

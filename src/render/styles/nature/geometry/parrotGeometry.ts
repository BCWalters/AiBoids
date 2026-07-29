import * as THREE from 'three';
import { pickGeometryDetail } from '../../../graphicsQuality';
import { buildTuckedBirdLegs } from './birdSharedGeometry';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import { BIRD_FEATHER_MASK_ATTRIBUTE } from '../birdFeatherShader';
import {
  mergeGeometriesWithColor,
  extrudeRingGeometry,
  mergePositionOnlyGeometries,
  mirrorGeometryAcrossX,
  subdivideGeometryTriangles,
  subdivideTriangleSoup,
  singleLegPart,
  swayingTailRig,
} from '../../../geometry/sharedGeometry';

/**
 * Parrot-specific geometry — split out from the shared "realistic bird"
 * builder (birdGeometry.ts, still used by hawks/sparrows/goldfinch/
 * cardinal/bluejay) so a macaw-style silhouette (large curved hooked
 * beak, compact rounded body, long trailing tail streamers, broad
 * rounded wings) can be iterated on independently without touching the
 * small-songbird shape. Wings are also parrot-specific (see
 * buildParrotWingGeometry below): the shared birdGeometry.ts wing is
 * shaped like a swept, pointed falcon/hawk wing, which combined with a
 * parrot's bright saturated color patterns read as a solid "shark fin"
 * rather than a bird wing — a broader, rounder paddle-shaped wing
 * (closer to a real parrot's) reads much better.
 */

const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
export interface ParrotPalette {
  beak: THREE.Color;
  feet: THREE.Color;
  eyeOuter: THREE.Color;
  back: THREE.Color;
  backLight: THREE.Color;
  belly: THREE.Color;
  wingTopFront: THREE.Color;
  wingTopRear: THREE.Color;
  wingUndersideFront: THREE.Color;
  wingUndersideRear: THREE.Color;
  tailRoot: THREE.Color;
  tailTip: THREE.Color;
  /** When true, the torso uses a smooth dorsal→ventral Z-axis gradient
   * (back color at crown/dorsal surface, belly color at ventral surface)
   * instead of the default dominant-weight back/belly region split. */
  dorsalGradient: boolean;
  /**
   * Bare facial skin. Macaws have a large unfeathered patch wrapping the eye
   * and running forward across the lores to the beak; on the classic scarlet
   * it is near-white, and every species has some pale version of it.
   *
   * This replaced a dorsal→ventral gradient across the face dome. That
   * gradient lerped `belly`→`back` in RGB, and on these palettes those are
   * near-complementary (blue-gold is literally gold→blue), so the middle of
   * the ramp passed through a desaturated near-white. The face dome is a
   * rounded cap that sweeps the whole Z range, so it displayed that muddy
   * midpoint as a pale blob sitting on the front of the head — the "awkward
   * beak attach dome". Painting the region deliberately, in a colour chosen
   * per palette, both removes the artifact and matches the real bird.
   */
  faceSkin: THREE.Color;
  /** Upper mandible. Scarlet macaws have a pale horn-coloured upper against a
   * black lower; most others are black throughout. */
  beakUpper: THREE.Color;
  /** Lower mandible; black on every macaw. */
  beakLower: THREE.Color;
}

const GREEN_FOCUS_PARROT_PALETTE: ParrotPalette = {
  // Military macaw: a red forehead/lore blaze, not a pale patch.
  faceSkin: new THREE.Color(0xc4302b),
  beakUpper: new THREE.Color(0xe0dccb),
  beakLower: new THREE.Color(0x2a2a2a),
  beak: new THREE.Color(0xe35d2b),
  feet: new THREE.Color(0x707070),
  eyeOuter: new THREE.Color(0x44b749),
  back: new THREE.Color(0x44b749),
  backLight: new THREE.Color(0x4fbf52),
  belly: new THREE.Color(0xc8e455),
  wingTopFront: new THREE.Color(0x389c3d),
  wingTopRear: new THREE.Color(0x2d8532),
  wingUndersideFront: new THREE.Color(0xe3ef63),
  wingUndersideRear: new THREE.Color(0x9da3a9),
  tailRoot: new THREE.Color(0x44b749),
  tailTip: new THREE.Color(0xc8e455),
  dorsalGradient: true,
};

const BLUE_GOLD_FOCUS_PARROT_PALETTE: ParrotPalette = {
  faceSkin: new THREE.Color(0xf2efe6),
  beakUpper: new THREE.Color(0x1b1b1b),
  beakLower: new THREE.Color(0x141414),
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x5a5a5a),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0x2f75ff),
  backLight: new THREE.Color(0x5d98ff),
  belly: new THREE.Color(0xffe033),
  wingTopFront: new THREE.Color(0x4f8fff),
  wingTopRear: new THREE.Color(0x245fdb),
  wingUndersideFront: new THREE.Color(0xffe033),
  wingUndersideRear: new THREE.Color(0xffcc00),
  tailRoot: new THREE.Color(0x2f75ff),
  tailTip: new THREE.Color(0xffe033),
  dorsalGradient: false,
};

const SCARLET_FOCUS_PARROT_PALETTE: ParrotPalette = {
  faceSkin: new THREE.Color(0xf6f3ec),
  beakUpper: new THREE.Color(0xe8dcc0),
  beakLower: new THREE.Color(0x161616),
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x6a6a6a),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0xe12832),
  backLight: new THREE.Color(0xf13a45),
  belly: new THREE.Color(0x2f61c9),
  wingTopFront: new THREE.Color(0xe43a44),
  wingTopRear: new THREE.Color(0x2a5fbf),
  wingUndersideFront: new THREE.Color(0xd7c56c),
  wingUndersideRear: new THREE.Color(0x36549a),
  tailRoot: new THREE.Color(0xe0c45d),
  tailTip: new THREE.Color(0x2b57b0),
  dorsalGradient: false,
};

const PURPLE_LAVENDER_FOCUS_PARROT_PALETTE: ParrotPalette = {
  // Invented species, so the patch just needs to read as bare skin against the
  // plumage rather than as a highlight on it: a warm grey-pink.
  faceSkin: new THREE.Color(0xd9bfc6),
  beakUpper: new THREE.Color(0x2a2436),
  beakLower: new THREE.Color(0x1a1622),
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x9a9a9a),
  eyeOuter: new THREE.Color(0x39ff14),
  back: new THREE.Color(0x6b4bb3),
  backLight: new THREE.Color(0x9a7fe0),
  belly: new THREE.Color(0xc8b4ff),
  wingTopFront: new THREE.Color(0xb49af3),
  wingTopRear: new THREE.Color(0x7a5dc7),
  wingUndersideFront: new THREE.Color(0xd8c9ff),
  wingUndersideRear: new THREE.Color(0xa99ec4),
  tailRoot: new THREE.Color(0x7b60c8),
  tailTip: new THREE.Color(0xd1c2ff),
  dorsalGradient: false,
};

const NEUTRAL_PARROT_PALETTE: ParrotPalette = {
  faceSkin: new THREE.Color(0xffffff),
  beakUpper: new THREE.Color(0xffffff),
  beakLower: new THREE.Color(0xffffff),
  beak: new THREE.Color(0x161616),
  feet: new THREE.Color(0x707070),
  eyeOuter: new THREE.Color(0xffffff),
  back: new THREE.Color(0xffffff),
  backLight: new THREE.Color(0xffffff),
  belly: new THREE.Color(0xffffff),
  wingTopFront: new THREE.Color(0xffffff),
  wingTopRear: new THREE.Color(0xffffff),
  wingUndersideFront: new THREE.Color(0xffffff),
  wingUndersideRear: new THREE.Color(0xbfc4cb),
  tailRoot: new THREE.Color(0xffffff),
  tailTip: new THREE.Color(0xffffff),
  dorsalGradient: false,
};

let ACTIVE_PARROT_PALETTE: ParrotPalette = GREEN_FOCUS_PARROT_PALETTE;
// Near-black eye dots — stay near-black under any per-instance body tint
// multiply (see the multiply-color reasoning in unicornGeometry.ts), so
// this single baked color works correctly across every macaw color
// pattern in PARROT_COLOR_PATTERNS.
const EYE_COLOR = new THREE.Color(0x0d0b08);
const PARROT_BODY_LATHE_SEGMENTS = pickGeometryDetail({ desktop: 32, mobile: 16 });
const PARROT_BODY_SLIM_SCALE = 0.8;
const PARROT_HEAD_TILT_RAD = THREE.MathUtils.degToRad(-28);
/**
 * Where the head-tilt shear starts to ramp in, as a fraction of halfLen. The
 * tilt is a bend, so it folds the surface into itself whenever the bend radius
 * (`span / angle`) drops below the body's own radius at that height. At the old
 * 0.3 the ramp had only 0.08 * halfLen ≈ 0.36 to work with against a 21° tilt,
 * giving a radius of ~0.98 against a body radius of ~1.30 — comfortably inside
 * the fold threshold, which is what produced the flat overhanging ledge at the
 * neck. Spreading the same tilt over a longer span raises the radius to ~3.5.
 */
const PARROT_HEAD_TILT_BLEND_START_FRAC = 0.05;
const PARROT_BEAK_DOWN_PITCH_RAD = THREE.MathUtils.degToRad(-24);
/**
 * How far the front of the skull is raked back, as a shear of Y by Z across the
 * face region (forehead forward, chin back).
 *
 * A parrot's skull does not taper to a point at the front. It is cut off by a
 * steeply slanted plane, and the two mandibles are wedges seated into that cut:
 * the upper fills the top of it, the lower fills the bottom, and the gape line
 * where they meet runs forward and slightly down from just below the eye. The
 * lathe can only close on its own axis, which yields a forward-pointing cone —
 * so the rake has to be sheared in afterwards. Without it the face reads as a
 * snout tapering to a point, and worse, it forces the beak onto the body axis
 * where it can only emerge horizontally.
 */
const PARROT_FACE_RAKE = 0.22;

/**
 * Radius thresholds, as fractions of the body's widest profile radius, over
 * which the plumage pattern fades out towards a lathe's collapsing ends.
 *
 * The full threshold sits below the brow radius so the crown and forehead keep
 * their plumage; only the face proper and the very tip of the tail root, where
 * the surface has no Z extent left to tile across, go smooth.
 */
/**
 * Lateral compression of the head, blended in from the neck.
 *
 * A lathe is circular in cross-section, but a parrot's head is not: seen
 * face-on it is markedly narrower than it is tall, which is most of why the
 * face reads as a parrot rather than as a generic bird. X is squeezed and Z
 * stretched slightly to compensate so the skull keeps its volume instead of
 * simply getting smaller.
 */
const PARROT_HEAD_NARROW_X = 0.52;
const PARROT_HEAD_TALL_Z = 1.0;

/**
 * Extra flattening of the crown — the dorsal (+z) half of the head only —
 * blended in over the same band as the narrowing.
 *
 * Applied one-sided so the skull loses height above the eye without the chin
 * and throat riding up with it. A parrot's crown sits only a little above the
 * base of the beak; a symmetric squash moves both surfaces and keeps the same
 * silhouette, just smaller.
 */
const PARROT_HEAD_CROWN_FLATTEN = 0.86;

/**
 * The same flattening for the ventral (-z) half — the throat and chin.
 *
 * Left unflattened, the underside keeps its full radius right up to the face
 * and then has to fall away sharply to meet the beak, which reads as a jowl
 * sticking out under the chin. Taking the two halves in separately lets the
 * head lose depth top and bottom without the silhouette developing a step at
 * either end.
 */
const PARROT_HEAD_CHIN_FLATTEN = 0.62;

/**
 * Where the head narrowing starts, as a fraction of the body half-length.
 * Well below the neck so the transition is long enough to read as a taper.
 */
const PARROT_HEAD_NARROW_START_FRAC = 0.02;

/**
 * Extra lateral squash applied to the mandibles on top of the head's.
 *
 * The beak cones are built at the face-plane radius, so narrowing the head
 * alone leaves the beak exactly as wide as the face it plugs into and the join
 * reads as a flat wall. Squashing it a little further leaves the face slightly
 * wider than the beak, which is what the reference photos show. Applied to X
 * only: the cone radius also sets the beak's depth in profile, and that profile
 * is already correct.
 */
const PARROT_BEAK_NARROW_X = 0.8;

/**
 * How much of a disk's own bulge is sunk back into the skull, as a fraction of
 * the sagitta of the chord it cuts.
 *
 * A flat disk laid on a convex surface stands proud of it by that sagitta at
 * the rim. Sinking most — not all — of it leaves the eye set into the head
 * rather than stuck onto it, while keeping the ring clear of the surface so it
 * cannot be clipped by it.
 */
const PARROT_EYE_SET_IN_FRAC = 0.3;

const PARROT_FEATHER_FADE_BARE_RADIUS_FRAC = 0.2;
const PARROT_FEATHER_FADE_FULL_RADIUS_FRAC = 0.52;
const PARROT_TAIL_ROOT_Y_FACTOR = -0.46;

/**
 * Spanwise extent of the bare facial patch, on the same `headFrac` scale the
 * eye and face-point use (so it moves with the head, not with absolute Y).
 * `START` is where the patch begins to fade in, behind the eye; `FULL` is where
 * it is fully bare, at the beak. The eye sits at 0.79, so the patch surrounds
 * it rather than stopping short of it — that wrap is what makes it read as a
 * macaw's bare face rather than as a pale muzzle.
 *
 * Kept tight around the eye and lore. An earlier, much broader version reached
 * back over roughly half the head, which is fine when the skin is near-white but
 * turns into a blotch once a palette paints it a strong colour (the green
 * profile's red military-macaw blaze). The bare skin should be a facial marking,
 * not a second colour field competing with the plumage.
 */
const PARROT_FACE_PATCH_START_FRAC = 0.70;
const PARROT_FACE_PATCH_FULL_FRAC = 0.90;

/**
 * How far up the head the bare patch is allowed to climb, expressed as the
 * vertex normal's Z component (+1 = straight up at the crown). Macaws keep a
 * fully feathered coloured crown above the bare skin, so the patch has to be
 * cut off before the top of the head or the bird loses its cap.
 */
const PARROT_FACE_PATCH_CROWN_LIMIT = 0.24;

/**
 * Number of trailing-edge flight feathers per wing.
 *
 * Raised from 12 so the fan reads as real plumage rather than a row of spikes
 * (#245 follow-up). See PARROT_FEATHER_BASE_HALF_GAP for the packing maths that
 * has to move with this number.
 */
const PARROT_FEATHER_COUNT = 20;

/**
 * Half-width of each feather's base, as a fraction of the trailing edge.
 *
 * The feathers are seated at `featherT = smoothstep(i / (n - 1))`, so their
 * spacing is not uniform: smoothstep's derivative peaks at 1.5 in the middle of
 * the fan, making the widest neighbour gap about `1.5 / (n - 1)` — roughly
 * 0.079 at n = 20. Bases therefore have to be at least half that (≈0.040) wide
 * merely to touch. This value is set deliberately above that threshold so they
 * genuinely overlap by ~20% at the loosest point in the fan and by more towards
 * the ends, which is what removes the notches that used to show between them.
 *
 * Keep this comfortably above `0.75 / (PARROT_FEATHER_COUNT - 1)` if the count
 * changes, or the notches come back.
 */
const PARROT_FEATHER_BASE_HALF_GAP = 0.048;

/**
 * Shingle offset between successive flight feathers, as a fraction of chord.
 * Because the bases overlap, coplanar vanes would fuse into a single slab;
 * separating each neighbouring pair keeps the overlap reading as layered
 * feathers.
 *
 * This is applied in ONE direction only (see PARROT_FEATHER_SEAT_FRAC). An
 * earlier version alternated it about the wing's mid-plane, which put every
 * even-indexed feather's upper face above the panel's own upper surface: near
 * the root, where feather and panel overlap in plan, half the fan poked through
 * the top of the wing. Bending the wing changed which ones breached, so
 * feather-shaped patches flickered on and off across the wing during the flap.
 */
const PARROT_FEATHER_SHINGLE_FRAC = 0.012;

/**
 * Depth below the wing panel's mid-plane at which the whole flight-feather fan
 * is seated, as a fraction of chord.
 *
 * Every feather vertex ends up at or below `-chord * this`, and the panel's
 * upper surface is at `+chord * 0.006`, so no feather can surface through the
 * top of the wing. Real primaries emerge from under the covert layer too, so
 * seating rather than centring them is also the more correct arrangement.
 *
 * This clearance is only meaningful if the panel actually holds the shape the
 * undulation shader gives it, which is why the panel is subdivided — see
 * PARROT_WING_PANEL_DIVISIONS. Undivided, the panel missed its own displaced
 * surface by several times this depth and the fan surfaced right through it.
 */
const PARROT_FEATHER_SEAT_FRAC = 0.011;

/**
 * How many times each wing-panel triangle is split along each edge before the
 * undulation shader gets hold of it.
 *
 * The panel is a triangle fan radiating from the shoulder, so its triangles
 * reach from the root all the way to the wingtip — spanning 98 % of the wing.
 * The undulation is a travelling wave along that same axis, and a triangle can
 * only represent it as a straight chord between its corners, so an undivided
 * panel missed its own displaced surface by about 0.95 model units. The flight
 * feathers are small enough to follow the wave closely, and they are seated
 * only 0.058 below the panel, so the panel swung out from under them and they
 * surfaced through it by up to 0.55 — nearly ten times the seat depth — by an
 * amount that changed with the flap phase.
 *
 * At 16 divisions the longest edge is about a sixteenth of the span, bringing
 * the residual error (which falls with the square of edge length) to 0.010, a
 * sixth of the seat depth, and no feather breaches at any phase. The cost is
 * paid once at build time on a geometry every parrot instance shares.
 */
const PARROT_WING_PANEL_DIVISIONS = pickGeometryDetail({ desktop: 16, mobile: 6 });


export type ParrotPaletteProfile =
  | 'green-focus'
  | 'blue-gold-focus'
  | 'scarlet-focus'
  | 'purple-lavender-focus'
  | 'neutral';

const PARROT_PALETTES: Record<ParrotPaletteProfile, ParrotPalette> = {
  'green-focus': GREEN_FOCUS_PARROT_PALETTE,
  'blue-gold-focus': BLUE_GOLD_FOCUS_PARROT_PALETTE,
  'scarlet-focus': SCARLET_FOCUS_PARROT_PALETTE,
  'purple-lavender-focus': PURPLE_LAVENDER_FOCUS_PARROT_PALETTE,
  neutral: NEUTRAL_PARROT_PALETTE,
};

/**
 * A profile's baked palette. Exported so tests can assert against the colours
 * the geometry is actually built from, rather than restating the hexes and
 * letting the two copies drift apart.
 */
export function parrotPaletteFor(profile: ParrotPaletteProfile): Readonly<ParrotPalette> {
  return PARROT_PALETTES[profile];
}

export function parrotFaceSkinColor(profile: ParrotPaletteProfile): THREE.Color {
  return PARROT_PALETTES[profile].faceSkin;
}

/**
 * Vertex count of the wing panel, which `buildParrotWingGeometry` merges first
 * and so owns as the leading prefix of the wing buffer: 9 boundary segments, one
 * upper and one lower triangle each, 3 vertices per triangle.
 *
 * Exported for tests, which need a set of vertices whose up/down side is known
 * from position alone. Only the panel qualifies: it straddles z = 0, while the
 * flight feathers are seated entirely below it (PARROT_FEATHER_SEAT_FRAC) so
 * both of their faces sit at negative z.
 */
export const PARROT_WING_PANEL_VERTEX_COUNT = 9 * 2 * 3;

export function createParrotGeometries(
  length: number,
  width: number,
  paletteProfile: ParrotPaletteProfile = 'green-focus',
): CreatureGeometries {
  const previousPalette = ACTIVE_PARROT_PALETTE;
  ACTIVE_PARROT_PALETTE = PARROT_PALETTES[paletteProfile];
  try {
    const body = buildParrotBodyGeometry(length, width);

    // Parrots have proportionally broader, more paddle-shaped wings than a
    // soaring hawk (built for short powerful flaps through canopy, not
    // long glides) — see buildParrotWingGeometry for the shape itself.
    const wingSpan = length * 1.05;
    const wingChord = length * 0.58;
    const wingLeft = buildParrotWingGeometry(wingSpan, wingChord, 1);
    const wingRight = buildParrotWingGeometry(wingSpan, wingChord, -1);

    const tail = buildParrotTailGeometry(length, width);
    const legs = buildParrotLegsGeometry(length, width, body);
    const tailRig = swayingTailRig({ pivot: [0, length * PARROT_TAIL_ROOT_Y_FACTOR, 0], axis: [1, 0, 0] });

    return { body, wingLeft, wingRight, tail, tailRig, legs: singleLegPart(legs) };
  } finally {
    ACTIVE_PARROT_PALETTE = previousPalette;
  }
}

/**
 * Compact, rounded lathed torso topped with a distinctly separate,
 * rounded head (its own bulge, connected via a real pinched neck rather
 * than one continuous blob) plus a large, prominently protruding curved
 * hooked beak — the single most important visual cue for reading
 * "parrot" rather than "vaguely bird-shaped blob". Earlier passes had
 * the beak too short/subtle: it read as a tiny stub half-swallowed by
 * the head's own silhouette from most angles instead of a clearly
 * visible hooked beak. The beak length and the neck pinch depth are both
 * pushed noticeably further here so the head+beak silhouette reads
 * unambiguously as a parrot face from any side-on viewing angle.
 */
// Same head-narrowing/lengthening treatment requested for the small-bird
// species (see birdGeometry.ts's HEAD_NARROW_SCALE/HEAD_LENGTHEN_SCALE
// doc comment) applied here too, for visual consistency across all three
// bird shapes — 25% narrower, 10% longer, pivoting at the neck pinch so
// only the head region (not the neck/torso below it) stretches.
const HEAD_NARROW_SCALE = 0.78;
const HEAD_LENGTHEN_SCALE = 0.98;
const HEAD_START_FRAC = 0.38; // neck pinch
const HEAD_END_FRAC = HEAD_START_FRAC + (0.9 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face point (was faceY = halfLen*0.9)

function buildParrotBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  const headTiltPivotY = halfLen * HEAD_START_FRAC;
  const headTiltBlendStartY = halfLen * PARROT_HEAD_TILT_BLEND_START_FRAC;
  // Face radius kept smaller than the head-crown bulge (a real, if
  // gentle, step down) so the head reads as a rounded mass with a
  // distinctly narrower face the beak grows out of, rather than the
  // beak's base being the same girth as the whole skull.
  const faceRadius = width * 0.168 * HEAD_NARROW_SCALE;
  const faceY = halfLen * HEAD_END_FRAC;
  // How far past the beak-attach point the skull closes over. The lathe is
  // capped by its OWN profile at both ends rather than being left open and
  // patched with separate parts. Previously the front opening was plugged with
  // a scaled sphere and the rear with a flat disk, and both read as exactly
  // what they were: a ball stuck on the face where the beak attaches, and a
  // dark disk showing above and below the tail. Real parrots have neither —
  // the head runs out of the body in one continuous taper and the beak simply
  // emerges from the front of it.
  const faceTipSpan = faceRadius * 0.34;
  const profile = [
    new THREE.Vector2(width * 0.004, -halfLen * 1.0), // rear closes on the axis
    new THREE.Vector2(width * 0.045 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.95), // tail-root taper
    new THREE.Vector2(width * 0.21 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.65),
    new THREE.Vector2(width * 0.3 * PARROT_BODY_SLIM_SCALE, -halfLen * 0.2), // belly bulge
    new THREE.Vector2(width * 0.31 * PARROT_BODY_SLIM_SCALE, halfLen * 0.12), // chest
    // Head reworked to be noticeably taller (a longer Y-span from neck
    // pinch to face) relative to its radius than the previous profile —
    // that version spanned only ~0.38*halfLen in Y against a ~0.46*width
    // peak radius, an oblate-spheroid ratio that read as a flat, wide
    // "smooshed"/Lego-brick head rather than a rounded skull. Pushing the
    // neck pinch earlier and the face further out (plus trimming the
    // peak radius down a touch) roughly doubles that span:radius ratio.
    // Every radius/position past this point is additionally scaled by
    // HEAD_NARROW_SCALE/HEAD_LENGTHEN_SCALE above.
    new THREE.Vector2(width * 0.26 * PARROT_BODY_SLIM_SCALE, halfLen * HEAD_START_FRAC), // neck pinch
    // Monotone rise to a single crown and then a monotone fall to the face.
    // Radii that wobble between these points put a bump and a dip in the
    // silhouette, which reads as a lumpy skull rather than a rounded one.
    new THREE.Vector2(width * 0.30 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.52)), // head base
    new THREE.Vector2(width * 0.315 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.63)), // crown
    new THREE.Vector2(width * 0.275 * HEAD_NARROW_SCALE * PARROT_BODY_SLIM_SCALE, halfLen * headFrac(0.76)), // forehead
    new THREE.Vector2(width * 0.232 * HEAD_NARROW_SCALE, halfLen * headFrac(0.87)), // brow, just above the eyes
    new THREE.Vector2(faceRadius, faceY), // face, where the beak attaches
    // Skull closes over past the beak attach point, tangent-ish to the taper
    // above it, so the front of the head is the lathe's own surface.
    new THREE.Vector2(faceRadius * 0.72, faceY + faceTipSpan * 0.45),
    new THREE.Vector2(faceRadius * 0.42, faceY + faceTipSpan * 0.78),
    new THREE.Vector2(width * 0.004, faceY + faceTipSpan),
  ];
  // Spline-resample the authored silhouette so the flat-shaded lathe reads
  // as a smooth surface (many gently-varying facets) instead of a few long
  // banded ones; PARROT_BODY_LATHE_SEGMENTS is already raised to 32.
  const smoothProfile = new THREE.SplineCurve(profile).getPoints(pickGeometryDetail({ desktop: 64, mobile: 26 }));
  const torso = new THREE.LatheGeometry(smoothProfile, PARROT_BODY_LATHE_SEGMENTS);
  // Sampled here, before the rake and the head pitch, because the lathe radius
  // is what drives the smear and only an unrotated lathe has hypot(x, z) equal
  // to its profile radius.
  const torsoFeatherFade = sampleLatheFeatherFade(
    torso,
    width * 0.31 * PARROT_BODY_SLIM_SCALE,
  );
  // The bare facial patch spans from just behind the eye forward to the beak.
  // Measured off the same headFrac scale the eye and face use so it tracks any
  // future change to head proportions instead of being a fixed magic Y.
  tintParrotTorsoRegions(torso, halfLen, {
    startY: halfLen * headFrac(PARROT_FACE_PATCH_START_FRAC),
    fullY: halfLen * headFrac(PARROT_FACE_PATCH_FULL_FRAC),
  });
  // Ramped from the neck pinch so the transition out of the circular body is
  // gradual, which is what keeps this from looking like a pinched-on head.
  // Ramped from the chest rather than from the neck pinch. Starting at the
  // pinch put the whole narrowing — and the one-sided crown flattening with it
  // — inside a short span, which creased the back of the neck into a hard
  // step. Spreading it over the body makes the head grow out of the torso.
  const headNarrowStartY = halfLen * PARROT_HEAD_NARROW_START_FRAC;
  const headNarrowFullY = halfLen * headFrac(0.88);
  narrowHeadCrossSection(torso, headNarrowStartY, headNarrowFullY);
  rakeFacePlaneBack(
    torso,
    halfLen * headFrac(0.58),
    halfLen * headFrac(1.02),
    PARROT_FACE_RAKE,
  );
  // Sampled here — after the narrowing and the rake, before the pitch — because
  // this is the last moment the head still sits on the untilted Y axis, and
  // both the eyes and the torso get the same pitch afterwards.
  const eyeY = halfLen * headFrac(0.833);
  const eyeZ = width * 0.052 * HEAD_NARROW_SCALE;
  const eyeAnchor = sampleSurfaceAnchor(torso, eyeY, eyeZ);
  pitchHeadRegionDown(torso, headTiltBlendStartY, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  // Two-part macaw beak: a large, strongly hooked upper mandible that
  // overhangs a shorter, triangular lower mandible with a slight gape.
  const beak = buildSolidParrotBeakGeometry(faceY, faceRadius, length * 0.4);
  narrowHeadCrossSection(beak.upper, headNarrowStartY, headNarrowFullY);
  narrowHeadCrossSection(beak.lower, headNarrowStartY, headNarrowFullY);
  beak.upper.scale(PARROT_BEAK_NARROW_X, 1, 1);
  beak.lower.scale(PARROT_BEAK_NARROW_X, 1, 1);
  const beakPitchPivotY = faceY + faceRadius * 0.22;
  rotateGeometryAroundXPivot(beak.upper, beakPitchPivotY, PARROT_BEAK_DOWN_PITCH_RAD);
  rotateGeometryAroundXPivot(beak.lower, beakPitchPivotY, PARROT_BEAK_DOWN_PITCH_RAD);
  rotateGeometryAroundXPivot(beak.upper, headTiltPivotY, PARROT_HEAD_TILT_RAD);
  rotateGeometryAroundXPivot(beak.lower, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  // No rear disk cap and no face socket filler: the profile above closes the
  // lathe on the axis at both ends, so there is no opening left to patch.

  const ringThickness = width * 0.004;
  const ringRadius = width * 0.02925 * HEAD_NARROW_SCALE;
  const eyeRing = buildParrotEyeDisks(eyeAnchor, ringRadius, ringThickness);
  // Built on the same anchor so the two stay concentric and coplanar; the pupil
  // is thicker, so it still reads proud of the ring it sits in.
  const pupils = buildParrotEyeDisks(eyeAnchor, width * 0.01603125 * HEAD_NARROW_SCALE, width * 0.007);
  rotateGeometryAroundXPivot(eyeRing, headTiltPivotY, PARROT_HEAD_TILT_RAD);
  rotateGeometryAroundXPivot(pupils, headTiltPivotY, PARROT_HEAD_TILT_RAD);

  // The beak and the eyes are keratin, not plumage. They are merged into the
  // body mesh, so without an explicit mask the body's feather shader tiles its
  // barb pattern straight across them and the beak comes out textured.
  const parts: Array<{
    geometry: THREE.BufferGeometry;
    color: THREE.Color;
    feather: number | Float32Array;
  }> = [
    { geometry: torso, color: WHITE_VERTEX_COLOR, feather: torsoFeatherFade },
    { geometry: eyeRing, color: ACTIVE_PARROT_PALETTE.eyeOuter, feather: 0 },
    { geometry: beak.upper, color: ACTIVE_PARROT_PALETTE.beakUpper, feather: 0 },
    { geometry: beak.lower, color: ACTIVE_PARROT_PALETTE.beakLower, feather: 0 },
    { geometry: pupils, color: EYE_COLOR, feather: 0 },
  ];
  const merged = mergeGeometriesWithColor(parts.map(({ geometry, color }) => ({ geometry, color })));
  const mask = new Float32Array(merged.getAttribute('position').count);
  let offset = 0;
  for (const part of parts) {
    // Counts must come from the INDEX where there is one: the merge
    // de-indexes, so an indexed part contributes index.count vertices, not
    // position.count. The lathe torso alone expands 2145 -> 12096. A per-vertex
    // fade has to be expanded through that same index to stay aligned.
    const index = part.geometry.index;
    const count = index?.count ?? part.geometry.getAttribute('position').count;
    if (typeof part.feather === 'number') {
      mask.fill(part.feather, offset, offset + count);
    } else {
      for (let i = 0; i < count; i++) {
        mask[offset + i] = part.feather[index ? index.getX(i) : i];
      }
    }
    offset += count;
  }
  merged.setAttribute(BIRD_FEATHER_MASK_ATTRIBUTE, new THREE.BufferAttribute(mask, 1));
  return merged;
}

/**
 * Shears the front of the skull backwards along Z so the beak-bearing face is a
 * slanted plane rather than an axial point. Ramped in from the brow so the
 * crown and the back of the head are untouched.
 */
/**
 * Per-vertex plumage strength for a lathe, driven by its profile radius.
 *
 * The feather pattern is a 2D tiling whose second axis is a world coordinate —
 * Z for body-plane meshes. A lathe's Z extent at any point is twice its profile
 * radius, so as the profile closes onto the axis at the face and the tail root
 * that coordinate stops varying and the cells degenerate into lengthwise
 * stripes. This is the same failure the wings hit when textured in the wrong
 * plane, except here it is confined to the collapsing ends of one mesh.
 *
 * Fading the pattern out below a radius threshold turns the smear into clean
 * skin. Parrots read correctly this way: the face around the cere is bare skin
 * in life, not plumage.
 *
 * @param maxRadius the lathe's widest profile radius, used to keep the
 *   thresholds proportional so they survive changes to body proportions.
 */
function sampleLatheFeatherFade(
  geometry: THREE.BufferGeometry,
  maxRadius: number,
): Float32Array {
  const position = geometry.getAttribute('position');
  const fade = new Float32Array(position.count);
  const bare = maxRadius * PARROT_FEATHER_FADE_BARE_RADIUS_FRAC;
  const full = maxRadius * PARROT_FEATHER_FADE_FULL_RADIUS_FRAC;
  for (let i = 0; i < position.count; i++) {
    const radius = Math.hypot(position.getX(i), position.getZ(i));
    fade[i] = THREE.MathUtils.smoothstep(radius, bare, full);
  }
  return fade;
}

/**
 * Squeezes a head region laterally, ramping the effect in over `blendStartY`
 * so the neck stays circular and the change reads as a gradual narrowing
 * rather than a step in the silhouette.
 *
 * Must run before the face rake and the head pitch: both rotate Y against Z,
 * after which a Y-driven ramp no longer follows the head's own axis. Applied
 * to the beak and eyes as well as the skull, otherwise those keep their
 * original width and stand proud of the narrowed surface.
 */
interface SurfaceAnchor {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * The point on `geometry`'s right-hand side nearest a given (y, z), with its
 * outward normal.
 *
 * Detail geometry laid onto the body — the eyes — has to follow the surface it
 * sits on. A hand-set cant angle only matches one particular skull: change the
 * head's proportions and the same disk digs into the surface on one side while
 * floating off it on the other, which is exactly what a narrower head caused.
 * Reading the surface's own normal makes the placement follow the geometry.
 *
 * Only x > 0 is considered, so the result is unambiguous: a body cross-section
 * crosses any given z twice, once per side.
 */
function sampleSurfaceAnchor(geometry: THREE.BufferGeometry, y: number, z: number): SurfaceAnchor {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) <= 0) continue;
    const dy = position.getY(i) - y;
    const dz = position.getZ(i) - z;
    const distance = dy * dy + dz * dz;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = i;
  }
  if (best < 0) {
    throw new Error('sampleSurfaceAnchor: geometry has no vertices with x > 0');
  }
  return {
    point: new THREE.Vector3(position.getX(best), position.getY(best), position.getZ(best)),
    normal: new THREE.Vector3(normal.getX(best), normal.getY(best), normal.getZ(best)).normalize(),
  };
}

function narrowHeadCrossSection(
  geometry: THREE.BufferGeometry,
  blendStartY: number,
  fullY: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.smoothstep(position.getY(i), blendStartY, fullY);
    if (t <= 0) continue;
    position.setX(i, position.getX(i) * THREE.MathUtils.lerp(1, PARROT_HEAD_NARROW_X, t));
    const z = position.getZ(i);
    const zScale =
      PARROT_HEAD_TALL_Z * (z > 0 ? PARROT_HEAD_CROWN_FLATTEN : PARROT_HEAD_CHIN_FLATTEN);
    position.setZ(i, z * THREE.MathUtils.lerp(1, zScale, t));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function rakeFacePlaneBack(
  geometry: THREE.BufferGeometry,
  rakeStartY: number,
  rakeFullY: number,
  rake: number,
): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const weight = THREE.MathUtils.smoothstep(y, rakeStartY, rakeFullY);
    if (weight <= 0) continue;
    position.setY(i, y + rake * position.getZ(i) * weight);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function pitchHeadRegionDown(
  geometry: THREE.BufferGeometry,
  blendStartY: number,
  pivotY: number,
  angleRad: number,
): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y <= blendStartY) continue;
    const z = position.getZ(i);
    const t = THREE.MathUtils.smoothstep(y, blendStartY, pivotY);
    const angle = angleRad * t;
    const dy = y - pivotY;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    position.setY(i, pivotY + dy * cosA - z * sinA);
    position.setZ(i, dy * sinA + z * cosA);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function rotateGeometryAroundXPivot(geometry: THREE.BufferGeometry, pivotY: number, angleRad: number): void {
  geometry.translate(0, -pivotY, 0);
  geometry.rotateX(angleRad);
  geometry.translate(0, pivotY, 0);
}


function buildParrotEyeDisks(
  anchor: SurfaceAnchor,
  radius: number,
  thickness: number,
): THREE.BufferGeometry {
  const buildEyeDisk = (side: 1 | -1): THREE.BufferGeometry => {
    const disk = new THREE.CylinderGeometry(radius, radius, thickness, 16);
    const normal = new THREE.Vector3(side * anchor.normal.x, anchor.normal.y, anchor.normal.z);
    disk.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal),
    );
    // The skull's local radius, which sets how far a flat disk of this size
    // stands off it. Sinking by that amount is what stops the eye reading as a
    // sticker laid on the surface; a smaller disk sinks less, so the pupil ends
    // up correctly proud of the ring it shares an anchor with.
    const skullRadius = Math.max(Math.abs(anchor.point.x), radius);
    const sagitta = (radius * radius) / (2 * skullRadius);
    const centre = new THREE.Vector3(side * anchor.point.x, anchor.point.y, anchor.point.z)
      .addScaledVector(normal, -sagitta * PARROT_EYE_SET_IN_FRAC);
    disk.translate(centre.x, centre.y, centre.z);
    return disk;
  };
  return mergePositionOnlyGeometries([buildEyeDisk(1), buildEyeDisk(-1)]);
}

function buildSolidParrotBeakGeometry(
  faceY: number,
  faceRadius: number,
  beakLen: number,
): { upper: THREE.BufferGeometry; lower: THREE.BufferGeometry } {
  const upperLen = beakLen * 0.46;
  const lowerLen = beakLen * 0.3;

  // Upper beak mostly straight; the final section is explicitly rotated
  // downward so the hook is visibly curved (not just a slight skew).
  // Base is sized to the face it grows out of rather than being noticeably
  // narrower, so the upper mandible reads as continuing the head's taper. A
  // narrow base left the closed front of the skull visible around it as a bulb.
  const upper = new THREE.ConeGeometry(faceRadius * 0.98, upperLen, 18, 10);
  upper.scale(1, 1, 0.8);
  const upperPos = upper.getAttribute('position');
  const upperYMin = -upperLen * 0.5;
  const upperYMax = upperLen * 0.5;
  const upperSpan = upperYMax - upperYMin;
  const hookStartT = 0.4;
  const hookPivotY = upperYMin + upperSpan * hookStartT;
  const maxHookAngle = THREE.MathUtils.degToRad(45);
  for (let i = 0; i < upperPos.count; i++) {
    const y = upperPos.getY(i);
    const t = THREE.MathUtils.clamp((y - upperYMin) / upperSpan, 0, 1);
    const hookT = THREE.MathUtils.smoothstep(t, hookStartT, 1);
    const tipNarrow = THREE.MathUtils.lerp(1.0, 0.76, hookT);
    const x = upperPos.getX(i) * tipNarrow;
    const z = upperPos.getZ(i);
    const angle = -maxHookAngle * hookT;
    const dy = y - hookPivotY;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const bentY = hookPivotY + dy * cosA - z * sinA;
    const bentZ = dy * sinA + z * cosA;
    upperPos.setX(i, x);
    upperPos.setY(i, bentY);
    upperPos.setZ(i, bentZ);
  }
  upperPos.needsUpdate = true;
  upper.computeVertexNormals();
  // Seated into the TOP of the raked face cut, not on the body axis: the upper
  // mandible's base is dorsal of centre, which is what lets its culmen leave the
  // forehead as a continuation of the forehead's own curve.
  upper.translate(0, faceY + upperLen * 0.3, -faceRadius * 0.08);

  // Triangular lower mandible (slightly open) so the upper hook visibly
  // overlaps it in side profile.
  const lower = new THREE.ConeGeometry(faceRadius * 0.62, lowerLen, 3);
  lower.rotateY(Math.PI / 3);
  lower.scale(1, 1, 0.74);
  const lowerPos = lower.getAttribute('position');
  const lowerYMin = -lowerLen * 0.5;
  const lowerYMax = lowerLen * 0.5;
  const lowerSpan = lowerYMax - lowerYMin;
  for (let i = 0; i < lowerPos.count; i++) {
    const y = lowerPos.getY(i);
    const t = THREE.MathUtils.clamp((y - lowerYMin) / lowerSpan, 0, 1);
    const taper = THREE.MathUtils.lerp(0.98, 0.56, t);
    const rearTrim = THREE.MathUtils.smoothstep(t, 0.08, 0.46);
    lowerPos.setX(i, lowerPos.getX(i) * taper);
    lowerPos.setZ(i, lowerPos.getZ(i) + beakLen * 0.1 * Math.pow(t, 1.3));
    lowerPos.setY(i, lowerPos.getY(i) + beakLen * 0.08 * Math.pow(t, 1.2));
    lowerPos.setX(i, lowerPos.getX(i) * (0.68 + 0.32 * rearTrim));
    lowerPos.setY(i, y + beakLen * 0.01 * Math.pow(t, 1.2));
  }
  lowerPos.needsUpdate = true;
  lower.computeVertexNormals();
  // The lower mandible fills the BOTTOM of the same cut, so it sits ventral of
  // centre and further back — the rake means the chin is behind the forehead.
  // It has to protrude past the gape or the upper hook simply swallows it, which
  // is what made it look like the lower half of the beak had been removed.
  lower.rotateX(THREE.MathUtils.degToRad(-30));
  lower.translate(0, faceY + lowerLen * 0.24, -faceRadius * 0.82);

  return { upper, lower };
}

/**
 * A graduated fan of individually shaped tail feathers — a real macaw
 * tail is a continuous fan of several feathers of different lengths
 * (the central pair much longer, tapering shorter toward the outer
 * edges), each feather a slender vane (narrow quill at the root,
 * bulging out to its widest a bit past the middle, then tapering to a
 * point at the tip), all rooted at the same point flush against the
 * body so the fan reads as one continuous structure rather than a flat
 * paddle base with a couple of bare sticks poking out of it (the
 * earlier "fan + 2 quill streamers" version, which read as artificial).
 * Feathers overlap slightly at the root (each is a solid quad fanned
 * out at its own angle from dead-center) and every feather droops
 * slightly in -Z (gravity droop, matching the rest of the body's
 * plumage) with the droop growing toward the tip. Each vane is run
 * through extrudeRingGeometry for real Z-thickness so it doesn't
 * vanish edge-on.
 */
function buildParrotTailGeometry(length: number, width: number): THREE.BufferGeometry {
  // Slimmer than the wing panel. The tail is a stack of individual quills, not
  // a membrane, so thickness here only exists to stop it vanishing edge-on.
  const thickness = width * 0.024;

  // Root sits at (or slightly ahead of, for guaranteed overlap) the
  // body lathe's own tail-root profile point (-halfLen*0.95 = -length*0.475
  // — see buildParrotBodyGeometry's profile): a shallower root left a
  // visible gap between where the body's own taper ended and where the
  // tail began, reading as "the tail is separated from the body".
  const rootY = length * PARROT_TAIL_ROOT_Y_FACTOR;

  const featherCount = 9;
  const maxSpreadDeg = 30; // total angular spread of the fan, center feather at 0deg
  const maxLen = length * 0.86; // center (longest) feather length
  const minLenFrac = 0.5; // outermost feathers' length relative to maxLen
  // Distribute tail-feather roots across a short horizontal span instead
  // of pinning every feather to a single center point, so the tail reads
  // as emerging from the full rump width rather than a needle point.
  const rootHalfSpan = width * 0.052;

  const featherGeometries: THREE.BufferGeometry[] = [];
  // Upper/lower tail coverts. The fan's roots are now full-width (see
  // rootHalfWidth) and so are considerably wider than the body's own taper where
  // they meet it, leaving the outer roots jutting out of the rump's silhouette.
  // Real birds cover exactly this joint with a block of short coverts, so this
  // is a shape that belongs on the bird rather than a filler.
  //
  // It needs no special colour handling: it is merged into the tail and picked
  // up by tintParrotTailGradient, which keys off the vertex normal, so its top
  // takes the tail colour and its underside the belly colour with nothing
  // stranded in between.
  const coverts = new THREE.SphereGeometry(width * 0.118, 16, 12);
  coverts.scale(1, 1.15, 0.46);
  coverts.translate(0, rootY + length * 0.028, -length * 0.006);
  featherGeometries.push(coverts);
  for (let i = 0; i < featherCount; i++) {
    // -1 (leftmost) .. 0 (center) .. +1 (rightmost)
    const t = (i / (featherCount - 1)) * 2 - 1;
    const angle = THREE.MathUtils.degToRad(t * maxSpreadDeg);
    const lenFrac = minLenFrac + (1 - minLenFrac) * Math.pow(Math.cos((t * Math.PI) / 2), 1.4);
    const featherLen = maxLen * lenFrac;

    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle); // fan opens backward (-Y)
    const droop = -length * 0.09 * lenFrac; // longer feathers droop a bit more

    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    // Widest at the rump and tapering monotonically to a fine point, the way a
    // real tail feather is shaped. The previous outline was a diamond that
    // pinched to nothing at the root and bulged widest at 55% of its length,
    // which gave the fan a leaf-like silhouette, made it look bloated halfway
    // down, and left the roots too narrow to cover the joint on their own.
    const rootHalfWidth = width * 0.09 * lenFrac;
    // (fraction along the feather, half-width as a fraction of the root's)
    const taper: [number, number][] = [
      [0.3, 0.7],
      [0.58, 0.45],
      [0.8, 0.25],
      [0.93, 0.1],
    ];

    const at = (frac: number, halfWidthFrac: number, sideSign: 1 | -1): THREE.Vector3 => {
      const halfWidth = rootHalfWidth * halfWidthFrac * sideSign;
      return new THREE.Vector3(
        t * rootHalfSpan + dirX * featherLen * frac + perpX * halfWidth,
        rootY + dirY * featherLen * frac + perpY * halfWidth,
        droop * frac,
      );
    };
    const tip = new THREE.Vector3(
      t * rootHalfSpan + dirX * featherLen,
      rootY + dirY * featherLen,
      droop,
    );

    const ring = [
      at(0, 1, -1),
      ...taper.map(([frac, hw]) => at(frac, hw, -1)),
      tip,
      ...[...taper].reverse().map(([frac, hw]) => at(frac, hw, 1)),
      at(0, 1, 1),
    ];
    featherGeometries.push(extrudeRingGeometry(ring, thickness));
  }

  const geometry = mergePositionOnlyGeometries(featherGeometries);
  tintParrotTailGradient(geometry, rootY, maxLen);
  return geometry;
}

/**
 * A broad, rounded "paddle" wing — parrots have short, rounded wings
 * built for quick maneuvering through canopy, quite different from a
 * falcon/hawk's long, sharply swept-back, pointed wing (the shared
 * birdGeometry.ts buildFingeredWingGeometry). That pointed dagger shape,
 * combined with a parrot's bright saturated color patterns, read as a
 * "shark fin" rather than a wing. This shape uses a wider fan of
 * boundary points for a convex, rounded leading edge and a blunt
 * (not pointed) wingtip, plus a few short, closely-spaced finger
 * feathers along the trailing edge near the tip — shorter and less
 * needle-like than the hawk's, so they read as soft flight-feather tips
 * rather than long spikes.
 */
function buildParrotWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  // The right wing is the reflection of the left, never a second build with
  // the sign flipped through every coordinate. See mirrorGeometryAcrossX.
  if (side === -1) return mirrorGeometryAcrossX(buildParrotWingGeometry(span, chord, 1));
  const s: 1 = 1;
  const positions: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const sheetHalfThickness = chord * 0.006;

  const root: number[] = [0, 0, 0];
  // Broad wing with a comparatively straighter front edge and a more
  // curved trailing edge, matching typical parrot/macaw silhouettes.
  const boundary: number[][] = [
    [0.22 * span * s, chord * 0.5, 0],
    [0.56 * span * s, chord * 0.49, 0],
    [0.82 * span * s, chord * 0.45, 0],
    [1.0 * span * s, chord * 0.28, 0],
    [0.95 * span * s, -chord * 0.04, 0],
    [0.86 * span * s, -chord * 0.28, 0],
    [0.68 * span * s, -chord * 0.47, 0],
    [0.46 * span * s, -chord * 0.58, 0],
    [0.22 * span * s, -chord * 0.46, 0],
  ];

  // The panel is a triangle fan, but `root` sits OUTSIDE the boundary loop it
  // fans to (every boundary x is at least 0.22 * span, and the root is on the
  // axis at x = 0). For the one segment that wraps from the last boundary point
  // back to the first, that puts the root on the opposite side of the edge and
  // reverses the triangle's winding — so its computed normal points the other
  // way from the rest of the panel's, and the colour pass, which reads the side
  // off the normal, painted that corner of the wing root with the wrong face's
  // colour. Ordering each triangle by its actual signed area keeps the whole
  // panel consistently wound regardless of where the fan origin falls.
  for (let i = 0; i < boundary.length; i++) {
    const next = boundary[(i + 1) % boundary.length];
    // `* s` because mirroring the wing negates x and so flips the sign of every
    // cross product with it; the comparison has to follow the wing's handedness
    // rather than assume the left one's.
    const signedArea =
      (boundary[i][0] - root[0]) * (next[1] - root[1]) -
      (boundary[i][1] - root[1]) * (next[0] - root[0]);
    const windsForward = signedArea * s < 0;
    const a = windsForward ? boundary[i] : next;
    const b = windsForward ? next : boundary[i];
    const rootTop: number[] = [root[0], root[1], sheetHalfThickness];
    const aTop: number[] = [a[0], a[1], sheetHalfThickness];
    const bTop: number[] = [b[0], b[1], sheetHalfThickness];
    const rootBottom: number[] = [root[0], root[1], -sheetHalfThickness];
    const aBottom: number[] = [a[0], a[1], -sheetHalfThickness];
    const bBottom: number[] = [b[0], b[1], -sheetHalfThickness];
    pushTri(rootTop, aTop, bTop);
    pushTri(rootBottom, bBottom, aBottom);
  }

  // A dense fan of flight feathers growing from the panel's own trailing-edge
  // boundary (between the tip and the trailing-inner point) rather than
  // floating separately. Packed tightly enough that adjacent bases OVERLAP —
  // see PARROT_FEATHER_BASE_HALF_GAP — so the trailing edge reads as a
  // continuous shingled fan rather than a row of separated spikes.
  const trailOuter = boundary[4];
  const trailInner = boundary[8];
  const lerp = (a: number[], b: number[], t: number) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const fingerCount = PARROT_FEATHER_COUNT;
  const fingerGeometries: THREE.BufferGeometry[] = [];
  const trailingCovertStrip = extrudeRingGeometry(
    [
      new THREE.Vector3(trailInner[0], trailInner[1] + chord * 0.04, 0),
      new THREE.Vector3(trailOuter[0], trailOuter[1] + chord * 0.035, 0),
      new THREE.Vector3(trailOuter[0], trailOuter[1] - chord * 0.035, 0),
      new THREE.Vector3(trailInner[0], trailInner[1] - chord * 0.03, 0),
    ],
    chord * 0.016,
  );
  const halfGap = PARROT_FEATHER_BASE_HALF_GAP;
  const outerFeatherTaperStartIndex = fingerCount - 5;
  for (let i = 0; i < fingerCount; i++) {
    const t = i / (fingerCount - 1);
    const featherT = THREE.MathUtils.smoothstep(t, 0, 1);
    const baseA = lerp(trailInner, trailOuter, Math.max(0, featherT - halfGap));
    const baseB = lerp(trailInner, trailOuter, Math.min(1, featherT + halfGap));
    const tipTaperT = THREE.MathUtils.smoothstep(i, outerFeatherTaperStartIndex, fingerCount - 1);
    const tipTaperScale = THREE.MathUtils.lerp(1, 0.66, tipTaperT);
    const fingerLen = span * (0.16 + 0.17 * featherT) * tipTaperScale;
    const midBase = lerp(baseA, baseB, 0.5);
    // Inner feathers trail almost straight back; outer feathers cant outward
    // progressively toward the wingtip.
    const outwardBias = Math.pow(featherT, 1.1);
    const outerTwoBoost = i >= fingerCount - 2 ? 0.12 : 0;
    const lateral = 0.01 + 0.34 * outwardBias + outerTwoBoost;
    const forward = new THREE.Vector2(s * lateral, -(1.1 + 0.22 * t)).normalize();
    // `* s` because the vane's two base corners are taken from the trailing
    // edge, which mirrors with the wing, while (-forward.y, forward.x) does
    // not: its X component is -forward.y, and forward.y is negative on both
    // wings, so it points the same way on each. Without this the ring runs out
    // along one side and returns to a base corner on that same side, crossing
    // itself: it notched a wedge out of every feather on one wing, flipped the
    // normals that the colour pass reads, and left the two wings genuinely
    // different geometry rather than mirror images.
    const sideward = new THREE.Vector2(-forward.y, forward.x).multiplyScalar(s);
    const rootHalfWidth = Math.max(0.0001, Math.hypot(baseB[0] - baseA[0], baseB[1] - baseA[1]) * 0.5) * 1.16;
    const shoulderDist = fingerLen * 0.56;
    const tipDist = fingerLen * 0.88;
    const capDist = fingerLen * 1.01;
    const shoulderHalfWidth = rootHalfWidth * 0.82;
    const tipHalfWidth = rootHalfWidth * 0.58;
    const capHalfWidth = rootHalfWidth * 0.4;
    const capMidHalfWidth = capHalfWidth * 0.6;
    const zDroop = -chord * (0.008 + 0.04 * t);
    // Shingling: adjacent vanes overlap in plan (halfGap exceeds their
    // spacing), so without a z separation they would intersect as one fused
    // slab. Successive feathers are stepped DOWNWARD only — never up — so the
    // whole fan stays below the panel's upper surface; see
    // PARROT_FEATHER_SHINGLE_FRAC for what the old symmetric alternation did.
    // A two-step alternation is used rather than a monotonic ramp because a
    // ramp across ~20 feathers either accumulates into a visibly warped
    // trailing edge or leaves neighbours too close to separate.
    const seatZ = -chord * PARROT_FEATHER_SEAT_FRAC;
    const shingleZ = (i % 2 === 0 ? 0 : -1) * chord * PARROT_FEATHER_SHINGLE_FRAC;
    const toPoint = (dist: number, halfWidth: number, sideSign: 1 | -1, z: number): THREE.Vector3 =>
      new THREE.Vector3(
        midBase[0] + forward.x * dist + sideward.x * halfWidth * sideSign,
        midBase[1] + forward.y * dist + sideward.y * halfWidth * sideSign,
        seatZ + z + shingleZ,
      );
    // Roots are deliberately NOT shingled: every feather starts on the same
    // seat plane so the fan emerges from one continuous trailing edge, and each
    // vane then steps down to its own layer. Shingling the roots too would open
    // a gap between the odd feathers and the covert strip.
    const ring = [
      new THREE.Vector3(baseA[0], baseA[1], seatZ),
      toPoint(shoulderDist, shoulderHalfWidth, -1, zDroop * 0.58),
      toPoint(tipDist, tipHalfWidth, -1, zDroop * 0.94),
      toPoint(capDist * 0.97, capHalfWidth, -1, zDroop),
      toPoint(capDist * 1.02, capMidHalfWidth, -1, zDroop),
      toPoint(capDist * 1.08, 0, 1, zDroop),
      toPoint(capDist * 1.02, capMidHalfWidth, 1, zDroop),
      toPoint(capDist * 0.97, capHalfWidth, 1, zDroop),
      toPoint(tipDist, tipHalfWidth, 1, zDroop * 0.94),
      toPoint(shoulderDist, shoulderHalfWidth, 1, zDroop * 0.58),
      new THREE.Vector3(baseB[0], baseB[1], seatZ),
    ];
    // Keep a tiny amount of volume so feathers stay 3D, but minimize
    // top/bottom protrusion off the wing plane.
    fingerGeometries.push(extrudeRingGeometry(ring, chord * 0.011));
  }

  const baseWing = new THREE.BufferGeometry();
  baseWing.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array(subdivideTriangleSoup(positions, PARROT_WING_PANEL_DIVISIONS)),
      3,
    ),
  );
  // The covert strip runs almost the full trailing edge, so it needs the same
  // treatment as the panel; the feathers are already short enough in span to
  // track the wave on their own tessellation.
  const dividedCoverts = subdivideGeometryTriangles(
    trailingCovertStrip,
    PARROT_WING_PANEL_DIVISIONS,
  );
  const geometry = mergePositionOnlyGeometries([baseWing, dividedCoverts, ...fingerGeometries]);
  baseWing.dispose();
  dividedCoverts.dispose();
  trailingCovertStrip.dispose();
  fingerGeometries.forEach((f) => f.dispose());
  tintParrotWingRegions(geometry, chord, side);
  geometry.computeVertexNormals();
  return geometry;
}

function buildParrotLegsGeometry(
  length: number,
  width: number,
  body: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const legs = buildTuckedBirdLegs({
    body,
    length,
    width,
    footY: -length * 0.18,
    legX: width * 0.115,
    legRadius: width * 0.03,
    toeLength: length * 0.074,
    toeRadius: width * 0.024,
    toeSpread: width * 0.032,
    footDrop: 0.022,
  });
  return mergeGeometriesWithColor([{ geometry: legs, color: ACTIVE_PARROT_PALETTE.feet }]);
}

/**
 * Region of the head covered by bare facial skin, in model Y.
 * See PARROT_FACE_PATCH_START_FRAC for how these are derived.
 */
interface ParrotFacePatchRegion {
  startY: number;
  fullY: number;
}

/**
 * Blends the bare facial patch over an already-computed body colour.
 *
 * Two masks multiply together:
 *  - a fore/aft ramp, so the patch fades in behind the eye and is fully bare by
 *    the beak rather than ending at a hard line; and
 *  - a crown cutoff keyed on the vertex normal, so the patch wraps the side of
 *    the head and the lores but leaves the coloured cap on top.
 *
 * The normal is used rather than position.z because the lathe tapers to
 * near-zero radius at the face: there, every vertex has position.z ≈ 0 whatever
 * direction it actually faces, so a positional test cannot tell the crown from
 * the chin. This is the same reason tintParrotTorsoRegions' dorsal gradient
 * reads the normal, documented below.
 */
function parrotFacePatchWeight(
  y: number,
  normalZ: number,
  region: ParrotFacePatchRegion | undefined,
): number {
  if (!region) return 0;
  const forward = THREE.MathUtils.smoothstep(y, region.startY, region.fullY);
  const belowCrown =
    1 - THREE.MathUtils.smoothstep(normalZ, PARROT_FACE_PATCH_CROWN_LIMIT, PARROT_FACE_PATCH_CROWN_LIMIT + 0.45);
  return forward * belowCrown;
}

function tintParrotTorsoRegions(
  geometry: THREE.BufferGeometry,
  halfLen: number,
  facePatch?: ParrotFacePatchRegion,
): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  // Needed by BOTH branches below: the dorsal gradient uses it for the
  // back/belly split, and the bare-face patch uses it for its crown cutoff.
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const skin = ACTIVE_PARROT_PALETTE.faceSkin;

  if (ACTIVE_PARROT_PALETTE.dorsalGradient) {
    // Smooth dorsal→ventral gradient in Z: back color at the crown (dorsal
    // surface, normal.z ≈ +1), belly color at the underside (normal.z ≈ -1).
    //
    // We use the vertex normal's Z component rather than position.z /
    // global-zSpan. The torso is a LatheGeometry that tapers to near-zero
    // radius at the nose and tail tips; at those tips position.z ≈ 0 for
    // every vertex, so a bounding-box normalisation always returns t ≈ 0.5
    // there — blending back and belly instead of showing the correct colour.
    // The vertex normal is independent of the local radius and correctly
    // gives +1 (back) / -1 (belly) even at the tips.
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.smoothstep((normals.getZ(i) + 1) / 2, 0, 1);
      const face = parrotFacePatchWeight(pos.getY(i), normals.getZ(i), facePatch);
      colors[i * 3]     = THREE.MathUtils.lerp(THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.r, ACTIVE_PARROT_PALETTE.back.r, t), skin.r, face);
      colors[i * 3 + 1] = THREE.MathUtils.lerp(THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.g, ACTIVE_PARROT_PALETTE.back.g, t), skin.g, face);
      colors[i * 3 + 2] = THREE.MathUtils.lerp(THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.belly.b, ACTIVE_PARROT_PALETTE.back.b, t), skin.b, face);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return;
  }

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const backT = THREE.MathUtils.clamp((z / (halfLen * 0.2) + 1) * 0.5, 0, 1);
    const bellyT = THREE.MathUtils.clamp((-z / (halfLen * 0.24) + 1) * 0.5, 0, 1);
    const bodyForwardT = THREE.MathUtils.clamp((y + halfLen * 0.25) / (halfLen * 1.2), 0, 1);
    const backWeight = backT * (0.6 + bodyForwardT * 0.45);
    const bellyWeight = bellyT * 0.82;
    const backDominant = backWeight >= bellyWeight;
    let r: number;
    let g: number;
    let b: number;
    if (backDominant) {
      const lightMix = Math.min(0.08, backWeight * 0.1);
      r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.backLight.r, lightMix);
      g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.backLight.g, lightMix);
      b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.backLight.b, lightMix);
    } else {
      const strength = Math.min(0.92, bellyWeight * 1.05);
      if (ACTIVE_PARROT_PALETTE === SCARLET_FOCUS_PARROT_PALETTE) {
        const backToFrontT = 1 - bodyForwardT;
        const bellyGradientR = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.belly.r, backToFrontT);
        const bellyGradientG = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.belly.g, backToFrontT);
        const bellyGradientB = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.belly.b, backToFrontT);
        r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, bellyGradientR, strength);
        g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, bellyGradientG, strength);
        b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, bellyGradientB, strength);
      } else {
        r = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.r, ACTIVE_PARROT_PALETTE.belly.r, strength);
        g = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.g, ACTIVE_PARROT_PALETTE.belly.g, strength);
        b = THREE.MathUtils.lerp(ACTIVE_PARROT_PALETTE.back.b, ACTIVE_PARROT_PALETTE.belly.b, strength);
      }
    }
    const face = parrotFacePatchWeight(y, normals.getZ(i), facePatch);
    colors[i * 3] = THREE.MathUtils.lerp(r, skin.r, face);
    colors[i * 3 + 1] = THREE.MathUtils.lerp(g, skin.g, face);
    colors[i * 3 + 2] = THREE.MathUtils.lerp(b, skin.b, face);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Bakes the tail fan's colours: a root→tip ramp along the feather, crossed with
 * a dorsal/ventral split.
 *
 * Two things here are deliberate and both exist to keep the fan from going grey.
 *
 * Interpolation is in HSL, not RGB. Every endpoint pair involved — tailRoot to
 * tailTip and belly to tailTip — is near-complementary on some palette (blue-gold
 * ramps literally blue → gold), and the straight line between complementary
 * colours in RGB passes through desaturated grey. Ramping in HSL travels around
 * the hue wheel instead, holding saturation up across the whole feather. This is
 * what the tail's washed-out middle band was.
 *
 * The dorsal/ventral side is decided by the sign of the vertex NORMAL, with no
 * blend band at all. Position is unusable: a feather is only `thickness` deep, so
 * its upper and lower faces sit at nearly identical z while the gravity droop
 * moves the tip several times that far along the same axis — a positional test
 * reads "far down the tail" as "underside" and paints the tips with the belly
 * colour. And the split is binary rather than smooth because more than half of a
 * feather's vertices belong to its extruded rim, where the normal is
 * perpendicular to both faces; any blend band strands all of them mid-ramp, which
 * drew a grey hairline outline around every feather.
 */
function tintParrotTailGradient(geometry: THREE.BufferGeometry, rootY: number, maxLen: number): void {
  const pos = geometry.getAttribute('position');
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const tipY = rootY - maxLen * 1.08;
  const span = Math.max(1e-5, rootY - tipY);
  const scratch = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((rootY - y) / span, 0, 1), 0, 1);
    const underside = normal.getZ(i) < 0;
    scratch.copy(underside ? ACTIVE_PARROT_PALETTE.belly : ACTIVE_PARROT_PALETTE.tailRoot);
    scratch.lerpHSL(ACTIVE_PARROT_PALETTE.tailTip, t);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Bakes the wing's colours: a front→rear ramp along the chord, crossed with a
 * topside/underside split.
 *
 * Like the tail (see tintParrotTailGradient) the split is taken from the sign of
 * the vertex NORMAL and the ramps are interpolated in HSL.
 *
 * Driving it from position.z is what turned the whole underside of the wing a
 * dull grey-brown. The panel is only `chord * 0.012` thick, so both of its faces
 * sit within a hair of z = 0; the positional blend put the lower face at roughly
 * the halfway point of a lerp from a blue topside to a gold underside, and the
 * midpoint of a blue→gold RGB lerp is mud. The underside was never being painted
 * gold at all — it was being painted the average of gold and blue.
 */
function tintParrotWingRegions(geometry: THREE.BufferGeometry, chord: number, side: 1 | -1): void {
  const pos = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const minY = geometry.boundingBox?.min.y ?? -chord * 0.62;
  const maxY = geometry.boundingBox?.max.y ?? chord * 0.62;
  const ySpan = Math.max(1e-5, maxY - minY);
  const colors = new Float32Array(pos.count * 3);
  const scratch = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const frontToBackT = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp((pos.getY(i) - minY) / ySpan, 0, 1),
      0,
      1,
    );
    // Two sign corrections, both about winding rather than about geometry.
    //
    // The right wing is built by negating x, which reverses every triangle's
    // winding and so flips the sign of its computed normals; without folding
    // `side` back in, one wing comes out with its two sides swapped.
    //
    // The `> 0` is not a typo. Elsewhere in this file +z is dorsal (the torso's
    // crown normal, the tail's gravity droop into -z). The wing panel and the
    // extruded feathers are both wound the other way round, so their computed
    // normals point into the body rather than out of it, and the vertex whose
    // normal reads +z is the one on the ventral face.
    if (normal.getZ(i) * side > 0) {
      scratch
        .copy(ACTIVE_PARROT_PALETTE.wingUndersideFront)
        .lerpHSL(ACTIVE_PARROT_PALETTE.wingUndersideRear, Math.pow(1 - frontToBackT, 2.4));
    } else {
      scratch
        .copy(ACTIVE_PARROT_PALETTE.wingTopRear)
        .lerpHSL(ACTIVE_PARROT_PALETTE.wingTopFront, frontToBackT);
    }
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

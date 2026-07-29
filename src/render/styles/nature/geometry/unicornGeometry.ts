import * as THREE from 'three';
import { pickGeometryDetail } from '../../../graphicsQuality';
import type { CreatureGeometries, CreatureLegPart } from '../../../geometry/sharedGeometry';
import {
  jointBarrelForBoxSection,
  mergeGeometriesWithColor,
  mergePositionOnlyGeometries,
  pushJointBarrel,
  smoothNormalsByPosition,
} from '../../../geometry/sharedGeometry';
import type { PartDrive, Triple } from '../../../motion/rig';
import { buildFeatheredWingGeometry } from './birdSharedGeometry';
import { UNICORN_HORN_MASK_ATTRIBUTE } from '../unicornHornShader';

/**
 * How the cannon bone folds relative to the thigh above it.
 *
 * The unicorn flies rather than runs, so its legs shouldn't gallop — they
 * should retract like landing gear as it picks up speed and hang loose when it
 * slows. The shared leg drive already produces exactly that shape (an
 * oscillation plus a speed-proportional draw-back), so the knee reuses it with
 * two changes:
 *
 *  - it bends *further* than the hip swings, because in a real fold the lower
 *    leg closes up more than the thigh rotates, and that closing is what reads
 *    as a joint rather than a stiff plank
 *  - it lags slightly behind the hip, since a limb segment is dragged by the
 *    one above it rather than moving in lockstep with it
 *
 * There is deliberately no rest offset: the resting bend is already baked into
 * the geometry, so leaving this at zero keeps a stationary unicorn posed
 * exactly as it was before it could bend at all.
 */
const UNICORN_KNEE_DRIVE: PartDrive = {
  source: 'legSwing',
  amplitudeScale: 1.35,
  phaseOffsetRad: -0.45,
};

/**
 * Radial cross-section segments for the unicorn body sweep.  Raising this
 * from the old value of 10 gives the body a smoothly rounded silhouette
 * rather than a visibly faceted one (issues #247).  Exported so the
 * creatureSmoothness regression test can assert the exact resulting
 * triangle count against this constant.
 */
export const UNICORN_BODY_RADIAL_SEGMENTS = pickGeometryDetail({ desktop: 16, mobile: 10 });

// Rainbow vertex-color gradients used only by the unicorn's pegasus
// wings and rainbow tail (violet at the root, red at the tip), read by a
// vertexColors-enabled material — see Renderer3D's buildRenderBatch
// rainbowWings handling. Kept local to this file since the unicorn is
// their sole user.

/**
 * Bakes a rainbow hue gradient (violet at the wing root, red at the tip)
 * into a per-vertex 'color' attribute, read by a vertexColors-enabled
 * material — see Renderer3D's buildRenderBatch rainbowWings handling.
 * The base geometry (position-only triangle soup) is otherwise
 * untouched, so this can wrap any of the flat-shaded wing builders above.
 */
function addRainbowVertexColors(geometry: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(Math.abs(position.getX(i)) / span, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Same idea as addRainbowVertexColors, but the gradient follows root-to-tip
 * progress along the tail's Y axis rather than |x| — needed for parts like
 * the tail whose "root to tip" axis isn't a simple left-right span.
 */
function addRainbowVertexColorsByDistance(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  tip: THREE.Vector3,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  const tailSpan = Math.max(1e-6, root.y - tip.y);
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp((root.y - vertex.y) / tailSpan, 0, 1);
    const easedT = t * t * (3 - 2 * t);
    const hue = THREE.MathUtils.lerp(0.78, 0, easedT); // violet (root) -> red (tip)
    // HSL at constant L has wildly different perceived brightness across hues:
    // yellow-green (~H=0.25) is ~3x brighter than blue (~H=0.67) at the same L.
    // Compensate by lowering L for the bright mid-spectrum hues so adjacent
    // rings don't pop with brightness jumps. The correction is a cosine dip
    // centred on hue 0.25 (yellow-green) where perceived luminance peaks.
    const hueRad = hue * Math.PI * 2;
    const brightnessCompensation = 0.10 * Math.max(0, Math.cos(hueRad * 1.5 - 0.5));
    color.setHSL(hue, 0.80, 0.62 - brightnessCompensation);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * "Unicorn" predator geometry: a proper horse-like silhouette — a barrel-
 * chested lathed torso with a distinctly slender neck and blunt muzzle
 * (not the plump, beaked hawk taper), four straight hoofed legs (the same
 * "read as a real creature, not a bird" cue the dragon's clawed legs give
 * it), a single horn standing straight up off the top of the head, plus
 * feathered pegasus-style wings (the hawk's fingered wing shape, given a
 * rainbow vertex-color gradient — see addRainbowVertexColors) and a
 * flowing fanned tail.
 */
/**
 * @param bodyColor The species body colour, used for the top of the legs.
 *   Leg vertex colours are absolute rather than multipliers — see
 *   UNICORN_LEG_SOCK_COLOR — so the geometry has to be told the tint outright
 *   instead of relying on the per-instance colour to supply it.
 */
export function createUnicornGeometries(
  length: number,
  width: number,
  bodyColor: THREE.Color,
): CreatureGeometries {
  const body = buildUnicornBodyGeometry(length, width);

  // Pegasus wings are the hawk's feathered flight wing (issue #301) — a curved
  // panel carrying shingled secondaries and splayed primaries — rather than the
  // flat triangle fan this used to build.
  //
  // Sizing is NOT the hawk's proportions. The feathered wing's primaries trail
  // up to 1.24 chords past the panel's trailing edge, so its real front-to-back
  // depth is roughly 1.7x chord, where the old flat fan's was about 0.86x. Fed
  // the hawk's chord fraction the wing came out about twice as deep as the one
  // it replaced and swamped the horse.
  //
  // Both numbers were then halved by eye, and brought back up by a quarter. The
  // feathered wing carries far more visual weight than the flat fan at the same
  // measurements — it has thickness, a cambered panel and a dozen separated
  // feathers where the fan was a single silhouette — so matching the fan's
  // footprint still read as oversized. These are deliberately smaller than
  // anything a real flier could use; the wings are a decorative cue on a horse,
  // not a load-bearing airfoil.
  const wingSpan = length * 0.775;
  const wingChord = length * 0.181;
  // No subdivision pass any more: the feathered wing already ships ~440 distinct
  // spanwise stations, well past what the undulation wave needs, where the old
  // fan had 7 and needed a 6x subdivide to become usable at all. Subdividing
  // this one would multiply its vertex count ~36x for nothing.
  const wingLeft = addRainbowVertexColors(
    buildFeatheredWingGeometry({ span: wingSpan, chord: wingChord, side: 1 }),
    wingSpan,
  );
  const wingRight = addRainbowVertexColors(
    buildFeatheredWingGeometry({ span: wingSpan, chord: wingChord, side: -1 }),
    wingSpan,
  );
  // Seat the wing root between the two hips, per direct feedback that the wings
  // sat too far back — they come off the barrel between the front and rear legs,
  // where a winged horse's shoulder would be, rather than back over the haunch.
  //
  // Not the exact midpoint: biased forward toward the withers, which is where a
  // shoulder actually is on a horse and where a pegasus is always drawn with its
  // wings. The bias is a fraction of the hip separation rather than of body
  // length, so it stays put relative to the two legs it is seated between if
  // either of them moves.
  //
  // Derived from the hip positions rather than as its own tuned fraction of
  // body length (it was length*0.25), so moving a leg moves the wings with it.
  // The shared wing-geometry builder attaches the root at y = 0 by default —
  // fine for a dragon, but that reads as too dragon-like here.
  const { frontY, backY } = unicornHipYs(length, width);
  const wingRootY = THREE.MathUtils.lerp(backY, frontY, 0.5 + UNICORN_WING_FORWARD_BIAS);
  // Raise the wing root to the top of the back. The barrel cross-section
  // radius at the attachment point is ~width*0.364, giving a full
  // belly-to-spine height of ~width*0.728. 25% of that is width*0.18,
  // which seats the root at the withers ridge rather than at body centre.
  const wingRootZ = width * 0.18;
  wingLeft.translate(0, wingRootY, wingRootZ);
  wingRight.translate(0, wingRootY, wingRootZ);

  const tail = buildUnicornTailGeometry(length, width);
  const legs = buildUnicornLegParts(length, width, bodyColor);

  return { body, wingLeft, wingRight, tail, legs };
}


/**
 * Horse-proportioned torso plus a small horn, small paired ears, a
 * symmetric neck mane crest, and merged eye dots. The horn is baked gold
 * via mergeGeometriesWithColor so it stands out against the lavender body —
 * see that helper's doc comment for why vertex colors (rather than a
 * second material) are needed here.
 *
 * The mane is a symmetric V-shaped crest running from the withers to the
 * poll with a short forelock past it. It sits symmetrically on the neck
 * topline — every vertex at (x, y, z) has a mirror at (−x, y, z) — so it
 * passes the neck-symmetry regression test. See buildUnicornManeGeometry.
 * The hair-strand texture is a procedural shader applied to the body
 * material; see NatureSceneRenderer3D.patchBodyMaterial and
 * unicornHairShader.ts.
 */
function buildUnicornBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: bodyGeometry, pollY, pollZ, pollRadius, headTop, flankXAt, spineZAt } =
    buildHorseBodyProfileGeometry(length, width);
  const hornGeometry = buildUnicornHornGeometry(pollY, pollZ, pollRadius);
  const earsGeometry = buildUnicornEarsGeometry(pollY, pollZ, pollRadius);
  const { whites: eyeWhitesGeometry, pupils: eyePupilsGeometry, lids: eyeLidsGeometry } =
    buildUnicornEyeGeometries(headTop.y, headTop.radius, flankXAt, spineZAt);
  const nostrilsGeometry = buildUnicornNostrilsGeometry(length * 0.5, width, flankXAt, spineZAt);
  const maneGeometry = buildUnicornManeGeometry(length, width, bodyGeometry, pollY, pollRadius);
  // The mane MUST stay last: the hair mask below identifies its vertices by
  // their position at the tail of the merged buffer.
  const bodyVertexCount = bodyGeometry.getAttribute('position').count;
  const hornVertexCount = hornGeometry.getAttribute('position').count;
  const merged = mergeGeometriesWithColor([
    { geometry: bodyGeometry, color: new THREE.Color(0xffffff) },
    { geometry: hornGeometry, color: UNICORN_HORN_COLOR },
    { geometry: earsGeometry, color: new THREE.Color(0xffffff) },
    { geometry: eyeWhitesGeometry, color: UNICORN_WHITEN_TINT },
    { geometry: eyePupilsGeometry, color: UNICORN_EYE_COLOR },
    { geometry: eyeLidsGeometry, color: UNICORN_EYELID_COLOR },
    { geometry: nostrilsGeometry, color: UNICORN_NOSTRIL_COLOR },
    { geometry: maneGeometry, color: UNICORN_MANE_COLOR },
  ]);
  bodyGeometry.dispose();
  hornGeometry.dispose();
  earsGeometry.dispose();
  eyeWhitesGeometry.dispose();
  eyePupilsGeometry.dispose();
  eyeLidsGeometry.dispose();
  nostrilsGeometry.dispose();
  // Tag which vertices belong to the mane so the hair shader can apply the
  // strand pattern to the mane ONLY. Without this the pattern covers the whole
  // creature and the body reads as corduroy rather than as a horse with a mane.
  // The mane is merged last, so its vertices are the final maneVertexCount
  // entries of the merged position attribute.
  const maneVertexCount = maneGeometry.getAttribute('position').count;
  const totalVertexCount = merged.getAttribute('position').count;
  const hairMask = new Float32Array(totalVertexCount);
  hairMask.fill(1, totalVertexCount - maneVertexCount);
  merged.setAttribute('aHairMask', new THREE.BufferAttribute(hairMask, 1));

  // And which belong to the horn, so it can be shaded as polished metal while
  // the rest of the body stays matte coat. A vertex colour alone cannot do this:
  // metalness and roughness are material properties, not colours, and a gold
  // colour on a rough dielectric surface just reads as mustard paint.
  //
  // The horn is merged SECOND, immediately after the body, so its vertices are
  // the hornVertexCount entries starting at bodyVertexCount. Both counts are
  // read from the source geometries above rather than assumed, so reordering
  // the merge list moves the mask with it instead of silently mislabelling
  // somebody else's vertices — the failure mode the mane mask's
  // "MUST stay last" comment is guarding against.
  const hornMask = new Float32Array(totalVertexCount);
  hornMask.fill(1, bodyVertexCount, bodyVertexCount + hornVertexCount);
  merged.setAttribute(UNICORN_HORN_MASK_ATTRIBUTE, new THREE.BufferAttribute(hornMask, 1));

  maneGeometry.dispose();
  return merged;
}


// Bright polished gold, to make the horn stand out clearly against the lavender
// body rather than blending in as just another body-colored bump. Brightened
// from 0xffd54a per direct feedback and paired with a metallic shading patch —
// see unicornHornShader.ts. Colour alone was never going to read as gold: what
// distinguishes metal from paint is a low-roughness, high-metalness response,
// not a hue.
const UNICORN_HORN_COLOR = new THREE.Color(0xffe066);
/**
 * Forward rake of the horn, per direct feedback that a vertical horn reads as
 * an antenna. Measured from straight up (+Z) toward the muzzle (+Y).
 */
const UNICORN_HORN_TILT_RAD = THREE.MathUtils.degToRad(20);
/**
 * How far forward of the hip midpoint the wing roots sit, as a fraction of the
 * front-to-rear hip separation. 0 is dead centre between the legs; 0.5 would put
 * them on the front hip itself.
 */
const UNICORN_WING_FORWARD_BIAS = 0.16;
// Horn base radius as a fraction of the poll radius. Narrowed by half per
// direct feedback: once the horn was moved forward onto the brow, the wider
// base broke back out through the skull surface instead of staying buried in
// it. Shared with the mane, which has to know the horn's footprint in order
// to part around it rather than swallow it.
//
// Everything at the poll is sized relative to pollRadius, so thickening the
// neck would have silently scaled the horn up by another ~21% on top of the
// bump the user had just asked for. This fraction and the length below are
// divided by the same factor the poll radius grew by, which keeps the horn's
// ABSOLUTE size exactly where it was tuned.
const UNICORN_HORN_RADIUS_FRAC = 0.2235;
// How far forward of the poll the horn's base sits, as a fraction of the poll
// radius. Pulled back slightly from 0.62 for the same reason as the narrowing:
// further forward the skull has sloped away and the base emerges. Shared with
// the mane, since if the horn moves and the parting does not, the crest closes
// over it again.
const UNICORN_HORN_FORWARD_FRAC = 0.45;
// Legs are the one part whose vertex colours are ABSOLUTE rather than
// multipliers. applyLegChainColor (see legColorApplication.ts) forces the
// per-instance colour of every leg part to white whenever the geometry carries
// a colour attribute, so that a creature's baked leg palette shows through
// unchanged. Everything else merged into the BODY mesh keeps the multiply
// behaviour, because the body's instance colour is the species tint.
//
// This was previously misread as a multiply: the legs carried 0xffffff and a
// comment claiming they would "render in exactly the per-instance body color",
// when in fact white x white renders a plain white leg.
//
// So the top of the leg has to name the body colour outright. It must track
// NATURE_UNICORN_BODY in NatureSceneRenderer3D; the renderer passes it in
// rather than this file guessing, so the two cannot drift apart.
const UNICORN_HOOF_COLOR = new THREE.Color(0x3a3a3a);
// The bottom of the leg, and genuinely white — see above, no reciprocal trick
// is needed here because nothing multiplies it.
const UNICORN_LEG_SOCK_COLOR = new THREE.Color(0xffffff);
// Number of sides on a leg segment's cross-section. A horse's leg is a round
// column; the previous 4-sided box section kept hard 90-degree corners down
// its whole length no matter how it was shaded.
const UNICORN_LEG_SIDES = 12;
// Leg cross-section, as fractions of body width. Module-level rather than
// local so the front-leg placement below can be expressed in terms of the
// leg's own front-to-back depth instead of a magic number that would drift
// out of step if the legs were ever made thicker or thinner.
// Tail tube resolution. Exported so the watertightness test can derive the
// expected shared-ring vertex count from the shipped values rather than
// hard-coding a number that would silently stop meaning anything if either
// changed.
export const UNICORN_TAIL_SIDES = 10;
export const UNICORN_TAIL_SEGMENTS = 7; // 6 internal joints between root and tip
// Leg cross-section, as fractions of body width — thinned by 25% per direct
// feedback. The knee barrel is derived from these rather than tuned on its
// own, so it follows the legs down automatically and cannot end up looking
// like a swollen joint on a slimmer limb.
const UNICORN_LEG_HALF_WIDTH_FRAC = 0.0675;
const UNICORN_LEG_HALF_DEPTH_FRAC = 0.0525;

/**
 * Where the two hip sockets sit along the body's forward axis.
 *
 * Shared by the leg rig and the wing placement so the wings can be seated
 * relative to the legs rather than at an independently-tuned offset that would
 * silently drift out of step the next time a hip moves.
 */
function unicornHipYs(length: number, width: number): { frontY: number; backY: number } {
  // Front hips pulled back by one full leg depth. At length*0.02 the shoulder
  // sat forward of the chest's own front surface, so the top of each front leg
  // stood outside the body and only the thin joint barrel bridged the gap —
  // the legs read as hanging off the chest by a thread. Backing off by the
  // leg's own front-to-back depth (2 x half-depth) seats the hip socket inside
  // the chest bulge, the same reasoning that fixed the rear legs below.
  const frontLegDepth = width * UNICORN_LEG_HALF_DEPTH_FRAC * 2;
  // Rear hip Y was -length*0.42 — *behind* the body's own rear-most spine
  // point (the tail root sits at -halfLen*0.8 = -length*0.4, see
  // buildHorseBodyProfileGeometry), so the back legs floated in empty space
  // past the rump instead of actually attaching to the haunch — read as
  // "detached" legs. Moved forward into the hindquarter bulge (spine's
  // hindquarter ring sits at -halfLen*0.62 = -length*0.31, radius width*0.32 —
  // the widest part of the rear body) so the hip socket sits inside/at the
  // body surface.
  return { frontY: length * 0.02 - frontLegDepth, backY: -length * 0.3 };
}
// Near-black "dark dot" eyes.
const UNICORN_EYE_COLOR = new THREE.Color(0x101014);
// Vertex colours MULTIPLY the per-instance body tint, so a neutral 0xffffff
// reproduces the body colour exactly and there is no constant that means
// "white" on its own. Reaching white takes the reciprocal of the species
// body colour (NATURE_UNICORN_BODY, 0xc9a8f0 = 0.788/0.659/0.941), which is
// what this is — the same above-1 trick UNICORN_TOP_TINT uses to lighten the
// topline. Used for the whites of the eyes and for the bottom of the legs.
const UNICORN_WHITEN_TINT = new THREE.Color(1.269, 1.518, 1.063);
// Dark, slightly purple — reads as an opening in the muzzle rather than a
// black sticker, once multiplied against the lavender body tint.
const UNICORN_NOSTRIL_COLOR = new THREE.Color(0.22, 0.14, 0.26);
// Eyelids: a gentle darkening of whatever colour the unicorn is, so the lid
// reads as skin in shadow rather than as a drawn-on line. Subtle on purpose —
// its job is to hide the eye plates' rims, not to be noticed itself.
const UNICORN_EYELID_COLOR = new THREE.Color(0.78, 0.74, 0.84);
// Vertex colours here MULTIPLY the per-instance species tint, so a neutral
// value below 1 darkens the mane to a deeper shade of whatever colour that
// unicorn is, rather than forcing one fixed hue. Merged into the body
// geometry, the mane would otherwise take the body tint exactly and be
// invisible against the neck it sits on.
const UNICORN_MANE_COLOR = new THREE.Color(0.62, 0.56, 0.72);
// Multiplied against the lavender per-instance body tint (not an
// absolute color) to make the muzzle read as a darker shade of purple
// rather than just another lavender patch — see buildHorseBodyProfileGeometry.
const UNICORN_MUZZLE_TINT = new THREE.Color(0.55, 0.35, 0.75);
// Neutral multiplier (no tint) for spine rings without an explicit color.
const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
// Top-of-body tint for the vertical body gradient. Multiplied against the
// per-instance lavender (0xc9a8f0), so components above 1 lighten rather than
// darken. Red and green are lifted well past 1 while blue is left almost
// alone, which walks the lavender toward a very light pink over the topline
// while the underside keeps the body color exactly as it is. Applied per
// vertex by height within each body ring, not per ring, so the transition is
// smooth around the barrel rather than banded along the spine.
const UNICORN_TOP_TINT = new THREE.Color(1.42, 1.3, 1.04);


/**
 * A single point along the body's centerline spine, used to sweep a
 * cross-section along to build the torso/neck/head (see
 * buildHorseBodyProfileGeometry). `y` is the body's forward axis
 * (matches FORWARD_AXIS), `z` is how far up/down the spine sits at that
 * point (dorsal axis — see WORLD_UP_AXIS/MODEL_UP_AXIS), and `radius` is
 * the baseline size of the cross-section there (see crossSectionOffset).
 * `zScale` optionally overrides how tall (vs. wide) the cross-section is
 * at this one point (see crossSectionOffset) — used to flatten the
 * muzzle relative to the rest of the body. `color` optionally tints just
 * this ring (e.g. a darker purple for the muzzle); rings without an
 * explicit color default to white (no tint).
 */
interface SpinePoint {
  y: number;
  z: number;
  radius: number;
  zScale?: number;
  color?: THREE.Color;
}


/**
 * A rounded-square ("squircle") cross-section, deliberately *not* a
 * circle: flatter sides than an ellipse would give, and taller (in Z)
 * than it is wide (in X) — a real horse's barrel/neck reads as a
 * flattened-oval column, not a perfect cylinder. Using a Lamé-curve
 * exponent > 2 (rather than radiusX === radiusZ and a plain circle, or
 * an ellipse at exponent 2) is what produces the flatter sides. zScale
 * (default 1) scales just the Z (height) radius, letting individual
 * rings — namely the muzzle — flatten out relative to the rest of the
 * body.
 */
function crossSectionOffset(radius: number, angle: number, zScale: number = 1): { x: number; z: number } {
  const radiusX = radius * 0.85;
  // Height:width ratio eased slightly (1.05 vs the previous 1.2) — still
  // taller than wide per direct feedback, just a little less extreme.
  const radiusZ = radius * 1.05 * zScale;
  const squareness = 4;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = radiusX * Math.sign(c) * Math.pow(Math.abs(c), 2 / squareness);
  const z = radiusZ * Math.sign(s) * Math.pow(Math.abs(s), 2 / squareness);
  return { x, z };
}


/**
 * Sweeps the crossSectionOffset ring along a spine path in the Y-Z plane
 * (see SpinePoint) to build the torso, replacing the earlier single-axis
 * THREE.LatheGeometry approach — a lathe can only ever produce a
 * circular cross-section revolved straight along one axis, which can't
 * give flattened/non-circular cross-sections (per direct feedback) or a
 * neck/head that rises and bends away from the torso's axis (also per
 * direct feedback: "a distinct neck that projects... at an upward angle,
 * and a horse-shaped head pointing somewhat downward"). Ring cross-
 * sections here stay in X-Z planes (perpendicular to the *body's* Y
 * axis, not tangent to the spine path) rather than tangent-frame swept —
 * a simplification that's visually fine for the gentle bend used here
 * and much simpler than tracking a full parallel-transport frame.
 *
 * Outward-facing triangle winding is verified per-triangle (see
 * pushOutwardTri) rather than derived analytically, so it's correct
 * regardless of the cross-section/spine parameterization above. Colors
 * are carried per-vertex (not per-triangle) from each ring's SpinePoint,
 * so a color change between two adjacent rings (e.g. entering the
 * muzzle) blends smoothly across that connecting band instead of
 * snapping abruptly.
 */
function buildHorseBodyProfileGeometry(
  length: number,
  width: number,
): {
  geometry: THREE.BufferGeometry;
  pollY: number;
  pollZ: number;
  pollRadius: number;
  headTop: { y: number; z: number; radius: number };
  muzzleTip: { y: number; z: number; radius: number };
  /** Half-width of the body surface at a point on its flank — see below. */
  flankXAt: (y: number, z: number) => number;
  /** Centreline height of the swept cross-section at a given y. */
  spineZAt: (y: number) => number;
} {
  const halfLen = length * 0.5;
  const spine: SpinePoint[] = [
    // Torso (tail root -> withers) scaled ~12% shorter toward the withers
    // anchor point — per direct feedback the body read as slightly too
    // long overall (neck/head keep their own already-tuned proportions
    // below, scaled the same way in an earlier feedback round).
    { y: -halfLen * 0.8, z: 0, radius: width * 0.04 }, // tail root (rump end)
    { y: -halfLen * 0.62, z: length * 0.01, radius: width * 0.32 }, // hindquarter
    { y: -halfLen * 0.29, z: length * 0.02, radius: width * 0.4 }, // barrel (widest point)
    { y: -halfLen * 0.01, z: length * 0.02, radius: width * 0.34 }, // chest/shoulder
    { y: halfLen * 0.08, z: length * 0.1, radius: width * 0.275 }, // withers — neck starts rising
    // Neck (withers -> poll) shortened to ~2/3 of its previous length —
    // per direct feedback the neck read as too long. Scaled toward the
    // withers point rather than re-deriving from scratch.
    //
    // Radii through the neck were then thickened ~30% per direct feedback
    // ("the neck should be thicker somehow"): against the widened barrel the
    // neck had come to read as a stalk. The taper from withers to poll is
    // preserved, so it still narrows toward the head rather than becoming a
    // uniform tube.
    { y: halfLen * 0.147, z: length * 0.193, radius: width * 0.225 }, // neck, lower-mid
    { y: halfLen * 0.207, z: length * 0.287, radius: width * 0.175 }, // neck, upper-mid
    { y: halfLen * 0.247, z: length * 0.353, radius: width * 0.145 }, // poll — peak of the neck, horn sits here
    // Head (poll -> muzzle) keeps its original shape/proportions,
    // just re-anchored to the new, closer-in poll position above.
    // Head shortened (poll -> muzzle distance scaled toward the poll)
    // and widened (radii increased) per direct feedback: "slightly
    // wider and slightly shorter".
    { y: halfLen * 0.29, z: length * 0.345, radius: width * 0.215 }, // top of head/forehead, starting to bend down+forward
    // Cheek/jaw bulge — a distinct wider point partway down the face
    // (real horses have a noticeably thicker jaw/cheek area right below
    // the forehead, before the face narrows into the muzzle) so the
    // taper isn't one continuous pinch from poll to nose-tip, which read
    // as a thin anteater snout. zScale kept near-round (per feedback the
    // head read as too flat — it now stays rounder/deeper front-to-back).
    { y: halfLen * 0.325, z: length * 0.32, radius: width * 0.205, zScale: 0.97 }, // cheek/jaw
    // Mouth/muzzle area: only gently flattened (reduced zScale) and
    // tinted a darker purple (multiplies against the lavender instance
    // color) so it reads as a distinct muzzle rather than a continuation
    // of the neck. The muzzle is carried forward across several rings —
    // rather than a short taper capped with a separate nose bulb (which
    // read as a disconnected ball and made the face drop off abruptly) —
    // so the head continues forward and rounds off into a blunt horse
    // muzzle, matching real horse-head proportions.
    { y: halfLen * 0.365, z: length * 0.29, radius: width * 0.175, zScale: 0.9, color: UNICORN_MUZZLE_TINT }, // nose bridge — head angling down
    { y: halfLen * 0.4, z: length * 0.245, radius: width * 0.15, zScale: 0.92, color: UNICORN_MUZZLE_TINT }, // upper muzzle
    { y: halfLen * 0.44, z: length * 0.205, radius: width * 0.14, zScale: 0.95, color: UNICORN_MUZZLE_TINT }, // muzzle carried forward
    // Front of the muzzle rounds off: the final rings shrink and their
    // centers rise back up (z increases again) instead of continuing
    // straight down, so the underside/"chin" tucks back up toward the
    // jaw rather than ending in a sharp vertical point. This gives the
    // blunt, slightly up-curled nose front of a real horse muzzle rather
    // than a flat wall dropping to a pointed chin.
    { y: halfLen * 0.47, z: length * 0.185, radius: width * 0.115, zScale: 1.0, color: UNICORN_MUZZLE_TINT }, // nose front — starting to round
    { y: halfLen * 0.487, z: length * 0.2, radius: width * 0.07, zScale: 1.1, color: UNICORN_MUZZLE_TINT }, // rounded nose tip, curling up so the chin recedes
  ];

  const segments = UNICORN_BODY_RADIAL_SEGMENTS;
  const rings: THREE.Vector3[][] = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      const { x, z } = crossSectionOffset(point.radius, angle, point.zScale ?? 1);
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });
  const ringColors: THREE.Color[] = spine.map((point) => point.color ?? WHITE_VERTEX_COLOR);

  /**
   * Vertical body gradient: the underside keeps the per-instance body color
   * exactly, and the topline fades to a very light pink.
   *
   * Graded per vertex by its height *within its own ring* rather than by
   * absolute Z. The spine rises and falls a lot between rump, withers and
   * muzzle, so an absolute-Z ramp would put the light end on the head and the
   * dark end on the tail — a front-to-back gradient, not a top-to-bottom one.
   * Normalising against each ring's own half-height instead means every
   * cross-section runs body-color at its belly to pink at its spine, all the
   * way along the horse.
   *
   * Each ring's own tint (the muzzle's darker purple, say) is preserved and
   * the height tint multiplies on top of it, so the muzzle still reads darker
   * while still catching light along its bridge.
   */
  const smoothstep01 = (t: number) => t * t * (3 - 2 * t);
  const gradedColorAt = (base: THREE.Color, vertex: THREE.Vector3, point: SpinePoint): THREE.Color => {
    const halfHeight = point.radius * (point.zScale ?? 1);
    if (halfHeight < 1e-6) return base;
    const t = THREE.MathUtils.clamp(0.5 + (0.5 * (vertex.z - point.z)) / halfHeight, 0, 1);
    const tint = WHITE_VERTEX_COLOR.clone().lerp(UNICORN_TOP_TINT, smoothstep01(t));
    return base.clone().multiply(tint);
  };
  const ringVertexColors: THREE.Color[][] = rings.map((ring, i) =>
    ring.map((vertex) => gradedColorAt(ringColors[i], vertex, spine[i])),
  );

  const positions: number[] = [];
  const colors: number[] = [];
  const pushOutwardTri = (
    a: THREE.Vector3,
    colorA: THREE.Color,
    b: THREE.Vector3,
    colorB: THREE.Color,
    c: THREE.Vector3,
    colorC: THREE.Color,
    center: THREE.Vector3,
  ) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const faceNormal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    const pushVertex = (p: THREE.Vector3, color: THREE.Color) => {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    };
    if (faceNormal.dot(outward) < 0) {
      pushVertex(a, colorA);
      pushVertex(c, colorC);
      pushVertex(b, colorB);
    } else {
      pushVertex(a, colorA);
      pushVertex(b, colorB);
      pushVertex(c, colorC);
    }
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const ringA = rings[i];
    const ringB = rings[i + 1];
    const colorA = ringVertexColors[i];
    const colorB = ringVertexColors[i + 1];
    const center = new THREE.Vector3(
      0,
      (spine[i].y + spine[i + 1].y) / 2,
      (spine[i].z + spine[i + 1].z) / 2,
    );
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      pushOutwardTri(ringA[j], colorA[j], ringA[k], colorA[k], ringB[j], colorB[j], center);
      pushOutwardTri(ringA[k], colorA[k], ringB[k], colorB[k], ringB[j], colorB[j], center);
    }
  }

  // Cap the muzzle-tip ring with a flat fan of triangles. Without this,
  // the sweep's final ring would be an open hole. The muzzle now carries
  // forward across several rings and rounds off (zScale eased back toward
  // 1 at the tip) so this cap sits at the blunt front of the muzzle,
  // reading as a horse's nose end rather than an abrupt cutoff. (An
  // earlier version added a separate rounded nose bulb here, which read
  // as a disconnected ball; it was removed in favor of extending the
  // muzzle itself.)
  const tipIndex = spine.length - 1;
  const tipRing = rings[tipIndex];
  const tipColor = ringVertexColors[tipIndex];
  // A point behind the tip (toward the previous ring) so pushOutwardTri
  // can correctly tell the cap's outward direction is forward (+Y).
  const tipCapBehind = new THREE.Vector3(0, spine[tipIndex - 1].y, spine[tipIndex - 1].z);
  const tipCenter = new THREE.Vector3(0, spine[tipIndex].y, spine[tipIndex].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(
      tipCenter,
      gradedColorAt(ringColors[tipIndex], tipCenter, spine[tipIndex]),
      tipRing[j],
      tipColor[j],
      tipRing[k],
      tipColor[k],
      tipCapBehind,
    );
  }

  // Cap the rump end too. The sweep above emits side walls only, and until
  // now the muzzle tip was the sole capped ring — which left spine[0] as an
  // open circular hole at the back of the horse. It went unnoticed because
  // the tail's old, much thicker base was planted directly over it; slimming
  // the tail and seating it forward inside the haunch exposed the gap.
  //
  // Wound against a reference point ahead of it (spine[1]) so pushOutwardTri
  // resolves the cap's outward direction as backward (−Y), the mirror of the
  // muzzle cap's forward-facing fan.
  const rumpRing = rings[0];
  const rumpRingColor = ringVertexColors[0];
  const rumpCapAhead = new THREE.Vector3(0, spine[1].y, spine[1].z);
  const rumpCenter = new THREE.Vector3(0, spine[0].y, spine[0].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(
      rumpCenter,
      gradedColorAt(ringColors[0], rumpCenter, spine[0]),
      rumpRing[j],
      rumpRingColor[j],
      rumpRing[k],
      rumpRingColor[k],
      rumpCapAhead,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  // Averaged rather than per-face normals. computeVertexNormals() on this
  // non-indexed sweep gave every triangle its own flat normal, so the body
  // stayed visibly faceted even after PR #267 raised the ring count from 10
  // to 16 — more segments only made the facets smaller, never smooth. The
  // crease rule keeps genuinely sharp joins (muzzle tip, tip cap) crisp.
  smoothNormalsByPosition(geometry);

  const poll = spine[7];
  const headTopPoint = spine[8];
  const muzzleTipPoint = spine[spine.length - 1];

  /**
   * Locates the pair of spine rings bracketing `y` and returns the blended
   * cross-section there. Spine y is strictly increasing from rump to muzzle,
   * so a simple forward scan is enough.
   */
  const sectionAt = (y: number) => {
    let i = 0;
    while (i < spine.length - 2 && spine[i + 1].y < y) i++;
    const a = spine[i];
    const b = spine[i + 1];
    const t = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
    return {
      centerZ: THREE.MathUtils.lerp(a.z, b.z, t),
      radius: THREE.MathUtils.lerp(a.radius, b.radius, t),
      zScale: THREE.MathUtils.lerp(a.zScale ?? 1, b.zScale ?? 1, t),
    };
  };

  const spineZAt = (y: number) => sectionAt(y).centerZ;

  /**
   * Half-width of the body surface at flank point (y, z) — the analytic
   * inverse of crossSectionOffset.
   *
   * Needed to seat features that must lie ON the skin (eyes, nostrils). A
   * flat plate placed at a single measured offset is clipped by the very
   * surface it sits on: the centre stands proud while the rim sinks inside,
   * so what shows is a lens or crescent rather than the intended shape. This
   * is the same failure the fishtank hit; see buildFlankEyeDiscsGeometry.
   *
   * crossSectionOffset maps an angle to (x, z) as
   *   x = radiusX * sign(c) * |c|^(1/2),  z = radiusZ * sign(s) * |s|^(1/2)
   * with squareness 4. Inverting the z branch gives |s| = (|dz|/radiusZ)^2,
   * and c follows from c^2 + s^2 = 1 — so the surface half-width at that
   * height is radiusX * sqrt(|c|), with no iteration required.
   */
  const flankXAt = (y: number, z: number): number => {
    const { centerZ, radius, zScale } = sectionAt(y);
    const radiusX = radius * 0.85;
    const radiusZ = radius * 1.05 * zScale;
    if (radiusZ < 1e-6) return 0;
    const sAbs = Math.min(1, Math.abs(z - centerZ) / radiusZ) ** 2;
    const cAbs = Math.sqrt(Math.max(0, 1 - sAbs * sAbs));
    return radiusX * Math.sqrt(cAbs);
  };

  return {
    geometry,
    pollY: poll.y,
    pollZ: poll.z,
    pollRadius: poll.radius,
    headTop: { y: headTopPoint.y, z: headTopPoint.z, radius: headTopPoint.radius },
    muzzleTip: { y: muzzleTipPoint.y, z: muzzleTipPoint.z, radius: muzzleTipPoint.radius },
    flankXAt,
    spineZAt,
  };
}


/**
 * A mirrored pair of thin discs that FOLLOW the body's flank instead of
 * cutting through it, used for both the eyes and the nostrils.
 *
 * Every point of the disc is placed at that point's OWN surface position
 * (via `flankXAt`) plus a constant `offset`, so the disc is a shell parallel
 * to the skin. It cannot be clipped anywhere, at any curvature, because it is
 * nowhere inside the body — which is the whole reason the previous sphere
 * eyes read badly. A sunk sphere only ever shows a cap of height
 * sqrt(R² − d²), so its apparent size is much smaller than its radius; a
 * conforming disc shows all of R. Radii here are therefore tuned smaller than
 * the sphere radii they replace, not carried across unchanged.
 *
 * Built as a closed thin plate (outer fan, inner fan, rim band) so it is
 * watertight and reads correctly regardless of material side. Elliptical
 * (separate radiusY/radiusZ) so nostrils can be taller than they are long.
 *
 * Position-only — callers merge it with the colour they want.
 */
function buildConformingDiscPair({
  y,
  z,
  radiusY,
  radiusZ,
  flankXAt,
  offset,
  thickness,
  segments = 16,
}: {
  y: number;
  z: number;
  radiusY: number;
  radiusZ: number;
  flankXAt: (y: number, z: number) => number;
  offset: number;
  thickness: number;
  segments?: number;
}): THREE.BufferGeometry {
  const build = (side: 1 | -1): THREE.BufferGeometry => {
    const positions: number[] = [];
    const outer = (px: number) => side * px;

    const centreOut = flankXAt(y, z) + offset;
    const centreIn = centreOut - thickness;

    const rim: { y: number; z: number; out: number; in: number }[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const py = y + radiusY * Math.cos(a);
      const pz = z + radiusZ * Math.sin(a);
      const f = flankXAt(py, pz) + offset;
      rim.push({ y: py, z: pz, out: f, in: f - thickness });
    }

    const tri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ) => {
      // Winding is authored for the +X side; mirroring across X reverses
      // handedness, so the −X copy swaps two corners to keep faces outward.
      if (side === 1) positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      else positions.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    };

    for (let i = 0; i < segments; i++) {
      const p = rim[i];
      const q = rim[(i + 1) % segments];
      tri(outer(centreOut), y, z, outer(p.out), p.y, p.z, outer(q.out), q.y, q.z);
      tri(outer(centreIn), y, z, outer(q.in), q.y, q.z, outer(p.in), p.y, p.z);
      tri(outer(p.out), p.y, p.z, outer(p.in), p.y, p.z, outer(q.out), q.y, q.z);
      tri(outer(q.out), q.y, q.z, outer(p.in), p.y, p.z, outer(q.in), q.y, q.z);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    // Crease-aware averaging, not computeVertexNormals(). The disc follows the
    // head's curvature, so its face is a genuinely curved shell and wants to
    // shade as one; a flat normal per triangle makes a 20-segment disc read as
    // a faceted washer. The rim meets the faces at 90 degrees, well past the
    // crease angle, so the disc still has a crisp edge.
    smoothNormalsByPosition(g);
    return g;
  };

  return mergePositionOnlyGeometries([build(1), build(-1)]);
}


/**
 * A pair of conforming eyelid sheets — a top and a bottom arc of an annulus
 * laid over the outer edge of the eye, following the head's curvature like
 * everything else here.
 *
 * These exist to kill the "sticker" read. Stacked plates each show their own
 * rim, and those two concentric ledges standing off the skin are what made the
 * eye look applied to the head rather than set into it. A lid laid across the
 * eye's outer edge hides the rim under something that is itself part of the
 * face, so what's left visible is an eye shape in a socket.
 *
 * Left and right arcs are deliberately NOT covered: leaving the corners open
 * is what reads as a pair of lids rather than as a ring or a pair of goggles.
 *
 * Single-sided sheets rather than closed plates — they sit flat on an opaque
 * head, so a back face and a rim would add nothing to look at while adding two
 * more creased edges of exactly the kind being hidden.
 */
function buildConformingLidPair({
  y,
  z,
  innerRadius,
  outerRadius,
  flankXAt,
  offset,
  segments = 12,
}: {
  y: number;
  z: number;
  innerRadius: number;
  outerRadius: number;
  flankXAt: (y: number, z: number) => number;
  offset: number;
  segments?: number;
}): THREE.BufferGeometry {
  // Measured from +Y, so these cover the top and the bottom of the eye and
  // leave a gap at each corner.
  const arcs: [number, number][] = [
    [Math.PI * 0.11, Math.PI * 0.89],
    [Math.PI * 1.11, Math.PI * 1.89],
  ];

  const build = (side: 1 | -1): THREE.BufferGeometry => {
    const positions: number[] = [];
    const at = (radius: number, angle: number) => {
      const py = y + radius * Math.cos(angle);
      const pz = z + radius * Math.sin(angle);
      return { x: side * (flankXAt(py, pz) + offset), y: py, z: pz };
    };
    type P = { x: number; y: number; z: number };
    const tri = (a: P, b: P, c: P) => {
      // Authored for the +X side; mirroring across X reverses handedness, so
      // the −X copy swaps two corners to keep faces outward.
      if (side === 1) positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      else positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    };

    for (const [from, to] of arcs) {
      for (let i = 0; i < segments; i++) {
        const a0 = from + ((to - from) * i) / segments;
        const a1 = from + ((to - from) * (i + 1)) / segments;
        const i0 = at(innerRadius, a0);
        const i1 = at(innerRadius, a1);
        const o0 = at(outerRadius, a0);
        const o1 = at(outerRadius, a1);
        tri(i0, o0, o1);
        tri(i0, o1, i1);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    smoothNormalsByPosition(g);
    return g;
  };

  return mergePositionOnlyGeometries([build(1), build(-1)]);
}


/**
 * Eyes as an iris disc with a pupil on it and a lid over the edge of both,
 * all conforming to the head's surface — replacing the pair of dark spheres
 * that used to be half-buried in the skull.
 *
 * Returned as separate geometries rather than one because they carry
 * different colours and mergeGeometriesWithColor tints per geometry.
 */
function buildUnicornEyeGeometries(
  headTopY: number,
  headTopRadius: number,
  flankXAt: (y: number, z: number) => number,
  spineZAt: (y: number) => number,
): { whites: THREE.BufferGeometry; pupils: THREE.BufferGeometry; lids: THREE.BufferGeometry } {
  // Nudged forward of the head-top ring, onto the cheek, and sitting just
  // above the cross-section's centreline — where a horse's eye actually sits.
  // Forward also means better oriented: the head is narrowing by here, so the
  // conforming shell tilts with the surface and the eye catches a forward
  // component instead of staring straight out to the side.
  const eyeY = headTopY + headTopRadius * 0.34;
  const eyeZ = spineZAt(eyeY) + headTopRadius * 0.15;
  // Iris trimmed 25% and pupil 50% from the first pass, per direct feedback.
  // The pupil is now a third of the iris rather than a half, which is what
  // taking 50% off the pupil while taking only 25% off the iris works out to.
  const whiteRadius = headTopRadius * 0.15;
  const pupilRadius = whiteRadius / 3;

  // The whole stack is kept as flat against the skull as it can be while
  // still resolving depth. The pupil used to sit a full plate-thickness proud
  // of the iris, which put its face 0.06 of the head radius off the skin —
  // about 40% of the iris's own radius — and that ledge is what made the eye
  // bulge. It now clears the iris by a quarter of a thickness: enough to stay
  // in front, far too little to cast a visible step.
  const thickness = headTopRadius * 0.03;
  const whiteOffset = headTopRadius * 0.012;
  const pupilOffset = whiteOffset + thickness * 0.25;

  const whites = buildConformingDiscPair({
    y: eyeY,
    z: eyeZ,
    radiusY: whiteRadius,
    radiusZ: whiteRadius,
    flankXAt,
    offset: whiteOffset,
    thickness,
  });
  const pupils = buildConformingDiscPair({
    y: eyeY,
    z: eyeZ,
    radiusY: pupilRadius,
    radiusZ: pupilRadius,
    flankXAt,
    offset: pupilOffset,
    thickness,
  });
  const lids = buildConformingLidPair({
    y: eyeY,
    z: eyeZ,
    // Overlaps the iris rim from just inside it to just outside it, so the
    // plate edge is buried under the lid rather than standing on the cheek.
    innerRadius: whiteRadius * 0.84,
    outerRadius: whiteRadius * 1.22,
    flankXAt,
    offset: pupilOffset + thickness * 0.15,
  });
  return { whites, pupils, lids };
}


/**
 * A pair of dark nostrils on the muzzle, conforming to its surface the same
 * way the eyes do. Taller than they are long, matching the vertical slit of a
 * real horse's nostril, and placed on the lower flank of the muzzle just
 * behind the nose front.
 */
function buildUnicornNostrilsGeometry(
  halfLen: number,
  width: number,
  flankXAt: (y: number, z: number) => number,
  spineZAt: (y: number) => number,
): THREE.BufferGeometry {
  // Well forward, near the nose front rather than back on the side of the
  // muzzle, per direct feedback that they sat too far out to the sides.
  //
  // Position does double duty here. The disc is a shell offset along ±X, so
  // its facing is set by how the surface runs beneath it: back along the
  // straight part of the muzzle the flank is near-parallel to the body axis
  // and the nostril can only face sideways, whereas up here the muzzle is
  // narrowing sharply toward its tip, so the shell tilts with it and the
  // nostril reads as facing forward-and-out.
  const nostrilY = halfLen * 0.474;
  const nostrilZ = spineZAt(nostrilY) + width * 0.03;
  return buildConformingDiscPair({
    y: nostrilY,
    z: nostrilZ,
    radiusY: width * 0.017,
    radiusZ: width * 0.038,
    flankXAt,
    offset: width * 0.002,
    thickness: width * 0.005,
  });
}


/**
 * Four bent legs with distinct, explicitly-angled joints (measured from
 * straight down) modeled directly on real horse-leg anatomy, plus a
 * dark-gray hoof tint — per direct, detailed feedback describing the
 * exact joint bends to use. Built as true box-section segments (see
 * pushBoxSegment) rather than a flat, zero-depth ribbon (which had no
 * thickness front-to-back, so it visually vanished from some viewing
 * angles — "2D instead of 3D"/"appear and disappear"). Built along local
 * -Z ("belly-down") so they hang beneath the body rather than
 * overlapping the wings, which lie in the Z=0 plane.
 *
 * Front leg: upper segment juts forward from the hip, the lower segment
 * (below the knee) sweeps back just past vertical, and the hoof bends
 * back further still.
 * Rear leg: upper segment (thigh) angles backward from the hip at ~45
 * degrees, the lower segment (below the hock) swings forward again to
 * about 30 degrees off vertical (not all the way back to vertical), and
 * the hoof bends backward, same as the front.
 *
 * That resting bend used to be purely cosmetic: all four legs shared one mesh,
 * so they could only rotate as a single rigid unit and the knee angle never
 * changed — a bend painted onto a plank. The legs are emitted as a four-part
 * rig instead (front/rear x thigh/lower), so the joints actually articulate.
 *
 * Four parts rather than eight because left and right legs of a pair differ
 * only in X, and the swing axis *is* X — so a single pivot line serves both.
 */
function buildUnicornLegParts(length: number, width: number, bodyColor: THREE.Color): CreatureLegPart[] {
  // One buffer per rig part rather than one merged buffer for all four legs.
  // A part can only rotate as a unit, so a segment that needs to bend
  // independently needs its own vertices.
  type Buffer = { positions: number[]; colors: number[] };
  const newBuffer = (): Buffer => ({ positions: [], colors: [] });
  const frontUpper = newBuffer();
  const frontLower = newBuffer();
  const rearUpper = newBuffer();
  const rearLower = newBuffer();
  let sink: Buffer = frontUpper;
  const pushVertex = (p: THREE.Vector3, color: THREE.Color) => {
    sink.positions.push(p.x, p.y, p.z);
    sink.colors.push(color.r, color.g, color.b);
  };
  // Colour is resolved per vertex rather than per segment so a segment can
  // carry a gradient along its length (see legColorAt). `flatColor` keeps the
  // uniform case — the hoof — a one-word change at the call site.
  type ColorAt = (p: THREE.Vector3) => THREE.Color;
  const flatColor = (color: THREE.Color): ColorAt => () => color;
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colorAt: ColorAt) => {
    pushVertex(a, colorAt(a));
    pushVertex(b, colorAt(b));
    pushVertex(c, colorAt(c));
  };
  const smoothstep01 = (t: number) => t * t * (3 - 2 * t);

  // Outward-normal-safe box segment between two points, with a
  // rectangular (legWidth x legDepth) cross-section — a real 3D volume
  // with thickness along both the left-right (X) and front-back (Y)
  // axes, unlike a flat single-axis-offset ribbon.
  // Round-section limb segment between two points.
  //
  // This replaced a 4-sided box section, which kept hard 90-degree corners
  // running the full length of every leg — no amount of normal smoothing can
  // round a shape that genuinely has four flat sides, and it read as a table
  // leg rather than a horse's. The cross-section stays elliptical rather than
  // circular (halfX across, halfY fore-aft) because a real cannon bone is
  // deeper than it is wide.
  //
  // The ring basis is exact rather than arbitrary: every leg segment lies in
  // the Y-Z plane, so model X is always perpendicular to the segment axis and
  // can seed the frame directly with no chance of degenerating.
  function pushTubeSegment(
    a: THREE.Vector3,
    b: THREE.Vector3,
    halfX: number,
    halfY: number,
    capStart: boolean,
    capEnd: boolean,
    colorAt: ColorAt,
  ) {
    const axis = new THREE.Vector3().subVectors(b, a);
    if (axis.lengthSq() < 1e-12) return;
    axis.normalize();
    const across = new THREE.Vector3(1, 0, 0);
    const along = new THREE.Vector3().crossVectors(axis, across).normalize();

    const ringAt = (p: THREE.Vector3) => {
      const ring: THREE.Vector3[] = [];
      for (let s = 0; s < UNICORN_LEG_SIDES; s++) {
        const theta = (s / UNICORN_LEG_SIDES) * Math.PI * 2;
        ring.push(
          p
            .clone()
            .add(across.clone().multiplyScalar(Math.cos(theta) * halfX))
            .add(along.clone().multiplyScalar(Math.sin(theta) * halfY)),
        );
      }
      return ring;
    };

    const ra = ringAt(a);
    const rb = ringAt(b);
    const axisCenter = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, center: THREE.Vector3) => {
      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const normal = new THREE.Vector3().crossVectors(e1, e2);
      const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
      const outward = new THREE.Vector3().subVectors(centroid, center);
      if (normal.dot(outward) < 0) {
        pushTri(p0, p2, p1, colorAt);
      } else {
        pushTri(p0, p1, p2, colorAt);
      }
    };

    for (let i = 0; i < UNICORN_LEG_SIDES; i++) {
      const j = (i + 1) % UNICORN_LEG_SIDES;
      pushOutward(ra[i], rb[i], rb[j], axisCenter);
      pushOutward(ra[i], rb[j], ra[j], axisCenter);
    }
    if (capStart) {
      for (let i = 1; i < UNICORN_LEG_SIDES - 1; i++) {
        pushOutward(ra[0], ra[i], ra[i + 1], axisCenter);
      }
    }
    if (capEnd) {
      for (let i = 1; i < UNICORN_LEG_SIDES - 1; i++) {
        pushOutward(rb[0], rb[i], rb[i + 1], axisCenter);
      }
    }
  }

  // Angle is measured from straight down (-Z); positive = forward (+Y),
  // negative = backward (-Y) — matches how each joint bend was described.
  function jointOffset(angleDeg: number, segLength: number): { dy: number; dz: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return { dy: Math.sin(rad) * segLength, dz: -Math.cos(rad) * segLength };
  }

  function buildLeg(
    hipX: number,
    hipY: number,
    hipZ: number,
    upperAngleDeg: number,
    lowerAngleDeg: number,
    hoofAngleDeg: number,
    upperBuffer: Buffer,
    lowerBuffer: Buffer,
  ): THREE.Vector3 {
    const legLength = length * 0.38;
    const legHalfWidth = width * UNICORN_LEG_HALF_WIDTH_FRAC;
    const legHalfDepth = width * UNICORN_LEG_HALF_DEPTH_FRAC;
    const flareX = hipX * 1.05;

    const hip = new THREE.Vector3(hipX, hipY, hipZ);
    const upper = jointOffset(upperAngleDeg, legLength * 0.42);
    const knee = new THREE.Vector3(flareX, hipY + upper.dy, hipZ + upper.dz);
    const lower = jointOffset(lowerAngleDeg, legLength * 0.42);
    const hoofTop = new THREE.Vector3(flareX, knee.y + lower.dy, knee.z + lower.dz);
    const hoof = jointOffset(hoofAngleDeg, legLength * 0.09);
    const hoofTip = new THREE.Vector3(flareX, hoofTop.y + hoof.dy, hoofTop.z + hoof.dz);

    // Leg gradient: the top of the leg is the body colour, so it reads as
    // continuous with the barrel it hangs from, ramping to white by the hoof —
    // the "socks" of a classic storybook unicorn. Graded by height (Z) rather
    // than by segment so it runs smoothly across the knee instead of stepping
    // at each joint.
    //
    // These are absolute colours, not multipliers; see UNICORN_LEG_SOCK_COLOR.
    //
    // The ramp is measured hip-to-hoof-top, not hip-to-hoof-tip, so the last
    // stretch of cannon bone is fully white before the dark hoof begins.
    const gradientSpan = hipZ - hoofTop.z;
    const legColorAt = (p: THREE.Vector3): THREE.Color => {
      const t = gradientSpan > 1e-6 ? THREE.MathUtils.clamp((hipZ - p.z) / gradientSpan, 0, 1) : 0;
      return bodyColor.clone().lerp(UNICORN_LEG_SOCK_COLOR, smoothstep01(t));
    };

    // Thigh: rotates about the hip.
    sink = upperBuffer;
    pushTubeSegment(hip, knee, legHalfWidth, legHalfDepth, true, false, legColorAt);

    // Knee barrel, covering the wedge that opens between the thigh's flat
    // end face and the cannon bone's flat top face once the knee bends.
    //
    // A cylinder about the hinge axis, not a sphere. Both are invariant
    // under the knee's rotation, but a sphere large enough to swallow the
    // moving face's corners carries that radius through the middle of the
    // joint too, where nothing needs covering — which reads as a knee pad
    // rather than a knee. Sized off the cannon bone's half-depth, the
    // barrel comes out slimmer fore-aft than the thigh itself, so it
    // vanishes into the leg's existing silhouette.
    //
    // It goes in the *upper* buffer deliberately. Its axis is the knee's
    // rotation axis, so the knee's own bend cannot move it — but it must
    // still follow the thigh when the hip swings, which is what living in
    // the thigh's part gives us.
    // Radius and length have both been pulled in repeatedly per direct
    // feedback — the goal is a knee you notice only when it bends, not a
    // visible hinge. Both dimensions stay tied to the leg's own cross-section,
    // so the barrel tracked the 25% leg thinning without needing re-tuning.
    const kneeBarrel = jointBarrelForBoxSection({
      movingHalfDepth: legHalfDepth * 0.882,
      widestHalfWidth: legHalfWidth * 0.846,
    });
    pushJointBarrel(sink, {
      center: knee,
      axis: new THREE.Vector3(1, 0, 0),
      radius: kneeBarrel.radius,
      halfLength: kneeBarrel.halfLength,
      color: legColorAt(knee),
      // 20 rather than the default 10, so the barrel's facets are 18 degrees
      // apart instead of 36 and it reads as a turned cylinder.
      segments: 20,
    });

    // Cannon bone and hoof: rotate about the knee, on top of whatever the
    // thigh above them is doing. Capping the top of the lower segment keeps
    // the joint from showing a hollow end once it bends away from the thigh.
    sink = lowerBuffer;
    pushTubeSegment(knee, hoofTop, legHalfWidth * 0.85, legHalfDepth * 0.85, true, true, legColorAt);
    // Small hoof, tinted dark gray to read as a hoof distinct from the rest of
    // the leg, instead of the dragon's fanned claws. Slightly wider than the
    // cannon bone above it, the way a real hoof flares out below the pastern.
    //
    // The two tubes BUTT at the pastern rather than overlapping. Both are
    // capped, and because each cap is a disc centred on the shared point, the
    // discs intersect and the union is solid — the earlier open end on the
    // cannon bone is what made the hoof look detached. Sleeving the hoof up
    // over the cannon was tried and is worse: the cannon axis diverges from
    // the hoof axis through the bend, so it pokes out through the hoof wall
    // almost immediately, and it made the hoof read far too tall.
    pushTubeSegment(hoofTop, hoofTip, legHalfWidth * 0.92, legHalfDepth * 0.92, true, true, flatColor(UNICORN_HOOF_COLOR));

    return knee;
  }

  // Front and rear hip sockets, shared with the wing placement.
  const { frontY, backY } = unicornHipYs(length, width);
  const stanceX = width * 0.19; // pulled in from 0.26 so legs stick out less laterally
  // Legs now emerge a bit lower on the belly (more negative Z, "down")
  // rather than right at the body's central spine axis (z=0) — per
  // direct feedback the legs looked like they came out too high up the
  // barrel rather than from the underside of the body.
  const hipZ = -width * 0.16;

  // Front legs: jut forward (+35 deg), lower leg sweeps back just past
  // vertical (-15 deg), hoof bends back further (-35 deg).
  const frontKnee = buildLeg(-stanceX, frontY, hipZ, 35, -15, -35, frontUpper, frontLower);
  buildLeg(stanceX, frontY, hipZ, 35, -15, -35, frontUpper, frontLower);
  // Rear legs: thigh angles back further (-58 deg, was -45 — "top of the
  // leg should point farther backward"), and the hock/knee bend is wider
  // now so the lower leg swings only slightly forward of vertical
  // (-10 deg, was +30 — "bottom half of the legs point slightly
  // backward" instead of forward), hoof bends back (-35 deg) same as
  // the front.
  const rearKnee = buildLeg(-stanceX, backY, hipZ, -58, -10, -35, rearUpper, rearLower);
  buildLeg(stanceX, backY, hipZ, -58, -10, -35, rearUpper, rearLower);

  const toGeometry = (buffer: Buffer): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer.positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(buffer.colors), 3));
    // Crease-aware averaging rather than computeVertexNormals(). On this
    // non-indexed buffer computeVertexNormals gives every triangle its own
    // flat normal, which left the knee barrel shading as a ring of flat
    // strips — it read as a blocky rectangular hub rather than a cylinder,
    // however many segments it had. The 60-degree crease threshold smooths
    // the barrel's 18-degree facets while leaving the leg boxes' 90-degree
    // edges crisp, so the limbs keep their squared-off silhouette.
    smoothNormalsByPosition(geometry);
    return geometry;
  };

  // Left and right legs of a pair share a part. The swing axis is model-X and
  // the two differ only in X, so one pivot *line* serves both — which is why
  // four parts buy a fully jointed leg rather than eight.
  const swingAxis: Triple = [1, 0, 0];

  return [
    {
      role: 'legUpperFront',
      group: 'legs',
      geometry: toGeometry(frontUpper),
      pivot: [0, frontY, hipZ],
      axis: swingAxis,
      drive: { source: 'legSwing' },
    },
    {
      role: 'legLowerFront',
      group: 'legs',
      geometry: toGeometry(frontLower),
      pivot: [0, frontKnee.y, frontKnee.z],
      axis: swingAxis,
      parent: 0,
      drive: UNICORN_KNEE_DRIVE,
    },
    {
      role: 'legUpperRear',
      group: 'legs',
      geometry: toGeometry(rearUpper),
      pivot: [0, backY, hipZ],
      axis: swingAxis,
      drive: { source: 'legSwing' },
    },
    {
      role: 'legLowerRear',
      group: 'legs',
      geometry: toGeometry(rearLower),
      pivot: [0, rearKnee.y, rearKnee.z],
      axis: swingAxis,
      parent: 2,
      drive: UNICORN_KNEE_DRIVE,
    },
  ];
}


/**
 * A long, flowing tail hanging from the rump, built the same way as the
 * legs (true 3D box-section segments — see pushBoxSegment in
 * buildUnicornLegsGeometry — not a flat, zero-depth ribbon) so it has
 * real depth from every viewing angle. The tail starts by curving up and
 * back at a 45 degree angle right at the rump (a natural little flick,
 * like a horse tail lifted at the dock), then sweeps progressively
 * downward along its length as if gravity were pulling the loose hair
 * down, ending pointing mostly straight down (and very slightly forward,
 * curling under) by the tip. Built from several segments (7, giving 6
 * internal joints) so the curve reads as a smooth arc rather than a
 * single rigid straight or bent piece, and so the rainbow gradient has
 * more interpolation stations instead of reading as discrete bands. Tinted with the same violet-root
 * -> red-tip rainbow gradient as the wings (see
 * addRainbowVertexColorsByDistance) for a more dramatic look than a flat
 * tint, and tapers from a thicker root to a thin tip.
 */
function buildUnicornTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  };

  // A round tube segment, replacing the 4-sided box section this tail used to
  // share with the legs.
  //
  // Two separate things made the old version read as blocky, and raising the
  // body's segment count in PR #267 fixed neither:
  //
  //  1. FOUR SIDES. A square cross-section has 90-degree corners, so it stays
  //     visibly angular from every angle no matter how the normals are built.
  //  2. THE RING WAS NOT PERPENDICULAR TO THE TAIL. Corners were offset along
  //     world X and Y while the tail itself sweeps through -Y and Z, so the
  //     "thickness" along Y ran roughly *lengthwise* down the tail rather than
  //     radially around it. The section was closer to a padded ribbon than a
  //     tube.
  //
  // Rings are now built in the plane perpendicular to each segment's own
  // direction, using a parallel-transported frame so consecutive rings stay
  // rotationally aligned and the tube doesn't twist as the tail droops. The
  // cross-section keeps the previous slight flattening (the minor radius is
  // 0.8 of the major) so the silhouette still reads as horse hair rather than
  // a hosepipe.
  const TAIL_SIDES = UNICORN_TAIL_SIDES;
  let transportedNormal = new THREE.Vector3(1, 0, 0);
  const ringAt = (center: THREE.Vector3, direction: THREE.Vector3, halfMajor: number, halfMinor: number) => {
    const tangent = direction.clone();
    if (tangent.lengthSq() < 1e-10) tangent.set(0, -1, 0);
    tangent.normalize();
    // Re-orthogonalise the carried normal against the new tangent rather than
    // picking a fresh basis per ring, which would let the frame flip.
    transportedNormal.sub(tangent.clone().multiplyScalar(transportedNormal.dot(tangent)));
    if (transportedNormal.lengthSq() < 1e-8) {
      transportedNormal.set(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x));
      if (transportedNormal.lengthSq() < 1e-8) transportedNormal.set(0, 0, 1);
    }
    transportedNormal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, transportedNormal).normalize();
    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < TAIL_SIDES; s++) {
      const theta = (s / TAIL_SIDES) * Math.PI * 2;
      ring.push(
        center
          .clone()
          .add(transportedNormal.clone().multiplyScalar(Math.cos(theta) * halfMajor))
          .add(binormal.clone().multiplyScalar(Math.sin(theta) * halfMinor)),
      );
    }
    return ring;
  };

  /**
   * Emits the tube walls from a list of rings that are SHARED between adjacent
   * segments, plus the two end caps.
   *
   * The previous version built each segment independently, calling ringAt
   * twice per segment — once for its own start and once for its own end. Every
   * interior joint therefore got two different rings at the same center: one
   * oriented to the incoming segment's direction, one to the outgoing
   * segment's. Because the tail bends at every joint those two rings did not
   * coincide, so the surface tore open and the tail read as a row of separate
   * sausages with visible breaks between them. ringAt also mutates the
   * transported frame, so calling it twice per point advanced the frame twice
   * as fast as intended.
   *
   * Now there is exactly one ring per point, built on the bisector of the
   * incoming and outgoing directions (a mitre joint) so it meets both segments
   * squarely. Adjacent segments reference the same vertices, which makes the
   * surface genuinely continuous — no gap can reappear, because there is no
   * longer a second ring to disagree with.
   */
  function pushTubeFromRings(rings: THREE.Vector3[][], color: THREE.Color) {
    for (let i = 0; i < rings.length - 1; i++) {
      const ringA = rings[i];
      const ringB = rings[i + 1];
      for (let s = 0; s < TAIL_SIDES; s++) {
        const t = (s + 1) % TAIL_SIDES;
        pushTri(ringA[s], ringB[s], ringB[t], color);
        pushTri(ringA[s], ringB[t], ringA[t], color);
      }
    }
    const first = rings[0];
    for (let s = 1; s < TAIL_SIDES - 1; s++) pushTri(first[0], first[s + 1], first[s], color);
    const last = rings[rings.length - 1];
    for (let s = 1; s < TAIL_SIDES - 1; s++) pushTri(last[0], last[s], last[s + 1], color);
  }

  // Longer than the previous stubby tail — a real flowing horse tail
  // rather than a short bunch.
  // Slightly longer than the old 0.68 so the *visible* tail stays the length
  // it was: the root now starts buried inside the haunch (see below), and
  // without this the tail would read shorter than the version already tuned.
  const tailLength = length * 0.74;
  const numSegments = UNICORN_TAIL_SEGMENTS;
  // Trails mostly backward with a gentle downward sag, rather than
  // curling almost straight down (-95deg tip, from an earlier pass tuned
  // for a different flight-pose model) — now that unicorns fly upright
  // and nearly flat (see updateInstances' uprightStyle === 'unicorn'),
  // a tail hanging down like a rope under gravity reads wrong; a mostly-
  // horizontal streaming tail (like a horse's tail flowing behind it in
  // motion, e.g. the reference pegasus image) reads much better.
  const startAngleDeg = 20; // slight up-and-back flick right at the rump
  const endAngleDeg = -30; // trailing back with a gentle downward droop at the tip
  const smoothstep = (t: number) => t * t * (3 - 2 * t);

  // Root anchor pushed FORWARD into the hindquarter bulge rather than sitting
  // at the body's rear-most spine point.
  //
  // The rump ring at -halfLen*0.8 has a radius of only width*0.04, so butting
  // the tail against it left a tail base several times wider than the body it
  // met — the join showed as a visible seam/collar all the way round. Starting
  // at -halfLen*0.68 instead puts the root inside a body radius of ~width*0.23,
  // comfortably wider than the (now much slimmer) base below, so the first
  // segment is buried in the haunch and the tail simply emerges from it.
  //
  // Nothing else needs updating to match: the undulation shader derives its
  // root from the geometry's own bounding box (see applyUnicornTailUndulation-
  // Shader), so the weld point follows this automatically.
  const root = new THREE.Vector3(0, -halfLen * 0.68, width * 0.05);
  const points: THREE.Vector3[] = [root];
  let prev = root;
  const segLength = tailLength / numSegments;
  for (let i = 0; i < numSegments; i++) {
    const tMid = (i + 0.5) / numSegments;
    const angleDeg = THREE.MathUtils.lerp(startAngleDeg, endAngleDeg, smoothstep(tMid));
    const rad = (angleDeg * Math.PI) / 180;
    // angleDeg measured from the backward horizontal (-Y): positive
    // tilts upward (+Z), negative tilts downward, and as it swings past
    // -90 the backward component flips slightly forward (curling under).
    const dy = -Math.cos(rad) * segLength;
    const dz = Math.sin(rad) * segLength;
    const next = new THREE.Vector3(0, prev.y + dy, prev.z + dz);
    points.push(next);
    prev = next;
  }

  // Profile: small disc at the base → flare in the first third → taper to a
  // near-point at the tip. Uses the smoothstep already in scope so each
  // transition eases in/out rather than kinking at the control points.
  const baseHalfWidth = width * 0.033;   // tight little disc where it exits the haunch
  const peakHalfWidth = width * 0.145;   // widest bulk of the plume, ~35% along
  const tipHalfWidth  = width * 0.004;   // taper to near-point at the end
  const peakT = 0.35;
  const halfWidthAt = (i: number) => {
    const t = i / (points.length - 1);
    if (t <= peakT) {
      return THREE.MathUtils.lerp(baseHalfWidth, peakHalfWidth, smoothstep(t / peakT));
    } else {
      return THREE.MathUtils.lerp(peakHalfWidth, tipHalfWidth, smoothstep((t - peakT) / (1 - peakT)));
    }
  };

  // One ring per point. At an interior joint the ring uses the average of the
  // incoming and outgoing directions so it mitres between the two segments
  // instead of matching only one of them; the ends just use their single
  // adjacent direction.
  const tailRings = points.map((point, i) => {
    const incoming = i > 0 ? new THREE.Vector3().subVectors(point, points[i - 1]) : null;
    const outgoing =
      i < points.length - 1 ? new THREE.Vector3().subVectors(points[i + 1], point) : null;
    const direction = new THREE.Vector3();
    if (incoming) direction.add(incoming.normalize());
    if (outgoing) direction.add(outgoing.normalize());
    const halfMajor = halfWidthAt(i);
    return ringAt(point, direction, halfMajor, halfMajor * 0.8);
  });
  pushTubeFromRings(tailRings, WHITE_VERTEX_COLOR);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  // Averaged rather than per-face normals, so the 10-sided tube shades as a
  // round surface instead of ten flat strips. The end caps meet the tube wall
  // at 90 degrees, well past the crease angle, so they stay crisp.
  smoothNormalsByPosition(geometry);

  const tip = points[points.length - 1];
  addRainbowVertexColorsByDistance(geometry, root, tip);
  return geometry;
}


/**
 * A single horn rising from the poll (top of the neck, where the profile's Z
 * is at its peak — see buildHorseBodyProfileGeometry's spine array), rather
 * than jutting forward off the nose — a horn "sticking up" is the single most
 * important unicorn-vs-bird visual read.
 *
 * It is not vertical: it rakes forward over the brow, which is how a unicorn
 * horn is drawn everywhere it appears. A dead-vertical spike reads as an
 * antenna.
 */
function buildUnicornHornGeometry(
  pollY: number,
  pollZ: number,
  pollRadius: number,
): THREE.BufferGeometry {
  // Bumped 20% per direct feedback, divided by 1.208 when the neck was
  // thickened so that edit did not silently rescale it, then a further 25%
  // taller once the narrowed base was approved: a horn framed by hair on both
  // sides reads shorter than it measures, and a narrower one more so still.
  // Then a further 20%, again by direct request.
  const hornLength = pollRadius * 2.9052; // 1.95 * 1.2 / 1.208 * 1.25 * 1.2
  const hornRadius = pollRadius * UNICORN_HORN_RADIUS_FRAC;
  const cone = new THREE.ConeGeometry(hornRadius, hornLength, 8);
  // ConeGeometry is built along +Y by default, apex at +Y/2, base at
  // -Y/2. Rotating +90 degrees about X maps +Y onto +Z, sending the
  // apex to +Z (up) — rotating the *other* way (-90 degrees, the
  // previous code here) instead sends +Y to -Z, which put the apex
  // pointing down and the (wider) base up: an upside-down cone.
  cone.rotateX(Math.PI / 2);
  // Tilt happens about the BASE, not about the cone's centre. Rotating the
  // centred cone would swing the base backwards out of the skull by half the
  // horn's length, so the base is brought to the origin first and the finished
  // horn is then translated onto the head. With the horn now nearly three poll
  // radii long, that difference is most of the head.
  //
  // Rotation about +X maps +Z to (0, -sin, cos), so a FORWARD (+Y) rake needs
  // a negative angle. Getting this sign backwards lays the horn along the neck.
  cone.translate(0, 0, hornLength / 2);
  cone.rotateX(-UNICORN_HORN_TILT_RAD);
  // Base sits right at the skull surface (pollRadius above the spine
  // axis at the poll) and extends further upward from there.
  //
  // Shifted forward (+Y) onto the brow per direct feedback: sitting exactly
  // at the poll it read as growing out of the top of the neck rather than out
  // of the head. The skull surface drops away as it slopes down toward the
  // muzzle, so the base is sunk a little deeper in Z at the same time —
  // otherwise moving it forward would lift it clear of the head and leave the
  // horn floating.
  const hornForward = pollRadius * UNICORN_HORN_FORWARD_FRAC;
  cone.translate(0, pollY + hornForward, pollZ + pollRadius * 0.82);
  return cone;
}


/**
 * Two small paired ears flanking the horn at the poll, tilted slightly
 * outward and back. An earlier attempt at ears read "wildly out of
 * proportion" and was removed; the fix here is scale — these are sized
 * as a small fraction of the horn (which is itself already tuned small
 * relative to the head), not the head/body directly, so they can't
 * balloon out of proportion the way a width-relative size did before.
 * Built as flattened cones (short, wide-based, tapering to a point) so
 * they read as small horse ears rather than horn-like spikes.
 */
function buildUnicornEarsGeometry(pollY: number, pollZ: number, pollRadius: number): THREE.BufferGeometry {
  const earLength = pollRadius * 0.85;
  const earRadius = pollRadius * 0.4;
  const sideOffset = pollRadius * 0.55;
  // Ears sit just behind/beside the horn base, not stacked directly on
  // top of it, and lean outward+backward (away from the face) the way a
  // real horse's ears angle.
  const baseZ = pollZ + pollRadius * 0.55;
  const baseY = pollY - pollRadius * 0.25;

  function buildEar(side: 1 | -1): THREE.BufferGeometry {
    const ear = new THREE.ConeGeometry(earRadius, earLength, 6);
    ear.rotateX(Math.PI / 2); // point along +Z like the horn, before leaning
    // Lean outward (away from the midline) and slightly backward.
    ear.rotateY((side * Math.PI) / 8);
    ear.rotateX(-Math.PI / 10);
    ear.translate(side * sideOffset, baseY, baseZ + earLength * 0.4);
    return ear;
  }

  return mergePositionOnlyGeometries([buildEar(1), buildEar(-1)]);
}


/**
 * A symmetric mane crest running along the neck topline from the withers
 * to the poll, with a short forelock continuing past the poll toward the
 * forehead.
 *
 * Cross-section at each spine point:
 *
 *        ridge tip  (0, y, toplineZ + crewHeight)
 *            / \
 *           /   \
 *  left base     right base
 *  (-hw, y, tz)  (+hw, y, tz)
 *
 * where toplineZ = spine.z + spine.radius (the topmost point of the neck
 * ring at that point).  The crest width (hw) and height (crewHeight) taper
 * smoothly: widest and tallest at the upper-mid neck, narrowest at the
 * withers and forelock ends.
 *
 * Both the left and right panels are emitted with outward AND inward faces
 * so the crest is visible from any camera angle without requiring
 * DoubleSide on the body material.
 *
 * Symmetry: every vertex at (x, y, z) has a counterpart at (−x, y, z), so
 * this geometry passes the existing neck-symmetry regression test. The
 * central ridge tip sits on the midline (x = 0) and is excluded from that
 * test's off-midline filter.
 *
 * Hair-shader axis variation: the crest spans roughly ±9 % body-width in X
 * and ≈ 21 % body-length in Y — both are substantial fractions of the body
 * bounding box, so the XY-plane hair shader does not degenerate into stripes.
 */
function buildUnicornManeGeometry(
  length: number,
  width: number,
  bodyGeometry: THREE.BufferGeometry,
  pollY: number,
  pollRadius: number,
): THREE.BufferGeometry {
  const halfLen = length * 0.5;

  // Neck spine points (exact copies of the body's neck section from
  // buildHorseBodyProfileGeometry) plus two forelock points past the poll.
  //
  // The mane used to stop at a single point just past the poll, which sits
  // INSIDE the horn's own base footprint — so what should have been a
  // forelock was really just more hair piled against the horn. Carrying the
  // crest further forward onto the forehead gives it somewhere to start that
  // is genuinely on the head rather than on the horn.
  interface ManeSpinePoint { y: number; z: number; radius: number; }
  const spine: ManeSpinePoint[] = [
    { y: halfLen * 0.08,  z: length * 0.1,   radius: width * 0.22 }, // withers
    { y: halfLen * 0.147, z: length * 0.193,  radius: width * 0.17 }, // lower-mid
    { y: halfLen * 0.207, z: length * 0.287,  radius: width * 0.13 }, // upper-mid
    { y: halfLen * 0.247, z: length * 0.353,  radius: width * 0.12 }, // poll — horn stands here
    { y: halfLen * 0.285, z: length * 0.340,  radius: width * 0.11 }, // behind the forelock
    { y: halfLen * 0.315, z: length * 0.325,  radius: width * 0.09 }, // forelock, on the forehead
  ];

  // Resample to a finer set of rings. The horn clearance below carves a notch
  // narrower than the gap between two authored points, so at the authored
  // resolution it would land as a hard V rather than as hair parting.
  const RINGS = 19;
  const resampled: ManeSpinePoint[] = [];
  for (let i = 0; i < RINGS; i++) {
    const u = (i / (RINGS - 1)) * (spine.length - 1);
    const lo = Math.min(Math.floor(u), spine.length - 2);
    const f = u - lo;
    const a = spine[lo];
    const b = spine[lo + 1];
    resampled.push({
      y: THREE.MathUtils.lerp(a.y, b.y, f),
      z: THREE.MathUtils.lerp(a.z, b.z, f),
      radius: THREE.MathUtils.lerp(a.radius, b.radius, f),
    });
  }

  const bodyPos = bodyGeometry.getAttribute('position');
  const slab = length * 0.03;
  const xBand = width * 0.035;

  // Highest body-surface Z in a thin Y slab, restricted to vertices whose
  // |x| is near `absX`. Sampling at absX = 0 gives the topline; sampling at
  // the crest's own half-width gives the point on the flank where that side
  // of the crest has to sit.
  //
  // Anchoring to the REAL surface rather than to the spine radius matters:
  // the rendered neck is fatter than `pt.radius` (the head/nose bulbs and
  // profile smoothing widen it), so a crest placed at pt.z + pt.radius sits
  // BURIED for most of its length — measured up to 1.6 wu below the surface,
  // which is why the first version of this mane was invisible.
  const surfaceTopZAt = (y: number, absX: number): number => {
    let top = -Infinity;
    for (let i = 0; i < bodyPos.count; i++) {
      if (Math.abs(bodyPos.getY(i) - y) > slab) continue;
      if (Math.abs(Math.abs(bodyPos.getX(i)) - absX) > xBand) continue;
      top = Math.max(top, bodyPos.getZ(i));
    }
    return top;
  };

  // Widest |x| on the body in a thin Y slab — the neck's own half-width.
  const surfaceHalfWidthAt = (y: number): number => {
    let widest = 0;
    for (let i = 0; i < bodyPos.count; i++) {
      if (Math.abs(bodyPos.getY(i) - y) > slab) continue;
      widest = Math.max(widest, Math.abs(bodyPos.getX(i)));
    }
    return widest;
  };

  // Keep the crest clear of the horn.
  //
  // The crest is a blade standing on the midline — exactly where the horn
  // stands — so at the poll it simply swallowed the horn's lower half, and no
  // amount of lengthening the horn would fix that. Within the horn's own
  // footprint the ridge is flattened almost to the skin, so the hair parts
  // around the base of the horn and the horn reads at full height. Outside
  // that footprint the crest is untouched.
  const hornRadius = pollRadius * UNICORN_HORN_RADIUS_FRAC;
  const hornClearSpan = hornRadius * 2.1;
  // Centred on the horn's actual base, which sits forward of the poll.
  const hornCenterY = pollY + pollRadius * UNICORN_HORN_FORWARD_FRAC;
  const smoothstep01 = (t: number) => t * t * (3 - 2 * t);
  const hornClearanceAt = (y: number): number => {
    const d = Math.abs(y - hornCenterY) / hornClearSpan;
    if (d >= 1) return 1;
    return 0.1 + 0.9 * smoothstep01(d);
  };

  const N = resampled.length;
  const rings = resampled.map((pt, i): [THREE.Vector3, THREE.Vector3, THREE.Vector3] => {
    const t = i / (N - 1);
    const env = Math.sin(t * Math.PI) * 0.7 + 0.3; // 0.3 at ends, 1.0 in the middle
    // Wider than the old 0.75 per direct feedback — but never wider than the
    // neck it sits on. A base corner past the body's own silhouette would
    // hang in mid-air rather than resting against the neck, so the desired
    // width is clamped against the measured surface.
    const neckHalfWidth = surfaceHalfWidthAt(pt.y);
    const desiredHalfWidth = pt.radius * 1.25 * env;
    const halfWidth =
      neckHalfWidth > 0 ? Math.min(desiredHalfWidth, neckHalfWidth * 0.82) : desiredHalfWidth;
    const crestHeight = pt.radius * 1.9 * env * hornClearanceAt(pt.y);

    const ridgeFoot = Math.max(pt.z + pt.radius, surfaceTopZAt(pt.y, 0));
    // Each base corner sits on the flank at its own x, not up at the topline.
    // Draping the base over the neck's curvature is what lets the crest widen
    // without lifting away from the body at its edges.
    const sideTop = surfaceTopZAt(pt.y, halfWidth);
    const baseZ = Number.isFinite(sideTop) ? sideTop : ridgeFoot;
    return [
      new THREE.Vector3(-halfWidth, pt.y, baseZ),             // [0] left base
      new THREE.Vector3(0,          pt.y, ridgeFoot + crestHeight), // [1] ridge tip
      new THREE.Vector3(+halfWidth, pt.y, baseZ),             // [2] right base
    ];
  });

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  // Outward-winding helper using an expected outward direction rather than a
  // centroid-based check, which is more robust for thin panels.
  const pushOutwardAlong = (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    outDir: THREE.Vector3,
  ) => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(e1, e2);
    if (normal.dot(outDir) < 0) {
      pushTri(p0, p2, p1);
    } else {
      pushTri(p0, p1, p2);
    }
  };

  const LEFT  = new THREE.Vector3(-1, 0, 0);
  const RIGHT = new THREE.Vector3( 1, 0, 0);
  const BACK  = new THREE.Vector3( 0,-1, 0);
  const FWD   = new THREE.Vector3( 0, 1, 0);

  // Build each band between adjacent rings.  Each panel (left and right) is
  // emitted twice — once for the outer face and once for the inner face —
  // so the crest is fully visible from all camera angles.
  for (let i = 0; i < N - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];

    // Outer left panel (faces leftward, −X)
    pushOutwardAlong(a[0], b[0], b[1], LEFT);
    pushOutwardAlong(a[0], b[1], a[1], LEFT);
    // Inner left panel (faces rightward, +X — visible from inside the crest)
    pushOutwardAlong(a[0], a[1], b[1], RIGHT);
    pushOutwardAlong(a[0], b[1], b[0], RIGHT);

    // Outer right panel (faces rightward, +X)
    pushOutwardAlong(a[1], b[1], b[2], RIGHT);
    pushOutwardAlong(a[1], b[2], a[2], RIGHT);
    // Inner right panel (faces leftward, −X — visible from inside the crest)
    pushOutwardAlong(a[1], a[2], b[2], LEFT);
    pushOutwardAlong(a[1], b[2], b[1], LEFT);
  }

  // Start cap (withers end) faces backward (−Y).
  pushOutwardAlong(rings[0][0], rings[0][1], rings[0][2], BACK);
  pushOutwardAlong(rings[0][0], rings[0][2], rings[0][1], FWD);  // inner face

  // End cap (forelock end) faces forward (+Y).
  const last = rings[N - 1];
  pushOutwardAlong(last[0], last[2], last[1], FWD);
  pushOutwardAlong(last[0], last[1], last[2], BACK);  // inner face

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  // Smooth normals so the crest shades as a rounded surface rather than a
  // collection of flat triangles.  The crease angle naturally keeps the ridge
  // line and cap edges crisp.
  smoothNormalsByPosition(geometry);
  return geometry;
}

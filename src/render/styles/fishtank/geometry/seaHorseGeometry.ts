import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import {
  buildEyeDotsGeometry,
  extrudeRingGeometry,
  mergeGeometriesWithColor,
} from '../../../geometry/sharedGeometry';
import {
  extrudeRingGeometryAlongX,
  fishtankFinThickness,
  type FinThicknessSample,
  FISH_EYE_FLATTEN,
} from './fishSharedGeometry';

/**
 * Fish-tank "unicorn" predator geometry: reskinned into a classic
 * upright seahorse silhouette while keeping the unicorn's gold horn and
 * shared external color pipeline. The body is a vertically-stacked,
 * armored-looking swept form with a bent head and snout; wingLeft/
 * wingRight become the tiny pectoral fins that flap in the existing
 * render loop; tail is a true 3D curled tube instead of a fish caudal
 * fin.
 */
/**
 * The X coordinate of the pectoral fin root: the measured flank at the root's
 * height, sunk inward by FIN_ROOT_EMBED.
 *
 * Single source of truth shared by buildPectoralFinGeometry and the wing pivot
 * declared in createSeaHorseGeometries. These must agree exactly — a blade
 * hinging about a point it is not attached to tears away from the flank
 * mid-flap. Exported so tests can assert against the shipped value rather than
 * re-deriving it.
 */
export function seaHorsePectoralRootX(length: number, width: number): number {
  const spine = seaHorseSpine(length, width);
  return seaHorseFlankX(spine, length * FIN_ROOT_Y_FRAC, length * FIN_ROOT_Z_FRAC) * FIN_ROOT_EMBED;
}

export function createSeaHorseGeometries(length: number, width: number): CreatureGeometries {
  const body = buildSeaHorseBodyGeometry(length, width);
  const wingLeft = buildPectoralFinGeometry(length, width, 1);
  const wingRight = buildPectoralFinGeometry(length, width, -1);
  const tail = buildCurledTailGeometry(length, width);
  const beak = buildSnoutFinGeometry(length, width);
  // Pectoral fin root — must match the root vector in buildPectoralFinGeometry.
  // The fins flap about the Y axis (FORWARD_AXIS in the renderer); pivoting at
  // the model origin (null) sweeps the root through an arc, detaching it from
  // the body surface. Declaring the root as the pivot keeps it welded.
  const finRootY = length * FIN_ROOT_Y_FRAC;
  const finRootZ = length * FIN_ROOT_Z_FRAC;
  // Must equal buildPectoralFinGeometry's root exactly, or the blade hinges
  // about a point it is not attached to and tears away from the flank mid-flap.
  const finSurfaceX = seaHorsePectoralRootX(length, width);
  return {
    body, wingLeft, wingRight, tail, beak,
    wingPivotLeft:  [finSurfaceX, finRootY, finRootZ],
    wingPivotRight: [-finSurfaceX, finRootY, finRootZ],
  };
}

// Seahorse palette — single source of truth shared between the baked tail
// gradient (below) and the fishtank scene's Horse-predator color tint
// (FishtankSceneRenderer3D). Kept here so every seahorse-specific color lives
// in the seahorse's own module rather than being split across files.
//
// The body reads as a pink that leans toward lavender (but is not fully
// lavender); the tail fades from that same body tone at its base to a more
// saturated purple-lavender at the curled tip.
// Body and tail-base share this exact value so they render as the same tone
// (the body's instanceColor and the tail's baked base vertex color both resolve
// to it). Set halfway between the prior mauve-pink (0xdf9dd1) and the lighter
// lavender (0xe9b8e0) per feedback — a touch pinker than the lighter tone while
// staying lighter than the original.
export const SEAHORSE_BODY_COLOR = 0xf28cbc;
export const SEAHORSE_HUNT_COLOR = 0xf2d6ee;
export const SEAHORSE_TAIL_TIP_COLOR = 0xa87fe0;

const WHITE_VERTEX_COLOR = new THREE.Color(0xffffff);
const HORN_COLOR = new THREE.Color(0xffd54a);
const EYE_COLOR = new THREE.Color(0x101014);
const TAIL_BASE_COLOR = new THREE.Color(SEAHORSE_BODY_COLOR);
const TAIL_TIP_COLOR = new THREE.Color(SEAHORSE_TAIL_TIP_COLOR);

// The tail's instanceColor is set (by the scene tint) to the body color and
// then multiplied by the baked per-vertex color, so the baked gradient is
// stored as a RATIO relative to the body rather than as absolute colors:
//   base ratio = body/body = white   -> base renders as the body color
//   tip  ratio = tip/body            -> tip renders as the lavender tip color
// Because instanceColor tracks the body through the hunt-highlight lerp, the
// tail base stays exactly equal to the body at every hunt intensity (fixing the
// prior white-instanceColor path where the body drifted toward the highlight
// during hunts but the tail base did not). Ratios are computed in the linear
// space THREE.Color stores, matching the shader's linear instanceColor*vertex
// multiply. THREE.Color components are already linear (ColorManagement on).
const TAIL_BASE_RATIO = new THREE.Color(1, 1, 1);
const TAIL_TIP_RATIO = new THREE.Color().setRGB(
  TAIL_TIP_COLOR.r / TAIL_BASE_COLOR.r,
  TAIL_TIP_COLOR.g / TAIL_BASE_COLOR.g,
  TAIL_TIP_COLOR.b / TAIL_BASE_COLOR.b,
);

// Rainbow fin/dorsal styling — mirrors the nature unicorn's pegasus-wing look
// (violet at the root, red at the tip) but kept entirely local to the seahorse.
// Matches the unicorn's HSL sweep (see unicornGeometry.addRainbowVertexColors).
const RAINBOW_ROOT_HUE = 0.78; // violet at the root
const RAINBOW_TIP_HUE = 0.0; // red at the tip
const RAINBOW_SATURATION = 0.85;
const RAINBOW_LIGHTNESS = 0.62;
// The dorsal fin is merged into the body mesh, so its baked vertex color is
// multiplied by the body's (pink) instanceColor. To let the rainbow read as
// pure color there — exactly like the pectoral fins, which sit on their own
// white-instanceColor mesh — the dorsal rainbow is baked as a RATIO relative to
// the body color (rainbow / body), so instanceColor * ratio == rainbow at idle.
// SEAHORSE_BODY_COLOR components are already linear (ColorManagement on),
// matching the shader's linear instanceColor*vertex multiply.
const SEAHORSE_BODY_LINEAR = new THREE.Color(SEAHORSE_BODY_COLOR);

// Pectoral fin root coordinates (fraction of length/width).
// These are the single source of truth shared between buildPectoralFinGeometry
// and createSeaHorseGeometries' wing-pivot declarations, so that any future
// geometry change to the fin root automatically updates the pivot too.
// Exported so tests can anchor assertions on these concrete values instead of
// copying them (a copied constant cannot detect a change to the original).
export const FIN_ROOT_Y_FRAC = 0.03;
/**
 * Fore-aft position of the pectoral root, moved aft from 0.05 so the blade
 * grows out of the flat mid-flank instead of the front edge where the body is
 * already curving away — which is what made the fins read as unattached.
 */
export const FIN_ROOT_Z_FRAC = 0.0;
/**
 * How far inside the measured flank the pectoral root is sunk (1 = exactly on
 * the skin). The root is deliberately buried so no gap can open at any point in
 * the flap arc, or after any future retune of the body spine.
 */
export const FIN_ROOT_EMBED = 0.72;

interface SpinePoint {
  y: number;
  z: number;
  radius: number;
  xScale?: number;
  zScale?: number;
}

/**
 * A part merged into the seahorse body mesh. `plates: false` excludes the part
 * from the bony-plate shader (see the aPlateSuppress build below).
 */
interface SeaHorseBodyPart {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  plates?: boolean;
}

function buildSeaHorseBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const { geometry: shell, crestY, crestZ, crestRadius, eyeX, eyeY, eyeZ, eyeRadius } = buildSeaHorseShellGeometry(length, width);
  const dorsalFin = buildDorsalFinGeometry(length, width);
  const horn = buildSeaHorseHornGeometry(crestY, crestZ, crestRadius);
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius, FISH_EYE_FLATTEN);

  // `plates: false` marks a part as NOT armoured skin, so the bony-plate
  // shader skips it. The dorsal fin is a translucent rainbow membrane, the horn
  // is smooth keratin and the eyes are wet spheres — none of them are scutes,
  // but all three are merged into the single body mesh the shader patches.
  const entries: SeaHorseBodyPart[] = [
    { geometry: shell, color: WHITE_VERTEX_COLOR },
    { geometry: dorsalFin, color: WHITE_VERTEX_COLOR, plates: false },
    { geometry: horn, color: HORN_COLOR, plates: false },
    { geometry: eyes, color: EYE_COLOR, plates: false },
  ];
  const merged = mergeGeometriesWithColor(entries);

  // Per-vertex "do not plate" flag, built in the SAME order as `entries`.
  //
  // The sense is deliberately SUPPRESS (1 = skip) rather than INCLUDE (1 = draw).
  // A vertex attribute that a geometry never declares reads as 0 in GLSL, so
  // with this sense the value GLSL invents is also the safe default — any
  // geometry that never sets the flag is simply plated as normal. The inverted
  // sense would silently strip the pattern off every unflagged mesh.
  //
  // mergeGeometriesWithColor de-indexes every part, so an INDEXED part
  // contributes index.count vertices, not position.count. Using position.count
  // here would misalign every part after the first.
  const total = merged.getAttribute('position').count;
  const suppress = new Float32Array(total);
  let offset = 0;
  for (const entry of entries) {
    const partCount = entry.geometry.index
      ? entry.geometry.index.count
      : entry.geometry.getAttribute('position').count;
    if (entry.plates === false) suppress.fill(1, offset, offset + partCount);
    offset += partCount;
  }
  merged.setAttribute('aPlateSuppress', new THREE.BufferAttribute(suppress, 1));

  shell.dispose();
  dorsalFin.dispose();
  horn.dispose();
  eyes.dispose();
  return merged;
}

/**
 * The seahorse body spine, hoisted to module scope so that fin builders can ask
 * where the body surface actually is instead of hard-coding coordinates that
 * silently drift out of contact whenever the spine is retuned. Y is the sweep
 * axis (tail -> head) and is monotonically increasing, which is what lets
 * seaHorseSurfacePoint interpolate by Y.
 */
function seaHorseSpine(length: number, width: number): SpinePoint[] {
  const halfLen = length * 0.5;
  return [] = [
    // Radii here are widened another 25% (now ~0.078/0.219/0.344, cumulative
    // ~1.56x the original 0.05/0.14/0.22) so the body tapers more gradually
    // into the tail attachment, matching a correspondingly thinner tail base.
    { y: -halfLen * 0.22, z: -length * 0.38, radius: width * 0.078, xScale: 0.32, zScale: 0.58 },
    { y: -halfLen * 0.18, z: -length * 0.31, radius: width * 0.219, xScale: 0.42, zScale: 0.84 },
    { y: -halfLen * 0.125, z: -length * 0.24, radius: width * 0.344, xScale: 0.54, zScale: 1.02 },
    { y: -halfLen * 0.06, z: -length * 0.14, radius: width * 0.27, xScale: 0.58, zScale: 1.18 },
    { y: 0, z: -length * 0.02, radius: width * 0.295, xScale: 0.6, zScale: 1.28 },
    { y: halfLen * 0.05, z: length * 0.08, radius: width * 0.255, xScale: 0.56, zScale: 1.2 },
    // Muzzle/snout points. The nose/head is shortened a further 20%: each forward
    // (+Z) muzzle point is pulled toward the face base at spine[5].z (0.08) so its
    // reach beyond the face is scaled x0.8. spine[6] 0.16->0.144, snout tip
    // spine[7] 0.204->0.179, muzzle crown spine[8] 0.195->0.172. y/radius/scale
    // unchanged so the head keeps its profile, just a stubbier nose. The horn and
    // eyes anchor off spine[7]/[6], so they follow the shorter snout automatically.
    { y: halfLen * 0.1, z: length * 0.144, radius: width * 0.19, xScale: 0.48, zScale: 1.02 },
    { y: halfLen * 0.136, z: length * 0.179, radius: width * 0.15, xScale: 0.42, zScale: 0.9 },
    { y: halfLen * 0.205, z: length * 0.172, radius: width * 0.125, xScale: 0.38, zScale: 0.82 },
    { y: halfLen * 0.28, z: length * 0.115, radius: width * 0.1, xScale: 0.32, zScale: 0.58 },
    { y: halfLen * 0.36, z: length * 0.025, radius: width * 0.072, xScale: 0.27, zScale: 0.42 },
  ];
}

/**
 * The flank half-width (surface |X|) at spine height `y` and fore-aft position
 * `z`, by solving the squircle cross-section for X.
 *
 * Parameterising instead by ANGLE would be awkward for seating a fin: the
 * cross-section is deliberately boxy (squareness 3.6), so X barely
 * changes over the flat flank while Z sweeps enormously — between angle 0 and
 * -20 degrees Z moves ~15 units but X only ~0.4. Specifying a fin root by angle
 * therefore makes its fore-aft placement wildly sensitive. This lets the root be
 * expressed the way it is actually reasoned about: "at this height and this
 * fore-aft position, sit exactly on the flank."
 *
 * Returns 0 for a `z` beyond the section's dorsoventral extent.
 */
function seaHorseFlankX(spine: SpinePoint[], y: number, z: number): number {
  const squareness = 3.6;
  let i = 0;
  while (i < spine.length - 2 && spine[i + 1].y < y) i++;
  const a = spine[i];
  const b = spine[i + 1];
  const span = b.y - a.y;
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, (y - a.y) / span));
  const lerp = (u: number, v: number) => u + (v - u) * t;
  const radius = lerp(a.radius, b.radius);
  const xScale = lerp(a.xScale ?? 1, b.xScale ?? 1);
  const zScale = lerp(a.zScale ?? 1, b.zScale ?? 1);
  const centerZ = lerp(a.z, b.z);

  const zHalf = radius * zScale;
  if (zHalf <= 0) return 0;
  // Invert z = r*zs*|sin|^(2/sq) for |sin|, then take |cos| = sqrt(1 - sin^2).
  const zNorm = Math.min(1, Math.abs(z - centerZ) / zHalf);
  const sin = Math.pow(zNorm, squareness / 2);
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  return radius * xScale * Math.pow(cos, 2 / squareness);
}


function buildSeaHorseShellGeometry(
  length: number,
  width: number,
): {
  geometry: THREE.BufferGeometry;
  crestY: number;
  crestZ: number;
  crestRadius: number;
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  eyeRadius: number;
} {
  const spine = seaHorseSpine(length, width);

  const geometry = buildSweptGeometry(spine, 12);
  const crest = spine[7];
  // Seat the eyes on the widest cheek of the head, embedded into the surface —
  // NOT out near the crown/snout. The previous anchor used spine[8] (the crown)
  // plus a forward +Z push of half the section depth, which shoved the eyes onto
  // the narrow snout ridge where they poked through/over it and read as floating
  // past the head. Instead, blend between spine[6] (the widest cheek/gill
  // section) and spine[7] (the snout base) and sit the eye centers just inside
  // that section's side surface (x = local half-width) with no forward push, so
  // each eye rests symmetrically on a cheek with only a slight, eye-like bulge.
  const cheekA = spine[6];
  const cheekB = spine[7];
  const eyeBlend = 0.35; // mostly on the wide cheek, nudged toward the snout base
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const eyeSecY = lerp(cheekA.y, cheekB.y, eyeBlend);
  const eyeSecZ = lerp(cheekA.z, cheekB.z, eyeBlend);
  const eyeSecRadius = lerp(cheekA.radius, cheekB.radius, eyeBlend);
  const eyeSecXScale = lerp(cheekA.xScale ?? 1, cheekB.xScale ?? 1, eyeBlend);
  // The head's side surface at this section sits at x = radius * xScale (the
  // squircle's widest point, at cross-section angle 0). Seat the eye center just
  // inside that. The eye is flattened into a lens (FISH_EYE_FLATTEN) so it reads
  // as a disc on the cheek; sinking it further than this would bury it outright.
  const eyeHalfWidth = eyeSecRadius * eyeSecXScale;
  return {
    geometry,
    crestY: crest.y,
    crestZ: crest.z,
    crestRadius: crest.radius,
    eyeX: eyeHalfWidth,
    eyeY: eyeSecY,
    eyeZ: eyeSecZ,
    eyeRadius: width * 0.022,
  };
}

function buildSeaHorseHornGeometry(crestY: number, crestZ: number, crestRadius: number): THREE.BufferGeometry {
  // Smaller coronet than before (length 1.15x vs 1.7x, radius 0.28x vs 0.34x)
  // and pulled back/down so its base embeds into the crest instead of hovering
  // above it. The old +0.14*radius lift and +0.92*radius forward offset left a
  // visible gap between the horn base and the head; seating the base at
  // ~0.35*radius forward with a slight downward nudge closes it.
  // Grown a further 25% (1.796875x, cumulatively 1.5625x the original 1.15x)
  // while keeping the SAME base point: the base sits at crestZ + crestRadius*0.3
  // and the center at base + hornLength*0.5, so growing hornLength extends the
  // tip forward without lifting the base off the crest.
  const hornLength = crestRadius * 1.796875;
  const hornRadius = crestRadius * 0.28;
  // Build a spiraled cone: same dimensions as the old ConeGeometry but with a
  // single helical ridge to give it a coral/shell spiral-y texture. The ridge
  // traces one-and-a-half turns from base to tip and fades toward the tip.
  const horn = buildSpiralCone(hornRadius, hornLength);
  // ConeGeometry's axis runs along +Y; rotateX(PI/2) points it along +Z (the
  // model's up/forward direction when the seahorse is posed upright).
  horn.rotateX(Math.PI / 2);
  horn.translate(0, crestY - crestRadius * 0.05, crestZ + crestRadius * 0.3 + hornLength * 0.5);
  return horn;
}

/**
 * A tapered cone with a single helical ridge spiralling from base to tip.
 * The cone's axis runs along +Y (apex at +hornLength/2, base at -hornLength/2)
 * matching THREE.ConeGeometry's convention, so callers can apply the same
 * rotateX + translate placement as before.
 *
 * The ridge is a raised sinusoidal bump in the radial direction whose peak
 * angle advances linearly with height, tracing a helix. It fades toward the
 * tip so the apex stays sharp.
 */
function buildSpiralCone(hornRadius: number, hornLength: number): THREE.BufferGeometry {
  const segments = 12;
  const stacks = 22;
  const ridgeTurns = 1.5;
  const ridgeAmp = hornRadius * 0.22; // height of the raised ridge

  // Return a vertex on the spiral cone surface.
  // stack: 0 = base, stacks = apex.
  // seg: circumferential index in [0, segments).
  const getPoint = (stack: number, seg: number): THREE.Vector3 => {
    const t = stack / stacks;                         // 0 = base, 1 = apex
    const angle = (seg / segments) * Math.PI * 2;
    const baseRadius = hornRadius * (1 - t);          // linear taper to zero
    // Helical ridge: peak phase advances with height to form a helix.
    const phase = angle - t * ridgeTurns * Math.PI * 2;
    // cos(phase): +1 at ridge crest, -1 at valley; clamp negatives to zero
    const ridgeFactor = Math.max(0, Math.cos(phase));
    // Sharpen the ridge and fade it toward the tip (×(1-t)) so the apex is clean
    const bump = ridgeAmp * Math.pow(ridgeFactor, 3) * (1 - t);
    const r = baseRadius + bump;
    const y = t * hornLength - hornLength * 0.5; // center at origin
    return new THREE.Vector3(r * Math.cos(angle), y, r * Math.sin(angle));
  };

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  // Side quads
  for (let stack = 0; stack < stacks; stack++) {
    for (let seg = 0; seg < segments; seg++) {
      const next = (seg + 1) % segments;
      const a = getPoint(stack, seg);
      const b = getPoint(stack, next);
      const c = getPoint(stack + 1, seg);
      const d = getPoint(stack + 1, next);
      pushTri(a, b, c);
      pushTri(b, d, c);
    }
  }

  // Base cap
  const basePt = new THREE.Vector3(0, -hornLength * 0.5, 0);
  for (let seg = 0; seg < segments; seg++) {
    const next = (seg + 1) % segments;
    pushTri(basePt, getPoint(0, next), getPoint(0, seg));
  }

  // Apex cap (degenerate — just one point)
  const apexPt = new THREE.Vector3(0, hornLength * 0.5, 0);
  for (let seg = 0; seg < segments; seg++) {
    const next = (seg + 1) % segments;
    pushTri(apexPt, getPoint(stacks - 1, seg), getPoint(stacks - 1, next));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A small snout fin (beak) near the seahorse's snout tip — the tiny nasal
 * crown fin that many seahorse species display just forward of the face.
 *
 * Returned as the `beak` field of CreatureGeometries so it gets its own
 * InstancedMesh and is unconditionally welded to the body transform by
 * applyCreatureBodyMatrices (the same weld that fixed the rigless-tail bug
 * in #200). Colored via the seahorse's body instanceColor.
 */
function buildSnoutFinGeometry(length: number, width: number): THREE.BufferGeometry {
  // Anchor just forward of the snout tip (spine[7] area).
  const snoutY = length * 0.068;
  const snoutZ = length * 0.179;
  // A small kite-shaped fin pointing forward (+Z). It's thin enough to read
  // as a delicate membrane and tiny enough not to clash with the horn above.
  const span = width * 0.055;     // half-width of the fin
  const chord = length * 0.038;   // depth of the fin (fore-aft)
  const root = new THREE.Vector3(0, snoutY, snoutZ);
  const leftEdge = new THREE.Vector3(-span, snoutY + chord * 0.25, snoutZ + chord * 0.45);
  const tipFwd = new THREE.Vector3(0, snoutY + chord * 0.55, snoutZ + chord);
  const rightEdge = new THREE.Vector3(span, snoutY + chord * 0.25, snoutZ + chord * 0.45);
  const thickness = fishtankFinThickness(span * 2);
  return extrudeRingGeometry([root, leftEdge, tipFwd, rightEdge], thickness);
}

function buildDorsalFinGeometry(length: number, width: number): THREE.BufferGeometry {
  // A seahorse's dorsal fin runs down the mid-back. Built as a scalloped sail
  // in the Y-Z plane and given real thickness along X (via extrudeAlongX) so it
  // reads as a solid 3D fin from every angle instead of the previous
  // paper-thin sheet that vanished edge-on. The wavy outer edge (three crest
  // points) mimics the rippled membrane of a real dorsal fin.
  const outline = [
    new THREE.Vector3(0, length * 0.02, length * 0.05),
    new THREE.Vector3(0, -length * 0.02, -length * 0.02),
    new THREE.Vector3(0, -length * 0.055, -length * 0.16),
    // Outer (free) edge — pushed back/-Z and down/-Y, lightly scalloped.
    new THREE.Vector3(0, -length * 0.16, -length * 0.14),
    new THREE.Vector3(0, -length * 0.185, -length * 0.055),
    new THREE.Vector3(0, -length * 0.155, length * 0.02),
  ];
  // Thin membrane: just enough X-depth to stay 3D (not vanish edge-on) while
  // reading as a delicate, wispy sail rather than a solid keel.
  const fin = extrudeRingGeometryAlongX(outline, fishtankFinThickness(width));
  // Rainbow the sail like the pectoral fins: violet where it roots against the
  // back (top-front of the outline), red at the free outer edge. The dorsal is
  // merged into the body mesh (pink instanceColor), so bake as a ratio relative
  // to the body so the multiply resolves to a pure rainbow (divideByBody=true).
  const finRoot = new THREE.Vector3(0, length * 0.02, length * 0.05);
  const finReach = length * 0.24;
  return addRainbowVertexColors(fin, finRoot, finReach, true);
}

function buildPectoralFinGeometry(length: number, width: number, side: 1 | -1): THREE.BufferGeometry {
  // The animated "wing" slot. The shared engine flaps these about the body's
  // long (vertical +Y) axis. The pivot is declared in createSeaHorseGeometries
  // via wingPivotLeft/Right so the renderer articulates around the root rather
  // than the model origin, keeping the root welded through the flap arc.
  const rootY = length * FIN_ROOT_Y_FRAC;
  const rootZ = length * FIN_ROOT_Z_FRAC;
  // Seat the root at the MEASURED flank rather than a hard-coded half-width,
  // and sink it inside the body. The old root sat at width * 0.15 while the
  // real flank at that height is width * 0.1316, so the blade started 1.8 units
  // proud of the skin and read as floating alongside the fish rather than
  // growing out of it. Burying the root guarantees no gap can open at any
  // point in the flap arc or after any future retune of the spine.
  const rootX = seaHorsePectoralRootX(length, width);

  const span = width * 0.28; // blade reach outward from the flank
  const chord = length * 0.13;
  const out = (f: number) => side * (rootX + span * f);

  // Every ring point stays at constant rootZ. extrudeRingGeometry thickens the
  // ring along Z, so any Z variation in the outline is indistinguishable from
  // added thickness and would fatten the blade past the fin-thickness budget.
  // The swept shape therefore lives entirely in X (span) and Y (chord).
  //
  // Silhouette: a real pectoral fin is a rounded, slightly swept paddle whose
  // trailing edge is scalloped by the rays fanning through it, and it narrows
  // as it meets the body. The previous outline was a 4-point quad, which reads
  // as a flat card stuck to the flank. Ordered as a ring: leading edge outward,
  // around the tip, then back along the scalloped trailing edge.
  const ring = [
    // Narrow root, so the blade tapers into the flank instead of butting it.
    new THREE.Vector3(out(0), rootY + chord * 0.10, rootZ),
    // Leading edge: bows forward, the stiff spine of the fin.
    new THREE.Vector3(out(0.34), rootY + chord * 0.40, rootZ),
    new THREE.Vector3(out(0.70), rootY + chord * 0.42, rootZ),
    // Rounded tip.
    new THREE.Vector3(out(0.94), rootY + chord * 0.24, rootZ),
    new THREE.Vector3(out(1.0), rootY - chord * 0.02, rootZ),
    // Trailing edge, scalloped between ray tips.
    new THREE.Vector3(out(0.86), rootY - chord * 0.30, rootZ),
    new THREE.Vector3(out(0.72), rootY - chord * 0.22, rootZ),
    new THREE.Vector3(out(0.55), rootY - chord * 0.46, rootZ),
    new THREE.Vector3(out(0.40), rootY - chord * 0.34, rootZ),
    new THREE.Vector3(out(0.18), rootY - chord * 0.40, rootZ),
    new THREE.Vector3(out(0.02), rootY - chord * 0.18, rootZ),
  ];
  // As thin as possible while still catching light and not disappearing edge-on.
  const thickness = fishtankFinThickness(chord);
  const geometry = extrudeRingGeometry(ring, thickness);
  // Rainbow the fin from its root (violet, where it meets the flank) to the
  // blade tip (red), matching the unicorn's wings. These fins render on their
  // own white-instanceColor mesh, so the baked color shows as pure rainbow.
  const root = new THREE.Vector3(side * rootX, rootY, rootZ);
  return addRainbowVertexColors(geometry, root, span, false);
}

export function createSeaHorseFinThicknessSamples(length: number, width: number): FinThicknessSample[] {
  const chord = length * 0.13;
  return [
    {
      label: 'dorsal',
      geometry: buildDorsalFinGeometry(length, width),
      referenceSize: width,
      thinAxis: 'x',
    },
    {
      label: 'pectoral-left',
      geometry: buildPectoralFinGeometry(length, width, 1),
      referenceSize: chord,
      thinAxis: 'z',
    },
    {
      label: 'pectoral-right',
      geometry: buildPectoralFinGeometry(length, width, -1),
      referenceSize: chord,
      thinAxis: 'z',
    },
  ];
}

function buildCurledTailGeometry(length: number, width: number): THREE.BufferGeometry {
  // Anchor the tail so it starts overlapping inside the body's thicker taper
  // (around spine[1]/spine[2] in buildSeaHorseShellGeometry) rather than at the
  // body's pointed tip (spine[0]). Since the body and tail are separate meshes
  // (not vertex-welded), anchoring right at the tapered-to-a-point tip leaves a
  // visible "point meets disc" seam; starting the tail a bit further up, with a
  // radius that comfortably covers the body's cross-section there, hides the
  // seam by burying it inside the overlapping solid volume instead.
  const halfLen = length * 0.5;
  const bodyEndRadius = width * 0.0788 * 0.95;
  // Vertical (down the body) position of the tail root. NOTE: in this model's
  // authoring frame the +Y axis is the seahorse's front/back (belly<->dorsal)
  // horizontal direction once it is posed upright (model +Z is world-up, see
  // MODEL_UP_AXIS in CreatureInstanceRenderer), NOT its long axis. So anchorY —
  // despite the name — slides the tail base horizontally between belly and back.
  // Start from -halfLen * 0.1 (the original attach point, which poked out the
  // belly/front) and pull it back toward the dorsal side by 0.75x the tail base
  // radius so the thick root tucks behind the body instead of out the front.
  const anchorY = -halfLen * 0.1 - bodyEndRadius * 0.75;
  // Vertical drop of the tail root along the body length. (Authoring +Z is the
  // upright model's world-up axis; -Z moves the root down toward the tail end.)
  // 20% of the base diameter below the rear taper so the base tucks in cleanly.
  const anchorZ = -length * 0.28 * 1.05 - bodyEndRadius * 2 * 0.2;
  const tailTipRadius = width * 0.014;
  const maxRadius = length * 0.205;
  const minRadius = length * 0.038;
  // Tilt the tail's initial direction back (toward -Y, the rear of the body)
  // by 30 degrees from straight down, instead of exactly straight down --
  // exiting perfectly vertically left a visible hump where the tail crossed
  // back through the body's rear taper on its way to curling forward.
  const tiltRadians = THREE.MathUtils.degToRad(30);
  // Starting at theta = -PI - tiltRadians with theta increasing (turns > 0)
  // makes the initial tangent point down-and-back (tilted 30 degrees behind
  // straight down) from the anchor, then curls the tail counterclockwise:
  // down/back -> down -> forward (+Y, toward the head) -> up -> back under
  // itself, tapering as it goes.
  const startTheta = -Math.PI - tiltRadians;
  const centerY = anchorY - maxRadius * Math.cos(startTheta);
  const centerZ = anchorZ - maxRadius * Math.sin(startTheta);
  const turns = 5.2;
  const samples = 28;

  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  const tailColors: THREE.Color[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const theta = startTheta + turns * t;
    // Ease the coil radius shrink with t^2 (zero derivative at t=0) so the very
    // first segment is a pure rotation around the coil center -- otherwise the
    // radius shrinking right from t=0 adds an extra "inward" (forward) velocity
    // component on top of the rotational one, making the tail's first segment
    // point down-and-forward instead of straight down, and creating a visible
    // hump where it meets the body. Combined with more samples (28 vs. 14) so
    // that first segment is short enough to closely track the true tangent.
    const radiusT = t * t;
    const radius = THREE.MathUtils.lerp(maxRadius, minRadius, radiusT);
    path.push(new THREE.Vector3(0, centerY + Math.cos(theta) * radius, centerZ + Math.sin(theta) * radius));
    // Ease the taper with a squared falloff so the thick root persists briefly
    // before narrowing, rather than shrinking linearly right away.
    const taper = 1 - (1 - t) * (1 - t);
    radii.push(THREE.MathUtils.lerp(bodyEndRadius, tailTipRadius, taper));
    // Bake the coil gradient as a ratio relative to the body color (see
    // TAIL_BASE_RATIO / TAIL_TIP_RATIO above): base = white so the tail root
    // renders as exactly the body color, easing toward tip/body so the
    // saturated purple-lavender concentrates at the curled tip. The scene tint
    // sets the tail instanceColor to the body color, so instanceColor * this
    // baked ratio yields the intended absolute gradient while keeping the base
    // locked to the body at every hunt intensity.
    tailColors.push(TAIL_BASE_RATIO.clone().lerp(TAIL_TIP_RATIO, t * t));
  }

  return buildTubeGeometry(path, radii, 8, tailColors);
}

function buildSweptGeometry(spine: SpinePoint[], segments: number): THREE.BufferGeometry {
  const rings = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const { x, z } = crossSectionOffset(point.radius, angle, point.xScale ?? 1, point.zScale ?? 1);
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const pushOutwardTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, center: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const normal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    if (normal.dot(outward) < 0) pushTri(a, c, b);
    else pushTri(a, b, c);
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const center = new THREE.Vector3(0, (spine[i].y + spine[i + 1].y) * 0.5, (spine[i].z + spine[i + 1].z) * 0.5);
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % segments;
      pushOutwardTri(rings[i][j], rings[i][k], rings[i + 1][j], center);
      pushOutwardTri(rings[i][k], rings[i + 1][k], rings[i + 1][j], center);
    }
  }

  const startCenter = new THREE.Vector3(0, spine[0].y, spine[0].z);
  const startInside = new THREE.Vector3(0, spine[1].y, spine[1].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(startCenter, rings[0][k], rings[0][j], startInside);
  }

  const endIndex = spine.length - 1;
  const endCenter = new THREE.Vector3(0, spine[endIndex].y, spine[endIndex].z);
  const endInside = new THREE.Vector3(0, spine[endIndex - 1].y, spine[endIndex - 1].z);
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    pushOutwardTri(endCenter, rings[endIndex][j], rings[endIndex][k], endInside);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function crossSectionOffset(radius: number, angle: number, xScale: number, zScale: number): { x: number; z: number } {
  const squareness = 3.6;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = radius * xScale * Math.sign(c) * Math.pow(Math.abs(c), 2 / squareness);
  const z = radius * zScale * Math.sign(s) * Math.pow(Math.abs(s), 2 / squareness);
  return { x, z };
}

function buildTubeGeometry(
  path: THREE.Vector3[],
  radii: number[],
  sides: number,
  ringColors?: THREE.Color[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  // Each emitted vertex carries the color of the path sample (ring) it belongs
  // to, so a per-sample gradient along `ringColors` bakes straight into the
  // tail's vertex colors. `ci`/`cj` are the ring indices of the two ends of a
  // side quad; caps reuse their single ring's color.
  const pushTri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ca?: number,
    cb?: number,
    cc?: number,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (ringColors) {
      const put = (idx?: number) => {
        const color = ringColors[idx ?? 0];
        colors.push(color.r, color.g, color.b);
      };
      put(ca);
      put(cb);
      put(cc);
    }
  };

  let normal = new THREE.Vector3(0, 0, 1);
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i < path.length; i++) {
    const tangent = new THREE.Vector3();
    if (i < path.length - 1) tangent.subVectors(path[i + 1], path[i]);
    else tangent.subVectors(path[i], path[i - 1]);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
    tangent.normalize();

    normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent)));
    if (normal.lengthSq() < 1e-8) {
      normal.set(1, 0, 0).sub(tangent.clone().multiplyScalar(tangent.x));
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < sides; s++) {
      const theta = (s / sides) * Math.PI * 2;
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(theta) * radii[i])
        .add(binormal.clone().multiplyScalar(Math.sin(theta) * radii[i] * 0.88));
      ring.push(path[i].clone().add(offset));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const next = (s + 1) % sides;
      pushTri(rings[i][s], rings[i + 1][s], rings[i + 1][next], i, i + 1, i + 1);
      pushTri(rings[i][s], rings[i + 1][next], rings[i][next], i, i + 1, i);
    }
  }

  const startCenter = path[0];
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(startCenter, rings[0][next], rings[0][s], 0, 0, 0);
  }

  const endCenter = path[path.length - 1];
  const endRing = rings[rings.length - 1];
  const lastIndex = rings.length - 1;
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    pushTri(endCenter, endRing[s], endRing[next], lastIndex, lastIndex, lastIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (ringColors) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Bakes the unicorn-style rainbow hue gradient (violet at `root`, red at the
 * far tip) into a per-vertex 'color' attribute, based on each vertex's straight-
 * line distance from `root`. Seahorse-local so the shared pipeline is untouched.
 *
 * When `divideByBody` is true, the baked color is stored as a ratio relative to
 * SEAHORSE_BODY_COLOR — used for the dorsal fin, whose color attribute is later
 * multiplied by the body's pink instanceColor; dividing first cancels that tint
 * so the rainbow renders pure. Pectoral fins live on their own white-
 * instanceColor mesh and pass false (absolute rainbow).
 */
function addRainbowVertexColors(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  maxDistance: number,
  divideByBody: boolean,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(vertex.distanceTo(root) / maxDistance, 0, 1);
    const hue = THREE.MathUtils.lerp(RAINBOW_ROOT_HUE, RAINBOW_TIP_HUE, t);
    color.setHSL(hue, RAINBOW_SATURATION, RAINBOW_LIGHTNESS);
    let r = color.r;
    let g = color.g;
    let b = color.b;
    if (divideByBody) {
      r /= SEAHORSE_BODY_LINEAR.r;
      g /= SEAHORSE_BODY_LINEAR.g;
      b /= SEAHORSE_BODY_LINEAR.b;
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

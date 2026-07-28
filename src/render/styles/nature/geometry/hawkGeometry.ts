import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/sharedGeometry';
import { BIRD_FEATHER_MASK_ATTRIBUTE } from '../birdFeatherShader';
import { mergeGeometriesWithColor, mergePositionOnlyGeometries, buildDiscCapGeometry, singleLegPart, swayingTailRig, mirrorGeometryAcrossX, subdivideTriangleSoup } from '../../../geometry/sharedGeometry';
import { buildHookedBeakGeometry, getBirdBodyRearTipY } from './birdSharedGeometry';

/**
 * Hawk predator geometry — split out from the shared "realistic bird"
 * builder (birdGeometry.ts, now dedicated to the small songbird species:
 * sparrow/goldfinch/cardinal/bluejay) so the hawk can read as a distinct
 * raptor silhouette rather than just a scaled-up recolor of the same
 * songbird shape. Modeled loosely on a bald eagle: a broad dark torso,
 * a genuinely white head and tail (baked/tinted separately — see
 * Renderer3D's hawk getSpeciesColors), and a large yellow hooked beak.
 *
 * Since this geometry belongs to only one species (unlike the shared
 * small-bird shape), the head/beak/eye color detail can be baked directly
 * into the body's vertex colors via mergeGeometriesWithColor rather than
 * needing a separate InstancedMesh part per feature — the per-instance
 * "body" tint just needs to stay near-white so the baked colors show
 * through undistorted (white is the identity for the tint-multiplies-
 * vertex-color math the renderer uses — see Renderer3D's hawk color
 * wiring for the full explanation).
 */

// Deep blackish-brown torso/wing-root plumage — real bald eagles are
// almost black-brown, not a rust/tan hawk-brown, which is part of what
// makes the white head/tail read so starkly.
const TORSO_COLOR = new THREE.Color(0x2a2018);
// Genuinely white head, not a pale tint of the torso color — this is the
// single biggest "bald eagle" visual cue.
const HEAD_COLOR = new THREE.Color(0xf2efe6);
// Bright yellow-orange hooked beak/cere.
const BEAK_COLOR = new THREE.Color(0xf2b100);
const EYE_COLOR = new THREE.Color(0x0d0b08);
// Pale straw iris. A raptor's eye reads as a bright ring around a large dark
// pupil; a single dark dot reads as a songbird's eye however big it is made.
const IRIS_COLOR = new THREE.Color(0xd8bf72);
// Yellow-orange talons matching the beak — classic raptor cere/talon color.
const TALONS_COLOR = new THREE.Color(0xe8a800);

export function createHawkGeometries(length: number, width: number): CreatureGeometries {
  const body = buildHawkBodyGeometry(length, width);

  // Broader, longer wings than the small-bird shape — a soaring raptor's
  // wings are proportionally larger relative to its body than a small
  // perching bird's — reusing the shared fingered-wing shape with broadTip
  // enabled so the hawk's wingtips fan out like real primary feathers
  // (broad, rounded "fingered" silhouette) rather than coming to a sharp
  // triangular point like a swift/falcon.
  // A soaring raptor's wing is long relative to its chord; the old 2.2:1 wing
  // read as a stubby paddle.
  const wingSpan = length * 1.78;
  const wingChord = length * 0.56;
  const wingLeft = buildHawkWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildHawkWingGeometry(wingSpan, wingChord, -1);

  // Real bald eagle tails are white — handled for free via a plain
  // per-instance tail tint (see Renderer3D's NATURE_HAWK_COLORS), no
  // vertex-bake needed since the tail is already its own InstancedMesh
  // part.
  const tail = buildHawkFanTailGeometry(length, width);
  const legs = buildHawkLegsGeometry({ length, width, body });
  const tailRig = swayingTailRig({ pivot: [0, getBirdBodyRearTipY(length), 0], axis: [1, 0, 0] });

  return { body, wingLeft, wingRight, tail, tailRig, legs: singleLegPart(legs) };
}

/**
 * Broader-chested, more thickset torso than the small-bird shape (real
 * raptors are bulkier relative to their length), with a distinctly
 * separate white head region (baked, not just a lighter body tint), a
 * large yellow hooked beak, and near-black eyes.
 *
 * Torso radii trimmed down from an earlier pass (belly/chest up to
 * 0.48-0.5*width) that read as "too fat" once seen next to the slimmed-
 * down small-bird/parrot shapes — still noticeably bulkier than a
 * songbird (a real raptor is bulkier relative to its length), just not
 * as extreme. The head region also gets the same 25%-narrower/10%-longer
 * treatment requested for the small birds and parrot, pivoting at the
 * neck pinch so only the head elongates, not the torso below it.
 */
const HEAD_LENGTHEN_SCALE = 1.1;
const HEAD_START_FRAC = 0.4; // nape
const HEAD_END_FRAC = HEAD_START_FRAC + (0.82 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face plane

/**
 * Cross-section shaping. A lathe is circular in section, so without this the
 * hawk presents exactly the same outline from the side as from above, which is
 * what made it read as a turned wooden pawn rather than a bird.
 *
 * A raptor is narrow across the back and deep through the keel, so the squeeze
 * is lateral and the extra depth is carried below the spine only.
 */
const BODY_SQUEEZE_X = 0.9;
const BODY_DEEPEN_Z = 1.1;
const BODY_KEEL_DROOP = 1.2;
/** Flattening applied above the spine over the skull, for the raptor's level crown. */
const CROWN_FLATTEN_Z = 0.9;

/**
 * Brow ridge depth, as a fraction of body width. The supraorbital ridge is the
 * bony shelf that overhangs a raptor's eye and is the single feature that reads
 * as "hawk" rather than "bird" — it is what gives the scowl. It cannot come
 * from the lathe, which can only produce shapes that are the same all the way
 * around, so it is built as its own wedge over each eye.
 */
const BROW_JUT_FRAC = 0.052;

/**
 * Give the lathe a non-circular section: squeezed across the back, deepened
 * through the keel, and flattened over the crown.
 *
 * `computeVertexNormals` is not optional here. Scaling a surface by (a, b, c)
 * transforms its normals by (1/a, 1/b, 1/c), so keeping the lathe's originals
 * would light the bird as though it were still round and undo the shaping in
 * everything except the silhouette.
 */
function shapeHawkCrossSection(
  geometry: THREE.BufferGeometry,
  keelFadeStartY: number,
  keelFadeEndY: number,
  crownStartY: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    let z = position.getZ(i) * BODY_DEEPEN_Z;
    if (z < 0) {
      // Keel depth, faded out through the head so the throat stays round.
      const keel = 1 - THREE.MathUtils.smoothstep(y, keelFadeStartY, keelFadeEndY);
      z *= THREE.MathUtils.lerp(1, BODY_KEEL_DROOP, keel);
    } else {
      // Level the crown, faded in from the shoulders so the back of the neck
      // does not gain a step where the flattening starts.
      const crown = THREE.MathUtils.smoothstep(y, crownStartY, keelFadeEndY);
      z *= THREE.MathUtils.lerp(1, CROWN_FLATTEN_Z, crown);
    }
    position.setX(i, position.getX(i) * BODY_SQUEEZE_X);
    position.setZ(i, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Find where the finished skull surface actually is, at a given station along
 * the spine and in a given direction around it.
 *
 * Placing a feature at a hard-coded fraction of body width only ever matches
 * one skull. The eyes used to sit at `width * 0.24 * HEAD_NARROW_SCALE *
 * HEAD_EXTRA_NARROW`, so widening the head buried them inside it and narrowing
 * it left them floating clear — the same failure that the parrot's eyes and the
 * small bird's eyes both had. Measuring the surface instead means the eye stays
 * seated whatever the profile does.
 *
 * Returns the surface point and its outward normal, both in model space.
 */
function sampleHeadSurface(
  head: THREE.BufferGeometry,
  y: number,
  aimX: number,
  aimZ: number,
): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const position = head.getAttribute('position') as THREE.BufferAttribute;
  const normal = head.getAttribute('normal') as THREE.BufferAttribute;
  const aim = new THREE.Vector2(aimX, aimZ).normalize();
  let best = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < position.count; i++) {
    const radial = new THREE.Vector2(position.getX(i), position.getZ(i));
    if (radial.lengthSq() < 1e-9) continue;
    // Prefer vertices pointing the way we asked, then those nearest the
    // requested station. The station weight has to be strong enough that a
    // well-aimed vertex at the wrong end of the head never wins.
    const score = radial.clone().normalize().dot(aim) - Math.abs(position.getY(i) - y) * 4;
    if (score > best) {
      best = score;
      bestIndex = i;
    }
  }
  return {
    point: new THREE.Vector3().fromBufferAttribute(position, bestIndex),
    normal: new THREE.Vector3().fromBufferAttribute(normal, bestIndex).normalize(),
  };
}

/**
 * One eye disc per side, lying flat against the skull.
 *
 * The disc is oriented from the measured surface normal rather than by a
 * hand-set cant angle. A fixed angle matches exactly one head shape: when the
 * parrot's skull was narrowed, correcting the eye offset alone buried one side
 * because the cant no longer agreed with the surface underneath it.
 *
 * `lift` floats the pupil a hair proud of the iris so the two never z-fight.
 */
function buildRaptorEye(
  surface: THREE.Vector3,
  normal: THREE.Vector3,
  curvatureRadius: number,
  radius: number,
  lift: number,
): THREE.BufferGeometry {
  // A spherical cap, not a flat disc. A flat disc laid on a curved skull can
  // only be wrong in one direction or the other: tangent, its rim stands off
  // the surface and it reads as a bead glued on; sunk far enough to bring the
  // rim flush, the skull bulges up through the middle of it and cuts a lens out
  // of the pupil. A cap that shares the skull's curvature is flush everywhere.
  const capRadius = curvatureRadius + lift;
  // Half-angle the cap has to span to cover the requested eye radius.
  const halfAngle = Math.asin(THREE.MathUtils.clamp(radius / capRadius, 0, 1));
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    const cap = new THREE.SphereGeometry(capRadius, 24, 12, 0, Math.PI * 2, 0, halfAngle);
    const aim = new THREE.Vector3(normal.x * side, normal.y, normal.z).normalize();
    // SphereGeometry's cap opens around +Y; point it along the surface normal.
    cap.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim),
    );
    // Centre of curvature: one radius back down the normal from the surface.
    cap.translate(
      surface.x * side - aim.x * curvatureRadius,
      surface.y - aim.y * curvatureRadius,
      surface.z - aim.z * curvatureRadius,
    );
    parts.push(cap);
  }
  return mergePositionOnlyGeometries(parts);
}

/**
 * The supraorbital ridge — a rounded bony shelf above and slightly behind each
 * eye, jutting forward over it.
 *
 * This cannot be part of the head lathe. A lathe is by construction identical
 * all the way around its axis, so anything it produces above the eye also
 * appears under the chin and down the back of the neck. The brow only exists on
 * the two sides of the skull, so it has to be its own geometry.
 */
function buildBrowRidges(
  head: THREE.BufferGeometry,
  eyeY: number,
  eyeRadius: number,
  eyeAimZ: number,
  skullRadius: number,
  jut: number,
): THREE.BufferGeometry {
  // Clear the eye by its own angular half-width plus a margin, rather than by a
  // guessed direction. The eye subtends asin(eyeRadius / skullRadius) about the
  // spine — about 14 degrees here — so offsets picked by eye kept landing the
  // ridge inside the iris.
  const eyeAngle = Math.atan2(eyeAimZ, 1);
  const eyeHalfWidth = Math.asin(THREE.MathUtils.clamp(eyeRadius / skullRadius, 0, 1));
  const browAimZ = Math.tan(eyeAngle + eyeHalfWidth * 1.5);

  // The ridge is lofted along the skull rather than assembled from a row of
  // spheres. Two earlier attempts failed for reasons worth keeping:
  //
  //   - a single long ellipsoid placed at the eye is buried at its rear end and
  //     juts into open air at its front, because the skull tapers sharply toward
  //     the face. It rendered as a pair of white horns beside the beak.
  //   - a chain of individually seated beads follows the taper correctly but
  //     reads as a caterpillar: separate spheres scallop against each other
  //     however much they overlap, because they share no vertices.
  //
  // Lofting a half-elliptical section along surface points sampled per station
  // both follows the taper and produces one continuous surface.
  const stations = 11;
  const arcSteps = 6;
  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  for (const side of [1, -1] as const) {
    // rings[station][arcStep]
    const rings: THREE.Vector3[][] = [];
    for (let i = 0; i < stations; i++) {
      const t = i / (stations - 1);
      // Biased rearward: the bone is heaviest behind the eye and runs forward
      // over it, thinning as it goes.
      const station = eyeY + (t - 0.6) * eyeRadius * 3.4;
      const seat = sampleHeadSurface(head, station, 1, browAimZ);
      const outward = new THREE.Vector3(seat.normal.x * side, seat.normal.y, seat.normal.z).normalize();
      // Around the skull, perpendicular to both the outward normal and the
      // spine — this is the direction the ridge has width in.
      const around = new THREE.Vector3().crossVectors(outward, new THREE.Vector3(0, 1, 0)).normalize();
      const centre = new THREE.Vector3(seat.point.x * side, seat.point.y, seat.point.z);
      // Taper the section toward the front so the ridge fades out instead of
      // ending in a blunt stub, and pinch both ends so it merges into the skull.
      const endFade = Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)) ** 0.55;
      const height = jut * 0.44 * (1 - 0.45 * t) * endFade;
      const halfWidth = jut * 1.45 * (1 - 0.3 * t) * endFade;
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k <= arcSteps; k++) {
        const theta = (k / arcSteps) * Math.PI;
        ring.push(
          centre
            .clone()
            .addScaledVector(around, Math.cos(theta) * halfWidth)
            // Sunk slightly so the section's feet finish just inside the skin
            // rather than floating on the tangent plane.
            .addScaledVector(outward, Math.sin(theta) * height - jut * 0.22),
        );
      }
      rings.push(ring);
    }
    for (let i = 0; i < stations - 1; i++) {
      for (let k = 0; k < arcSteps; k++) {
        const a = rings[i][k];
        const b = rings[i][k + 1];
        const c = rings[i + 1][k + 1];
        const d = rings[i + 1][k];
        // Wind consistently per side; mirroring negates x, which reverses the
        // sense of every cross product and would otherwise flip the normals.
        if (side > 0) {
          pushTri(a, b, c);
          pushTri(a, c, d);
        } else {
          pushTri(a, c, b);
          pushTri(a, d, c);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildHawkBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const bodyRearY = getBirdBodyRearTipY(length);
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  // faceRadius: the beak's cross-section radius at the join point — kept as
  // authored so the beak silhouette is unchanged.
  const faceRadius = width * 0.15;
  // headFaceRadius: the head's face-opening radius — deliberately smaller than
  // faceRadius so the beak fully occludes the head's open ring from any view
  // angle (the beak's 8-gon inscribed radius ≈ 0.924 * faceRadius, so any
  // headFaceRadius ≤ 0.5 * faceRadius is well inside that boundary).
  const headFaceRadius = faceRadius * 0.5;
  const faceY = halfLen * HEAD_END_FRAC;
  // The nape is only slightly narrower than the chest. The old profile pinched
  // it to 47 % of the chest radius, which on a lathe reads as an hourglass
  // waist with a small ball balanced on top of it. A raptor has no visible
  // neck in flight — the skull runs into the shoulders — and its head is large
  // and blocky, not a dome. The head is also no longer narrowed relative to the
  // body: the previous 0.75 x 0.82 left it at 58 % of chest radius, and an
  // eagle's head is nearly as broad as its chest.
  //
  // The rump keeps real width instead of closing to a near-point, so the tail
  // has something to grow out of. Running the body to a spike is what made the
  // old tail read as a separate object pinned on at one vertex.
  const profile = [
    new THREE.Vector2(width * 0.115, bodyRearY), // rump — broad enough to seat the tail
    new THREE.Vector2(width * 0.235, -halfLen * 0.72),
    new THREE.Vector2(width * 0.335, -halfLen * 0.3), // belly
    new THREE.Vector2(width * 0.36, halfLen * 0.02), // chest — the widest point
    new THREE.Vector2(width * 0.335, halfLen * 0.2), // shoulders
    new THREE.Vector2(width * 0.278, halfLen * HEAD_START_FRAC), // nape — a gentle dip, not a waist
    // Every station below must stay inside headFrac(0.82): that is exactly
    // where HEAD_END_FRAC lands, and a control point past it sends the profile
    // forward and then back, folding the lathe into a cup around the beak.
    new THREE.Vector2(width * 0.3, halfLen * headFrac(0.56)), // rear skull
    new THREE.Vector2(width * 0.305, halfLen * headFrac(0.66)), // crown plateau
    new THREE.Vector2(width * 0.283, halfLen * headFrac(0.74)), // brow line
    new THREE.Vector2(width * 0.2, halfLen * headFrac(0.79)), // cheek, tapering to the face
    new THREE.Vector2(headFaceRadius, faceY), // face — narrowed so the beak occludes the opening
  ];
  // The torso/chest/neck portion of the profile stays the dark plumage
  // color; the head-base-onward portion (index 5+) is tinted white —
  // splitting the lathe into two color-tagged sub-geometries at that
  // seam (rather than one continuous lathe) so LatheGeometry's per-
  // vertex color can make a clean, deliberate torso/head color break
  // instead of a smooth (and thus muddy/gray) gradient between them.
  const torsoProfile = profile.slice(0, 6); // through the nape
  const headProfile = profile.slice(5); // nape through face (shares the seam vertex)
  // Spline-resample each sub-profile so the flat-shaded lathes read as
  // smooth surfaces; raise radial segments to 32 for the same reason.
  const torso = new THREE.LatheGeometry(new THREE.SplineCurve(torsoProfile).getPoints(48), 32);
  const head = new THREE.LatheGeometry(new THREE.SplineCurve(headProfile).getPoints(32), 32);
  // Both halves must be shaped with the same parameters, or the section jumps
  // at the colour seam and draws a visible crease around the neck.
  const keelFadeStartY = halfLen * 0.16;
  const keelFadeEndY = halfLen * HEAD_START_FRAC;
  const crownStartY = -halfLen * 0.1;
  for (const part of [torso, head]) {
    shapeHawkCrossSection(part, keelFadeStartY, keelFadeEndY, crownStartY);
  }

  // Seal the open tail-end lathe ring with a double-sided disc cap so it no
  // longer reads as a transparent hole when viewed from behind. Colored to
  // match the back plumage so it reads as continuous dark feathering.
  // Must match the rump radius in the profile above. It was left at 0.04 when
  // the rump was widened, which left the lathe open at the back.
  const tailCap = buildDiscCapGeometry(bodyRearY, width * 0.115, 32);

  // A raptor's bill is big, deep and hooked. The old call produced something
  // barely a tenth of the body long, curled 28 degrees and squashed vertically
  // to 0.8 — from the side it read as a smooth blunt cone stuck on the top of
  // the skull rather than as a bill. It is now half again as long, curled far
  // enough that the tip clearly points down past the chin line, and no longer
  // flattened: a hawk's bill is deeper than it is wide, not shallower.
  // buildHookedBeakGeometry biases curvature toward the tip (angle grows with
  // t^1.6), so most of the length still reads as straight with the hook
  // concentrated at the end, which is correct for an eagle.
  const beakLen = length * 0.142;
  const beak = buildHookedBeakGeometry(faceY, faceRadius, beakLen, 56, 1.02);

  // The cere: the fleshy pad at the base of the bill, slightly wider than the
  // bill itself so it reads as a distinct step rather than a continuation.
  const cere = new THREE.SphereGeometry(faceRadius * 1.16, 16, 12);
  cere.scale(1, 0.62, 1.02);
  cere.translate(0, faceY - faceRadius * 0.1, 0);

  // Nostril slits in the cere. Small, but they are most of what stops the bill
  // reading as a solid horn at close range.
  const nostrils: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    const slit = new THREE.SphereGeometry(faceRadius * 0.2, 8, 6);
    slit.scale(0.55, 1, 0.8);
    slit.translate(side * faceRadius * 0.72, faceY - faceRadius * 0.06, faceRadius * 0.34);
    nostrils.push(slit);
  }

  // A raptor's eye is large, forward-set and high on the skull, close behind
  // the beak rather than centred on the side of the head. It is measured onto
  // the finished surface rather than positioned by formula.
  const eyeY = halfLen * headFrac(0.735);
  const eyeSeat = sampleHeadSurface(head, eyeY, 1, 0.42);
  const eyeRadius = width * 0.062;

  // Sink each disc by the sagitta of the chord it cuts, so it sits in the skull
  // rather than hovering in front of it. Without this the eye reads as a bead
  // glued on, which is what the parrot's eyes did before they were seated.
  // Local curvature of the skull at the eye, used to make the eye conform to it.
  const skullRadius = Math.hypot(eyeSeat.point.x, eyeSeat.point.z);
  const lift = width * 0.002;
  const iris = buildRaptorEye(eyeSeat.point, eyeSeat.normal, skullRadius, eyeRadius, lift);
  const pupil = buildRaptorEye(eyeSeat.point, eyeSeat.normal, skullRadius, eyeRadius * 0.46, lift * 2.2);

  // The brow shelf, sitting just above the eye and jutting forward over it.
  // This is what turns a round-eyed bird head into a raptor's.
  const brows = buildBrowRidges(head, eyeY, eyeRadius, 0.42, skullRadius, width * BROW_JUT_FRAC);

  // `feather` is how much of the procedural plumage texture each part takes.
  // The hawk is already wired into the bird feather shader, but had no mask, so
  // its beak, cere and eyes were being tiled with plumage — bare keratin
  // rendered as though it were covered in feathers.
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color; feather: number }[] = [
    { geometry: torso, color: TORSO_COLOR, feather: 1 },
    { geometry: tailCap, color: TORSO_COLOR, feather: 1 },
    { geometry: head, color: HEAD_COLOR, feather: 1 },
    { geometry: brows, color: HEAD_COLOR, feather: 1 },
    { geometry: cere, color: BEAK_COLOR, feather: 0 },
    { geometry: beak, color: BEAK_COLOR, feather: 0 },
    { geometry: mergePositionOnlyGeometries(nostrils), color: EYE_COLOR, feather: 0 },
    { geometry: iris, color: IRIS_COLOR, feather: 0 },
    { geometry: pupil, color: EYE_COLOR, feather: 0 },
  ];

  const merged = mergeGeometriesWithColor(
    parts.map(({ geometry, color }) => ({ geometry, color })),
  );
  const mask = new Float32Array(merged.getAttribute('position').count);
  let offset = 0;
  for (const part of parts) {
    // Counts must come from the INDEX where there is one: the merge de-indexes,
    // so an indexed part contributes index.count vertices, not position.count.
    // Using position.count silently misaligns every part after the first lathe.
    const count = part.geometry.index?.count ?? part.geometry.getAttribute('position').count;
    mask.fill(part.feather, offset, offset + count);
    offset += count;
  }
  merged.setAttribute(BIRD_FEATHER_MASK_ATTRIBUTE, new THREE.BufferAttribute(mask, 1));
  return merged;
}

/**
 * Short tucked legs with three forward-facing talons and one rear hallux,
 * baked in yellow-orange (matching the beak/cere). Positioned near the
 * tail end of the belly, close to the centerline — a raptor in flight
 * holds its feet tucked up under the body.
 */
function buildHawkLegsGeometry({
  length,
  width,
  body,
}: {
  length: number;
  width: number;
  /** The finished torso, so the hip can be measured rather than guessed. */
  body: THREE.BufferGeometry;
}): THREE.BufferGeometry {
  const legRadius = width * 0.052;
  const legLength = length * 0.048;
  const toeLength = length * 0.082;
  // Back toward tail, matching where a real raptor's ankle sits.
  const footY = -length * 0.28;

  // The hip used to be a hard-coded `-width * 0.242`, copied by hand off the
  // lathe profile of the day. Deepening the keel moved the belly below it and
  // swallowed the legs whole, with nothing in the geometry to say so. Measure
  // the body instead, so the legs track whatever the profile does next.
  const position = body.getAttribute('position') as THREE.BufferAttribute;
  const band = length * 0.04;
  let hipZ = 0;
  let bodyBottom = 0;
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    bodyBottom = Math.min(bodyBottom, z);
    if (Math.abs(position.getY(i) - footY) <= band) hipZ = Math.min(hipZ, z);
  }
  // Clear the deepest point of the keel too, not just the belly directly above
  // the foot — otherwise the toes disappear inside the chest from head on.
  const footZ = Math.min(hipZ - legLength * 0.9, bodyBottom - legLength * 0.5);

  const buildLeg = (side: 1 | -1): THREE.BufferGeometry => {
    const x = side * width * 0.001;
    // Spans hip to foot, so the shank never leaves a gap when the foot has to
    // drop further to clear the keel.
    const shank = hipZ - footZ;
    const leg = new THREE.CylinderGeometry(legRadius * 0.82, legRadius, shank, 6);
    leg.rotateX(Math.PI / 2);
    leg.translate(x, footY, hipZ - shank * 0.5);

    const makeToe = (xOffset: number, yBias: number): THREE.BufferGeometry => {
      const toe = new THREE.ConeGeometry(legRadius * 0.40, toeLength, 5);
      toe.translate(x + xOffset, footY + yBias + toeLength * 0.45, footZ);
      return toe;
    };
    const toes = [
      makeToe(side * legRadius * 0.6, toeLength * 0.04),
      makeToe(0, toeLength * 0.1),
      makeToe(-side * legRadius * 0.6, toeLength * 0.04),
    ];
    const hallux = new THREE.ConeGeometry(legRadius * 0.32, toeLength * 0.65, 5);
    hallux.rotateX(Math.PI);
    hallux.translate(x, footY - toeLength * 0.28, footZ + toeLength * 0.02);
    return mergePositionOnlyGeometries([leg, ...toes, hallux]);
  };

  const both = mergePositionOnlyGeometries([buildLeg(1), buildLeg(-1)]);
  return mergeGeometriesWithColor([{ geometry: both, color: TALONS_COLOR }]);
}

/**
 * A broad, fan-shaped hawk tail — a trapezoidal outline with a wide,
 * approximately straight trailing edge, matching the real raptor silhouette
 * (used as an airbrake and steering surface) rather than the narrow kite/diamond
 * shape produced by the generic shared buildTailGeometry.
 *
 * Geometry: a 6-vertex polygon in the XY (horizontal) plane, extruded ±Z for
 * a small amount of vertical thickness so it does not vanish when viewed edge-on.
 *
 * Coordinate frame (MODEL_UP=Z, MODEL_RIGHT=X, spine=Y):
 *   - Root vertex at the body rear tip (Y = getBirdBodyRearTipY), attachment matches tailRig pivot.
 *   - Mid-sweep vertices fan out to about half-span at 48% of the tail's length.
 *   - Left/right trailing corners carry the full half-span at the trailing edge,
 *     making the trailing edge the widest part of the tail (fan, not kite).
 *   - A center trailing vertex sits slightly forward of the corner vertices to
 *     give a very slight convex rounding rather than a sharp rectangular edge.
 *
 * Sway axis note: the tailRig still uses axis [1,0,0] (X = MODEL_RIGHT), which
 * produces a pitch (up/down) motion — the tail tips up as the hawk climbs and
 * down as it dives. This is correct for a raptor using its tail as an elevator.
 * Axis [0,1,0] (spine) would roll the tail about its own centerline; [0,0,1]
 * (world-up) would yaw it left/right. Pitch on X is intentional and unchanged.
 *
 * Polygon budget:
 *   Previous 4-vertex kite: 12 faces / 36 triangle vertices
 *   New      6-vertex fan:   20 faces / 60 triangle vertices  (+24 vertices)
 */
function buildHawkFanTailGeometry(length: number, width: number): THREE.BufferGeometry {
  const rootY = getBirdBodyRearTipY(length);
  const reach = length * 0.54;
  const fanDeg = 54;
  // Roots are spread across the width of the rump rather than gathered at a
  // single vertex. A tail that radiates from one point reads as a separate
  // object pinned to the bird — the exact complaint raised about the small
  // bird's tail before it was rebuilt the same way.
  const rootHalfSpan = width * 0.17;
  const half = HAWK_RECTRIX_COUNT / 2;

  const feathers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < half; i++) {
    const t = (i + 0.5) / half;
    const theta = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(0.5, fanDeg, t));
    // Slightly longer in the middle, so the spread trailing edge is a rounded
    // arc rather than a straight cut.
    const len = reach * (1.02 - 0.16 * t * t);
    // Wide enough that adjacent vanes overlap by about half, which is what
    // makes the rectrices read as separate feathers rather than as one solid
    // fan, but not so wide that they close up entirely.
    const halfWidth = (reach * 0.78 * Math.sin(THREE.MathUtils.degToRad(fanDeg))) / half;
    // A feather's base corners sit half a width out along its perpendicular,
    // so an outer feather rooted level with the rump has its leading corner
    // ahead of the body and pokes out of the bird's flank. Setting the root
    // back by exactly that much keeps the whole fan behind the rump.
    const seatY = rootY - halfWidth * Math.sin(theta);
    feathers.push(
      buildHawkFeather(
        // The z stagger only has to be enough to keep the vanes from
        // z-fighting where they overlap. An earlier, much larger value spread
        // them into a visible rake when seen from the side.
        [rootHalfSpan * t, seatY, -width * 0.012 * i],
        new THREE.Vector2(Math.sin(theta), -Math.cos(theta)),
        len,
        halfWidth,
        0.92,
      ),
    );
  }

  // Same reflection rule as the wings: the feather builder's perpendicular is
  // even in x and odd in y, which is the opposite of what a mirror needs, so
  // building the second half by negating an angle would reverse its winding and
  // light one side of the tail as though it were the underside.
  const left = mergePositionOnlyGeometries(feathers);
  return mergePositionOnlyGeometries([left, mirrorGeometryAcrossX(left.clone())]);
}


/**
 * Wing planform and feather layout.
 *
 * The old hawk reused the shared `buildFingeredWingGeometry`, which is a flat,
 * zero-thickness triangle fan radiating from the root. That had four separate
 * problems, all visible in a still render:
 *
 *   - it vanished completely when seen edge-on, having no thickness at all;
 *   - its "fingers" were notches in a solid outline, so at any distance the
 *     wing read as a plain black slab rather than as separated primaries;
 *   - the outline was a straight-edged polygon, where a soaring raptor's wing
 *     has a leading edge that bulges forward and a trailing edge that curves;
 *   - being a fan from the root, single triangles spanned the whole wing, so
 *     the undulation vertex shader could only render its travelling wave as one
 *     straight chord. This is the same defect that made the parrot's feathers
 *     surface through its wing panel.
 *
 * The replacement is a curved panel carrying two separate feather groups, which
 * is how a raptor wing is actually arranged: secondaries forming a continuous
 * shingled edge along the inner trailing edge, and a small number of long,
 * deeply separated primaries at the tip. The gaps between those primaries are
 * the single most recognisable thing about a soaring hawk.
 */
const HAWK_PRIMARY_COUNT = 6;
/** Tail feathers. Must be even, so no feather sits on the mirror plane. */
const HAWK_RECTRIX_COUNT = 12;
const HAWK_SECONDARY_COUNT = 10;
/** Fraction of the span at which the hand (primaries) takes over from the arm. */
const HAWK_WRIST_FRAC = 0.58;
/** How far the primaries splay apart, in radians, from innermost to outermost. */
const HAWK_PRIMARY_SPLAY_RAD = 0.62;
/** Spanwise fraction at which the solid panel ends and only feathers continue. */
const PANEL_END_FRAC = 0.76;
const HAWK_FEATHER_SEAT_FRAC = 0.012;
const HAWK_FEATHER_SHINGLE_FRAC = 0.014;
/**
 * Panel subdivision, for the same reason as the parrot's. A flat panel needs
 * interior vertices before a vertex shader can bend it into anything but a
 * plane; without them the panel swings out from under its own feathers as the
 * wing flaps.
 */
const HAWK_WING_PANEL_DIVISIONS = 14;

function buildHawkWingGeometry(span: number, chord: number, side: 1 | -1): THREE.BufferGeometry {
  // The right wing is the reflection of the left, never a second build with the
  // sign pushed through every coordinate. See mirrorGeometryAcrossX.
  if (side === -1) return mirrorGeometryAcrossX(buildHawkWingGeometry(span, chord, 1));

  const halfThickness = chord * 0.009;
  const panel: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[]) => panel.push(...a, ...b, ...c);

  // Leading and trailing edges, given as explicit stations along the span and
  // interpolated between. Written as tables rather than as trigonometric
  // expressions because the outline has to be read and adjusted by eye, and a
  // closed-form version of it proved impossible to reason about: an earlier
  // attempt produced a wing whose outer half pointed forwards.
  //
  // Both edges are in chord units. The leading edge bulges forward over the
  // arm and sweeps back past the wrist; the trailing edge is deepest inboard,
  // which is what gives a soaring raptor its broad, plank-like inner wing.
  // The panel only carries the front two-thirds of the chord; the secondaries
  // supply the rest. Giving the panel the full depth made the inner wing read
  // as a solid slab with a row of small scallops stuck on the back of it.
  const leadingStations = [0.44, 0.5, 0.51, 0.49, 0.45, 0.36, 0.12];
  const trailingStations = [-0.3, -0.36, -0.37, -0.34, -0.27, -0.18, -0.05];
  const sampleEdge = (table: number[], t: number) => {
    const u = THREE.MathUtils.clamp(t / PANEL_END_FRAC, 0, 1) * (table.length - 1);
    const i = Math.min(Math.floor(u), table.length - 2);
    return chord * THREE.MathUtils.lerp(table[i], table[i + 1], u - i);
  };
  const leadingAt = (t: number) => sampleEdge(leadingStations, t);
  const trailingAt = (t: number) => sampleEdge(trailingStations, t);

  const panelSteps = 18;
  for (let i = 0; i < panelSteps; i++) {
    const t0 = (i / panelSteps) * PANEL_END_FRAC;
    const t1 = ((i + 1) / panelSteps) * PANEL_END_FRAC;
    const x0 = span * t0;
    const x1 = span * t1;
    const l0 = leadingAt(t0);
    const l1 = leadingAt(t1);
    const tr0 = trailingAt(t0);
    const tr1 = trailingAt(t1);
    for (const z of [halfThickness, -halfThickness]) {
      pushTri([x0, l0, z], [x1, l1, z], [x1, tr1, z]);
      pushTri([x0, l0, z], [x1, tr1, z], [x0, tr0, z]);
    }
    // Closed rim, so the wing still shows a solid edge when seen edge-on.
    pushTri([x0, l0, halfThickness], [x0, l0, -halfThickness], [x1, l1, -halfThickness]);
    pushTri([x0, l0, halfThickness], [x1, l1, -halfThickness], [x1, l1, halfThickness]);
    pushTri([x0, tr0, -halfThickness], [x0, tr0, halfThickness], [x1, tr1, halfThickness]);
    pushTri([x0, tr0, -halfThickness], [x1, tr1, halfThickness], [x1, tr1, -halfThickness]);
  }

  /**
   * Camber and dihedral, applied to the finished wing rather than baked into
   * each piece, so the panel and every feather stay on one continuous surface.
   *
   * Without this the wing is a dead-flat plate: it shades as a single uniform
   * tone from every angle, which is what made the previous version read as a
   * cut-out rather than a wing.
   *
   * `u` runs 0 at the leading edge to 1 at the panel's trailing edge and on
   * past 1 over the feathers, so the bulge rises over the panel and settles
   * back down along the flight feathers.
   */
  const curveWing = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const t = THREE.MathUtils.clamp(x / span, 0, 1);
      const lead = leadingAt(t);
      const depth = Math.max(lead - trailingAt(t), 1e-4);
      const u = THREE.MathUtils.clamp((lead - position.getY(i)) / depth, 0, 2.6);
      // Rises over the panel and droops away along the flight feathers, which
      // is the real profile. Peaking the bulge at the panel's trailing edge
      // instead reflexed it, and the secondaries read as upturned flaps.
      const camber =
        u <= 1
          ? chord * 0.075 * Math.sin(Math.PI * u)
          : -chord * 0.055 * ((u - 1) / 1.6);
      const dihedral = span * 0.045 * t * t;
      position.setZ(i, position.getZ(i) + camber + dihedral);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  };

  const parts: THREE.BufferGeometry[] = [];
  const panelGeometry = new THREE.BufferGeometry();
  panelGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(subdivideTriangleSoup(panel, HAWK_WING_PANEL_DIVISIONS)), 3),
  );
  panelGeometry.computeVertexNormals();
  parts.push(panelGeometry);

  const seatZ = -chord * HAWK_FEATHER_SEAT_FRAC;

  // Secondaries: a continuous shingled row along the inner trailing edge.
  for (let i = 0; i < HAWK_SECONDARY_COUNT; i++) {
    const t = (i + 0.5) / HAWK_SECONDARY_COUNT;
    const at = t * HAWK_WRIST_FRAC;
    const x = span * at;
    const rootY = trailingAt(at);
    const width = (span * HAWK_WRIST_FRAC) / HAWK_SECONDARY_COUNT;
    const len = chord * (0.46 + 0.14 * Math.sin(Math.PI * t));
    const z = seatZ + (i % 2 === 0 ? 0 : -1) * chord * HAWK_FEATHER_SHINGLE_FRAC;
    // Secondaries trail straight back, leaning slightly outward down the span.
    const theta = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(6, 22, t));
    parts.push(
      buildHawkFeather(
        [x, rootY, z],
        new THREE.Vector2(Math.sin(theta), -Math.cos(theta)),
        len,
        width * 1.15,
        0.88,
      ),
    );
  }

  // Primaries: long, separated, and splayed progressively further back and
  // outward toward the tip. The gaps between them are the point.
  for (let i = 0; i < HAWK_PRIMARY_COUNT; i++) {
    const t = i / (HAWK_PRIMARY_COUNT - 1);
    // Rooted along the outer panel, from just inboard of the wrist to its end.
    const at = HAWK_WRIST_FRAC * 0.88 + (PANEL_END_FRAC - HAWK_WRIST_FRAC * 0.88) * t;
    const x = span * at;
    // Seated on the panel's trailing half so the quills are covered by it.
    const rootY = THREE.MathUtils.lerp(trailingAt(at) * 1.35, leadingAt(at) * 0.3, t * 0.55);
    // Angle measured from straight back toward straight outboard. The innermost
    // primary trails mostly backward and each one after it swings further out,
    // which is what opens the gaps between the fingers.
    const theta = THREE.MathUtils.degToRad(28) + HAWK_PRIMARY_SPLAY_RAD * t;
    const dir = new THREE.Vector2(Math.sin(theta), -Math.cos(theta));
    const len = chord * (1.24 - 0.28 * t);
    const z = seatZ + (i % 2 === 0 ? 0 : -1) * chord * HAWK_FEATHER_SHINGLE_FRAC;
    parts.push(buildHawkFeather([x, rootY, z], dir, len, chord * 0.16, 0.6));
  }

  return curveWing(mergePositionOnlyGeometries(parts));
}

/**
 * One flight feather: a flat tapered vane with a blunt, squared-off tip.
 *
 * Real flight feathers do not come to a needle point, and modelling them that
 * way makes a wing read as a row of spikes — a mistake already corrected once
 * on the small bird's tail. `tipFrac` is the tip's width as a fraction of the
 * base, so the primaries can finish narrower than the secondaries without
 * either of them becoming a spike.
 */
function buildHawkFeather(
  root: [number, number, number],
  dir: THREE.Vector2,
  length: number,
  halfWidth: number,
  tipFrac: number,
): THREE.BufferGeometry {
  // `perp` must not be derived in a way that ignores handedness — on the parrot
  // and small bird, a perpendicular whose x did not track the wing's side made
  // the outline cross itself and notched a wedge out of every feather. Here the
  // whole wing is mirrored as a finished mesh, so `dir` is always left-wing.
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const steps = 5;
  const positions: number[] = [];
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Widest a third of the way out, tapering to `tipFrac` at the tip.
    const w = halfWidth * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(t * 1.5, 1))) * THREE.MathUtils.lerp(1, tipFrac, t * t);
    const cx = root[0] + dir.x * length * t;
    const cy = root[1] + dir.y * length * t;
    ring.push([cx + perp.x * w, cy + perp.y * w, root[2]]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = halfWidth * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(t * 1.5, 1))) * THREE.MathUtils.lerp(1, tipFrac, t * t);
    const cx = root[0] + dir.x * length * t;
    const cy = root[1] + dir.y * length * t;
    ring.push([cx - perp.x * w, cy - perp.y * w, root[2]]);
  }
  for (let i = 1; i < ring.length - 1; i++) {
    positions.push(...ring[0], ...ring[i], ...ring[i + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

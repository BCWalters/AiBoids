import * as THREE from 'three';
import type { CreatureGeometries } from '../../../geometry/creatureGeometry';
import { mergeGeometriesWithColor, mergePositionOnlyGeometries, buildHookedBeakGeometry, buildEyeDotsGeometry } from '../../../geometry/creatureGeometry';
import { buildFingeredWingGeometry, buildTailGeometry } from '../../../geometry/birdGeometry';

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
// Yellow-orange talons matching the beak — classic raptor cere/talon color.
const TALONS_COLOR = new THREE.Color(0xe8a800);

export function createHawkGeometries(length: number, width: number): CreatureGeometries {
  const body = buildHawkBodyGeometry(length, width);

  // Broader, longer wings than the small-bird shape — a soaring raptor's
  // wings are proportionally larger relative to its body than a small
  // perching bird's — reusing the shared fingered-wing shape (already
  // reads as a bird of prey) rather than duplicating it.
  const wingSpan = length * 1.5;
  const wingChord = length * 0.68;
  const wingLeft = buildFingeredWingGeometry(wingSpan, wingChord, 1);
  const wingRight = buildFingeredWingGeometry(wingSpan, wingChord, -1);

  // Real bald eagle tails are white — handled for free via a plain
  // per-instance tail tint (see Renderer3D's NATURE_HAWK_COLORS), no
  // vertex-bake needed since the tail is already its own InstancedMesh
  // part.
  const tail = buildTailGeometry(length * 1.1, width, undefined, width * 0.9);
  const legs = buildHawkLegsGeometry(length, width);

  return { body, wingLeft, wingRight, tail, legs };
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
const HEAD_NARROW_SCALE = 0.75;
const HEAD_LENGTHEN_SCALE = 1.1;
const HEAD_START_FRAC = 0.4; // neck pinch
const HEAD_END_FRAC = HEAD_START_FRAC + (0.82 - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE; // face point (was faceY = halfLen*0.82)
// Extra narrowing on top of HEAD_NARROW_SCALE, specific to the hawk: even
// after the shared 25% head-narrow treatment, the hawk's head still read
// as noticeably wider/rounder than the sparrow/parrot heads once
// compared side-by-side (a raptor's head should be sleeker, not round).
const HEAD_EXTRA_NARROW = 0.82;

function buildHawkBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const headFrac = (frac: number) => HEAD_START_FRAC + (frac - HEAD_START_FRAC) * HEAD_LENGTHEN_SCALE;
  const faceRadius = width * 0.14 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW;
  const faceY = halfLen * HEAD_END_FRAC;
  const profile = [
    new THREE.Vector2(width * 0.04, -halfLen * 1.0), // tail tip
    new THREE.Vector2(width * 0.2, -halfLen * 0.68),
    new THREE.Vector2(width * 0.36, -halfLen * 0.22), // belly — bulkier than a songbird, but trimmed from an earlier too-fat pass
    new THREE.Vector2(width * 0.34, halfLen * 0.14), // chest/shoulders
    new THREE.Vector2(width * 0.16, halfLen * HEAD_START_FRAC), // neck pinch
    new THREE.Vector2(width * 0.3 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW, halfLen * headFrac(0.54)), // head base
    new THREE.Vector2(width * 0.32 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW, halfLen * headFrac(0.64)), // crown
    new THREE.Vector2(width * 0.24 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW, halfLen * headFrac(0.74)), // brow, just above the eyes
    new THREE.Vector2(faceRadius, faceY), // face, where the beak attaches
  ];
  // The torso/chest/neck portion of the profile stays the dark plumage
  // color; the head-base-onward portion (index 5+) is tinted white —
  // splitting the lathe into two color-tagged sub-geometries at that
  // seam (rather than one continuous lathe) so LatheGeometry's per-
  // vertex color can make a clean, deliberate torso/head color break
  // instead of a smooth (and thus muddy/gray) gradient between them.
  const torsoProfile = profile.slice(0, 6); // through head base
  const headProfile = profile.slice(5); // head base through face (shares the seam vertex)
  const torso = new THREE.LatheGeometry(torsoProfile, 14);
  const head = new THREE.LatheGeometry(headProfile, 14);

  // Straighter beak than a macaw's full curl — a bald eagle's beak is
  // mostly straight along its length with the hook concentrated right
  // at the tip, not curving continuously from the base. maxAngleDeg
  // controls the total curvature swept across the beak's spine, and
  // buildHookedBeakGeometry biases most of that curl toward the tip
  // already (angle grows with t^1.6), so a modest max angle reads as
  // "mostly straight, hooked tip" instead of the parrot's full hook.
  const beak = buildHookedBeakGeometry(faceY, faceRadius, length * 0.110, 28, 0.8);

  const eyeY = halfLen * headFrac(0.7);
  const eyeX = width * 0.24 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW;
  const eyeZ = width * 0.05 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW;
  const eyeRadius = width * 0.048 * HEAD_NARROW_SCALE * HEAD_EXTRA_NARROW;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: torso, color: TORSO_COLOR },
    { geometry: head, color: HEAD_COLOR },
    { geometry: beak, color: BEAK_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

/**
 * Short tucked legs with three forward-facing talons and one rear hallux,
 * baked in yellow-orange (matching the beak/cere). Positioned near the
 * tail end of the belly, close to the centerline — a raptor in flight
 * holds its feet tucked up under the body.
 */
function buildHawkLegsGeometry(length: number, width: number): THREE.BufferGeometry {
  const legRadius = width * 0.052;
  const legLength = length * 0.048;
  const toeLength = length * 0.082;
  // Back toward tail, matching where a real raptor's ankle sits.
  const footY = -length * 0.28;
  // Body surface radius at footY ≈ 0.242*width (interpolated from the
  // lathe profile between the two nearest control points at that Y).
  const hipZ = -width * 0.242;
  const footZ = hipZ - legLength * 0.9;

  const buildLeg = (side: 1 | -1): THREE.BufferGeometry => {
    const x = side * width * 0.001;
    const leg = new THREE.CylinderGeometry(legRadius * 0.82, legRadius, legLength, 6);
    leg.rotateX(Math.PI / 2);
    leg.translate(x, footY, hipZ - legLength * 0.5);

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

import * as THREE from 'three';
import type { CreatureGeometries } from './creatureGeometry';
import { mergeGeometriesWithColor, buildHookedBeakGeometry, buildEyeDotsGeometry } from './creatureGeometry';
import { buildFingeredWingGeometry, buildTailGeometry } from './birdGeometry';

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
  const tail = buildTailGeometry(length * 1.1, width);

  return { body, wingLeft, wingRight, tail };
}

/**
 * Broader-chested, more thickset torso than the small-bird shape (real
 * raptors are bulkier relative to their length), with a distinctly
 * separate white head region (baked, not just a lighter body tint), a
 * large yellow hooked beak, and near-black eyes.
 */
function buildHawkBodyGeometry(length: number, width: number): THREE.BufferGeometry {
  const halfLen = length * 0.5;
  const faceRadius = width * 0.14;
  const faceY = halfLen * 0.82;
  const profile = [
    new THREE.Vector2(width * 0.05, -halfLen * 1.0), // tail tip
    new THREE.Vector2(width * 0.28, -halfLen * 0.68),
    new THREE.Vector2(width * 0.5, -halfLen * 0.22), // broad belly — bulkier than a songbird
    new THREE.Vector2(width * 0.48, halfLen * 0.14), // broad chest/shoulders
    new THREE.Vector2(width * 0.18, halfLen * 0.4), // neck pinch
    new THREE.Vector2(width * 0.3, halfLen * 0.54), // head base
    new THREE.Vector2(width * 0.32, halfLen * 0.64), // crown
    new THREE.Vector2(width * 0.24, halfLen * 0.74), // brow, just above the eyes
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

  // Raptor beak: shallower hook than a macaw's (a real eagle's beak
  // curves down but not nearly as far under itself) — shared sweep
  // builder, different curvature/length tuning.
  const beak = buildHookedBeakGeometry(faceY, faceRadius, length * 0.22, 70, 0.8);

  const eyeY = halfLen * 0.7;
  const eyeX = width * 0.24;
  const eyeZ = width * 0.05;
  const eyeRadius = width * 0.048;
  const eyes = buildEyeDotsGeometry(eyeX, eyeY, eyeZ, eyeRadius);

  return mergeGeometriesWithColor([
    { geometry: torso, color: TORSO_COLOR },
    { geometry: head, color: HEAD_COLOR },
    { geometry: beak, color: BEAK_COLOR },
    { geometry: eyes, color: EYE_COLOR },
  ]);
}

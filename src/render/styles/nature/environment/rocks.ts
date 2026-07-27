import * as THREE from 'three';
import { mergePositionAndColorGeometries } from './shared';

export interface RockClusterDef {
  forwardX: number;
  forwardZ: number;
  distanceScale: number;
  sizeScale: number;
}

// Approximate outer radius of the authored cluster in its own local units,
// used by placeNatureEnvironment when sampling terrain across the cluster's
// footprint so the downhill edge doesn't float above sloped ground.
export const ROCK_CLUSTER_FOOTPRINT_RADIUS = 1.1;

// Angle-based helper (degrees, converted once at module load) — easier
// to reason about compass placement than raw forwardX/forwardZ pairs,
// while still producing the same shape of def the placement code below
// already expects for lakes.
function rockDef(angleDeg: number, distanceScale: number, sizeScale: number): RockClusterDef {
  const rad = THREE.MathUtils.degToRad(angleDeg);
  return { forwardX: Math.cos(rad), forwardZ: Math.sin(rad), distanceScale, sizeScale };
}

// Small boulder clusters scattered in two bands: just past each lake's
// far shoreline (real shorelines often expose rock right where the bank
// rises) and along the outer hillside approaching the mountain ring
// (real slopes shed scree/boulders as they steepen). Angles are chosen
// to stay well clear of the ocean's bay opening (roughly 345-130°, see
// OCEAN_GAP_ANGLE/OCEAN_GAP_HALF_WIDTH) so nothing appears to float on
// open water, and distanceScale keeps every cluster outside the play
// area (>= ~2) so they never clutter the flock's own airspace.
export const ROCK_CLUSTER_DEFS: RockClusterDef[] = [
  // Just past each lake's far shoreline, offset from the lake's own
  // compass angle so the rocks read as "past the water's edge" rather
  // than sitting on top of it.
  rockDef(216, 2.15, 0.3),
  rockDef(256, 2.15, 0.225),
  rockDef(130, 2.65, 0.25),
  rockDef(170, 2.65, 0.2),
  rockDef(300, 3.05, 0.225),
  rockDef(340, 3.05, 0.325),
  // Scattered along the outer hillside approaching the mountain ring.
  rockDef(130, 3.9, 0.35),
  rockDef(160, 4.1, 0.25),
  rockDef(195, 3.8, 0.375),
  rockDef(225, 4.15, 0.275),
  rockDef(255, 3.7, 0.3),
  rockDef(290, 4.0, 0.25),
  rockDef(320, 3.6, 0.325),
  rockDef(350, 3.9, 0.225),
];

// Two muted grey/brown tones blended per-boulder (see createRockCluster)
// for subtle natural variation — close to the ground shader's own
// ROCK_TINT (steep-slope color) so scattered boulders read as the same
// material as the bare-rock patches already visible on steep terrain.
const ROCK_COLOR_A = new THREE.Color(0x9a9184);
const ROCK_COLOR_B = new THREE.Color(0x6b6558);

/**
 * One low-poly boulder: a jittered icosahedron so it reads as a craggy,
 * irregular rock rather than a perfect gemstone facet (an undisturbed
 * icosahedron's regular symmetry is very recognizable at this low detail
 * level). flatShading on the shared material (see createRockCluster)
 * takes care of the faceted look; this only needs to break the
 * geometry's perfect symmetry.
 *
 * Detail=1 (80 faces vs the former 20) fills in silhouettes enough to
 * read as a genuine boulder without exploding triangle counts — each
 * cluster stays well under ~1 000 triangles even with 4 boulders.
 * A per-boulder y-squash factor (0.6–0.85) gives each stone a flat,
 * ground-settled profile that reads as weathered rock rather than a
 * perfect sphere.
 */
function buildBoulderGeometry(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  // Each boulder gets its own random y-squash so it looks wide and
  // settled rather than perfectly round.
  const ySquash = 0.6 + Math.random() * 0.25;
  for (let i = 0; i < position.count; i++) {
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    position.setXYZ(
      i,
      position.getX(i) * jitter,
      position.getY(i) * jitter * ySquash,
      position.getZ(i) * jitter,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Applies a subtle per-face brightness nudge to a vertex-colored, non-indexed
 * geometry (all three vertices of every face receive the same nudge so
 * flat-shading renders a uniform tint per face rather than a gradient).
 * Gives boulder surfaces a "stone grain" variation — different shades of
 * grey/brown on each facet — without requiring any texture assets.
 */
function applyFaceColorVariation(geometry: THREE.BufferGeometry, variance: number): void {
  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
  const faceCount = Math.floor(colorAttr.count / 3);
  for (let face = 0; face < faceCount; face++) {
    const nudge = (Math.random() - 0.5) * variance;
    for (let v = 0; v < 3; v++) {
      const vi = face * 3 + v;
      colorAttr.setXYZ(
        vi,
        THREE.MathUtils.clamp(colorAttr.getX(vi) + nudge, 0, 1),
        THREE.MathUtils.clamp(colorAttr.getY(vi) + nudge, 0, 1),
        THREE.MathUtils.clamp(colorAttr.getZ(vi) + nudge, 0, 1),
      );
    }
  }
  colorAttr.needsUpdate = true;
}

function randomRockColor(): THREE.Color {
  return ROCK_COLOR_A.clone().lerp(ROCK_COLOR_B, Math.random());
}

/**
 * A small, solid-feeling rock outcrop: one buried central core boulder,
 * several heavily-overlapping outer stones, a small top cap, and a broad
 * sunken base blob. Building the formation around an opaque core means any
 * residual surface pocket still reveals rock behind it rather than green
 * terrain through the whole mass.
 */
export function createRockCluster(): THREE.Mesh {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const coreRadius = 0.38 + Math.random() * 0.16;

  const coreGeometry = buildBoulderGeometry(coreRadius);
  coreGeometry.rotateY(Math.random() * Math.PI * 2);
  coreGeometry.translate(0, -coreRadius * 0.08, 0);
  parts.push({ geometry: coreGeometry, color: randomRockColor() });

  const baseGeometry = buildBoulderGeometry(coreRadius * (1.28 + Math.random() * 0.14));
  baseGeometry.scale(1.12, 0.42, 1.12);
  baseGeometry.rotateY(Math.random() * Math.PI * 2);
  baseGeometry.translate(0, -coreRadius * 0.62, 0);
  parts.push({ geometry: baseGeometry, color: randomRockColor() });

  const topGeometry = buildBoulderGeometry(coreRadius * (0.5 + Math.random() * 0.12));
  topGeometry.rotateY(Math.random() * Math.PI * 2);
  topGeometry.translate(
    (Math.random() - 0.5) * coreRadius * 0.18,
    coreRadius * (0.36 + Math.random() * 0.06),
    (Math.random() - 0.5) * coreRadius * 0.18,
  );
  parts.push({ geometry: topGeometry, color: randomRockColor() });

  const boulderCount = 3 + Math.floor(Math.random() * 2); // 3–4 outer stones
  const angleStep = (Math.PI * 2) / boulderCount;
  const angleBase = Math.random() * Math.PI * 2;
  for (let i = 0; i < boulderCount; i++) {
    const radius = coreRadius * (0.58 + Math.random() * 0.24);
    const geometry = buildBoulderGeometry(radius);
    geometry.rotateY(Math.random() * Math.PI * 2);
    const offsetAngle = angleBase + angleStep * i + (Math.random() - 0.5) * angleStep * 0.28;
    // Offset from the shared core, not from each boulder's own radius, so
    // every outer stone interpenetrates the center mass instead of merely
    // brushing its neighbors and leaving open windows through the cluster.
    const offsetDist = Math.min(radius, coreRadius) * (0.32 + Math.random() * 0.12);
    // Sink the outer stones slightly into the core/base so the cluster reads
    // as a half-buried formation rather than separate rocks balanced on grass.
    const lift = coreRadius * (0.03 + Math.random() * 0.06) - radius * (0.12 + Math.random() * 0.1);
    geometry.translate(Math.cos(offsetAngle) * offsetDist, lift, Math.sin(offsetAngle) * offsetDist);
    parts.push({ geometry, color: randomRockColor() });
  }
  const merged = mergePositionAndColorGeometries(parts);
  parts.forEach((p) => p.geometry.dispose());
  // Stone-grain per-face tint variation on the merged geometry.
  applyFaceColorVariation(merged, 0.06);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    // DoubleSide renders back-faces, eliminating any residual see-through
    // seam at the boundary where adjacent boulders meet.
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(merged, material);
}

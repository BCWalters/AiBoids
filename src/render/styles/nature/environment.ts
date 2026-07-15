import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { TimeOfDayPreset } from '../../../sim/params';

/**
 * "Nature" style environment: a physically-based sky dome (with a
 * built-in procedural drifting-cloud layer baked into its shader) plus a
 * textured ground plane. Both are cheap — no external image assets — and
 * only added to the scene / made visible when visualStyle is 'nature'.
 */
export interface NatureEnvironment {
  sky: Sky;
  ground: THREE.Mesh;
  mountains: THREE.Mesh;
  /** Several small lake patches, each independently sized/placed and
   * height-matched to the terrain directly beneath it (see
   * placeNatureEnvironment) so none of them appear to float. */
  lakes: THREE.Mesh[];
  /** A much larger sea extending toward the horizon, visible through a
   * deliberate gap/bay in the mountain ring (see createMountainRing). */
  ocean: THREE.Mesh;
  /** A narrow tan sand strip tracking the ocean's shoreline (see
   * createBeachStrip), sharing the exact same coastline jitter as the
   * ocean mesh so the two edges align precisely. */
  beach: THREE.Mesh;
  /** Small clusters of low-poly boulders scattered past the lakes'
   * shorelines and along the outer hillside (see ROCK_CLUSTER_DEFS),
   * each height-matched to the terrain beneath it like the lakes. */
  rocks: THREE.Mesh[];
  /** Sparse forest patches (see FOREST_PATCH_DEFS) tucked between the
   * play area and the rock/hillside bands. Each is a Group pairing a
   * flat, painted-canopy "undergrowth" disc (see createForestLitter)
   * with a merged cluster of many small rounded canopy volumes (see
   * createForestCrowns) so the patch reads as an actual bumpy mass of
   * treetops — rather than a flat cutout — from any viewing angle,
   * height-matched to the terrain like the lakes/rocks. */
  forestPatches: THREE.Group[];
  sunLight: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  /** Larger, softer glow sprite rendered behind the sun disc for a warm corona effect. */
  sunHalo: THREE.Sprite;
  lightShafts: THREE.Sprite[];
  /** Unit vector pointing from the world toward the sun. */
  sunDirection: THREE.Vector3;
  fog: THREE.Fog;
  /** Call once per frame while nature style is active to animate clouds. */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall nature-style visibility. */
  setFogEnabled(enabled: boolean): void;
  setTimeOfDay(preset: TimeOfDayPreset): void;
  setLightShaftsEnabled(enabled: boolean): void;
  dispose(): void;
}

// The mountain ring has a deliberate gap/bay opening in this fixed
// direction (in the ring's own unscaled local space, so it always shows
// up in the same world-relative compass direction regardless of world
// size) through which the much-larger ocean plane is visible — reads as
// "the hills part around a sea inlet" rather than a random flat patch.
// Placed opposite the small lake's forward direction (see
// placeNatureEnvironment) so the two water features don't visually compete.
const OCEAN_GAP_ANGLE = Math.atan2(0.83, 0.55);
const OCEAN_GAP_HALF_WIDTH = 0.5; // radians, ~29° half-width (~57° full notch)

// Several small lakes rather than just one, each in its own compass
// direction (forwardX/forwardZ, a unit-ish vector) at its own distance
// and size — chosen to stay well clear of both the ocean's bay opening
// (~28-85° around OCEAN_GAP_ANGLE) and each other. distanceScale/sizeScale
// multiply flockScale exactly like the original single lake did.
const LAKE_DEFS = [
  { forwardX: -0.55, forwardZ: -0.83, distanceScale: 1.8, sizeScale: 0.55 },
  { forwardX: -0.87, forwardZ: 0.5, distanceScale: 2.3, sizeScale: 0.4 },
  { forwardX: 0.77, forwardZ: -0.64, distanceScale: 2.7, sizeScale: 0.35 },
];

interface RockClusterDef {
  forwardX: number;
  forwardZ: number;
  distanceScale: number;
  sizeScale: number;
}

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
// to stay well clear of the ocean's bay opening (~10-105°, see
// OCEAN_GAP_ANGLE/OCEAN_GAP_HALF_WIDTH) so nothing appears to float on
// open water, and distanceScale keeps every cluster outside the play
// area (>= ~2) so they never clutter the flock's own airspace.
const ROCK_CLUSTER_DEFS: RockClusterDef[] = [
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
 */
function buildBoulderGeometry(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    position.setXYZ(i, position.getX(i) * jitter, position.getY(i) * jitter, position.getZ(i) * jitter);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A minimal geometry+color merge (position and color attributes only —
 * adequate for a flat-colored, textureless MeshStandardMaterial), mirroring
 * mergePositionOnlyGeometries in birdGeometry.ts but also carrying a
 * per-source-geometry solid color into a vertex color attribute. Avoids
 * THREE's stricter BufferGeometryUtils.mergeGeometries(), which requires
 * every input to share identical attribute sets already.
 */
function mergePositionAndColorGeometries(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const { geometry, color } of parts) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = nonIndexed.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  merged.computeVertexNormals();
  return merged;
}

/**
 * A small cluster of 2-3 boulders grouped around a shared origin (rather
 * than a single boulder per cluster def) so each rock formation reads as
 * an irregular outcrop instead of one obviously-lone rock. Built once in
 * "cluster-local" units and later uniformly positioned/scaled per
 * ROCK_CLUSTER_DEFS entry in placeNatureEnvironment, exactly like
 * createWaterPatch's lakes.
 */
function createRockCluster(): THREE.Mesh {
  const boulderCount = 2 + Math.floor(Math.random() * 2); // 2-3
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (let i = 0; i < boulderCount; i++) {
    const radius = 0.2 + Math.random() * 0.35;
    const geometry = buildBoulderGeometry(radius);
    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = i === 0 ? 0 : radius * (0.6 + Math.random() * 0.6);
    // Lift each boulder's center only partway above its own radius so
    // the lower portion sits embedded in the terrain rather than
    // perched exactly on top of it — reads as a real half-buried rock
    // instead of a pebble resting on the grass.
    const lift = radius * (0.25 + Math.random() * 0.25);
    geometry.translate(Math.cos(offsetAngle) * offsetDist, lift, Math.sin(offsetAngle) * offsetDist);
    geometry.rotateY(Math.random() * Math.PI * 2);
    const color = ROCK_COLOR_A.clone().lerp(ROCK_COLOR_B, Math.random());
    parts.push({ geometry, color });
  }
  const merged = mergePositionAndColorGeometries(parts);
  parts.forEach((p) => p.geometry.dispose());
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });
  return new THREE.Mesh(merged, material);
}

interface ForestPatchDef {
  forwardX: number;
  forwardZ: number;
  distanceScale: number;
  sizeScale: number;
}

function forestPatchDef(angleDeg: number, distanceScale: number, sizeScale: number): ForestPatchDef {
  const rad = THREE.MathUtils.degToRad(angleDeg);
  return { forwardX: Math.cos(rad), forwardZ: Math.sin(rad), distanceScale, sizeScale };
}

// Sparse forest patches tucked between the play area and the outer
// rock/hillside bands — real tree cover tends to grow in patches rather
// than spread evenly. Positions were chosen (and checked against
// LAKE_DEFS' own center + radius, in these same distanceScale-equivalent
// units) to clear every lake's shoreline by a healthy margin — an
// earlier pass placed a couple of patches close enough to a lake's own
// angle that they visibly overlapped the water. Angles avoid the
// ocean's bay opening (~10-105°, see OCEAN_GAP_ANGLE/OCEAN_GAP_HALF_WIDTH).
//
// sizeScale was originally tiered up to ~2.08 (bigger than the mountain
// ring's own inner radius of 5.4!) — direct visual QA showed the
// biggest "groves" reading as an absurdly oversized wall of foliage that
// dwarfed the mountains instead of sitting believably small in front of
// them, like real tree cover does against a real mountain range. A first
// fix uniformly scaled every tier down by the same ~7-8x factor, but
// that shrank the already-reasonably-sized small-copse tier down into
// nearly invisible specks too — the actual ask was to compress the
// *larger* tiers down toward the small tier's existing (already good)
// size, not shrink everything uniformly. The small-copse tier below is
// therefore unchanged from the original values; medium/large/sprawling
// are compressed to sit just above it instead of dwarfing it.
const FOREST_PATCH_DEFS: ForestPatchDef[] = [
  // Small copses, close to the play area — unchanged from the original
  // sizing, since this tier already read as an appropriately small
  // patch of trees relative to the mountains.
  forestPatchDef(184.3, 2.16, 0.199),
  forestPatchDef(109.2, 1.81, 0.201),
  forestPatchDef(347.3, 2.18, 0.182),
  forestPatchDef(5.4, 2.09, 0.126),
  forestPatchDef(186.9, 2.17, 0.17),
  // Medium patches — only a little larger than the small-copse tier now.
  forestPatchDef(359.2, 3.4, 0.26),
  forestPatchDef(104.1, 2.56, 0.25),
  forestPatchDef(344.9, 3.26, 0.21),
  forestPatchDef(280.3, 2.74, 0.22),
  forestPatchDef(119.7, 3.37, 0.245),
  // Large groves.
  forestPatchDef(349.5, 4.4, 0.31),
  forestPatchDef(278.2, 3.93, 0.305),
  forestPatchDef(266.2, 4.54, 0.29),
  forestPatchDef(201.4, 4.45, 0.335),
  // Sprawling forests (biggest tier — still deliberately kept close to
  // the small-copse tier's own size, unlike the old ~2x tier, so even
  // the largest patch of trees reads as small against the mountains).
  forestPatchDef(197.1, 5.47, 0.39),
  forestPatchDef(6.9, 5.48, 0.4),
];

// Smallest/largest sizeScale actually authored above — used to
// normalize crown density in createForestCrowns without hardcoding
// these numbers twice. Update this if FOREST_PATCH_DEFS's range changes.
const FOREST_SIZE_SCALE_RANGE: [number, number] = [0.126, 0.4];

/**
 * Random irregular-blob shape descriptor shared by both halves of a
 * forest patch (the flat ground-hugging litter disc and the scattered
 * canopy crowns above it) so the two line up over the same footprint
 * instead of drifting apart. Layered sine "lobes" (a handful of random
 * harmonics/phases) give the outline a few bulges and inlets instead of
 * reading as a slightly bumpy circle — this matters much more once
 * patches get large, where a merely-bumpy circle still reads as "a
 * circle" rather than an organic forest-cover shape. A random elongation
 * + rotation on top further breaks any circular symmetry.
 */
interface PatchShape {
  lobes: { k: number; amp: number; phase: number }[];
  stretchX: number;
  stretchZ: number;
  stretchRot: number;
}

function createPatchShape(): PatchShape {
  const lobeCount = 2 + Math.floor(Math.random() * 3); // 2-4 harmonics
  const lobes: { k: number; amp: number; phase: number }[] = [];
  for (let i = 0; i < lobeCount; i++) {
    lobes.push({
      k: 2 + Math.floor(Math.random() * 4), // harmonic order 2-5
      amp: 0.06 + Math.random() * 0.14,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return {
    lobes,
    stretchX: 0.8 + Math.random() * 0.45,
    stretchZ: 0.8 + Math.random() * 0.45,
    stretchRot: Math.random() * Math.PI * 2,
  };
}

/** Pre-stretch radius of the lobed disc at a given polar angle. */
function patchBaseRadiusAt(shape: PatchShape, angle: number): number {
  let lobeSum = 0;
  for (const lobe of shape.lobes) lobeSum += lobe.amp * Math.sin(lobe.k * angle + lobe.phase);
  return Math.max(0.35, 0.85 + lobeSum);
}

/** Maps a pre-stretch local (x, y) into the shape's final elongated/rotated footprint coordinates. */
function applyPatchStretch(shape: PatchShape, x: number, y: number): [number, number] {
  const rotX = x * Math.cos(shape.stretchRot) - y * Math.sin(shape.stretchRot);
  const rotY = x * Math.sin(shape.stretchRot) + y * Math.cos(shape.stretchRot);
  return [rotX * shape.stretchX, rotY * shape.stretchZ];
}

/**
 * A flat, only slightly raised irregular disc with a painted canopy
 * texture, sitting right at ground level beneath the 3D canopy crowns
 * (see createForestCrowns) — reads as shadowed undergrowth/leaf-litter
 * filling the gaps between crowns rather than bare grass, without the
 * cost of actually modeling it. Reuses the same irregular-outline + soft
 * alpha-feathered edge technique as createWaterPatch so it blends into
 * the surrounding grass instead of showing a hard border. Kept slightly
 * smaller than the crown scatter's own footprint (see createForestCrowns)
 * so its edge never peeks out past the crowns above it.
 */
function createForestLitter(shape: PatchShape): THREE.Mesh {
  const segments = 40;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  positions.push(0, 0, (Math.random() - 0.5) * 0.08);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    // Shrunk slightly (0.85x) plus its own light per-vertex jitter so
    // this undergrowth layer stays safely tucked inside the crown
    // scatter's footprint rather than matching it exactly.
    const r = patchBaseRadiusAt(shape, angle) * 0.85 * (0.92 + Math.random() * 0.16);
    const [x, y] = applyPatchStretch(shape, Math.cos(angle) * r, Math.sin(angle) * r);
    // Small random height jitter — "very slightly raised", just enough
    // to catch a bit of directional light unevenly rather than reading
    // as a perfectly flat painted disc.
    const z = (Math.random() - 0.5) * 0.08;
    positions.push(x, y, z);
    uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % segments));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: createForestCanopyTexture(),
    alphaMap: createForestAlphaTexture(),
    transparent: true,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
    // Same z-fighting safety margin as the lake water patches, nudging
    // this just toward the camera relative to the ground beneath it.
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    // A gentle darken relative to the painted texture's own tones so this
    // reads as slightly shaded ground beneath the canopy crowns above it
    // — kept close to white rather than a strong tint, since the texture
    // is already quite dark and an aggressive multiply crushed it down
    // to a near-black smudge that looked more like a shadow hole than
    // shaded undergrowth. Pulled down a little further from its first
    // pass to stay in step with the crowns above also being darkened.
    color: new THREE.Color(0xc3c9b7),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// Muted green/olive tones for individual canopy crowns — close to (but a
// separate palette from) the flat litter texture's own tones, so the 3D
// crowns above and the painted ground layer beneath them read as the
// same kind of foliage rather than two different materials. Darkened
// from an earlier, noticeably brighter palette (direct feedback: the
// forest patches read too light on average) and biased toward the
// darker end by including an extra deep-shadow tone, rather than an
// even brighter/darker split, so most crowns land on the muted side
// with only occasional lighter highlights.
const CROWN_TONES: THREE.Color[] = [
  new THREE.Color(0x2f4726),
  new THREE.Color(0x3a562b),
  new THREE.Color(0x466832),
  new THREE.Color(0x21321b),
  new THREE.Color(0x4b6d35),
  new THREE.Color(0x24341c),
];

/**
 * One rounded, low-poly "canopy crown" volume — a jittered, vertically
 * squashed icosahedron (same jitter technique as buildBoulderGeometry)
 * standing in for a single tree or small clump of treetops. Having many
 * of these scattered and merged together (see createForestCrowns) gives
 * the forest patch real silhouette volume, so it reads as a bumpy mass
 * of foliage from any angle instead of a razor-flat painted disc whose
 * straight polygon-outline edges become visible as unnatural sharp
 * cutouts when viewed near edge-on.
 */
function buildCrownGeometry(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const jitter = 1 + (Math.random() - 0.5) * 0.55;
    position.setXYZ(
      i,
      position.getX(i) * jitter,
      // Squash vertically so crowns read as rounded foliage masses
      // rather than perfect spheres/gemstones.
      position.getY(i) * jitter * 0.72,
      position.getZ(i) * jitter,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Scatters many small rounded canopy-crown volumes across the patch's
 * own irregular footprint (see PatchShape) and merges them into a single
 * mesh, exactly like createRockCluster does for boulders. Crown count
 * scales with the patch's own sizeScale (linearly interpolated across
 * FOREST_PATCH_DEFS's authored sizeScale range — see
 * FOREST_SIZE_SCALE_RANGE) so small copses get a sparse handful of
 * crowns while sprawling groves get a dense, tree-line-like mass of them.
 *
 * Each crown's height follows the *actual* local terrain beneath its own
 * position (sampled via terrainHeightAt at that crown's real-world
 * offset from the patch's anchor point) rather than inheriting one flat
 * height for the whole patch — the old flat single-height disc could let
 * the real terrain poke up through it wherever the ground rose within a
 * large patch's footprint, since the ground mesh's own fine 200-segment
 * grid would then clip through the flat plane along a straight edge.
 * Sampling per-crown avoids that entirely, in addition to fixing the
 * flat-silhouette problem above.
 */
function createForestCrowns(shape: PatchShape, def: ForestPatchDef): THREE.Mesh {
  // A straight sizeScale^2 (area) scaling made sense back when sizeScale
  // spanned a huge ~0.13-2.08 range, but after rescaling FOREST_PATCH_DEFS
  // down ~7-8x (see its own comment) that same formula would clamp almost
  // every patch to the minimum crown count, losing the small/medium/
  // large/sprawling density variety entirely. Interpolating linearly
  // across the actual authored sizeScale range instead keeps that same
  // relative variety regardless of the absolute scale chosen.
  const t = THREE.MathUtils.clamp(
    (def.sizeScale - FOREST_SIZE_SCALE_RANGE[0]) / (FOREST_SIZE_SCALE_RANGE[1] - FOREST_SIZE_SCALE_RANGE[0]),
    0,
    1,
  );
  const crownCount = Math.round(THREE.MathUtils.lerp(9, 130, t));

  const fxBase = def.forwardX * def.distanceScale;
  const fyBase = def.forwardZ * def.distanceScale;
  const baseTerrain = terrainHeightAt(fxBase, fyBase);

  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (let i = 0; i < crownCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const maxR = patchBaseRadiusAt(shape, angle);
    // sqrt(random) keeps points roughly area-uniform across the disc
    // instead of clustering near the center.
    const r = Math.sqrt(Math.random()) * maxR;
    const [x, y] = applyPatchStretch(shape, Math.cos(angle) * r, Math.sin(angle) * r);

    // A minority of larger "canopy giant" crowns give the patch some
    // structure/height variation; the rest are smaller fill crowns that
    // pack in the gaps between them — real forest cover has a similar
    // mix of taller emergent trees and a lower, denser understory.
    const isGiant = Math.random() < 0.28;
    const radius = isGiant ? 0.12 + Math.random() * 0.09 : 0.05 + Math.random() * 0.07;

    // See createForestCrowns's own doc comment: local mesh (x, y) here
    // maps to a world-space offset of (x * sizeScale, -y * sizeScale)
    // flock-scale units from the patch's anchor point once the whole
    // mesh is later rotated -90° about X and scaled (matching the same
    // local-axis mapping createGroundGeometry relies on) — used to
    // sample this crown's own real terrain height rather than the
    // patch's single anchor height.
    const fx = fxBase + x * def.sizeScale;
    const fy = fyBase - y * def.sizeScale;
    const localHeight = (terrainHeightAt(fx, fy) - baseTerrain) / def.sizeScale;
    // Mostly above ground with only a small embedded base, like a bush
    // or low tree crown rather than a ball resting on top of the grass.
    const lift = radius * (0.55 + Math.random() * 0.35);

    const geometry = buildCrownGeometry(radius);
    geometry.translate(x, y, localHeight + lift);
    geometry.rotateZ(Math.random() * Math.PI * 2);
    const color = CROWN_TONES[Math.floor(Math.random() * CROWN_TONES.length)].clone();
    parts.push({ geometry, color });
  }

  const merged = mergePositionAndColorGeometries(parts);
  parts.forEach((p) => p.geometry.dispose());
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/**
 * Builds one full forest patch: the flat ground-hugging litter disc plus
 * the merged canopy-crown volumes above it (see createForestLitter /
 * createForestCrowns), grouped together so callers can position/scale/
 * toggle-visibility on the pair as a single unit exactly like the other
 * environment features (lakes, rocks) do with a single Mesh.
 */
function createForestPatch(def: ForestPatchDef): THREE.Group {
  const shape = createPatchShape();
  const group = new THREE.Group();
  group.add(createForestLitter(shape), createForestCrowns(shape, def));
  return group;
}

/**
 * Paints a mottled treetop-canopy look (viewed roughly from above) as a
 * canvas texture: a dark base fill plus many overlapping soft blobs in
 * a handful of muted green tones (standing in for individual tree
 * crowns) and a few small darker "gap" blobs for a bit of depth between
 * them — no actual 3D tree geometry needed.
 */
function createForestCanopyTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(42,63,34)';
  ctx.fillRect(0, 0, size, size);

  const tones: Array<[number, number, number]> = [
    [63, 94, 51],
    [77, 114, 57],
    [93, 138, 66],
    [44, 67, 36],
  ];
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.07 + Math.random() * 0.16);
    const [rr, gg, bb] = tones[Math.floor(Math.random() * tones.length)];
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${rr},${gg},${bb},0.9)`);
    gradient.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  // A few small dark gaps between crowns for a bit of depth.
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.02 + Math.random() * 0.035);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(12,22,9,0.55)');
    gradient.addColorStop(1, 'rgba(12,22,9,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Without this, three.js treats the canvas's raw sRGB pixel values as
  // linear color data and the canopy reads as a washed-out, nearly flat
  // pale tint instead of the painted mottled greens (same fix already
  // applied to the ground diffuse texture elsewhere in this file).
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft radial falloff so the forest patch's edge feathers into the
 * surrounding grass instead of cutting off sharply — same technique as
 * createWaterAlphaTexture. */
function createForestAlphaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.85, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface TimeOfDaySettings {
  elevationDeg: number;
  azimuthDeg: number;
  skyTurbidity: number;
  skyRayleigh: number;
  skyMie: number;
  sunColor: number;
  sunIntensity: number;
  sunSpriteScale: number;
  sunHaloScale: number;
  fogColor: number;
  lakeColor: number;
  lakeOpacity: number;
}

const TIME_OF_DAY_SETTINGS: Record<TimeOfDayPreset, TimeOfDaySettings> = {
  dawn: {
    elevationDeg: 14,
    azimuthDeg: 112,
    skyTurbidity: 4.5,
    skyRayleigh: 1.9,
    skyMie: 0.008,
    sunColor: 0xffd1a8,
    sunIntensity: 1.1,
    sunSpriteScale: 5600,
    sunHaloScale: 7600,
    fogColor: 0xffdfc6,
    lakeColor: 0x336f92,
    lakeOpacity: 0.86,
  },
  noon: {
    elevationDeg: 52,
    azimuthDeg: 148,
    skyTurbidity: 2.4,
    skyRayleigh: 1.1,
    skyMie: 0.006,
    sunColor: 0xfff4df,
    sunIntensity: 1.8,
    sunSpriteScale: 4800,
    sunHaloScale: 6200,
    fogColor: 0xf2f5f4,
    lakeColor: 0x2f698b,
    lakeOpacity: 0.9,
  },
  sunset: {
    elevationDeg: 12,
    azimuthDeg: 240,
    skyTurbidity: 5.2,
    skyRayleigh: 2.2,
    skyMie: 0.009,
    sunColor: 0xffaf7c,
    sunIntensity: 1.2,
    sunSpriteScale: 5800,
    sunHaloScale: 8000,
    fogColor: 0xffceb2,
    lakeColor: 0x2f6484,
    lakeOpacity: 0.82,
  },
  night: {
    elevationDeg: -8,
    azimuthDeg: 210,
    skyTurbidity: 1.8,
    skyRayleigh: 0.45,
    skyMie: 0.004,
    sunColor: 0xa9b8ff,
    sunIntensity: 0.18,
    sunSpriteScale: 3400,
    sunHaloScale: 4600,
    fogColor: 0x1c2537,
    lakeColor: 0x21465d,
    lakeOpacity: 0.78,
  },
};

export function createNatureEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): NatureEnvironment {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 2.5;
  skyUniforms.rayleigh.value = 1.2;
  skyUniforms.mieCoefficient.value = 0.006;
  skyUniforms.mieDirectionalG.value = 0.8;
  skyUniforms.cloudCoverage.value = 0.4;
  skyUniforms.cloudDensity.value = 0.45;
  skyUniforms.cloudScale.value = 0.0009;
  // Slow, believable drift — the previous 0.02 crossed the whole sky in a
  // few seconds; 0.0015 was still too fast, so this is another ~6x down,
  // more like real high-altitude clouds drifting over many minutes.
  skyUniforms.cloudSpeed.value = 0.00025;
  // The Sky shader bakes in its own physically-angled sun disc, rendered
  // directly onto the (camera-independent, direction-only) sky dome. We
  // already draw our own custom sun sprite + halo at a finite world
  // distance for a bigger/warmer look — having both visible at once
  // caused a confusing second "white circle" that appears to drift
  // independently of our sprite as the camera orbits (the shader's disc
  // has zero parallax since it's direction-locked, while our sprite/halo
  // are finite-distance points that do shift slightly with the camera).
  skyUniforms.showSunDisc.value = 0;

  const SUN_DISTANCE = 15000; // inside the 20000-radius sky dome
  const sunDirection = new THREE.Vector3();
  skyUniforms.sunPosition.value.copy(sunDirection);

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sunLight.position.copy(sunDirection).multiplyScalar(1000);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.radius = 4;

  // The Sky shader technically has a sun disc (showSunDisc uniform), but
  // its physically-accurate angular size is only a couple of screen
  // pixels — easy to miss entirely. A simple additive glow sprite makes
  // the light source in the sky actually visible. A larger, much softer
  // halo sprite sits just behind it (rendered first, further away) to
  // give the sun a warm corona/radiance instead of a hard-edged coin.
  const sunHalo = new THREE.Sprite(createSunHaloMaterial());
  sunHalo.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE - 50);
  sunHalo.scale.setScalar(6600);

  const sunSprite = new THREE.Sprite(createSunMaterial());
  sunSprite.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.setScalar(5200);
  const shaftMaterial = createSunHaloMaterial();
  shaftMaterial.opacity = 0.1;
  shaftMaterial.color.setHex(0xffe4c2);
  const lightShafts = Array.from({ length: 3 }, () => {
    const shaft = new THREE.Sprite(shaftMaterial.clone());
    shaft.visible = true;
    return shaft;
  });

  const ground = new THREE.Mesh(createGroundGeometry(), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  (ground.material as THREE.MeshStandardMaterial).vertexColors = true;
  configureGroundTexture(ground.material as THREE.MeshStandardMaterial, renderer);

  // A jagged, low-poly mountain range encircling the horizon and a lake
  // patch off in the distance — cheap (a few hundred triangles total,
  // one shared flat-shaded material each) but they break up what would
  // otherwise be an infinite flat plain.
  const mountains = createMountainRing(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  mountains.castShadow = true;
  mountains.receiveShadow = true;
  const lakes = LAKE_DEFS.map(() => createWaterPatch());
  // Keep lake water from turning into near-black blotches under dense
  // moving flock shadows; reflective water reads better with direct/fog
  // lighting and env-map response, without receiving hard cast shadows.
  lakes.forEach((lake) => {
    lake.receiveShadow = false;
  });
  const { ocean, beach } = createOceanPatch(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  ocean.receiveShadow = true;
  beach.receiveShadow = true;
  const rocks = ROCK_CLUSTER_DEFS.map(() => createRockCluster());
  rocks.forEach((rock) => {
    rock.castShadow = true;
    rock.receiveShadow = true;
  });
  const forestPatches = FOREST_PATCH_DEFS.map((def) => createForestPatch(def));
  forestPatches.forEach((patch) => {
    patch.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  });

  // Pale horizon haze color (roughly matches this sky configuration's
  // horizon tone) — blended in via fog so the ground plane fades smoothly
  // into the sky instead of showing a hard, distracting edge.
  const fog = new THREE.Fog(0xf2f5f4, 1, 2);
  let fogEnabled = true;
  let shaftsEnabled = true;
  let sunDiscVisibleByTime = true;

  const applyTimeOfDay = (preset: TimeOfDayPreset): void => {
    const settings = TIME_OF_DAY_SETTINGS[preset];
    const elevation = THREE.MathUtils.degToRad(settings.elevationDeg);
    const azimuth = THREE.MathUtils.degToRad(settings.azimuthDeg);
    sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    skyUniforms.sunPosition.value.copy(sunDirection);
    skyUniforms.turbidity.value = settings.skyTurbidity;
    skyUniforms.rayleigh.value = settings.skyRayleigh;
    skyUniforms.mieCoefficient.value = settings.skyMie;
    sunLight.color.setHex(settings.sunColor);
    sunLight.intensity = settings.sunIntensity;
    sunLight.position.copy(sunDirection).multiplyScalar(1000);
    sunSprite.scale.setScalar(settings.sunSpriteScale);
    sunHalo.scale.setScalar(settings.sunHaloScale);
    sunSprite.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
    sunHalo.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE - 50);
    sunDiscVisibleByTime = preset !== 'night';
    sunSprite.visible = sky.visible && sunDiscVisibleByTime;
    sunHalo.visible = sky.visible && sunDiscVisibleByTime;
    fog.color.setHex(settings.fogColor);
    lakes.forEach((lake) => {
      const lakeMaterial = lake.material as THREE.MeshPhongMaterial;
      lakeMaterial.color.setHex(settings.lakeColor);
      lakeMaterial.opacity = settings.lakeOpacity;
    });
    lightShafts.forEach((shaft, i) => {
      shaft.material.color.setHex(settings.sunColor);
      shaft.scale.setScalar(settings.sunHaloScale * (0.55 + i * 0.23));
      const distance = SUN_DISTANCE * (0.35 + i * 0.16);
      shaft.position.copy(sunDirection).multiplyScalar(distance);
      shaft.material.opacity = preset === 'night' ? 0.02 : 0.12 - i * 0.025;
    });
  };
  applyTimeOfDay('noon');

  scene.add(sky, ground, mountains, ...lakes, ocean, beach, ...rocks, ...forestPatches, sunLight, sunHalo, sunSprite, ...lightShafts);
  sky.visible = false;
  ground.visible = false;
  mountains.visible = false;
  lakes.forEach((lake) => { lake.visible = false; });
  ocean.visible = false;
  beach.visible = false;
  rocks.forEach((rock) => { rock.visible = false; });
  forestPatches.forEach((patch) => { patch.visible = false; });
  sunLight.visible = false;
  sunHalo.visible = false;
  sunSprite.visible = false;
  lightShafts.forEach((shaft) => { shaft.visible = false; });

  return {
    sky,
    ground,
    mountains,
    lakes,
    ocean,
    beach,
    rocks,
    forestPatches,
    sunLight,
    sunSprite,
    sunHalo,
    lightShafts,
    sunDirection,
    fog,
    update(elapsed: number) {
      skyUniforms.time.value = elapsed;
    },
    setVisible(visible: boolean) {
      sky.visible = visible;
      ground.visible = visible;
      mountains.visible = visible;
      lakes.forEach((lake) => { lake.visible = visible; });
      ocean.visible = visible;
      beach.visible = visible;
      rocks.forEach((rock) => { rock.visible = visible; });
      forestPatches.forEach((patch) => { patch.visible = visible; });
      sunHalo.visible = visible && sunDiscVisibleByTime;
      sunLight.visible = visible;
      sunSprite.visible = visible && sunDiscVisibleByTime;
      lightShafts.forEach((shaft) => {
        shaft.visible = visible && shaftsEnabled;
      });
      // Only actually attach fog if the environment is both visible AND
      // fog hasn't been independently disabled via setFogEnabled — track
      // the "should fog be on" intent by checking whether it's currently
      // attached (setFogEnabled sets it null when off).
      scene.fog = visible && fogEnabled ? fog : null;
    },
    setFogEnabled(enabled: boolean) {
      fogEnabled = enabled;
      // Guarded by sky.visible so this only touches scene.fog while nature
      // is the active style — Renderer3D calls setFogEnabled on both
      // environments every frame regardless of which is active, and
      // unconditionally assigning here would clobber whichever fog the
      // other (currently-visible) environment just set.
      if (sky.visible) scene.fog = enabled ? fog : null;
    },
    setTimeOfDay(preset: TimeOfDayPreset) {
      applyTimeOfDay(preset);
    },
    setLightShaftsEnabled(enabled: boolean) {
      shaftsEnabled = enabled;
      lightShafts.forEach((shaft) => {
        shaft.visible = sky.visible && enabled;
      });
    },
    dispose() {
      scene.remove(sky, ground, mountains, ...lakes, ocean, beach, ...rocks, ...forestPatches, sunLight, sunHalo, sunSprite, ...lightShafts);
      if (scene.fog === fog) scene.fog = null;
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.MeshStandardMaterial).map?.dispose();
      (ground.material as THREE.MeshStandardMaterial).normalMap?.dispose();
      (ground.material as THREE.MeshStandardMaterial).roughnessMap?.dispose();
      (ground.material as THREE.Material).dispose();
      mountains.geometry.dispose();
      (mountains.material as THREE.Material).dispose();
      for (const lake of lakes) {
        lake.geometry.dispose();
        (lake.material as THREE.MeshStandardMaterial).alphaMap?.dispose();
        (lake.material as THREE.Material).dispose();
      }
      ocean.geometry.dispose();
      (ocean.material as THREE.Material).dispose();
      beach.geometry.dispose();
      (beach.material as THREE.Material).dispose();
      for (const rock of rocks) {
        rock.geometry.dispose();
        (rock.material as THREE.Material).dispose();
      }
      for (const patch of forestPatches) {
        for (const child of patch.children) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.map?.dispose();
          material.alphaMap?.dispose();
          material.dispose();
        }
      }
      (sunHalo.material as THREE.SpriteMaterial).map?.dispose();
      (sunHalo.material as THREE.Material).dispose();
      (sunSprite.material as THREE.SpriteMaterial).map?.dispose();
      (sunSprite.material as THREE.Material).dispose();
      for (const shaft of lightShafts) {
        (shaft.material as THREE.SpriteMaterial).map?.dispose();
        (shaft.material as THREE.Material).dispose();
      }
    },
  };
}

// Cheap hash-based 2D value noise (no external noise library) — smoothed
// with a Hermite (smoothstep) interpolation between lattice corners so it
// reads as gentle rolling terrain rather than blocky/faceted steps.
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 2 - 1; // remap 0..1 -> -1..1
}

// Fractal Brownian motion: layers several octaves of the base noise at
// increasing frequency/decreasing amplitude for a more organic, less
// obviously-periodic result than a single noise layer would give. A
// slightly irregular lacunarity (2.15 rather than a clean 2.0) helps
// avoid the higher octaves ever realigning into a visible repeating grid.
function fbm2(x: number, y: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2.15;
  }
  return total / maxAmplitude;
}

// Ground plane's local units span -0.5..0.5 (unscaled PlaneGeometry),
// but get scaled by groundSize = flockScale * 30 in placeNatureEnvironment
// — multiplying local coords by this constant converts them into the
// same "flock-scale units" the mountain ring/ocean are authored in, so
// noise frequencies below can be reasoned about in those same terms
// (e.g. "a hill every ~2 flock-units") regardless of the plane's huge
// absolute local:world scale ratio.
const GROUND_UNIT_SCALE = 30;

/**
 * Ground displacement height (in flock-scale units — multiply by
 * flockScale to get world-space height) at a given point in flock-scale
 * units. Shared by createGroundGeometry (which additionally divides by
 * GROUND_UNIT_SCALE before storing this in the plane's local Z, to
 * cancel out the plane's own huge groundSize scale-up — see that
 * function's comment) and placeNatureEnvironment (to sit lakes directly
 * on the terrain surface instead of at a fixed height that ignores it —
 * see the "floating lake" fix in placeNatureEnvironment).
 */
function terrainHeightAt(fx: number, fy: number): number {
  // Broad, slow rolling hills/valleys (low frequency, largest amplitude
  // but still gentle — this is meant to read as rolling grassland near
  // the flock, not foothills or mountains, which are handled entirely
  // separately by createMountainRing).
  // Amplitude constants tripled from their original values (0.045,
  // 0.016, 0.005) after the lake/terrain height-scaling bugfix above
  // reduced world-space amplitude much further than intended — dividing
  // out the stray extra GROUND_UNIT_SCALE factor also flattened the
  // hills/valleys down to a barely-there ~60 world-unit range (in a
  // ~700-unit-tall world), when the pre-bugfix look (despite its wildly
  // out-of-range extremes elsewhere) read as pleasantly rolling near the
  // play area. This restores a comparable, but sane and proportionate,
  // amplitude (~185 world units peak-to-peak) without reintroducing the
  // underground/floating-lake bug, since both createGroundGeometry and
  // placeNatureEnvironment's lake placement share this same function and
  // scale it identically (* flockScale) — raising these constants raises
  // both consistently, so lakes still sit exactly on the terrain surface.
  const broad = fbm2(fx * 0.06, fy * 0.06, 3) * 0.13;
  // Medium bumps break up any remaining large flat-looking stretches.
  const medium = fbm2(fx * 0.22 + 40.7, fy * 0.22 + 12.3, 2) * 0.045;
  // Fine surface texture, subtle — mostly noticeable close to camera.
  const fine = fbm2(fx * 0.85 + 91.1, fy * 0.85 + 5.9, 2) * 0.014;
  return broad + medium + fine;
}

// Large-scale "biome" tint colors blended per-vertex across the ground
// Shared with configureGroundTexture's texture.repeat and the UV warp in
// createGroundGeometry, which needs this to convert its warp amplitude
// (authored in raw pre-repeat UV space) into an actual on-texture offset.
const GROUND_TEXTURE_REPEAT = 120;

// (see createGroundGeometry) — lush shaded green in hollows, dry
// sun-baked gold on higher/exposed ground, and occasional bare-earth
// patches. Distinct from the tileable canvas texture's own blotches:
// this variation is computed once across the *entire* finite plane at
// vertex resolution (not a repeating tile), so it never repeats and
// breaks up the texture's tiling seams with genuinely non-periodic color
// regions — the same "biome/splat blending" real terrain renderers use,
// chosen over literal Carcassonne-style discrete tiles because it needs
// no edge-matching constraints between tiles and scales to any view
// distance without introducing a *new* tiling period of its own.
//
// Kept close to white (subtle hue/brightness bias only) rather than
// saturated colors: vertex colors *multiply* the already-colored diffuse
// texture in MeshStandardMaterial, so a saturated dark-green tint like
// the original 0x3a6b34 compounded with the texture's own dark greens
// and crushed the whole ground down to near-black instead of adding a
// gentle regional variation.
const LUSH_TINT = new THREE.Color(0xdceacf);
const DRY_TINT = new THREE.Color(0xf2e8ae);
const DIRT_TINT = new THREE.Color(0xd9c9a3);
// Rocky/scree tint for steep slopes — real hillsides lose their grass
// cover and show bare rock/scree wherever the ground gets too steep for
// soil to hold, which is both a very standard terrain-shading technique
// (slope-based splatting) and a natural-looking source of variety that
// isn't tied to any repeating noise pattern, since it's driven directly
// by the actual terrain geometry (see slopeAt) rather than another
// independent noise field.
const ROCK_TINT = new THREE.Color(0xb3aa9c);

// Central-difference slope magnitude (rise/run, scale-invariant since
// both terrainHeightAt's output and fx/fy are already in the same
// flock-scale units) at a point, used to blend in bare rock on steep
// terrain. eps is deliberately larger than the vertex spacing so the
// estimate reflects the local hillside's overall steepness rather than
// reacting to the finest noise octave.
function slopeAt(fx: number, fy: number): number {
  const eps = 0.35;
  const dhdx = (terrainHeightAt(fx + eps, fy) - terrainHeightAt(fx - eps, fy)) / (2 * eps);
  const dhdy = (terrainHeightAt(fx, fy + eps) - terrainHeightAt(fx, fy - eps)) / (2 * eps);
  return Math.sqrt(dhdx * dhdx + dhdy * dhdy);
}

function biomeTintAt(fx: number, fy: number): THREE.Color {
  const moisture = fbm2(fx * 0.035 + 300, fy * 0.035 + 150, 3); // -1..1
  const dirtiness = fbm2(fx * 0.05 + 700, fy * 0.05 + 900, 2); // -1..1
  const color = LUSH_TINT.clone().lerp(DRY_TINT, THREE.MathUtils.smoothstep(moisture, -0.15, 0.5));
  // Bare-earth patches only show up where dirtiness peaks sharply, so
  // they read as occasional worn spots rather than a third uniform band.
  const dirtFactor = THREE.MathUtils.smoothstep(dirtiness, 0.55, 0.85);
  if (dirtFactor > 0) color.lerp(DIRT_TINT, dirtFactor * 0.6);
  const rockFactor = THREE.MathUtils.smoothstep(slopeAt(fx, fy), 0.12, 0.3);
  if (rockFactor > 0) color.lerp(ROCK_TINT, rockFactor * 0.75);
  return color;
}

/**
 * Builds the ground plane with real vertex-displaced terrain (rolling
 * hills, shallow valleys, occasional flatter plateaus) instead of a
 * perfectly flat plane — a flat plane read as an unconvincingly solid
 * "green carpet" once the rest of the scene's fidelity improved. Only
 * the region near the play area actually matters visually (the plane's
 * outer reaches are hundreds of times larger and get fully fog-hidden),
 * so segment density is concentrated by using a modest, uniform grid
 * fine enough to resolve terrain detail within that inner region without
 * an excessive vertex count for the huge outer skirt.
 *
 * Also carries two anti-tiling measures alongside the displacement:
 * per-vertex biome-tint vertex colors (see biomeTintAt) that multiply
 * against the tileable diffuse texture with genuinely non-repeating
 * large-scale color regions, and a small per-vertex UV warp so the
 * texture's own tile grid doesn't line up into visible straight seams.
 */
function createGroundGeometry(): THREE.PlaneGeometry {
  const segments = 200;
  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const lx = position.getX(i);
    const ly = position.getY(i);
    const fx = lx * GROUND_UNIT_SCALE;
    const fy = ly * GROUND_UNIT_SCALE;

    // Local plane Z becomes world Y (up) once the mesh is rotated -90°
    // about X in createNatureEnvironment. terrainHeightAt's amplitude
    // constants (~0.066 max) were tuned as a fraction of flockScale (the
    // actual play-area size), but the whole plane — including this local
    // Z displacement — later gets uniformly scaled by groundSize
    // (flockScale * GROUND_UNIT_SCALE, the huge decorative-skirt scale),
    // which without this /GROUND_UNIT_SCALE correction blew the real
    // world-space height amplitude up by another full GROUND_UNIT_SCALE
    // factor (measured: -1241..+611 world units, dwarfing the ~700-unit
    // world box entirely). Dividing here cancels that back out so the
    // final world-space amplitude matches what was actually intended:
    // terrainHeightAt(fx,fy) * flockScale. See terrainHeightAt's and
    // placeNatureEnvironment's lake-placement comments for the matching
    // half of this fix.
    position.setZ(i, terrainHeightAt(fx, fy) / GROUND_UNIT_SCALE);

    const tint = biomeTintAt(fx, fy);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;

    // Warp the UV lookup by a smooth, low-frequency offset so the
    // texture's repeat grid bends rather than lining up into visible
    // straight tile seams when viewed from afar.
    //
    // (A per-repeat-cell rotation/mirror "texture bombing" scheme was
    // tried here instead — genuinely eliminates the periodic look in
    // theory — but baking independently-transformed UVs onto this
    // mesh's actual vertices (only ~1.5-2x denser than the texture's own
    // repeat-cell size) meant adjacent vertices frequently landed in
    // different cells, so triangles straddling a cell boundary
    // interpolated between two unrelated UV regions instead of a
    // rotated copy of the same cell — visible as diagonal glitch seams
    // across the ground, confirmed via direct visual QA. True texture
    // bombing needs either a per-pixel fragment-shader implementation or
    // much denser geometry to do safely; reverted to this cheaper,
    // seam-free smooth warp instead.
    //
    // Amplitude is expressed as a fraction of one texture repeat-tile
    // (~0.35 tile-widths of wobble) and only converted to raw pre-repeat
    // UV units here by dividing by GROUND_TEXTURE_REPEAT. Multiplying
    // the raw fbm output directly (as a previous version of this code
    // did) ignored the repeat scaling entirely: at repeat=120 that made
    // the warp's real on-texture displacement up to ~48 whole tiles,
    // which doesn't "bend" the tile grid so much as scramble neighboring
    // vertices onto unrelated, uncorrelated parts of the texture —
    // exactly the kind of high-frequency noise that vanishes into a flat
    // mipmapped average and was silently erasing all of the large-scale
    // blotches/flecks added in configureGroundTexture.
    const warpAmount = (0.35 / GROUND_TEXTURE_REPEAT);
    const warpU = fbm2(fx * 0.03 + 555, fy * 0.03 + 222, 2) * warpAmount;
    const warpV = fbm2(fx * 0.03 + 111, fy * 0.03 + 888, 2) * warpAmount;
    uv.setXY(i, uv.getX(i) + warpU, uv.getY(i) + warpV);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A ring of jagged, flat-shaded triangular peaks encircling the origin,
 * built in "flock scale" units (radius ~5-5.6) so it can just be
 * uniformly scaled by the flock's actual size in placeNatureEnvironment.
 * Modeled as a continuous ridge strip (not isolated spike triangles) with
 * smoothed random heights, so it reads as a low, rolling distant range
 * rather than a picket fence of witch-hat peaks. Ridge vertices are
 * tinted lighter than the base to fake aerial-perspective haze.
 */
function createMountainRing(gapAngle: number, gapHalfWidth: number): THREE.Mesh {
  const segments = 64;
  const outerRadius = 6.1; // base, flock-scale units
  const innerRadius = 5.4; // ridge line, pulled slightly inward/forward
  // Foothill tone at the mountain's base — feeds into mountainColorAt's
  // height gradient below. A muted sage-green-gray so it reads as a
  // scrubby lower slope distinct from both the grass plain in front of
  // it and the bare rock above it.
  const baseColor = new THREE.Color(0x6f7a5c);

  // Smooth neighboring random heights so the ridge undulates gently
  // instead of spiking sharply between adjacent segments. Heights are
  // deliberately much taller than the original 0.16-0.42 range: at the
  // old height the ridge silhouette sat well below the screen-space row
  // where the (infinite, flat) ground plane's own vanishing horizon
  // line appeared, so a visible strip of flat, lightly-fogged ground
  // showed *above* the ridge before the fog fully whited it out — read
  // as "a ridge, then an open plain, then the sky" instead of the
  // mountains being the last thing visible on the horizon. Taller peaks
  // push the silhouette up into that gap.
  const rawHeights: number[] = [];
  for (let i = 0; i < segments; i++) rawHeights.push(0.55 + Math.random() * 0.7);
  const heights = rawHeights.map((h, i) => {
    const prev = rawHeights[(i - 1 + segments) % segments];
    const next = rawHeights[(i + 1) % segments];
    return (prev + h * 2 + next) / 4;
  });
  const maxHeight = Math.max(...heights);

  // Per-vertex rock texture + snow caps, replacing the old flat
  // baseColor -> peakColor two-stop gradient — direct visual QA showed
  // the ridge reading as a single uniform gray wall with no rock detail
  // at all, easily the weakest-looking element next to the ground/
  // forest/rocks once those got their own noise-driven variation. Uses
  // the same fbm2 noise already used for ground/biome texturing so the
  // mountains read as part of the same terrain system rather than a
  // separately-styled backdrop.
  //
  // Two rounds of tuning were needed beyond just picking colors:
  // 1) A first pass used a subtle desaturated blue-gray rock palette
  //    (close in hue/lightness to both the foothill tone and the
  //    ambient sky/fog color) — direct visual QA showed the mountain's
  //    own strong directional-light shading gradient completely
  //    swamped that subtle albedo variation. Needed a wide luminance +
  //    hue swing (dark umber to warm sunlit tan) to survive it.
  // 2) Even with that contrast, pure angle/height-keyed noise bands
  //    (a smoothly-varying blotch pattern) still frequently rendered as
  //    a single flat wall from most camera angles: the scene's
  //    UnrealBloomPass (see Renderer3D.ts) uses a low brightness
  //    threshold, so it blurs/glows almost the entire sunlit slope,
  //    smearing out slow, low-frequency blotches almost completely.
  //    Adding a second, much higher-frequency deterministic banding
  //    term keyed purely on height (real rock strata run in roughly
  //    horizontal bands) survives that blur far better than noise
  //    blotches alone, and — being angle-independent — is guaranteed to
  //    read as visible striping from any camera direction rather than
  //    depending on luck about which noise cell happens to be in view.
  const ROCK_LIGHT = new THREE.Color(0xd6c49a);
  const ROCK_DARK = new THREE.Color(0x2f2a1f);
  const SNOW_COLOR = new THREE.Color(0xffffff);
  function mountainColorAt(angle: number, h: number): THREE.Color {
    const t = THREE.MathUtils.clamp(h / maxHeight, 0, 1);
    // Noise-driven light/dark rock blotching across the slope's face —
    // keyed on angle (stable per ridge position) and height (a little
    // vertical striation) so it reads as weathered rock rather than a
    // smooth gradient. Frequency roughly doubled from the first pass so
    // several bands are visible across a typical camera's field of
    // view instead of just one slow gradient.
    const rockNoise = fbm2(Math.cos(angle) * 14 + 91.3, Math.sin(angle) * 14 + h * 5 + 40.2, 3);
    // Higher-frequency horizontal strata bands, purely a function of
    // height so they read as real rock layers regardless of which
    // angle happens to be in view (see comment above on bloom washing
    // out slower noise blotches).
    const stripe = Math.sin(h * 26 + rockNoise * 4) * 0.5 + 0.5;
    const rockBlend = THREE.MathUtils.smoothstep(rockNoise * 0.6 + stripe * 0.4, 0.15, 0.75);
    const rockColor = ROCK_DARK.clone().lerp(ROCK_LIGHT, rockBlend);
    // Blend from the foothill tone up toward the textured rock tones as
    // elevation increases.
    const color = baseColor.clone().lerp(rockColor, THREE.MathUtils.smoothstep(t, 0, 0.45));
    // Snow caps only on the tallest peaks, with a noise-perturbed
    // snowline (rather than a razor-flat height threshold) so it reads
    // as an irregular natural treeline/snowline instead of a painted
    // stripe running the length of the ridge. Pure white so it still
    // registers as snow even when darkened by shadow-side lighting or
    // softened by bloom.
    const snowNoise = fbm2(Math.cos(angle) * 4 + 500, Math.sin(angle) * 4 + 250, 2);
    const snowThreshold = 0.62 + snowNoise * 0.14;
    const snowFactor = THREE.MathUtils.smoothstep(t, snowThreshold, snowThreshold + 0.14);
    if (snowFactor > 0) color.lerp(SNOW_COLOR, snowFactor);
    return color;
  }

  // Carve a smooth-edged gap/bay around gapAngle: mountain height drops
  // to sea-level so the range appears to "part" and reveal the ocean
  // plane (added separately, see createOceanPatch) rather than showing a
  // flat low patch of the same hillside. Deliberately does NOT push the
  // ring's radius outward — fog.far is a fixed multiple of flockScale,
  // and this ring's radius (~5-5.6) is already tuned to sit just inside
  // that fog distance; pushing the notch's radius out past it would put
  // the opening (and the ocean's near shore just beyond it) entirely
  // past the fog's far distance, rendering as a featureless white/gray
  // wall instead of a visible gap — a bug caught by direct visual QA.
  // Transition width is a short blend zone *beyond* the fully-open core,
  // not spread across the whole notch — a pure distance-based smoothstep
  // (the old approach) only reaches ~100% open in a razor-thin sliver at
  // the exact center angle, leaving most of the intended gap as a
  // partial-height ridge. Because that partial ridge is nearly uniform
  // height across a wide arc, it reads as a flat-topped plateau (a mesa)
  // rather than parting to reveal the sea — this is the bug a "mesa"
  // sighting report was tracking down. Giving the core a genuine flat
  // factor=1 plateau across gapHalfWidth, with the smoothstep blend only
  // in a short zone beyond it, produces a true fully-open notch.
  const transitionWidth = gapHalfWidth * 0.6;
  function angleDelta(a: number): number {
    let d = a - gapAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  function gapFactor(a: number): number {
    const d = angleDelta(a);
    if (d <= gapHalfWidth) return 1;
    if (d >= gapHalfWidth + transitionWidth) return 0;
    const t = 1 - (d - gapHalfWidth) / transitionWidth;
    // smoothstep for a gentle transition rather than a hard edge
    return t * t * (3 - 2 * t);
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const g0 = gapFactor(a0);
    const g1 = gapFactor(a1);
    // Fully inside the gap's core (both endpoints ~100% gap factor):
    // skip emitting this segment's geometry entirely, leaving a true
    // hole rather than a flattened-but-still-present colored strip,
    // so the ocean plane behind it is completely unobstructed.
    if (g0 > 0.97 && g1 > 0.97) continue;
    const h0 = heights[i] * (1 - g0);
    const h1 = heights[(i + 1) % segments] * (1 - g1);

    // Subdivide base->ridge into several radial steps rather than a
    // single quad — with only one step, mountainColorAt was only ever
    // sampled at the base (h=0) and ridge (full height) per segment,
    // and the GPU just linearly interpolated colors across that single
    // huge quad. That meant no rock texture or snow banding could ever
    // actually appear *within* a segment (only 64 samples existed
    // around the whole ring), so from any one camera angle showing only
    // a handful of segments, the visible slope read as a single smooth
    // gradient no matter how much noise/contrast was added to
    // mountainColorAt. Real per-step samples let color vary up the
    // slope itself, not just around the ring.
    const radialSteps = 5;
    for (let s = 0; s < radialSteps; s++) {
      const tA = s / radialSteps;
      const tB = (s + 1) / radialSteps;
      const rA = THREE.MathUtils.lerp(outerRadius, innerRadius, tA);
      const rB = THREE.MathUtils.lerp(outerRadius, innerRadius, tB);
      const hA0 = h0 * tA;
      const hB0 = h0 * tB;
      const hA1 = h1 * tA;
      const hB1 = h1 * tB;

      const p00 = [Math.cos(a0) * rA, hA0, Math.sin(a0) * rA];
      const p01 = [Math.cos(a1) * rA, hA1, Math.sin(a1) * rA];
      const p10 = [Math.cos(a0) * rB, hB0, Math.sin(a0) * rB];
      const p11 = [Math.cos(a1) * rB, hB1, Math.sin(a1) * rB];

      const c00 = mountainColorAt(a0, hA0);
      const c01 = mountainColorAt(a1, hA1);
      const c10 = mountainColorAt(a0, hB0);
      const c11 = mountainColorAt(a1, hB1);

      // Two triangles per step forming a continuous sloped strip from
      // base to ridge — side is set to DoubleSide on the material so
      // winding order (we're viewed from inside the ring) doesn't matter.
      pushTri(p00, p10, p01, c00, c10, c01);
      pushTri(p10, p11, p01, c10, c11, c01);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * A much larger wedge-shaped sea, visible through the deliberate bay
 * opening carved into createMountainRing (same gapAngle/gapHalfWidth),
 * extending from just past the receded coastline out to a radius far
 * beyond the fog's draw distance — its outer edge is never a visible
 * hard border, just fades into the horizon haze like the ground does.
 * A shore-to-deep-water vertex color gradient (light turquoise near the
 * coast, darkening with distance) sells the sense of scale/depth far
 * more cheaply than any actual wave geometry or shader would.
 */
function createOceanPatch(gapAngle: number, gapHalfWidth: number): { ocean: THREE.Mesh; beach: THREE.Mesh } {
  // Slightly wider than the mountain notch itself so the ocean is fully
  // visible through the gap with no sliver of grass peeking through at
  // the transition edges. Segment counts raised well above the original
  // (28 angular / 5 radial) — at that density the wedge's shore and
  // outer edges read as distinctly straight-faceted/"squarish" polygon
  // edges even at a distance; finer subdivision plus the per-angle
  // jitter below (a natural, uneven coastline rather than dead-straight
  // wedge facets) reads much more like a real receding coastline.
  const angleSpan = gapHalfWidth * 1.75;
  const angularSegments = 96;
  const radialBands = 9;
  // Starts just inside the mountain ring's own inner/ridge radius (5.4)
  // so it tucks under the ground right where the ring's gap begins,
  // with no seam/sliver of grass. Extended out closer to fog.far (see
  // placeNatureEnvironment) than before so the sea's gradient actually
  // reaches (and blends into) the fog-matching horizon color rather
  // than stopping short and leaving a visible gap between "last visible
  // ocean" and "the horizon" — this was the "ocean doesn't go out to
  // the horizon" bug. A dedicated horizonColor lerp stage (see below)
  // eases the deep-water color into the fog tone right at the edge so
  // there's no hard seam even where the fog itself is turned off.
  const innerRadius = 5.1;
  const outerRadius = 12;
  // Lighter, more sky-reflective blues than the old shore/deep pair
  // (0x5fa3bd/0x0f2e46) — the deep color in particular was dark enough
  // to read as a flat near-black slab once fog dimmed the little bit of
  // shore color visible near it, rather than a sunlit sea. Matches the
  // same "lighter, sky-tinted over murky-dark" fix already applied to
  // the small lake in createWaterPatch.
  const shoreColor = new THREE.Color(0x6fb0c9);
  const deepColor = new THREE.Color(0x1d4a63);
  // Pale, slightly blue-grey horizon tone close to the sky/fog color —
  // the final stretch of ocean eases toward this instead of staying a
  // saturated deep blue right up to its (otherwise arbitrary) edge, so
  // the sea visually dissolves into the sky at the horizon exactly like
  // the ground/mountains do, with or without fog enabled.
  const horizonColor = new THREE.Color(0xd7e0e2);

  // Smoothed per-angular-vertex radius jitter, applied consistently
  // across every radial band (rather than independently per band) so
  // the whole coastline undulates coherently outward like a real shore
  // instead of each concentric ring wiggling on its own. The beach strip
  // (see below) reuses this exact same jitter array so its own shoreline
  // edge lines up perfectly with the ocean's — two independently jittered
  // coastlines would drift apart and either overlap or leave gaps.
  const jitterCount = angularSegments + 1;
  const rawJitter: number[] = [];
  for (let i = 0; i < jitterCount; i++) rawJitter.push((Math.random() - 0.5) * 2);
  const jitter = rawJitter.map((v, i) => {
    const prev = rawJitter[Math.max(0, i - 1)];
    const next = rawJitter[Math.min(jitterCount - 1, i + 1)];
    return (prev + v * 2 + next) / 4;
  });

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };

  // Shore -> deep for the first 55% of the span, then deep -> horizon
  // haze for the remaining 45%, so distant water genuinely fades to sky
  // tone instead of holding a hard deep-blue color all the way to the
  // (invisible) mesh edge.
  const colorAt = (t: number): THREE.Color => {
    if (t < 0.55) return shoreColor.clone().lerp(deepColor, t / 0.55);
    return deepColor.clone().lerp(horizonColor, (t - 0.55) / 0.45);
  };

  for (let band = 0; band < radialBands; band++) {
    // Non-linear radial spacing (squared) bunches more geometry/color
    // detail near the shore, where it's actually visible up close, and
    // spends fewer triangles on the distant, heavily-fogged-out reaches.
    const t0 = band / radialBands;
    const t1 = (band + 1) / radialBands;
    const r0 = innerRadius + (outerRadius - innerRadius) * t0 * t0;
    const r1 = innerRadius + (outerRadius - innerRadius) * t1 * t1;
    const c0 = colorAt(t0);
    const c1 = colorAt(t1);

    for (let seg = 0; seg < angularSegments; seg++) {
      const a0 = gapAngle - angleSpan + (2 * angleSpan * seg) / angularSegments;
      const a1 = gapAngle - angleSpan + (2 * angleSpan * (seg + 1)) / angularSegments;
      const j0 = 1 + jitter[seg] * 0.05;
      const j1 = 1 + jitter[seg + 1] * 0.05;
      const p00 = [Math.cos(a0) * r0 * j0, 0, Math.sin(a0) * r0 * j0];
      const p01 = [Math.cos(a1) * r0 * j1, 0, Math.sin(a1) * r0 * j1];
      const p10 = [Math.cos(a0) * r1 * j0, 0, Math.sin(a0) * r1 * j0];
      const p11 = [Math.cos(a1) * r1 * j1, 0, Math.sin(a1) * r1 * j1];
      pushTri(p00, p10, p11, c0, c1, c1);
      pushTri(p00, p11, p01, c0, c1, c0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // A shiny/metallic material (roughness 0.15, metalness 0.2) with no
    // environment map for IBL renders almost entirely unlit except for a
    // tiny direct-light specular hotspot — the vertex color gradient
    // barely showed through, so most of the wedge read as a uniform
    // dark, flat shape (the reported "mesa") rather than graduated water.
    // A matte, fully-diffuse material (matching the ground/mountains)
    // actually lets the sun + ambient light show the shore-to-deep
    // gradient and fog blending as intended.
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ocean = new THREE.Mesh(geometry, material);
  const beach = createBeachStrip(gapAngle, angleSpan, angularSegments, jitter, innerRadius);
  return { ocean, beach };
}

/**
 * A narrow strip of tan sand tracking the ocean's shoreline, sitting
 * just outside the water's inner edge (innerRadius) on the land side.
 * Reuses the exact same per-angle jitter array as the ocean wedge (see
 * createOceanPatch) so the beach's water-side edge follows the ocean's
 * actual undulating shore precisely instead of drifting apart from it.
 */
function createBeachStrip(
  gapAngle: number,
  angleSpan: number,
  angularSegments: number,
  jitter: number[],
  shoreRadius: number,
): THREE.Mesh {
  // Deliberately narrow relative to the ocean's own scale (shoreRadius
  // ~5.1) — a "beach line" rather than a wide coastal plain.
  const beachWidth = 0.32;
  const innerRadius = shoreRadius - beachWidth;
  const outerRadius = shoreRadius;

  // Wet sand (darker, closer to the water) grading to dry sand (lighter,
  // closer to the grass) so the strip itself reads as a gradient rather
  // than one flat tan slab.
  const wetSandColor = new THREE.Color(0xc2a366);
  const drySandColor = new THREE.Color(0xe0c896);

  // A second, independently-smoothed jitter for the inner (grass-side)
  // edge — same neighbor-averaging technique as the ocean's own jitter,
  // rather than raw uncorrelated per-vertex noise, which produced a
  // harsh sawtooth edge (adjacent vertices jumping independently in and
  // out) instead of a gently uneven, natural-looking grass/sand border.
  const jitterCount = angularSegments + 1;
  const rawInnerJitter: number[] = [];
  for (let i = 0; i < jitterCount; i++) rawInnerJitter.push((Math.random() - 0.5) * 2);
  const innerJitter = rawInnerJitter.map((v, i) => {
    const prev = rawInnerJitter[Math.max(0, i - 1)];
    const next = rawInnerJitter[Math.min(jitterCount - 1, i + 1)];
    return (prev + v * 2 + next) / 4;
  });

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };

  for (let seg = 0; seg < angularSegments; seg++) {
    const a0 = gapAngle - angleSpan + (2 * angleSpan * seg) / angularSegments;
    const a1 = gapAngle - angleSpan + (2 * angleSpan * (seg + 1)) / angularSegments;
    const j0 = 1 + jitter[seg] * 0.05;
    const j1 = 1 + jitter[seg + 1] * 0.05;
    // Gentle, smoothed extra width jitter on the grass-side edge only
    // (the water-side edge already tracks the ocean's own jitter
    // exactly) so the beach's width varies a little along the shore
    // without a jagged, sawtooth boundary.
    const wobble0 = 1 + innerJitter[seg] * 0.12;
    const wobble1 = 1 + innerJitter[seg + 1] * 0.12;
    const rOuter0 = outerRadius * j0;
    const rOuter1 = outerRadius * j1;
    const rInner0 = innerRadius * j0 * wobble0;
    const rInner1 = innerRadius * j1 * wobble1;
    const pInner0 = [Math.cos(a0) * rInner0, 0, Math.sin(a0) * rInner0];
    const pInner1 = [Math.cos(a1) * rInner1, 0, Math.sin(a1) * rInner1];
    const pOuter0 = [Math.cos(a0) * rOuter0, 0, Math.sin(a0) * rOuter0];
    const pOuter1 = [Math.cos(a1) * rOuter1, 0, Math.sin(a1) * rOuter1];
    pushTri(pInner0, pOuter0, pOuter1, drySandColor, wetSandColor, wetSandColor);
    pushTri(pInner0, pOuter1, pInner1, drySandColor, wetSandColor, drySandColor);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    // Nudge the beach just toward the camera relative to the ground
    // beneath it — same z-fighting safety margin used for the forest
    // patches — since it sits at nearly the same height as the ground
    // plane right where they meet.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  return new THREE.Mesh(geometry, material);
}

/**
/**
 * A lake patch with a soft, irregular shoreline and stable, always-visible
 * blue surface. Uses an unlit material so lake color stays readable even
 * under darker lighting/time-of-day combinations.
 */
function createWaterPatch(): THREE.Mesh {
  const segments = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Irregular radius per angle (smoothed noise) so the outline reads as
  // a natural lake shoreline instead of a perfect drafting-compass circle.
  const raw: number[] = [];
  for (let i = 0; i < segments; i++) raw.push(0.78 + Math.random() * 0.32);
  const radii = raw.map((r, i) => (raw[(i - 1 + segments) % segments] + r * 2 + raw[(i + 1) % segments]) / 4);

  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radii[i];
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    positions.push(x, y, 0);
    uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % segments));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhongMaterial({
    color: 0x2f698b,
    emissive: 0x1b4660,
    emissiveIntensity: 0.32,
    specular: 0x9fd8ff,
    shininess: 72,
    transparent: true,
    opacity: 0.9,
    alphaMap: createWaterAlphaTexture(),
    depthWrite: false,
    // Extra safety against z-fighting with the ground plane just beneath
    // it — nudges the water's rendered depth slightly toward the camera
    // so it never visually "fights" with the grass texture underneath.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/**
 * Soft radial falloff (feathered shoreline) plus a bright off-center
 * glint blob, baked as a grayscale alpha map so the water's edges fade
 * gently into the surrounding grass instead of cutting off sharply.
 */
function createWaterAlphaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  base.addColorStop(0, 'rgba(255,255,255,1)');
  base.addColorStop(0.72, 'rgba(255,255,255,0.95)');
  base.addColorStop(0.92, 'rgba(255,255,255,0.45)');
  base.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // A soft bright glint (stands in for a specular sun highlight on the
  // water's surface) — drawn additively so it boosts alpha/brightness in
  // one spot without a hard edge.
  ctx.globalCompositeOperation = 'lighter';
  const glint = ctx.createRadialGradient(size * 0.38, size * 0.42, 0, size * 0.38, size * 0.42, size * 0.22);
  glint.addColorStop(0, 'rgba(255,255,255,0.9)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

/** A bright, warm sun disc with a soft feathered edge, standing in for the sky shader's near-invisible physical sun disc. */
function createSunMaterial(): THREE.SpriteMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Normal (alpha) blending, not additive: additive light gets washed out
  // against an already-bright sky, especially near the pale horizon.
  // A solid, opaque-cored disc that just alpha-fades at the edge reads as
  // a clearly visible sun regardless of what's behind it. Stops are more
  // closely spaced than a simple 3-stop gradient to avoid a visible
  // banding "ring" where alpha changes too abruptly. Brighter/more opaque
  // throughout than the original pass (higher alpha at every stop past
  // the core, lighter colors) — the previous stops dropped alpha and
  // saturation quickly enough that the disc read as a fairly dim, dull
  // orange smudge rather than a bright sun.
  gradient.addColorStop(0, 'rgba(255,255,250,1)');
  gradient.addColorStop(0.22, 'rgba(255,247,214,1)');
  gradient.addColorStop(0.42, 'rgba(255,230,160,1)');
  gradient.addColorStop(0.65, 'rgba(255,205,120,0.85)');
  gradient.addColorStop(0.85, 'rgba(255,185,95,0.45)');
  gradient.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // Skip tone mapping for this material — ACES + the scene's 0.65
    // exposure was crushing the sun down to a dim, dull grey blob that
    // looked like it was permanently behind a haze of cloud.
    toneMapped: false,
  });
}

/**
 * A much larger, very soft warm glow rendered just behind the sun disc —
 * gives the light source a sense of radiance/corona instead of looking
 * like a flat painted coin stuck on the sky dome. Kept fully separate
 * from the crisp disc sprite so its own gradient can be extremely broad
 * and soft without diluting the disc's crisp edge.
 */
function createSunHaloMaterial(): THREE.SpriteMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Kept deliberately subtle and smoothly tapered — a strong or large
  // halo reads as a flat washed-out "coin" against the sky rather than a
  // glow, especially near the pale horizon. Many closely-spaced stops
  // avoid any visible ring where the falloff rate changes. Nudged up
  // slightly alongside the brighter sun disc so the two still read as
  // one consistent, brighter light source rather than a bright disc
  // sitting on a comparatively dim glow.
  gradient.addColorStop(0, 'rgba(255,230,175,0.4)');
  gradient.addColorStop(0.18, 'rgba(255,222,160,0.3)');
  gradient.addColorStop(0.4, 'rgba(255,212,145,0.18)');
  gradient.addColorStop(0.65, 'rgba(255,204,135,0.08)');
  gradient.addColorStop(1, 'rgba(255,198,125,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

/** Repositions the sky dome and ground plane to surround/underlie a given world center + size. */
export function placeNatureEnvironment(env: NatureEnvironment, center: THREE.Vector3, groundSize: number): void {
  env.sky.position.set(center.x, 0, center.z);
  env.ground.position.set(center.x, 0, center.z);
  env.ground.scale.setScalar(groundSize);

  const SUN_DISTANCE = 15000;
  env.sunSprite.position.copy(env.sunDirection).multiplyScalar(SUN_DISTANCE).add(center);
  env.sunHalo.position.copy(env.sunDirection).multiplyScalar(SUN_DISTANCE - 50).add(center);
  env.lightShafts.forEach((shaft, i) => {
    const distance = SUN_DISTANCE * (0.35 + i * 0.16);
    shaft.position.copy(env.sunDirection).multiplyScalar(distance).add(center);
  });

  // Fog range scales with the flock's own size (groundSize is the huge,
  // mostly-decorative ground plane, ~30x flockScale) so the ground fades
  // out well before its physical edge, hiding the seam at the horizon.
  //
  // Far was previously kept just past the mountain ring's own radius
  // (7.2x) to avoid a "visible flat plain beyond the ridge" gap — but
  // the ocean wedge (createOceanPatch) actually extends out to radius
  // 12x flockScale, so most of the ocean's surface (everything past
  // 7.2x) sat beyond fog.far and rendered as a completely solid wall of
  // fog color. Pushing far out to just past the ocean's own outer edge
  // (~13x) lets its already-built-in shore->deep->horizon color gradient
  // (see createOceanPatch) do the final blend into the sky, with engine
  // fog only adding gentle atmospheric haze on top rather than a hard
  // cutoff.
  //
  // But pulling near out to 6.5x (past the mountain ring's own 5.4-6.1x
  // radius) left the ring with *zero* haze at all — crisp enough that
  // its low-poly faceted silhouette became distractingly obvious rather
  // than reading as a hazy, softened distant ridge. Pulling near back in
  // to 3.5x (well before the ring) puts the mountains partway into the
  // fog gradient again — a light-but-present haze that rounds off the
  // facets — while still keeping far out near the ocean's true edge so
  // the "solid wall blocking the ocean" bug doesn't return.
  const flockScale = groundSize / 30;
  env.fog.near = flockScale * 3.5;
  env.fog.far = flockScale * 13.5;

  // Mountain ring geometry is authored in flock-scale units (radius ~6),
  // so a straight uniform scale places it just inside the fog's far
  // distance — hazy and partially faded, like real distant mountains.
  env.mountains.position.set(center.x, 0, center.z);
  env.mountains.scale.setScalar(flockScale);

  // Each lake sits in its own compass direction (see LAKE_DEFS) so they
  // spread naturally around the play area instead of clustering. Height
  // is sampled directly from the same terrain displacement function used
  // to build the ground mesh (terrainHeightAt) rather than a fixed lift —
  // previously the lake used a constant small offset regardless of the
  // actual terrain height beneath it, so once the ground gained real
  // rolling hills/valleys the lake would either sink into a hill or
  // visibly float above a hollow. Sampling the real terrain height at
  // the lake's own position and adding only a small consistent lift on
  // top (to avoid z-fighting with the grass) keeps it sitting right on
  // the surface everywhere.
  const waterLift = Math.max(1, flockScale * 0.02);
  env.lakes.forEach((lake, i) => {
    const def = LAKE_DEFS[i];
    const fx = def.forwardX * def.distanceScale;
    const fy = def.forwardZ * def.distanceScale;
    // World-space terrain height at this point = terrainHeightAt() *
    // flockScale (matches the ground mesh's own local-Z / GROUND_UNIT_SCALE
    // correction in createGroundGeometry — see that function's comment).
    // This used to multiply by flockScale * GROUND_UNIT_SCALE instead,
    // a stray extra GROUND_UNIT_SCALE (30x) factor that placed lakes
    // hundreds to over a thousand world units below/above the actual
    // terrain surface beneath them (measured as low as y ≈ -968 in a
    // ~700-unit-tall world) — invisible, buried lakes, not floating ones.
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    lake.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight + waterLift,
      center.z + fy * flockScale,
    );
    lake.scale.setScalar(flockScale * def.sizeScale);
  });

  // Ocean is authored in the same flock-scale units as the mountain
  // ring's radius (~5-7 flock units, extending out to 9), centered on
  // the flock like the mountains/ground rather than offset like the lake
  // — its wedge shape (see createOceanPatch) is already aimed at
  // OCEAN_GAP_ANGLE, matching the bay opening carved into the mountains.
  const oceanLift = Math.max(1, flockScale * 0.015);
  env.ocean.position.set(center.x, oceanLift, center.z);
  env.ocean.scale.setScalar(flockScale);

  // Beach sits right at the same fixed lift as the ocean, matched to the
  // same center/scale so its shared-jitter shoreline (see
  // createBeachStrip) lines up with the ocean's edge exactly. A hair
  // higher than the ocean lift so the sand doesn't get submerged under
  // the water plane at their shared boundary.
  env.beach.position.set(center.x, oceanLift * 1.2, center.z);
  env.beach.scale.setScalar(flockScale);

  // Rock clusters follow the exact same terrain-following placement as
  // the lakes (sample terrainHeightAt at the cluster's own position
  // rather than a fixed lift) so they sit right on the actual hillside
  // surface everywhere instead of floating above a hollow or sinking
  // into a hill.
  env.rocks.forEach((rock, i) => {
    const def = ROCK_CLUSTER_DEFS[i];
    const fx = def.forwardX * def.distanceScale;
    const fy = def.forwardZ * def.distanceScale;
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    rock.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight,
      center.z + fy * flockScale,
    );
    rock.scale.setScalar(flockScale * def.sizeScale);
  });

  // Forest patches: the group (litter + crown cluster) is anchored at
  // the same single terrainHeightAt sample the rocks use, but unlike the
  // rocks, individual canopy crowns within a large patch additionally
  // sample their *own* local terrain height relative to this anchor (see
  // createForestCrowns) so a big patch's canopy still follows real
  // undulation across its footprint instead of assuming the ground is
  // perfectly flat underneath it.
  env.forestPatches.forEach((patch, i) => {
    const def = FOREST_PATCH_DEFS[i];
    const fx = def.forwardX * def.distanceScale;
    const fy = def.forwardZ * def.distanceScale;
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    patch.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight,
      center.z + fy * flockScale,
    );
    patch.scale.setScalar(flockScale * def.sizeScale);
  });
}

/**
 * Procedurally paints a tileable grass texture with multi-scale color
 * variation, plus a matching normal map and roughness map — no external
 * assets. Purely fine speckle (the original approach) all but disappears
 * once mip-mapped at typical ground-plane viewing distance, which is why
 * the ground read as a flat solid green; layering in larger low-frequency
 * blotches (which survive minification) fixes that, and deriving a bump
 * normal map from the same blotch layout adds real (if subtle) relief
 * that catches the sun light instead of looking like a flat painted mat.
 */
function configureGroundTexture(material: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): void {
  const size = 512;
  const diffuseCanvas = document.createElement('canvas');
  diffuseCanvas.width = size;
  diffuseCanvas.height = size;
  const ctx = diffuseCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const heightCtx = heightCanvas.getContext('2d')!;

  ctx.fillStyle = '#3d6b35';
  ctx.fillRect(0, 0, size, size);
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, size, size);

  // Draws a soft radial blotch onto an arbitrary canvas context, wrapped
  // across the edges so the tile still repeats seamlessly.
  const drawBlob = (targetCtx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) => {
    const offsets = [-size, 0, size];
    for (const ox of offsets) {
      for (const oy of offsets) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + radius < 0 || cx - radius > size || cy + radius < 0 || cy - radius > size) continue;
        const gradient = targetCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(${color}, ${alpha})`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);
        targetCtx.fillStyle = gradient;
        targetCtx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
    }
  };

  // Large-scale color patches are now generated procedurally per-pixel
  // in the fragment shader instead of baked into this canvas — see
  // applyGroundTextureBombing's Worley-noise-style blotch field for why:
  // a baked circular blob looks visually identical after any of the 8
  // dihedral "bombing" transforms (rotating/mirroring a circle changes
  // nothing), and keeping blobs clear of the tile edge (so translation
  // tiling wouldn't show seams) left every single repeat cell with the
  // same unvarying plain border — which itself reads as an obvious
  // repeating "picture frame" grid, exactly the problem being solved
  // here. A per-pixel procedural field has no cell-aligned "frame" and
  // no baked shape to repeat, so it can't produce a perceptible grid.

  // Medium-scale mottling for mid-distance variation. Made larger and
  // pulled 25% closer to the base tile green (#3d6b35 / rgb(61,107,53))
  // per feedback that these patches read too obviously when looking
  // toward the sun near the lake.
  for (let i = 0; i < 200; i++) {
    const margin = 40;
    const x = margin + Math.random() * (size - margin * 2);
    const y = margin + Math.random() * (size - margin * 2);
    const radius = 20 + Math.random() * 44;
    const green = 70 + Math.random() * 80;
    const rawR = 45 + green * 0.2;
    const rawG = green;
    const rawB = 40 + green * 0.15;
    const r = rawR * 0.75 + 61 * 0.25;
    const g = rawG * 0.75 + 107 * 0.25;
    const b = rawB * 0.75 + 53 * 0.25;
    const color = `${r}, ${g}, ${b}`;
    drawBlob(ctx, x, y, radius, color, 0.28 + Math.random() * 0.15);
    drawBlob(heightCtx, x, y, radius * 0.7, '190, 190, 190', 0.18);
  }

  // Fine speckle for close-up detail (diffuse only — too small to matter
  // for the normal map, and would just add noise).
  for (let i = 0; i < 4000; i++) {
    const margin = 20;
    const x = margin + Math.random() * (size - margin * 2);
    const y = margin + Math.random() * (size - margin * 2);
    const shade = 20 + Math.random() * 40;
    const green = 90 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${40 + shade * 0.3}, ${green}, ${35 + shade * 0.3}, 0.5)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Sparse wildflower/clover flecks — small, bright, saturated dots
  // (unlike everything else in this texture, which is soft-edged and
  // desaturated) so they read as tiny points of visual interest catching
  // the eye up close, like real scattered wildflowers in a meadow,
  // without being dense/bright enough to disturb the overall color
  // balance from a distance.
  const flowerColors = ['255, 244, 214', '255, 250, 250', '221, 196, 255', '255, 214, 120'];
  for (let i = 0; i < 90; i++) {
    const margin = 30;
    const cx = margin + Math.random() * (size - margin * 2);
    const cy = margin + Math.random() * (size - margin * 2);
    const clusterSize = 2 + Math.floor(Math.random() * 4);
    const color = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    for (let j = 0; j < clusterSize; j++) {
      const x = cx + (Math.random() - 0.5) * 14;
      const y = cy + (Math.random() - 0.5) * 14;
      ctx.fillStyle = `rgba(${color}, ${0.55 + Math.random() * 0.25})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const texture = new THREE.CanvasTexture(diffuseCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Lower repeat than before (was 400) so the large-scale blotches above
  // stay visibly sized on the ground instead of tiling into fine noise.
  texture.repeat.set(GROUND_TEXTURE_REPEAT, GROUND_TEXTURE_REPEAT);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The ground is viewed at a shallow, grazing angle from the default
  // orbit camera (looking mostly along the plane rather than straight
  // down), which is exactly the case anisotropic filtering exists for:
  // without it, the GPU picks a mip level based on the *most*
  // foreshortened UV axis, so the whole texture — including the large
  // blotches/flecks above — gets blurred down to a flat average color
  // even though it isn't actually that minified in the other direction.
  // This was very likely the dominant reason the ground still read as a
  // flat, featureless "plastic" green at normal viewing distance even
  // after the blotch palette and UV-warp fixes.
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.anisotropy = maxAnisotropy;

  const normalTexture = heightMapToNormalTexture(heightCtx, size);
  normalTexture.wrapS = THREE.RepeatWrapping;
  normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.repeat.copy(texture.repeat);
  normalTexture.anisotropy = maxAnisotropy;

  // Derive a roughness map from the same height canvas, but remapped
  // into a narrow, high band (~0.8-0.95) instead of using the raw height
  // values (~0.4-0.75) directly. The raw values made large areas of the
  // ground read as mid-glossy (roughness ~0.5), which produced an
  // obvious metal-like specular highlight when looking toward the sun.
  // Real grass/dirt is almost fully matte, so keep the base roughness
  // high and only use the height detail for a little subtle variation
  // (raised dry clumps read a hair glossier, hollows a hair more matte)
  // rather than driving the overall shininess of the ground.
  const roughnessCanvas = document.createElement('canvas');
  roughnessCanvas.width = size;
  roughnessCanvas.height = size;
  const roughnessCtx = roughnessCanvas.getContext('2d')!;
  roughnessCtx.drawImage(heightCanvas, 0, 0);
  const roughnessImageData = roughnessCtx.getImageData(0, 0, size, size);
  const roughnessData = roughnessImageData.data;
  for (let i = 0; i < roughnessData.length; i += 4) {
    const heightSample = roughnessData[i] / 255;
    const roughnessValue = 0.85 + (heightSample - 0.5) * 0.2;
    const byte = Math.max(0, Math.min(255, Math.round(roughnessValue * 255)));
    roughnessData[i] = byte;
    roughnessData[i + 1] = byte;
    roughnessData[i + 2] = byte;
  }
  roughnessCtx.putImageData(roughnessImageData, 0, 0);
  const roughnessTexture = new THREE.CanvasTexture(roughnessCanvas);
  roughnessTexture.wrapS = THREE.RepeatWrapping;
  roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.repeat.copy(texture.repeat);
  roughnessTexture.anisotropy = maxAnisotropy;

  material.map = texture;
  material.normalMap = normalTexture;
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  material.roughnessMap = roughnessTexture;
  material.roughness = 1;
  material.metalness = 0;

  applyGroundTextureBombing(material);
}

/**
 * Per-pixel "texture bombing": patches the compiled fragment shader so
 * that each texture repeat-cell independently picks one of 8 dihedral
 * transforms (4 rotations x optional mirror) of the SAME tile, keyed by
 * a hash of that cell's integer coordinate. Doing this in the fragment
 * shader (rather than baking a per-vertex UV transform, which was tried
 * earlier and reverted — see the warp comment in createGroundGeometry)
 * means every pixel independently samples the correct cell/orientation,
 * so there's no seam artifact from triangles straddling a cell boundary
 * on this mesh's comparatively coarse vertex grid.
 *
 * The dominant large-scale color patches are NOT part of the baked
 * canvas texture at all (see configureGroundTexture's comment) — they're
 * generated here as a true per-pixel procedural field: each pixel checks
 * its own repeat-cell and all 8 neighbors, and each of those cells
 * independently rolls (from a hash of its integer coordinate) a blob
 * center placed anywhere within that cell — including right at its
 * edges — plus a radius and a palette color. The nearest/strongest blob
 * within reach tints the pixel. Because blobs are generated from the
 * *cell containing their own center* and evaluated identically by every
 * neighboring pixel that's within reach, a blob straddling a cell
 * boundary is computed the same way from both sides — there's no seam,
 * and critically no fixed per-cell "shape" to rotate or frame to leave
 * blank, so it can't read as a repeating grid the way the two earlier,
 * baked-texture-based attempts did.
 */
function applyGroundTextureBombing(material: THREE.MeshStandardMaterial): void {
  // A different, smaller cell frequency than GROUND_TEXTURE_REPEAT for
  // the procedural blotch field, so its pattern doesn't line up with
  // (and reinforce the visibility of) the fine canvas texture's own
  // repeat grid. Halved again from 11.5 to 5.75 per user preference for
  // the original blotches to be twice as big again — halving the cell
  // frequency doubles every blob's size since radius is expressed as a
  // fraction of cell size.
  const blotchCellsPerRepeat = 5.75 / GROUND_TEXTURE_REPEAT;
  // A second, much coarser field for a handful of very large regional
  // patches (see groundBigBlotchField) — ~3.2 cells across the entire
  // ground plane (not the fine texture's repeat grid), so roughly
  // 3.2*3.2 ≈ 10 of these show up across the whole map.
  const bigBlotchCellsPerRepeat = 3.2 / GROUND_TEXTURE_REPEAT;

  const helperGLSL = `
    vec2 groundBombHash(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453123);
    }
    vec2 groundBombUV(vec2 uv) {
      vec2 cell = floor(uv);
      vec2 f = fract(uv) - 0.5;
      float variant = floor(groundBombHash(cell).x * 8.0);
      vec2 r;
      if (variant < 1.0) r = f;
      else if (variant < 2.0) r = vec2(-f.y, f.x);
      else if (variant < 3.0) r = vec2(-f.x, -f.y);
      else if (variant < 4.0) r = vec2(f.y, -f.x);
      else if (variant < 5.0) r = vec2(-f.x, f.y);
      else if (variant < 6.0) r = vec2(f.x, -f.y);
      else if (variant < 7.0) r = vec2(f.y, f.x);
      else r = vec2(-f.y, -f.x);
      return r + 0.5;
    }
    vec3 groundBlotchPalette(float idx) {
      // Original four variants recolored halfway toward the base tile
      // green (#3d6b35 / rgb(61,107,53)) so they read as gentler
      // regional variation rather than distinctly different patches,
      // plus two new darker-than-base variants (deep moss, dark earthy
      // shadow) added for extra variety at the other end of the range.
      if (idx < 1.0) return vec3(105.5, 128.5, 61.5) / 255.0; // dry yellow-green, halfway to base
      else if (idx < 2.0) return vec3(45.5, 81.0, 40.5) / 255.0; // shaded deep green, halfway to base
      else if (idx < 3.0) return vec3(84.0, 95.5, 49.5) / 255.0; // warm olive-brown, halfway to base
      else if (idx < 4.0) return vec3(56.5, 108.5, 55.5) / 255.0; // richer emerald, halfway to base
      else if (idx < 5.0) return vec3(22.0, 36.0, 20.0) / 255.0; // deep moss shadow, darker than base
      return vec3(34.0, 30.0, 18.0) / 255.0; // dark earthy shadow, darker than base
    }
    // Worley/cellular-noise-style scattered blob field: checks the
    // current cell plus all 8 neighbors so a blob jittered anywhere
    // within a cell (even right at its edge) still gets evaluated
    // correctly by pixels in the adjacent cell, with no seam.
    vec4 groundBlotchField(vec2 uv) {
      vec2 baseCell = floor(uv);
      vec3 bestColor = vec3(0.0);
      float bestAlpha = 0.0;
      for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
          vec2 neighborCell = baseCell + vec2(float(dx), float(dy));
          // Only about 12% of cells are skipped now (was ~a third) per
          // user preference for even more splotches; radius still
          // varies over a wide range so blobs cluster and thin out
          // irregularly instead of reading as an even polka-dot grid —
          // real terrain patches vary in both size and density, not
          // just position.
          float presence = groundBombHash(neighborCell + vec2(58.3, 2.6)).x;
          if (presence < 0.12) continue;
          vec2 jitter = groundBombHash(neighborCell + vec2(3.7, 9.1));
          vec2 center = neighborCell + jitter;
          float radiusPick = groundBombHash(neighborCell + vec2(21.4, 6.8)).x;
          float radius = mix(0.22, 0.85, radiusPick * radiusPick);
          float paletteIdx = floor(groundBombHash(neighborCell + vec2(14.2, 47.6)).x * 6.0);
          float d = distance(uv, center);
          float a = 1.0 - smoothstep(radius * 0.2, radius, d);
          if (a > bestAlpha) {
            bestAlpha = a;
            bestColor = groundBlotchPalette(paletteIdx);
          }
        }
      }
      return vec4(bestColor, bestAlpha);
    }
    // A handful (~10 across the whole ground) of very large, soft,
    // brownish-green regional patches — same Worley-style approach as
    // groundBlotchField but at a much coarser cell frequency, near-full
    // presence (almost every cell shows one), and a single muted
    // brownish-green tone rather than the smaller field's varied
    // palette, so these read as broad terrain-scale color regions
    // underneath the smaller/medium blotches rather than another
    // distinct "spot" pattern.
    vec4 groundBigBlotchField(vec2 uv) {
      vec2 baseCell = floor(uv);
      float bestAlpha = 0.0;
      for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
          vec2 neighborCell = baseCell + vec2(float(dx), float(dy));
          float presence = groundBombHash(neighborCell + vec2(88.1, 41.7)).x;
          if (presence < 0.1) continue;
          vec2 jitter = groundBombHash(neighborCell + vec2(5.3, 71.9));
          vec2 center = neighborCell + jitter;
          float radiusPick = groundBombHash(neighborCell + vec2(63.2, 12.5)).x;
          float radius = mix(0.55, 0.95, radiusPick);
          float d = distance(uv, center);
          float a = 1.0 - smoothstep(radius * 0.3, radius, d);
          if (a > bestAlpha) bestAlpha = a;
        }
      }
      vec3 brownishGreen = vec3(79.0, 84.0, 48.0) / 255.0;
      return vec4(brownishGreen, bestAlpha);
    }
  `;

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = helperGLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, groundBombUV( vMapUv ) );
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
        #endif
        diffuseColor *= sampledDiffuseColor;

        vec4 groundBigBlotch = groundBigBlotchField( vMapUv * ${bigBlotchCellsPerRepeat.toFixed(8)} );
        diffuseColor.rgb = mix( diffuseColor.rgb, groundBigBlotch.rgb, groundBigBlotch.a * 0.45 );

        vec4 groundBlotch = groundBlotchField( vMapUv * ${blotchCellsPerRepeat.toFixed(8)} );
        diffuseColor.rgb = mix( diffuseColor.rgb, groundBlotch.rgb, groundBlotch.a * 0.6 );
      #endif
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = texture2D( roughnessMap, groundBombUV( vRoughnessMapUv ) );
        roughnessFactor *= texelRoughness.g;
      #endif
      `
    );
  };
}

/** Converts a grayscale height canvas into a tangent-space normal map via a Sobel-style gradient. */
function heightMapToNormalTexture(heightCtx: CanvasRenderingContext2D, size: number): THREE.CanvasTexture {
  const heightData = heightCtx.getImageData(0, 0, size, size).data;
  const sample = (x: number, y: number) => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return heightData[(wy * size + wx) * 4] / 255;
  };

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImage = normalCtx.createImageData(size, size);

  const strength = 3.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = sample(x - 1, y);
      const right = sample(x + 1, y);
      const up = sample(x, y - 1);
      const down = sample(x, y + 1);
      const dx = (left - right) * strength;
      const dy = (up - down) * strength;
      const normal = new THREE.Vector3(dx, dy, 1).normalize();
      const i = (y * size + x) * 4;
      normalImage.data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalImage.data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalImage.data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalImage.data[i + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);

  // Normal maps encode directions, not color — must NOT be sRGB-decoded.
  return new THREE.CanvasTexture(normalCanvas);
}

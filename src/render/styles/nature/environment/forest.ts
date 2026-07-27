import * as THREE from 'three';
import { mergePositionAndColorGeometries } from './shared';
import { terrainHeightAt } from './terrain';

export interface ForestPatchDef {
  forwardX: number;
  forwardZ: number;
  distanceScale: number;
  sizeScale: number;
}

export function forestPatchDef(angleDeg: number, distanceScale: number, sizeScale: number): ForestPatchDef {
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
// ocean's bay opening (roughly 345-130°, see OCEAN_GAP_ANGLE/OCEAN_GAP_HALF_WIDTH).
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
export const FOREST_PATCH_DEFS: ForestPatchDef[] = [
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
export function createForestPatch(def: ForestPatchDef): THREE.Group {
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

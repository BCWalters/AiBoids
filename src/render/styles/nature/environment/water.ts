import * as THREE from 'three';

// The mountain ring has a deliberate gap/bay opening in this fixed
// direction (in the ring's own unscaled local space, so it always shows
// up in the same world-relative compass direction regardless of world
// size) through which the much-larger ocean plane is visible — reads as
// "the hills part around a sea inlet" rather than a random flat patch.
// Placed opposite the small lake's forward direction (see
// placeNatureEnvironment) so the two water features don't visually compete.
export const OCEAN_GAP_ANGLE = Math.atan2(0.83, 0.55);
export const OCEAN_GAP_HALF_WIDTH = 0.95; // radians, ~54° half-width (~109° full notch)
export const OCEAN_ANGLE_SPAN_MULTIPLIER = 1.95;

// Several small lakes rather than just one, each in its own compass
// direction (forwardX/forwardZ, a unit-ish vector) at its own distance
// and size — chosen to stay well clear of both the ocean's bay opening
// (~28-85° around OCEAN_GAP_ANGLE) and each other. distanceScale/sizeScale
// multiply flockScale exactly like the original single lake did.
export const LAKE_DEFS = [
  { forwardX: -0.55, forwardZ: -0.83, distanceScale: 1.8, sizeScale: 0.55 },
  { forwardX: -0.87, forwardZ: 0.5, distanceScale: 2.3, sizeScale: 0.4 },
  { forwardX: 0.77, forwardZ: -0.64, distanceScale: 2.7, sizeScale: 0.35 },
];

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
export function createOceanPatch(gapAngle: number, gapHalfWidth: number): { ocean: THREE.Mesh; beach: THREE.Mesh } {
  // Slightly wider than the mountain notch itself so the ocean is fully
  // visible through the gap with no sliver of grass peeking through at
  // the transition edges. Segment counts raised well above the original
  // (28 angular / 5 radial) — at that density the wedge's shore and
  // outer edges read as distinctly straight-faceted/"squarish" polygon
  // edges even at a distance; finer subdivision plus the per-angle
  // jitter below (a natural, uneven coastline rather than dead-straight
  // wedge facets) reads much more like a real receding coastline.
  const angleSpan = gapHalfWidth * OCEAN_ANGLE_SPAN_MULTIPLIER;
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
  const outerRadius = 12.8;
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
 * A lake patch with a soft, irregular shoreline and stable, always-visible
 * blue surface. Uses an unlit material so lake color stays readable even
 * under darker lighting/time-of-day combinations.
 */
export function createWaterPatch(): THREE.Mesh {
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

export function pushDirectionOutsideOceanOpening(
  forwardX: number,
  forwardZ: number,
  openingHalfWidth: number,
): [number, number] {
  const angle = Math.atan2(forwardZ, forwardX);
  let delta = angle - OCEAN_GAP_ANGLE;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= openingHalfWidth) {
    const boundary = OCEAN_GAP_ANGLE + Math.sign(delta || 1) * openingHalfWidth;
    return [Math.cos(boundary), Math.sin(boundary)];
  }
  return [forwardX, forwardZ];
}

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
  // More radial bands than before (was 9) since the wedge now runs much
  // farther out (outerRadius 26) — keeps the color gradient smooth and
  // gives the organic tangential bow (see the angleJitter below) enough
  // geometry to read as a curved, uneven coastline rather than facets.
  const radialBands = 14;
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
  // Extend the sea's outer edge all the way out to the ground plane's own
  // visible edge so the WATER — not a fog/haze belt or the ground beyond
  // it — is what reaches the horizon even with engine fog turned off. The
  // ground plane's world half-extent is 24 x flockScale (groundSize 30 x
  // 1.6 x 0.5) and the ocean is scaled by flockScale, so 26 pushes the
  // wedge's far rim just past the ground edge in the bay direction: with
  // fog off you see blue sea meeting the sky, with fog on the far reaches
  // still haze out naturally.
  const outerRadius = 26.0;
  // Lighter, more sky-reflective blues than the old shore/deep pair
  // (0x5fa3bd/0x0f2e46) — the deep color in particular was dark enough
  // to read as a flat near-black slab once fog dimmed the little bit of
  // shore color visible near it, rather than a sunlit sea. Matches the
  // same "lighter, sky-tinted over murky-dark" fix already applied to
  // the small lake in createWaterPatch.
  const shoreColor = new THREE.Color(0x6fb0c9);
  const deepColor = new THREE.Color(0x1d4a63);
  // Soft, sky-tinted BLUE horizon tone (not a pale grey) so the far
  // stretch of sea eases toward the color of the sky at the horizon and
  // reads as open water dissolving into the sky — rather than a grey
  // haze/fog belt between the blue water and the sky when engine fog is
  // off. Kept light and slightly desaturated so it still blends cleanly
  // into the fog color when fog IS on.
  const horizonColor = new THREE.Color(0x9dc2d8);

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

  // A second, independently smoothed jitter used to bow each radial grid
  // line TANGENTIALLY (sideways) by an amount that grows with distance
  // from shore. Without it the wedge's two side edges are dead-straight
  // radial lines and the whole sea reads as a rectangle/triangle through
  // the mountain gap; letting the sides (and the grid between them) wander
  // sideways more the farther out they go makes the water body read as an
  // organic, uneven inlet rather than a ruler-straight wedge.
  const rawAngleJitter: number[] = [];
  for (let i = 0; i < jitterCount; i++) rawAngleJitter.push((Math.random() - 0.5) * 2);
  const angleJitter = rawAngleJitter.map((v, i) => {
    const prev = rawAngleJitter[Math.max(0, i - 1)];
    const next = rawAngleJitter[Math.min(jitterCount - 1, i + 1)];
    return (prev + v * 2 + next) / 4;
  });

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };

  // Shore -> deep across the near third, hold the deep sea blue across the
  // mid-field, then ease deep -> sky-blue horizon only over the far third.
  // Because the wedge now runs all the way to the ground edge (outerRadius
  // 26) most of its visible surface stays a believable sea blue, and only
  // the far rim near the horizon lightens toward the sky — so with fog off
  // there is no grey belt, just blue water fading into blue sky.
  const colorAt = (t: number): THREE.Color => {
    if (t < 0.32) return shoreColor.clone().lerp(deepColor, t / 0.32);
    if (t < 0.62) return deepColor.clone();
    return deepColor.clone().lerp(horizonColor, (t - 0.62) / 0.38);
  };

  // Half-width of the wedge as a function of the normalized radial
  // distance t. Rather than a constant angular half-width (which makes the
  // two side edges dead-straight radial lines that read as a rectangle/
  // triangle), the width follows a smootherstep S-curve: it starts as a
  // narrow cove mouth at the shore and flares out to the full span toward
  // the horizon, with zero slope at both ends. Because each radial grid
  // line (constant seg) is laid across this growing width, the side edges
  // trace a smooth convex curve — a rounded, gradually-opening bay instead
  // of a straight-sided wedge.
  const SHORE_WIDTH_FRAC = 0.5;
  const halfWidthFrac = (t: number): number => {
    const s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep(0,1,t)
    return SHORE_WIDTH_FRAC + (1 - SHORE_WIDTH_FRAC) * s;
  };

  // Build each vertex from its angular index and radius. On top of the
  // flared half-width above, two organic distortions are layered, BOTH
  // scaled by t so they vanish at the shore (t=0) — keeping the ocean's
  // inner edge perfectly aligned with the beach strip, which reuses the
  // same `jitter` array at 0.05 amplitude and the same shore half-width
  // with no tangential offset:
  //   - radius jitter amplitude grows 0.05 -> ~0.16, so the coastline is
  //     only gently uneven near shore but the far reaches wander much
  //     more, avoiding a clean geometric arc.
  //   - a tangential (sideways) offset from `angleJitter` bows each radial
  //     grid line further so the curved sides also read as irregular.
  const vertex = (seg: number, r: number, t: number): number[] => {
    const half = angleSpan * halfWidthFrac(t);
    const baseA = gapAngle - half + (2 * half * seg) / angularSegments;
    const a = baseA + angleJitter[seg] * 0.07 * t;
    const rr = r * (1 + jitter[seg] * (0.05 + 0.11 * t));
    return [Math.cos(a) * rr, 0, Math.sin(a) * rr];
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
      const p00 = vertex(seg, r0, t0);
      const p01 = vertex(seg + 1, r0, t0);
      const p10 = vertex(seg, r1, t1);
      const p11 = vertex(seg + 1, r1, t1);
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

  // The beach must hug the ACTUAL coastline, which is NOT a constant-radius
  // arc: straight out through the cove mouth the water starts at innerRadius,
  // but past the mouth the only water at a given angle sits farther out on
  // the flared side edges. waterEdgeRadius(|φ|) returns that land/water
  // radius for any angular offset φ from the gap centre — so the sand can
  // follow the coast the whole way round the bay and up to the headlands,
  // instead of a wide flat arc that strands sand on bare grass past the
  // cove mouth (the previous "beach floating in the grass" bug).
  const shoreHalf = angleSpan * halfWidthFrac(0);
  const waterEdgeRadius = (phi: number): number => {
    if (phi <= shoreHalf) return innerRadius;
    const frac = phi / angleSpan; // target halfWidthFrac value, in (0.5, 1]
    if (frac >= 1) return outerRadius;
    // Invert the smootherstep flare numerically: find the innermost band t
    // whose half-width reaches this angle. That band's radius is where the
    // flared side edge first meets land at angle φ.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (halfWidthFrac(mid) < frac) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    return innerRadius + (outerRadius - innerRadius) * t * t;
  };
  // Match the beach's water-side jitter to the ocean's inner-arc jitter
  // (vertex() at t=0 offsets by jitter[seg] * 0.05) across the cove mouth so
  // the two edges undulate together rather than drifting apart.
  const shoreJitter = (phi: number): number => {
    const f = Math.min(1, Math.max(0, (phi + shoreHalf) / (2 * shoreHalf)));
    return 1 + jitter[Math.round(f * angularSegments)] * 0.05;
  };
  // Sweep the sand from the cove mouth up to (just under) the mountain bases
  // (gapHalfWidth is the mountains' fully-open core; +0.05 tucks the ends a
  // hair beneath the rising headlands) — following the water edge the whole
  // way so the shore reads as one continuous curved beach wrapping the bay
  // and meeting the mountains, with no bare-grass gap or floating sand.
  const beach = createBeachStrip(
    gapAngle,
    gapHalfWidth + 0.05,
    angularSegments,
    waterEdgeRadius,
    shoreJitter,
  );
  return { ocean, beach };
}

/**
 * A narrow strip of tan sand tracking the ocean's shoreline. Rather than a
 * fixed-radius arc, its water-side edge follows waterEdgeRadius(|φ|) — the
 * true land/water boundary — so it hugs the near-shore arc through the cove
 * mouth and then curves outward along the flared sides up to the mountain
 * bases, keeping sand against water the whole way round the bay instead of
 * stranding it on grass past the mouth.
 */
function createBeachStrip(
  gapAngle: number,
  phiMax: number,
  angularSegments: number,
  waterEdgeRadius: (phi: number) => number,
  shoreJitter: (phi: number) => number,
): THREE.Mesh {
  // Deliberately narrow relative to the ocean's own scale (shore radius
  // ~5.1) — a "beach line" rather than a wide coastal plain.
  const beachWidth = 0.32;
  // Push the water-side edge a touch PAST the water edge so the sand always
  // tucks slightly under the water; the beach sits a hair higher than the
  // ocean (polygonOffset below) so it draws cleanly on top with no sliver.
  const overlap = 0.1;

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
    const phi0 = -phiMax + (2 * phiMax * seg) / angularSegments;
    const phi1 = -phiMax + (2 * phiMax * (seg + 1)) / angularSegments;
    const a0 = gapAngle + phi0;
    const a1 = gapAngle + phi1;
    // Gentle, smoothed extra width jitter on the grass-side edge only (the
    // water-side edge already tracks the water) so the beach's width varies
    // a little along the shore without a jagged, sawtooth boundary.
    const wobble0 = 1 + innerJitter[seg] * 0.12;
    const wobble1 = 1 + innerJitter[seg + 1] * 0.12;
    // Water-side edge = the actual coastline radius at this angle (+overlap),
    // so the sand rises outward along the flared sides exactly with the water.
    const rOuter0 = waterEdgeRadius(Math.abs(phi0)) * shoreJitter(phi0) + overlap;
    const rOuter1 = waterEdgeRadius(Math.abs(phi1)) * shoreJitter(phi1) + overlap;
    const rInner0 = rOuter0 - beachWidth * wobble0;
    const rInner1 = rOuter1 - beachWidth * wobble1;
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

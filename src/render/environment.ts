import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

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
  water: THREE.Mesh;
  /** A much larger sea extending toward the horizon, visible through a
   * deliberate gap/bay in the mountain ring (see createMountainRing). */
  ocean: THREE.Mesh;
  sunLight: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  /** Larger, softer glow sprite rendered behind the sun disc for a warm corona effect. */
  sunHalo: THREE.Sprite;
  /** Unit vector pointing from the world toward the sun. */
  sunDirection: THREE.Vector3;
  fog: THREE.Fog;
  /** Call once per frame while nature style is active to animate clouds. */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
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

export function createNatureEnvironment(scene: THREE.Scene): NatureEnvironment {
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

  // Fixed mid-afternoon sun position (elevation ~35°, azimuth ~135°).
  const elevation = THREE.MathUtils.degToRad(35);
  const azimuth = THREE.MathUtils.degToRad(135);
  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
  skyUniforms.sunPosition.value.copy(sunPosition);

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sunLight.position.copy(sunPosition).multiplyScalar(1000);

  // The Sky shader technically has a sun disc (showSunDisc uniform), but
  // its physically-accurate angular size is only a couple of screen
  // pixels — easy to miss entirely. A simple additive glow sprite makes
  // the light source in the sky actually visible. A larger, much softer
  // halo sprite sits just behind it (rendered first, further away) to
  // give the sun a warm corona/radiance instead of a hard-edged coin.
  const SUN_DISTANCE = 15000; // inside the 20000-radius sky dome
  const sunHalo = new THREE.Sprite(createSunHaloMaterial());
  sunHalo.position.copy(sunPosition).multiplyScalar(SUN_DISTANCE - 50);
  sunHalo.scale.setScalar(6600);

  const sunSprite = new THREE.Sprite(createSunMaterial());
  sunSprite.position.copy(sunPosition).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.setScalar(5200);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  configureGroundTexture(ground.material as THREE.MeshStandardMaterial);

  // A jagged, low-poly mountain range encircling the horizon and a lake
  // patch off in the distance — cheap (a few hundred triangles total,
  // one shared flat-shaded material each) but they break up what would
  // otherwise be an infinite flat plain.
  const mountains = createMountainRing(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  const water = createWaterPatch();
  const ocean = createOceanPatch(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);

  // Pale horizon haze color (roughly matches this sky configuration's
  // horizon tone) — blended in via fog so the ground plane fades smoothly
  // into the sky instead of showing a hard, distracting edge.
  const fog = new THREE.Fog(0xf2f5f4, 1, 2);

  scene.add(sky, ground, mountains, water, ocean, sunLight, sunHalo, sunSprite);
  sky.visible = false;
  ground.visible = false;
  mountains.visible = false;
  water.visible = false;
  ocean.visible = false;
  sunLight.visible = false;
  sunHalo.visible = false;
  sunSprite.visible = false;

  return {
    sky,
    ground,
    mountains,
    water,
    ocean,
    sunLight,
    sunSprite,
    sunHalo,
    sunDirection: sunPosition.clone(),
    fog,
    update(elapsed: number) {
      skyUniforms.time.value = elapsed;
    },
    setVisible(visible: boolean) {
      sky.visible = visible;
      ground.visible = visible;
      mountains.visible = visible;
      water.visible = visible;
      ocean.visible = visible;
      sunHalo.visible = visible;
      sunLight.visible = visible;
      sunSprite.visible = visible;
      scene.fog = visible ? fog : null;
    },
    dispose() {
      scene.remove(sky, ground, mountains, water, ocean, sunLight, sunHalo, sunSprite);
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
      water.geometry.dispose();
      (water.material as THREE.MeshStandardMaterial).alphaMap?.dispose();
      (water.material as THREE.Material).dispose();
      ocean.geometry.dispose();
      (ocean.material as THREE.Material).dispose();
      (sunHalo.material as THREE.SpriteMaterial).map?.dispose();
      (sunHalo.material as THREE.Material).dispose();
      (sunSprite.material as THREE.SpriteMaterial).map?.dispose();
      (sunSprite.material as THREE.Material).dispose();
    },
  };
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
  const outerRadius = 5.6; // base, flock-scale units
  const innerRadius = 5.0; // ridge line, pulled slightly inward/forward
  const baseColor = new THREE.Color(0x8497a8);
  const peakColor = new THREE.Color(0xd7e1e6);

  // Smooth neighboring random heights so the ridge undulates gently
  // instead of spiking sharply between adjacent segments.
  const rawHeights: number[] = [];
  for (let i = 0; i < segments; i++) rawHeights.push(0.16 + Math.random() * 0.26);
  const heights = rawHeights.map((h, i) => {
    const prev = rawHeights[(i - 1 + segments) % segments];
    const next = rawHeights[(i + 1) % segments];
    return (prev + h * 2 + next) / 4;
  });

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
  const gapFalloff = gapHalfWidth * 1.6; // wider transition zone than the fully-open notch
  function angleDelta(a: number): number {
    let d = a - gapAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  function gapFactor(a: number): number {
    const d = angleDelta(a);
    if (d >= gapFalloff) return 0;
    const t = 1 - d / gapFalloff;
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

    const base0 = [Math.cos(a0) * outerRadius, 0, Math.sin(a0) * outerRadius];
    const base1 = [Math.cos(a1) * outerRadius, 0, Math.sin(a1) * outerRadius];
    const ridge0 = [Math.cos(a0) * innerRadius, h0, Math.sin(a0) * innerRadius];
    const ridge1 = [Math.cos(a1) * innerRadius, h1, Math.sin(a1) * innerRadius];

    // Two triangles per segment forming a continuous sloped strip from
    // base to ridge — side is set to DoubleSide on the material so
    // winding order (we're viewed from inside the ring) doesn't matter.
    pushTri(base0, ridge0, base1, baseColor, peakColor, baseColor);
    pushTri(ridge0, ridge1, base1, peakColor, peakColor, baseColor);
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
function createOceanPatch(gapAngle: number, gapHalfWidth: number): THREE.Mesh {
  // Slightly wider than the mountain notch itself so the ocean is fully
  // visible through the gap with no sliver of grass peeking through at
  // the transition edges.
  const angleSpan = gapHalfWidth * 1.75;
  const angularSegments = 28;
  const radialBands = 5;
  // Starts just inside the mountain ring's own (unmoved) inner/ridge
  // radius (5.0) so it tucks under the ground right where the ring's
  // gap begins, with no seam/sliver of grass. Deliberately NOT pushed
  // out further — fog.far is a fixed multiple of flockScale and this
  // radius range is tuned to stay well inside it (see the matching note
  // in createMountainRing); starting the ocean beyond ~6.5 flock-scale
  // units would put its near shore entirely past the fog's far distance,
  // rendering as a flat white/gray wall instead of a visible sea.
  const innerRadius = 4.7;
  const outerRadius = 26; // "to the horizon" — the far reach fades naturally into fog
  const shoreColor = new THREE.Color(0x5fa3bd);
  const deepColor = new THREE.Color(0x0f2e46);

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };

  for (let band = 0; band < radialBands; band++) {
    // Non-linear radial spacing (squared) bunches more geometry/color
    // detail near the shore, where it's actually visible up close, and
    // spends fewer triangles on the distant, heavily-fogged-out reaches.
    const t0 = band / radialBands;
    const t1 = (band + 1) / radialBands;
    const r0 = innerRadius + (outerRadius - innerRadius) * t0 * t0;
    const r1 = innerRadius + (outerRadius - innerRadius) * t1 * t1;
    const c0 = shoreColor.clone().lerp(deepColor, t0);
    const c1 = shoreColor.clone().lerp(deepColor, t1);

    for (let seg = 0; seg < angularSegments; seg++) {
      const a0 = gapAngle - angleSpan + (2 * angleSpan * seg) / angularSegments;
      const a1 = gapAngle - angleSpan + (2 * angleSpan * (seg + 1)) / angularSegments;
      const p00 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1];
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
    roughness: 0.15,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * A lake patch with a soft, irregular shoreline and a sky-tinted, glinting
 * surface — a flat, hard-edged, dark-teal circle read as an odd "dark
 * circle" floating on the ground rather than water. Fixed by: (1) an
 * irregular (noisy, non-circular) outline instead of a perfect circle,
 * (2) an alpha map that feathers the edge into the grass rather than
 * cutting off sharply, (3) a lighter, more sky-reflective blue base color,
 * and (4) a soft bright "sun glint" patch baked into the alpha-mapped
 * texture standing in for a specular highlight.
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

  const material = new THREE.MeshStandardMaterial({
    color: 0x5c96b0, // lighter, more sky-reflective blue-teal than the old murky dark teal
    roughness: 0.1,
    metalness: 0.25,
    transparent: true,
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
  // banding "ring" where alpha changes too abruptly.
  gradient.addColorStop(0, 'rgba(255,255,246,1)');
  gradient.addColorStop(0.18, 'rgba(255,241,199,1)');
  gradient.addColorStop(0.38, 'rgba(255,215,135,0.97)');
  gradient.addColorStop(0.6, 'rgba(255,185,90,0.6)');
  gradient.addColorStop(0.82, 'rgba(255,160,70,0.2)');
  gradient.addColorStop(1, 'rgba(255,150,60,0)');
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
  // avoid any visible ring where the falloff rate changes.
  gradient.addColorStop(0, 'rgba(255,225,165,0.32)');
  gradient.addColorStop(0.18, 'rgba(255,218,155,0.24)');
  gradient.addColorStop(0.4, 'rgba(255,208,140,0.14)');
  gradient.addColorStop(0.65, 'rgba(255,200,130,0.06)');
  gradient.addColorStop(1, 'rgba(255,195,120,0)');
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

  // Fog range scales with the flock's own size (groundSize is the huge,
  // mostly-decorative ground plane, ~30x flockScale) so the ground fades
  // out well before its physical edge, hiding the seam at the horizon.
  const flockScale = groundSize / 30;
  env.fog.near = flockScale * 2;
  env.fog.far = flockScale * 6.5;

  // Mountain ring geometry is authored in flock-scale units (radius ~4),
  // so a straight uniform scale places it just inside the fog's far
  // distance — hazy and partially faded, like real distant mountains.
  env.mountains.position.set(center.x, 0, center.z);
  env.mountains.scale.setScalar(flockScale);

  // The lake sits off in the same general direction the default camera
  // looks (see Renderer3D's initial camera offset), so it's visible
  // without needing to orbit around first — but well inside the
  // mountain ring, not overlapping its base.
  const forwardX = -0.55;
  const forwardZ = -0.83;
  // The old fixed 0.4-unit lift was negligible next to a flockScale that
  // can be in the hundreds/thousands, so the water plane sat essentially
  // coplanar with the ground underneath — causing a shimmering z-fighting
  // moiré between the two overlapping textures as the camera moved.
  // Scaling the lift with flockScale keeps a comfortably large, consistent
  // gap regardless of world size.
  const waterLift = Math.max(1, flockScale * 0.02);
  env.water.position.set(center.x + forwardX * flockScale * 1.8, waterLift, center.z + forwardZ * flockScale * 1.8);
  env.water.scale.setScalar(flockScale * 0.55);

  // Ocean is authored in the same flock-scale units as the mountain
  // ring's radius (~5-7 flock units, extending out to 26), centered on
  // the flock like the mountains/ground rather than offset like the lake
  // — its wedge shape (see createOceanPatch) is already aimed at
  // OCEAN_GAP_ANGLE, matching the bay opening carved into the mountains.
  const oceanLift = Math.max(1, flockScale * 0.015);
  env.ocean.position.set(center.x, oceanLift, center.z);
  env.ocean.scale.setScalar(flockScale);
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
function configureGroundTexture(material: THREE.MeshStandardMaterial): void {
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

  // Large, low-frequency patches (dry yellow-green and shaded deep green)
  // — these are the features that actually survive mipmapping at a
  // distance and read as ground texture rather than a solid fill. Each
  // patch is also stamped onto the height canvas (raised for dry/tall
  // clumps, sunken for shaded hollows) so the normal map derived below
  // gives the same patches real, sun-catching relief.
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 40 + Math.random() * 90;
    const dry = Math.random() < 0.5;
    const color = dry ? '150, 150, 70' : '30, 55, 28';
    drawBlob(ctx, x, y, radius, color, 0.22 + Math.random() * 0.1);
    const bump = dry ? '210, 210, 210' : '90, 90, 90';
    drawBlob(heightCtx, x, y, radius * 0.85, bump, 0.35);
  }

  // Medium-scale mottling for mid-distance variation.
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 10 + Math.random() * 22;
    const green = 70 + Math.random() * 80;
    const color = `${45 + green * 0.2}, ${green}, ${40 + green * 0.15}`;
    drawBlob(ctx, x, y, radius, color, 0.28 + Math.random() * 0.15);
    drawBlob(heightCtx, x, y, radius * 0.7, '190, 190, 190', 0.18);
  }

  // Fine speckle for close-up detail (diffuse only — too small to matter
  // for the normal map, and would just add noise).
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 20 + Math.random() * 40;
    const green = 90 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${40 + shade * 0.3}, ${green}, ${35 + shade * 0.3}, 0.5)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  const texture = new THREE.CanvasTexture(diffuseCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Lower repeat than before (was 400) so the large-scale blotches above
  // stay visibly sized on the ground instead of tiling into fine noise.
  texture.repeat.set(120, 120);
  texture.colorSpace = THREE.SRGBColorSpace;

  const normalTexture = heightMapToNormalTexture(heightCtx, size);
  normalTexture.wrapS = THREE.RepeatWrapping;
  normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.repeat.copy(texture.repeat);

  // Reuse the same height canvas as a roughness map: raised dry clumps
  // read a little glossier (fresh grass catching light), sunken hollows
  // a little rougher (shadowed, matte dirt) — subtle, but breaks up the
  // otherwise perfectly uniform specular response of a flat plane.
  const roughnessTexture = new THREE.CanvasTexture(heightCanvas);
  roughnessTexture.wrapS = THREE.RepeatWrapping;
  roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.repeat.copy(texture.repeat);

  material.map = texture;
  material.normalMap = normalTexture;
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  material.roughnessMap = roughnessTexture;
  material.roughness = 1;
  material.metalness = 0;
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

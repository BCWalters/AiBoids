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
  /** Several small lake patches, each independently sized/placed and
   * height-matched to the terrain directly beneath it (see
   * placeNatureEnvironment) so none of them appear to float. */
  lakes: THREE.Mesh[];
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
  /** Independently toggle scene fog on/off without affecting overall nature-style visibility. */
  setFogEnabled(enabled: boolean): void;
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

  const ground = new THREE.Mesh(createGroundGeometry(), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  (ground.material as THREE.MeshStandardMaterial).vertexColors = true;
  configureGroundTexture(ground.material as THREE.MeshStandardMaterial, renderer);

  // A jagged, low-poly mountain range encircling the horizon and a lake
  // patch off in the distance — cheap (a few hundred triangles total,
  // one shared flat-shaded material each) but they break up what would
  // otherwise be an infinite flat plain.
  const mountains = createMountainRing(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  const skyEnvMap = createSkyEnvMap(renderer, skyUniforms);
  const lakes = LAKE_DEFS.map(() => createWaterPatch(skyEnvMap));
  const ocean = createOceanPatch(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);

  // Pale horizon haze color (roughly matches this sky configuration's
  // horizon tone) — blended in via fog so the ground plane fades smoothly
  // into the sky instead of showing a hard, distracting edge.
  const fog = new THREE.Fog(0xf2f5f4, 1, 2);
  let fogEnabled = true;

  scene.add(sky, ground, mountains, ...lakes, ocean, sunLight, sunHalo, sunSprite);
  sky.visible = false;
  ground.visible = false;
  mountains.visible = false;
  lakes.forEach((lake) => { lake.visible = false; });
  ocean.visible = false;
  sunLight.visible = false;
  sunHalo.visible = false;
  sunSprite.visible = false;

  return {
    sky,
    ground,
    mountains,
    lakes,
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
      lakes.forEach((lake) => { lake.visible = visible; });
      ocean.visible = visible;
      sunHalo.visible = visible;
      sunLight.visible = visible;
      sunSprite.visible = visible;
      // Only actually attach fog if the environment is both visible AND
      // fog hasn't been independently disabled via setFogEnabled — track
      // the "should fog be on" intent by checking whether it's currently
      // attached (setFogEnabled sets it null when off).
      scene.fog = visible && fogEnabled ? fog : null;
    },
    setFogEnabled(enabled: boolean) {
      fogEnabled = enabled;
      scene.fog = enabled && sky.visible ? fog : null;
    },
    dispose() {
      scene.remove(sky, ground, mountains, ...lakes, ocean, sunLight, sunHalo, sunSprite);
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
      skyEnvMap.dispose();
      ocean.geometry.dispose();
      (ocean.material as THREE.Material).dispose();
      (sunHalo.material as THREE.SpriteMaterial).map?.dispose();
      (sunHalo.material as THREE.Material).dispose();
      (sunSprite.material as THREE.SpriteMaterial).map?.dispose();
      (sunSprite.material as THREE.Material).dispose();
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
  const baseColor = new THREE.Color(0x8497a8);
  const peakColor = new THREE.Color(0xd7e1e6);

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
  // instead of each concentric ring wiggling on its own.
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
  return new THREE.Mesh(geometry, material);
}

/**
 * Bakes a static, roughly-hemispherical reflection environment map from
 * the actual Sky shader (same turbidity/rayleigh/sun-position uniforms
 * as the real sky dome) using THREE.PMREMGenerator, so the lakes' subtle
 * reflectivity actually shows blue sky / horizon tones rather than a
 * generic gray IBL default. Done once, in a throwaway scene containing
 * only a cloned Sky mesh (never added to the real scene), so it costs a
 * single extra render at startup and never touches the per-frame render
 * loop — intentional, since the sky's color doesn't change enough
 * frame-to-frame (only slow cloud drift) to justify a live-updating
 * reflection for gently rippling lake water.
 */
function createSkyEnvMap(renderer: THREE.WebGLRenderer, skyUniforms: Sky['material']['uniforms']): THREE.Texture {
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(20000);
  const envUniforms = envSky.material.uniforms;
  envUniforms.turbidity.value = skyUniforms.turbidity.value;
  envUniforms.rayleigh.value = skyUniforms.rayleigh.value;
  envUniforms.mieCoefficient.value = skyUniforms.mieCoefficient.value;
  envUniforms.mieDirectionalG.value = skyUniforms.mieDirectionalG.value;
  envUniforms.cloudCoverage.value = skyUniforms.cloudCoverage.value;
  envUniforms.cloudDensity.value = skyUniforms.cloudDensity.value;
  envUniforms.cloudScale.value = skyUniforms.cloudScale.value;
  envUniforms.sunPosition.value.copy(skyUniforms.sunPosition.value);
  envUniforms.showSunDisc.value = 0;
  envScene.add(envSky);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const renderTarget = pmremGenerator.fromScene(envScene, 0, 1, 30000);
  pmremGenerator.dispose();
  envSky.geometry.dispose();
  envSky.material.dispose();
  return renderTarget.texture;
}

/**
 * A lake patch with a soft, irregular shoreline and a darker, partially
 * reflective surface — a flat, hard-edged, dark-teal circle read as an odd
 * "dark circle" floating on the ground rather than water. Fixed by: (1) an
 * irregular (noisy, non-circular) outline instead of a perfect circle,
 * (2) an alpha map that feathers the edge into the grass rather than
 * cutting off sharply, (3) a darker base color plus a static sky
 * reflection (envMap, baked once from the actual Sky shader via
 * createSkyEnvMap — see that function) so it reads as reflective water
 * rather than a flat paint swatch, and (4) a soft bright "sun glint"
 * patch baked into the alpha-mapped texture standing in for a specular
 * highlight.
 */
function createWaterPatch(envMap: THREE.Texture): THREE.Mesh {
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
    color: 0x1f4152, // darker blue-teal than the old flat medium blue, per feedback
    roughness: 0.18,
    metalness: 0.35,
    envMap,
    envMapIntensity: 0.55,
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

  // Medium-scale mottling for mid-distance variation.
  for (let i = 0; i < 200; i++) {
    const margin = 40;
    const x = margin + Math.random() * (size - margin * 2);
    const y = margin + Math.random() * (size - margin * 2);
    const radius = 10 + Math.random() * 22;
    const green = 70 + Math.random() * 80;
    const color = `${45 + green * 0.2}, ${green}, ${40 + green * 0.15}`;
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
  // repeat grid. Halved from 23 to 11.5 per user preference for larger
  // blotches — halving the cell frequency doubles every blob's size
  // since radius is expressed as a fraction of cell size.
  const blotchCellsPerRepeat = 11.5 / GROUND_TEXTURE_REPEAT;
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
          // Roughly a third of cells contribute no blob at all (and
          // radius varies over a wide range) so blobs cluster and thin
          // out irregularly instead of reading as an even polka-dot
          // grid — real terrain patches vary in both size and density,
          // not just position.
          float presence = groundBombHash(neighborCell + vec2(58.3, 2.6)).x;
          if (presence < 0.32) continue;
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

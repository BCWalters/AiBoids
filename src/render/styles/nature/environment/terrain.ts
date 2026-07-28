import * as THREE from 'three';
import { patchMaterial } from '../../../patchMaterial';

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
export function fbm2(x: number, y: number, octaves: number): number {
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
export function terrainHeightAt(fx: number, fy: number): number {
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
export function createGroundGeometry(): THREE.PlaneGeometry {
  const segments = 200;
  const geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);

  // Neutral white used to fade biome tints to nothing in the outer zone,
  // so the shader-driven horizon color has a clean surface to work with.
  const neutralWhite = new THREE.Color(1, 1, 1);

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

    // Fade vertex colors to neutral white beyond the mountain ring so
    // the grass biome tints don't bleed through the outer sea/horizon
    // zone.  The mountain ring's outer edge sits at world radius
    // ~6.1×flockScale; after the 1.6× skirt scale that corresponds to
    // local geometry radius ~0.127.  We start fading slightly before it
    // (0.10) and finish just after (0.17) to create a smooth handoff
    // to the shader-driven horizon color below.
    const localRadius = Math.sqrt(lx * lx + ly * ly);
    const outerFade = THREE.MathUtils.smoothstep(localRadius, 0.10, 0.17);
    if (outerFade > 0) tint.lerp(neutralWhite, outerFade);

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
 * Procedurally paints a tileable grass texture with multi-scale color
 * variation, plus a matching normal map and roughness map — no external
 * assets. Purely fine speckle (the original approach) all but disappears
 * once mip-mapped at typical ground-plane viewing distance, which is why
 * the ground read as a flat solid green; layering in larger low-frequency
 * blotches (which survive minification) fixes that, and deriving a bump
 * normal map from the same blotch layout adds real (if subtle) relief
 * that catches the sun light instead of looking like a flat painted mat.
 */
export function configureGroundTexture(material: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): void {
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

  // The ground is the one material in the scene that is patched but never
  // shared, so this key exists to satisfy rule 2 rather than to fix a live
  // defect: without it, three.js's program cache — which is global and keyed on
  // the cache key alone — could hand this material a program compiled for some
  // other MeshStandardMaterial that happens to produce the same parameters, or
  // hand that material this one's bombed-UV ground shader.
  patchMaterial({
    material,
    cacheKey: `aiboids-terrain-ground-v1:${GROUND_TEXTURE_REPEAT.toFixed(1)}`,
    patch: (shader) => {
      shader.fragmentShader = helperGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          // Radial horizon vignette: beyond the mountain ring (UV radius ~15.24
          // from center, where center = vec2(60,60) for repeat=120) the grass
          // texture and blotches fade out, replaced by a flat blue-grey
          // sea/horizon color that dissolves into the fog haze at the far edge.
          // Derivation: mountain outer radius 6.1 flock-units / 30 / 1.6 * 120 ≈ 15.24.
          float uvRadius = length( vMapUv - vec2( ${(GROUND_TEXTURE_REPEAT / 2).toFixed(1)}, ${(GROUND_TEXTURE_REPEAT / 2).toFixed(1)} ) );
          float horizonBlend = smoothstep( 14.0, 26.0, uvRadius );
          float horizonDepth = smoothstep( 14.0, 28.0, uvRadius );
          // Blue-grey sea color at the inner transition edge, fading toward the
          // pale fog-matching haze color (0xf2f5f4) at the outer limit — no hard
          // seam even when scene fog is disabled.
          vec3 horizonSeaColor = mix( vec3( 0.58, 0.70, 0.73 ), vec3( 0.949, 0.961, 0.957 ), horizonDepth );

          vec4 sampledDiffuseColor = texture2D( map, groundBombUV( vMapUv ) );
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
          #endif
          diffuseColor *= sampledDiffuseColor;

          // Scale blotch intensity to zero in the outer zone so no grass-colored
          // patches bleed through the horizon override.
          float innerMask = 1.0 - horizonBlend;
          vec4 groundBigBlotch = groundBigBlotchField( vMapUv * ${bigBlotchCellsPerRepeat.toFixed(8)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, groundBigBlotch.rgb, groundBigBlotch.a * 0.45 * innerMask );

          vec4 groundBlotch = groundBlotchField( vMapUv * ${blotchCellsPerRepeat.toFixed(8)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, groundBlotch.rgb, groundBlotch.a * 0.6 * innerMask );

          // Replace grass with the sea/horizon color in the outer zone.
          diffuseColor.rgb = mix( diffuseColor.rgb, horizonSeaColor, horizonBlend );
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
    },
  });
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

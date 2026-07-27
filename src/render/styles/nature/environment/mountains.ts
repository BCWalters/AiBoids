import * as THREE from 'three';
import { fbm2 } from './terrain';

/**
 * A ring of jagged, flat-shaded triangular peaks encircling the origin,
 * built in "flock scale" units (radius ~5-5.6) so it can just be
 * uniformly scaled by the flock's actual size in placeNatureEnvironment.
 * Modeled as a continuous ridge strip (not isolated spike triangles) with
 * smoothed random heights, so it reads as a low, rolling distant range
 * rather than a picket fence of witch-hat peaks. Ridge vertices are
 * tinted lighter than the base to fake aerial-perspective haze.
 */
export function createMountainRing(gapAngle: number, gapHalfWidth: number): THREE.Mesh {
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

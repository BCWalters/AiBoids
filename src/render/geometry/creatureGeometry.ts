import * as THREE from 'three';

/**
 * Shared geometry primitives used across the bird, dragon, and unicorn
 * creature geometry builders (see birdGeometry.ts, dragonGeometry.ts,
 * unicornGeometry.ts). Splitting these merge/tint helpers out into their
 * own module keeps each creature's file self-contained and lets multiple
 * agents/contributors work on separate creatures without touching a
 * single, shared 1000+ line file.
 */
export interface CreatureGeometries {
  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /** Dragon-only: a pair of clawed legs tucked under the belly, rendered
   * with the same static per-instance transform as the body (no flap). */
  legs?: THREE.BufferGeometry;
  /** Small-bird-only: the beak as its own InstancedMesh part (rather than
   * merged/vertex-baked into the body) — see birdGeometry.ts's doc
   * comment on why a shared multi-species geometry needs this instead of
   * the parrot/hawk approach of baking a fixed beak color into the body's
   * vertex colors. Rendered with the same static per-instance transform
   * as the body (no flap). */
  beak?: THREE.BufferGeometry;
}

/**
 * A minimal geometry merge that only cares about vertex positions
 * (adequate here since these are flat-colored MeshStandardMaterials with
 * no texture maps) — avoids THREE's stricter mergeGeometries(), which
 * requires every input geometry to share identical attribute sets
 * (position/normal/uv) and indexed-vs-non-indexed status, neither of
 * which line up between a LatheGeometry and a hand-authored triangle
 * soup. Recomputes normals fresh on the combined result.
 */
export function mergePositionOnlyGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = nonIndexed.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      positions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.computeVertexNormals();
  return merged;
}


/**
 * Like mergePositionOnlyGeometries, but also bakes per-vertex 'color'
 * into a single 'color' BufferAttribute spanning the whole merged result
 * — needed because a single InstancedMesh can only have one material, so
 * spatially-varying tints (e.g. a gold horn merged onto an otherwise
 * white-vertex body, or the body's own darker-purple muzzle tint) have
 * to ride along as vertex colors instead (same trick as the wings'
 * addRainbowVertexColors). If an input geometry already carries its own
 * 'color' attribute (e.g. the body, which bakes a varying muzzle tint
 * itself — see buildHorseBodyProfileGeometry), that's used as-is;
 * otherwise every vertex from that geometry falls back to the uniform
 * `color` provided for it.
 */
export function mergeGeometriesWithColor(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const { geometry, color } of parts) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const posAttr = nonIndexed.getAttribute('position');
    const colorAttr = nonIndexed.getAttribute('color');
    for (let i = 0; i < posAttr.count; i++) {
      positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      if (colorAttr) {
        colors.push(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i));
      } else {
        colors.push(color.r, color.g, color.b);
      }
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
 * Thickens a flat polygon — given as an ordered boundary ring of points
 * lying roughly in the X/Y plane (a triangle works fine as a 3-point
 * ring, a fan/quad as a 4-point ring, etc.) — into a real 3D prism:
 * duplicates the ring offset by +/-halfThickness along Z (this
 * codebase's model-local "up" axis) for top/bottom caps, and adds side
 * walls connecting corresponding ring edges. Without this, shapes like a
 * tail fan or a feather streamer are paper-thin (zero Z-extent) and
 * disappear entirely when viewed edge-on from the side — exactly the
 * "tail vanishes" bug this helper exists to fix. Winding/normals for
 * every triangle (both caps and every side wall) are resolved via an
 * outward-vs-centroid dot-product test, the same robust trick used by
 * unicornGeometry.ts's pushBoxSegment, so it works regardless of the
 * input ring's own winding order.
 */
export function extrudeRingGeometry(ring: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = ring.length;
  const half = thickness / 2;
  const top = ring.map((p) => new THREE.Vector3(p.x, p.y, p.z + half));
  const bottom = ring.map((p) => new THREE.Vector3(p.x, p.y, p.z - half));

  const centroid = new THREE.Vector3();
  ring.forEach((p) => centroid.add(p));
  centroid.divideScalar(n);

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(e1, e2);
    const triCentroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(triCentroid, centroid);
    if (normal.dot(outward) < 0) pushTri(p0, p2, p1);
    else pushTri(p0, p1, p2);
  };

  for (let i = 1; i < n - 1; i++) {
    pushOutward(top[0], top[i], top[i + 1]);
    pushOutward(bottom[0], bottom[i], bottom[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushOutward(top[i], bottom[i], bottom[j]);
    pushOutward(top[i], bottom[j], top[j]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * Like extrudeRingGeometry, but thickens the ring along local X instead
 * of Z. extrudeRingGeometry assumes its ring lies roughly in the X/Y
 * (horizontal) plane and adds dorsoventral (Z) depth — right for shapes
 * like a caudal tail fin lying flat in X/Y, but wrong for a fin whose
 * ring points all sit at X=0 and vary in Y/Z instead (e.g. a dorsal fin
 * standing straight up off the spine, or a shark's heterocercal tail
 * trailing straight back off the peduncle). Extruding those along Z (as
 * extrudeRingGeometry would) only nudges their already-dominant Y/Z
 * shape very slightly larger/smaller — it adds essentially no depth
 * along the axis that actually matters (X, the flank-to-flank
 * direction), so the fin reads as a flat, near-2D card that visually
 * vanishes when viewed close to edge-on. Thickening along X instead
 * gives these fins genuine left-right depth so they keep a visible
 * silhouette from any angle, including nearly head-on.
 */
export function extrudeRingGeometryAlongX(ring: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = ring.length;
  const half = thickness / 2;
  const front = ring.map((p) => new THREE.Vector3(p.x + half, p.y, p.z));
  const back = ring.map((p) => new THREE.Vector3(p.x - half, p.y, p.z));

  const centroid = new THREE.Vector3();
  ring.forEach((p) => centroid.add(p));
  centroid.divideScalar(n);

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const normal = new THREE.Vector3().crossVectors(e1, e2);
    const triCentroid = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(triCentroid, centroid);
    if (normal.dot(outward) < 0) pushTri(p0, p2, p1);
    else pushTri(p0, p1, p2);
  };

  for (let i = 1; i < n - 1; i++) {
    pushOutward(front[0], front[i], front[i + 1]);
    pushOutward(back[0], back[i], back[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushOutward(front[i], back[i], back[j]);
    pushOutward(front[i], back[j], front[j]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}


/**
 * A deeply hooked beak swept along a bent spine of shrinking circular
 * rings (rather than a small number of flat box segments, which read as
 * banded/faceted against a dark solid tint) — shared by parrot (macaw
 * beak) and hawk (raptor beak) geometry, since both are variations on
 * the same "hooked bird-of-prey/parrot beak" shape, just tuned with
 * different length/curvature/flattening parameters. `maxAngleDeg` is how
 * far the tip curls downward from straight-forward (+Y); a parrot's beak
 * curls much further under itself than a hawk's.
 */
export function buildHookedBeakGeometry(
  faceY: number,
  faceRadius: number,
  beakLen: number,
  maxAngleDeg: number,
  flattenRatio: number = 0.85,
  capRoot: boolean = true,
): THREE.BufferGeometry {
  const spineSamples = 9;
  const angleSegments = 8;

  const spine: { y: number; z: number; radius: number }[] = [];
  let cursorY = faceY;
  let cursorZ = 0;
  const stepLen = beakLen / spineSamples;
  for (let i = 0; i <= spineSamples; i++) {
    const t = i / spineSamples;
    spine.push({ y: cursorY, z: cursorZ, radius: faceRadius * (1 - 0.85 * Math.pow(t, 1.8)) });
    if (i === spineSamples) break;
    const angleDeg = maxAngleDeg * Math.pow((i + 0.5) / spineSamples, 1.6);
    const rad = (angleDeg * Math.PI) / 180;
    cursorY += Math.cos(rad) * stepLen;
    cursorZ -= Math.sin(rad) * stepLen;
  }

  const rings: THREE.Vector3[][] = spine.map((point) => {
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < angleSegments; j++) {
      const angle = (j / angleSegments) * Math.PI * 2;
      const x = Math.cos(angle) * point.radius;
      const z = Math.sin(angle) * point.radius * flattenRatio;
      ring.push(new THREE.Vector3(x, point.y, point.z + z));
    }
    return ring;
  });

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const pushOutwardTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, center: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const faceNormal = new THREE.Vector3().crossVectors(ab, ac);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const outward = new THREE.Vector3().subVectors(centroid, center);
    if (faceNormal.dot(outward) < 0) pushTri(a, c, b);
    else pushTri(a, b, c);
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const ringA = rings[i];
    const ringB = rings[i + 1];
    const center = new THREE.Vector3(0, (spine[i].y + spine[i + 1].y) / 2, (spine[i].z + spine[i + 1].z) / 2);
    for (let j = 0; j < angleSegments; j++) {
      const k = (j + 1) % angleSegments;
      pushOutwardTri(ringA[j], ringA[k], ringB[j], center);
      pushOutwardTri(ringA[k], ringB[k], ringB[j], center);
    }
  }

  // Blunt cap at the hooked tip so it doesn't end in a bare hole.
  const tipIndex = spine.length - 1;
  const tipRing = rings[tipIndex];
  const tipCenter = new THREE.Vector3(0, spine[tipIndex].y, spine[tipIndex].z);
  const tipCapBehind = new THREE.Vector3(0, spine[tipIndex - 1].y, spine[tipIndex - 1].z);
  for (let j = 0; j < angleSegments; j++) {
    const k = (j + 1) % angleSegments;
    pushOutwardTri(tipCenter, tipRing[j], tipRing[k], tipCapBehind);
  }

  if (capRoot) {
    // Optional root cap: useful for standalone beaks, but can create a
    // visible circular seam on species that already blend/fill the beak
    // root with surrounding face geometry.
    const rootRing = rings[0];
    const rootCenter = new THREE.Vector3(0, spine[0].y, spine[0].z);
    const rootCapAhead = new THREE.Vector3(0, spine[1].y, spine[1].z);
    for (let j = 0; j < angleSegments; j++) {
      const k = (j + 1) % angleSegments;
      pushOutwardTri(rootCenter, rootRing[k], rootRing[j], rootCapAhead);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Linearly interpolates a lathed body's own radius at a given local Y,
 * walking a profile's (y descending, matching how these profiles are
 * conventionally authored tail-to-nose) control points. Clamps to the
 * nearest end point outside the profile's own Y range. Shared by any
 * lathed-body creature that needs to root an add-on part (a dorsal fin,
 * a ridge, a horn) flush against its own actual surface rather than a
 * rough hand-picked estimate — the latter leaves a visible gap/floating
 * seam wherever the estimate doesn't quite match the real lathed radius
 * (see sharkGeometry.ts's history for the bug this was extracted to
 * avoid repeating).
 */
export function latheBodyRadiusAt(y: number, profile: THREE.Vector2[]): number {
  if (y >= profile[profile.length - 1].y) return profile[profile.length - 1].x;
  if (y <= profile[0].y) return profile[0].x;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return profile[0].x;
}

/**
 * Bakes alternating vertical stripe colors into a per-vertex 'color'
 * attribute, banding a lathed body purely by local Y position (tail at
 * -halfLen to nose at +halfLen) into `stripeCount` equal bands that
 * alternate between colorA/colorB — the butterflyfish's most
 * recognizable feature. Works on any lathe-style body (radially
 * symmetric around Y) since every vertex around a given Y ring gets the
 * same band regardless of its angle, so the stripes read identically
 * from any side. Converts to non-indexed first (like
 * mergePositionOnlyGeometries) since a LatheGeometry's default indexing
 * shares vertices between adjacent triangles that may straddle a stripe
 * boundary — sharing one color between them would smear the boundary;
 * non-indexed gives every triangle-corner its own color sample instead.
 */
export function bakeVerticalStripeColors(
  geometry: THREE.BufferGeometry,
  halfLen: number,
  stripeCount: number,
  colorA: THREE.Color,
  colorB: THREE.Color,
): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = nonIndexed.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) + halfLen) / (2 * halfLen), 0, 1);
    const band = Math.min(stripeCount - 1, Math.floor(t * stripeCount));
    const color = band % 2 === 0 ? colorA : colorB;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (nonIndexed !== geometry) geometry.dispose();
  return nonIndexed;
}

/**
 * A small paired-dot eye (two tiny spheres mirrored across the X axis) —
 * same technique as unicornGeometry.ts's buildUnicornEyesGeometry, shared
 * here so small-bird/hawk geometry can use it too. Baked as a near-black
 * vertex color so it reads correctly regardless of whatever per-instance
 * body tint a given species/individual gets (near-black stays near-black
 * under any multiply).
 */
export function buildEyeDotsGeometry(x: number, y: number, z: number, radius: number): THREE.BufferGeometry {
  const left = new THREE.SphereGeometry(radius, 8, 6);
  left.translate(x, y, z);
  const right = new THREE.SphereGeometry(radius, 8, 6);
  right.translate(-x, y, z);
  return mergePositionOnlyGeometries([left, right]);
}

/**
 * Bakes a rainbow hue gradient (violet at the wing root, red at the tip)
 * into a per-vertex 'color' attribute, read by a vertexColors-enabled
 * material — see Renderer3D's buildInstanceSet rainbowWings handling.
 * The base geometry (position-only triangle soup) is otherwise
 * untouched, so this can wrap any of the flat-shaded wing builders above.
 */
export function addRainbowVertexColors(geometry: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(Math.abs(position.getX(i)) / span, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}


/**
 * Same idea as addRainbowVertexColors, but the gradient follows straight-
 * line distance from a given root point (e.g. where the tail meets the
 * rump) rather than |x| — needed for parts like the tail whose "root to
 * tip" axis isn't a simple left-right span.
 */
export function addRainbowVertexColorsByDistance(
  geometry: THREE.BufferGeometry,
  root: THREE.Vector3,
  maxDistance: number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(vertex.distanceTo(root) / maxDistance, 0, 1);
    const hue = THREE.MathUtils.lerp(0.78, 0, t); // violet (root) -> red (tip)
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

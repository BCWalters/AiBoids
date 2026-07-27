import * as THREE from 'three';
import type { RigPartDeclaration, Triple } from '../motion/rig';

/**
 * Truly generic, cross-domain geometry primitives shared by BOTH the
 * nature-scene creatures (birds, dragons, unicorns) AND the fishtank-scene
 * creatures (fish, sharks, seahorses). Only helpers that are genuinely
 * used across both scenes live here; scene-specific helpers live in a
 * shared file within that scene instead:
 *   - bird-only shared helpers → styles/nature/geometry/birdSharedGeometry.ts
 *   - fish-only shared helpers → styles/fishtank/geometry/fishSharedGeometry.ts
 * Keeping this split clean lets multiple agents/contributors work on
 * separate creatures/scenes without colliding in one giant module.
 */
/**
 * Fraction of a legs geometry's height treated as the attachment slice when
 * locating the hip. Wide enough to catch the whole top ring of vertices,
 * narrow enough not to drift down the leg toward the foot.
 */
const ATTACHMENT_BAND_FRACTION = 0.15;

export interface CreatureGeometries {  body: THREE.BufferGeometry;
  wingLeft: THREE.BufferGeometry;
  wingRight: THREE.BufferGeometry;
  tail?: THREE.BufferGeometry;
  /**
   * Where and how the tail hinges, for the creatures whose tails sway.
   *
   * Declared here rather than in scene config for the same reason leg pivots
   * are: the attachment point is measured in this model's units, which a scene
   * cannot know. The shark learned this the hard way — swaying about the shared
   * model origin swept the fin's root through an arc wide enough to poke out
   * the side of the body, and the fix was to pivot about the fin's own root
   * (see sharkGeometry.ts). That value then had to be exported and threaded
   * back through scene config to reach the renderer; this field is where it
   * belonged all along.
   *
   * The axis is part of the geometry too: a fish's caudal fin is built to sweep
   * side-to-side about MODEL_UP, while a dragon's tail sweeps about
   * MODEL_RIGHT. Omit for tails that don't articulate — they're posed with the
   * plain body transform, so pivot and axis are meaningless for them.
   */
  tailRig?: RigPartDeclaration;
  /**
   * The creature's legs, as one or more articulated parts ordered root-first.
   *
   * Most creatures supply a single part (see singleLegPart) whose whole leg
   * group swings about one hip line. Creatures with visibly jointed legs split
   * this into a chain — upper segment, then lower segment pivoting about the
   * knee — so the joint actually bends instead of being a bend painted onto a
   * rigid plank.
   */
  legs?: CreatureLegPart[];
  /** Small-bird-only: the beak as its own InstancedMesh part (rather than
   * merged/vertex-baked into the body) — see birdGeometry.ts's doc
   * comment on why a shared multi-species geometry needs this instead of
   * the parrot/hawk approach of baking a fixed beak color into the body's
   * vertex colors. Rendered with the same static per-instance transform
   * as the body (no flap). */
  beak?: THREE.BufferGeometry;
}

/**
 * A rig part paired with the geometry it draws.
 *
 * The declaration half stays in motion/rig.ts, which is deliberately free of
 * any THREE import so rigs can be reasoned about and unit-tested as plain data.
 * Geometry is attached here, at the point where the two actually meet.
 */
export interface CreatureLegPart extends RigPartDeclaration {
  geometry: THREE.BufferGeometry;
}

/**
 * Wraps a single merged legs geometry as a one-part rig, pivoting about the
 * point where the legs actually meet the body.
 *
 * Both coordinates are measured off the geometry rather than configured.
 * Legs are modelled hanging along -Z, so the top of the bounding box gives
 * the height of the attachment; the mean Y of the vertices up at that
 * height gives its fore-aft position. Measuring beats asking each scene for
 * a hip coordinate in model units it has no way to know.
 *
 * The Y term matters more than it looks. It was originally left at 0, on the
 * assumption that a hip sits near the model origin. Birds' legs attach well
 * behind it - around y = -0.5 on a body of length 2.2 - so the hinge ran
 * about half a body-length in front of the real hip, turning a short leg
 * into a long lever. The foot sat 0.51 from that axis fore-aft but only 0.09
 * below it, so the speed-proportional tuck swung the feet up through an arc
 * of the wrong radius and buried them inside the body. Deriving Y shortens
 * the lever back to the leg's own length, which is what makes the tuck read
 * as a tuck instead of a retraction.
 *
 * Creatures that want a real jointed leg declare their pivots explicitly
 * instead of calling this.
 */
export function singleLegPart(geometry: THREE.BufferGeometry): CreatureLegPart[] {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  // An empty geometry yields a bounding box of +/-Infinity rather than a
  // degenerate one, which would otherwise propagate a non-finite pivot into
  // the matrix chain and blank the creature out.
  const hasBounds = bounds != null && Number.isFinite(bounds.max.z) && Number.isFinite(bounds.min.z);
  const hipZ = hasBounds ? bounds.max.z : 0;

  // Average across the topmost slice rather than taking a single extreme
  // vertex, so a lone spur or a stray cap vertex can't drag the hinge off
  // to one side.
  let hipY = 0;
  const position = geometry.getAttribute('position');
  if (hasBounds && position) {
    const band = (bounds.max.z - bounds.min.z) * ATTACHMENT_BAND_FRACTION;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) >= hipZ - band) {
        sum += position.getY(i);
        count++;
      }
    }
    if (count > 0) hipY = sum / count;
  }

  return [
    {
      role: 'legs',
      group: 'legs',
      geometry,
      // X stays 0: the swing axis *is* X, so left and right legs share one
      // hinge line however far apart they are stood.
      pivot: [0, hipY, hipZ],
      axis: [1, 0, 0],
      drive: { source: 'legSwing' },
    },
  ];
}

/**
 * Builds the tail's rig declaration, for tails that sway.
 *
 * A helper rather than three hand-written literals so the role/group/drive
 * fields — which are the same for every tail — can't drift apart between
 * creatures, leaving only the two values that genuinely differ per model.
 */
export function swayingTailRig({ pivot, axis }: { pivot: Triple; axis: Triple }): RigPartDeclaration {
  return { role: 'tail', group: 'tail', pivot, axis, drive: { source: 'tailSway' } };
}

/** Disposes every GPU buffer owned by a CreatureGeometries bundle. Each scene
 * renderer owns and disposes its own creature geometries, so this shared
 * helper lets them do that without duplicating the part list. */
export function disposeCreatureGeometries(geometries: CreatureGeometries): void {
  geometries.body.dispose();
  geometries.wingLeft.dispose();
  geometries.wingRight.dispose();
  geometries.tail?.dispose();
  for (const part of geometries.legs ?? []) part.geometry.dispose();
  geometries.beak?.dispose();
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
 * A flat, double-sided disc in the XZ plane at local Y = `y`, used to seal the
 * open ring a body-lathe leaves at its end tip so it no longer reads as a
 * see-through hole. Double-sided (each wedge emitted with both windings) so it
 * looks solid whether the camera sees the tip from behind or inside.
 *
 * Used to cap the tail end of both the small-bird body and the hawk body.
 * Shared here so neither geometry file needs to duplicate the function.
 */
export function buildTailCapGeometry(y: number, radius: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    positions.push(
      0, y, 0, x0, y, z0, x1, y, z1,
      0, y, 0, x1, y, z1, x0, y, z0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
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
 * Dimensions for a barrel that hides the wedge which opens at an
 * articulated joint between two box-section segments.
 *
 * Two flat, square-cut faces are only flush at exactly one angle. Rotate
 * one and a wedge opens on the outside of the bend, widening with the
 * bend angle. Before the rig work the joints never moved, so this was
 * invisible; now that they articulate it shows.
 *
 * A cylinder *about the hinge axis* is invariant under the hinge rotation,
 * exactly as a sphere is, so it covers the joint identically at every bend
 * angle with nothing to tune against a maximum angle. But it is far
 * tighter. A sphere has to bulge to the moving face's half-*diagonal* in
 * order to swallow its corners, and it then carries that same fat radius
 * across the whole joint — including the middle, where the gap only ever
 * reaches the face's half-depth. That surplus in the middle is what reads
 * as a knee pad. A barrel separates the two requirements: `radius` covers
 * the fore-aft reach, `halfLength` covers the width, and neither has to
 * pay for the other.
 *
 * `radius` is driven by the segment that *moves*, since only the moving
 * face can expose a see-through slot; where the stationary segment is
 * wider it simply presents a flat annulus of its own end face, which
 * reads as leg rather than as a hole. `halfLength` is driven by the
 * widest segment, so the barrel spans the joint's full width.
 *
 * Because the moving face's half-depth is typically no larger than the
 * stationary segment's, the barrel usually sits *within* the limb's
 * existing silhouette and adds no visible bulge at all.
 */
export function jointBarrelForBoxSection({
  movingHalfDepth,
  widestHalfWidth,
  margin = 1.03,
}: {
  movingHalfDepth: number;
  widestHalfWidth: number;
  margin?: number;
}): { radius: number; halfLength: number } {
  return { radius: movingHalfDepth * margin, halfLength: widestHalfWidth * margin };
}

/**
 * Appends a low-poly barrel to a raw position/colour buffer, for use as a
 * joint cover (see jointBarrelForBoxSection).
 *
 * The caller is responsible for placing `center` on, and aligning `axis`
 * with, the joint's rotation axis. Off-axis and the cover wobbles as the
 * joint bends instead of sitting still, which is worse than the gap it
 * was added to hide.
 */
export function pushJointBarrel(
  sink: { positions: number[]; colors: number[] },
  {
    center,
    axis,
    radius,
    halfLength,
    color,
    segments = 10,
  }: {
    center: THREE.Vector3;
    axis: THREE.Vector3;
    radius: number;
    halfLength: number;
    color: THREE.Color;
    segments?: number;
  },
): void {
  const forward = axis.clone().normalize();
  // Any two vectors perpendicular to the axis will do; pick a seed that
  // cannot be parallel to it, so the cross product never degenerates.
  const seed = Math.abs(forward.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(forward, seed).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();

  const rim = (end: number, seg: number): THREE.Vector3 => {
    const theta = (seg / segments) * Math.PI * 2;
    return center
      .clone()
      .addScaledVector(forward, end * halfLength)
      .addScaledVector(right, Math.cos(theta) * radius)
      .addScaledVector(up, Math.sin(theta) * radius);
  };

  // Wind each triangle so its normal points away from the barrel's own
  // surface, rather than trusting a hand-derived winding order to stay
  // consistent across the wall and both end caps.
  const pushOutward = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, reference: THREE.Vector3) => {
    const normal = new THREE.Vector3()
      .subVectors(p1, p0)
      .cross(new THREE.Vector3().subVectors(p2, p0));
    const outward = new THREE.Vector3().add(p0).add(p1).add(p2).divideScalar(3).sub(reference);
    const [a, b, c] = normal.dot(outward) < 0 ? [p0, p2, p1] : [p0, p1, p2];
    for (const p of [a, b, c]) {
      sink.positions.push(p.x, p.y, p.z);
      sink.colors.push(color.r, color.g, color.b);
    }
  };

  for (let seg = 0; seg < segments; seg++) {
    const a = rim(-1, seg);
    const b = rim(1, seg);
    const c = rim(1, seg + 1);
    const d = rim(-1, seg + 1);
    // Wall faces point away from the axis, so reference the axis point
    // level with the quad rather than the barrel's centre.
    const onAxis = center.clone();
    pushOutward(a, b, c, onAxis);
    pushOutward(a, c, d, onAxis);
    for (const end of [-1, 1] as const) {
      const capCenter = center.clone().addScaledVector(forward, end * halfLength);
      pushOutward(capCenter, rim(end, seg), rim(end, seg + 1), center);
    }
  }
}

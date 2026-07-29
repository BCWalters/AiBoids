import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pushJointSpheroid } from './sharedGeometry';
import {
  createUnicornGeometries,
  UNICORN_LEG_HALF_DEPTH_FRAC,
  UNICORN_LEG_HALF_WIDTH_FRAC,
  UNICORN_LEG_SIDES as LEG_SIDES,
} from '../styles/nature/geometry/unicornGeometry';

/**
 * The unicorn's knee is the first joint in the codebase that actually
 * articulates, so it is where the "two flat faces open a wedge" problem
 * first showed up. These guard the cover that hides it.
 *
 * Three things can go wrong and they pull against each other: too small and
 * the gap reappears at large bend angles; too large and it reads as a knee
 * pad; and — the failure a cylinder could never escape — the right volume in
 * the wrong shape, ending in a hard flat disc that reads as the bolt through
 * a toy limb. All three directions are asserted, because fixing any one by
 * eye is how you break the others.
 *
 * Leg dimensions come from the shipped constants rather than being restated
 * here. The previous version of this file hard-coded `WIDTH * 0.09` and
 * `WIDTH * 0.07` under a comment claiming it mirrored buildUnicornLegParts;
 * the legs were later thinned 25% to 0.0675/0.0525 and this file was not
 * updated, so its "stays within the limb" bound had been checking against a
 * limb a third fatter than the real one.
 */

const LENGTH = 10;
const WIDTH = 3;
const LEG_HALF_WIDTH = WIDTH * UNICORN_LEG_HALF_WIDTH_FRAC; // along the hinge axis
const LEG_HALF_DEPTH = WIDTH * UNICORN_LEG_HALF_DEPTH_FRAC; // perpendicular to it
// The cannon bone, the segment that moves relative to the thigh.
const MOVING_SCALE = 0.85;
// The hoof, which flares back out below the pastern.
const HOOF_SCALE = 0.92;
// Positions this close are treated as one vertex by smoothNormalsByPosition,
// which is what makes two surfaces shade as one across their join. Comfortably
// inside its 1e-4 bucket, so this measures welding rather than the bucket edge.
const WELD_TOLERANCE = 5e-5;

function verticesOf(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    out.push(new THREE.Vector3().fromBufferAttribute(position, i));
  }
  return out;
}

/**
 * Hinge-frame coordinates of a point: how far it sits ALONG the hinge axis
 * from the joint, and how far it sits OFF that axis.
 *
 * The hinge runs along X, so a bend changes neither of these. Every
 * statement made in terms of them therefore holds at every bend angle,
 * which is the entire reason a surface of revolution is the right cover.
 */
function hingeFrame(v: THREE.Vector3, joint: THREE.Vector3) {
  return {
    axial: v.x - joint.x,
    radial: Math.hypot(v.y - joint.y, v.z - joint.z),
  };
}

/** Where a point sits relative to the spheroid: <1 inside, 1 on, >1 outside. */
function spheroidDepth(v: THREE.Vector3, joint: THREE.Vector3, a: number, b: number): number {
  const { axial, radial } = hingeFrame(v, joint);
  return (axial / a) ** 2 + (radial / b) ** 2;
}

/**
 * The front leg, resolved from the rig rather than recomputed here: the hip
 * and knee are exactly the declared pivots of the two parts, so this cannot
 * drift out of step with the geometry the way restated constants do.
 *
 * Only the +X leg of the pair is considered. Both are built by the same code
 * path and differ only in the sign of their lateral offset.
 */
function frontLeg() {
  const geometries = createUnicornGeometries(LENGTH, WIDTH, new THREE.Color(0xc9a8f0));
  const upper = geometries.legs?.find((part) => part.role === 'legUpperFront');
  const lower = geometries.legs?.find((part) => part.role === 'legLowerFront');
  if (!upper?.pivot || !lower?.pivot) {
    throw new Error('expected front leg parts with declared pivots');
  }

  const upperVertices = verticesOf(upper.geometry).filter((v) => v.x > 0);
  const lowerVertices = verticesOf(lower.geometry).filter((v) => v.x > 0);

  // The declared pivots carry no X — one pivot *line* serves both legs of a
  // pair — so the lateral stations have to come from the geometry.
  //
  // The thigh flares outward from hip to knee, so it spans two different
  // stations: its innermost point is the hip ring and its outermost is the
  // knee end, each set off by the leg's own half-width.
  const upperMinX = Math.min(...upperVertices.map((v) => v.x));
  const hipX = upperMinX + LEG_HALF_WIDTH;
  // The cannon and hoof, by contrast, all sit on the knee's station, so
  // their extremes straddle it symmetrically.
  const lowerMinX = Math.min(...lowerVertices.map((v) => v.x));
  const lowerMaxX = Math.max(...lowerVertices.map((v) => v.x));
  const kneeX = (lowerMinX + lowerMaxX) / 2;
  // Check both derivations against the shipped sections before relying on
  // them, so a wrong station surfaces here rather than as a confusing
  // containment failure below. The hoof is the widest thing on the lower
  // part; the knee is outboard of the hip.
  expect((lowerMaxX - lowerMinX) / 2).toBeCloseTo(LEG_HALF_WIDTH * HOOF_SCALE, 4);
  expect(kneeX).toBeGreaterThan(hipX);

  const hip = new THREE.Vector3(hipX, upper.pivot[1], upper.pivot[2]);
  const knee = new THREE.Vector3(kneeX, lower.pivot[1], lower.pivot[2]);

  // Vertices of the upper part that lie BEYOND the knee, measured down the
  // leg. The thigh tube stops at the knee — its end rim reaches no further
  // than a rounding error past it, because the ring's own basis is
  // perpendicular to the leg — so anything past that line can only belong
  // to the knee cover.
  //
  // This matters more than it looks. The obvious alternative, "vertices
  // near the knee", cannot separate the two: the cover and the thigh's end
  // rim occupy the same neighbourhood by construction. Measuring the cover
  // through a filter that also admits thigh vertices is how an undersized
  // cover hides — the rim goes on reporting the full width the cover has
  // stopped providing.
  const legDir = new THREE.Vector3().subVectors(knee, hip).normalize();
  const distalCover = upperVertices.filter(
    (v) => new THREE.Vector3().subVectors(v, knee).dot(legDir) > LEG_HALF_DEPTH * 0.05,
  );
  expect(distalCover.length).toBeGreaterThan(0);

  return {
    hip,
    knee,
    upperVertices,
    lowerVertices,
    distalCover,
    upperAxis: upper.axis,
    lowerAxis: lower.axis,
  };
}

describe('pushJointSpheroid', () => {
  const center = new THREE.Vector3(1, 2, 3);
  const axis = new THREE.Vector3(1, 0, 0);
  const A = 0.4;
  const B = 0.3;

  const build = (over: Partial<Parameters<typeof pushJointSpheroid>[1]> = {}) => {
    const sink = { positions: [] as number[], colors: [] as number[] };
    pushJointSpheroid(sink, {
      center,
      axis,
      axialSemiAxis: A,
      radialSemiAxis: B,
      color: new THREE.Color(1, 0, 0),
      ...over,
    });
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < sink.positions.length; i += 3) {
      verts.push(new THREE.Vector3(sink.positions[i], sink.positions[i + 1], sink.positions[i + 2]));
    }
    return { sink, verts };
  };

  it('puts every vertex exactly on the spheroid', () => {
    const { sink, verts } = build();
    expect(sink.positions.length % 9).toBe(0);
    expect(sink.colors.length).toBe(sink.positions.length);
    expect(verts.length).toBeGreaterThan(0);

    for (const v of verts) {
      // On the surface, not merely inside it: a cover that sagged inward
      // anywhere would expose the joint from that direction.
      expect(spheroidDepth(v, center, A, B)).toBeCloseTo(1, 6);
    }
  });

  it('tapers to a point instead of ending in a flat cap', () => {
    const { verts } = build();
    // The property a cylinder cannot have, and the reason the knee used to
    // read as hardware. Walking out along the axis, the radial reach must
    // fall away to nothing rather than holding full radius up to a disc.
    const outermost = Math.max(...verts.map((v) => Math.abs(hingeFrame(v, center).axial)));
    expect(outermost).toBeCloseTo(A, 6);

    const atTheEnd = verts
      .filter((v) => Math.abs(hingeFrame(v, center).axial) > A * 0.99)
      .map((v) => hingeFrame(v, center).radial);
    expect(atTheEnd.length).toBeGreaterThan(0);
    expect(Math.max(...atTheEnd)).toBeLessThan(B * 0.02);

    // And the taper is progressive, not a last-moment collapse.
    const nearTheEnd = verts
      .filter((v) => Math.abs(hingeFrame(v, center).axial) > A * 0.85)
      .map((v) => hingeFrame(v, center).radial);
    expect(Math.max(...nearTheEnd)).toBeLessThan(B * 0.6);
  });

  it('is a surface of revolution, so no bend angle can expose it', () => {
    const { verts } = build();
    // Rotating the cover about the hinge maps it onto itself. Checked by
    // rotating every vertex and confirming it still satisfies the surface
    // equation — if the shape were not a surface of revolution, some
    // rotated vertex would leave it.
    for (const angle of [0.3, 1.1, Math.PI / 2, 2.7, -0.8]) {
      for (const v of verts) {
        const rotated = v
          .clone()
          .sub(center)
          .applyAxisAngle(axis.clone().normalize(), angle)
          .add(center);
        expect(spheroidDepth(rotated, center, A, B)).toBeCloseTo(1, 6);
      }
    }
  });

  it('encloses the swept section it was built from, at every bend angle', () => {
    // The cover exists to swallow the moving limb's end face. Sweep that
    // face through a full turn and confirm every point stays inside.
    const { verts } = build();
    expect(verts.length).toBeGreaterThan(0);

    for (const scale of [1, MOVING_SCALE]) {
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        // A point on the section's rim, at lateral offset and off-axis
        // offset, then rotated by the bend.
        for (const bend of [0, 0.5, 1.2, Math.PI]) {
          const lateral = Math.cos(t) * A * scale;
          const off = Math.sin(t) * B * scale;
          const p = new THREE.Vector3(
            center.x + lateral,
            center.y + Math.cos(bend) * off,
            center.z + Math.sin(bend) * off,
          );
          expect(spheroidDepth(p, center, A, B)).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it('emits no degenerate triangles, including at the poles', () => {
    const { sink } = build();
    // The end bands collapse to a point. Emitting them as quads would add a
    // zero-area triangle per segment whose normal is undefined, poisoning
    // the smoothing average exactly at the poles — where this cover has to
    // blend into the limb.
    for (let i = 0; i < sink.positions.length; i += 9) {
      const p = [0, 1, 2].map(
        (k) =>
          new THREE.Vector3(
            sink.positions[i + k * 3],
            sink.positions[i + k * 3 + 1],
            sink.positions[i + k * 3 + 2],
          ),
      );
      const area =
        new THREE.Vector3()
          .subVectors(p[1], p[0])
          .cross(new THREE.Vector3().subVectors(p[2], p[0]))
          .length() / 2;
      expect(area).toBeGreaterThan(1e-9);
    }
    expect(sink.positions.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('reproduces the limb rim exactly when told which plane it sweeps in', () => {
    // The precondition for welding the cover to the limb: a position-based
    // normal pass can only treat them as one surface if their vertices are
    // bit-for-bit equal, and a NEAR miss is worse than a wide one — the
    // geometry looks joined but the shading breaks along the join.
    //
    // The rim is not the equator. It runs pole to pole, tracing
    // (cos t * A, sin t * B) in the plane spanned by the axis and the
    // reference direction, so it is the RING count that must be half the
    // limb's side count.
    const sides = 12;
    const ref = new THREE.Vector3(0, 1, 0);
    const { verts } = build({ segments: sides, rings: sides / 2, reference: ref });

    const perp = ref.clone().projectOnPlane(axis.clone().normalize()).normalize();
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const rim = center
        .clone()
        .addScaledVector(axis.clone().normalize(), Math.cos(t) * A)
        .addScaledVector(perp, Math.sin(t) * B);
      const nearest = Math.min(...verts.map((v) => v.distanceTo(rim)));
      expect(nearest).toBeLessThan(1e-9);
    }
  });

  it('does not degenerate when the axis is the one used to seed the basis', () => {
    // The perpendicular basis is seeded from a fixed vector, so an axis
    // parallel to that seed would give a zero-length cross product and a
    // cover full of NaNs.
    for (const a of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ]) {
      const { sink } = build({ axis: a });
      expect(sink.positions.length).toBeGreaterThan(0);
      expect(sink.positions.every((n) => Number.isFinite(n))).toBe(true);
    }
  });
});

describe("the unicorn's knee cover", () => {
  it('is exactly the spheroid swept by the leg\'s own cross-section', () => {
    const { knee, distalCover } = frontLeg();

    // The single assertion that pins the cover's size AND its shape, and the
    // one that has to be measured on emitted geometry rather than restated
    // from constants.
    //
    // Rotating the thigh's end cross-section about the hinge axis sweeps the
    // spheroid with semi-axes equal to the leg's own half-width and
    // half-depth. That is not a tuned approximation, it is the exact answer,
    // and it is what buys the two properties below for free: the thigh's end
    // rim lands ON this surface at every point (cos^2 + sin^2 = 1), so there
    // is no lip and no gap, and the cover narrows exactly where the leg's
    // silhouette does.
    //
    // Scale it and the join steps; reshape it and the taper goes.
    for (const v of distalCover) {
      expect(spheroidDepth(v, knee, LEG_HALF_WIDTH, LEG_HALF_DEPTH)).toBeCloseTo(1, 5);
    }
  });

  it('covers the whole face that moves, so no gap opens at any bend angle', () => {
    const { knee, lowerVertices, distalCover } = frontLeg();

    // The cannon bone's top cap: the ring of lower-part vertices sitting on
    // the knee itself.
    const cap = lowerVertices.filter(
      (v) => hingeFrame(v, knee).radial <= LEG_HALF_DEPTH * MOVING_SCALE * 1.0001,
    );
    expect(cap.length).toBeGreaterThan(0);

    // Measure the cover actually emitted rather than assuming it, so this
    // fails if the cover shrinks out from under the cap. A cover vertex sits
    // on its own surface, so scoring it against the nominal semi-axes yields
    // the square of the ratio between actual and nominal.
    const coverDepth = Math.max(
      ...distalCover.map((v) => spheroidDepth(v, knee, LEG_HALF_WIDTH, LEG_HALF_DEPTH)),
    );
    const scale = Math.sqrt(coverDepth);

    // Containment is asserted in hinge-frame coordinates, which a bend
    // leaves unchanged — so containing the cap at rest contains it at every
    // angle. This is the whole reason the cover is a surface of revolution
    // about the hinge: it makes one measurement stand for all of them.
    for (const v of cap) {
      expect(
        spheroidDepth(v, knee, LEG_HALF_WIDTH * scale, LEG_HALF_DEPTH * scale),
      ).toBeLessThanOrEqual(1.0001);
    }
  });

  it('nothing on the thigh escapes the leg it belongs to', () => {
    const { hip, knee, upperVertices } = frontLeg();

    // The thigh part holds exactly two things: the thigh tube and the knee
    // cover. Every vertex must lie inside one or the other. This is the
    // complete statement of "the knee adds no bulge", and it needs no
    // guesswork about which vertices belong to the cover.
    //
    // A cylinder fails it outright: its cap corners sat at 0.91 of the leg's
    // half-depth while standing 0.87 of the way out along the hinge, where
    // the leg's own section has narrowed to 0.49 — outside the tube (the
    // wedge there is empty) and outside the spheroid alike.
    const axisDir = new THREE.Vector3().subVectors(knee, hip);
    const across = new THREE.Vector3(1, 0, 0);
    const along = new THREE.Vector3()
      .crossVectors(axisDir.clone().normalize(), across)
      .normalize();

    // The thigh is swept by a constant elliptical cross-section, but the leg
    // flares outward hip-to-knee so that section is NOT perpendicular to the
    // sweep. The solid is therefore an oblique generalised cylinder, and
    // membership has to be solved in its own (non-orthogonal) basis rather
    // than by projecting onto the axis.
    const basis = new THREE.Matrix3()
      .set(
        axisDir.x, across.x * LEG_HALF_WIDTH, along.x * LEG_HALF_DEPTH,
        axisDir.y, across.y * LEG_HALF_WIDTH, along.y * LEG_HALF_DEPTH,
        axisDir.z, across.z * LEG_HALF_WIDTH, along.z * LEG_HALF_DEPTH,
      )
      .invert();

    const inThighTube = (v: THREE.Vector3) => {
      const c = new THREE.Vector3().subVectors(v, hip).applyMatrix3(basis);
      return c.x >= -1e-4 && c.x <= 1 + 1e-4 && c.y ** 2 + c.z ** 2 <= 1.0001;
    };
    const inKneeCover = (v: THREE.Vector3) =>
      spheroidDepth(v, knee, LEG_HALF_WIDTH, LEG_HALF_DEPTH) <= 1.0001;

    const escaped = upperVertices.filter((v) => !inThighTube(v) && !inKneeCover(v));
    expect(escaped).toHaveLength(0);
  });

  it('meets the thigh with no lip and no step', () => {
    const { knee, distalCover } = frontLeg();

    // The thigh's end rim lands exactly ON the cover, which is what makes
    // the join seamless — so at the joint the cover must reach the leg's
    // full depth, and must not reach past it. Inflate it "for safety" and
    // the margin shows up here as a lip; shrink it and the rim overhangs a
    // step. Measured only on cover vertices: include the rim and it reports
    // the leg's depth back to you whatever the cover is doing.
    const equator = distalCover
      .filter((v) => Math.abs(hingeFrame(v, knee).axial) < LEG_HALF_WIDTH * 0.02)
      .map((v) => hingeFrame(v, knee).radial);
    expect(equator.length).toBeGreaterThan(0);
    expect(Math.max(...equator)).toBeCloseTo(LEG_HALF_DEPTH, 4);
  });

  it('tapers into the leg instead of ending in a bolt head', () => {
    const { knee, distalCover } = frontLeg();

    // Out near the lateral edge the leg's own section has narrowed to about
    // half its depth, and the cover must have narrowed with it. The cylinder
    // this replaced held 0.91 of full depth right up to a flat disc at 0.87
    // of the way out — 1.85x the leg's own depth at that station, on both
    // sides of every knee. That disc is what read as the bolt through a toy
    // limb's joint.
    const station = 0.85;
    const coverReach = distalCover
      .filter((v) => Math.abs(hingeFrame(v, knee).axial) > LEG_HALF_WIDTH * station)
      .map((v) => hingeFrame(v, knee).radial);
    expect(coverReach.length).toBeGreaterThan(0);
    expect(Math.max(...coverReach)).toBeLessThan(
      LEG_HALF_DEPTH * Math.sqrt(1 - station ** 2) * 1.05,
    );
  });

  it('welds to the thigh, so no shading seam shows at the join', () => {
    const { hip, knee, upperVertices } = frontLeg();

    // The cover and the thigh are tangent along the thigh's end rim, so the
    // shading CAN run continuously through the join — but the normal pass
    // welds by position, so it only actually does so where both surfaces put
    // a vertex on the same spot. Geometry that meets perfectly while its
    // grids disagree still looks broken: that is what put a band of faceted
    // shading right around the knee.
    //
    // The rim is not the cover's equator. It runs pole to pole, tracing
    // (cos t * halfWidth, sin t * halfDepth) about the hinge, so it is the
    // cover's RING count that has to be half the leg's side count — matching
    // the segment count instead, which is the obvious guess, fixes nothing.
    const along = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(knee, hip).normalize(), new THREE.Vector3(1, 0, 0))
      .normalize();

    for (let s = 0; s < LEG_SIDES; s++) {
      const t = (s / LEG_SIDES) * Math.PI * 2;
      const rim = knee
        .clone()
        .addScaledVector(new THREE.Vector3(1, 0, 0), Math.cos(t) * LEG_HALF_WIDTH)
        .addScaledVector(along, Math.sin(t) * LEG_HALF_DEPTH);

      // Count triangle corners landing on this rim vertex. The thigh's wall
      // alone contributes 3 (it is not capped at the knee — the cover is
      // what seals it). Anything more means the cover put a vertex here too,
      // which is what lets the two average into one normal.
      const corners = upperVertices.filter((v) => v.distanceTo(rim) < WELD_TOLERANCE).length;
      expect(corners).toBeGreaterThan(3);
    }
  });

  it('sits on the hinge axis, so the joint it covers cannot make it wobble', () => {
    const { upperAxis, lowerAxis } = frontLeg();
    // The cover lives in the thigh so it follows the hip, but it is centred
    // on the knee's pivot line and aligned to the knee's axis — the only
    // placement under which the knee's own bend leaves it fixed.
    expect(lowerAxis).toEqual([1, 0, 0]);
    expect(upperAxis).toEqual([1, 0, 0]);
  });
});

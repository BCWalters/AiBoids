import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createUnicornGeometries, UNICORN_BODY_RADIAL_SEGMENTS } from './unicornGeometry';
import { createDragonGeometries, DRAGON_BODY_RADIAL_SEGMENTS, DRAGON_TAIL_TUBE_SIDES } from './dragonGeometry';

/**
 * Smoothness regression tests for unicorn body (#247) and dragon body+tail (#262).
 *
 * Both creatures previously used too few radial/cross-section segments, making
 * their curved bodies look faceted ("robotic").  This file pins the resulting
 * vertex-count floor so a later accidental segment-count reduction is caught
 * immediately rather than after visual inspection.
 *
 * Tests import the shipped constants (UNICORN_BODY_RADIAL_SEGMENTS,
 * DRAGON_BODY_RADIAL_SEGMENTS, DRAGON_TAIL_TUBE_SIDES) — a regression that
 * lowers a constant while keeping the assertion hard-coded won't pass because
 * the geometry itself produces fewer vertices, not the constant alone.
 *
 * Polygon budget (body geometry only, triangles):
 *
 *   Creature / part          before   after   ratio
 *   ──────────────────────── ──────── ─────── ──────
 *   Unicorn body sweep          290     464    1.6×
 *   Dragon body LatheGeometry  4096    6144    1.5×
 *   Dragon tail tube            138     230    1.7×
 *
 * Merged geometry vertex counts (measured, LENGTH=2 WIDTH=0.8):
 *
 *   Geometry           before   after
 *   ─────────────────  ──────── ──────
 *   Unicorn body        1 554    2 076
 *   Dragon body        13 161   19 305
 *   Dragon tail           594      870
 *
 * Falsification: reverting UNICORN_BODY_RADIAL_SEGMENTS to 10, or
 * DRAGON_BODY_RADIAL_SEGMENTS to 32, or DRAGON_TAIL_TUBE_SIDES to 6
 * each drops the corresponding geometry's vertex count back to the "before"
 * values above, which fall below the VERTEX_FLOOR assertions below.
 */

const LENGTH = 2.0;
const WIDTH = 0.8;

// Segment-count sanity checks: verify the exported constants themselves
// are at or above the minimum that removes visible faceting.
describe('creature smoothness constants', () => {
  it('UNICORN_BODY_RADIAL_SEGMENTS is at least 16', () => {
    expect(UNICORN_BODY_RADIAL_SEGMENTS).toBeGreaterThanOrEqual(16);
  });

  it('DRAGON_BODY_RADIAL_SEGMENTS is at least 48', () => {
    expect(DRAGON_BODY_RADIAL_SEGMENTS).toBeGreaterThanOrEqual(48);
  });

  it('DRAGON_TAIL_TUBE_SIDES is at least 10', () => {
    expect(DRAGON_TAIL_TUBE_SIDES).toBeGreaterThanOrEqual(10);
  });
});

// ── Unicorn body ──────────────────────────────────────────────────────────────

/**
 * Vertex count floor that distinguishes segments=16 (2076 vertices) from the
 * old segments=10 (1554 vertices).  Dropping back to 10 puts the count below
 * 1800 and fails this assertion.
 */
const UNICORN_BODY_VERTEX_FLOOR = 1800;

describe('unicorn body smoothness (issue #247)', () => {
  let body: THREE.BufferGeometry;
  let posAttr: THREE.BufferAttribute;

  const setup = () => {
    const geoms = createUnicornGeometries(LENGTH, WIDTH);
    body = geoms.body;
    posAttr = body.getAttribute('position') as THREE.BufferAttribute;
  };

  it('body vertex count exceeds smoothness floor (body reads as round, not faceted)', () => {
    setup();
    expect(posAttr.count).toBeGreaterThanOrEqual(UNICORN_BODY_VERTEX_FLOOR);
    body.dispose();
  });

  it('body vertex count is consistent with the current UNICORN_BODY_RADIAL_SEGMENTS constant', () => {
    setup();
    // The sweep has 14 bands × segments × 2 triangles × 3 vertices = segments × 84,
    // plus a tip-cap fan of segments × 3 vertices, giving segments × 87 for the
    // body-sweep part.  The total merged geometry adds horn/ears/eyes/mane on top.
    // At UNICORN_BODY_RADIAL_SEGMENTS=16 the sweep alone contributes 1392 vertices.
    const minFromSegments = UNICORN_BODY_RADIAL_SEGMENTS * 87;
    expect(posAttr.count).toBeGreaterThanOrEqual(minFromSegments);
    body.dispose();
  });
});

// ── Dragon body ───────────────────────────────────────────────────────────────

/**
 * Vertex count floor that distinguishes radial=48 (19 305 vertices) from the
 * old radial=32 (13 161 vertices).  Dropping back to 32 puts the count below
 * 16 000 and fails this assertion.
 */
const DRAGON_BODY_VERTEX_FLOOR = 16_000;

describe('dragon body smoothness (issue #262)', () => {
  let body: THREE.BufferGeometry;
  let posAttr: THREE.BufferAttribute;

  const setup = () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    body = geoms.body;
    posAttr = body.getAttribute('position') as THREE.BufferAttribute;
  };

  it('body vertex count exceeds smoothness floor (body reads as round, not faceted)', () => {
    setup();
    expect(posAttr.count).toBeGreaterThanOrEqual(DRAGON_BODY_VERTEX_FLOOR);
    body.dispose();
  });

  it('body vertex count is consistent with the current DRAGON_BODY_RADIAL_SEGMENTS constant', () => {
    setup();
    // LatheGeometry with 65 profile points and DRAGON_BODY_RADIAL_SEGMENTS radial
    // segments produces (65-1) * DRAGON_BODY_RADIAL_SEGMENTS * 2 lateral triangles,
    // each contributing 3 non-indexed vertices = 64 * segments * 6.
    // That's the dominant contribution; the merged body total must exceed it.
    const minFromLateral = 64 * DRAGON_BODY_RADIAL_SEGMENTS * 6;
    expect(posAttr.count).toBeGreaterThanOrEqual(minFromLateral);
    body.dispose();
  });
});

// ── Dragon tail ───────────────────────────────────────────────────────────────

/**
 * Vertex count floor that distinguishes tail-tube sides=10 (870 vertices) from
 * the old sides=6 (594 vertices).  Dropping back to 6 puts the count below
 * 720 and fails this assertion.
 */
const DRAGON_TAIL_VERTEX_FLOOR = 720;

describe('dragon tail smoothness (issue #262)', () => {
  let tail: THREE.BufferGeometry;
  let posAttr: THREE.BufferAttribute;

  const setup = () => {
    const geoms = createDragonGeometries(LENGTH, WIDTH);
    tail = geoms.tail;
    posAttr = tail.getAttribute('position') as THREE.BufferAttribute;
  };

  it('tail vertex count exceeds smoothness floor (tail reads as round, not hexagonal)', () => {
    setup();
    expect(posAttr.count).toBeGreaterThanOrEqual(DRAGON_TAIL_VERTEX_FLOOR);
    tail.dispose();
  });

  it('tail vertex count is consistent with the current DRAGON_TAIL_TUBE_SIDES constant', () => {
    setup();
    // The main tail tube has 11 bands × DRAGON_TAIL_TUBE_SIDES × 2 lateral tris × 3 verts
    // = 11 * sides * 6, plus a start-cap of sides * 3 verts.
    // The total includes constant dorsal fins (5 × 36 verts = 180).
    const minFromTube = 11 * DRAGON_TAIL_TUBE_SIDES * 6 + DRAGON_TAIL_TUBE_SIDES * 3;
    expect(posAttr.count).toBeGreaterThanOrEqual(minFromTube);
    tail.dispose();
  });
});

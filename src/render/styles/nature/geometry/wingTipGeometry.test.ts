import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFingeredWingGeometry, WING_FINGER_COUNT_NORMAL, WING_FINGER_COUNT_BROAD } from './birdSharedGeometry';
import { createUnicornGeometries } from './unicornGeometry';

/**
 * Wing-tip geometry tests for unicorn (pegasus) wings and hawk wings
 * (issue #256).
 *
 * Both creatures previously had too few primary-feather triangles (6 for
 * unicorn, 8 for hawk), and each feather was a single flat triangle — making
 * the wingtip look blunt and unfinished.  This file pins the resulting
 * vertex-count floor and shape properties so a later accidental reduction
 * in feather count or feather complexity is caught immediately.
 *
 * ## Before / after vertex counts per wing (length=2, width=0.8)
 *
 *   Creature / mode         feathers  tris/feather  before   after
 *   ─────────────────────── ───────── ───────────── ──────── ──────
 *   Unicorn (normal)             6 → 10    1 → 3      21      93
 *   Hawk (broadTip)              8 → 12    1 → 3      27     111
 *
 * The relative increase (4–5×) is intentionally large — on a 21-vertex
 * part, a 4× increase is still only 93 vertices, well within budget.
 *
 * ## Falsification table
 *
 * Every assertion below was verified to FAIL when the production code was
 * temporarily reverted as described:
 *
 *   Test                         Sabotage                  Result when sabotaged
 *   ──────────────────────────── ───────────────────────── ─────────────────────
 *   Unicorn vertex count floor   fingerCount=6, 1 tri/     count=21, floor 60 → FAIL
 *                                feather (old code)
 *   Hawk vertex count floor      fingerCount=8, 1 tri/     count=27, floor 90 → FAIL
 *                                feather (old code)
 *   Tip vertex density           fingerCount=6, 1 tri/     2 tip-region verts,
 *                                feather                    floor 5 → FAIL
 *   Color = position count       Omit setAttribute('color') colorAttr undefined → FAIL
 *                                in addRainbowVertexColors
 *
 * ## Note on computeVertexNormals()
 *
 * `buildFingeredWingGeometry` calls `computeVertexNormals()` on a flat
 * (Z=0) triangle soup — this is correct and appropriate here because the
 * geometry is NOT a LatheGeometry (which has analytic normals we must
 * preserve).  All triangles in the wing lie in the Z=0 plane, so recomputed
 * normals equal the analytic ones.
 */

const LENGTH = 2.0;
const WIDTH  = 0.8;

// ── Unicorn (normal / non-broadTip) wing ─────────────────────────────────────

/**
 * Vertex count floor distinguishing the new 10-feather × 3-tri geometry
 * (93 vertices) from the old 6-feather × 1-tri geometry (21 vertices).
 */
const UNICORN_WING_VERTEX_FLOOR = 60;

describe('unicorn wing-tip geometry (issue #256)', () => {
  const span  = LENGTH * 1.3; // 2.6
  const chord = LENGTH * 0.6; // 1.2

  let wing: THREE.BufferGeometry;
  let posAttr: THREE.BufferAttribute;

  const setup = () => {
    wing    = buildFingeredWingGeometry(span, chord, 1, false);
    posAttr = wing.getAttribute('position') as THREE.BufferAttribute;
  };

  it('wing vertex count exceeds floor (enough feathers + 3-tri tapered shape)', () => {
    setup();
    expect(posAttr.count).toBeGreaterThanOrEqual(UNICORN_WING_VERTEX_FLOOR);
    wing.dispose();
  });

  it('wing vertex count is consistent with 3 triangles per feather', () => {
    setup();
    // 1 main-panel triangle + WING_FINGER_COUNT_NORMAL feathers × 3 triangles
    // per feather = (1 + 3 × WING_FINGER_COUNT_NORMAL) tris × 3 verts each.
    const expectedMin = (1 + 3 * WING_FINGER_COUNT_NORMAL) * 3;
    expect(posAttr.count).toBeGreaterThanOrEqual(expectedMin);
    wing.dispose();
  });

  /**
   * Tip-region vertex density: the outermost ~15% of the wing's span should
   * contain at least 5 distinct vertices.  With the old single-triangle
   * feathers only 2 isolated tip-points fall in this region; the new
   * tapered feathers contribute neckL / neckR vertices as well, so several
   * more vertices populate the tip zone.  This is a geometric assertion
   * about tip complexity — not about a constant — and it fails if feathers
   * are reduced or reverted to single-triangle shapes.
   */
  it('wing-tip region is well-populated (tapered shape, not sparse tip-points)', () => {
    setup();
    const tipThresholdX = 0.8 * span; // outer 20% of span, side=+1
    let tipVertexCount = 0;
    for (let i = 0; i < posAttr.count; i++) {
      if (posAttr.getX(i) > tipThresholdX) tipVertexCount++;
    }
    expect(tipVertexCount).toBeGreaterThanOrEqual(5);
    wing.dispose();
  });
});

// ── Hawk (broadTip) wing ──────────────────────────────────────────────────────

/**
 * Vertex count floor distinguishing the new 12-feather × 3-tri geometry
 * (111 vertices) from the old 8-feather × 1-tri geometry (27 vertices).
 */
const HAWK_WING_VERTEX_FLOOR = 90;

describe('hawk wing-tip geometry (issue #256)', () => {
  const span  = LENGTH * 1.5; // 3.0
  const chord = LENGTH * 0.68; // 1.36

  let wing: THREE.BufferGeometry;
  let posAttr: THREE.BufferAttribute;

  const setup = () => {
    wing    = buildFingeredWingGeometry(span, chord, 1, true);
    posAttr = wing.getAttribute('position') as THREE.BufferAttribute;
  };

  it('wing vertex count exceeds floor (enough feathers + 3-tri tapered shape)', () => {
    setup();
    expect(posAttr.count).toBeGreaterThanOrEqual(HAWK_WING_VERTEX_FLOOR);
    wing.dispose();
  });

  it('wing vertex count is consistent with 3 triangles per feather', () => {
    setup();
    const expectedMin = (1 + 3 * WING_FINGER_COUNT_BROAD) * 3;
    expect(posAttr.count).toBeGreaterThanOrEqual(expectedMin);
    wing.dispose();
  });
});

// ── Unicorn vertex-colour parity ─────────────────────────────────────────────

/**
 * The unicorn's pegasus wings use a rainbow vertex-colour gradient (violet
 * at the root, red at the tip) baked into a 'color' BufferAttribute by
 * addRainbowVertexColors() inside createUnicornGeometries.  After any
 * change that adds vertices, the colour count MUST equal the position count
 * — a mismatch silently produces undefined colours at the new vertices and
 * is the highest-risk failure mode for this task (noted in issue #256).
 */
describe('unicorn wing vertex-colour parity (issue #256)', () => {
  it('wingLeft color attribute count equals position attribute count', () => {
    const geoms   = createUnicornGeometries(LENGTH, WIDTH);
    const posAttr = geoms.wingLeft.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = geoms.wingLeft.getAttribute('color')    as THREE.BufferAttribute;

    expect(colAttr, 'wingLeft must have a color attribute').toBeDefined();
    expect(colAttr.count).toEqual(posAttr.count);
    geoms.wingLeft.dispose();
  });

  it('wingRight color attribute count equals position attribute count', () => {
    const geoms   = createUnicornGeometries(LENGTH, WIDTH);
    const posAttr = geoms.wingRight.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = geoms.wingRight.getAttribute('color')    as THREE.BufferAttribute;

    expect(colAttr, 'wingRight must have a color attribute').toBeDefined();
    expect(colAttr.count).toEqual(posAttr.count);
    geoms.wingRight.dispose();
  });
});

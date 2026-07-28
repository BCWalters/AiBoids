import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { subdivideGeometryWithAttributes } from '../../../geometry/sharedGeometry';
import { createDragonGeometries } from './dragonGeometry';
import { createUnicornGeometries } from './unicornGeometry';
import { createParrotGeometries } from './parrotGeometry';
import { createRealisticBirdGeometries } from './smallBirdGeometry';
import { createHawkGeometries } from './hawkGeometry';

/**
 * A vertex-shader displacement can only bend a surface where that surface has
 * vertices. The wing-undulation wave runs 0.7π of phase from shoulder to tip,
 * so a wing built from a handful of large triangles cannot represent it at all.
 *
 * This was shipped and visible: the dragon's finger bones are 2-ring tubes and
 * carried a straight line where the membrane was curving, so they lagged their
 * own membrane mid-stroke; the unicorn's whole wing was a 6-triangle fan with 7
 * distinct spanwise stations and snapped between poses rather than flexing.
 * The bird wings, at 600–900 stations, always read as smooth.
 *
 * No existing test could see any of this — the geometry was perfectly valid,
 * and the defect only exists in the interaction between the mesh's resolution
 * and a wave applied on the GPU.
 */

const MIN_SPANWISE_STATIONS = 60;
const SPAN_BINS = 20;

function spanwiseStations(geometry: THREE.BufferGeometry): {
  stations: number;
  emptyBins: number;
} {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  let root = Infinity;
  let tip = 0;
  const distinct = new Set<number>();
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(position.getX(i));
    root = Math.min(root, ax);
    tip = Math.max(tip, ax);
    distinct.add(Math.round(ax * 1000));
  }
  const span = tip - root;
  const bins = new Array<number>(SPAN_BINS).fill(0);
  for (const value of distinct) {
    const t = (value / 1000 - root) / span;
    bins[Math.min(SPAN_BINS - 1, Math.max(0, Math.floor(t * SPAN_BINS)))]++;
  }
  return { stations: distinct.size, emptyBins: bins.filter((b) => b === 0).length };
}

const WINGS: [string, THREE.BufferGeometry][] = [
  ['dragon', createDragonGeometries(14, 9).wingLeft],
  ['unicorn', createUnicornGeometries(12, 8, new THREE.Color(0xffffff)).wingLeft],
  ['parrot', createParrotGeometries(9.1, 6.24, 'green-focus').wingLeft],
  ['smallBird', createRealisticBirdGeometries(3.2, 2.2).wingLeft],
  ['hawk', createHawkGeometries(7.6, 5.2).wingLeft],
];

describe('wing tessellation is fine enough to carry the undulation wave', () => {
  for (const [name, wing] of WINGS) {
    it(`${name} has enough distinct spanwise stations to bend along`, () => {
      const { stations } = spanwiseStations(wing);
      expect(stations).toBeGreaterThanOrEqual(MIN_SPANWISE_STATIONS);
    });

    it(`${name} has vertices throughout the span, not just in clumps`, () => {
      // A high total is not sufficient: a wing can carry thousands of vertices
      // bunched at the root and still have nothing to bend with further out.
      // The dragon failed exactly this way before subdivision — 37 stations
      // spread so unevenly that 9 of 20 bands across the span held none at all.
      const { emptyBins } = spanwiseStations(wing);
      expect(emptyBins).toBe(0);
    });
  }
});

describe('subdivideGeometryWithAttributes', () => {
  function triangle(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 1]), 3),
    );
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    return g;
  }

  it('carries every attribute through, not just position', () => {
    // subdivideGeometryTriangles, the pre-existing helper, returns position
    // only. Using it on these wings would silently drop the dragon's membrane
    // gradient and the unicorn's rainbow.
    const out = subdivideGeometryWithAttributes(triangle(), 3);
    expect(Object.keys(out.attributes).sort()).toEqual(['color', 'normal', 'position']);
    expect(out.getAttribute('color').count).toBe(out.getAttribute('position').count);
  });

  it('is geometrically exact: every new vertex lies in its parent triangle', () => {
    // Every triangle is planar, so barycentric subdivision cannot move the
    // surface. This is what makes it safe to apply to a finished, art-directed
    // wing — the rest pose is untouched and only the wave sees the difference.
    const out = subdivideGeometryWithAttributes(triangle(), 4);
    const position = out.getAttribute('position') as THREE.BufferAttribute;
    const a = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(2, 0, 0)
      .cross(new THREE.Vector3(0, 3, 1))
      .normalize();
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
      expect(Math.abs(v.sub(a).dot(normal))).toBeLessThan(1e-6);
    }
  });

  it('keeps the bounding box, so the silhouette is unchanged', () => {
    const before = new THREE.Box3().setFromBufferAttribute(
      triangle().getAttribute('position') as THREE.BufferAttribute,
    );
    const after = new THREE.Box3().setFromBufferAttribute(
      subdivideGeometryWithAttributes(triangle(), 5).getAttribute(
        'position',
      ) as THREE.BufferAttribute,
    );
    expect(after.min.toArray()).toEqual(before.min.toArray());
    expect(after.max.toArray()).toEqual(before.max.toArray());
  });

  it('produces divisions^2 triangles per source triangle', () => {
    for (const divisions of [2, 3, 5]) {
      const out = subdivideGeometryWithAttributes(triangle(), divisions);
      expect(out.getAttribute('position').count).toBe(3 * divisions * divisions);
    }
  });

  it('keeps unit normals unit-length after interpolation', () => {
    const g = triangle();
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
    const normal = subdivideGeometryWithAttributes(g, 4).getAttribute(
      'normal',
    ) as THREE.BufferAttribute;
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('returns the geometry untouched below 2 divisions', () => {
    const g = triangle();
    expect(subdivideGeometryWithAttributes(g, 1)).toBe(g);
  });
});

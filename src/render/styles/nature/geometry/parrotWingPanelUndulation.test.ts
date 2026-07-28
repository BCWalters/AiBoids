import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createParrotGeometries } from './parrotGeometry';
import {
  measureSpanwiseExtent,
  sampleWingUndulationDisplacement,
} from '../wingUndulationShader';
import { WING_UNDULATION_CONFIG } from '../../../sceneRenderers/NatureSceneRenderer3D';

/**
 * The wing panel is bent by a vertex shader, so it can only hold the shape its
 * own vertices describe. These tests check that it is tessellated finely enough
 * to actually follow that bend, because when it was not, the flight feathers —
 * which are small enough to track the wave closely — surfaced straight through
 * it, by an amount that changed with the flap phase.
 *
 * Asserting on the panel's triangle sizes alone would be vacuous: the number
 * that matters is whether a feather ever ends up above the panel, so that is
 * what the second test measures directly.
 */
describe('parrot wing panel under flap undulation', () => {
  const LENGTH = 9.1;
  const WIDTH = 6.24;
  const CHORD = LENGTH * 0.58;
  const PANEL_HALF_THICKNESS = CHORD * 0.006;

  /** Triangles lying in one of the panel's two flat sheets. */
  const isPanelVertex = (z: number) => Math.abs(Math.abs(z) - PANEL_HALF_THICKNESS) < 1e-4;

  const readWing = () => {
    const geometries = createParrotGeometries(LENGTH, WIDTH, 'green-focus');
    const wing = geometries.wingLeft;
    const { root, span } = measureSpanwiseExtent(wing);
    const position = wing.getAttribute('position');
    const displace = (x: number, phase: number) =>
      sampleWingUndulationDisplacement({
        x,
        root,
        span,
        amplitude: span * WING_UNDULATION_CONFIG.amplitudeFraction,
        waveNumber: WING_UNDULATION_CONFIG.tipPhaseLagRad,
        phase,
      });
    return { wing, position, root, span, displace };
  };

  it('divides panel triangles small enough to follow the travelling wave', () => {
    const { position, span } = readWing();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let panelTriangles = 0;
    let longestSpanwiseEdge = 0;
    for (let t = 0; t < position.count / 3; t++) {
      a.fromBufferAttribute(position, t * 3);
      b.fromBufferAttribute(position, t * 3 + 1);
      c.fromBufferAttribute(position, t * 3 + 2);
      if (!isPanelVertex(a.z) || !isPanelVertex(b.z) || !isPanelVertex(c.z)) continue;
      panelTriangles++;
      longestSpanwiseEdge = Math.max(
        longestSpanwiseEdge,
        Math.abs(a.x - b.x),
        Math.abs(b.x - c.x),
        Math.abs(c.x - a.x),
      );
    }
    expect(panelTriangles).toBeGreaterThan(500);
    // Undivided, the fan's triangles reached from root to wingtip: 0.98 of span.
    expect(longestSpanwiseEdge / span).toBeLessThan(0.08);
  });

  it('keeps every flight feather under the panel through the whole flap cycle', () => {
    const { position, displace } = readWing();
    const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    // Upper sheet of the panel, in plan, so a feather can be tested against the
    // triangle it actually sits beneath.
    const upperPanel: THREE.Vector3[][] = [];
    const featherVertices: THREE.Vector3[] = [];
    for (let t = 0; t < position.count / 3; t++) {
      corner.forEach((v, k) => v.fromBufferAttribute(position, t * 3 + k));
      if (corner.every((v) => isPanelVertex(v.z))) {
        if (corner[0].z > 0) upperPanel.push(corner.map((v) => v.clone()));
        continue;
      }
      // The covert strip straddles the trailing edge and is meant to show above
      // the panel, so only the seated flight feathers are under test here.
      corner.forEach((v) => {
        if (v.z < -PANEL_HALF_THICKNESS) featherVertices.push(v.clone());
      });
    }
    expect(upperPanel.length).toBeGreaterThan(200);
    expect(featherVertices.length).toBeGreaterThan(200);

    const edge = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
      (px - bx) * (ay - by) - (ax - bx) * (py - by);

    let worstBreach = -Infinity;
    for (let step = 0; step < 16; step++) {
      const phase = (step / 16) * Math.PI * 2;
      for (const feather of featherVertices) {
        const featherZ = feather.z + displace(feather.x, phase);
        for (const [pa, pb, pc] of upperPanel) {
          const area = edge(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
          if (Math.abs(area) < 1e-9) continue;
          const w0 = edge(feather.x, feather.y, pb.x, pb.y, pc.x, pc.y) / area;
          const w1 = edge(feather.x, feather.y, pc.x, pc.y, pa.x, pa.y) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const panelZ =
            (pa.z + displace(pa.x, phase)) * w0 +
            (pb.z + displace(pb.x, phase)) * w1 +
            (pc.z + displace(pc.x, phase)) * w2;
          worstBreach = Math.max(worstBreach, featherZ - panelZ);
          break;
        }
      }
    }

    // Non-vacuous: some feather vertex does lie under some panel triangle, so a
    // breach would have been detected had there been one.
    expect(worstBreach).toBeGreaterThan(-Infinity);
    // Before the panel was subdivided this reached +0.554, nearly ten times
    // the depth the fan is seated at.
    expect(worstBreach).toBeLessThanOrEqual(0);
  });
});

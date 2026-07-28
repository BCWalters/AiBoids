import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { measureRootStation } from './sharedGeometry';
import { createBarracudaGeometries } from '../styles/fishtank/geometry/barracudaGeometry';

function geometryFrom(points: [number, number, number][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  return geometry;
}

describe('measureRootStation', () => {
  it('reports the root apex of a raked fin, not its bounding-box centre', () => {
    // A delta fin rooted at one point on the centreline whose tip sweeps aft.
    const fin = geometryFrom([
      [0, 10, 0],
      [4, 7, 0],
      [4, 4, 0],
    ]);
    fin.computeBoundingBox();
    const boxCentreY = (fin.boundingBox!.min.y + fin.boundingBox!.max.y) / 2;

    expect(measureRootStation(fin)).toBeCloseTo(10, 5);
    expect(boxCentreY).toBeCloseTo(7, 5);
  });

  it('averages over a root edge when the fin is seated on the flank', () => {
    const fin = geometryFrom([
      [2, 6, 0],
      [2, 4, 0],
      [6, 2, 0],
    ]);
    expect(measureRootStation(fin)).toBeCloseTo(5, 5);
  });

  it('places the barracuda pectoral well forward of its bounding-box centre', () => {
    // The two disagree by over a unit on a fin only ~3.4 units long, which is
    // the difference between the fin tracking the spine where it is attached
    // and tracking a station further aft that swings by a different amount.
    const fin = createBarracudaGeometries(30, 6).wingLeft;
    fin.computeBoundingBox();
    const boxCentreY = (fin.boundingBox!.min.y + fin.boundingBox!.max.y) / 2;
    expect(measureRootStation(fin) - boxCentreY).toBeGreaterThan(1);
  });
});

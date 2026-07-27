import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { NatureEnvironment } from '../environment';
import { placeNatureEnvironment } from '../environment';
import { FOREST_PATCH_DEFS } from './forest';
import { ROCK_CLUSTER_DEFS, ROCK_CLUSTER_FOOTPRINT_RADIUS, createRockCluster } from './rocks';
import { terrainHeightAt } from './terrain';
import {
  LAKE_DEFS,
  OCEAN_ANGLE_SPAN_MULTIPLIER,
  OCEAN_GAP_HALF_WIDTH,
  pushDirectionOutsideOceanOpening,
} from './water';

function createDummyMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
}

function createStubEnvironment(): NatureEnvironment {
  return {
    sky: createDummyMesh() as unknown as NatureEnvironment['sky'],
    ground: createDummyMesh(),
    mountains: createDummyMesh(),
    lakes: LAKE_DEFS.map(() => createDummyMesh()),
    ocean: createDummyMesh(),
    beach: createDummyMesh(),
    rocks: ROCK_CLUSTER_DEFS.map(() => createDummyMesh()),
    forestPatches: FOREST_PATCH_DEFS.map(() => new THREE.Group()),
    sunLight: new THREE.DirectionalLight(),
    sunSprite: new THREE.Sprite(),
    sunHalo: new THREE.Sprite(),
    lightShafts: Array.from({ length: 3 }, () => new THREE.Sprite()),
    sunDirection: new THREE.Vector3(0, 1, 0),
    fog: new THREE.Fog(0xffffff, 1, 2),
    update: () => undefined,
    setVisible: () => undefined,
    setFogEnabled: () => undefined,
    setTimeOfDay: () => undefined,
    setLightShaftsEnabled: () => undefined,
    dispose: () => undefined,
  };
}

describe('createRockCluster', () => {
  it('preserves the flat-shaded double-sided rock look while burying a deeper base', () => {
    const cluster = createRockCluster();
    const material = cluster.material as THREE.MeshStandardMaterial;
    const geometry = cluster.geometry as THREE.BufferGeometry;

    expect(material.flatShading).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);

    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(color.count).toBeGreaterThan(0);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    expect(box).not.toBeNull();
    expect(box!.min.y).toBeLessThan(-0.25);
    expect(box!.max.y).toBeGreaterThan(0.18);
  });
});

describe('placeNatureEnvironment rock placement', () => {
  it('anchors each rock cluster to the lowest sampled terrain under its footprint', () => {
    const env = createStubEnvironment();
    const center = new THREE.Vector3(120, 0, -80);
    const groundSize = 300;
    const flockScale = groundSize / 30;

    placeNatureEnvironment(env, center, groundSize);

    const def = ROCK_CLUSTER_DEFS[0];
    const oceanOpeningHalfWidth = OCEAN_GAP_HALF_WIDTH * OCEAN_ANGLE_SPAN_MULTIPLIER + 0.12;
    const [safeForwardX, safeForwardZ] = pushDirectionOutsideOceanOpening(
      def.forwardX,
      def.forwardZ,
      oceanOpeningHalfWidth,
    );
    const fx = safeForwardX * def.distanceScale;
    const fy = safeForwardZ * def.distanceScale;
    const footprintRadius = ROCK_CLUSTER_FOOTPRINT_RADIUS * def.sizeScale;
    const sampleOffsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7, 0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [-0.7, -0.7],
    ] as const;
    const expectedHeight = Math.min(
      ...sampleOffsets.map(([ox, oy]) => terrainHeightAt(fx + ox * footprintRadius, fy + oy * footprintRadius)),
    ) * flockScale;

    expect(env.rocks[0].position.x).toBeCloseTo(center.x + fx * flockScale, 6);
    expect(env.rocks[0].position.z).toBeCloseTo(center.z + fy * flockScale, 6);
    expect(env.rocks[0].position.y).toBeCloseTo(expectedHeight, 6);
    expect(env.rocks[0].position.y).toBeLessThanOrEqual(terrainHeightAt(fx, fy) * flockScale);
  });
});

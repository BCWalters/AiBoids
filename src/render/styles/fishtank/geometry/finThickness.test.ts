import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { FISHTANK_CREATURE_SIZES } from '../../../sceneRenderers/FishtankSceneRenderer3D';
import {
  fishtankFinThickness,
  type FinThicknessSample,
} from './fishSharedGeometry';
import {
  createBlueTangFinThicknessSamples,
  createClownfishFinThicknessSamples,
  createGoldfishFinThicknessSamples,
  createPlainFishFinThicknessSamples,
} from './smallFishGeometry';
import { createButterflyfishFinThicknessSamples } from './butterflyfishGeometry';
import { createBarracudaFinThicknessSamples } from './barracudaGeometry';
import { createSeaHorseFinThicknessSamples } from './seaHorseGeometry';
import { createSharkFinThicknessSamples } from './sharkGeometry';

function thinAxisExtent(geometry: BufferGeometry, axis: 'x' | 'z'): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return axis === 'x' ? box.max.x - box.min.x : box.max.z - box.min.z;
}

function expectFinSamplesWithinBounds(
  species: string,
  samples: FinThicknessSample[],
  bounds: { lower: number; upper: number },
): void {
  for (const sample of samples) {
    const extent = thinAxisExtent(sample.geometry, sample.thinAxis);
    expect(
      extent,
      `${species} ${sample.label} thin-axis extent ${extent.toFixed(4)} should stay genuinely 3D`,
    ).toBeGreaterThan(bounds.lower);
    expect(
      extent,
      `${species} ${sample.label} thin-axis extent ${extent.toFixed(4)} is thicker than the measured cap`,
    ).toBeLessThan(bounds.upper);
    expect(extent).toBeCloseTo(fishtankFinThickness(sample.referenceSize), 6);
    sample.geometry.dispose();
  }
}

/**
 * Absolute bounds are anchored to measured extents from the shipped scene-size
 * geometries, not to the helper under test.
 *
 * Falsification:
 *   - Restore the old per-species literals (e.g. shark main dorsal `width * 0.09`,
 *     small-fish pectoral `chord * 0.08`) and the relevant upper-bound assertion
 *     fails immediately.
 *   - Force `fishtankFinThickness()` to return 0 and the lower-bound assertion
 *     fails on every species because the fin collapses to a plane.
 */
const MEASURED_BOUNDS = {
  plainFish: { lower: 0.02, upper: 0.06 },
  goldfish: { lower: 0.01, upper: 0.029 },
  clownfish: { lower: 0.02, upper: 0.057 },
  blueTang: { lower: 0.02, upper: 0.057 },
  butterflyfish: { lower: 0.02, upper: 0.076 },
  barracuda: { lower: 0.04, upper: 0.116 },
  shark: { lower: 0.11, upper: 0.191 },
  seahorse: { lower: 0.05, upper: 0.179 },
} as const;

describe('fishtank fin thickness', () => {
  it('keeps every plain-fish fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'plain fish',
      createPlainFishFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.plainFish.length,
        FISHTANK_CREATURE_SIZES.plainFish.width,
      ),
      MEASURED_BOUNDS.plainFish,
    );
  });

  it('keeps every goldfish fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'goldfish',
      createGoldfishFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.goldfish.length,
        FISHTANK_CREATURE_SIZES.goldfish.width,
      ),
      MEASURED_BOUNDS.goldfish,
    );
  });

  it('keeps every clownfish fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'clownfish',
      createClownfishFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.smallFish.length,
        FISHTANK_CREATURE_SIZES.smallFish.width,
      ),
      MEASURED_BOUNDS.clownfish,
    );
  });

  it('keeps every blue tang fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'blue tang',
      createBlueTangFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.smallFish.length,
        FISHTANK_CREATURE_SIZES.smallFish.width,
      ),
      MEASURED_BOUNDS.blueTang,
    );
  });

  it('keeps every butterflyfish fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'butterflyfish',
      createButterflyfishFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.butterflyfish.length,
        FISHTANK_CREATURE_SIZES.butterflyfish.width,
      ),
      MEASURED_BOUNDS.butterflyfish,
    );
  });

  it('keeps every barracuda fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'barracuda',
      createBarracudaFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.barracuda.length,
        FISHTANK_CREATURE_SIZES.barracuda.width,
      ),
      MEASURED_BOUNDS.barracuda,
    );
  });

  it('keeps every shark fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'shark',
      createSharkFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.shark.length,
        FISHTANK_CREATURE_SIZES.shark.width,
      ),
      MEASURED_BOUNDS.shark,
    );
  });

  it('keeps every seahorse fin thin but 3D', () => {
    expectFinSamplesWithinBounds(
      'seahorse',
      createSeaHorseFinThicknessSamples(
        FISHTANK_CREATURE_SIZES.seahorse.length,
        FISHTANK_CREATURE_SIZES.seahorse.width,
      ),
      MEASURED_BOUNDS.seahorse,
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { CreatureGeometries } from '../geometry/sharedGeometry';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';

/**
 * The tail undulation shader used to be unicorn-only. It is now applied to every
 * nature creature that has a tail, so what is worth pinning is not that each
 * creature gets *a* config — it is that the configs still differ in the ways the
 * motion was designed around. Each assertion below stands for a specific claim
 * about the creature it describes; a config edit that breaks one is a change in
 * how that tail reads, not a broken test.
 */
describe('NatureSceneRenderer3D tail undulation config', () => {
  const dragon = {} as CreatureGeometries;
  const unicorn = {} as CreatureGeometries;

  const configFor = (geometries: CreatureGeometries) =>
    (
      NatureSceneRenderer3D.prototype as unknown as {
        tailUndulationConfigFor: (g: CreatureGeometries) => {
          upBiasFraction: number;
          amplitudeFraction: number;
          verticalAmplitudeFraction: number;
          tipPhaseLagRad: number;
          omega: number;
        };
      }
    ).tailUndulationConfigFor.call(
      {
        dragonPredatorGeometries: dragon,
        unicornPredatorGeometries: unicorn,
      } as unknown as NatureSceneRenderer3D,
      geometries,
    );

  it('gives every tailed creature an undulation, not just the unicorn', () => {
    // Birds are the fallback: anything that is not the dragon or the unicorn.
    for (const geometries of [dragon, unicorn, {} as CreatureGeometries]) {
      const config = configFor(geometries);
      expect(config.verticalAmplitudeFraction).toBeGreaterThan(0);
      expect(config.omega).toBeGreaterThan(0);
    }
  });

  it('keeps the dragon vertical-dominant, since its tail is driven not blown', () => {
    const config = configFor(dragon);
    expect(config.verticalAmplitudeFraction).toBeGreaterThan(config.amplitudeFraction * 2);
  });

  it('lets a full S-curve travel down the dragon tail but not a bird rectrix', () => {
    // The dragon tail is length * 1.75 and finely tessellated, so a lag past a
    // half period reads as a travelling wave. A rectrix is ~6 vertices from root
    // to tip, where the same lag would alias into a kink instead of a bend.
    expect(configFor(dragon).tipPhaseLagRad).toBeGreaterThan(Math.PI);
    expect(configFor({} as CreatureGeometries).tipPhaseLagRad).toBeLessThan(Math.PI * 0.5);
  });

  it('reserves speed-proportional lift for the unicorn hair tail', () => {
    // Hair streams when flown into the wind; muscle and feather do not.
    expect(configFor({} as CreatureGeometries).upBiasFraction).toBe(0);
    expect(configFor(unicorn).upBiasFraction).toBeGreaterThan(configFor(dragon).upBiasFraction);
  });
});

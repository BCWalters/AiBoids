import { describe, expect, it } from 'vitest';
import { BoidSpecies } from '../../sim/Boid';
import { PredatorSpecies } from './createSceneRendererHooks';
import { NatureSceneRenderer3D } from './NatureSceneRenderer3D';

describe('NatureSceneRenderer3D tail flare config', () => {
  it('disables flare for hawk predators while keeping flare for songbirds', () => {
    const proto = NatureSceneRenderer3D.prototype;

    const hawkMotion = proto.getPredatorMotionConfig.call(
      {} as NatureSceneRenderer3D,
      PredatorSpecies.Normal,
      {} as never,
    );
    expect(hawkMotion.tailFlareStrength).toBeUndefined();

    const songbirdMotion = proto.getBoidMotionConfig.call(
      {} as NatureSceneRenderer3D,
      BoidSpecies.Normal,
      {} as never,
      { isProfiledParrot: false },
    );
    expect(songbirdMotion.tailFlareStrength).toBeGreaterThan(0);
  });
});

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { TimeOfDayPreset } from '../../../sim/params';
import {
  createWaterUniforms,
  applyWaterWaveShader,
  updateWaterUniforms,
} from './waterWaves';
import { createGroundGeometry, configureGroundTexture, terrainHeightAt } from './environment/terrain';
import { createRockCluster, ROCK_CLUSTER_DEFS } from './environment/rocks';
import { createForestPatch, FOREST_PATCH_DEFS } from './environment/forest';
import { createMountainRing } from './environment/mountains';
import {
  OCEAN_GAP_ANGLE,
  OCEAN_GAP_HALF_WIDTH,
  OCEAN_ANGLE_SPAN_MULTIPLIER,
  LAKE_DEFS,
  createOceanPatch,
  createWaterPatch,
  pushDirectionOutsideOceanOpening,
} from './environment/water';
import { TIME_OF_DAY_SETTINGS, createSunMaterial, createSunHaloMaterial } from './environment/sky';

/**
 * "Nature" style environment: a physically-based sky dome (with a
 * built-in procedural drifting-cloud layer baked into its shader) plus a
 * textured ground plane. Both are cheap — no external image assets — and
 * only added to the scene / made visible when visualStyle is 'nature'.
 */
export interface NatureEnvironment {
  sky: Sky;
  ground: THREE.Mesh;
  mountains: THREE.Mesh;
  /** Several small lake patches, each independently sized/placed and
   * height-matched to the terrain directly beneath it (see
   * placeNatureEnvironment) so none of them appear to float. */
  lakes: THREE.Mesh[];
  /** A much larger sea extending toward the horizon, visible through a
   * deliberate gap/bay in the mountain ring (see createMountainRing). */
  ocean: THREE.Mesh;
  /** A narrow tan sand strip tracking the ocean's shoreline (see
   * createBeachStrip), sharing the exact same coastline jitter as the
   * ocean mesh so the two edges align precisely. */
  beach: THREE.Mesh;
  /** Small clusters of low-poly boulders scattered past the lakes'
   * shorelines and along the outer hillside (see ROCK_CLUSTER_DEFS),
   * each height-matched to the terrain beneath it like the lakes. */
  rocks: THREE.Mesh[];
  /** Sparse forest patches (see FOREST_PATCH_DEFS) tucked between the
   * play area and the rock/hillside bands. Each is a Group pairing a
   * flat, painted-canopy "undergrowth" disc (see createForestLitter)
   * with a merged cluster of many small rounded canopy volumes (see
   * createForestCrowns) so the patch reads as an actual bumpy mass of
   * treetops — rather than a flat cutout — from any viewing angle,
   * height-matched to the terrain like the lakes/rocks. */
  forestPatches: THREE.Group[];
  sunLight: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  /** Larger, softer glow sprite rendered behind the sun disc for a warm corona effect. */
  sunHalo: THREE.Sprite;
  lightShafts: THREE.Sprite[];
  /** Unit vector pointing from the world toward the sun. */
  sunDirection: THREE.Vector3;
  fog: THREE.Fog;
  /** Call once per frame while nature style is active to animate clouds. */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall nature-style visibility. */
  setFogEnabled(enabled: boolean): void;
  setTimeOfDay(preset: TimeOfDayPreset): void;
  setLightShaftsEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createNatureEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): NatureEnvironment {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 2.5;
  skyUniforms.rayleigh.value = 1.2;
  skyUniforms.mieCoefficient.value = 0.006;
  skyUniforms.mieDirectionalG.value = 0.8;
  skyUniforms.cloudCoverage.value = 0.4;
  skyUniforms.cloudDensity.value = 0.45;
  skyUniforms.cloudScale.value = 0.0009;
  // Slow, believable drift — the previous 0.02 crossed the whole sky in a
  // few seconds; 0.0015 was still too fast, so this is another ~6x down,
  // more like real high-altitude clouds drifting over many minutes.
  skyUniforms.cloudSpeed.value = 0.00025;
  // The Sky shader bakes in its own physically-angled sun disc, rendered
  // directly onto the (camera-independent, direction-only) sky dome. We
  // already draw our own custom sun sprite + halo at a finite world
  // distance for a bigger/warmer look — having both visible at once
  // caused a confusing second "white circle" that appears to drift
  // independently of our sprite as the camera orbits (the shader's disc
  // has zero parallax since it's direction-locked, while our sprite/halo
  // are finite-distance points that do shift slightly with the camera).
  skyUniforms.showSunDisc.value = 0;

  const SUN_DISTANCE = 15000; // inside the 20000-radius sky dome
  const sunDirection = new THREE.Vector3();
  skyUniforms.sunPosition.value.copy(sunDirection);

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sunLight.position.copy(sunDirection).multiplyScalar(1000);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.radius = 4;

  // The Sky shader technically has a sun disc (showSunDisc uniform), but
  // its physically-accurate angular size is only a couple of screen
  // pixels — easy to miss entirely. A simple additive glow sprite makes
  // the light source in the sky actually visible. A larger, much softer
  // halo sprite sits just behind it (rendered first, further away) to
  // give the sun a warm corona/radiance instead of a hard-edged coin.
  const sunHalo = new THREE.Sprite(createSunHaloMaterial());
  sunHalo.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE - 50);
  sunHalo.scale.setScalar(6600);

  const sunSprite = new THREE.Sprite(createSunMaterial());
  sunSprite.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.setScalar(5200);
  const shaftMaterial = createSunHaloMaterial();
  shaftMaterial.opacity = 0.1;
  shaftMaterial.color.setHex(0xffe4c2);
  const lightShafts = Array.from({ length: 3 }, () => {
    const shaft = new THREE.Sprite(shaftMaterial.clone());
    shaft.visible = true;
    return shaft;
  });

  const ground = new THREE.Mesh(createGroundGeometry(), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  (ground.material as THREE.MeshStandardMaterial).vertexColors = true;
  configureGroundTexture(ground.material as THREE.MeshStandardMaterial, renderer);

  // A jagged, low-poly mountain range encircling the horizon and a lake
  // patch off in the distance — cheap (a few hundred triangles total,
  // one shared flat-shaded material each) but they break up what would
  // otherwise be an infinite flat plain.
  const mountains = createMountainRing(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  mountains.castShadow = true;
  mountains.receiveShadow = true;
  const lakes = LAKE_DEFS.map(() => createWaterPatch());
  // Keep lake water from turning into near-black blotches under dense
  // moving flock shadows; reflective water reads better with direct/fog
  // lighting and env-map response, without receiving hard cast shadows.
  lakes.forEach((lake) => {
    lake.receiveShadow = false;
  });
  const { ocean, beach } = createOceanPatch(OCEAN_GAP_ANGLE, OCEAN_GAP_HALF_WIDTH);
  ocean.receiveShadow = true;
  beach.receiveShadow = true;
  // Patch the ocean material with the wave/reflection shader.  sunDirection
  // is an empty Vector3 at this point — it gets populated once
  // applyTimeOfDay('noon') runs below, and then synced every frame via
  // updateWaterUniforms inside update().
  const oceanWaterUniforms = createWaterUniforms(sunDirection);
  applyWaterWaveShader(ocean.material as THREE.MeshStandardMaterial, oceanWaterUniforms);
  const rocks = ROCK_CLUSTER_DEFS.map(() => createRockCluster());
  rocks.forEach((rock) => {
    rock.castShadow = true;
    rock.receiveShadow = true;
  });
  const forestPatches = FOREST_PATCH_DEFS.map((def) => createForestPatch(def));
  forestPatches.forEach((patch) => {
    patch.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  });

  // Pale horizon haze color (roughly matches this sky configuration's
  // horizon tone) — blended in via fog so the ground plane fades smoothly
  // into the sky instead of showing a hard, distracting edge.
  const fog = new THREE.Fog(0xf2f5f4, 1, 2);
  let fogEnabled = true;
  let shaftsEnabled = true;
  let sunDiscVisibleByTime = true;

  const applyTimeOfDay = (preset: TimeOfDayPreset): void => {
    const settings = TIME_OF_DAY_SETTINGS[preset];
    const elevation = THREE.MathUtils.degToRad(settings.elevationDeg);
    const azimuth = THREE.MathUtils.degToRad(settings.azimuthDeg);
    sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    skyUniforms.sunPosition.value.copy(sunDirection);
    skyUniforms.turbidity.value = settings.skyTurbidity;
    skyUniforms.rayleigh.value = settings.skyRayleigh;
    skyUniforms.mieCoefficient.value = settings.skyMie;
    sunLight.color.setHex(settings.sunColor);
    sunLight.intensity = settings.sunIntensity;
    sunLight.position.copy(sunDirection).multiplyScalar(1000);
    sunSprite.scale.setScalar(settings.sunSpriteScale);
    sunHalo.scale.setScalar(settings.sunHaloScale);
    sunSprite.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
    sunHalo.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE - 50);
    sunDiscVisibleByTime = preset !== 'night';
    sunSprite.visible = sky.visible && sunDiscVisibleByTime;
    sunHalo.visible = sky.visible && sunDiscVisibleByTime;
    fog.color.setHex(settings.fogColor);
    lakes.forEach((lake) => {
      const lakeMaterial = lake.material as THREE.MeshPhongMaterial;
      lakeMaterial.color.setHex(settings.lakeColor);
      lakeMaterial.opacity = settings.lakeOpacity;
    });
    lightShafts.forEach((shaft, i) => {
      shaft.material.color.setHex(settings.sunColor);
      shaft.scale.setScalar(settings.sunHaloScale * (0.55 + i * 0.23));
      const distance = SUN_DISTANCE * (0.35 + i * 0.16);
      shaft.position.copy(sunDirection).multiplyScalar(distance);
      shaft.material.opacity = preset === 'night' ? 0.02 : 0.12 - i * 0.025;
    });
  };
  applyTimeOfDay('noon');

  scene.add(sky, ground, mountains, ...lakes, ocean, beach, ...rocks, ...forestPatches, sunLight, sunHalo, sunSprite, ...lightShafts);
  sky.visible = false;
  ground.visible = false;
  mountains.visible = false;
  lakes.forEach((lake) => { lake.visible = false; });
  ocean.visible = false;
  beach.visible = false;
  rocks.forEach((rock) => { rock.visible = false; });
  forestPatches.forEach((patch) => { patch.visible = false; });
  sunLight.visible = false;
  sunHalo.visible = false;
  sunSprite.visible = false;
  lightShafts.forEach((shaft) => { shaft.visible = false; });

  return {
    sky,
    ground,
    mountains,
    lakes,
    ocean,
    beach,
    rocks,
    forestPatches,
    sunLight,
    sunSprite,
    sunHalo,
    lightShafts,
    sunDirection,
    fog,
    update(elapsed: number) {
      skyUniforms.time.value = elapsed;
      updateWaterUniforms(oceanWaterUniforms, elapsed, sunDirection, sunLight.color);
    },
    setVisible(visible: boolean) {
      sky.visible = visible;
      ground.visible = visible;
      mountains.visible = visible;
      lakes.forEach((lake) => { lake.visible = visible; });
      ocean.visible = visible;
      beach.visible = visible;
      rocks.forEach((rock) => { rock.visible = visible; });
      forestPatches.forEach((patch) => { patch.visible = visible; });
      sunHalo.visible = visible && sunDiscVisibleByTime;
      sunLight.visible = visible;
      sunSprite.visible = visible && sunDiscVisibleByTime;
      lightShafts.forEach((shaft) => {
        shaft.visible = visible && shaftsEnabled;
      });
      // Only actually attach fog if the environment is both visible AND
      // fog hasn't been independently disabled via setFogEnabled — track
      // the "should fog be on" intent by checking whether it's currently
      // attached (setFogEnabled sets it null when off).
      scene.fog = visible && fogEnabled ? fog : null;
    },
    setFogEnabled(enabled: boolean) {
      fogEnabled = enabled;
      // Guarded by sky.visible so this only touches scene.fog while nature
      // is the active style — Renderer3D calls setFogEnabled on both
      // environments every frame regardless of which is active, and
      // unconditionally assigning here would clobber whichever fog the
      // other (currently-visible) environment just set.
      if (sky.visible) scene.fog = enabled ? fog : null;
    },
    setTimeOfDay(preset: TimeOfDayPreset) {
      applyTimeOfDay(preset);
    },
    setLightShaftsEnabled(enabled: boolean) {
      shaftsEnabled = enabled;
      lightShafts.forEach((shaft) => {
        shaft.visible = sky.visible && enabled;
      });
    },
    dispose() {
      scene.remove(sky, ground, mountains, ...lakes, ocean, beach, ...rocks, ...forestPatches, sunLight, sunHalo, sunSprite, ...lightShafts);
      if (scene.fog === fog) scene.fog = null;
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.MeshStandardMaterial).map?.dispose();
      (ground.material as THREE.MeshStandardMaterial).normalMap?.dispose();
      (ground.material as THREE.MeshStandardMaterial).roughnessMap?.dispose();
      (ground.material as THREE.Material).dispose();
      mountains.geometry.dispose();
      (mountains.material as THREE.Material).dispose();
      for (const lake of lakes) {
        lake.geometry.dispose();
        (lake.material as THREE.MeshStandardMaterial).alphaMap?.dispose();
        (lake.material as THREE.Material).dispose();
      }
      ocean.geometry.dispose();
      (ocean.material as THREE.Material).dispose();
      beach.geometry.dispose();
      (beach.material as THREE.Material).dispose();
      for (const rock of rocks) {
        rock.geometry.dispose();
        (rock.material as THREE.Material).dispose();
      }
      for (const patch of forestPatches) {
        for (const child of patch.children) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.map?.dispose();
          material.alphaMap?.dispose();
          material.dispose();
        }
      }
      (sunHalo.material as THREE.SpriteMaterial).map?.dispose();
      (sunHalo.material as THREE.Material).dispose();
      (sunSprite.material as THREE.SpriteMaterial).map?.dispose();
      (sunSprite.material as THREE.Material).dispose();
      for (const shaft of lightShafts) {
        (shaft.material as THREE.SpriteMaterial).map?.dispose();
        (shaft.material as THREE.Material).dispose();
      }
    },
  };
}

/** Repositions the sky dome and ground plane to surround/underlie a given world center + size. */
export function placeNatureEnvironment(env: NatureEnvironment, center: THREE.Vector3, groundSize: number): void {
  env.sky.position.set(center.x, 0, center.z);
  env.ground.position.set(center.x, 0, center.z);
  env.ground.scale.setScalar(groundSize);

  const SUN_DISTANCE = 15000;
  env.sunSprite.position.copy(env.sunDirection).multiplyScalar(SUN_DISTANCE).add(center);
  env.sunHalo.position.copy(env.sunDirection).multiplyScalar(SUN_DISTANCE - 50).add(center);
  env.lightShafts.forEach((shaft, i) => {
    const distance = SUN_DISTANCE * (0.35 + i * 0.16);
    shaft.position.copy(env.sunDirection).multiplyScalar(distance).add(center);
  });

  // Fog range scales with the flock's own size (groundSize is the huge,
  // mostly-decorative ground plane, ~30x flockScale) so the ground fades
  // out well before its physical edge, hiding the seam at the horizon.
  //
  // Far was previously kept just past the mountain ring's own radius
  // (7.2x) to avoid a "visible flat plain beyond the ridge" gap — but
  // the ocean wedge (createOceanPatch) actually extends out to radius
  // 12x flockScale, so most of the ocean's surface (everything past
  // 7.2x) sat beyond fog.far and rendered as a completely solid wall of
  // fog color. Pushing far out to just past the ocean's own outer edge
  // (~13x) lets its already-built-in shore->deep->horizon color gradient
  // (see createOceanPatch) do the final blend into the sky, with engine
  // fog only adding gentle atmospheric haze on top rather than a hard
  // cutoff.
  //
  // But pulling near out to 6.5x (past the mountain ring's own 5.4-6.1x
  // radius) left the ring with *zero* haze at all — crisp enough that
  // its low-poly faceted silhouette became distractingly obvious rather
  // than reading as a hazy, softened distant ridge. Pulling near back in
  // to 3.5x (well before the ring) puts the mountains partway into the
  // fog gradient again — a light-but-present haze that rounds off the
  // facets — while still keeping far out near the ocean's true edge so
  // the "solid wall blocking the ocean" bug doesn't return.
  const flockScale = groundSize / 30;
  env.fog.near = flockScale * 3.5;
  env.fog.far = flockScale * 14.2;

  // Mountain ring geometry is authored in flock-scale units (radius ~6),
  // so a straight uniform scale places it just inside the fog's far
  // distance — hazy and partially faded, like real distant mountains.
  env.mountains.position.set(center.x, 0, center.z);
  env.mountains.scale.setScalar(flockScale);

  // Each lake sits in its own compass direction (see LAKE_DEFS) so they
  // spread naturally around the play area instead of clustering. Height
  // is sampled directly from the same terrain displacement function used
  // to build the ground mesh (terrainHeightAt) rather than a fixed lift —
  // previously the lake used a constant small offset regardless of the
  // actual terrain height beneath it, so once the ground gained real
  // rolling hills/valleys the lake would either sink into a hill or
  // visibly float above a hollow. Sampling the real terrain height at
  // the lake's own position and adding only a small consistent lift on
  // top (to avoid z-fighting with the grass) keeps it sitting right on
  // the surface everywhere.
  const waterLift = Math.max(1, flockScale * 0.02);
  const oceanOpeningHalfWidth = OCEAN_GAP_HALF_WIDTH * OCEAN_ANGLE_SPAN_MULTIPLIER + 0.12;
  env.lakes.forEach((lake, i) => {
    const def = LAKE_DEFS[i];
    const [safeForwardX, safeForwardZ] = pushDirectionOutsideOceanOpening(
      def.forwardX,
      def.forwardZ,
      oceanOpeningHalfWidth,
    );
    const fx = safeForwardX * def.distanceScale;
    const fy = safeForwardZ * def.distanceScale;
    // World-space terrain height at this point = terrainHeightAt() *
    // flockScale (matches the ground mesh's own local-Z / GROUND_UNIT_SCALE
    // correction in createGroundGeometry — see that function's comment).
    // This used to multiply by flockScale * GROUND_UNIT_SCALE instead,
    // a stray extra GROUND_UNIT_SCALE (30x) factor that placed lakes
    // hundreds to over a thousand world units below/above the actual
    // terrain surface beneath them (measured as low as y ≈ -968 in a
    // ~700-unit-tall world) — invisible, buried lakes, not floating ones.
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    lake.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight + waterLift,
      center.z + fy * flockScale,
    );
    lake.scale.setScalar(flockScale * def.sizeScale);
  });

  // Ocean is authored in the same flock-scale units as the mountain
  // ring's radius (~5-7 flock units, extending out to 9), centered on
  // the flock like the mountains/ground rather than offset like the lake
  // — its wedge shape (see createOceanPatch) is already aimed at
  // OCEAN_GAP_ANGLE, matching the bay opening carved into the mountains.
  const oceanLift = Math.max(1, flockScale * 0.015);
  env.ocean.position.set(center.x, oceanLift, center.z);
  env.ocean.scale.setScalar(flockScale);

  // Beach sits right at the same fixed lift as the ocean, matched to the
  // same center/scale so its shared-jitter shoreline (see
  // createBeachStrip) lines up with the ocean's edge exactly. A hair
  // higher than the ocean lift so the sand doesn't get submerged under
  // the water plane at their shared boundary.
  env.beach.position.set(center.x, oceanLift * 1.2, center.z);
  env.beach.scale.setScalar(flockScale);

  // Rock clusters follow the exact same terrain-following placement as
  // the lakes (sample terrainHeightAt at the cluster's own position
  // rather than a fixed lift) so they sit right on the actual hillside
  // surface everywhere instead of floating above a hollow or sinking
  // into a hill.
  env.rocks.forEach((rock, i) => {
    const def = ROCK_CLUSTER_DEFS[i];
    const [safeForwardX, safeForwardZ] = pushDirectionOutsideOceanOpening(
      def.forwardX,
      def.forwardZ,
      oceanOpeningHalfWidth,
    );
    const fx = safeForwardX * def.distanceScale;
    const fy = safeForwardZ * def.distanceScale;
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    rock.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight,
      center.z + fy * flockScale,
    );
    rock.scale.setScalar(flockScale * def.sizeScale);
  });

  // Forest patches: the group (litter + crown cluster) is anchored at
  // the same single terrainHeightAt sample the rocks use, but unlike the
  // rocks, individual canopy crowns within a large patch additionally
  // sample their *own* local terrain height relative to this anchor (see
  // createForestCrowns) so a big patch's canopy still follows real
  // undulation across its footprint instead of assuming the ground is
  // perfectly flat underneath it.
  env.forestPatches.forEach((patch, i) => {
    const def = FOREST_PATCH_DEFS[i];
    const [safeForwardX, safeForwardZ] = pushDirectionOutsideOceanOpening(
      def.forwardX,
      def.forwardZ,
      oceanOpeningHalfWidth + Math.min(0.22, def.sizeScale * 0.45),
    );
    const fx = safeForwardX * def.distanceScale;
    const fy = safeForwardZ * def.distanceScale;
    const terrainWorldHeight = terrainHeightAt(fx, fy) * flockScale;
    patch.position.set(
      center.x + fx * flockScale,
      terrainWorldHeight,
      center.z + fy * flockScale,
    );
    patch.scale.setScalar(flockScale * def.sizeScale);
  });
}

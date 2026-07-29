import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { params, type TimeOfDayPreset, type VisualStyle } from '../sim/params';
import {
  createColorGradingPass,
  applyColorGradingPreset,
  COLOR_GRADING_PRESETS,
} from './colorGradingPass';
import type { Simulation } from '../sim/Simulation';
import { BOID_SPECIES, BoidSpecies } from '../sim/Boid';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { CreatureGeometries } from './geometry/sharedGeometry';
import {
  createPredatorInstanceKey,
  createPredatorRenderFlags,
  createStyleFlags,
  type BoidMotionStyleFlags,
  isPredatorSpecies,
  PredatorSpecies,
  type PredatorRenderFlags,
  SCENE_PREDATOR_SPECIES,
  SCENE_STYLES,
  type SceneEnvironmentToggles,
  type FishUndulationConfig,
  type SceneRendererHooks,
  type StyleFlags,
  type CreatureLabels,
} from './sceneRenderers/createSceneRendererHooks';
import { createRendererSceneAssets, disposeRendererSceneAssets, type RendererSceneAssets } from './rendererSceneAssets';import { createRendererSceneRenderers } from './sceneRendererFactory';
import { isReducedGraphics, getMaxPixelRatio } from './graphicsQuality';
import { UfoRenderer } from './UfoRenderer';
import { CameraController } from './CameraController';
import { CreatureInstanceRenderer, type BoidRenderBatch, type LegPartMesh } from './CreatureInstanceRenderer';
import { applyFishUndulationShader } from './styles/fishtank/fishUndulationShader';

/**
 * Profile name for the "neutral" (non-focus-pattern) Multicolor boid batch —
 * the render batch that holds Multicolor boids not assigned to a scene-specific
 * geometry profile.
 */
const MULTICOLOR_BOID_NEUTRAL_PROFILE = 'neutral';

/**
 * Per-style bloom parameters. Applied whenever the active visual style changes
 * so each scene has its own characteristic glow budget. The enabled/disabled
 * state is still controlled by ScenePresentationSettings.bloomEnabled.
 */
const STYLE_BLOOM_PARAMS: Record<VisualStyle, { strength: number; radius: number; threshold: number }> = {
  arcade: { strength: 0.85, radius: 0.40, threshold: 0.15 }, // neon-saturated glow
  nature: { strength: 0.60, radius: 0.50, threshold: 0.10 }, // soft sunlit haze
  fishtank: { strength: 0.50, radius: 0.55, threshold: 0.08 }, // subtle caustic shimmer
};

/**
 * Per-style exposure scale applied on top of the time-of-day base exposure.
 * Kept very close to 1.0 to avoid noticeable regressions.
 */
const STYLE_EXPOSURE_SCALE: Record<VisualStyle, number> = {
  arcade: 1.00,
  nature: 1.00,
  fishtank: 0.93, // slightly dimmer for underwater depth
};

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private readonly reducedGraphics = isReducedGraphics();
  private composer: EffectComposer;
  private afterimagePass: AfterimagePass;
  private bloomPass: UnrealBloomPass;
  private colorGradingPass: ShaderPass;
  private dofPass: BokehPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cameraController: CameraController;

  /** True while POV (cockpit) mode is active — renderOutput() skips
   *  OrbitControls.update() so camera placement is driven directly. */
  private _povActive = false;

  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private sceneAssets!: RendererSceneAssets;
  private ufoRenderer!: UfoRenderer;

  private speciesInstances = new Map<BoidSpecies, BoidRenderBatch | null>();
  private speciesInstanceKeys = new Map<BoidSpecies, string | null>();
  private profiledSpeciesInstances = new Map<string, BoidRenderBatch | null>();
  private profiledSpeciesKeys = new Map<string, string | null>();
  /**
   * Predator instances are split by species (mirrors speciesInstances above)
   * so hawks/dragons and unicorns can coexist as independent populations
   * with entirely different geometries/materials — see Predator.species.
   */
  private predatorInstances = new Map<PredatorSpecies, BoidRenderBatch | null>();
  private predatorInstanceKeys = new Map<PredatorSpecies, string | null>();
  private boundsHelper: THREE.LineSegments | null = null;
  private currentStyle: VisualStyle | null = null;
  private warmedShaderStyles = new Set<VisualStyle>();
  private pendingShaderWarmupStyles = new Set<VisualStyle>();

  private lastSeenCatchId = 0;
  private tmpSpawnPosition = new THREE.Vector3();
  private tmpSpawnDirection = new THREE.Vector3();
  // Sim world center, recomputed per frame while fishtank style is active —
  // used to "grow" fishtank boid positions symmetrically around the tank's
  // true center (see worldScale) rather than the coordinate origin. Shared by
  // reference with the fishtank scene renderer and the creature renderer.
  private fishtankCenter = new THREE.Vector3();
  private startTime = performance.now();
  private lastElapsed = 0;
  private appliedFogEnabled: boolean | null = null;
  private appliedTimeOfDay: TimeOfDayPreset | null = null;
  private appliedLightShaftsEnabled: boolean | null = null;
  private appliedWaterEffectsEnabled: boolean | null = null;
  private appliedShadowsEnabled: boolean | null = null;
  private sceneRenderers!: Record<VisualStyle, SceneRendererHooks>;
  private creatureRenderer = new CreatureInstanceRenderer(this.fishtankCenter);

  constructor(canvas: HTMLCanvasElement) {
    // logarithmicDepthBuffer: the near/far planes span a huge ratio (1 to
    // 30000 for the nature sky dome); a standard depth buffer leaves too
    // little precision at fishtank distances, causing z-fighting on thin
    // stacked surfaces (tank window layers). Log depth spreads precision
    // evenly across the range.
    // Reduced-graphics mode (see graphicsQuality) drops the GPU-heavy effects
    // that dominate frame time under software WebGL — used by the e2e suite on
    // CI so it doesn't spend seconds per frame rendering bloom/shadows/glass.
    const reducedGraphics = isReducedGraphics();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !reducedGraphics, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, getMaxPixelRatio()));
    // ACES tone mapping keeps the physically-based Sky shader from blowing
    // out to solid white and gives the nature-style earth tones more depth.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    this.renderer.shadowMap.enabled = !reducedGraphics;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    // Far plane large enough to contain the nature sky dome (scaled 20000).
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.cameraController = new CameraController(this.camera, this.controls);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.keyLight.position.set(1, 1, 1);
    this.keyLight.castShadow = !reducedGraphics;
    this.keyLight.shadow.mapSize.set(1536, 1536);
    this.keyLight.shadow.radius = 3;
    this.scene.add(this.ambientLight, this.keyLight);

    this.sceneAssets = createRendererSceneAssets(this.scene, this.renderer);
    this.ufoRenderer = new UfoRenderer(this.sceneAssets.ufoVisuals);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.afterimagePass = new AfterimagePass();
    this.composer.addPass(this.afterimagePass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.4, 0.15);
    this.composer.addPass(this.bloomPass);
    // Depth of field (BokehPass) — disabled until params.depthOfFieldEnabled = true.
    // Placed after bloom so the glow is included in the depth blur.
    this.dofPass = new BokehPass(this.scene, this.camera, { focus: 500, aperture: 0.0015, maxblur: 0.002 });
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    // Filmic color grading — disabled until params.colorGradingEnabled = true.
    // Placed after OutputPass so grading operates on tone-mapped display-referred color.
    this.composer.addPass(new OutputPass());
    this.colorGradingPass = createColorGradingPass();
    this.composer.addPass(this.colorGradingPass);

    this.initializeSceneRenderers();
  }

  private initializeSceneRenderers(): void {
    this.sceneRenderers = createRendererSceneRenderers({
      camera: this.camera,
      controls: this.controls,
      fishtankCenter: this.fishtankCenter,
      sceneAssets: this.sceneAssets,
    });
  }

  private getSceneRenderer(style: VisualStyle): SceneRendererHooks {
    return this.sceneRenderers[style];
  }

  private getActiveSceneRenderer(): SceneRendererHooks {
    return this.getSceneRenderer(params.visualStyle);
  }

  private configureSceneEnvironmentAnchors(sim: Simulation, center: THREE.Vector3, maxDim: number): void {
    for (const style of SCENE_STYLES) {
      this.sceneRenderers[style].configureEnvironmentAnchors(sim, center, maxDim);
    }
  }

  private buildRenderBatch({
    geometries,
    style,
    count,
    isMonster = false,
    rainbowWings = false,
    bodyVertexColors = false,
    bodyEmissiveOverride,
    fishUndulation,
  }: {
    geometries: CreatureGeometries;
    style: VisualStyle;
    count: number;
    isMonster?: boolean;
    rainbowWings?: boolean;
    bodyVertexColors?: boolean;
    bodyEmissiveOverride?: THREE.Color;
    fishUndulation?: FishUndulationConfig;
  }): BoidRenderBatch {
    // Diffuse color starts white; the actual visible tint is driven entirely
    // per-instance via setColorAt in updateInstances (base <-> state color).
    const sceneRenderer = this.getSceneRenderer(style);
    const materialDefaults = sceneRenderer.getCreatureMaterialDefaults();
    const { isFishtank } = createStyleFlags(style);
    const bodyEmissive = bodyEmissiveOverride ?? new THREE.Color(materialDefaults.bodyEmissive);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: bodyEmissive,
      emissiveIntensity: materialDefaults.bodyEmissiveIntensity,
      // Monster predators (dragons/sharks) get a slightly glossier finish than
      // the matte default — with the dark scale color, fully matte roughness
      // barely differentiates facets (frill spikes, joints) under the key light.
      roughness: materialDefaults.bodyRoughness(isMonster),
      metalness: 0,
      // Unicorns only: the body geometry bakes a gold vertex color onto just
      // the horn; this tells the material to read that per-vertex 'color'.
      vertexColors: bodyVertexColors,
    });
    // Scene-specific shader patch (e.g. fishtank fish-scale pattern). Called
    // after the material is fully configured but before any InstancedMesh is
    // created so the material's onBeforeCompile is set before first use.
    sceneRenderer.patchBodyMaterial?.(bodyMaterial, geometries);
    const wingMaterial = new THREE.MeshStandardMaterial({
      // Monster predators: tint the membrane/tail material darker (multiplies
      // against the per-instance body color) so leathery wings/tail read darker
      // than the scaly body — a bat-wing-on-dragon cue. Fishtank sharks instead
      // get a neutral lavender-gray (0x9c86ab), since multiplying a purple tint
      // against the gray shark body would leak pink into the fins.
      color: materialDefaults.wingColor(isMonster, isFishtank),
      emissive: materialDefaults.wingEmissive,
      emissiveIntensity: materialDefaults.wingEmissiveIntensity,
      roughness: materialDefaults.wingRoughness(isMonster),
      metalness: 0,
      side: THREE.DoubleSide,
      // Enable wing vertex colors only when the geometry carries a baked 'color'
      // attribute (unicorn rainbow wings, parrot gradients) — enabling it on
      // color-less geometry renders black.
      vertexColors: rainbowWings || !!geometries.wingLeft.getAttribute('color'),
    });
    // Scene-specific shader patch for wing/fin geometry (dragon scales,
    // fishtank fin rays).
    //
    // Clone FIRST, then patch every instance. Material.clone() copies neither
    // onBeforeCompile nor customProgramCacheKey, so patching before the clone
    // leaves the right wing unpatched — that is the "effect only shows on one
    // fin" bug. The tail clone below is patched by patchTailMaterial for the
    // same reason. Patching is not idempotent (each call chains onto the
    // previous onBeforeCompile), so each material must be patched exactly once.
    const wingRightMaterial = wingMaterial.clone();
    sceneRenderer.patchWingMaterial?.(wingMaterial, geometries);
    sceneRenderer.patchWingMaterial?.(wingRightMaterial, geometries);

    const body = new THREE.InstancedMesh(geometries.body, bodyMaterial, Math.max(count, 1));
    const wingLeft = new THREE.InstancedMesh(geometries.wingLeft, wingMaterial, Math.max(count, 1));
    const wingRight = new THREE.InstancedMesh(geometries.wingRight, wingRightMaterial, Math.max(count, 1));
    body.count = count;
    wingLeft.count = count;
    wingRight.count = count;
    // InstancedMesh frustum culling tests the mesh's own (near-origin) transform
    // against the frustum, ignoring per-instance matrices scattered across the
    // world — so the whole population can wrongly vanish at some camera angles.
    // Disable it; counts are small (a few hundred at most).
    body.frustumCulled = false;
    wingLeft.frustumCulled = false;
    wingRight.frustumCulled = false;
    body.castShadow = true;
    body.receiveShadow = true;
    wingLeft.castShadow = true;
    wingLeft.receiveShadow = true;
    wingRight.castShadow = true;
    wingRight.receiveShadow = true;
    this.scene.add(body, wingLeft, wingRight);
    let tail: THREE.InstancedMesh | undefined;
    if (geometries.tail) {
      const tailMaterial = wingMaterial.clone();
      // Only the unicorn tail bakes a rainbow 'color' attribute; enabling
      // vertexColors on a color-less tail would render solid black.
      tailMaterial.vertexColors = !!geometries.tail.getAttribute('color');
      tailMaterial.needsUpdate = true;
      // Scene-specific tail patch, mirroring patchBodyMaterial above. Applied
      // after vertexColors is settled and before the InstancedMesh exists, so
      // onBeforeCompile is in place before first use.
      sceneRenderer.patchTailMaterial?.(tailMaterial, geometries);
      tail = new THREE.InstancedMesh(geometries.tail, tailMaterial, Math.max(count, 1));
      tail.count = count;
      tail.frustumCulled = false;
      tail.castShadow = true;
      tail.receiveShadow = true;
      this.scene.add(tail);
    }
    const fishUndulationState = fishUndulation
      ? applyFishUndulationShader({ mesh: body, tailMesh: tail, config: fishUndulation })
      : undefined;

    const wingUndulationState = sceneRenderer.setupWingUndulation?.(wingLeft, wingRight, geometries);
    const tailUndulationState = tail
      ? sceneRenderer.setupTailUndulation?.(tail, geometries)
      : undefined;

    let legs: LegPartMesh[] | undefined;
    if (geometries.legs?.length) {
      // Legs are scaly like the body, not membranous like wings/tail, so
      // clone the body material (not the wing material) to pick up matching
      // per-instance scale-color tinting. Each rig part gets its own mesh so
      // it can be posed about its own joint.
      legs = geometries.legs.map((part) => {
        const legsMaterial = bodyMaterial.clone();
        const mesh = new THREE.InstancedMesh(part.geometry, legsMaterial, Math.max(count, 1));
        mesh.count = count;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        return { ...part, mesh };
      });
    }

    let beak: THREE.InstancedMesh | undefined;
    if (geometries.beak) {
      // Small-bird-only part (see CreatureGeometries.beak) — a plain,
      // non-vertex-colored material (this.beakMaterial has no vertex data
      // to read; its whole point is getting its own flat per-instance
      // color, set in updateInstances).
      const beakMaterial = bodyMaterial.clone();
      beakMaterial.vertexColors = false;
      beak = new THREE.InstancedMesh(geometries.beak, beakMaterial, Math.max(count, 1));
      beak.count = count;
      beak.frustumCulled = false;
      beak.castShadow = true;
      beak.receiveShadow = true;
      this.scene.add(beak);
    }

    return { body, wingLeft, wingRight, tail, tailRig: geometries.tailRig, legs, beak, fishUndulation: fishUndulationState, wingUndulation: wingUndulationState, tailUndulation: tailUndulationState, wingPivotLeft: geometries.wingPivotLeft, wingPivotRight: geometries.wingPivotRight };
  }

  private disposeRenderBatch(set: BoidRenderBatch | null): void {
    if (!set) return;
    const meshes = [
      set.body,
      set.wingLeft,
      set.wingRight,
      ...(set.tail ? [set.tail] : []),
      ...(set.legs ?? []).map((part) => part.mesh),
      ...(set.beak ? [set.beak] : []),
    ];
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.customDepthMaterial?.dispose();
      mesh.customDistanceMaterial?.dispose();
    }
    if (set.fishUndulation) {
      (set.body.geometry as THREE.BufferGeometry).dispose();
      if (set.tail) (set.tail.geometry as THREE.BufferGeometry).dispose();
    }
    if (set.wingUndulation) {
      (set.wingLeft.geometry as THREE.BufferGeometry).dispose();
      (set.wingRight.geometry as THREE.BufferGeometry).dispose();
    }
    if (set.tailUndulation && set.tail) {
      (set.tail.geometry as THREE.BufferGeometry).dispose();
    }
  }

  /** Defers a one-time shader/material compile for the currently active visual style. */
  private scheduleShaderWarmup(style: VisualStyle): void {
    if (this.warmedShaderStyles.has(style) || this.pendingShaderWarmupStyles.has(style)) return;
    this.pendingShaderWarmupStyles.add(style);
    window.setTimeout(() => {
      this.pendingShaderWarmupStyles.delete(style);
      if (this.currentStyle !== style) return;
      this.renderer.compile(this.scene, this.camera);
      this.warmedShaderStyles.add(style);
    }, 0);
  }

  private applyStyleTransitionOnStyleChange(sim: Simulation, style: VisualStyle): void {
    if (this.currentStyle === style) return;
    const wasFishtank = this.currentStyle === 'fishtank';
    this.currentStyle = style;

    // Lazy environment: dispose the previously-active heavy env and create the
    // one for the new style.  Must run before setStyleVisibility so the freshly-
    // built env is already in the scene graph when visibility is configured.
    this.sceneAssets.envProvider.switchToStyle(style);

    const sceneRenderer = this.getSceneRenderer(style);

    // Position the freshly-built environment (replays placeNatureEnvironment /
    // placeFishtankEnvironment for the current world size, since the bounds-
    // helper's early-return prevents configureSceneEnvironmentAnchors from
    // re-running when only the style changes).
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    sceneRenderer.configureEnvironmentAnchors(sim, center, maxDim);

    const presentation = sceneRenderer.getPresentationSettings();
    this.bloomPass.enabled = presentation.bloomEnabled && !this.reducedGraphics;
    // The afterimage/motion-trail effect persists whole previous frames —
    // great for arcade neon trails, but in organic (fog-using) styles a camera
    // pan drags a smeary ghost trail of the bright sky/water across the frame.
    this.afterimagePass.enabled = presentation.afterimageEnabled && !this.reducedGraphics;
    sceneRenderer.setStyleVisibility();
    if (this.boundsHelper) this.boundsHelper.visible = presentation.boundsHelperVisible;
    this.ambientLight.intensity = presentation.ambientLightIntensity;
    this.keyLight.visible = presentation.keyLightVisible;

    // Apply scene-tuned bloom parameters (strength/radius/threshold) for the
    // new style. The enabled flag above still controls whether bloom fires at
    // all; these params just ensure each style's glow budget is appropriate.
    const bloomParams = STYLE_BLOOM_PARAMS[style];
    this.bloomPass.strength = bloomParams.strength;
    this.bloomPass.radius = bloomParams.radius;
    this.bloomPass.threshold = bloomParams.threshold;

    // Load the per-style color grading preset so it's ready when the user
    // enables the flag — no visual change until colorGradingPass.enabled = true.
    applyColorGradingPreset(this.colorGradingPass, COLOR_GRADING_PRESETS[style]);

    // Re-apply the zoom clamp for the new style: nature's distance fog
    // needs a tight max zoom-out, while fishtank now has real geometry
    // (a table + room) around the tank that's worth seeing when zoomed
    // out further, so it gets a much looser clamp than nature.
    sceneRenderer.applyStyleTransition(sim, maxDim, wasFishtank);

    // Re-apply current environment toggles and shadow state to the freshly-built
    // env.  updateEnvironmentParameterToggles() will skip re-applying them on the
    // next frame (the params haven't changed), so we must apply them here so the
    // new env gets the correct fog/timeOfDay/water/lightShafts/shadow state.
    const toggles: SceneEnvironmentToggles = {
      fogEnabled: params.fogEnabled,
      timeOfDay: params.timeOfDay,
      lightShaftsEnabled: params.lightShaftsEnabled,
      waterEffectsEnabled: params.waterEffectsEnabled,
    };
    sceneRenderer.applyEnvironmentToggles(toggles);
    const shadowsEnabled = params.mode === '3d' && params.softShadowsEnabled && !this.reducedGraphics;
    sceneRenderer.setShadowsEnabled(shadowsEnabled);
  }

  private updateEnvironmentParameterToggles(): void {
    const toggles: SceneEnvironmentToggles = {
      fogEnabled: params.fogEnabled,
      timeOfDay: params.timeOfDay,
      lightShaftsEnabled: params.lightShaftsEnabled,
      waterEffectsEnabled: params.waterEffectsEnabled,
    };
    const togglesChanged =
      this.appliedFogEnabled !== params.fogEnabled ||
      this.appliedTimeOfDay !== params.timeOfDay ||
      this.appliedLightShaftsEnabled !== params.lightShaftsEnabled ||
      this.appliedWaterEffectsEnabled !== params.waterEffectsEnabled;
    if (togglesChanged) {
      for (const style of SCENE_STYLES) {
        this.sceneRenderers[style].applyEnvironmentToggles(toggles);
      }
    }
    if (this.appliedFogEnabled !== params.fogEnabled) {
      this.appliedFogEnabled = params.fogEnabled;
    }
    if (this.appliedTimeOfDay !== params.timeOfDay) {
      this.appliedTimeOfDay = params.timeOfDay;
    }
    if (this.appliedLightShaftsEnabled !== params.lightShaftsEnabled) {
      this.appliedLightShaftsEnabled = params.lightShaftsEnabled;
    }
    if (this.appliedWaterEffectsEnabled !== params.waterEffectsEnabled) {
      this.appliedWaterEffectsEnabled = params.waterEffectsEnabled;
    }
    const shadowsEnabled = params.mode === '3d' && params.softShadowsEnabled && !this.reducedGraphics;
    if (this.appliedShadowsEnabled !== shadowsEnabled) {
      this.renderer.shadowMap.enabled = shadowsEnabled;
      this.keyLight.castShadow = shadowsEnabled;
      for (const style of SCENE_STYLES) {
        this.sceneRenderers[style].setShadowsEnabled(shadowsEnabled);
      }
      this.appliedShadowsEnabled = shadowsEnabled;
    }
  }

  private ensureBoundsHelperAndFraming(sim: Simulation, style: VisualStyle): void {
    const sceneRenderer = this.getSceneRenderer(style);
    const presentation = sceneRenderer.getPresentationSettings();
    const expectedKey = `${sim.width}x${sim.height}x${params.worldDepth}`;
    if (this.boundsHelper?.userData.key === expectedKey) return;
    if (this.boundsHelper) {
      this.scene.remove(this.boundsHelper);
      this.boundsHelper.geometry.dispose();
      (this.boundsHelper.material as THREE.Material).dispose();
    }
    const box = new THREE.BoxGeometry(sim.width, sim.height, params.worldDepth);
    const edges = new THREE.EdgesGeometry(box);
    const material = new THREE.LineBasicMaterial({ color: 0x30363d });
    this.boundsHelper = new THREE.LineSegments(edges, material);
    this.boundsHelper.position.set(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.boundsHelper.userData.key = expectedKey;
    this.boundsHelper.visible = presentation.boundsHelperVisible;
    this.scene.add(this.boundsHelper);
    box.dispose();

    const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    sceneRenderer.configureInitialFraming(sim, maxDim);

    this.configureSceneEnvironmentAnchors(sim, center, maxDim);

    this.controls.minDistance = maxDim * 0.05;
    sceneRenderer.applyStyleTransition(sim, maxDim, false);
  }

  private reconcileBoidRenderBatches(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    const sceneRenderer = this.getSceneRenderer(style);
    const profileNames = this.getProfileNamesForSpecies(BoidSpecies.Multicolor, sceneRenderer, flags);
    const hasProfiledSpecies = profileNames.length > 0;
    const countsBySpecies = this.getBoidCountsBySpecies(sim.boids);
    const profileCounts = hasProfiledSpecies
      ? this.getProfileCountsForSpecies(sim.boids, BoidSpecies.Multicolor, sceneRenderer, flags)
      : new Map<string, number>();
    if (!hasProfiledSpecies) this.clearProfiledSpeciesInstances();

    for (const species of BOID_SPECIES) {
      const count = countsBySpecies.get(species) ?? 0;
      if (this.isProfiledSpecies(species) && hasProfiledSpecies) {
        this.reconcileProfiledSpeciesRenderBatches(
          count,
          style,
          flags,
          profileNames,
          profileCounts,
          sceneRenderer,
        );
        continue;
      }
      const key = `${count}:${style}`;
      if (this.speciesInstanceKeys.get(species) !== key) {
        this.disposeRenderBatch(this.speciesInstances.get(species) ?? null);
        const {
          geometries,
          bodyVertexColors,
          bodyEmissiveOverride,
          fishUndulation,
        } = sceneRenderer.getBoidInstanceConfig(species, flags);
        this.speciesInstances.set(
          species,
          this.buildRenderBatch({
            geometries,
            style,
            count,
            bodyVertexColors,
            bodyEmissiveOverride,
            fishUndulation,
          }),
        );
        this.speciesInstanceKeys.set(species, key);
      }
    }
  }

  private getBoidCountsBySpecies(boids: Boid[]): Map<BoidSpecies, number> {
    const countsBySpecies = new Map<BoidSpecies, number>();
    for (const boid of boids) {
      countsBySpecies.set(boid.species, (countsBySpecies.get(boid.species) ?? 0) + 1);
    }
    return countsBySpecies;
  }

  private getProfileNamesForSpecies(
    species: BoidSpecies,
    sceneRenderer: SceneRendererHooks,
    flags: StyleFlags,
  ): readonly string[] {
    if (!this.isProfiledSpecies(species)) return [];
    return sceneRenderer.getParrotProfileNames(flags);
  }

  private isProfiledSpecies(species: BoidSpecies): boolean {
    return species === BoidSpecies.Multicolor;
  }

  private getProfileCountsForSpecies(
    boids: Boid[],
    species: BoidSpecies,
    sceneRenderer: SceneRendererHooks,
    flags: StyleFlags,
  ): Map<string, number> {
    const profileCounts = new Map<string, number>();
    if (!this.isProfiledSpecies(species)) return profileCounts;
    for (const boid of boids) {
      if (boid.species !== species) continue;
      const profile = sceneRenderer.getParrotGeometryProfile(boid, flags);
      profileCounts.set(profile, (profileCounts.get(profile) ?? 0) + 1);
    }
    return profileCounts;
  }

  private clearProfiledSpeciesInstances(): void {
    for (const profile of this.profiledSpeciesInstances.keys()) {
      this.disposeRenderBatch(this.profiledSpeciesInstances.get(profile) ?? null);
      this.profiledSpeciesInstances.set(profile, null);
      this.profiledSpeciesKeys.set(profile, null);
    }
  }

  private reconcileProfiledSpeciesRenderBatches(
    totalProfiledSpeciesCount: number,
    style: VisualStyle,
    flags: StyleFlags,
    profileNames: readonly string[],
    profileCounts: ReadonlyMap<string, number>,
    sceneRenderer: SceneRendererHooks,
  ): void {
    const nonNeutralCount = profileNames
      .reduce((sum, profile) => sum + (profileCounts.get(profile) ?? 0), 0);
    const neutralCount = Math.max(0, totalProfiledSpeciesCount - nonNeutralCount);
    const neutralKey = `${neutralCount}:${style}:${MULTICOLOR_BOID_NEUTRAL_PROFILE}`;
    if (this.speciesInstanceKeys.get(BoidSpecies.Multicolor) !== neutralKey) {
      this.disposeRenderBatch(this.speciesInstances.get(BoidSpecies.Multicolor) ?? null);
      const neutralConfig = sceneRenderer.getParrotProfileInstanceConfig(MULTICOLOR_BOID_NEUTRAL_PROFILE, flags);
      this.speciesInstances.set(
        BoidSpecies.Multicolor,
        this.buildRenderBatch({
          geometries: neutralConfig.geometries,
          style,
          count: neutralCount,
          bodyVertexColors: neutralConfig.bodyVertexColors,
          fishUndulation: neutralConfig.fishUndulation,
        }),
      );
      this.speciesInstanceKeys.set(BoidSpecies.Multicolor, neutralKey);
    }
    for (const profile of profileNames) {
      const profileCount = profileCounts.get(profile) ?? 0;
      const profileKey = `${profileCount}:${style}:${profile}`;
      if (this.profiledSpeciesKeys.get(profile) !== profileKey) {
        this.disposeRenderBatch(this.profiledSpeciesInstances.get(profile) ?? null);
        const profileConfig = sceneRenderer.getParrotProfileInstanceConfig(profile, flags);
        this.profiledSpeciesInstances.set(
          profile,
          this.buildRenderBatch({
            geometries: profileConfig.geometries,
            style,
            count: profileCount,
            bodyVertexColors: profileConfig.bodyVertexColors,
            fishUndulation: profileConfig.fishUndulation,
          }),
        );
        this.profiledSpeciesKeys.set(profile, profileKey);
      }
    }
  }

  private reconcilePredatorRenderBatches(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    const sceneRenderer = this.getSceneRenderer(style);
    const countsBySpecies = this.getPredatorCountsBySpecies(sim.predators);
    for (const species of SCENE_PREDATOR_SPECIES) {
      const count = countsBySpecies.get(species) ?? 0;
      const speciesRenderFlags = createPredatorRenderFlags(species, flags);
      const instanceKey = createPredatorInstanceKey(species, count, style);
      if (this.predatorInstanceKeys.get(species) !== instanceKey) {
        this.disposeRenderBatch(this.predatorInstances.get(species) ?? null);
        const config = sceneRenderer.getPredatorInstanceConfig(species, flags, speciesRenderFlags);
        this.predatorInstances.set(
          species,
          this.buildRenderBatch({
            geometries: config.geometries,
            style,
            count,
            isMonster: speciesRenderFlags.isMonster,
            rainbowWings: config.rainbowWings,
            bodyVertexColors: config.bodyVertexColors,
            fishUndulation: config.fishUndulation,
          }),
        );
        this.predatorInstanceKeys.set(species, instanceKey);
        this.creatureRenderer.resetPredatorOrientationCaches(species);
      }
    }
  }

  private getPredatorCountsBySpecies(predators: Predator[]): Map<PredatorSpecies, number> {
    const countsBySpecies = new Map<PredatorSpecies, number>();
    for (const species of SCENE_PREDATOR_SPECIES) {
      countsBySpecies.set(species, 0);
    }
    for (const predator of predators) {
      countsBySpecies.set(predator.species, (countsBySpecies.get(predator.species) ?? 0) + 1);
    }
    return countsBySpecies;
  }

  /** Recreates instanced meshes, environment, and world-bounds wireframe as population/world/style change. */
  private ensureScene(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    this.reconcileBoidRenderBatches(sim, style, flags);

    this.reconcilePredatorRenderBatches(sim, style, flags);

    this.applyStyleTransitionOnStyleChange(sim, style);

    this.updateEnvironmentParameterToggles();

    // Creature Gallery poses the fishtank camera inside the tank/water volume
    // (see main.ts's poseGalleryCreatureIfReady) — hide the surrounding room
    // while active so the glass/water doesn't show the room behind the creature.
    const galleryCreatureActive = params.galleryCreature !== null;
    for (const sceneStyle of SCENE_STYLES) {
      this.sceneRenderers[sceneStyle].setGalleryCreatureActive(galleryCreatureActive);
    }

    this.ensureBoundsHelperAndFraming(sim, style);

    this.scheduleShaderWarmup(style);
  }

  /** Spawns a 3D blood-splatter burst for every not-yet-seen Simulation.catchEvent. */
  private spawnBloodFromCatches(sim: Simulation, sceneRenderer: SceneRendererHooks): void {
    const bloodSplatterScale = sceneRenderer.getBloodSplatterScale();
    for (const catchEvent of sim.catchEvents) {
      if (catchEvent.id <= this.lastSeenCatchId) continue;
      this.lastSeenCatchId = catchEvent.id;
      // Map the catch position from sim space into render space so the burst
      // appears where the fish is visually rendered. For nature/arcade this is
      // an identity mapping; for fishtank it applies the TANK_VISUAL_SCALE
      // inflation around fishtankCenter.
      sceneRenderer.mapPositionToRenderSpace(
        catchEvent.position.x,
        catchEvent.position.y,
        catchEvent.position.z,
        this.tmpSpawnPosition,
      );
      this.tmpSpawnDirection.set(catchEvent.direction.x, catchEvent.direction.y, catchEvent.direction.z);
      this.sceneAssets.bloodEffects.spawn(this.tmpSpawnPosition, this.tmpSpawnDirection, bloodSplatterScale);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Creature Gallery: converts a sim-space position into the world-space position
   * it actually renders at. No-op for nature/arcade, but fishtank inflates
   * positions by TANK_VISUAL_SCALE from fishtankCenter — gallery framing must
   * target this position, not the raw sim-space one.
   */
  toRenderedPosition(x: number, y: number, z: number): THREE.Vector3 {
    const rendered = new THREE.Vector3();
    this.getActiveSceneRenderer().mapPositionToRenderSpace(x, y, z, rendered);
    return rendered;
  }

  /** Creature Gallery / debug-QA camera framing — see CameraController.debugFrameCamera. */
  debugFrameCamera(x: number, y: number, z: number, distance: number): void {
    this.cameraController.debugFrameCamera(x, y, z, distance);
  }

  /**
   * Creature Gallery: computes a debugFrameCamera distance that frames the
   * currently-instanced creature as tightly as the FOV allows, from the union
   * of its part geometries (a wingspan/tail reaches past the body alone).
   * Falls back to `fallbackDistance` if the batch for `species` doesn't exist
   * yet.
   */
  getGalleryFramingDistance(species: PredatorSpecies | BoidSpecies, fallbackDistance = 220): number {
    const set = isPredatorSpecies(species)
      ? this.predatorInstances.get(species)
      : this.speciesInstances.get(species);
    if (!set) return fallbackDistance;

    // Union every part's bounding box (a wingspan/tail reaches past the body).
    // All parts share the same single-instance local space, so they combine
    // directly.
    const box = new THREE.Box3();
    for (const mesh of [
      set.body,
      set.wingLeft,
      set.wingRight,
      set.tail,
      ...(set.legs ?? []).map((part) => part.mesh),
      set.beak,
    ]) {
      if (!mesh) continue;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    }
    if (box.isEmpty()) return fallbackDistance;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Fishtank scales the mesh itself (not just position) by TANK_VISUAL_SCALE,
    // which the local bounding box doesn't reflect — apply worldScale so the
    // creature doesn't render larger than solved for and clip.
    const worldScale = this.getActiveSceneRenderer().getWorldScale();
    const radius = sphere.radius * worldScale;
    if (!radius) return fallbackDistance;

    // Matches debugFrameCamera's (0.7, 0.35, 0.9) offset: the true
    // camera-to-target distance is `distance * offsetMagnitude`.
    const offsetMagnitude = Math.sqrt(0.7 ** 2 + 0.35 ** 2 + 0.9 ** 2);
    const verticalFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    // Small margin so the silhouette doesn't clip against the frame edges.
    const effectiveRadius = radius * 1.15;
    return effectiveRadius / Math.tan(verticalFovRad / 2) / offsetMagnitude;
  }

  /**
   * World-space distance from a creature's model origin to the front tip of its
   * geometry along its forward axis (model-local +Y, see FORWARD_AXIS in
   * CreatureInstanceRenderer), at the given entity scale. The POV camera uses
   * this to sit at the creature's "nose" looking forward, instead of at the body
   * centre — which renders from inside the mesh (issue #159).
   *
   * `isPredator` selects the correct instance batch and mesh-scale boost, since
   * boid and predator species strings can collide (both have a `'normal'`).
   * Returns 0 when the species batch isn't instantiated yet (caller falls back
   * to the raw origin).
   */
  getCreatureForwardExtent(
    species: PredatorSpecies | BoidSpecies,
    isPredator: boolean,
    entityScale: number,
  ): number {
    const set = isPredator
      ? this.predatorInstances.get(species as PredatorSpecies)
      : this.speciesInstances.get(species as BoidSpecies);
    if (!set) return 0;

    // Union the body with the (optional) beak, which reaches forward past the
    // body on small birds — the true nose is the farthest-forward of the two.
    const box = new THREE.Box3();
    for (const mesh of [set.body, set.beak]) {
      if (!mesh) continue;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    }
    if (box.isEmpty()) return 0;

    const forwardModel = box.max.y; // FORWARD_AXIS is model-local +Y
    const active = this.getActiveSceneRenderer();
    const worldScale = active.getWorldScale();
    const meshScaleBoost = active.getCreatureMeshScaleBoost(species, isPredator);
    return forwardModel * entityScale * worldScale * meshScaleBoost;
  }

  /** Returns the scene-specific creature display labels for the active visual style. */
  getCreatureLabels(): CreatureLabels {
    return this.getActiveSceneRenderer().getCreatureLabels();
  }

  /** Restore default whole-world camera framing — see CameraController.resetCameraFraming. */
  resetCameraFraming(sim: Simulation): void {
    this.cameraController.resetCameraFraming(sim);
  }

  /** Snapshot current camera position + orbit target — see CameraController.getCameraState. */
  getCameraState(): { position: [number, number, number]; target: [number, number, number] } {
    return this.cameraController.getCameraState();
  }

  /** Restore an exact camera position + orbit target — see CameraController.setCameraState. */
  setCameraState(position: [number, number, number], target: [number, number, number]): void {
    this.cameraController.setCameraState(position, target);
  }

  /**
   * Returns the perspective camera — used by FollowCamController's
   * screen-space entity picker.
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.cameraController.getCamera();
  }

  /**
   * Exponentially smooth the orbit target toward a world-space position —
   * delegates to CameraController.smoothOrbitTarget (see its doc for details).
   */
  smoothOrbitTarget(x: number, y: number, z: number, alpha: number): void {
    this.cameraController.smoothOrbitTarget(x, y, z, alpha);
  }

  /**
   * Snaps the OrbitControls orbit target back to the rendered scene center
   * (the same anchor used by the initial camera framing). Call this when the
   * follow-cam selection is cleared so the orbit pivot doesn't remain anchored
   * at the last tracked creature's off-centre position — e.g. zooming into a
   * wall in the nature scene after a creature is deselected near the boundary.
   *
   * The center is computed via toRenderedPosition so it is correct for every
   * scene (arcade, nature, fishtank all have the same sim-space center but
   * fishtank inflates coordinates by TANK_VISUAL_SCALE).
   */
  resetOrbitTarget(sim: Simulation): void {
    const center = this.toRenderedPosition(sim.width / 2, sim.height / 2, params.worldDepth / 2);
    this.cameraController.smoothOrbitTarget(center.x, center.y, center.z, 1);
  }

  /**
   * Enters POV (cockpit) mode: saves OrbitControls distance constraints
   * and sets the internal flag that causes renderOutput() to skip
   * OrbitControls.update() so direct camera placement takes effect.
   */
  enterPovMode(): void {
    this._povActive = true;
    this.cameraController.enterPovMode();
  }

  /**
   * Exits POV mode: re-enables OrbitControls, restores saved distance
   * constraints, and snaps the orbit target to `orbitTarget` so the user
   * continues orbiting around the selected creature (or scene center).
   */
  exitPovMode(orbitTarget: THREE.Vector3): void {
    this._povActive = false;
    this.cameraController.exitPovMode(orbitTarget);
  }

  /**
   * Directly positions the perspective camera for POV mode.
   * Only effective while POV is active (`enterPovMode()` has been called)
   * because renderOutput() skips OrbitControls.update() in that state.
   */
  setPovCamera(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.cameraController.setPovCamera(position, lookAt);
  }

  private groupBoidsBySpecies(boids: Boid[]): Map<BoidSpecies, Boid[]> {
    const boidsBySpecies = new Map<BoidSpecies, Boid[]>();
    for (const boid of boids) {
      const bucket = boidsBySpecies.get(boid.species);
      if (bucket) bucket.push(boid);
      else boidsBySpecies.set(boid.species, [boid]);
    }
    return boidsBySpecies;
  }

  private partitionProfiledSpeciesCreatures(
    creatures: Boid[],
    sceneRenderer: SceneRendererHooks,
    flags: StyleFlags,
  ): {
    neutralCreatures: Boid[];
    profileCreatures: Map<string, Boid[]>;
  } {
    const profileCreatures = new Map<string, Boid[]>();
    const neutralCreatures: Boid[] = [];
    for (const creature of creatures) {
      const profile = sceneRenderer.getParrotGeometryProfile(creature, flags);
      if (profile === MULTICOLOR_BOID_NEUTRAL_PROFILE) neutralCreatures.push(creature);
      else {
        const bucket = profileCreatures.get(profile);
        if (bucket) bucket.push(creature);
        else profileCreatures.set(profile, [creature]);
      }
    }
    return { neutralCreatures, profileCreatures };
  }

  private getBoidCreaturesForSpecies(
    boidsBySpecies: Map<BoidSpecies, Boid[]>,
    species: BoidSpecies,
  ): Boid[] {
    return boidsBySpecies.get(species) ?? [];
  }

  private partitionPredatorsBySpecies(predators: Predator[]): Map<PredatorSpecies, Predator[]> {
    const predatorsBySpecies = new Map<PredatorSpecies, Predator[]>();
    for (const species of SCENE_PREDATOR_SPECIES) {
      predatorsBySpecies.set(species, []);
    }
    for (const predator of predators) {
      predatorsBySpecies.get(predator.species)?.push(predator);
    }
    return predatorsBySpecies;
  }


  private hasAnyBoidSpeciesInstances(): boolean {
    return BOID_SPECIES.some((species) => this.speciesInstances.get(species));
  }

  private hasAnyPredatorInstances(): boolean {
    return SCENE_PREDATOR_SPECIES.some((species) => this.predatorInstances.get(species) !== undefined);
  }

  private updateProfiledSpeciesInstances(
    species: BoidSpecies,
    instances: BoidRenderBatch,
    creatures: Boid[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    sceneRenderer: SceneRendererHooks,
    profileNames: readonly string[],
  ): void {
    const { neutralCreatures, profileCreatures } = this.partitionProfiledSpeciesCreatures(creatures, sceneRenderer, flags);
    const boidMotionFlags: BoidMotionStyleFlags = { isProfiledParrot: true };
    this.creatureRenderer.updateInstances(
      instances,
      neutralCreatures,
      params.boidMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getParrotColorStrategy(flags, false),
      sceneRenderer.getBoidMotionConfig(species, flags, boidMotionFlags),
    );
    for (const profile of profileNames) {
      const profileSet = this.profiledSpeciesInstances.get(profile);
      if (!profileSet) continue;
      this.creatureRenderer.updateInstances(
        profileSet,
        profileCreatures.get(profile) ?? [],
        params.boidMaxSpeed,
        elapsed,
        dt,
        sceneRenderer.getParrotColorStrategy(flags, true),
        sceneRenderer.getBoidMotionConfig(species, flags, boidMotionFlags),
      );
    }
  }

  private updateStandardBoidSpeciesInstances(
    species: BoidSpecies,
    instances: BoidRenderBatch,
    creatures: Boid[],
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    isProfiledParrot: boolean,
    sceneRenderer: SceneRendererHooks,
  ): void {
    const boidMotionFlags: BoidMotionStyleFlags = {
      isProfiledParrot,
    };
    this.creatureRenderer.updateInstances(
      instances,
      creatures,
      params.boidMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getBoidColorStrategy(species, flags),
      sceneRenderer.getBoidMotionConfig(species, flags, boidMotionFlags),
    );
  }

  private updateBoidSpeciesConfig(
    species: BoidSpecies,
    boidsBySpecies: Map<BoidSpecies, Boid[]>,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    sceneRenderer: SceneRendererHooks,
  ): void {
    const instances = this.speciesInstances.get(species);
    if (!instances) return;
    const creatures = this.getBoidCreaturesForSpecies(boidsBySpecies, species);
    const profileNames = this.getProfileNamesForSpecies(species, sceneRenderer, flags);
    const isProfiledParrot = profileNames.length > 0;
    if (isProfiledParrot) {
      this.updateProfiledSpeciesInstances(species, instances, creatures, elapsed, dt, flags, sceneRenderer, profileNames);
      return;
    }
    this.updateStandardBoidSpeciesInstances(
      species,
      instances,
      creatures,
      elapsed,
      dt,
      flags,
      isProfiledParrot,
      sceneRenderer,
    );
  }

  private updateBoidSpeciesInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    sceneRenderer: SceneRendererHooks,
  ): void {
    if (!this.hasAnyBoidSpeciesInstances()) return;

    const boidsBySpecies = this.groupBoidsBySpecies(sim.boids);

    for (const species of BOID_SPECIES) {
      this.updateBoidSpeciesConfig(species, boidsBySpecies, elapsed, dt, flags, sceneRenderer);
    }
  }

  private updatePredatorInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    sceneRenderer: SceneRendererHooks,
  ): void {
    if (!this.hasAnyPredatorInstances()) return;
    const predatorsBySpecies = this.partitionPredatorsBySpecies(sim.predators);
    for (const species of SCENE_PREDATOR_SPECIES) {
      const speciesRenderFlags = createPredatorRenderFlags(species, flags);
      this.updatePredatorKindInstances(
        species,
        predatorsBySpecies.get(species) ?? [],
        elapsed,
        dt,
        sceneRenderer,
        speciesRenderFlags,
      );
    }
  }

  private updatePredatorKindInstances(
    species: PredatorSpecies,
    predators: Predator[],
    elapsed: number,
    dt: number,
    sceneRenderer: SceneRendererHooks,
    renderFlags: PredatorRenderFlags,
  ): void {
    const instances = this.predatorInstances.get(species);
    if (!instances) return;
    if (predators.length === 0) return;
    this.creatureRenderer.updateInstances(
      instances,
      predators,
      params.predatorMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getPredatorColorStrategy(species, renderFlags),
      sceneRenderer.getPredatorMotionConfig(species, renderFlags),
    );
  }

  private getToneMappingExposureForTimeOfDay(timeOfDay: typeof params.timeOfDay): number {
    const exposureByTime = {
      dawn: 0.62,
      noon: 0.7,
      sunset: 0.6,
      night: 0.44,
    } as const;
    // Apply a small per-style scale on top of the time-of-day base so each
    // scene has its own characteristic brightness budget.
    return exposureByTime[timeOfDay] * STYLE_EXPOSURE_SCALE[params.visualStyle];
  }

  private updatePostProcessingAndEnvironment(
    elapsed: number,
    dt: number,
    sceneRenderer: SceneRendererHooks,
  ): void {
    // AfterimagePass's damp uniform controls how strongly the previous
    // frame persists — same trailAmount knob used by the 2D renderer.
    this.afterimagePass.uniforms.damp.value = Math.max(0, Math.min(0.96, params.trailAmount));
    sceneRenderer.updateEnvironment(elapsed);
    this.renderer.toneMappingExposure = this.getToneMappingExposureForTimeOfDay(params.timeOfDay);
    this.sceneAssets.driftingClouds.update(dt);

    // --- Feature-flag driven passes (toggled at runtime, no chain rebuild) ---

    // Color grading: enable/disable based on param flag.
    this.colorGradingPass.enabled = params.colorGradingEnabled && !this.reducedGraphics;

    // Depth of field: enable/disable based on param flag; when enabled update
    // the focus distance to the current orbit-controls target so the pass
    // always focuses on whatever the camera is centered on.
    const dofEnabled = params.depthOfFieldEnabled && !this.reducedGraphics;
    this.dofPass.enabled = dofEnabled;
    if (dofEnabled) {
      (this.dofPass.uniforms as Record<string, { value: unknown }>)['focus'].value =
        this.camera.position.distanceTo(this.controls.target);
    }
  }

  private updateTransientSceneEffects(
    sim: Simulation,
    elapsed: number,
    dt: number,
    sceneRenderer: SceneRendererHooks,
  ): void {
    this.spawnBloodFromCatches(sim, sceneRenderer);
    this.sceneAssets.bloodEffects.update(dt);
    sceneRenderer.updateSpecialCreatureEffects(sim, elapsed, this.creatureRenderer.getDragonDisplayQuats());
    this.sceneAssets.fireBreathEffects.update(dt);
    this.ufoRenderer.update(sim, dt, sceneRenderer);
  }

  private updateSceneEffects(
    sim: Simulation,
    elapsed: number,
    dt: number,
    sceneRenderer: SceneRendererHooks,
  ): void {
    this.updatePostProcessingAndEnvironment(elapsed, dt, sceneRenderer);
    this.updateTransientSceneEffects(sim, elapsed, dt, sceneRenderer);
  }

  private updateCreatureInstances(
    sim: Simulation,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
    sceneRenderer: SceneRendererHooks,
  ): void {
    this.updateBoidSpeciesInstances(sim, elapsed, dt, flags, sceneRenderer);
    this.updatePredatorInstances(sim, elapsed, dt, flags, sceneRenderer);
  }

  private getRenderTiming(): { elapsed: number; dt: number } {
    const elapsed = (performance.now() - this.startTime) / 1000;
    const dt = Math.max(0, Math.min(elapsed - this.lastElapsed, 1 / 20));
    this.lastElapsed = elapsed;
    return { elapsed, dt };
  }

  private renderFrame(
    sim: Simulation,
    sceneRenderer: SceneRendererHooks,
    elapsed: number,
    dt: number,
    flags: StyleFlags,
  ): void {
    sceneRenderer.updateFrameAnchors(sim);
    this.updateSceneEffects(sim, elapsed, dt, sceneRenderer);
    this.updateCreatureInstances(sim, elapsed, dt, flags, sceneRenderer);
    sceneRenderer.updateCameraClamp(sim);
    this.renderOutput();
  }

  private renderOutput(): void {
    // Skip OrbitControls.update() while POV is active — the camera is driven
    // directly by FollowCamController.setPovCamera() each frame, and calling
    // controls.update() here would recompute camera position from its stored
    // spherical state, clobbering the POV placement.
    if (!this._povActive) this.controls.update();
    this.composer.render();
  }

  render(sim: Simulation): void {
    const style = params.visualStyle;
    const flags = createStyleFlags(style);
    const sceneRenderer = this.getSceneRenderer(style);
    this.ensureScene(sim, style, flags);
    const { elapsed, dt } = this.getRenderTiming();
    this.renderFrame(sim, sceneRenderer, elapsed, dt, flags);
  }

  private disposeBoidRenderBatches(): void {
    for (const species of BOID_SPECIES) {
      this.disposeRenderBatch(this.speciesInstances.get(species) ?? null);
    }
  }

  private disposeProfiledSpeciesRenderBatches(): void {
    for (const profile of this.profiledSpeciesInstances.keys()) {
      this.disposeRenderBatch(this.profiledSpeciesInstances.get(profile) ?? null);
      this.profiledSpeciesInstances.set(profile, null);
      this.profiledSpeciesKeys.set(profile, null);
    }
  }

  private disposePredatorRenderBatches(): void {
    for (const species of this.predatorInstances.keys()) {
      this.disposeRenderBatch(this.predatorInstances.get(species) ?? null);
    }
  }

  dispose(): void {
    this.disposeBoidRenderBatches();
    this.disposeProfiledSpeciesRenderBatches();
    this.disposePredatorRenderBatches();
    disposeRendererSceneAssets(this.sceneAssets);
    for (const style of SCENE_STYLES) {
      this.sceneRenderers[style].dispose();
    }
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { params, type TimeOfDayPreset, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import { BOID_SPECIES, BoidSpecies } from '../sim/Boid';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { CreatureGeometries } from './geometry/sharedGeometry';
import {
  getUprightFlapFrequencyMultiplier,
  getUprightHeadingSmoothingRate,
  getUprightMaxUpTilt,
  getUprightPitchLimits,
  getUprightTurnRate,
  isClampedUprightStyle,
  usesTailSwayMatrix,
  type UprightStyle,
} from './creatureUprightTuning';
import {
  createPredatorInstanceKey,
  createPredatorRenderFlags,
  createStyleFlags,
  type BoidMotionStyleFlags,
  type ColourStrategy,
  isPredatorSpecies,
  type MotionConfig,
  PredatorSpecies,
  type PredatorRenderFlags,
  type SpeciesColorSet,
  SCENE_PREDATOR_SPECIES,
  SCENE_STYLES,
  type SceneEnvironmentToggles,
  type SceneRendererHooks,
  type StyleFlags,
  UNICORN_PREDATOR_SPECIES,
  type CreatureLabels,
} from './sceneRenderers/createSceneRendererHooks';
import { createRendererSceneAssets, disposeRendererSceneAssets, type RendererSceneAssets } from './rendererSceneAssets';import { createRendererSceneRenderers } from './sceneRendererFactory';
import { UfoRenderer } from './UfoRenderer';
import { CameraController } from './CameraController';

// Wing-flap tuning. NOTE: the actual flap frequency/amplitude values are owned
// per-scene (each scene's MotionConfig provides them); only the shared
// flap-state-blend response constants below live here since they describe the
// one shared animation algorithm and are not varied per scene.
const CLIMB_FLAP_FREQ_BOOST = 0.12;
const DIVE_FLAP_FREQ_CUT = 0.1;
const TURN_FLAP_FREQ_BOOST = 0.06;
const PANIC_FLAP_FREQ_BOOST = 0.1;
const CLIMB_FLAP_AMP_BOOST = 0.12;
const DIVE_FLAP_AMP_BOOST = 0.08;
const TURN_FLAP_AMP_BOOST = 0.1;
const PANIC_FLAP_AMP_BOOST = 0.12;
const STATE_PITCH_SCALE = THREE.MathUtils.degToRad(18);

// Unicorns get their own dedicated "stay upright" orientation model in
// updateInstances (uprightStyle === 'unicorn'), not a scaled-down reuse of
// the dragon keepUpright path: pitch is hard-clamped asymmetrically (0 while
// climbing, a small nose-down droop while sinking) for a flatter, gentler
// flight style.
//
// Tail-sway phase offset: creatures with a swaying tail (dragons, sharks —
// see usesTailSwayMatrix) drive the tail from the wing flap phase, offset so
// it lags/leads rather than mirroring it. Amplitude/axis are per-scene
// (MotionConfig); only this shared phase relationship lives here.
const TAIL_SWAY_PHASE_OFFSET = Math.PI * 0.6; // lags the wingbeat rather than mirroring it exactly

// Dragons low-pass filter their heading direction (not just bank) before
// orientation — near a vertical heading the raw velocity direction is
// unstable (noise-level sideways components swing the azimuth wildly, like a
// compass near the pole). Non-dragons skip this since they don't anchor to
// world-up.
// Three.js cones/octahedra/lathes point along +Y by default; that's "forward".
const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
// Wings lie flat in the local Z=0 plane, so local +Z is the model's "dorsal/up"
// direction when level — used to keep orientation right-side-up.
const MODEL_UP_AXIS = new THREE.Vector3(0, 0, 1);
// Local "right" — axis the dragon tail-sway pitches around.
const MODEL_RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const WORLD_UP_AXIS = new THREE.Vector3(0, 1, 0);
// Near a vertical heading, world-up is a poor "level" reference: cross(WORLD_UP,
// forward) shrinks toward zero and normalizing it amplifies per-frame noise into
// a flickering direction. Fix: persist a per-creature "right" vector
// (Boid/Predator.renderRight). Outside a narrow near-vertical cone it's
// recomputed fresh from WORLD_UP every frame; only inside the cone do we reuse
// last frame's right (re-orthogonalized against forward via Gram-Schmidt),
// re-anchoring to WORLD_UP the instant the heading exits.
const NEAR_POLE_RIGHT_LENGTH_THRESHOLD = 0.15; // ~= sin(8.6°) from vertical
const NEAR_POLE_RIGHT_LENGTH_THRESHOLD_SQ = NEAR_POLE_RIGHT_LENGTH_THRESHOLD * NEAR_POLE_RIGHT_LENGTH_THRESHOLD;
// Last-ditch fallback when even the re-orthogonalized right vector has collapsed
// (forward changed too much frame to frame) — vanishingly rare, keeps the math
// well-defined.
const UP_REFERENCE_FALLBACK_AXIS = new THREE.Vector3(0, 0, 1);
// Roll (bank) when turning: smoothed and clamped well short of inverted — a
// clear banking lean, not a flip.
const MAX_BANK_RADIANS = THREE.MathUtils.degToRad(42);
const BANK_GAIN = 2.6;
const BANK_SMOOTHING_RATE = 5;

/**
 * Cheap deterministic pseudo-random hash from an integer id + a small "salt"
 * into [0, 1). Gives each boid a stable (no per-frame flicker) individual
 * color variation derived purely from its id.
 */
function idHash(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface CreatureInstanceMatrixArgs {
  set: BoidRenderBatch;
  index: number;
  creature: Boid | Predator;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number;
  maxSpeed: number;
  elapsed: number;
  dt: number;
  entityScale: number;
  blendStrength: number;
  climbWeight: number;
  diveWeight: number;
  turnWeight: number;
  panicWeight: number;
  cruiseWeight: number;
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  uprightStyle: UprightStyle;
}

interface CreatureInstanceColorArgs {
  set: BoidRenderBatch;
  index: number;
  creature: Boid | Predator;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((creature: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  useNatureParrotPalette: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
  hasBakedBodyVertexColors: boolean;
  hasBakedWingVertexColors: boolean;
  hasBakedTailVertexColors: boolean;
}

interface ResolvedMotionConfig {
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  getScale: (creature: Boid | Predator) => number;
  keepUpright: boolean;
  uprightStyle: UprightStyle;
  bankScale: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  preferUpright: boolean;
}

interface ResolvedColorStrategy {
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((creature: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  bakedBodyGradient: boolean;
  useNatureParrotPalette: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
}

interface UpdateCreatureInstanceArgs {
  set: BoidRenderBatch;
  index: number;
  creature: Boid | Predator;
  maxSpeed: number;
  elapsed: number;
  dt: number;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((creature: Boid | Predator) => SpeciesColorSet | null) | undefined;
  bakedWingPalette: boolean;
  useNatureParrotPalette: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
  hasBakedBodyVertexColors: boolean;
  hasBakedWingVertexColors: boolean;
  hasBakedTailVertexColors: boolean;
  flapFrequency: number;
  flapIdleAmplitude: number;
  flapSpeedAmplitude: number;
  getScale: (creature: Boid | Predator) => number;
  keepUpright: boolean;
  uprightStyle: UprightStyle;
  bankScale: number;
  finRestBiasRad: number;
  tailSwayAxis: THREE.Vector3;
  tailSwayAmplitude: number;
  tailSwayFrequency: number | undefined;
  tailSwayPivotY: number;
  worldScale: number;
  meshScaleBoost: number;
  preferUpright: boolean;
}
type UpdateCreatureSharedArgs = Omit<UpdateCreatureInstanceArgs, 'index' | 'creature'>;

// Unicorns reuse the body/wing/tail split (lavender body+tail, near-white
// wings so the baked rainbow gradient shows through) in nature style. The
// fishtank seahorse reuses this same pipeline but repurposes its "wing" slot
// as solid-colored pectoral fins (no baked gradient), so its wing/tail tint
// should match the body rather than the near-white rainbow-reading tint.

interface BoidRenderBatch {
  body: THREE.InstancedMesh;
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
  tail?: THREE.InstancedMesh;
  legs?: THREE.InstancedMesh;
  /** Small-bird-only: see CreatureGeometries.beak's doc comment. */
  beak?: THREE.InstancedMesh;
}

/**
 * Profile name for the "neutral" (non-focus-pattern) Multicolor boid batch —
 * the render batch that holds Multicolor boids not assigned to a scene-specific
 * geometry profile.
 */
const MULTICOLOR_BOID_NEUTRAL_PROFILE = 'neutral';

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private afterimagePass: AfterimagePass;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cameraController: CameraController;

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
  /**
   * Persisted, per-dragon displayed orientation — a final safety net on top
   * of the heading smoothing / near-pole "right" logic: the mesh only ever
   * rotates toward its target at a bounded rate (Quaternion.rotateTowards), so
   * any remaining glitch shows up as at worst a brief pause, never an instant
   * flip or flatten. Cleared when the predator batch is rebuilt.
   */
  private dragonDisplayQuats = new Map<number, THREE.Quaternion>();
  /** Turn-rate-limited display orientation state for non-dragon upright styles. */
  private clampedUprightDisplayQuats: Record<Exclude<UprightStyle, 'dragon'>, Map<number, THREE.Quaternion>> = {
    unicorn: new Map<number, THREE.Quaternion>(),
    shark: new Map<number, THREE.Quaternion>(),
  };
  /** Per-creature accumulated flap phase (radians), integrated every frame. */
  private flapPhase = new WeakMap<Boid | Predator, number>();
  private boundsHelper: THREE.LineSegments | null = null;
  private currentStyle: VisualStyle | null = null;
  private warmedShaderStyles = new Set<VisualStyle>();
  private pendingShaderWarmupStyles = new Set<VisualStyle>();

  private lastSeenCatchId = 0;
  private dummy = new THREE.Object3D();
  private bodyQuat = new THREE.Quaternion();
  private flapQuat = new THREE.Quaternion();
  private tailSwayQuat = new THREE.Quaternion();
  private pitchQuat = new THREE.Quaternion();
  // Scratch objects for composing "rotate the tail around its own
  // attachment point rather than the model's shared local origin" (see
  // tailSwayPivotY's doc comment on updateInstances).
  private tailPivotMatrix = new THREE.Matrix4();
  private tailPivotToOrigin = new THREE.Matrix4();
  private tailOriginToPivot = new THREE.Matrix4();
  private rollQuat = new THREE.Quaternion();
  private tmpSpawnPosition = new THREE.Vector3();
  private tmpSpawnDirection = new THREE.Vector3();
  // Sim world center, recomputed per frame while fishtank style is active —
  // used to "grow" fishtank boid positions symmetrically around the tank's
  // true center (see worldScale) rather than the coordinate origin.
  private fishtankCenter = new THREE.Vector3();
  private tmpForward = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpPersistedRight = new THREE.Vector3();
  private tmpPrevDir = new THREE.Vector3();
  private tmpBasisMatrix = new THREE.Matrix4();
  // Unicorn-only scratch objects for the pitch clamp / up-tilt safety
  // clamp in updateInstances — kept separate from the dragon-path tmp
  // vectors above since the unicorn orientation math is its own thing.
  private tmpUnicornHorizontal = new THREE.Vector3();
  private tmpUnicornUpWorld = new THREE.Vector3();
  private tmpUnicornTiltAxis = new THREE.Vector3();
  private unicornTiltCorrection = new THREE.Quaternion();
  private stateColor = new THREE.Color();
  private variantColor = new THREE.Color();
  private wingColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();
  private hsl = { h: 0, s: 0, l: 0 };
  private startTime = performance.now();
  private lastElapsed = 0;
  private appliedFogEnabled: boolean | null = null;
  private appliedTimeOfDay: TimeOfDayPreset | null = null;
  private appliedLightShaftsEnabled: boolean | null = null;
  private appliedWaterEffectsEnabled: boolean | null = null;
  private appliedShadowsEnabled: boolean | null = null;
  private sceneRenderers!: Record<VisualStyle, SceneRendererHooks>;

  constructor(canvas: HTMLCanvasElement) {
    // logarithmicDepthBuffer: the near/far planes span a huge ratio (1 to
    // 30000 for the nature sky dome); a standard depth buffer leaves too
    // little precision at fishtank distances, causing z-fighting on thin
    // stacked surfaces (tank window layers). Log depth spreads precision
    // evenly across the range.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // ACES tone mapping keeps the physically-based Sky shader from blowing
    // out to solid white and gives the nature-style earth tones more depth.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    this.renderer.shadowMap.enabled = true;
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
    this.keyLight.castShadow = true;
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
    this.composer.addPass(new OutputPass());

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

  private buildRenderBatch(
    geometries: CreatureGeometries,
    style: VisualStyle,
    count: number,
    isMonster: boolean = false,
    rainbowWings: boolean = false,
    bodyVertexColors: boolean = false,
    bodyEmissiveOverride?: THREE.Color,
  ): BoidRenderBatch {
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

    const body = new THREE.InstancedMesh(geometries.body, bodyMaterial, Math.max(count, 1));
    const wingLeft = new THREE.InstancedMesh(geometries.wingLeft, wingMaterial, Math.max(count, 1));
    const wingRight = new THREE.InstancedMesh(geometries.wingRight, wingMaterial.clone(), Math.max(count, 1));
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
      tail = new THREE.InstancedMesh(geometries.tail, tailMaterial, Math.max(count, 1));
      tail.count = count;
      tail.frustumCulled = false;
      tail.castShadow = true;
      tail.receiveShadow = true;
      this.scene.add(tail);
    }

    let legs: THREE.InstancedMesh | undefined;
    if (geometries.legs) {
      // Legs are scaly like the body, not membranous like wings/tail, so
      // clone the body material (not the wing material) to pick up matching
      // per-instance scale-color tinting.
      const legsMaterial = bodyMaterial.clone();
      legs = new THREE.InstancedMesh(geometries.legs, legsMaterial, Math.max(count, 1));
      legs.count = count;
      legs.frustumCulled = false;
      legs.castShadow = true;
      legs.receiveShadow = true;
      this.scene.add(legs);
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

    return { body, wingLeft, wingRight, tail, legs, beak };
  }

  /**
   * Nudges `target` to a small, stable-per-id HSL jitter around `base`
   * (mutates in place so callers can reuse a scratch Color). Shared by the
   * sparrow "shades of brown" variation and the parrot per-individual jitter.
   */
  private jitterHSL(
    target: THREE.Color,
    base: THREE.Color,
    id: number,
    salt: number,
    hueAmt: number,
    satAmt: number,
    lightAmt: number,
  ): void {
    base.getHSL(this.hsl);
    let { h, s, l } = this.hsl;
    h = (h + (idHash(id, salt) - 0.5) * hueAmt + 1) % 1;
    s = Math.max(0, Math.min(1, s + (idHash(id, salt + 10) - 0.5) * satAmt));
    l = Math.max(0, Math.min(1, l + (idHash(id, salt + 20) - 0.5) * lightAmt));
    target.setHSL(h, s, l);
  }

  private disposeRenderBatch(set: BoidRenderBatch | null): void {
    if (!set) return;
    const meshes = [
      set.body,
      set.wingLeft,
      set.wingRight,
      ...(set.tail ? [set.tail] : []),
      ...(set.legs ? [set.legs] : []),
      ...(set.beak ? [set.beak] : []),
    ];
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
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
    const sceneRenderer = this.getSceneRenderer(style);
    const presentation = sceneRenderer.getPresentationSettings();
    this.bloomPass.enabled = presentation.bloomEnabled;
    // The afterimage/motion-trail effect persists whole previous frames —
    // great for arcade neon trails, but in organic (fog-using) styles a camera
    // pan drags a smeary ghost trail of the bright sky/water across the frame.
    this.afterimagePass.enabled = presentation.afterimageEnabled;
    sceneRenderer.setStyleVisibility();
    if (this.boundsHelper) this.boundsHelper.visible = presentation.boundsHelperVisible;
    this.ambientLight.intensity = presentation.ambientLightIntensity;
    this.keyLight.visible = presentation.keyLightVisible;

    // Re-apply the zoom clamp for the new style: nature's distance fog
    // needs a tight max zoom-out, while fishtank now has real geometry
    // (a table + room) around the tank that's worth seeing when zoomed
    // out further, so it gets a much looser clamp than nature.
    const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
    sceneRenderer.applyStyleTransition(sim, maxDim, wasFishtank);
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
    const shadowsEnabled = params.mode === '3d' && params.softShadowsEnabled;
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
        const { geometries, bodyVertexColors, bodyEmissiveOverride } = sceneRenderer.getBoidInstanceConfig(species, flags);
        this.speciesInstances.set(
          species,
          this.buildRenderBatch(geometries, style, count, false, false, bodyVertexColors, bodyEmissiveOverride),
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
        this.buildRenderBatch(
          neutralConfig.geometries,
          style,
          neutralCount,
          false,
          false,
          neutralConfig.bodyVertexColors,
        ),
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
          this.buildRenderBatch(
            profileConfig.geometries,
            style,
            profileCount,
            false,
            false,
            profileConfig.bodyVertexColors,
          ),
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
          this.buildRenderBatch(
            config.geometries,
            style,
            count,
            speciesRenderFlags.isMonster,
            config.rainbowWings,
            config.bodyVertexColors,
          ),
        );
        this.predatorInstanceKeys.set(species, instanceKey);
        this.resetPredatorOrientationCaches(species);
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

  private resetPredatorOrientationCaches(species: PredatorSpecies): void {
    if (species === UNICORN_PREDATOR_SPECIES) {
      this.clampedUprightDisplayQuats.unicorn.clear();
      return;
    }
    if (species === PredatorSpecies.Monster) {
      this.dragonDisplayQuats.clear();
      return;
    }
    // Normal (hawk) — uses the shark clamp cache for the shark upright style in fishtank
    this.clampedUprightDisplayQuats.shark.clear();
  }

  /** Recreates instanced meshes, environment, and world-bounds wireframe as population/world/style change. */
  private ensureScene(sim: Simulation, style: VisualStyle, flags: StyleFlags): void {
    this.reconcileBoidRenderBatches(sim, style, flags);

    this.reconcilePredatorRenderBatches(sim, style, flags);

    this.applyStyleTransitionOnStyleChange(sim, style);

    this.updateEnvironmentParameterToggles();

    // Model Gallery poses the fishtank camera inside the tank/water volume
    // (see main.ts's poseGalleryCreatureIfReady) — hide the surrounding room
    // while active so the glass/water doesn't show the room behind the creature.
    const galleryCreatureActive = params.galleryCreature !== null;
    for (const sceneStyle of SCENE_STYLES) {
      this.sceneRenderers[sceneStyle].setGalleryCreatureActive(galleryCreatureActive);
    }

    this.ensureBoundsHelperAndFraming(sim, style);

    this.scheduleShaderWarmup(style);
  }

  private updateCreatureRenderHeading(
    creature: Boid | Predator,
    speed: number,
    dt: number,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
  ): void {
    if (speed <= 1e-6) return;
    const invSpeed = 1 / speed;
    const targetX = creature.velocity.x * invSpeed;
    const targetY = creature.velocity.y * invSpeed;
    const targetZ = creature.velocity.z * invSpeed;
    if (keepUpright) {
      const rate = 1 - Math.exp(-dt * getUprightHeadingSmoothingRate(uprightStyle));
      let hx = creature.renderHeading.x + (targetX - creature.renderHeading.x) * rate;
      let hy = creature.renderHeading.y + (targetY - creature.renderHeading.y) * rate;
      let hz = creature.renderHeading.z + (targetZ - creature.renderHeading.z) * rate;
      const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      creature.renderHeading.x = hx / len;
      creature.renderHeading.y = hy / len;
      creature.renderHeading.z = hz / len;
      return;
    }
    creature.renderHeading.x = targetX;
    creature.renderHeading.y = targetY;
    creature.renderHeading.z = targetZ;
  }

  private clampForwardPitchForUprightStyle(uprightStyle: UprightStyle): void {
    const pitchLimits = getUprightPitchLimits(uprightStyle);
    if (!pitchLimits) return;
    this.tmpUnicornHorizontal.set(this.tmpForward.x, 0, this.tmpForward.z);
    const horizontalLen = this.tmpUnicornHorizontal.length();
    if (horizontalLen <= 1e-6) return;
    this.tmpUnicornHorizontal.divideScalar(horizontalLen);
    const rawPitch = Math.atan2(this.tmpForward.y, horizontalLen);
    const clampedPitch = THREE.MathUtils.clamp(rawPitch, -pitchLimits.descend, pitchLimits.ascend);
    this.tmpForward.copy(this.tmpUnicornHorizontal).multiplyScalar(Math.cos(clampedPitch));
    this.tmpForward.y = Math.sin(clampedPitch);
  }

  private setPersistedUprightBasis(creature: Boid | Predator): void {
    this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS);
    if (this.tmpRight.lengthSq() < NEAR_POLE_RIGHT_LENGTH_THRESHOLD_SQ) {
      this.tmpPersistedRight.set(creature.renderRight.x, creature.renderRight.y, creature.renderRight.z);
      this.tmpPersistedRight.addScaledVector(this.tmpForward, -this.tmpPersistedRight.dot(this.tmpForward));
      if (this.tmpPersistedRight.lengthSq() < 1e-10) {
        this.tmpPersistedRight.crossVectors(this.tmpForward, UP_REFERENCE_FALLBACK_AXIS);
      }
      this.tmpRight.copy(this.tmpPersistedRight);
    }
    this.tmpRight.normalize();
    creature.renderRight.x = this.tmpRight.x;
    creature.renderRight.y = this.tmpRight.y;
    creature.renderRight.z = this.tmpRight.z;
    this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
    this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
    this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
  }

  private setSimpleUprightBasis(creature: Boid | Predator): void {
    this.tmpRight.crossVectors(this.tmpForward, WORLD_UP_AXIS).normalize();
    creature.renderRight.x = this.tmpRight.x;
    creature.renderRight.y = this.tmpRight.y;
    creature.renderRight.z = this.tmpRight.z;
    this.tmpUp.crossVectors(this.tmpRight, this.tmpForward).normalize();
    this.tmpBasisMatrix.makeBasis(this.tmpRight, this.tmpForward, this.tmpUp);
    this.bodyQuat.setFromRotationMatrix(this.tmpBasisMatrix);
  }

  private clampDisplayUpTilt(displayQuat: THREE.Quaternion, maxUpTiltRadians: number): void {
    this.tmpUnicornUpWorld.copy(MODEL_UP_AXIS).applyQuaternion(displayQuat);
    const upTilt = this.tmpUnicornUpWorld.angleTo(WORLD_UP_AXIS);
    if (upTilt <= maxUpTiltRadians) return;
    this.tmpUnicornTiltAxis.crossVectors(this.tmpUnicornUpWorld, WORLD_UP_AXIS);
    if (this.tmpUnicornTiltAxis.lengthSq() <= 1e-10) return;
    this.tmpUnicornTiltAxis.normalize();
    this.unicornTiltCorrection.setFromAxisAngle(this.tmpUnicornTiltAxis, upTilt - maxUpTiltRadians);
    displayQuat.premultiply(this.unicornTiltCorrection);
  }

  private applyUprightDisplaySmoothing(creature: Boid | Predator, dt: number, uprightStyle: UprightStyle): void {
    if (uprightStyle === 'dragon') {
      let displayQuat = this.dragonDisplayQuats.get(creature.id);
      if (!displayQuat) {
        displayQuat = this.bodyQuat.clone();
        this.dragonDisplayQuats.set(creature.id, displayQuat);
      } else {
        displayQuat.rotateTowards(this.bodyQuat, getUprightTurnRate(uprightStyle) * dt);
      }
      this.bodyQuat.copy(displayQuat);
      return;
    }

    const displayQuatMap = this.getClampedUprightDisplayQuatMap(uprightStyle);
    let displayQuat = displayQuatMap.get(creature.id);
    if (!displayQuat) {
      displayQuat = this.bodyQuat.clone();
      displayQuatMap.set(creature.id, displayQuat);
    } else {
      displayQuat.rotateTowards(this.bodyQuat, getUprightTurnRate(uprightStyle) * dt);
    }
    const maxUpTilt = getUprightMaxUpTilt(uprightStyle);
    if (maxUpTilt !== null) {
      this.clampDisplayUpTilt(displayQuat, maxUpTilt);
    }
    this.bodyQuat.copy(displayQuat);
  }

  private getClampedUprightDisplayQuatMap(
    uprightStyle: Exclude<UprightStyle, 'dragon'>,
  ): Map<number, THREE.Quaternion> {
    return this.clampedUprightDisplayQuats[uprightStyle];
  }

  private applyBodyOrientationBasis(
    creature: Boid | Predator,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
    preferUpright: boolean,
  ): void {
    if (keepUpright && isClampedUprightStyle(uprightStyle)) {
      this.clampForwardPitchForUprightStyle(uprightStyle);
    }

    if (keepUpright && uprightStyle === 'dragon') {
      this.setPersistedUprightBasis(creature);
    } else if (keepUpright && isClampedUprightStyle(uprightStyle)) {
      this.setSimpleUprightBasis(creature);
    } else if (preferUpright) {
      this.setPersistedUprightBasis(creature);
    } else {
      this.bodyQuat.setFromUnitVectors(FORWARD_AXIS, this.tmpForward);
    }
  }

  private applyTurnBankAndPitch(
    creature: Boid | Predator,
    vel: { x: number; y: number; z: number },
    maxSpeed: number,
    dt: number,
    bankScale: number,
    keepUpright: boolean,
    getIntensity: (creature: Boid | Predator) => number,
  ): {
    blendStrength: number;
    climbWeight: number;
    diveWeight: number;
    turnWeight: number;
    panicWeight: number;
    cruiseWeight: number;
  } {
    const turnSignal = this.tmpPrevDir.cross(this.tmpForward).y;
    const turnWeight = THREE.MathUtils.clamp(Math.abs(turnSignal) * 16, 0, 1);
    const climbWeight = maxSpeed > 0 ? THREE.MathUtils.clamp(vel.y / maxSpeed, 0, 1) : 0;
    const diveWeight = maxSpeed > 0 ? THREE.MathUtils.clamp(-vel.y / maxSpeed, 0, 1) : 0;
    const panicWeight = THREE.MathUtils.clamp(getIntensity(creature), 0, 1);
    const cruiseWeight = Math.max(0, 1 - Math.max(climbWeight, diveWeight, turnWeight, panicWeight * 0.75));
    const blendStrength = THREE.MathUtils.clamp(params.animationBlendStrength, 0, 1);
    const targetBank = THREE.MathUtils.clamp(
      -turnSignal * BANK_GAIN * bankScale * (1 + turnWeight * 0.3 + panicWeight * 0.2),
      -MAX_BANK_RADIANS * bankScale,
      MAX_BANK_RADIANS * bankScale,
    );
    const bankSmoothing = 1 - Math.exp(-dt * BANK_SMOOTHING_RATE);
    creature.renderBank += (targetBank - creature.renderBank) * bankSmoothing;
    this.rollQuat.setFromAxisAngle(FORWARD_AXIS, creature.renderBank);
    this.bodyQuat.multiply(this.rollQuat);
    if (!keepUpright) {
      const blendedPitch = (diveWeight - climbWeight) * STATE_PITCH_SCALE * blendStrength;
      this.pitchQuat.setFromAxisAngle(MODEL_RIGHT_AXIS, blendedPitch);
      this.bodyQuat.multiply(this.pitchQuat);
    }
    return {
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
    };
  }

  private getBakedColorAttributeFlags(
    set: BoidRenderBatch,
    bakedBodyGradient: boolean,
  ): {
    hasBakedBodyVertexColors: boolean;
    hasBakedWingVertexColors: boolean;
    hasBakedTailVertexColors: boolean;
  } {
    return {
      hasBakedBodyVertexColors: bakedBodyGradient && !!set.body.geometry.getAttribute('color'),
      hasBakedWingVertexColors: bakedBodyGradient && !!set.wingLeft.geometry.getAttribute('color'),
      hasBakedTailVertexColors: bakedBodyGradient && !!set.tail?.geometry.getAttribute('color'),
    };
  }

  private applyInstanceColorsForCreature(args: CreatureInstanceColorArgs): void {
    const {
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    } = args;
    const speciesColors = getSpeciesColors?.(creature);
    let effectiveBase = baseColor;
    let effectiveWing: THREE.Color | null = null;
    let effectiveTail: THREE.Color | null = null;
    let preserveParrotLegPalette = false;

    if (speciesColors) {
      const isGreenParrotVariant = useNatureParrotPalette
        && speciesColors.body.getHex() === 0x44b749
        && speciesColors.wing.getHex() === 0x44b749;
      if (lockSpeciesPalette || isGreenParrotVariant) {
        effectiveBase = speciesColors.body;
        effectiveWing = speciesColors.wing;
        effectiveTail = speciesColors.tail;
      } else {
        this.jitterHSL(this.variantColor, speciesColors.body, creature.id, 1, 0.05, 0.12, 0.1);
        this.jitterHSL(this.wingColor, speciesColors.wing, creature.id, 2, 0.05, 0.12, 0.1);
        this.jitterHSL(this.tailColor, speciesColors.tail, creature.id, 3, 0.05, 0.12, 0.1);
        effectiveBase = this.variantColor;
        effectiveWing = this.wingColor;
        effectiveTail = this.tailColor;
      }
    } else if (individualVariation) {
      baseColor.getHSL(this.hsl);
      let { h, s, l } = this.hsl;
      h = (h + (idHash(creature.id, 1) - 0.5) * 0.05 + 1) % 1;
      s = Math.max(0, Math.min(1, s + (idHash(creature.id, 2) - 0.5) * 0.16));
      l = Math.max(0, Math.min(1, l + (idHash(creature.id, 3) - 0.5) * 0.18));
      const morphRoll = idHash(creature.id, 4);
      if (morphRoll < 0.06) {
        // Pale/leucistic-like morph: much lighter, slightly desaturated.
        l = Math.max(0, Math.min(0.92, l + 0.28));
        s *= 0.6;
      } else if (morphRoll < 0.1) {
        // Dark/melanistic-like morph: noticeably darker.
        l = Math.max(0.05, l - 0.22);
      } else if (morphRoll < 0.16) {
        // Warmer, rustier-toned morph: shift hue toward red-orange.
        h = (h + 0.03) % 1;
        s = Math.min(1, s + 0.15);
      }
      this.variantColor.setHSL(h, s, l);
      effectiveBase = this.variantColor;
    }
    if (hasBakedBodyVertexColors) {
      // Baked gradient body — pass white so the vertex colours show through.
      this.stateColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
    } else {
      this.stateColor.copy(effectiveBase).lerp(highlightColor, getIntensity(creature));
    }
    set.body.setColorAt(index, this.stateColor);
    if (hasBakedWingVertexColors) {
      // Baked gradient wings — white passthrough; same for tail if baked.
      this.wingColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (hasBakedTailVertexColors) {
          this.tailColor.setRGB(1, 1, 1).lerp(highlightColor, getIntensity(creature));
        } else {
          this.tailColor.copy(this.wingColor);
        }
        set.tail.setColorAt(index, this.tailColor);
      }
    } else if (effectiveWing) {
      const preserveParrotWingPalette = useNatureParrotPalette
        && bakedWingPalette
        && !!set.wingLeft.geometry.getAttribute('color');
      const preserveParrotTailPalette = preserveParrotWingPalette
        && !!set.tail?.geometry.getAttribute('color');
      preserveParrotLegPalette = preserveParrotWingPalette
        && !!set.legs?.geometry.getAttribute('color');
      // Species with their own distinct wing/tail base colors keep those
      // hues rather than just darkening the body color.
      if (preserveParrotWingPalette) {
        this.wingColor.setRGB(1, 1, 1);
      } else {
        this.wingColor.copy(effectiveWing).lerp(highlightColor, getIntensity(creature));
      }
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) {
        if (effectiveTail) {
          if (preserveParrotTailPalette) {
            this.tailColor.setRGB(1, 1, 1);
          } else {
            this.tailColor.copy(effectiveTail).lerp(highlightColor, getIntensity(creature));
          }
          set.tail.setColorAt(index, this.tailColor);
        } else {
          set.tail.setColorAt(index, this.wingColor);
        }
      }
    } else if (individualVariation) {
      // Wings/tail render a touch darker than the body — real bird wing
      // feathers are almost always a shade or two darker than the breast/
      // body plumage, and this reads clearly even at a distance.
      this.wingColor.copy(this.stateColor).multiplyScalar(0.82);
      set.wingLeft.setColorAt(index, this.wingColor);
      set.wingRight.setColorAt(index, this.wingColor);
      if (set.tail) set.tail.setColorAt(index, this.wingColor);
    } else {
      set.wingLeft.setColorAt(index, this.stateColor);
      set.wingRight.setColorAt(index, this.stateColor);
      if (set.tail) {
        // Auto-detect baked vertex colours on the tail (e.g. dragon gradient
        // tail). Pass white so the gradient shows through; otherwise use
        // stateColor like the wings.
        if (set.tail.geometry.getAttribute('color')) {
          this.tailColor.setRGB(1, 1, 1);
        } else {
          this.tailColor.copy(this.stateColor);
        }
        set.tail.setColorAt(index, this.tailColor);
      }
    }
    if (set.legs) {
      if (preserveParrotLegPalette || set.legs.geometry.getAttribute('color')) {
        // Parrot legs: baked palette feet color, pass through with white.
        // Small-bird legs: baked species leg color, same white pass-through.
        this.legsColor.setRGB(1, 1, 1);
      } else {
        this.legsColor.copy(this.stateColor);
      }
      set.legs.setColorAt(index, this.legsColor);
    }
    if (set.beak && beakColor) {
      // Small per-individual jitter, same treatment as the other parts
      // — keeps a flock of e.g. cardinals from looking like every
      // single beak is the identical exact pixel color.
      this.jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }

  private markRenderBatchNeedsUpdate(set: BoidRenderBatch): void {
    set.body.instanceMatrix.needsUpdate = true;
    set.wingLeft.instanceMatrix.needsUpdate = true;
    set.wingRight.instanceMatrix.needsUpdate = true;
    if (set.body.instanceColor) set.body.instanceColor.needsUpdate = true;
    if (set.wingLeft.instanceColor) set.wingLeft.instanceColor.needsUpdate = true;
    if (set.wingRight.instanceColor) set.wingRight.instanceColor.needsUpdate = true;
    if (set.tail) {
      set.tail.instanceMatrix.needsUpdate = true;
      if (set.tail.instanceColor) set.tail.instanceColor.needsUpdate = true;
    }
    if (set.legs) {
      set.legs.instanceMatrix.needsUpdate = true;
      if (set.legs.instanceColor) set.legs.instanceColor.needsUpdate = true;
    }
    if (set.beak) {
      set.beak.instanceMatrix.needsUpdate = true;
      if (set.beak.instanceColor) set.beak.instanceColor.needsUpdate = true;
    }
  }

  private applyCreatureInstanceMatrices(args: CreatureInstanceMatrixArgs): void {
    const {
      set,
      index,
      creature,
      position,
      velocity,
      speed,
      maxSpeed,
      elapsed,
      dt,
      entityScale,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      uprightStyle,
    } = args;
    this.applyCreatureBodyMatrices(set, index, position, entityScale, worldScale, meshScaleBoost, uprightStyle);

    // Wings: apply an extra local flap rotation around the forward axis.
    const flapAngle = this.computeWingFlapAngle(
      creature,
      velocity,
      speed,
      maxSpeed,
      dt,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      uprightStyle,
    );
    this.applyWingFlapMatrices(set, index, flapAngle);

    this.applyCreatureTailSwayMatrix(
      set,
      index,
      creature,
      elapsed,
      flapFrequency,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      uprightStyle,
    );
  }

  private applyCreatureBodyMatrices(
    set: BoidRenderBatch,
    i: number,
    pos: { x: number; y: number; z: number },
    entityScale: number,
    worldScale: number,
    meshScaleBoost: number,
    uprightStyle: UprightStyle,
  ): void {
    // Body: just position + orientation, no flap.
    if (worldScale !== 1) {
      this.dummy.position.set(
        this.fishtankCenter.x + (pos.x - this.fishtankCenter.x) * worldScale,
        this.fishtankCenter.y + (pos.y - this.fishtankCenter.y) * worldScale,
        this.fishtankCenter.z + (pos.z - this.fishtankCenter.z) * worldScale,
      );
    } else {
      this.dummy.position.set(pos.x, pos.y, pos.z);
    }
    this.dummy.quaternion.copy(this.bodyQuat);
    this.dummy.scale.setScalar(entityScale * worldScale * meshScaleBoost);
    this.dummy.updateMatrix();
    set.body.setMatrixAt(i, this.dummy.matrix);
    if (set.legs) set.legs.setMatrixAt(i, this.dummy.matrix);
    if (set.beak) set.beak.setMatrixAt(i, this.dummy.matrix);
    if (set.tail && !usesTailSwayMatrix(uprightStyle)) set.tail.setMatrixAt(i, this.dummy.matrix);
  }

  private computeWingFlapAngle(
    creature: Boid | Predator,
    vel: { x: number; y: number; z: number },
    speed: number,
    maxSpeed: number,
    dt: number,
    blendStrength: number,
    climbWeight: number,
    diveWeight: number,
    turnWeight: number,
    panicWeight: number,
    cruiseWeight: number,
    flapFrequency: number,
    flapIdleAmplitude: number,
    flapSpeedAmplitude: number,
    finRestBiasRad: number,
    uprightStyle: UprightStyle,
  ): number {
    const speedFrac = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
    const amplitudeBase = flapIdleAmplitude + flapSpeedAmplitude * speedFrac;
    const stateResponse = 0.55;
    const stateFrequencyMultRaw =
      1
      + blendStrength * stateResponse * (
        climbWeight * CLIMB_FLAP_FREQ_BOOST
        - diveWeight * DIVE_FLAP_FREQ_CUT
        + turnWeight * TURN_FLAP_FREQ_BOOST
        + panicWeight * PANIC_FLAP_FREQ_BOOST
        - cruiseWeight * 0.04
      );
    const stateAmplitudeMultRaw =
      1
      + blendStrength * stateResponse * (
        climbWeight * CLIMB_FLAP_AMP_BOOST
        + diveWeight * DIVE_FLAP_AMP_BOOST
        + turnWeight * TURN_FLAP_AMP_BOOST
        + panicWeight * PANIC_FLAP_AMP_BOOST
        - cruiseWeight * 0.06
      );
    const stateFrequencyMult = THREE.MathUtils.clamp(stateFrequencyMultRaw, 0.8, 1.18);
    const stateAmplitudeMult = THREE.MathUtils.clamp(stateAmplitudeMultRaw, 0.82, 1.24);
    const amplitude = amplitudeBase * stateAmplitudeMult;
    const climbFrac = maxSpeed > 0 ? THREE.MathUtils.clamp(vel.y / maxSpeed, -1, 1) : 0;
    const uprightFrequencyMultiplier = getUprightFlapFrequencyMultiplier(uprightStyle, climbFrac);
    const effectiveFrequency = flapFrequency * stateFrequencyMult * uprightFrequencyMultiplier;
    const prevPhase = this.flapPhase.get(creature) ?? creature.id * 1.7;
    const phase = prevPhase + effectiveFrequency * dt;
    this.flapPhase.set(creature, phase);
    return amplitude * Math.sin(phase) + finRestBiasRad;
  }

  private applyWingFlapMatrices(set: BoidRenderBatch, i: number, flapAngle: number): void {
    this.flapQuat.setFromAxisAngle(FORWARD_AXIS, flapAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
    this.dummy.updateMatrix();
    set.wingLeft.setMatrixAt(i, this.dummy.matrix);

    this.flapQuat.setFromAxisAngle(FORWARD_AXIS, -flapAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
    this.dummy.updateMatrix();
    set.wingRight.setMatrixAt(i, this.dummy.matrix);
  }

  private applyCreatureTailSwayMatrix(
    set: BoidRenderBatch,
    i: number,
    creature: Boid | Predator,
    elapsed: number,
    flapFrequency: number,
    tailSwayAxis: THREE.Vector3,
    tailSwayAmplitude: number,
    tailSwayFrequency: number | undefined,
    tailSwayPivotY: number,
    uprightStyle: UprightStyle,
  ): void {
    // Tail sway (dragons/sharks only).
    if (!set.tail) return;
    if (!usesTailSwayMatrix(uprightStyle)) return;
    const tailPhase = elapsed * (tailSwayFrequency ?? flapFrequency) + creature.id * 1.7 + TAIL_SWAY_PHASE_OFFSET;
    const tailSwayAngle = tailSwayAmplitude * Math.sin(tailPhase);
    this.tailSwayQuat.setFromAxisAngle(tailSwayAxis, tailSwayAngle);
    this.dummy.quaternion.copy(this.bodyQuat).multiply(this.tailSwayQuat);
    this.dummy.updateMatrix();
    if (tailSwayPivotY !== 0) {
      this.dummy.quaternion.copy(this.bodyQuat);
      this.dummy.updateMatrix();
      this.tailPivotToOrigin.makeTranslation(0, -tailSwayPivotY, 0);
      this.tailOriginToPivot.makeTranslation(0, tailSwayPivotY, 0);
      this.tailPivotMatrix.makeRotationFromQuaternion(this.tailSwayQuat);
      this.tailPivotMatrix.premultiply(this.tailOriginToPivot);
      this.tailPivotMatrix.multiply(this.tailPivotToOrigin);
      this.dummy.matrix.multiply(this.tailPivotMatrix);
    }
    set.tail.setMatrixAt(i, this.dummy.matrix);
  }

  private applyCreatureOrientationAndMotion(
    creature: Boid | Predator,
    speed: number,
    vel: { x: number; y: number; z: number },
    maxSpeed: number,
    dt: number,
    keepUpright: boolean,
    uprightStyle: UprightStyle,
    preferUpright: boolean,
    bankScale: number,
    getIntensity: (creature: Boid | Predator) => number,
  ): {
    blendStrength: number;
    climbWeight: number;
    diveWeight: number;
    turnWeight: number;
    panicWeight: number;
    cruiseWeight: number;
  } {
    // Each creature keeps its own last-known heading (renderHeading) rather
    // than relying on this.bodyQuat carrying over between loop iterations —
    // otherwise a near-stopped creature would inherit the previous creature's
    // heading and snap to an unrelated direction.
    this.tmpPrevDir.set(creature.renderHeading.x, creature.renderHeading.y, creature.renderHeading.z);
    this.updateCreatureRenderHeading(creature, speed, dt, keepUpright, uprightStyle);
    const dir = creature.renderHeading;
    this.tmpForward.set(dir.x, dir.y, dir.z);
    this.applyBodyOrientationBasis(creature, keepUpright, uprightStyle, preferUpright);

    const motionBlend = this.applyTurnBankAndPitch(
      creature,
      vel,
      maxSpeed,
      dt,
      bankScale,
      keepUpright,
      getIntensity,
    );
    if (keepUpright) this.applyUprightDisplaySmoothing(creature, dt, uprightStyle);
    return motionBlend;
  }

  private resolveMotionConfig(motion: MotionConfig): ResolvedMotionConfig {
    const {
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale = () => 1,
      keepUpright = false,
      uprightStyle = 'dragon' as const,
      bankScale = 1,
      finRestBiasRad = 0,
      tailSwayAxis = MODEL_RIGHT_AXIS,
      tailSwayAmplitude = 0,
      tailSwayFrequency,
      tailSwayPivotY = 0,
      worldScale = 1,
      meshScaleBoost = 1,
      preferUpright = false,
    } = motion;

    return {
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    };
  }

  private resolveColourStrategy(colours: ColourStrategy): ResolvedColorStrategy {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation = false,
      getSpeciesColors,
      bakedWingPalette = false,
      bakedBodyGradient = false,
      useNatureParrotPalette = false,
      lockSpeciesPalette = false,
      beakColor,
    } = colours;

    return {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      bakedBodyGradient,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
    };
  }

  private updateCreatureInstance(args: UpdateCreatureInstanceArgs): void {
    const {
      set,
      index,
      creature,
      maxSpeed,
      elapsed,
      dt,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    } = args;
    const pos = creature.position;
    const vel = creature.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const entityScale = getScale(creature);
    const {
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
    } = this.applyCreatureOrientationAndMotion(
      creature,
      speed,
      vel,
      maxSpeed,
      dt,
      keepUpright,
      uprightStyle,
      preferUpright,
      bankScale,
      getIntensity,
    );
    this.applyCreatureInstanceMatrices({
      set,
      index,
      creature,
      position: pos,
      velocity: vel,
      speed,
      maxSpeed,
      elapsed,
      dt,
      entityScale,
      blendStrength,
      climbWeight,
      diveWeight,
      turnWeight,
      panicWeight,
      cruiseWeight,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      uprightStyle,
    });

    this.applyInstanceColorsForCreature({
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    });
  }

  private updateCreatureInstancesLoop(
    creatures: (Boid | Predator)[],
    sharedArgs: UpdateCreatureSharedArgs,
  ): void {
    for (let i = 0; i < creatures.length; i++) {
      this.updateCreatureInstance({
        ...sharedArgs,
        index: i,
        creature: creatures[i],
      });
    }
  }

  private updateInstances(
    set: BoidRenderBatch,
    creatures: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
    dt: number,
    colours: ColourStrategy,
    motion: MotionConfig,
  ): void {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      bakedBodyGradient,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
    } = this.resolveColourStrategy(colours);
    const {
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    } = this.resolveMotionConfig(motion);

    // Small songbirds (nature) bake a gradient into their geometry. When
    // bakedBodyGradient is true, pass white as the instance color so the vertex
    // colors show through unchanged. We can't infer this from a 'color'
    // attribute alone, since dragon/hawk geometry also carries vertex colors.
    const {
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    } = this.getBakedColorAttributeFlags(set, bakedBodyGradient);
    this.updateCreatureInstancesLoop(creatures, {
      set,
      maxSpeed,
      elapsed,
      dt,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      bakedWingPalette,
      useNatureParrotPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
      flapFrequency,
      flapIdleAmplitude,
      flapSpeedAmplitude,
      getScale,
      keepUpright,
      uprightStyle,
      bankScale,
      finRestBiasRad,
      tailSwayAxis,
      tailSwayAmplitude,
      tailSwayFrequency,
      tailSwayPivotY,
      worldScale,
      meshScaleBoost,
      preferUpright,
    });

    this.markRenderBatchNeedsUpdate(set);
  }

  /** Spawns a 3D blood-splatter burst for every not-yet-seen Simulation.catchEvent. */
  private spawnBloodFromCatches(sim: Simulation, sceneRenderer: SceneRendererHooks): void {
    const bloodSplatterScale = sceneRenderer.getBloodSplatterScale();
    for (const catchEvent of sim.catchEvents) {
      if (catchEvent.id <= this.lastSeenCatchId) continue;
      this.lastSeenCatchId = catchEvent.id;
      this.tmpSpawnPosition.set(catchEvent.position.x, catchEvent.position.y, catchEvent.position.z);
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
   * Model Gallery: converts a sim-space position into the world-space position
   * it actually renders at. No-op for nature/arcade, but fishtank inflates
   * positions by TANK_VISUAL_SCALE from fishtankCenter — gallery framing must
   * target this position, not the raw sim-space one.
   */
  toRenderedPosition(x: number, y: number, z: number): THREE.Vector3 {
    const rendered = new THREE.Vector3();
    this.getActiveSceneRenderer().mapPositionToRenderSpace(x, y, z, rendered);
    return rendered;
  }

  /** Model Gallery / debug-QA camera framing — see CameraController.debugFrameCamera. */
  debugFrameCamera(x: number, y: number, z: number, distance: number): void {
    this.cameraController.debugFrameCamera(x, y, z, distance);
  }

  /**
   * Model Gallery: computes a debugFrameCamera distance that frames the
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
    for (const mesh of [set.body, set.wingLeft, set.wingRight, set.tail, set.legs, set.beak]) {
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
    this.updateInstances(
      instances,
      neutralCreatures,
      params.boidMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getParrotColourStrategy(flags, false),
      sceneRenderer.getBoidMotionConfig(species, flags, boidMotionFlags),
    );
    for (const profile of profileNames) {
      const profileSet = this.profiledSpeciesInstances.get(profile);
      if (!profileSet) continue;
      this.updateInstances(
        profileSet,
        profileCreatures.get(profile) ?? [],
        params.boidMaxSpeed,
        elapsed,
        dt,
        sceneRenderer.getParrotColourStrategy(flags, true),
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
    this.updateInstances(
      instances,
      creatures,
      params.boidMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getBoidColourStrategy(species, flags),
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
    this.updateInstances(
      instances,
      predators,
      params.predatorMaxSpeed,
      elapsed,
      dt,
      sceneRenderer.getPredatorColourStrategy(species, renderFlags),
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
    return exposureByTime[timeOfDay];
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
  }

  private updateTransientSceneEffects(
    sim: Simulation,
    elapsed: number,
    dt: number,
    sceneRenderer: SceneRendererHooks,
  ): void {
    this.spawnBloodFromCatches(sim, sceneRenderer);
    this.sceneAssets.bloodEffects.update(dt);
    sceneRenderer.updateSpecialCreatureEffects(sim, elapsed, this.dragonDisplayQuats);
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
    this.controls.update();
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

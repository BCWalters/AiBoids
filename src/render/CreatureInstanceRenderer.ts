import * as THREE from 'three';
import { params } from '../sim/params';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
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
  type ColorStrategy,
  type CreatureColorMode,
  type MotionConfig,
  PredatorSpecies,
  type SpeciesColorSet,
  UNICORN_PREDATOR_SPECIES,
} from './sceneRenderers/createSceneRendererHooks';
import { CreatureColorApplicator } from './color/creatureColorApplication';

/** One creature's instanced meshes: a body plus optional wing/tail/legs/beak parts. */
export interface BoidRenderBatch {
  body: THREE.InstancedMesh;
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
  tail?: THREE.InstancedMesh;
  legs?: THREE.InstancedMesh;
  /** Small-bird-only: see CreatureGeometries.beak's doc comment. */
  beak?: THREE.InstancedMesh;
}

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

// Tail-sway phase offset: creatures with a swaying tail (dragons, sharks —
// see usesTailSwayMatrix) drive the tail from the wing flap phase, offset so
// it lags/leads rather than mirroring it. Amplitude/axis are per-scene
// (MotionConfig); only this shared phase relationship lives here.
const TAIL_SWAY_PHASE_OFFSET = Math.PI * 0.6; // lags the wingbeat rather than mirroring it exactly

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
  restOnFloor: boolean;
  containWithinTankWalls: boolean;
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
  restOnFloor: boolean;
  containWithinTankWalls: boolean;
}

interface ResolvedColorStrategy {
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  getIntensity: (creature: Boid | Predator) => number;
  individualVariation: boolean;
  getSpeciesColors: ((creature: Boid | Predator) => SpeciesColorSet | null) | undefined;
  preserveBakedPartPalette: boolean;
  bakedBodyGradient: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
  colorMode: CreatureColorMode;
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
  preserveBakedPartPalette: boolean;
  lockSpeciesPalette: boolean;
  beakColor: THREE.Color | undefined;
  hasBakedBodyVertexColors: boolean;
  hasBakedWingVertexColors: boolean;
  hasBakedTailVertexColors: boolean;
  colorMode: CreatureColorMode;
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
  restOnFloor: boolean;
  containWithinTankWalls: boolean;
}
type UpdateCreatureSharedArgs = Omit<UpdateCreatureInstanceArgs, 'index' | 'creature'>;

/**
 * Writes per-instance transforms and colors for a creature render batch each
 * frame. Owns the shared animation engine — orientation/upright basis, wing
 * flap, tail sway, banking, and per-part color application — plus the scratch
 * objects and per-creature animation state (flap phase, smoothed display
 * orientations) it needs. Renderer3D builds and reconciles the render batches
 * and decides which creatures go into each; this class only knows how to pose
 * and color one batch given a scene-supplied ColorStrategy + MotionConfig.
 */
export class CreatureInstanceRenderer {
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
  private tmpForward = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpPersistedRight = new THREE.Vector3();
  private tmpPrevDir = new THREE.Vector3();
  private tmpBasisMatrix = new THREE.Matrix4();
  // Scratch objects for the pitch clamp / up-tilt safety clamp used by the
  // clamped-upright styles (unicorn/shark) — kept separate from the dragon-path
  // tmp vectors above since that orientation math is its own thing.
  private tmpClampHorizontal = new THREE.Vector3();
  private tmpClampUpWorld = new THREE.Vector3();
  private tmpClampTiltAxis = new THREE.Vector3();
  private tiltCorrection = new THREE.Quaternion();
  private colorApplicator = new CreatureColorApplicator();

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

  /**
   * Cached combined model-space bounding box per render batch (see
   * getBatchModelBox), used by the restOnFloor clamp. Keyed weakly so stale
   * batches don't leak.
   */
  private batchModelBox = new WeakMap<BoidRenderBatch, THREE.Box3>();
  /** Scratch corner vector for rotating a batch's bounding box (restOnFloor). */
  private tmpCorner = new THREE.Vector3();
  /** Reused result box for the current-orientation rotated model AABB (tank clamps). */
  private rotatedBounds = new THREE.Box3();

  private fishtankCenter: THREE.Vector3;

  /**
   * @param fishtankCenter Shared, per-frame-updated fishtank world center. Held
   * by reference (the fishtank scene mutates it in place) so boid positions can
   * "grow" symmetrically around the tank center rather than the coordinate
   * origin when a scene applies a worldScale.
   */
  constructor(fishtankCenter: THREE.Vector3) {
    this.fishtankCenter = fishtankCenter;
  }

  /**
   * The smoothed display orientations computed for 'dragon'-upright creatures
   * during instance update. Exposed so scene special-effect emitters (nature
   * dragon fire breath) can pose against the same orientation the mesh shows.
   */
  getDragonDisplayQuats(): Map<number, THREE.Quaternion> {
    return this.dragonDisplayQuats;
  }

  /** Clears the smoothed-orientation cache for a predator species when its render batch is rebuilt. */
  resetPredatorOrientationCaches(species: PredatorSpecies): void {
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
    this.tmpClampHorizontal.set(this.tmpForward.x, 0, this.tmpForward.z);
    const horizontalLen = this.tmpClampHorizontal.length();
    if (horizontalLen <= 1e-6) return;
    this.tmpClampHorizontal.divideScalar(horizontalLen);
    const rawPitch = Math.atan2(this.tmpForward.y, horizontalLen);
    const clampedPitch = THREE.MathUtils.clamp(rawPitch, -pitchLimits.descend, pitchLimits.ascend);
    this.tmpForward.copy(this.tmpClampHorizontal).multiplyScalar(Math.cos(clampedPitch));
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
    this.tmpClampUpWorld.copy(MODEL_UP_AXIS).applyQuaternion(displayQuat);
    const upTilt = this.tmpClampUpWorld.angleTo(WORLD_UP_AXIS);
    if (upTilt <= maxUpTiltRadians) return;
    this.tmpClampTiltAxis.crossVectors(this.tmpClampUpWorld, WORLD_UP_AXIS);
    if (this.tmpClampTiltAxis.lengthSq() <= 1e-10) return;
    this.tmpClampTiltAxis.normalize();
    this.tiltCorrection.setFromAxisAngle(this.tmpClampTiltAxis, upTilt - maxUpTiltRadians);
    displayQuat.premultiply(this.tiltCorrection);
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
      restOnFloor,
      containWithinTankWalls,
    } = args;
    this.applyCreatureBodyMatrices(set, index, position, entityScale, worldScale, meshScaleBoost, uprightStyle, restOnFloor, containWithinTankWalls);

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
    restOnFloor: boolean,
    containWithinTankWalls: boolean,
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
    const bodyScale = entityScale * worldScale * meshScaleBoost;
    // Both tank clamps keep the creature's *orientation-rotated* geometry (not
    // its static model bounds) inside the tank: the simulation positions each
    // creature by its model origin, but the geometry extends well beyond that
    // origin (the seahorse's body/tail below it; the shark's nose/tail fore and
    // aft of it), and the extent that faces a given wall depends on the current
    // heading. Rotating the cached model bounding box by bodyQuat captures that.
    // The clamps only engage right at a wall, leaving normal motion untouched.
    if (restOnFloor || containWithinTankWalls) {
      const rb = this.computeRotatedModelBounds(set, this.bodyQuat);
      if (restOnFloor) {
        // Lift so the lowest rotated vertex stays on/above the floor (render
        // y=0) — fixes the upright seahorse sinking its body/tail through the
        // tank floor at low swim heights (see #154).
        const bottomWorldY = this.dummy.position.y + rb.min.y * bodyScale;
        if (bottomWorldY < 0) {
          this.dummy.position.y -= bottomWorldY;
        }
      }
      if (containWithinTankWalls && worldScale !== 1) {
        // Keep the rotated box within the tank's side glass on X and Z — fixes
        // the shark's long nose/tail poking through the side walls near the
        // glass (see #167). The swim region's world image equals the glass
        // interior, so each inner wall sits at center ± center*worldScale.
        this.dummy.position.x = this.clampAxisWithinWall(
          this.dummy.position.x,
          rb.min.x * bodyScale,
          rb.max.x * bodyScale,
          this.fishtankCenter.x,
          worldScale,
        );
        this.dummy.position.z = this.clampAxisWithinWall(
          this.dummy.position.z,
          rb.min.z * bodyScale,
          rb.max.z * bodyScale,
          this.fishtankCenter.z,
          worldScale,
        );
      }
    }
    this.dummy.quaternion.copy(this.bodyQuat);
    this.dummy.scale.setScalar(bodyScale);
    this.dummy.updateMatrix();
    set.body.setMatrixAt(i, this.dummy.matrix);
    if (set.legs) set.legs.setMatrixAt(i, this.dummy.matrix);
    if (set.beak) set.beak.setMatrixAt(i, this.dummy.matrix);
    if (set.tail && !usesTailSwayMatrix(uprightStyle)) set.tail.setMatrixAt(i, this.dummy.matrix);
  }

  /**
   * Shifts a single world-axis position so the creature's rotated box
   * `[pos + boxMin, pos + boxMax]` stays within the tank's inner glass on that
   * axis. The swim region's world image equals the glass interior, and the
   * shared fishtankCenter sits at the tank's mid-point on X/Z, so the inner
   * walls are at `center ± center*worldScale`. Only nudges when the box would
   * otherwise cross a wall; if a (hypothetical) creature were wider than the
   * tank the far wall wins, which is still inside the glass.
   */
  private clampAxisWithinWall(
    pos: number,
    boxMin: number,
    boxMax: number,
    center: number,
    worldScale: number,
  ): number {
    const halfExtent = center * worldScale;
    const wallMin = center - halfExtent;
    const wallMax = center + halfExtent;
    let p = pos;
    if (p + boxMin < wallMin) p = wallMin - boxMin;
    if (p + boxMax > wallMax) p = wallMax - boxMax;
    return p;
  }

  /**
   * Fills and returns `this.rotatedBounds` with the model-space AABB of a
   * render batch's rigid parts (body + tail + pectoral fins) after rotating by
   * the given orientation. Used by the tank floor/wall clamps so they account
   * for the creature's current pitch/bank/heading — e.g. the seahorse's curled
   * tail swinging below the un-rotated minimum, or the shark's nose/tail
   * projecting onto whichever wall it faces. The combined model box is cached
   * per batch (computed lazily from geometry so it tracks any future geometry
   * change without a hardcoded constant); only its 8 corners are rotated each
   * call, which is cheap. Values are in model units — multiply by the body
   * scale to get world-space offsets.
   */
  private computeRotatedModelBounds(set: BoidRenderBatch, quat: THREE.Quaternion): THREE.Box3 {
    const box = this.getBatchModelBox(set);
    this.rotatedBounds.makeEmpty();
    if (box.isEmpty()) return this.rotatedBounds;
    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          this.tmpCorner.set(
            cx === 0 ? box.min.x : box.max.x,
            cy === 0 ? box.min.y : box.max.y,
            cz === 0 ? box.min.z : box.max.z,
          ).applyQuaternion(quat);
          this.rotatedBounds.expandByPoint(this.tmpCorner);
        }
      }
    }
    return this.rotatedBounds;
  }

  /**
   * Combined model-space bounding box across a render batch's rigid parts
   * (body + tail + pectoral fins), cached per batch. See computeRotatedModelBounds.
   */
  private getBatchModelBox(set: BoidRenderBatch): THREE.Box3 {
    const cached = this.batchModelBox.get(set);
    if (cached !== undefined) return cached;
    const box = new THREE.Box3();
    box.makeEmpty();
    for (const mesh of [set.body, set.tail, set.wingLeft, set.wingRight]) {
      if (!mesh) continue;
      const geom = mesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      if (geom.boundingBox) box.union(geom.boundingBox);
    }
    this.batchModelBox.set(set, box);
    return box;
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
      restOnFloor = false,
      containWithinTankWalls = false,
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
      restOnFloor,
      containWithinTankWalls,
    };
  }

  private resolveColorStrategy(colors: ColorStrategy): ResolvedColorStrategy {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation = false,
      getSpeciesColors,
      preserveBakedPartPalette = false,
      bakedBodyGradient = false,
      lockSpeciesPalette = false,
      beakColor,
      colorMode,
    } = colors;

    return {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      preserveBakedPartPalette,
      bakedBodyGradient,
      lockSpeciesPalette,
      beakColor,
      colorMode,
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
      preserveBakedPartPalette,
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
      restOnFloor,
      containWithinTankWalls,
      colorMode,
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
      restOnFloor,
      containWithinTankWalls,
    });

    this.colorApplicator.apply({
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      preserveBakedPartPalette,
      lockSpeciesPalette,
      beakColor,
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
      colorMode,
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

  updateInstances(
    set: BoidRenderBatch,
    creatures: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
    dt: number,
    colors: ColorStrategy,
    motion: MotionConfig,
  ): void {
    const {
      baseColor,
      highlightColor,
      getIntensity,
      individualVariation,
      getSpeciesColors,
      preserveBakedPartPalette,
      bakedBodyGradient,
      lockSpeciesPalette,
      beakColor,
      colorMode,
    } = this.resolveColorStrategy(colors);
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
      restOnFloor,
      containWithinTankWalls,
    } = this.resolveMotionConfig(motion);

    // Small songbirds (nature) bake a gradient into their geometry. When
    // bakedBodyGradient is true, pass white as the instance color so the vertex
    // colors show through unchanged. We can't infer this from a 'color'
    // attribute alone, since dragon/hawk geometry also carries vertex colors.
    const {
      hasBakedBodyVertexColors,
      hasBakedWingVertexColors,
      hasBakedTailVertexColors,
    } = this.colorApplicator.getBakedColorAttributeFlags(set, bakedBodyGradient);
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
      preserveBakedPartPalette,
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
      restOnFloor,
      containWithinTankWalls,
      colorMode,
    });

    this.markRenderBatchNeedsUpdate(set);
  }
}

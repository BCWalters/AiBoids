/**
 * Pure creature-motion math.
 *
 * Everything here is a plain function of its arguments — no THREE objects, no
 * `this`, no per-frame scratch state. `CreatureInstanceRenderer` owns the
 * stateful parts (accumulated phase per creature, scratch quaternions, matrix
 * composition) and calls into this module for the actual numbers.
 *
 * Keeping the math here means:
 *  - it is unit-testable without constructing a renderer or a WebGL context
 *  - motion can be tuned without touching the 1000+ line renderer, so parallel
 *    work on different creatures doesn't collide in the same file
 *
 * Per-scene values (flap frequency, amplitudes, tail sway axis/amplitude) are
 * NOT defined here — they're supplied by each scene's MotionConfig. Only the
 * one shared animation *algorithm* and its response constants live here.
 */

/**
 * How strongly flight-state weights are allowed to push frequency/amplitude
 * before clamping. Shared by every scene — the per-scene knobs are the base
 * frequency/amplitudes in MotionConfig.
 */
const STATE_RESPONSE = 0.55;

const CLIMB_FLAP_FREQ_BOOST = 0.12;
const DIVE_FLAP_FREQ_CUT = 0.1;
const TURN_FLAP_FREQ_BOOST = 0.06;
const PANIC_FLAP_FREQ_BOOST = 0.1;
const CRUISE_FLAP_FREQ_CUT = 0.04;

const CLIMB_FLAP_AMP_BOOST = 0.12;
const DIVE_FLAP_AMP_BOOST = 0.08;
const TURN_FLAP_AMP_BOOST = 0.1;
const PANIC_FLAP_AMP_BOOST = 0.12;
const CRUISE_FLAP_AMP_CUT = 0.06;

/** Flight-state blending must never stall or over-drive the wingbeat. */
const STATE_FREQUENCY_MULTIPLIER_MIN = 0.8;
const STATE_FREQUENCY_MULTIPLIER_MAX = 1.18;
const STATE_AMPLITUDE_MULTIPLIER_MIN = 0.82;
const STATE_AMPLITUDE_MULTIPLIER_MAX = 1.24;

/**
 * Per-creature starting phase offset, so a flock doesn't beat in unison.
 * Multiplied by the creature id — a stride that spreads sequential ids around
 * the cycle instead of banding them.
 */
const PHASE_ID_STRIDE = 1.7;

/**
 * Tail-sway phase offset: creatures with a swaying tail (dragons, sharks — see
 * usesTailSwayMatrix) drive the tail from the wing flap clock, offset so it
 * lags the wingbeat rather than mirroring it exactly. Amplitude/axis are
 * per-scene (MotionConfig); only this shared phase relationship lives here.
 */
export const TAIL_SWAY_PHASE_OFFSET = Math.PI * 0.6;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Blended flight-state weights for one creature this frame. `blendStrength`
 * scales the whole effect (0 disables state response entirely); the individual
 * weights are the normalized contribution of each flight state.
 */
export interface FlapStateWeights {
  blendStrength: number;
  climbWeight: number;
  diveWeight: number;
  turnWeight: number;
  panicWeight: number;
  cruiseWeight: number;
}

export interface FlapStateMultipliers {
  frequencyMultiplier: number;
  amplitudeMultiplier: number;
}

/**
 * Converts blended flight-state weights into clamped frequency/amplitude
 * multipliers. Climbing and panicking beat faster and wider; diving beats
 * slower but still wide (the wings spread); steady cruising eases off both.
 */
export function computeFlapStateMultipliers({
  blendStrength,
  climbWeight,
  diveWeight,
  turnWeight,
  panicWeight,
  cruiseWeight,
}: FlapStateWeights): FlapStateMultipliers {
  const scale = blendStrength * STATE_RESPONSE;
  const frequencyRaw =
    1
    + scale * (
      climbWeight * CLIMB_FLAP_FREQ_BOOST
      - diveWeight * DIVE_FLAP_FREQ_CUT
      + turnWeight * TURN_FLAP_FREQ_BOOST
      + panicWeight * PANIC_FLAP_FREQ_BOOST
      - cruiseWeight * CRUISE_FLAP_FREQ_CUT
    );
  const amplitudeRaw =
    1
    + scale * (
      climbWeight * CLIMB_FLAP_AMP_BOOST
      + diveWeight * DIVE_FLAP_AMP_BOOST
      + turnWeight * TURN_FLAP_AMP_BOOST
      + panicWeight * PANIC_FLAP_AMP_BOOST
      - cruiseWeight * CRUISE_FLAP_AMP_CUT
    );
  return {
    frequencyMultiplier: clamp(frequencyRaw, STATE_FREQUENCY_MULTIPLIER_MIN, STATE_FREQUENCY_MULTIPLIER_MAX),
    amplitudeMultiplier: clamp(amplitudeRaw, STATE_AMPLITUDE_MULTIPLIER_MIN, STATE_AMPLITUDE_MULTIPLIER_MAX),
  };
}

/** Normalized speed in [0, 1]. Guards maxSpeed <= 0 (returns 0). */
export function computeSpeedFraction({ speed, maxSpeed }: { speed: number; maxSpeed: number }): number {
  if (maxSpeed <= 0) return 0;
  return Math.min(1, speed / maxSpeed);
}

/**
 * Signed climb rate in [-1, 1], used to drive the upright-style flap frequency
 * multiplier (a galloping unicorn beats harder climbing than descending).
 */
export function computeClimbFraction({
  verticalVelocity,
  maxSpeed,
}: {
  verticalVelocity: number;
  maxSpeed: number;
}): number {
  if (maxSpeed <= 0) return 0;
  return clamp(verticalVelocity / maxSpeed, -1, 1);
}

/** Wing-stroke half-angle before the rest bias is applied. */
export function computeFlapAmplitude({
  idleAmplitude,
  speedAmplitude,
  speedFraction,
  stateAmplitudeMultiplier,
}: {
  idleAmplitude: number;
  speedAmplitude: number;
  speedFraction: number;
  stateAmplitudeMultiplier: number;
}): number {
  return (idleAmplitude + speedAmplitude * speedFraction) * stateAmplitudeMultiplier;
}

/** Starting phase for a creature that hasn't been posed yet. */
export function initialFlapPhase(creatureId: number): number {
  return creatureId * PHASE_ID_STRIDE;
}

/** Integrates the flap clock forward one frame. */
export function advanceFlapPhase({
  previousPhase,
  frequency,
  dt,
}: {
  previousPhase: number;
  frequency: number;
  dt: number;
}): number {
  return previousPhase + frequency * dt;
}

/**
 * Fraction of the wingbeat spent on the downstroke. 0.5 is a pure sine — equal
 * time down and up. Real birds spend less time on the power stroke than on the
 * recovery, so values below 0.5 give the characteristic snap-down/glide-up
 * beat. Clamped: at the extremes one half of the stroke gets so short it reads
 * as a teleport.
 */
export const SYMMETRIC_DOWNSTROKE_FRACTION = 0.5;
const DOWNSTROKE_FRACTION_MIN = 0.15;
const DOWNSTROKE_FRACTION_MAX = 0.85;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/**
 * Warps a linear flap clock so the downstroke takes `downstrokeFraction` of the
 * cycle instead of half of it.
 *
 * The cycle is split at the two stroke *extremes* (top and bottom of the beat)
 * rather than at the mid-stroke zero crossings. That placement matters: the
 * warp is piecewise-linear, so its rate changes abruptly at the seam, but at an
 * extreme the wing's angular velocity is already zero on both sides (cos is 0
 * there). The speed-up therefore eases in from a standstill and no kink is
 * visible. Splitting at the zero crossings instead would change speed at the
 * exact moment the wing is sweeping fastest, which reads as a stutter.
 *
 * Phase is offset by a quarter cycle so that u = 0 is the top of the stroke;
 * this makes downstrokeFraction = 0.5 reproduce sin(phase) exactly.
 */
function warpStrokePhase(phase: number, downstrokeFraction: number): number {
  const down = clamp(downstrokeFraction, DOWNSTROKE_FRACTION_MIN, DOWNSTROKE_FRACTION_MAX);
  let u = (phase / TWO_PI + 0.25) % 1;
  if (u < 0) u += 1;
  // First segment sweeps top -> bottom (the downstroke), second bottom -> top.
  return u < down
    ? -HALF_PI + Math.PI * (u / down)
    : HALF_PI + Math.PI * ((u - down) / (1 - down));
}

/**
 * Wing rotation angle (radians) about the model's forward axis. Positive is a
 * downstroke: the left wing's tip sits on +X and rotating about the forward
 * axis by a positive angle carries it toward -Z, which is model-down.
 */
export function flapAngleFromPhase({
  phase,
  amplitude,
  restBiasRad,
  downstrokeFraction = SYMMETRIC_DOWNSTROKE_FRACTION,
}: {
  phase: number;
  amplitude: number;
  restBiasRad: number;
  downstrokeFraction?: number;
}): number {
  return amplitude * Math.sin(warpStrokePhase(phase, downstrokeFraction)) + restBiasRad;
}

/**
 * Tail phase, driven off the same clock as the wingbeat but lagged so the tail
 * trails the stroke instead of mirroring it. Unlike the wing phase this is
 * evaluated from absolute elapsed time rather than integrated, so it is
 * stateless.
 */
export function computeTailSwayPhase({
  elapsed,
  frequency,
  creatureId,
}: {
  elapsed: number;
  frequency: number;
  creatureId: number;
}): number {
  return elapsed * frequency + creatureId * PHASE_ID_STRIDE + TAIL_SWAY_PHASE_OFFSET;
}

/** Tail rotation angle (radians) about the scene-supplied tail sway axis. */
export function tailSwayAngleFromPhase({ phase, amplitude }: { phase: number; amplitude: number }): number {
  return amplitude * Math.sin(phase);
}

/**
 * Legs trail the wingbeat slightly — they're driven by the body's motion
 * rather than driving it, so they lag rather than moving in lockstep.
 */
export const LEG_SWING_PHASE_OFFSET = Math.PI * 0.35;

/**
 * Fore/aft leg swing angle (radians) about the hip. Positive swings the feet
 * forward: legs hang along model -Z, and rotating about the model right axis
 * by a positive angle carries them toward +Y, which is model-forward.
 *
 * Two things combine here:
 *  - an oscillation off the flap clock, so the legs aren't dead weight
 *  - a speed-proportional backward tuck, because a creature at cruise pulls
 *    its legs back against the body rather than leaving them dangling
 */
export function legSwingAngleFromPhase({
  phase,
  amplitude,
  tuckRad,
  speedFraction,
}: {
  phase: number;
  amplitude: number;
  tuckRad: number;
  speedFraction: number;
}): number {
  return amplitude * Math.sin(phase + LEG_SWING_PHASE_OFFSET) - tuckRad * clamp(speedFraction, 0, 1);
}

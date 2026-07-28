function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function computeFishUndulationSpineProgress({
  axisPosition,
  headPosition,
  tailPosition,
}: {
  axisPosition: number;
  headPosition: number;
  tailPosition: number;
}): number {
  const span = headPosition - tailPosition;
  if (span <= 1e-6) return 0;
  return clamp01((headPosition - axisPosition) / span);
}

export function computeFishUndulationEnvelope(progress: number): number {
  const p = clamp01(progress);
  return p * p * (3 - 2 * p);
}

export function computeFishUndulationEnvelopeDerivative(progress: number): number {
  const p = clamp01(progress);
  return 6 * p * (1 - p);
}

export function sampleFishUndulationEnvelope({
  axisPosition,
  headPosition,
  tailPosition,
}: {
  axisPosition: number;
  headPosition: number;
  tailPosition: number;
}): { envelope: number; envelopeSlope: number } {
  const span = headPosition - tailPosition;
  if (span <= 1e-6) return { envelope: 0, envelopeSlope: 0 };
  const progress = computeFishUndulationSpineProgress({ axisPosition, headPosition, tailPosition });
  const envelope = computeFishUndulationEnvelope(progress);
  const progressSlope = (progress <= 0 || progress >= 1) ? 0 : -1 / span;
  const envelopeSlope = computeFishUndulationEnvelopeDerivative(progress) * progressSlope;
  return { envelope, envelopeSlope };
}

export function computeFishUndulationOffset({
  axisPosition,
  headPosition,
  tailPosition,
  amplitude,
  waveNumber,
  phase,
}: {
  axisPosition: number;
  headPosition: number;
  tailPosition: number;
  amplitude: number;
  waveNumber: number;
  phase: number;
}): number {
  const { envelope } = sampleFishUndulationEnvelope({ axisPosition, headPosition, tailPosition });
  return amplitude * envelope * Math.sin(waveNumber * axisPosition - phase);
}

export function computeFishUndulationOffsetSlope({
  axisPosition,
  headPosition,
  tailPosition,
  amplitude,
  waveNumber,
  phase,
}: {
  axisPosition: number;
  headPosition: number;
  tailPosition: number;
  amplitude: number;
  waveNumber: number;
  phase: number;
}): number {
  const { envelope, envelopeSlope } = sampleFishUndulationEnvelope({
    axisPosition,
    headPosition,
    tailPosition,
  });
  const wavePhase = waveNumber * axisPosition - phase;
  return amplitude * (envelopeSlope * Math.sin(wavePhase) + envelope * Math.cos(wavePhase) * waveNumber);
}

/**
 * Both the lateral displacement and its slope at one point on the spine, in a
 * single envelope evaluation.
 *
 * The body is bent in the vertex shader, but the pectoral fins are separate
 * instanced meshes posed by CPU matrices, so the renderer has to reproduce the
 * shader's displacement exactly to keep a fin welded to the flank it grows
 * from. This is the CPU mirror of `fishUndulationSample` in
 * fishUndulationShader.ts — the two must stay in step.
 *
 * `lateralSlope` is d(offset)/d(axisPosition): the tangent of the angle the
 * spine makes with the model's forward axis at this station.
 */
export function sampleFishUndulationDisplacement({
  axisPosition,
  headPosition,
  tailPosition,
  amplitude,
  waveNumber,
  phase,
}: {
  axisPosition: number;
  headPosition: number;
  tailPosition: number;
  amplitude: number;
  waveNumber: number;
  phase: number;
}): { lateralOffset: number; lateralSlope: number } {
  const { envelope, envelopeSlope } = sampleFishUndulationEnvelope({
    axisPosition,
    headPosition,
    tailPosition,
  });
  const wavePhase = waveNumber * axisPosition - phase;
  const sin = Math.sin(wavePhase);
  const cos = Math.cos(wavePhase);
  return {
    lateralOffset: amplitude * envelope * sin,
    lateralSlope: amplitude * (envelopeSlope * sin + envelope * cos * waveNumber),
  };
}

export function computeFishUndulationOmega({
  baseOmega,
  speedFraction,
  speedScale,
}: {
  baseOmega: number;
  speedFraction: number;
  speedScale: number;
}): number {
  return baseOmega * (1 + clamp01(speedFraction) * speedScale);
}

export function advanceFishUndulationPhase({
  previousPhase,
  omega,
  dt,
}: {
  previousPhase: number;
  omega: number;
  dt: number;
}): number {
  return previousPhase + omega * dt;
}

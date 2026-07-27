import * as THREE from 'three';
import type { FishUndulationConfig } from '../../sceneRenderers/createSceneRendererHooks';

export interface FishUndulationInstanceState {
  phaseAttribute: THREE.InstancedBufferAttribute;
  baseOmega: number;
  speedOmegaScale: number;
  headPosition: number;
  tailPosition: number;
  amplitude: number;
  waveNumber: number;
}

interface FishUndulationUniforms {
  headPosition: number;
  tailPosition: number;
  amplitude: number;
  waveNumber: number;
}

function vertexUniformAndHelpers(): string {
  return `
attribute float fishUndulationPhase;
uniform float uFishHeadPosition;
uniform float uFishTailPosition;
uniform float uFishAmplitude;
uniform float uFishWaveNumber;

float fishUndulationProgress( float axisPosition ) {
  float span = uFishHeadPosition - uFishTailPosition;
  if ( span <= 1e-6 ) return 0.0;
  return clamp( ( uFishHeadPosition - axisPosition ) / span, 0.0, 1.0 );
}

float fishUndulationEnvelope( float progress ) {
  float p = clamp( progress, 0.0, 1.0 );
  return p * p * ( 3.0 - 2.0 * p );
}

float fishUndulationEnvelopePrime( float progress ) {
  float p = clamp( progress, 0.0, 1.0 );
  return 6.0 * p * ( 1.0 - p );
}

void fishUndulationSample(
  float axisPosition,
  float phase,
  out float lateralOffset,
  out float lateralSlope
) {
  float span = uFishHeadPosition - uFishTailPosition;
  if ( span <= 1e-6 ) {
    lateralOffset = 0.0;
    lateralSlope = 0.0;
    return;
  }
  float progress = fishUndulationProgress( axisPosition );
  float envelope = fishUndulationEnvelope( progress );
  float progressSlope = ( progress <= 0.0 || progress >= 1.0 ) ? 0.0 : -1.0 / span;
  float envelopeSlope = fishUndulationEnvelopePrime( progress ) * progressSlope;
  float wavePhase = uFishWaveNumber * axisPosition - phase;
  lateralOffset = uFishAmplitude * envelope * sin( wavePhase );
  lateralSlope = uFishAmplitude * (
    envelopeSlope * sin( wavePhase ) + envelope * cos( wavePhase ) * uFishWaveNumber
  );
}
`;
}

function applyUndulationPatchToVertexShader(vertexShader: string, withNormals: boolean): string {
  let shader = vertexShader;
  if (withNormals) {
    shader = shader.replace(
      '#include <beginnormal_vertex>',
      `
      vec3 objectNormal = vec3( normal );
      float _fishUndulationOffset = 0.0;
      float _fishUndulationSlope = 0.0;
      fishUndulationSample( position.y, fishUndulationPhase, _fishUndulationOffset, _fishUndulationSlope );
      objectNormal = normalize( vec3(
        objectNormal.x,
        objectNormal.y - _fishUndulationSlope * objectNormal.x,
        objectNormal.z
      ) );
      `,
    );
  } else {
    shader = shader.replace(
      '#include <begin_vertex>',
      `
      vec3 transformed = vec3( position );
      float _fishUndulationOffset = 0.0;
      float _fishUndulationSlope = 0.0;
      fishUndulationSample( position.y, fishUndulationPhase, _fishUndulationOffset, _fishUndulationSlope );
      transformed.x += _fishUndulationOffset;
      `,
    );
    return shader;
  }

  shader = shader.replace(
    '#include <begin_vertex>',
    `
    vec3 transformed = vec3( position );
    transformed.x += _fishUndulationOffset;
    `,
  );
  return shader;
}

function applyDepthLikeMaterialPatch(
  material: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial,
  uniforms: FishUndulationUniforms,
): void {
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    Object.assign(shader.uniforms, {
      uFishHeadPosition: { value: uniforms.headPosition },
      uFishTailPosition: { value: uniforms.tailPosition },
      uFishAmplitude: { value: uniforms.amplitude },
      uFishWaveNumber: { value: uniforms.waveNumber },
    });
    shader.vertexShader = vertexUniformAndHelpers() + shader.vertexShader;
    shader.vertexShader = applyUndulationPatchToVertexShader(shader.vertexShader, false);
  };
}

function cloneGeometryWithUndulationPhase({
  mesh,
  phaseAttribute,
}: {
  mesh: THREE.InstancedMesh;
  phaseAttribute: THREE.InstancedBufferAttribute;
}): THREE.BufferGeometry {
  const geometry = mesh.geometry.clone();
  mesh.geometry = geometry;
  geometry.setAttribute('fishUndulationPhase', phaseAttribute);
  return geometry;
}

function applyUndulationPatchToMesh({
  mesh,
  uniforms,
}: {
  mesh: THREE.InstancedMesh;
  uniforms: FishUndulationUniforms;
}): void {
  const undulationKey = `aiboids-fish-undulation-v2:${uniforms.headPosition.toFixed(5)}:${uniforms.tailPosition.toFixed(5)}`;
  const material = mesh.material as THREE.MeshStandardMaterial;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => {
    const baseKey = previousCacheKey?.() ?? '';
    return baseKey.length ? `${baseKey}|${undulationKey}` : undulationKey;
  };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    Object.assign(shader.uniforms, {
      uFishHeadPosition: { value: uniforms.headPosition },
      uFishTailPosition: { value: uniforms.tailPosition },
      uFishAmplitude: { value: uniforms.amplitude },
      uFishWaveNumber: { value: uniforms.waveNumber },
    });
    shader.vertexShader = vertexUniformAndHelpers() + shader.vertexShader;
    shader.vertexShader = applyUndulationPatchToVertexShader(shader.vertexShader, true);
  };
  material.needsUpdate = true;

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  applyDepthLikeMaterialPatch(depthMaterial, uniforms);
  mesh.customDepthMaterial = depthMaterial;

  const distanceMaterial = new THREE.MeshDistanceMaterial();
  applyDepthLikeMaterialPatch(distanceMaterial, uniforms);
  mesh.customDistanceMaterial = distanceMaterial;
}

export function applyFishUndulationShader({
  mesh,
  tailMesh,
  config,
}: {
  mesh: THREE.InstancedMesh;
  tailMesh?: THREE.InstancedMesh;
  config: FishUndulationConfig;
}): FishUndulationInstanceState {
  const instanceCapacity = mesh.instanceMatrix.count;
  const phaseAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instanceCapacity), 1);
  phaseAttribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = cloneGeometryWithUndulationPhase({ mesh, phaseAttribute });
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (tailMesh) cloneGeometryWithUndulationPhase({ mesh: tailMesh, phaseAttribute });
  const headPosition = geometry.boundingBox?.max.y ?? 0;
  const tailPosition = geometry.boundingBox?.min.y ?? 0;
  const span = Math.max(0, headPosition - tailPosition);
  const uniforms: FishUndulationUniforms = {
    headPosition,
    tailPosition,
    amplitude: span * config.amplitudeFraction,
    waveNumber: span > 1e-6 ? (2 * Math.PI * config.wavesPerBody) / span : 0,
  };
  applyUndulationPatchToMesh({ mesh, uniforms });
  if (tailMesh) applyUndulationPatchToMesh({ mesh: tailMesh, uniforms });

  return {
    phaseAttribute,
    baseOmega: config.baseOmega,
    speedOmegaScale: config.speedOmegaScale,
    headPosition: uniforms.headPosition,
    tailPosition: uniforms.tailPosition,
    amplitude: uniforms.amplitude,
    waveNumber: uniforms.waveNumber,
  };
}

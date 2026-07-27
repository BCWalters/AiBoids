import * as THREE from 'three';
import { params } from '../../../sim/params';

/**
 * Uniforms shared by all wave-enabled water materials. Written by
 * updateWaterUniforms() each frame and read by the patched shaders.
 */
export interface WaterUniforms {
  uTime: { value: number };
  /** 1.0 = waves active, 0.0 = flat surface (no vertex displacement). */
  uWavesEnabled: { value: number };
  /** 1.0 = specular/Fresnel active, 0.0 = no extra reflection contribution. */
  uReflectionsEnabled: { value: number };
  /** World-space unit vector pointing toward the sun. */
  uSunDirection: { value: THREE.Vector3 };
  /** Sun light colour used to tint specular highlights. */
  uSunColor: { value: THREE.Color };
}

/** Creates a WaterUniforms block initialised to "both effects off". */
export function createWaterUniforms(sunDirection: THREE.Vector3): WaterUniforms {
  return {
    uTime: { value: 0 },
    uWavesEnabled: { value: 0 },
    uReflectionsEnabled: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(0xfff5e0) },
  };
}

/**
 * Patches a MeshStandardMaterial via onBeforeCompile to add:
 *   • Animated vertex displacement (sum-of-4-sines waves), gated by uWavesEnabled.
 *   • Blinn-Phong specular + Fresnel sky-tint, gated by uReflectionsEnabled.
 *
 * Both effects are controlled by float uniforms (0.0 = off, 1.0 = on) so
 * they can be toggled at runtime without recompiling the shader.  When both
 * uniforms are 0 the output is **bit-identical** to the unpatched material.
 *
 * Wave amplitudes are expressed in the mesh's **local (object) space**.
 * The mesh is scaled by flockScale in world space, so a local amplitude of
 * 0.002 becomes 2 world units at flockScale = 1000.  Keep amplitudes small
 * enough that creatures read clearly above/at the water surface.
 */
export function applyWaterWaveShader(
  material: THREE.MeshStandardMaterial,
  uniforms: WaterUniforms,
): void {
  // Force a unique shader program so the patched ocean shader doesn't
  // get confused with any other MeshStandardMaterial in the scene.
  material.customProgramCacheKey = () => 'aiboids-water-waves-v1';

  material.onBeforeCompile = (shader) => {
    // ── Inject custom uniforms into the program ────────────────────────
    Object.assign(shader.uniforms, {
      uTime: uniforms.uTime,
      uWavesEnabled: uniforms.uWavesEnabled,
      uReflectionsEnabled: uniforms.uReflectionsEnabled,
      uSunDirection: uniforms.uSunDirection,
      uSunColor: uniforms.uSunColor,
    });

    // ── Vertex shader ──────────────────────────────────────────────────
    // Declare custom uniforms + varyings before the standard preamble.
    shader.vertexShader =
      `
uniform float uTime;
uniform float uWavesEnabled;
uniform float uReflectionsEnabled;
varying vec3 vWaterWorldNormal;
varying vec3 vWaterWorldPos;
` + shader.vertexShader;

    // Replace the standard normal initialisation chunk so the wave gradient
    // feeds into Three.js's own normal transform (giving correct diffuse
    // shading for the wavy surface) while also computing the raw local-space
    // normal for our custom vWaterWorldNormal varying.
    //
    // `_waveY` is declared here so it stays in scope for the begin_vertex
    // replacement below — GLSL inlines all chunks inside void main(), so
    // variables declared in one replaced chunk are visible in the next.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      vec3 objectNormal = vec3( normal );
      float _waveY = 0.0;

      if ( uWavesEnabled > 0.5 ) {
        float wx = position.x;
        float wz = position.z;
        float _dx = 0.0;
        float _dz = 0.0;

        // Wave 1 — dominant long swell
        {
          float k = 1.795; float A = 0.0038; float spd = 0.4;
          float p = ( 0.96 * wx + 0.28 * wz ) * k + uTime * spd;
          _waveY += A * sin( p );
          _dx    += A * cos( p ) * k * 0.96;
          _dz    += A * cos( p ) * k * 0.28;
        }
        // Wave 2 — cross swell
        {
          float k = 2.731; float A = 0.0023; float spd = 0.55;
          float p = ( 0.37 * wx + 0.93 * wz ) * k + uTime * spd;
          _waveY += A * sin( p );
          _dx    += A * cos( p ) * k * 0.37;
          _dz    += A * cos( p ) * k * 0.93;
        }
        // Wave 3 — choppy cross-run
        {
          float k = 4.488; float A = 0.0012; float spd = 0.85;
          float p = ( -0.71 * wx + 0.71 * wz ) * k + uTime * spd;
          _waveY += A * sin( p );
          _dx    += A * cos( p ) * k * ( -0.71 );
          _dz    += A * cos( p ) * k * 0.71;
        }
        // Wave 4 — fine surface ripple
        {
          float k = 7.854; float A = 0.0006; float spd = 1.3;
          float p = ( 0.2 * wx + ( -0.98 ) * wz ) * k + uTime * spd;
          _waveY += A * sin( p );
          _dx    += A * cos( p ) * k * 0.2;
          _dz    += A * cos( p ) * k * ( -0.98 );
        }

        // Surface normal from the analytic wave gradient
        objectNormal = normalize( vec3( -_dx, 1.0, -_dz ) );
      }
      `,
    );

    // Replace the standard position initialisation chunk to apply the Y
    // displacement computed above and pass world-space data to the fragment
    // shader for the specular/Fresnel calculation.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 transformed = vec3( position );
      transformed.y += _waveY;

      // World-space position and normal for fragment-shader water effects.
      // mat3(modelMatrix) gives correct world-space normals for uniformly
      // scaled objects (which the ocean mesh always is, via setScalar).
      vWaterWorldPos    = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      vWaterWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
      `,
    );

    // ── Fragment shader ────────────────────────────────────────────────
    // Declare the matching uniforms + varyings in the fragment shader.
    shader.fragmentShader =
      `
uniform float uReflectionsEnabled;
uniform vec3  uSunDirection;
uniform vec3  uSunColor;
varying vec3  vWaterWorldNormal;
varying vec3  vWaterWorldPos;
` + shader.fragmentShader;

    // Inject specular + Fresnel sky tint immediately before gl_FragColor is
    // set.  Modifying outgoingLight here means the contribution passes through
    // Three.js's own tone mapping, giving consistent exposure handling.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      if ( uReflectionsEnabled > 0.5 ) {
        vec3 V = normalize( cameraPosition - vWaterWorldPos );
        vec3 N = normalize( vWaterWorldNormal );
        // Blinn-Phong specular using the wave-perturbed world normal
        vec3 H = normalize( V + uSunDirection );
        float NdotH = max( dot( N, H ), 0.0 );
        float NdotV = max( dot( N, V ), 0.0 );
        float spec = pow( NdotH, 96.0 );
        // Fresnel: grazing angles pick up more sky tint
        float fresnel = pow( 1.0 - NdotV, 4.0 );
        // Sky-reflection approximation (calm blue-grey sky tone)
        vec3 skyTint = vec3( 0.48, 0.68, 0.88 ) * fresnel * 0.19;
        outgoingLight += uSunColor * spec * 0.45 + skyTint;
      }
      #include <opaque_fragment>
      `,
    );
  };
}

/**
 * Syncs water uniforms from the current params and live scene state.
 * Call once per frame from the environment's update() hook.
 */
export function updateWaterUniforms(
  uniforms: WaterUniforms,
  elapsed: number,
  sunDirection: THREE.Vector3,
  sunColor: THREE.Color,
): void {
  uniforms.uTime.value = elapsed;
  uniforms.uWavesEnabled.value = params.waterWavesEnabled ? 1.0 : 0.0;
  uniforms.uReflectionsEnabled.value = params.waterReflectionsEnabled ? 1.0 : 0.0;
  uniforms.uSunDirection.value.copy(sunDirection);
  uniforms.uSunColor.value.copy(sunColor);
}

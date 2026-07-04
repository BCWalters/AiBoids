import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * "Nature" style environment: a physically-based sky dome (with a
 * built-in procedural drifting-cloud layer baked into its shader) plus a
 * textured ground plane. Both are cheap — no external image assets — and
 * only added to the scene / made visible when visualStyle is 'nature'.
 */
export interface NatureEnvironment {
  sky: Sky;
  ground: THREE.Mesh;
  sunLight: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  /** Unit vector pointing from the world toward the sun. */
  sunDirection: THREE.Vector3;
  fog: THREE.Fog;
  /** Call once per frame while nature style is active to animate clouds. */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createNatureEnvironment(scene: THREE.Scene): NatureEnvironment {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 2.5;
  skyUniforms.rayleigh.value = 1.2;
  skyUniforms.mieCoefficient.value = 0.006;
  skyUniforms.mieDirectionalG.value = 0.8;
  skyUniforms.cloudCoverage.value = 0.45;
  skyUniforms.cloudDensity.value = 0.45;
  skyUniforms.cloudScale.value = 0.0009;
  // Slow, believable drift — the previous 0.02 crossed the whole sky in a
  // few seconds; 0.0015 was still too fast, so this is another ~6x down,
  // more like real high-altitude clouds drifting over many minutes.
  skyUniforms.cloudSpeed.value = 0.00025;

  // Fixed mid-afternoon sun position (elevation ~35°, azimuth ~135°).
  const elevation = THREE.MathUtils.degToRad(35);
  const azimuth = THREE.MathUtils.degToRad(135);
  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
  skyUniforms.sunPosition.value.copy(sunPosition);

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sunLight.position.copy(sunPosition).multiplyScalar(1000);

  // The Sky shader technically has a sun disc (showSunDisc uniform), but
  // its physically-accurate angular size is only a couple of screen
  // pixels — easy to miss entirely. A simple additive glow sprite makes
  // the light source in the sky actually visible.
  const sunSprite = new THREE.Sprite(createSunMaterial());
  const SUN_DISTANCE = 15000; // inside the 20000-radius sky dome
  sunSprite.position.copy(sunPosition).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.setScalar(2600);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2;
  configureGroundTexture(ground.material as THREE.MeshStandardMaterial);

  // Pale horizon haze color (roughly matches this sky configuration's
  // horizon tone) — blended in via fog so the ground plane fades smoothly
  // into the sky instead of showing a hard, distracting edge.
  const fog = new THREE.Fog(0xf2f5f4, 1, 2);

  scene.add(sky, ground, sunLight, sunSprite);
  sky.visible = false;
  ground.visible = false;
  sunLight.visible = false;
  sunSprite.visible = false;

  return {
    sky,
    ground,
    sunLight,
    sunSprite,
    sunDirection: sunPosition.clone(),
    fog,
    update(elapsed: number) {
      skyUniforms.time.value = elapsed;
    },
    setVisible(visible: boolean) {
      sky.visible = visible;
      ground.visible = visible;
      sunLight.visible = visible;
      sunSprite.visible = visible;
      scene.fog = visible ? fog : null;
    },
    dispose() {
      scene.remove(sky, ground, sunLight, sunSprite);
      if (scene.fog === fog) scene.fog = null;
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.MeshStandardMaterial).map?.dispose();
      (ground.material as THREE.MeshStandardMaterial).normalMap?.dispose();
      (ground.material as THREE.MeshStandardMaterial).roughnessMap?.dispose();
      (ground.material as THREE.Material).dispose();
      (sunSprite.material as THREE.SpriteMaterial).map?.dispose();
      (sunSprite.material as THREE.Material).dispose();
    },
  };
}

/** A bright, warm sun disc with a soft feathered edge, standing in for the sky shader's near-invisible physical sun disc. */
function createSunMaterial(): THREE.SpriteMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Normal (alpha) blending, not additive: additive light gets washed out
  // against an already-bright sky, especially near the pale horizon.
  // A solid, opaque-cored disc that just alpha-fades at the edge reads as
  // a clearly visible sun regardless of what's behind it.
  gradient.addColorStop(0, 'rgba(255,252,235,1)');
  gradient.addColorStop(0.14, 'rgba(255,247,210,1)');
  gradient.addColorStop(0.3, 'rgba(255,225,140,0.85)');
  gradient.addColorStop(0.6, 'rgba(255,205,110,0.3)');
  gradient.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

/** Repositions the sky dome and ground plane to surround/underlie a given world center + size. */
export function placeNatureEnvironment(env: NatureEnvironment, center: THREE.Vector3, groundSize: number): void {
  env.sky.position.set(center.x, 0, center.z);
  env.ground.position.set(center.x, 0, center.z);
  env.ground.scale.setScalar(groundSize);

  const SUN_DISTANCE = 15000;
  env.sunSprite.position.copy(env.sunDirection).multiplyScalar(SUN_DISTANCE).add(center);

  // Fog range scales with the flock's own size (groundSize is the huge,
  // mostly-decorative ground plane, ~30x flockScale) so the ground fades
  // out well before its physical edge, hiding the seam at the horizon.
  const flockScale = groundSize / 30;
  env.fog.near = flockScale * 2;
  env.fog.far = flockScale * 6.5;
}

/**
 * Procedurally paints a tileable grass texture with multi-scale color
 * variation, plus a matching normal map and roughness map — no external
 * assets. Purely fine speckle (the original approach) all but disappears
 * once mip-mapped at typical ground-plane viewing distance, which is why
 * the ground read as a flat solid green; layering in larger low-frequency
 * blotches (which survive minification) fixes that, and deriving a bump
 * normal map from the same blotch layout adds real (if subtle) relief
 * that catches the sun light instead of looking like a flat painted mat.
 */
function configureGroundTexture(material: THREE.MeshStandardMaterial): void {
  const size = 512;
  const diffuseCanvas = document.createElement('canvas');
  diffuseCanvas.width = size;
  diffuseCanvas.height = size;
  const ctx = diffuseCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const heightCtx = heightCanvas.getContext('2d')!;

  ctx.fillStyle = '#3d6b35';
  ctx.fillRect(0, 0, size, size);
  heightCtx.fillStyle = '#808080';
  heightCtx.fillRect(0, 0, size, size);

  // Draws a soft radial blotch onto an arbitrary canvas context, wrapped
  // across the edges so the tile still repeats seamlessly.
  const drawBlob = (targetCtx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) => {
    const offsets = [-size, 0, size];
    for (const ox of offsets) {
      for (const oy of offsets) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + radius < 0 || cx - radius > size || cy + radius < 0 || cy - radius > size) continue;
        const gradient = targetCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(${color}, ${alpha})`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);
        targetCtx.fillStyle = gradient;
        targetCtx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
    }
  };

  // Large, low-frequency patches (dry yellow-green and shaded deep green)
  // — these are the features that actually survive mipmapping at a
  // distance and read as ground texture rather than a solid fill. Each
  // patch is also stamped onto the height canvas (raised for dry/tall
  // clumps, sunken for shaded hollows) so the normal map derived below
  // gives the same patches real, sun-catching relief.
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 40 + Math.random() * 90;
    const dry = Math.random() < 0.5;
    const color = dry ? '150, 150, 70' : '30, 55, 28';
    drawBlob(ctx, x, y, radius, color, 0.22 + Math.random() * 0.1);
    const bump = dry ? '210, 210, 210' : '90, 90, 90';
    drawBlob(heightCtx, x, y, radius * 0.85, bump, 0.35);
  }

  // Medium-scale mottling for mid-distance variation.
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 10 + Math.random() * 22;
    const green = 70 + Math.random() * 80;
    const color = `${45 + green * 0.2}, ${green}, ${40 + green * 0.15}`;
    drawBlob(ctx, x, y, radius, color, 0.28 + Math.random() * 0.15);
    drawBlob(heightCtx, x, y, radius * 0.7, '190, 190, 190', 0.18);
  }

  // Fine speckle for close-up detail (diffuse only — too small to matter
  // for the normal map, and would just add noise).
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 20 + Math.random() * 40;
    const green = 90 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${40 + shade * 0.3}, ${green}, ${35 + shade * 0.3}, 0.5)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  const texture = new THREE.CanvasTexture(diffuseCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Lower repeat than before (was 400) so the large-scale blotches above
  // stay visibly sized on the ground instead of tiling into fine noise.
  texture.repeat.set(120, 120);
  texture.colorSpace = THREE.SRGBColorSpace;

  const normalTexture = heightMapToNormalTexture(heightCtx, size);
  normalTexture.wrapS = THREE.RepeatWrapping;
  normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.repeat.copy(texture.repeat);

  // Reuse the same height canvas as a roughness map: raised dry clumps
  // read a little glossier (fresh grass catching light), sunken hollows
  // a little rougher (shadowed, matte dirt) — subtle, but breaks up the
  // otherwise perfectly uniform specular response of a flat plane.
  const roughnessTexture = new THREE.CanvasTexture(heightCanvas);
  roughnessTexture.wrapS = THREE.RepeatWrapping;
  roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.repeat.copy(texture.repeat);

  material.map = texture;
  material.normalMap = normalTexture;
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  material.roughnessMap = roughnessTexture;
  material.roughness = 1;
  material.metalness = 0;
}

/** Converts a grayscale height canvas into a tangent-space normal map via a Sobel-style gradient. */
function heightMapToNormalTexture(heightCtx: CanvasRenderingContext2D, size: number): THREE.CanvasTexture {
  const heightData = heightCtx.getImageData(0, 0, size, size).data;
  const sample = (x: number, y: number) => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return heightData[(wy * size + wx) * 4] / 255;
  };

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImage = normalCtx.createImageData(size, size);

  const strength = 3.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = sample(x - 1, y);
      const right = sample(x + 1, y);
      const up = sample(x, y - 1);
      const down = sample(x, y + 1);
      const dx = (left - right) * strength;
      const dy = (up - down) * strength;
      const normal = new THREE.Vector3(dx, dy, 1).normalize();
      const i = (y * size + x) * 4;
      normalImage.data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalImage.data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalImage.data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalImage.data[i + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);

  // Normal maps encode directions, not color — must NOT be sRGB-decoded.
  return new THREE.CanvasTexture(normalCanvas);
}

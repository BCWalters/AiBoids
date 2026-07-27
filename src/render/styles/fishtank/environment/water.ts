import * as THREE from 'three';
import { WATER_COLOR } from './shared';

export interface WaterResult {
  waterFill: THREE.Mesh;
  caustics: THREE.Mesh;
  suspendedParticles: THREE.Points;
  /** Private ref needed by environment.ts's applyTimeOfDay closure. */
  waterMaterial: THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial;
  /** Private refs needed by environment.ts's update closure. */
  causticsMaterial: THREE.MeshBasicMaterial;
  particleMaterial: THREE.PointsMaterial;
  particleGeometry: THREE.BufferGeometry;
}

export function createCausticsTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.05 + Math.random() * 0.12);
    const gradient = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Creates the water fill, caustic overlay, and suspended-particle cloud.
 *  Returns both the public meshes and private material/geometry refs
 *  needed by the update and applyTimeOfDay closures in environment.ts. */
export function createWater(reducedGraphics: boolean): WaterResult {
  const waterGeometry = new THREE.BoxGeometry(1, 1, 1);
  // See the reduced-graphics note at the top of createFishtankEnvironment:
  // in reduced mode the water becomes a flat translucent MeshBasicMaterial
  // (no transmission pass, no PBR shader compile), which is the single
  // biggest fishtank speedup under software WebGL.
  const waterMaterial: THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial = reducedGraphics
    ? new THREE.MeshBasicMaterial({
        color: WATER_COLOR,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    : new THREE.MeshPhysicalMaterial({
        color: WATER_COLOR,
        transparent: true,
        opacity: 0.34,
        transmission: 0.35,
        thickness: 0.8,
        ior: 1.07,
        roughness: 0.08,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
  const waterFill = new THREE.Mesh(waterGeometry, waterMaterial);
  waterFill.visible = false;
  waterFill.receiveShadow = true;

  const causticsTexture = createCausticsTexture();
  const causticsMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fdfff,
    map: causticsTexture,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), causticsMaterial);
  caustics.rotation.x = -Math.PI / 2;
  caustics.visible = false;

  const particleCount = reducedGraphics ? 60 : 750;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSeeds = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3 + 0] = Math.random() - 0.5;
    particlePositions[i * 3 + 1] = Math.random() - 0.5;
    particlePositions[i * 3 + 2] = Math.random() - 0.5;
    particleSeeds[i] = Math.random();
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('seed', new THREE.BufferAttribute(particleSeeds, 1));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xc9f1ff,
    size: 0.8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const suspendedParticles = new THREE.Points(particleGeometry, particleMaterial);
  suspendedParticles.visible = false;

  return { waterFill, caustics, suspendedParticles, waterMaterial, causticsMaterial, particleMaterial, particleGeometry };
}

/**
 * Sizes and positions the water fill, caustics plane, and particle cloud
 * to match the tank dimensions.  Must be called after `createWater`.
 */
export function placeWater(
  waterFill: THREE.Mesh,
  caustics: THREE.Mesh,
  suspendedParticles: THREE.Points,
  center: THREE.Vector3,
  worldWidth: number,
  worldDepth: number,
  waterHeight: number,
  roomFloorY: number,
  glassThickness: number,
  inset: number,
): void {
  waterFill.scale.set(worldWidth - inset, waterHeight - inset, worldDepth - inset);
  waterFill.position.set(center.x, waterHeight / 2, center.z);
  caustics.scale.set(worldWidth * 0.98, worldDepth * 0.98, 1);
  caustics.position.set(center.x, roomFloorY + glassThickness * 2, center.z);
  suspendedParticles.scale.set(worldWidth - inset, waterHeight - inset, worldDepth - inset);
  suspendedParticles.position.set(center.x, waterHeight / 2, center.z);
}

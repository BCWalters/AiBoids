import * as THREE from 'three';

/**
 * Foreground "drifting cloud" puffs — actual 3D sprite clusters that
 * wander slowly through world space, separate from the baked-in cloud
 * layer painted onto the sky dome shader (which is infinitely far away
 * and can never occlude/intersect anything). Most of these drift high
 * above the flock's bounding box, but a fraction spawn at flock altitude
 * so they occasionally pass right through the flock.
 */
export interface DriftingClouds {
  /** Reposition the spawn/despawn region around a given world center + flock scale. */
  configure(center: THREE.Vector3, flockScale: number): void;
  update(dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const MAX_CLOUDS = 6;
const MIN_PUFFS = 5;
const MAX_PUFFS = 9;
// Fraction of spawns that pass through the flock's own altitude band
// rather than drifting harmlessly overhead.
const THROUGH_FLOCK_CHANCE = 0.3;

interface CloudInstance {
  group: THREE.Group;
  velocity: THREE.Vector3;
}

function createPuffTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createDriftingClouds(scene: THREE.Scene): DriftingClouds {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  const puffTexture = createPuffTexture();
  const material = new THREE.SpriteMaterial({
    map: puffTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: true,
  });

  const center = new THREE.Vector3();
  let flockScale = 500;
  let spawnTimer = 4;
  const active: CloudInstance[] = [];
  // Gentle prevailing wind, mostly along +X with a slight drift in Z.
  const windDir = new THREE.Vector3(1, 0, 0.25).normalize();

  function spawnCloud(): void {
    const throughFlock = Math.random() < THROUGH_FLOCK_CHANCE;
    const group = new THREE.Group();
    const puffCount = MIN_PUFFS + Math.floor(Math.random() * (MAX_PUFFS - MIN_PUFFS));
    const clusterRadius = flockScale * (0.12 + Math.random() * 0.1);
    for (let i = 0; i < puffCount; i++) {
      const sprite = new THREE.Sprite(material);
      const angle = Math.random() * Math.PI * 2;
      const r = clusterRadius * Math.random() * 0.8;
      sprite.position.set(Math.cos(angle) * r, (Math.random() - 0.5) * clusterRadius * 0.35, Math.sin(angle) * r * 0.6);
      sprite.scale.setScalar(clusterRadius * (0.5 + Math.random() * 0.6));
      group.add(sprite);
    }

    // Start well outside the flock's box on the upwind side, drifting downwind.
    const startX = center.x - windDir.x * flockScale * 2.2;
    const startZ = center.z - windDir.z * flockScale * 2.2;
    const startY = throughFlock
      ? center.y + (Math.random() - 0.5) * flockScale * 0.6 // within the flock's own altitude band
      : center.y + flockScale * (0.9 + Math.random() * 0.8); // safely overhead
    group.position.set(startX + (Math.random() - 0.5) * flockScale, startY, startZ + (Math.random() - 0.5) * flockScale);

    const speed = flockScale * (0.012 + Math.random() * 0.006);
    const velocity = windDir.clone().multiplyScalar(speed);

    root.add(group);
    active.push({ group, velocity });
  }

  function despawnCloud(cloud: CloudInstance): void {
    // Sprite geometry is a shared module-level singleton in three.js — do
    // not dispose it here, just drop the group (sprites hold no other
    // per-instance GPU resources; the material/texture are shared too).
    root.remove(cloud.group);
  }

  return {
    configure(newCenter: THREE.Vector3, newFlockScale: number) {
      center.copy(newCenter);
      flockScale = newFlockScale;
    },
    update(dt: number) {
      if (!root.visible) return;

      spawnTimer -= dt;
      if (spawnTimer <= 0 && active.length < MAX_CLOUDS) {
        spawnCloud();
        spawnTimer = 8 + Math.random() * 14;
      }

      const despawnX = center.x + windDir.x * flockScale * 2.5;
      for (let i = active.length - 1; i >= 0; i--) {
        const cloud = active[i];
        cloud.group.position.addScaledVector(cloud.velocity, dt);
        const traveled = (cloud.group.position.x - center.x) * Math.sign(windDir.x || 1);
        if (traveled > Math.abs(despawnX - center.x)) {
          despawnCloud(cloud);
          active.splice(i, 1);
        }
      }
    },
    setVisible(visible: boolean) {
      root.visible = visible;
    },
    dispose() {
      for (const cloud of active) despawnCloud(cloud);
      active.length = 0;
      scene.remove(root);
      material.map?.dispose();
      material.dispose();
    },
  };
}

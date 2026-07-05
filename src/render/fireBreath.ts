import * as THREE from 'three';

/**
 * A short additive-blended stream of orange/yellow/red sprite particles
 * that a dragon predator periodically breathes forward along its heading
 * — a cheap, cartoony "fire breath" cue that mirrors bloodEffects.ts's
 * burst-particle pattern (same lifecycle: spawn a batch of sprites with
 * per-particle velocity, fade/shrink over a fixed duration, clean up).
 */
export interface FireBreathEffects {
  /** Spawn one breath burst at `origin`, traveling forward along `direction` (the dragon's heading). */
  spawn(origin: THREE.Vector3, direction: THREE.Vector3, scale: number): void;
  update(dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const BREATH_DURATION = 0.75;
const PARTICLES_PER_BREATH = 14;
const FLAME_COLORS = [0xfff2a8, 0xffb347, 0xff6a1a, 0xd6401a];

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  startScale: number;
}

interface Burst {
  particles: Particle[];
  elapsed: number;
}

function createFlameTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,220,150,0.9)');
  gradient.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createFireBreathEffects(scene: THREE.Scene): FireBreathEffects {
  const root = new THREE.Group();
  root.visible = true;
  scene.add(root);

  const texture = createFlameTexture();
  const baseMaterial = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });

  const active: Burst[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  return {
    spawn(origin: THREE.Vector3, direction: THREE.Vector3, scale: number) {
      const dir = direction.clone().normalize();
      // Build a small local basis perpendicular to the breath direction so
      // particles spread outward in a cone rather than a single line.
      let side = new THREE.Vector3().crossVectors(dir, up);
      if (side.lengthSq() < 1e-6) side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0));
      side.normalize();
      const perp = new THREE.Vector3().crossVectors(dir, side).normalize();

      const particles: Particle[] = [];
      for (let i = 0; i < PARTICLES_PER_BREATH; i++) {
        const material = baseMaterial.clone();
        const color = FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)];
        material.color.setHex(color);
        const sprite = new THREE.Sprite(material);

        // Stagger particles slightly behind the snout so the stream reads
        // as a continuous jet rather than one blob appearing all at once.
        const startOffset = dir.clone().multiplyScalar(-Math.random() * scale * 0.4);
        sprite.position.copy(origin).add(startOffset);
        const startScale = scale * (0.35 + Math.random() * 0.35);
        sprite.scale.setScalar(startScale);

        const coneSpread = 0.22; // radians-ish spread factor
        const spreadVec = side
          .clone()
          .multiplyScalar((Math.random() - 0.5) * coneSpread)
          .add(perp.clone().multiplyScalar((Math.random() - 0.5) * coneSpread));
        const speed = scale * (3.5 + Math.random() * 3.5);
        const velocity = dir.clone().add(spreadVec).normalize().multiplyScalar(speed);

        root.add(sprite);
        particles.push({ sprite, velocity, startScale });
      }
      active.push({ particles, elapsed: 0 });
    },
    update(dt: number) {
      for (let i = active.length - 1; i >= 0; i--) {
        const burst = active[i];
        burst.elapsed += dt;
        const t = Math.min(1, burst.elapsed / BREATH_DURATION);
        const fade = 1 - t;
        for (const particle of burst.particles) {
          particle.sprite.position.addScaledVector(particle.velocity, dt);
          particle.sprite.scale.setScalar(particle.startScale * (1 + t * 0.6));
          (particle.sprite.material as THREE.SpriteMaterial).opacity = fade;
        }
        if (t >= 1) {
          for (const particle of burst.particles) {
            root.remove(particle.sprite);
            (particle.sprite.material as THREE.Material).dispose();
          }
          active.splice(i, 1);
        }
      }
    },
    setVisible(visible: boolean) {
      root.visible = visible;
    },
    dispose() {
      for (const burst of active) {
        for (const particle of burst.particles) {
          root.remove(particle.sprite);
          (particle.sprite.material as THREE.Material).dispose();
        }
      }
      active.length = 0;
      scene.remove(root);
      texture.dispose();
      baseMaterial.dispose();
    },
  };
}

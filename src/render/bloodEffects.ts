import * as THREE from 'three';

/**
 * A cartoony red particle-splatter effect spawned wherever a predator
 * catches a boid (see Simulation.catchEvents). Each burst is a handful of
 * small round sprites that pop outward, fall slightly under gravity, and
 * fade out over well under a second — a quick, readable "gotcha" beat
 * rather than anything gory/realistic.
 */
export interface BloodEffects {
  /** Spawn one burst at a world position, biased outward along `direction` (typically the predator's heading). */
  spawn(position: THREE.Vector3, direction: THREE.Vector3, scale: number): void;
  update(dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const BURST_DURATION = 0.55;
const PARTICLES_PER_BURST = 9;
const GRAVITY = 60;

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
}

interface Burst {
  particles: Particle[];
  elapsed: number;
}

function createDropletTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createBloodEffects(scene: THREE.Scene): BloodEffects {
  const root = new THREE.Group();
  root.visible = true;
  scene.add(root);

  const texture = createDropletTexture();
  const baseMaterial = new THREE.SpriteMaterial({
    map: texture,
    color: 0xcc1f1f,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });

  const active: Burst[] = [];

  return {
    spawn(position: THREE.Vector3, direction: THREE.Vector3, scale: number) {
      const particles: Particle[] = [];
      for (let i = 0; i < PARTICLES_PER_BURST; i++) {
        const material = baseMaterial.clone();
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        const spriteScale = scale * (0.5 + Math.random() * 0.6);
        sprite.scale.setScalar(spriteScale);

        // Mostly forward/outward from the catch point (biased along the
        // predator's heading) with some random spread in every direction,
        // plus a little initial upward pop before gravity takes over.
        const spread = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        );
        const speed = scale * (2.5 + Math.random() * 2.5);
        const velocity = direction
          .clone()
          .multiplyScalar(0.6)
          .add(spread.multiplyScalar(0.7))
          .normalize()
          .multiplyScalar(speed);
        velocity.y += scale * 1.2; // initial upward pop

        root.add(sprite);
        particles.push({ sprite, velocity });
      }
      active.push({ particles, elapsed: 0 });
    },
    update(dt: number) {
      for (let i = active.length - 1; i >= 0; i--) {
        const burst = active[i];
        burst.elapsed += dt;
        const t = Math.min(1, burst.elapsed / BURST_DURATION);
        const fade = 1 - t;
        for (const particle of burst.particles) {
          particle.velocity.y -= GRAVITY * dt;
          particle.sprite.position.addScaledVector(particle.velocity, dt);
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

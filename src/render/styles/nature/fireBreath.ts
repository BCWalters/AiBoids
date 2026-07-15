import * as THREE from 'three';

/**
 * A short additive-blended stream of orange/yellow/red sprite particles
 * that a dragon predator periodically breathes forward along its heading
 * — a cheap, cartoony "fire breath" cue that mirrors bloodEffects.ts's
 * burst-particle pattern (same lifecycle: spawn a batch of sprites with
 * per-particle velocity, fade/shrink over a fixed duration, clean up).
 */
export interface FireBreathEffects {
  /**
   * Spawn one breath burst at `origin`, traveling forward along
   * `direction` (the dragon's actual mouth-pointing direction).
   * `emitterVelocity` is the breathing dragon's current world-space
   * velocity — added to every particle's velocity so the flame stream
   * reliably outpaces a fast-moving dragon instead of it flying through
   * its own fire. `speedFraction` (0 = stationary, 1 = at max speed)
   * additionally stretches the burst's initial spawn spread and outward
   * speed, so the flame reaches farther ahead the faster the dragon is
   * moving, and stays a short, close puff when it's nearly still.
   */
  spawn(origin: THREE.Vector3, direction: THREE.Vector3, scale: number, emitterVelocity: THREE.Vector3, speedFraction: number): void;
  update(dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const BREATH_DURATION = 0.75;
const PARTICLES_PER_BREATH = 14;
const MAX_ACTIVE_BURSTS = 24;
const MAX_POOLED_PARTICLES = 512;
const FLAME_COLORS = [0xfff2a8, 0xffb347, 0xff6a1a, 0xd6401a];
// At full speed, particles get this much extra outward reach (both
// initial stagger distance and outward speed) on top of the stationary
// baseline — see the spawn() doc comment above.
const REACH_SPEED_BOOST = 1.6;

interface Particle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
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
  const pooled: Particle[] = [];
  const allocated: Particle[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const fallbackSide = new THREE.Vector3(1, 0, 0);
  const tmpDir = new THREE.Vector3();
  const tmpSide = new THREE.Vector3();
  const tmpPerp = new THREE.Vector3();
  const tmpSpread = new THREE.Vector3();

  const acquireParticle = (): Particle => {
    const fromPool = pooled.pop();
    if (fromPool) {
      fromPool.sprite.visible = true;
      return fromPool;
    }
    const material = baseMaterial.clone();
    const sprite = new THREE.Sprite(material);
    sprite.visible = true;
    root.add(sprite);
    const particle = { sprite, material, velocity: new THREE.Vector3(), startScale: 1 };
    allocated.push(particle);
    return particle;
  };

  const releaseParticle = (particle: Particle): void => {
    particle.sprite.visible = false;
    if (pooled.length < MAX_POOLED_PARTICLES) {
      pooled.push(particle);
      return;
    }
    root.remove(particle.sprite);
    particle.material.dispose();
    const idx = allocated.indexOf(particle);
    if (idx >= 0) allocated.splice(idx, 1);
  };

  return {
    spawn(origin: THREE.Vector3, direction: THREE.Vector3, scale: number, emitterVelocity: THREE.Vector3, speedFraction: number) {
      if (active.length >= MAX_ACTIVE_BURSTS) return;
      tmpDir.copy(direction).normalize();
      // Build a small local basis perpendicular to the breath direction so
      // particles spread outward in a cone rather than a single line.
      tmpSide.crossVectors(tmpDir, up);
      if (tmpSide.lengthSq() < 1e-6) tmpSide.crossVectors(tmpDir, fallbackSide);
      tmpSide.normalize();
      tmpPerp.crossVectors(tmpDir, tmpSide).normalize();

      // Reach grows with how fast the dragon is currently flying — a
      // stationary/slow dragon gets a short, close puff, while one at
      // full speed gets a stream that stretches out well ahead of it
      // (both a longer initial stagger and a higher outward speed),
      // reading more like a continuous jet than a single blob it could
      // otherwise catch up to and fly straight through.
      const reach = 1 + THREE.MathUtils.clamp(speedFraction, 0, 1) * REACH_SPEED_BOOST;

      const particles: Particle[] = [];
      for (let i = 0; i < PARTICLES_PER_BREATH; i++) {
        const particle = acquireParticle();
        const { sprite, material } = particle;
        const color = FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)];
        material.color.setHex(color);
        material.opacity = 1;

        // Stagger particles slightly behind the snout so the stream reads
        // as a continuous jet rather than one blob appearing all at once.
        sprite.position.copy(origin).addScaledVector(tmpDir, -Math.random() * scale * 0.4 * reach);
        const startScale = scale * (0.35 + Math.random() * 0.35);
        sprite.scale.setScalar(startScale);

        const coneSpread = 0.22; // radians-ish spread factor
        tmpSpread
          .copy(tmpSide)
          .multiplyScalar((Math.random() - 0.5) * coneSpread)
          .addScaledVector(tmpPerp, (Math.random() - 0.5) * coneSpread);
        const speed = scale * (3.5 + Math.random() * 3.5) * reach;
        // Inherit the dragon's own velocity on top of the outward flame
        // speed — without this, a dragon flying at max speed can easily
        // catch up to (and appear to fly through) its own slower-moving
        // fire, since the particles' outward speed alone has no idea how
        // fast the emitter itself is already moving forward.
        particle.velocity.copy(tmpDir).add(tmpSpread).normalize().multiplyScalar(speed).add(emitterVelocity);

        particle.startScale = startScale;
        particles.push(particle);
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
          particle.material.opacity = fade;
        }
        if (t >= 1) {
          for (const particle of burst.particles) {
            releaseParticle(particle);
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
          releaseParticle(particle);
        }
      }
      active.length = 0;
      for (const particle of allocated) {
        root.remove(particle.sprite);
        particle.material.dispose();
      }
      pooled.length = 0;
      allocated.length = 0;
      scene.remove(root);
      texture.dispose();
      baseMaterial.dispose();
    },
  };
}

import * as THREE from 'three';
import { type Predator, PredatorSpecies } from '../sim/Predator';
import type { FireBreathEffects } from './styles/nature/fireBreath';

interface DragonMouthTransform {
  offsetForward: number;
  offsetUp: number;
  dirForward: number;
  dirUp: number;
}

interface DragonFireBreathControllerOptions {
  fireBreathEffects: FireBreathEffects;
  dragonMouth: DragonMouthTransform;
  dragonLength: number;
}

export class DragonFireBreathController {
  private readonly fireBreathEffects: FireBreathEffects;
  private readonly dragonMouth: DragonMouthTransform;
  private readonly dragonLength: number;
  private readonly nextFireBreathTime = new WeakMap<Predator, number>();
  private readonly tmpFireOrigin = new THREE.Vector3();
  private readonly tmpFireDirection = new THREE.Vector3();
  private readonly tmpFireOffset = new THREE.Vector3();
  private readonly tmpFireEmitterVelocity = new THREE.Vector3();

  constructor(options: DragonFireBreathControllerOptions) {
    this.fireBreathEffects = options.fireBreathEffects;
    this.dragonMouth = options.dragonMouth;
    this.dragonLength = options.dragonLength;
  }

  update(
    predators: Predator[],
    elapsed: number,
    dragonDisplayQuats: Map<number, THREE.Quaternion>,
    predatorMaxSpeed: number,
  ): void {
    for (const predator of predators) {
      if (predator.species !== PredatorSpecies.Monster) continue;
      if (predator.digesting) continue;
      const nextTime = this.getOrSeedNextFireBreathTime(predator, elapsed);
      if (elapsed < nextTime) continue;
      if (predator.huntIntensity < 0.45) {
        this.nextFireBreathTime.set(predator, elapsed + 0.5);
        continue;
      }

      this.computeDragonFirePose(predator, dragonDisplayQuats);
      this.spawnDragonFireBreath(predator, predatorMaxSpeed);
      this.nextFireBreathTime.set(predator, elapsed + 2 + Math.random() * 2.5);
    }
  }

  private getOrSeedNextFireBreathTime(predator: Predator, elapsed: number): number {
    let nextTime = this.nextFireBreathTime.get(predator);
    if (nextTime === undefined) {
      nextTime = elapsed + 1 + Math.random() * 2.5;
      this.nextFireBreathTime.set(predator, nextTime);
    }
    return nextTime;
  }

  private computeDragonFirePose(
    predator: Predator,
    dragonDisplayQuats: Map<number, THREE.Quaternion>,
  ): void {
    const displayQuat = dragonDisplayQuats.get(predator.id);
    if (displayQuat) {
      this.tmpFireDirection
        .set(0, this.dragonMouth.dirForward, this.dragonMouth.dirUp)
        .applyQuaternion(displayQuat)
        .normalize();
      this.tmpFireOffset
        .set(0, this.dragonMouth.offsetForward, this.dragonMouth.offsetUp)
        .applyQuaternion(displayQuat);
      this.tmpFireOrigin.set(predator.position.x, predator.position.y, predator.position.z).add(this.tmpFireOffset);
      return;
    }

    const dir = predator.renderHeading;
    this.tmpFireDirection.set(dir.x, dir.y, dir.z);
    this.tmpFireOrigin.set(
      predator.position.x + dir.x * this.dragonLength * 0.55,
      predator.position.y + dir.y * this.dragonLength * 0.55,
      predator.position.z + dir.z * this.dragonLength * 0.55,
    );
  }

  private spawnDragonFireBreath(predator: Predator, predatorMaxSpeed: number): void {
    const vel = predator.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const speedFraction = THREE.MathUtils.clamp(speed / Math.max(predatorMaxSpeed, 1e-6), 0, 1);
    this.tmpFireEmitterVelocity.set(vel.x, vel.y, vel.z);

    this.fireBreathEffects.spawn(
      this.tmpFireOrigin,
      this.tmpFireDirection,
      this.dragonLength * 0.5,
      this.tmpFireEmitterVelocity,
      speedFraction,
    );
  }
}

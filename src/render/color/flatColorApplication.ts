import * as THREE from 'three';
import { jitterHSL } from './colorJitter';
import type { CreatureInstanceColorArgs } from './creatureColorApplication';

/**
 * Owns the flat-color creature class: solid body tint, wings matched to body,
 * and runtime baked-part passthrough for tail/legs (white when geometry has
 * baked vertex colors). This matches the shared fallback path byte-for-byte.
 */
export class FlatColorApplicator {
  private stateColor = new THREE.Color();
  private tailColor = new THREE.Color();
  private legsColor = new THREE.Color();
  private beakInstanceColor = new THREE.Color();

  apply(args: CreatureInstanceColorArgs): void {
    const {
      set,
      index,
      creature,
      baseColor,
      highlightColor,
      getIntensity,
      beakColor,
    } = args;
    const intensity = getIntensity(creature);

    this.stateColor.copy(baseColor).lerp(highlightColor, intensity);
    set.body.setColorAt(index, this.stateColor);

    set.wingLeft.setColorAt(index, this.stateColor);
    set.wingRight.setColorAt(index, this.stateColor);
    if (set.tail) {
      if (set.tail.geometry.getAttribute('color')) {
        this.tailColor.setRGB(1, 1, 1);
      } else {
        this.tailColor.copy(this.stateColor);
      }
      set.tail.setColorAt(index, this.tailColor);
    }

    if (set.legs) {
      if (set.legs.geometry.getAttribute('color')) {
        this.legsColor.setRGB(1, 1, 1);
      } else {
        this.legsColor.copy(this.stateColor);
      }
      set.legs.setColorAt(index, this.legsColor);
    }

    if (set.beak && beakColor) {
      jitterHSL(this.beakInstanceColor, beakColor, creature.id, 5, 0.04, 0.1, 0.08);
      set.beak.setColorAt(index, this.beakInstanceColor);
    }
  }
}

import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from './Renderer3D';
import * as THREE from 'three';
import { params } from '../sim/params';
import { pickEntity, type EntityForPicking } from './EntityPicker';

/** Exponential-smoothing rate (1/s) for damping the orbit-controls target. */
const TARGET_DAMP_RATE = 8;
const POV_POSITION_DAMP_RATE = 12;
const POV_LOOK_DAMP_RATE = 14;
const POV_FORWARD_OFFSET = 10;
const POV_UP_OFFSET = 2;
const POV_LOOK_AHEAD = 40;
const MIN_VECTOR_LEN_SQ = 1e-6;

/**
 * Implements the Creature View (Lane A, Tier 1 "orbit-lock") follow-cam
 * feature. When `params.followCamMode === 'orbit'`:
 *  - A left-click on the 3D canvas selects the creature nearest the cursor
 *    (screen-space projection, no raycasting).
 *  - Each frame the OrbitControls target is exponentially smoothed toward
 *    the selected creature's position, keeping it centred while the user
 *    retains full orbit/zoom interactivity.
 *  - If a creature is selected and `params.showCreatureInspector` is true,
 *    a small HUD overlay shows species, speed, and a coarse state label.
 *
 * When `followCamMode === 'off'` the controller is entirely inert.
 */
export class FollowCamController {
  private selectedId: number | null = null;
  private selectedIsPredator = false;
  private povActive = false;
  private povCameraPos: THREE.Vector3 | null = null;
  private povLookTarget: THREE.Vector3 | null = null;
  private readonly hud: HTMLElement;
  private readonly hudLine1: HTMLElement;
  private readonly hudLine2: HTMLElement;
  private readonly povButton: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.hud = document.createElement('div');
    this.hud.id = 'creature-inspector';
    this.hud.setAttribute('aria-live', 'polite');
    this.hud.style.display = 'none';
    this.hudLine1 = document.createElement('div');
    this.hudLine2 = document.createElement('div');
    this.povButton = document.createElement('button');
    this.povButton.type = 'button';
    this.povButton.className = 'creature-inspector-pov-toggle';
    this.povButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.selectedId === null) return;
      this.setPovActive(!this.povActive);
    });
    this.hud.append(this.hudLine1, this.hudLine2, this.povButton);
    container.appendChild(this.hud);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.setPovActive(false);
    });
  }

  /**
   * Call from a 'click' event listener on the 3D canvas.
   * Picks the creature nearest the pointer (within the default threshold)
   * or deselects if the pointer is too far from any entity.
   */
  handleCanvasClick(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    sim: Simulation,
    renderer3D: Renderer3D,
  ): void {
    if (params.followCamMode !== 'orbit') return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const entities = this.buildEntityList(sim, renderer3D);
    const picked = pickEntity(mouseX, mouseY, rect.width, rect.height, renderer3D.getCamera(), entities);

    const prevId = this.selectedId;
    const prevIsPredator = this.selectedIsPredator;
    this.selectedId = picked?.id ?? null;
    this.selectedIsPredator = picked?.isPredator ?? false;
    if (!picked) {
      this.setPovActive(false);
      return;
    }
    if (this.povActive && (prevId !== this.selectedId || prevIsPredator !== this.selectedIsPredator)) {
      this.povCameraPos = null;
      this.povLookTarget = null;
    }
  }

  /**
   * Per-frame update — call before `renderer3D.render()` so the orbit target
   * is current when OrbitControls.update() runs inside renderOutput().
   */
  update(dt: number, sim: Simulation, renderer3D: Renderer3D): void {
    if (params.followCamMode !== 'orbit') {
      this.setPovActive(false);
      this.hud.style.display = 'none';
      return;
    }

    const entity = this.resolveSelected(sim);
    if (!entity) {
      // Entity was removed (population change) — gracefully deselect.
      this.selectedId = null;
      this.setPovActive(false);
      this.hud.style.display = 'none';
      return;
    }

    if (this.povActive) {
      this.updatePovCamera(dt, entity, renderer3D);
    } else {
      // Exponentially smooth the orbit target toward the selected creature's
      // render-space position so it stays centred while the user orbits/zooms.
      const alpha = 1 - Math.exp(-dt * TARGET_DAMP_RATE);
      const renderedPos = renderer3D.toRenderedPosition(
        entity.position.x,
        entity.position.y,
        entity.position.z,
      );
      renderer3D.smoothOrbitTarget(renderedPos.x, renderedPos.y, renderedPos.z, alpha);
    }

    if (params.showCreatureInspector) {
      this.syncHud(entity, renderer3D);
    } else {
      this.hud.style.display = 'none';
    }
  }

  /** Clears the current selection. */
  deselect(): void {
    this.selectedId = null;
    this.setPovActive(false);
    this.hud.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEntityList(sim: Simulation, renderer3D: Renderer3D): EntityForPicking[] {
    const entities: EntityForPicking[] = [];
    for (const boid of sim.boids) {
      const pos = renderer3D.toRenderedPosition(boid.position.x, boid.position.y, boid.position.z);
      entities.push({ id: boid.id, position: pos, isPredator: false });
    }
    for (const predator of sim.predators) {
      const pos = renderer3D.toRenderedPosition(predator.position.x, predator.position.y, predator.position.z);
      entities.push({ id: predator.id, position: pos, isPredator: true });
    }
    return entities;
  }

  private resolveSelected(sim: Simulation): Boid | Predator | null {
    if (this.selectedId === null) return null;
    if (this.selectedIsPredator) {
      return sim.predators.find((p) => p.id === this.selectedId) ?? null;
    }
    return sim.boids.find((b) => b.id === this.selectedId) ?? null;
  }

  private syncHud(entity: Boid | Predator, renderer3D: Renderer3D): void {
    const labels = renderer3D.getCreatureLabels();
    const v = entity.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

    let speciesLabel: string;
    let stateLabel: string;

    if (this.selectedIsPredator) {
      const pred = entity as Predator;
      speciesLabel = labels.predator[pred.species] ?? pred.species;
      stateLabel = pred.digesting
        ? 'Digesting'
        : pred.huntIntensity > 0.5
          ? 'Hunting'
          : 'Searching';
    } else {
      const boid = entity as Boid;
      speciesLabel = labels.boid[boid.species] ?? boid.species;
      stateLabel = boid.panicLevel > 0.5 ? 'Fleeing' : 'Flocking';
    }

    this.hud.style.display = 'block';
    this.hudLine1.textContent = speciesLabel;
    this.hudLine2.textContent = `${Math.round(speed)} u/s \u00b7 ${stateLabel}`;
    this.povButton.textContent = this.povActive ? 'Exit POV (Esc)' : 'Enter POV';
  }

  private updatePovCamera(dt: number, entity: Boid | Predator, renderer3D: Renderer3D): void {
    const renderedPos = renderer3D.toRenderedPosition(entity.position.x, entity.position.y, entity.position.z);
    const heading = this.getRenderedHeading(entity, renderer3D, renderedPos);

    const desiredCameraPos = renderedPos
      .clone()
      .addScaledVector(heading, POV_FORWARD_OFFSET)
      .add(new THREE.Vector3(0, POV_UP_OFFSET, 0));
    const desiredLookTarget = desiredCameraPos.clone().addScaledVector(heading, POV_LOOK_AHEAD);

    if (!this.povCameraPos) this.povCameraPos = desiredCameraPos.clone();
    if (!this.povLookTarget) this.povLookTarget = desiredLookTarget.clone();

    const posAlpha = 1 - Math.exp(-dt * POV_POSITION_DAMP_RATE);
    const lookAlpha = 1 - Math.exp(-dt * POV_LOOK_DAMP_RATE);
    this.povCameraPos.lerp(desiredCameraPos, posAlpha);
    this.povLookTarget.lerp(desiredLookTarget, lookAlpha);

    const camera = renderer3D.getCamera();
    camera.position.copy(this.povCameraPos);
    renderer3D.smoothOrbitTarget(this.povLookTarget.x, this.povLookTarget.y, this.povLookTarget.z, 1);
  }

  private getRenderedHeading(entity: Boid | Predator, renderer3D: Renderer3D, renderedPos: THREE.Vector3): THREE.Vector3 {
    const heading = new THREE.Vector3(entity.renderHeading.x, entity.renderHeading.y, entity.renderHeading.z);
    if (heading.lengthSq() < MIN_VECTOR_LEN_SQ) {
      heading.set(entity.velocity.x, entity.velocity.y, entity.velocity.z);
    }
    if (heading.lengthSq() < MIN_VECTOR_LEN_SQ) {
      renderer3D.getCamera().getWorldDirection(heading);
    }
    if (heading.lengthSq() < MIN_VECTOR_LEN_SQ) {
      heading.set(0, 0, -1);
    } else {
      heading.normalize();
    }

    const renderedAhead = renderer3D.toRenderedPosition(
      entity.position.x + heading.x,
      entity.position.y + heading.y,
      entity.position.z + heading.z,
    );
    const renderedHeading = renderedAhead.sub(renderedPos);
    if (renderedHeading.lengthSq() < MIN_VECTOR_LEN_SQ) {
      return heading;
    }
    return renderedHeading.normalize();
  }

  private setPovActive(active: boolean): void {
    this.povActive = active && this.selectedId !== null;
    if (!this.povActive) {
      this.povCameraPos = null;
      this.povLookTarget = null;
    }
  }
}

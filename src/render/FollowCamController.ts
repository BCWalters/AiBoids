import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { Simulation } from '../sim/Simulation';
import type { Renderer3D } from './Renderer3D';
import { params } from '../sim/params';
import { pickEntity, type EntityForPicking } from './EntityPicker';

/** Exponential-smoothing rate (1/s) for damping the orbit-controls target. */
const TARGET_DAMP_RATE = 8;

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
  private readonly hud: HTMLElement;

  constructor(container: HTMLElement) {
    this.hud = document.createElement('div');
    this.hud.id = 'creature-inspector';
    this.hud.setAttribute('aria-live', 'polite');
    this.hud.style.display = 'none';
    container.appendChild(this.hud);
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

    this.selectedId = picked?.id ?? null;
    this.selectedIsPredator = picked?.isPredator ?? false;
  }

  /**
   * Per-frame update — call before `renderer3D.render()` so the orbit target
   * is current when OrbitControls.update() runs inside renderOutput().
   */
  update(dt: number, sim: Simulation, renderer3D: Renderer3D): void {
    if (params.followCamMode !== 'orbit') {
      this.hud.style.display = 'none';
      return;
    }

    const entity = this.resolveSelected(sim);
    if (!entity) {
      // Entity was removed (population change) — gracefully deselect.
      this.selectedId = null;
      this.hud.style.display = 'none';
      return;
    }

    // Exponentially smooth the orbit target toward the selected creature's
    // render-space position so it stays centred while the user orbits/zooms.
    const alpha = 1 - Math.exp(-dt * TARGET_DAMP_RATE);
    const renderedPos = renderer3D.toRenderedPosition(
      entity.position.x,
      entity.position.y,
      entity.position.z,
    );
    renderer3D.smoothOrbitTarget(renderedPos.x, renderedPos.y, renderedPos.z, alpha);

    if (params.showCreatureInspector) {
      this.syncHud(entity, renderer3D);
    } else {
      this.hud.style.display = 'none';
    }
  }

  /** Clears the current selection. */
  deselect(): void {
    this.selectedId = null;
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
    // Each line is set as a separate text node via children to support
    // the white-space:pre CSS on the container without needing innerHTML.
    const line1 = speciesLabel;
    const line2 = `${Math.round(speed)} u/s \u00b7 ${stateLabel}`;
    this.hud.textContent = `${line1}\n${line2}`;
  }
}

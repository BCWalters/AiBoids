import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { Renderer3D } from './Renderer3D';
import { pickStatusPhrase, type CreatureStatusCategory } from './creatureStatusPhrases';

export class CreatureHud {
  private readonly hud: HTMLElement;
  private readonly hudLine1: HTMLSpanElement;
  private readonly hudSpeedSpan: HTMLSpanElement;
  private readonly hudPhraseSpan: HTMLSpanElement;
  private readonly hudPovBtn: HTMLButtonElement;

  constructor(container: HTMLElement, onPovToggle: () => void) {
    this.hud = document.createElement('div');
    this.hud.id = 'creature-inspector';
    this.hud.setAttribute('aria-live', 'polite');
    this.hud.style.display = 'none';

    this.hudLine1 = document.createElement('span');
    this.hudSpeedSpan = document.createElement('span');
    this.hudSpeedSpan.className = 'hud-speed';
    this.hudPhraseSpan = document.createElement('span');
    this.hud.appendChild(this.hudLine1);
    this.hud.appendChild(document.createTextNode('\n'));
    this.hud.appendChild(this.hudSpeedSpan);
    this.hud.appendChild(document.createTextNode(' · '));
    this.hud.appendChild(this.hudPhraseSpan);

    this.hudPovBtn = document.createElement('button');
    this.hudPovBtn.className = 'hud-pov-btn';
    this.hudPovBtn.textContent = 'Enter POV';
    this.hudPovBtn.addEventListener('click', onPovToggle);
    this.hud.appendChild(document.createTextNode('\n'));
    this.hud.appendChild(this.hudPovBtn);

    container.appendChild(this.hud);
  }

  show(): void {
    this.hud.style.display = 'block';
  }

  hide(): void {
    this.hud.style.display = 'none';
  }

  setPovButtonText(text: string): void {
    this.hudPovBtn.textContent = text;
  }

  sync(entity: Boid | Predator, isPredator: boolean, renderer3D: Renderer3D): void {
    const labels = renderer3D.getCreatureLabels();
    const v = entity.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

    let speciesLabel: string;
    let category: CreatureStatusCategory;

    if (isPredator) {
      const pred = entity as Predator;
      speciesLabel = labels.predator[pred.species] ?? pred.species;
      category = pred.digesting ? 'digesting' : pred.huntIntensity > 0.5 ? 'hunting' : 'searching';
    } else {
      const boid = entity as Boid;
      speciesLabel = labels.boid[boid.species] ?? boid.species;
      category = boid.panicLevel > 0.5 ? 'fleeing' : 'flocking';
    }

    this.show();
    this.hudLine1.textContent = speciesLabel;
    this.hudSpeedSpan.textContent = `${Math.round(speed)} u/s`;
    this.hudPhraseSpan.textContent = pickStatusPhrase(category, entity.id, performance.now());
  }
}

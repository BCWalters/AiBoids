// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CreatureHud } from './CreatureHud';
import { pickStatusPhrase } from './creatureStatusPhrases';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import type { Renderer3D } from './Renderer3D';

function makeRenderer(labels?: {
  boid?: Record<string, string>;
  predator?: Record<string, string>;
}): Renderer3D {
  return {
    getCreatureLabels: () => ({
      boid: labels?.boid ?? {},
      predator: labels?.predator ?? {},
    }),
  } as unknown as Renderer3D;
}

describe('CreatureHud', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('creates the #creature-inspector HUD with identical base structure', () => {
    new CreatureHud(container, vi.fn());

    const hud = container.querySelector('#creature-inspector') as HTMLElement;
    expect(hud).toBeTruthy();
    expect(hud.getAttribute('aria-live')).toBe('polite');
    expect(hud.style.display).toBe('none');

    const speed = hud.querySelector('.hud-speed') as HTMLSpanElement;
    const btn = hud.querySelector('.hud-pov-btn') as HTMLButtonElement;
    expect(speed).toBeTruthy();
    expect(btn.textContent).toBe('Enter POV');
    expect(hud.childNodes).toHaveLength(7);
  });

  it('sync() shows boid species, rounded speed, and flocking phrase', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const hud = new CreatureHud(container, vi.fn());
    const renderer = makeRenderer({ boid: { normal: 'Starling' } });
    const boid = {
      id: 7,
      species: 'normal',
      panicLevel: 0,
      velocity: { x: 3, y: 4, z: 0 },
      position: { x: 0, y: 0, z: 0 },
      renderHeading: { x: 0, y: 0, z: -1 },
    } as unknown as Boid;

    hud.sync(boid, false, renderer);

    const panel = container.querySelector('#creature-inspector') as HTMLElement;
    const line1 = panel.querySelector('span') as HTMLSpanElement;
    const speed = panel.querySelector('.hud-speed') as HTMLSpanElement;
    expect(panel.style.display).toBe('block');
    expect(line1.textContent).toBe('Starling');
    expect(speed.textContent).toBe('5 u/s');
    expect(panel.textContent).toContain(pickStatusPhrase('flocking', boid.id, nowSpy.mock.results[0].value as number));
  });

  it('sync() uses predator labels and digesting category phrases', () => {
    vi.spyOn(performance, 'now').mockReturnValue(5_000);
    const hud = new CreatureHud(container, vi.fn());
    const renderer = makeRenderer({ predator: { shark: 'Reef Shark' } });
    const predator = {
      id: 9,
      species: 'shark',
      digesting: true,
      huntIntensity: 1,
      velocity: { x: 0, y: 0, z: 8 },
      position: { x: 0, y: 0, z: 0 },
      renderHeading: { x: 0, y: 0, z: -1 },
    } as unknown as Predator;

    hud.sync(predator, true, renderer);

    const panel = container.querySelector('#creature-inspector') as HTMLElement;
    expect(panel.textContent).toContain('Reef Shark');
    expect(panel.textContent).toContain('8 u/s');
    expect(panel.textContent).toContain(pickStatusPhrase('digesting', predator.id, 5_000));
  });

  it('hide() and setPovButtonText() preserve visibility and button behavior', () => {
    const onToggle = vi.fn();
    const hud = new CreatureHud(container, onToggle);

    hud.setPovButtonText('Exit POV (Esc)');
    const btn = container.querySelector('.hud-pov-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Exit POV (Esc)');

    btn.click();
    expect(onToggle).toHaveBeenCalledOnce();

    hud.hide();
    const panel = container.querySelector('#creature-inspector') as HTMLElement;
    expect(panel.style.display).toBe('none');
  });
});

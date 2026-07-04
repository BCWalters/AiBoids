import './style.css';
import { Simulation } from './sim/Simulation';
import { Renderer } from './render/Renderer';
import { ControlPanel } from './ui/ControlPanel';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
const controlPanelBody = document.querySelector<HTMLElement>('#control-panel-body')!;

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
  sim.resize(canvas.width, canvas.height);
}

const sim = new Simulation(canvas.clientWidth || 800, canvas.clientHeight || 600);
const renderer = new Renderer(canvas);
new ControlPanel(controlPanelBody, sim);

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 1 / 20); // clamp dt to avoid big jumps on tab-away
  lastTime = now;

  sim.update(dt);
  renderer.render(sim);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

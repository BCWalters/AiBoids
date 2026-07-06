import './style.css';
import { Simulation } from './sim/Simulation';
import { Renderer } from './render/Renderer';
import { Renderer3D } from './render/Renderer3D';
import { ControlPanel } from './ui/ControlPanel';
import { params, type SimMode } from './sim/params';

const canvas2D = document.querySelector<HTMLCanvasElement>('#sim-canvas-2d')!;
const canvas3D = document.querySelector<HTMLCanvasElement>('#sim-canvas-3d')!;
const controlPanelBody = document.querySelector<HTMLElement>('#control-panel-body')!;
const canvasStack = document.querySelector<HTMLElement>('#canvas-stack')!;

const sim = new Simulation(canvas2D.clientWidth || 800, canvas2D.clientHeight || 600);

let renderer2D: Renderer | null = null;
let renderer3D: Renderer3D | null = null;

function applyMode(mode: SimMode): void {
  canvas2D.classList.toggle('active', mode === '2d');
  canvas3D.classList.toggle('active', mode === '3d');

  if (mode === '3d') {
    if (!renderer3D) renderer3D = new Renderer3D(canvas3D);
    (window as unknown as { __debugRenderer3D: unknown }).__debugRenderer3D = renderer3D;
  } else {
    if (!renderer2D) renderer2D = new Renderer(canvas2D);
  }
  resizeCanvases();
}

function resizeCanvases(): void {
  const rect = canvasStack.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  canvas2D.width = width;
  canvas2D.height = height;
  renderer3D?.resize(width, height);

  sim.resize(width, height);
}

const controlPanel = new ControlPanel(controlPanelBody, sim, applyMode);
applyMode(params.mode);

window.addEventListener('resize', resizeCanvases);

let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 1 / 20); // clamp dt to avoid big jumps on tab-away
  lastTime = now;

  sim.update(dt);
  controlPanel.syncAlienInvasionButton();
  controlPanel.syncRespawnButton();

  if (params.mode === '3d') {
    renderer3D?.render(sim);
  } else {
    renderer2D?.render(sim);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

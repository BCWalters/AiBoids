import { params } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

const BOID_LENGTH = 9;
const BOID_WIDTH = 5;
const PREDATOR_LENGTH = 15;
const PREDATOR_WIDTH = 9;

const BG_COLOR: [number, number, number] = [13, 17, 23]; // #0d1117

// Base (calm) vs. highlight (state) colors, lerped by panicLevel/huntIntensity.
const BOID_BASE: [number, number, number] = [90, 209, 255]; // #5ad1ff
const BOID_PANIC: [number, number, number] = [255, 224, 102]; // warm alarm yellow
const PREDATOR_BASE: [number, number, number] = [255, 90, 90]; // #ff5a5a
const PREDATOR_HUNT: [number, number, number] = [255, 255, 255]; // hot white lock-on flash

// Cartoony blood-splatter particle burst spawned wherever a predator
// catches a boid (see Simulation.catchEvents). Purely a client-side
// visual effect — the sim only records where/when a catch happened.
const SPLATTER_DURATION = 0.5;
const SPLATTER_PARTICLES = 10;

interface Splatter {
  x: number;
  y: number;
  elapsed: number;
  particles: { dx: number; dy: number; r: number }[];
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * clamped);
  const g = Math.round(a[1] + (b[1] - a[1]) * clamped);
  const bl = Math.round(a[2] + (b[2] - a[2]) * clamped);
  return `rgb(${r}, ${g}, ${bl})`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private splatters: Splatter[] = [];
  private lastSeenCatchId = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
  }

  private drawTriangle(x: number, y: number, angle: number, length: number, width: number, fill: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(length / 2, 0);
    ctx.lineTo(-length / 2, width / 2);
    ctx.lineTo(-length / 2, -width / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  private spawnSplattersFromCatches(sim: Simulation): void {
    for (const catchEvent of sim.catchEvents) {
      if (catchEvent.id <= this.lastSeenCatchId) continue;
      this.lastSeenCatchId = catchEvent.id;
      const particles = [];
      for (let i = 0; i < SPLATTER_PARTICLES; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 4 + Math.random() * 14;
        particles.push({ dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, r: 1.5 + Math.random() * 2.5 });
      }
      this.splatters.push({ x: catchEvent.position.x, y: catchEvent.position.y, elapsed: 0, particles });
    }
  }

  private updateAndDrawSplatters(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.splatters.length - 1; i >= 0; i--) {
      const splatter = this.splatters[i];
      splatter.elapsed += dt;
      if (splatter.elapsed >= SPLATTER_DURATION) {
        this.splatters.splice(i, 1);
        continue;
      }
      const t = splatter.elapsed / SPLATTER_DURATION;
      const alpha = 1 - t;
      const spread = 1 + t * 1.5; // particles drift outward as they fade
      ctx.fillStyle = `rgba(214, 40, 40, ${alpha})`;
      for (const particle of splatter.particles) {
        ctx.beginPath();
        ctx.arc(splatter.x + particle.dx * spread, splatter.y + particle.dy * spread, particle.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  render(sim: Simulation): void {
    const ctx = this.ctx;

    // Instead of a hard clear, paint a translucent background overlay each
    // frame: previous frames fade rather than vanish instantly, producing
    // motion trails. trailAmount=0 behaves like a normal hard clear.
    const alpha = 1 - Math.max(0, Math.min(0.97, params.trailAmount));
    ctx.fillStyle = `rgba(${BG_COLOR[0]}, ${BG_COLOR[1]}, ${BG_COLOR[2]}, ${alpha})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (params.showDebugOverlay) {
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.15)';
      for (const boid of sim.boids) {
        ctx.beginPath();
        ctx.arc(boid.position.x, boid.position.y, params.perceptionRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.2)';
      for (const predator of sim.predators) {
        ctx.beginPath();
        ctx.arc(predator.position.x, predator.position.y, params.panicRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const boid of sim.boids) {
      if (boid.scale <= 0) continue;
      this.drawTriangle(
        boid.position.x,
        boid.position.y,
        boid.headingAngle,
        BOID_LENGTH * boid.scale,
        BOID_WIDTH * boid.scale,
        lerpColor(BOID_BASE, BOID_PANIC, boid.panicLevel),
      );
    }

    for (const predator of sim.predators) {
      this.drawTriangle(
        predator.position.x,
        predator.position.y,
        predator.headingAngle,
        PREDATOR_LENGTH,
        PREDATOR_WIDTH,
        lerpColor(PREDATOR_BASE, PREDATOR_HUNT, predator.huntIntensity),
      );
    }

    this.spawnSplattersFromCatches(sim);
    // A rough per-frame dt estimate is good enough for a purely cosmetic,
    // half-second particle fade — no need to thread the sim's real dt
    // through the render() call just for this.
    this.updateAndDrawSplatters(1 / 60);
  }
}

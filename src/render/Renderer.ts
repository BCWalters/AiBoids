import { params } from '../sim/params';
import type { Simulation } from '../sim/Simulation';

const BOID_LENGTH = 9;
const BOID_WIDTH = 5;
const PREDATOR_LENGTH = 15;
const PREDATOR_WIDTH = 9;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

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

  render(sim: Simulation): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#0d1117';
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
      this.drawTriangle(
        boid.position.x,
        boid.position.y,
        boid.headingAngle,
        BOID_LENGTH,
        BOID_WIDTH,
        '#5ad1ff',
      );
    }

    for (const predator of sim.predators) {
      this.drawTriangle(
        predator.position.x,
        predator.position.y,
        predator.headingAngle,
        PREDATOR_LENGTH,
        PREDATOR_WIDTH,
        '#ff5a5a',
      );
    }
  }
}

import { params, resetParams } from '../sim/params';
import { Simulation } from '../sim/Simulation';
import { nearWallAxisCount, type WorldBounds } from '../sim/boundary';

function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

interface PerFace { xMin:number;xMax:number;yMin:number;yMax:number;zMin:number;zMax:number;total:number;frames:number; }
function newFace(): PerFace { return { xMin:0,xMax:0,yMin:0,yMax:0,zMin:0,zMax:0,total:0,frames:0 }; }

function addFace(pos:{x:number;y:number;z:number}, b: WorldBounds, m: number, o: PerFace): void {
  o.frames++;
  const xMin=pos.x<m, xMax=pos.x>b.width-m, yMin=pos.y<m, yMax=pos.y>b.height-m, zMin=pos.z<m, zMax=pos.z>b.depth-m;
  if(xMin)o.xMin++; if(xMax)o.xMax++; if(yMin)o.yMin++; if(yMax)o.yMax++; if(zMin)o.zMin++; if(zMax)o.zMax++;
  if(xMin||xMax||yMin||yMax||zMin||zMax) o.total++;
}

let totalPred = newFace(), totalBoid = newFace();
const seeds = [1,2,3,4,5,6,7,8];
const W=1000, H=1000, seconds=60;

for (const seed of seeds) {
  seedRandom(seed);
  resetParams();
  params.mode = '3d';
  params.boidCount = 60;
  params.predatorCount = 3;
  params.monsterCount = 1;
  params.horseCount = params.multicolorCount = params.goldCount = params.redCount = params.blueCount = 0;
  params.predatorCatchEnabled = false;

  const sim = new Simulation(W, H);
  const bounds: WorldBounds = { width: W, height: H, depth: params.worldDepth };
  const m = params.boundaryMargin;
  const predOcc = newFace(), boidOcc = newFace();

  const dt = 1/60, steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.update(dt);
    for (const p of sim.predators) addFace(p.position, bounds, m, predOcc);
    for (const b of sim.boids) addFace(b.position, bounds, m, boidOcc);
  }
  // Accumulate
  for (const k of ['xMin','xMax','yMin','yMax','zMin','zMax','total','frames'] as const) {
    totalPred[k] += predOcc[k];
    totalBoid[k] += boidOcc[k];
  }
  const pPct = (n:number) => ((n/predOcc.frames)*100).toFixed(1)+'%';
  console.log(`seed=${seed}: predANY=${pPct(predOcc.total)} [yMin=${pPct(predOcc.yMin)} yMax=${pPct(predOcc.yMax)} xMin=${pPct(predOcc.xMin)} xMax=${pPct(predOcc.xMax)} zMin=${pPct(predOcc.zMin)} zMax=${pPct(predOcc.zMax)}]  boidANY=${((boidOcc.total/boidOcc.frames)*100).toFixed(1)}%`);
}

const f = totalPred.frames;
const p = (n:number) => ((n/f)*100).toFixed(1)+'%';
console.log(`\nAGGREGATE (8 seeds x 60s, 1000x1000):`);
console.log(`Predator ANY wall: ${p(totalPred.total)}`);
console.log(`  y=0 (floor): ${p(totalPred.yMin)}   y=H (ceil): ${p(totalPred.yMax)}`);
console.log(`  x=0:         ${p(totalPred.xMin)}   x=W:        ${p(totalPred.xMax)}`);
console.log(`  z=0:         ${p(totalPred.zMin)}   z=D:        ${p(totalPred.zMax)}`);
const bf = totalBoid.frames;
const bp = (n:number) => ((n/bf)*100).toFixed(1)+'%';
console.log(`Boid ANY wall: ${bp(totalBoid.total)}`);
console.log(`  y=0: ${bp(totalBoid.yMin)}   y=H: ${bp(totalBoid.yMax)}   x=0: ${bp(totalBoid.xMin)}   x=W: ${bp(totalBoid.xMax)}   z=0: ${bp(totalBoid.zMin)}   z=D: ${bp(totalBoid.zMax)}`);

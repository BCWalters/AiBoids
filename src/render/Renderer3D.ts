import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { params } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import { createBirdGeometries, type BirdGeometries } from './birdGeometry';

// Bright, saturated emissive colors so the bloom pass has something to
// glow — the base MeshStandardMaterial color intentionally stays dim so
// contrast against the dark background comes mostly from emissive light.
const BOID_COLOR = new THREE.Color(0x2ab6e8);
const BOID_EMISSIVE = new THREE.Color(0x5ad1ff);
const PREDATOR_COLOR = new THREE.Color(0xb31f1f);
const PREDATOR_EMISSIVE = new THREE.Color(0xff2a2a);

const BOID_LENGTH = 7;
const BOID_WIDTH = 2.6;
const PREDATOR_LENGTH = 12;
const PREDATOR_WIDTH = 4.4;

// Wing-flap tuning: base idle flutter plus extra amplitude proportional to
// how fast the entity is currently moving (relative to its own max speed).
const FLAP_FREQUENCY = 9; // radians/sec-ish; controls flap speed
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.9;

// Three.js cones/octahedra point along +Y by default; that's the "forward"
// direction we rotate onto each entity's velocity vector.
const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);

interface BirdInstanceSet {
  body: THREE.InstancedMesh;
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private boidGeometries: BirdGeometries;
  private predatorGeometries: BirdGeometries;
  private boidInstances: BirdInstanceSet | null = null;
  private predatorInstances: BirdInstanceSet | null = null;
  private boundsHelper: THREE.LineSegments | null = null;

  private dummy = new THREE.Object3D();
  private bodyQuat = new THREE.Quaternion();
  private flapQuat = new THREE.Quaternion();
  private startTime = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(1, 1, 1);
    this.scene.add(ambient, directional);

    this.boidGeometries = createBirdGeometries(BOID_LENGTH, BOID_WIDTH);
    this.predatorGeometries = createBirdGeometries(PREDATOR_LENGTH, PREDATOR_WIDTH);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.4, 0.15);
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());
  }

  private buildInstanceSet(geometries: BirdGeometries, color: THREE.Color, emissive: THREE.Color, count: number): BirdInstanceSet {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1.4 });
    const wingMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 1.1,
      side: THREE.DoubleSide,
    });

    const body = new THREE.InstancedMesh(geometries.body, bodyMaterial, Math.max(count, 1));
    const wingLeft = new THREE.InstancedMesh(geometries.wingLeft, wingMaterial, Math.max(count, 1));
    const wingRight = new THREE.InstancedMesh(geometries.wingRight, wingMaterial.clone(), Math.max(count, 1));
    body.count = count;
    wingLeft.count = count;
    wingRight.count = count;

    this.scene.add(body, wingLeft, wingRight);
    return { body, wingLeft, wingRight };
  }

  private disposeInstanceSet(set: BirdInstanceSet | null): void {
    if (!set) return;
    for (const mesh of [set.body, set.wingLeft, set.wingRight]) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** Recreates instanced meshes and world-bounds wireframe when population or world size changes. */
  private ensureScene(sim: Simulation): void {
    const boidCount = sim.boids.length;
    const predatorCount = sim.predators.length;

    if (!this.boidInstances || this.boidInstances.body.count !== boidCount) {
      this.disposeInstanceSet(this.boidInstances);
      this.boidInstances = this.buildInstanceSet(this.boidGeometries, BOID_COLOR, BOID_EMISSIVE, boidCount);
    }

    if (!this.predatorInstances || this.predatorInstances.body.count !== predatorCount) {
      this.disposeInstanceSet(this.predatorInstances);
      this.predatorInstances = this.buildInstanceSet(
        this.predatorGeometries,
        PREDATOR_COLOR,
        PREDATOR_EMISSIVE,
        predatorCount,
      );
    }

    const expectedKey = `${sim.width}x${sim.height}x${params.worldDepth}`;
    if (this.boundsHelper?.userData.key !== expectedKey) {
      if (this.boundsHelper) {
        this.scene.remove(this.boundsHelper);
        this.boundsHelper.geometry.dispose();
        (this.boundsHelper.material as THREE.Material).dispose();
      }
      const box = new THREE.BoxGeometry(sim.width, sim.height, params.worldDepth);
      const edges = new THREE.EdgesGeometry(box);
      const material = new THREE.LineBasicMaterial({ color: 0x30363d });
      this.boundsHelper = new THREE.LineSegments(edges, material);
      this.boundsHelper.position.set(sim.width / 2, sim.height / 2, params.worldDepth / 2);
      this.boundsHelper.userData.key = expectedKey;
      this.scene.add(this.boundsHelper);
      box.dispose();

      // Frame the camera around the world box the first time we see it (or
      // whenever its size changes), centered on the box with orbit target there.
      const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
      const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
      this.camera.position.set(center.x + maxDim * 0.6, center.y + maxDim * 0.4, center.z + maxDim * 0.9);
      this.controls.target.copy(center);
      this.controls.update();
    }
  }

  private updateInstances(
    set: BirdInstanceSet,
    entities: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
  ): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const pos = entity.position;
      const vel = entity.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

      if (speed > 1e-6) {
        const dir = new THREE.Vector3(vel.x, vel.y, vel.z).multiplyScalar(1 / speed);
        this.bodyQuat.setFromUnitVectors(FORWARD_AXIS, dir);
      }

      // Body: just position + orientation, no flap.
      this.dummy.position.set(pos.x, pos.y, pos.z);
      this.dummy.quaternion.copy(this.bodyQuat);
      this.dummy.updateMatrix();
      set.body.setMatrixAt(i, this.dummy.matrix);

      // Wings: apply an extra local flap rotation around the forward axis
      // before combining with the shared body orientation, so both wings
      // swing up/down in sync regardless of which way the bird is heading.
      const speedFrac = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
      const amplitude = FLAP_IDLE_AMPLITUDE + FLAP_SPEED_AMPLITUDE * speedFrac;
      const phase = elapsed * FLAP_FREQUENCY + entity.id * 1.7;
      const flapAngle = amplitude * Math.sin(phase);

      this.flapQuat.setFromAxisAngle(FORWARD_AXIS, flapAngle);
      this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
      this.dummy.updateMatrix();
      set.wingLeft.setMatrixAt(i, this.dummy.matrix);

      this.flapQuat.setFromAxisAngle(FORWARD_AXIS, -flapAngle);
      this.dummy.quaternion.copy(this.bodyQuat).multiply(this.flapQuat);
      this.dummy.updateMatrix();
      set.wingRight.setMatrixAt(i, this.dummy.matrix);
    }

    set.body.instanceMatrix.needsUpdate = true;
    set.wingLeft.instanceMatrix.needsUpdate = true;
    set.wingRight.instanceMatrix.needsUpdate = true;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(sim: Simulation): void {
    this.ensureScene(sim);
    const elapsed = (performance.now() - this.startTime) / 1000;

    if (this.boidInstances) this.updateInstances(this.boidInstances, sim.boids, params.boidMaxSpeed, elapsed);
    if (this.predatorInstances) {
      this.updateInstances(this.predatorInstances, sim.predators, params.predatorMaxSpeed, elapsed);
    }

    this.controls.update();
    this.composer.render();
  }

  dispose(): void {
    this.disposeInstanceSet(this.boidInstances);
    this.disposeInstanceSet(this.predatorInstances);
    this.boidGeometries.body.dispose();
    this.boidGeometries.wingLeft.dispose();
    this.boidGeometries.wingRight.dispose();
    this.predatorGeometries.body.dispose();
    this.predatorGeometries.wingLeft.dispose();
    this.predatorGeometries.wingRight.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

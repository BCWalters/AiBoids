import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { params } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';

const BOID_COLOR = 0x5ad1ff;
const PREDATOR_COLOR = 0xff5a5a;
const BOID_SIZE = 6;
const PREDATOR_SIZE = 10;

// Three.js cones point along +Y by default; boid/predator velocity vectors
// are the "forward" direction we need to rotate that default axis onto.
const DEFAULT_UP = new THREE.Vector3(0, 1, 0);

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private boidMesh: THREE.InstancedMesh | null = null;
  private predatorMesh: THREE.InstancedMesh | null = null;
  private boundsHelper: THREE.LineSegments | null = null;
  private dummy = new THREE.Object3D();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(1, 1, 1);
    this.scene.add(ambient, directional);
  }

  /** Recreates instanced meshes and world-bounds wireframe when population or world size changes. */
  private ensureScene(sim: Simulation): void {
    const boidCount = sim.boids.length;
    const predatorCount = sim.predators.length;

    if (!this.boidMesh || this.boidMesh.count !== boidCount) {
      if (this.boidMesh) {
        this.scene.remove(this.boidMesh);
        this.boidMesh.geometry.dispose();
        (this.boidMesh.material as THREE.Material).dispose();
      }
      const geometry = new THREE.ConeGeometry(BOID_SIZE / 2, BOID_SIZE * 1.8, 8);
      const material = new THREE.MeshStandardMaterial({ color: BOID_COLOR });
      this.boidMesh = new THREE.InstancedMesh(geometry, material, Math.max(boidCount, 1));
      this.boidMesh.count = boidCount;
      this.scene.add(this.boidMesh);
    }

    if (!this.predatorMesh || this.predatorMesh.count !== predatorCount) {
      if (this.predatorMesh) {
        this.scene.remove(this.predatorMesh);
        this.predatorMesh.geometry.dispose();
        (this.predatorMesh.material as THREE.Material).dispose();
      }
      const geometry = new THREE.ConeGeometry(PREDATOR_SIZE / 2, PREDATOR_SIZE * 1.8, 8);
      const material = new THREE.MeshStandardMaterial({ color: PREDATOR_COLOR });
      this.predatorMesh = new THREE.InstancedMesh(geometry, material, Math.max(predatorCount, 1));
      this.predatorMesh.count = predatorCount;
      this.scene.add(this.predatorMesh);
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

  private updateInstances(mesh: THREE.InstancedMesh, entities: (Boid | Predator)[]): void {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      this.dummy.position.set(entity.position.x, entity.position.y, entity.position.z);

      const dir = new THREE.Vector3(entity.velocity.x, entity.velocity.y, entity.velocity.z);
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        this.dummy.quaternion.setFromUnitVectors(DEFAULT_UP, dir);
      }

      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(sim: Simulation): void {
    this.ensureScene(sim);
    if (this.boidMesh) this.updateInstances(this.boidMesh, sim.boids);
    if (this.predatorMesh) this.updateInstances(this.predatorMesh, sim.predators);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

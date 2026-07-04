import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { params, type VisualStyle } from '../sim/params';
import type { Simulation } from '../sim/Simulation';
import type { Boid } from '../sim/Boid';
import type { Predator } from '../sim/Predator';
import { createBirdGeometries, createRealisticBirdGeometries, type BirdGeometries } from './birdGeometry';
import { createNatureEnvironment, placeNatureEnvironment, type NatureEnvironment } from './environment';
import { createDriftingClouds, type DriftingClouds } from './clouds';

// --- "Arcade" style: bright, saturated emissive colors so the bloom pass
// has something to glow — base material color stays neutral (driven
// per-instance) so contrast against the dark background comes mostly
// from emissive light.
const ARCADE_BOID_EMISSIVE = new THREE.Color(0x5ad1ff);
const ARCADE_PREDATOR_EMISSIVE = new THREE.Color(0xff2a2a);
const ARCADE_BOID_BASE = new THREE.Color(0x2ab6e8);
const ARCADE_BOID_PANIC = new THREE.Color(0xffe066);
const ARCADE_PREDATOR_BASE = new THREE.Color(0xb31f1f);
const ARCADE_PREDATOR_HUNT = new THREE.Color(0xffffff);

// --- "Nature" style: matte, earth-toned plumage. No emissive glow —
// contrast comes from the sun-lit sky/ground environment instead.
const NATURE_BOID_BASE = new THREE.Color(0xab8f68); // sandy tan-brown, contrasts against green ground
const NATURE_BOID_PANIC = new THREE.Color(0xf2e6c8); // paler alarm plumage
const NATURE_PREDATOR_BASE = new THREE.Color(0x7a3b22); // hawk rust-brown
const NATURE_PREDATOR_HUNT = new THREE.Color(0xc75a2e); // brighter when locked on

const BOID_LENGTH = 7;
const BOID_WIDTH = 2.6;
const PREDATOR_LENGTH = 12;
const PREDATOR_WIDTH = 4.4;

// Wing-flap tuning: base idle flutter plus extra amplitude proportional to
// how fast the entity is currently moving (relative to its own max speed).
const FLAP_FREQUENCY = 9; // radians/sec-ish; controls flap speed
const FLAP_IDLE_AMPLITUDE = 0.25;
const FLAP_SPEED_AMPLITUDE = 0.9;

// Three.js cones/octahedra/lathes point along +Y by default; that's the
// "forward" direction we rotate onto each entity's velocity vector.
const FORWARD_AXIS = new THREE.Vector3(0, 1, 0);

interface BirdInstanceSet {
  body: THREE.InstancedMesh;
  wingLeft: THREE.InstancedMesh;
  wingRight: THREE.InstancedMesh;
  tail?: THREE.InstancedMesh;
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private afterimagePass: AfterimagePass;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private natureEnv: NatureEnvironment;
  private driftingClouds: DriftingClouds;

  private arcadeBoidGeometries: BirdGeometries;
  private arcadePredatorGeometries: BirdGeometries;
  private natureBoidGeometries: BirdGeometries;
  private naturePredatorGeometries: BirdGeometries;

  private boidInstances: BirdInstanceSet | null = null;
  private predatorInstances: BirdInstanceSet | null = null;
  private boidInstancesKey: string | null = null;
  private predatorInstancesKey: string | null = null;
  private boundsHelper: THREE.LineSegments | null = null;
  private currentStyle: VisualStyle | null = null;

  private dummy = new THREE.Object3D();
  private bodyQuat = new THREE.Quaternion();
  private flapQuat = new THREE.Quaternion();
  private stateColor = new THREE.Color();
  private startTime = performance.now();
  private lastElapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // ACES tone mapping keeps the physically-based Sky shader from blowing
    // out to solid white and gives the nature-style earth tones more depth.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    // Far plane large enough to contain the nature sky dome (scaled 20000).
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.keyLight.position.set(1, 1, 1);
    this.scene.add(this.ambientLight, this.keyLight);

    this.natureEnv = createNatureEnvironment(this.scene);
    this.driftingClouds = createDriftingClouds(this.scene);

    this.arcadeBoidGeometries = createBirdGeometries(BOID_LENGTH, BOID_WIDTH);
    this.arcadePredatorGeometries = createBirdGeometries(PREDATOR_LENGTH, PREDATOR_WIDTH);
    // The lathed "nature" body/wings have noticeably less surface area per
    // unit width/length than the arcade octahedron+flat-triangle shapes, so
    // scale them up to read clearly at the same viewing distance.
    this.natureBoidGeometries = createRealisticBirdGeometries(BOID_LENGTH * 1.3, BOID_WIDTH * 2.4);
    this.naturePredatorGeometries = createRealisticBirdGeometries(PREDATOR_LENGTH * 1.3, PREDATOR_WIDTH * 2.4);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.afterimagePass = new AfterimagePass();
    this.composer.addPass(this.afterimagePass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.4, 0.15);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  private buildInstanceSet(geometries: BirdGeometries, style: VisualStyle, emissive: THREE.Color, count: number): BirdInstanceSet {
    // Diffuse color starts white; the actual visible tint is driven entirely
    // per-instance via setColorAt in updateInstances (base <-> state color).
    const isNature = style === 'nature';
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: isNature ? 0x000000 : emissive,
      emissiveIntensity: isNature ? 0 : 1.4,
      roughness: isNature ? 0.9 : 0.5,
      metalness: 0,
    });
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: isNature ? 0x000000 : emissive,
      emissiveIntensity: isNature ? 0 : 1.1,
      roughness: isNature ? 0.9 : 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const body = new THREE.InstancedMesh(geometries.body, bodyMaterial, Math.max(count, 1));
    const wingLeft = new THREE.InstancedMesh(geometries.wingLeft, wingMaterial, Math.max(count, 1));
    const wingRight = new THREE.InstancedMesh(geometries.wingRight, wingMaterial.clone(), Math.max(count, 1));
    body.count = count;
    wingLeft.count = count;
    wingRight.count = count;
    this.scene.add(body, wingLeft, wingRight);

    let tail: THREE.InstancedMesh | undefined;
    if (geometries.tail) {
      const tailMaterial = wingMaterial.clone();
      tail = new THREE.InstancedMesh(geometries.tail, tailMaterial, Math.max(count, 1));
      tail.count = count;
      this.scene.add(tail);
    }

    return { body, wingLeft, wingRight, tail };
  }

  private disposeInstanceSet(set: BirdInstanceSet | null): void {
    if (!set) return;
    const meshes = [set.body, set.wingLeft, set.wingRight, ...(set.tail ? [set.tail] : [])];
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
  }

  /** Recreates instanced meshes, environment, and world-bounds wireframe as population/world/style change. */
  private ensureScene(sim: Simulation): void {
    const style = params.visualStyle;
    const boidCount = sim.boids.length;
    const predatorCount = sim.predators.length;

    const boidKey = `${boidCount}:${style}`;
    if (this.boidInstancesKey !== boidKey) {
      this.disposeInstanceSet(this.boidInstances);
      const geometries = style === 'nature' ? this.natureBoidGeometries : this.arcadeBoidGeometries;
      this.boidInstances = this.buildInstanceSet(geometries, style, ARCADE_BOID_EMISSIVE, boidCount);
      this.boidInstancesKey = boidKey;
    }

    const predatorKey = `${predatorCount}:${style}`;
    if (this.predatorInstancesKey !== predatorKey) {
      this.disposeInstanceSet(this.predatorInstances);
      const geometries = style === 'nature' ? this.naturePredatorGeometries : this.arcadePredatorGeometries;
      this.predatorInstances = this.buildInstanceSet(geometries, style, ARCADE_PREDATOR_EMISSIVE, predatorCount);
      this.predatorInstancesKey = predatorKey;
    }

    if (this.currentStyle !== style) {
      this.currentStyle = style;
      const isNature = style === 'nature';
      this.bloomPass.enabled = !isNature;
      this.natureEnv.setVisible(isNature);
      this.driftingClouds.setVisible(isNature);
      if (this.boundsHelper) this.boundsHelper.visible = !isNature;
      this.ambientLight.intensity = isNature ? 0.55 : 0.35;
      this.keyLight.visible = !isNature;
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
      this.boundsHelper.visible = params.visualStyle !== 'nature';
      this.scene.add(this.boundsHelper);
      box.dispose();

      // Frame the camera around the world box the first time we see it (or
      // whenever its size changes), centered on the box with orbit target there.
      const center = new THREE.Vector3(sim.width / 2, sim.height / 2, params.worldDepth / 2);
      const maxDim = Math.max(sim.width, sim.height, params.worldDepth);
      this.camera.position.set(center.x + maxDim * 0.6, center.y + maxDim * 0.4, center.z + maxDim * 0.9);
      this.controls.target.copy(center);
      this.controls.update();

      placeNatureEnvironment(this.natureEnv, center, maxDim * 30);
      this.driftingClouds.configure(center, maxDim);
    }
  }

  private updateInstances(
    set: BirdInstanceSet,
    entities: (Boid | Predator)[],
    maxSpeed: number,
    elapsed: number,
    baseColor: THREE.Color,
    highlightColor: THREE.Color,
    getIntensity: (entity: Boid | Predator) => number,
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
      if (set.tail) set.tail.setMatrixAt(i, this.dummy.matrix);

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

      // Color-by-state: lerp toward the highlight color as intensity rises.
      this.stateColor.copy(baseColor).lerp(highlightColor, getIntensity(entity));
      set.body.setColorAt(i, this.stateColor);
      set.wingLeft.setColorAt(i, this.stateColor);
      set.wingRight.setColorAt(i, this.stateColor);
      if (set.tail) set.tail.setColorAt(i, this.stateColor);
    }

    set.body.instanceMatrix.needsUpdate = true;
    set.wingLeft.instanceMatrix.needsUpdate = true;
    set.wingRight.instanceMatrix.needsUpdate = true;
    if (set.body.instanceColor) set.body.instanceColor.needsUpdate = true;
    if (set.wingLeft.instanceColor) set.wingLeft.instanceColor.needsUpdate = true;
    if (set.wingRight.instanceColor) set.wingRight.instanceColor.needsUpdate = true;
    if (set.tail) {
      set.tail.instanceMatrix.needsUpdate = true;
      if (set.tail.instanceColor) set.tail.instanceColor.needsUpdate = true;
    }
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
    const dt = Math.max(0, Math.min(elapsed - this.lastElapsed, 1 / 20));
    this.lastElapsed = elapsed;
    const isNature = params.visualStyle === 'nature';

    // AfterimagePass's damp uniform controls how strongly the previous
    // frame persists — same trailAmount knob used by the 2D renderer.
    this.afterimagePass.uniforms.damp.value = Math.max(0, Math.min(0.96, params.trailAmount));
    this.natureEnv.update(elapsed);
    this.driftingClouds.update(dt);

    if (this.boidInstances) {
      this.updateInstances(
        this.boidInstances,
        sim.boids,
        params.boidMaxSpeed,
        elapsed,
        isNature ? NATURE_BOID_BASE : ARCADE_BOID_BASE,
        isNature ? NATURE_BOID_PANIC : ARCADE_BOID_PANIC,
        (entity) => (entity as Boid).panicLevel,
      );
    }
    if (this.predatorInstances) {
      this.updateInstances(
        this.predatorInstances,
        sim.predators,
        params.predatorMaxSpeed,
        elapsed,
        isNature ? NATURE_PREDATOR_BASE : ARCADE_PREDATOR_BASE,
        isNature ? NATURE_PREDATOR_HUNT : ARCADE_PREDATOR_HUNT,
        (entity) => (entity as Predator).huntIntensity,
      );
    }

    this.controls.update();
    this.composer.render();
  }

  dispose(): void {
    this.disposeInstanceSet(this.boidInstances);
    this.disposeInstanceSet(this.predatorInstances);
    for (const geometries of [
      this.arcadeBoidGeometries,
      this.arcadePredatorGeometries,
      this.natureBoidGeometries,
      this.naturePredatorGeometries,
    ]) {
      geometries.body.dispose();
      geometries.wingLeft.dispose();
      geometries.wingRight.dispose();
      geometries.tail?.dispose();
    }
    this.natureEnv.dispose();
    this.driftingClouds.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

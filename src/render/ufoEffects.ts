import * as THREE from 'three';

/**
 * Classic flying-saucer visual (metallic lens-shaped hull, glass dome,
 * a ring of rim lights, and a downward tractor beam) for the "Alien
 * Invasion" feature. Renderer3D instantiates one of these per
 * concurrent-UFO slot (see Simulation.ufos / MAX_CONCURRENT_UFOS) and
 * maps each to an active UFO by index, so each instance is a single
 * persistent object toggled visible/invisible and repositioned each
 * frame, rather than an instanced/pooled set like the boid/predator
 * geometry.
 */
export interface UFOVisual {
  /**
   * Called once per frame. When `active` is false the saucer/beam are
   * hidden and the rest of the arguments are ignored. `beamStrength` is
   * 0..1 (smoothed on/off); `beamLength` is how far down the beam cone
   * should reach in world units.
   */
  setState(active: boolean, position: THREE.Vector3, beamStrength: number, beamLength: number): void;
  update(dt: number): void;
  dispose(): void;
}

const HULL_RADIUS = 34;
const HULL_HEIGHT = 11;
const DOME_RADIUS = 14;
const RIM_LIGHT_COUNT = 12;
const BEAM_TOP_RADIUS = 7;
const BEAM_BOTTOM_RADIUS = 60;

export function createUFOVisual(scene: THREE.Scene): UFOVisual {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 10;

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fa3b0,
    metalness: 0.85,
    roughness: 0.25,
    emissive: 0x1c2733,
    emissiveIntensity: 0.4,
    fog: false,
  });
  const hullGeom = new THREE.SphereGeometry(HULL_RADIUS, 28, 14);
  hullGeom.scale(1, HULL_HEIGHT / HULL_RADIUS, 1);
  const hull = new THREE.Mesh(hullGeom, hullMaterial);
  group.add(hull);

  const domeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fe9ff,
    metalness: 0.1,
    roughness: 0.08,
    transparent: true,
    opacity: 0.7,
    emissive: 0x2ad4ff,
    emissiveIntensity: 0.5,
    fog: false,
  });
  const domeGeom = new THREE.SphereGeometry(DOME_RADIUS, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeom, domeMaterial);
  dome.position.y = HULL_HEIGHT * 0.35;
  group.add(dome);

  // A ring of small emissive "landing lights" around the rim — pulses
  // brighter while the tractor beam is engaged.
  const lightGeom = new THREE.SphereGeometry(2.4, 8, 8);
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2a0,
    emissive: 0xfff2a0,
    emissiveIntensity: 1.5,
    fog: false,
  });
  const rimLights: THREE.Mesh[] = [];
  for (let i = 0; i < RIM_LIGHT_COUNT; i++) {
    const angle = (i / RIM_LIGHT_COUNT) * Math.PI * 2;
    const light = new THREE.Mesh(lightGeom, lightMaterial);
    light.position.set(Math.cos(angle) * HULL_RADIUS * 0.92, 0, Math.sin(angle) * HULL_RADIUS * 0.92);
    group.add(light);
    rimLights.push(light);
  }

  // Tractor beam: a downward, additively-blended translucent cone. Top
  // radius sits near the hull's underside, flaring out toward the flock.
  // Built pointing straight down (local -Y) so we only ever need to scale
  // its length, not re-orient it.
  const beamGeom = new THREE.CylinderGeometry(BEAM_TOP_RADIUS, BEAM_BOTTOM_RADIUS, 1, 28, 1, true);
  beamGeom.translate(0, -0.5, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dffb0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeom, beamMaterial);
  beam.position.y = -HULL_HEIGHT * 0.25;
  group.add(beam);

  const beamLight = new THREE.PointLight(0x7dffb0, 0, 500, 2);
  beamLight.position.y = -HULL_HEIGHT * 0.25;
  group.add(beamLight);

  scene.add(group);

  let spin = 0;

  return {
    setState(active, position, beamStrength, beamLength) {
      group.visible = active;
      if (!active) return;
      group.position.copy(position);
      const clampedStrength = Math.max(0, Math.min(1, beamStrength));
      beam.scale.set(1, Math.max(0.001, beamLength), 1);
      beamMaterial.opacity = 0.55 * clampedStrength;
      beamLight.intensity = 3.5 * clampedStrength;
      lightMaterial.emissiveIntensity = 1.5 + clampedStrength * 2.5;
    },
    update(dt) {
      // Slow, continuous spin for a bit of life even when not beaming.
      spin += dt * 0.5;
      group.rotation.y = spin;
    },
    dispose() {
      scene.remove(group);
      hullGeom.dispose();
      domeGeom.dispose();
      lightGeom.dispose();
      beamGeom.dispose();
      hullMaterial.dispose();
      domeMaterial.dispose();
      lightMaterial.dispose();
      beamMaterial.dispose();
    },
  };
}

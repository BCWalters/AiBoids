import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { pickEntity, type EntityForPicking } from './EntityPicker';

/** Build a minimal PerspectiveCamera pointing along –Z, positioned at origin. */
function makeCamera(fov = 60, aspect = 1): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 1, 10000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  return cam;
}

describe('pickEntity', () => {
  let camera: THREE.PerspectiveCamera;
  const W = 800;
  const H = 600;

  beforeEach(() => {
    camera = makeCamera(60, W / H);
  });

  it('returns null when the entity list is empty', () => {
    expect(pickEntity(W / 2, H / 2, W, H, camera, [])).toBeNull();
  });

  it('picks the entity directly in front of the camera (screen centre)', () => {
    // Entity positioned straight ahead along –Z, well within the frustum.
    const entities: EntityForPicking[] = [
      { id: 1, position: { x: 0, y: 0, z: -100 }, isPredator: false },
    ];
    const result = pickEntity(W / 2, H / 2, W, H, camera, entities);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(1);
    expect(result?.isPredator).toBe(false);
  });

  it('returns null when the nearest entity is outside the pixel threshold', () => {
    // Place a boid at a large offset so it projects far off-centre.
    const entities: EntityForPicking[] = [
      { id: 2, position: { x: 500, y: 500, z: -100 }, isPredator: false },
    ];
    // Click at screen centre — the entity will be far off in screen space.
    const result = pickEntity(W / 2, H / 2, W, H, camera, entities, 50);
    expect(result).toBeNull();
  });

  it('returns null when the entity is behind the camera (NDC z > 1)', () => {
    const entities: EntityForPicking[] = [
      { id: 3, position: { x: 0, y: 0, z: 100 }, isPredator: false },
    ];
    expect(pickEntity(W / 2, H / 2, W, H, camera, entities)).toBeNull();
  });

  it('picks the closest entity to the click when multiple are present', () => {
    // Entity A is exactly at screen centre; entity B is a few pixels off.
    const entities: EntityForPicking[] = [
      { id: 10, position: { x: 0, y: 0, z: -100 }, isPredator: false },
      { id: 11, position: { x: 1, y: 1, z: -100 }, isPredator: true },
    ];
    // Click at centre — entity 10 should win.
    const result = pickEntity(W / 2, H / 2, W, H, camera, entities);
    expect(result?.id).toBe(10);
  });

  it('respects the isPredator flag', () => {
    const entities: EntityForPicking[] = [
      { id: 20, position: { x: 0, y: 0, z: -100 }, isPredator: true },
    ];
    const result = pickEntity(W / 2, H / 2, W, H, camera, entities);
    expect(result?.isPredator).toBe(true);
  });

  it('returns null when pointer clicks far from any entity', () => {
    // Entity is at centre, but pointer is at top-left corner.
    const entities: EntityForPicking[] = [
      { id: 30, position: { x: 0, y: 0, z: -100 }, isPredator: false },
    ];
    const result = pickEntity(0, 0, W, H, camera, entities, 50);
    expect(result).toBeNull();
  });

  it('picks with a large threshold even when entity is off-centre', () => {
    // Entity slightly off-centre, large threshold should still hit it.
    const entities: EntityForPicking[] = [
      { id: 40, position: { x: 5, y: 3, z: -200 }, isPredator: false },
    ];
    // Click exactly at screen centre (entity will project slightly off-centre
    // but within a generous 200 px radius).
    const result = pickEntity(W / 2, H / 2, W, H, camera, entities, 200);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(40);
  });
});

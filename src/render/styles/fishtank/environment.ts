import * as THREE from 'three';

/**
 * "Fish tank" style environment: a glass aquarium box (matching the sim's
 * actual world bounds exactly, so the glass reads as a real container the
 * fish swim inside) sitting on a table, inside a simple room — so the
 * scene reads differently depending on whether the camera is orbiting
 * close/inside the tank (water + fish) or pulled back outside it (the
 * tank as an object on a table, with room walls/floor around it).
 *
 * This is an independent module from nature's environment.ts — a future
 * "fish tank scenery" pass can freely add tank features here (gravel,
 * plants, bubbles, caustics, etc.) without touching nature's ground/
 * mountains/lakes code, or risking merge conflicts with work in progress
 * there.
 */
export interface FishtankEnvironment {
  waterFill: THREE.Mesh;
  glassPanels: THREE.Mesh;
  frameEdges: THREE.LineSegments;
  table: THREE.Mesh;
  roomFloor: THREE.Mesh;
  roomWallBack: THREE.Mesh;
  roomWallLeft: THREE.Mesh;
  ambientLight: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** Call once per frame while fishtank style is active (currently a no-op stub — reserved for future caustics/particle animation). */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall fishtank-style visibility. */
  setFogEnabled(enabled: boolean): void;
  dispose(): void;
}

// Deep aquarium blue — used for the water fill tint and the (tightly
// scoped, tank-only) fog so any fog blends into the water color rather
// than reading as a separate haze layer.
const WATER_COLOR = 0x0d4f7a;
// Dark aquarium-silicone/frame color for the glass box's edges — same
// visual role as arcade's world-bounds wireframe (src/render/Renderer3D's
// boundsHelper), just drawn independently here rather than reusing that
// debug helper, per the "duplicate, don't share" approach for this style.
const FRAME_COLOR = 0x14181c;
const TABLE_COLOR = 0x6b4423;
const FLOOR_COLOR = 0xcbbfa8;
const WALL_COLOR = 0xe4ded0;

export function createFishtankEnvironment(scene: THREE.Scene): FishtankEnvironment {
  // Placeholder 1x1x1 boxes — placeFishtankEnvironment resizes/positions
  // everything below once the sim's actual world dimensions are known.
  const glassGeometry = new THREE.BoxGeometry(1, 1, 1);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.18,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glassPanels = new THREE.Mesh(glassGeometry, glassMaterial);
  glassPanels.visible = false;

  const edgesGeometry = new THREE.EdgesGeometry(glassGeometry);
  const frameMaterial = new THREE.LineBasicMaterial({ color: FRAME_COLOR });
  const frameEdges = new THREE.LineSegments(edgesGeometry, frameMaterial);
  frameEdges.visible = false;

  const waterGeometry = new THREE.BoxGeometry(1, 1, 1);
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: WATER_COLOR,
    transparent: true,
    opacity: 0.28,
    roughness: 0.15,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const waterFill = new THREE.Mesh(waterGeometry, waterMaterial);
  waterFill.visible = false;

  const tableGeometry = new THREE.BoxGeometry(1, 1, 1);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.6, metalness: 0.05 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.visible = false;

  const floorGeometry = new THREE.PlaneGeometry(1, 1);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.9, metalness: 0 });
  const roomFloor = new THREE.Mesh(floorGeometry, floorMaterial);
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.visible = false;

  const wallGeometry = new THREE.PlaneGeometry(1, 1);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, metalness: 0 });
  const roomWallBack = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallBack.visible = false;
  // Left wall reuses the same geometry/material as the back wall (just
  // rotated 90°) — sharing them is fine since neither is ever disposed
  // independently (both go away together in dispose()).
  const roomWallLeft = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallLeft.rotation.y = Math.PI / 2;
  roomWallLeft.visible = false;

  const ambientLight = new THREE.AmbientLight(0xd8ecff, 0.55);
  const keyLight = new THREE.DirectionalLight(0xfff6e8, 0.7);
  // Soft light from above, like an overhead room/tank hood lamp rather
  // than nature's low sun angle.
  keyLight.position.set(0.4, 1, 0.5);
  ambientLight.visible = false;
  keyLight.visible = false;

  // Fog is scoped tightly to roughly the tank's own scale (see
  // placeFishtankEnvironment) rather than nature's whole-world haze, so it
  // reads as "water murkiness" for fish near the far glass wall without
  // ever visibly touching the room/table outside the tank.
  const fog = new THREE.Fog(WATER_COLOR, 10, 4000);

  scene.add(
    glassPanels,
    frameEdges,
    waterFill,
    table,
    roomFloor,
    roomWallBack,
    roomWallLeft,
    ambientLight,
    keyLight,
  );

  let fogEnabled = true;

  return {
    waterFill,
    glassPanels,
    frameEdges,
    table,
    roomFloor,
    roomWallBack,
    roomWallLeft,
    ambientLight,
    keyLight,
    fog,
    update() {
      // No animated elements yet (see doc comment above).
    },
    setVisible(visible: boolean) {
      glassPanels.visible = visible;
      frameEdges.visible = visible;
      waterFill.visible = visible;
      table.visible = visible;
      roomFloor.visible = visible;
      roomWallBack.visible = visible;
      roomWallLeft.visible = visible;
      ambientLight.visible = visible;
      keyLight.visible = visible;
      // Same "only actually attach if both visible and not independently
      // disabled" pattern as nature's setVisible (see ../../environment.ts).
      scene.fog = visible && fogEnabled ? fog : null;
    },
    setFogEnabled(enabled: boolean) {
      fogEnabled = enabled;
      // Guarded by waterFill.visible so this only touches scene.fog while
      // fishtank is the active style — Renderer3D calls setFogEnabled on
      // both environments every frame regardless of which is active, and
      // unconditionally assigning here would clobber whichever fog the
      // other (currently-visible) environment just set.
      if (waterFill.visible) scene.fog = enabled ? fog : null;
    },
    dispose() {
      scene.remove(
        glassPanels,
        frameEdges,
        waterFill,
        table,
        roomFloor,
        roomWallBack,
        roomWallLeft,
        ambientLight,
        keyLight,
      );
      if (scene.fog === fog) scene.fog = null;
      glassPanels.geometry.dispose();
      (glassPanels.material as THREE.Material).dispose();
      frameEdges.geometry.dispose();
      (frameEdges.material as THREE.Material).dispose();
      waterFill.geometry.dispose();
      (waterFill.material as THREE.Material).dispose();
      table.geometry.dispose();
      (table.material as THREE.Material).dispose();
      roomFloor.geometry.dispose();
      roomWallBack.geometry.dispose();
      (roomFloor.material as THREE.Material).dispose();
      (roomWallBack.material as THREE.Material).dispose();
    },
  };
}

/**
 * Sizes/positions the fishtank environment so the glass box matches the
 * sim's actual world bounds exactly (fish already swim within x:[0,width],
 * y:[0,height], z:[0,depth] — the same convention Renderer3D's debug
 * boundsHelper uses), then builds a table/room around it at a scale
 * derived from the tank's own size.
 */
export function placeFishtankEnvironment(
  env: FishtankEnvironment,
  worldWidth: number,
  worldHeight: number,
  worldDepth: number,
): void {
  const maxDim = Math.max(worldWidth, worldHeight, worldDepth);
  // Thin glass shell just outside the tank's actual swim bounds.
  const glassThickness = maxDim * 0.012;
  const center = new THREE.Vector3(worldWidth / 2, worldHeight / 2, worldDepth / 2);

  env.glassPanels.scale.set(worldWidth + glassThickness * 2, worldHeight + glassThickness * 2, worldDepth + glassThickness * 2);
  env.glassPanels.position.copy(center);

  env.frameEdges.scale.copy(env.glassPanels.scale);
  env.frameEdges.position.copy(center);

  // Inset further than glassThickness so the water fill's faces are
  // never nearly-coplanar with the glass box's inner faces — too small a
  // gap here causes visible z-fighting moiré stripes at grazing viewing
  // angles (most noticeable looking across the tank floor).
  const inset = glassThickness * 4;
  env.waterFill.scale.set(worldWidth - inset, worldHeight - inset, worldDepth - inset);
  env.waterFill.position.copy(center);

  // Table: a slab directly beneath the tank's bottom face, with a
  // noticeably larger footprint than the tank so it visibly reads as
  // furniture the tank sits on rather than a coincidentally-sized block.
  const tableHeight = maxDim * 0.5;
  const tableFootprintX = worldWidth * 1.6;
  const tableFootprintZ = worldDepth * 1.6;
  env.table.scale.set(tableFootprintX, tableHeight, tableFootprintZ);
  // Extra gap below glassThickness so the table's top surface never sits
  // exactly coplanar with the glass box's bottom face — an exact
  // coincidence there previously caused visible z-fighting stripes
  // between the (transparent) glass and the (opaque) table where they'd
  // otherwise perfectly overlap.
  const tableGap = glassThickness * 1.5;
  env.table.position.set(center.x, -tableGap - tableHeight / 2, center.z);

  // Room: a floor far larger than the table (so it extends well past the
  // frame in every direction) and two walls forming a back-left corner
  // behind the tank — sized/placed relative to the tank so the room
  // scales sensibly with the world/tank size.
  const roomFloorSize = maxDim * 8;
  const roomHeight = maxDim * 5;
  const roomFloorY = -tableGap - tableHeight;
  env.roomFloor.scale.set(roomFloorSize, roomFloorSize, 1);
  env.roomFloor.position.set(center.x, roomFloorY, center.z);

  // Back wall (perpendicular to Z, behind the tank at the low-Z side —
  // the side facing away from the camera's default approach angle, which
  // orbits in from the +x/+y/+z octant, see Renderer3D's initial camera
  // placement).
  const wallMargin = maxDim * 1.2;
  env.roomWallBack.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallBack.position.set(center.x, roomFloorY + roomHeight / 2, center.z - wallMargin);

  // Left wall (perpendicular to X, at the low-X side), completing the
  // room corner.
  env.roomWallLeft.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallLeft.position.set(center.x - wallMargin, roomFloorY + roomHeight / 2, center.z);

  // Fog is meant to read as mild water murkiness for fish approaching the
  // far glass wall when viewed from up close/inside the tank — but
  // THREE.Fog measures distance from the *camera*, not from the tank, so
  // its far distance must comfortably exceed the camera's own max
  // zoom-out distance (see Renderer3D's fishtank maxDistance clamp,
  // ~flockScale * 12) or the entire room reads as a flat wall of fog
  // color the moment the camera pulls back to see the table/room (the
  // same "blown-out fog wall" failure mode nature's environment avoids
  // by keeping its fog.far comfortably beyond its own zoom clamp).
  env.fog.near = maxDim * 3;
  env.fog.far = maxDim * 20;
}

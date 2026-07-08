import * as THREE from 'three';
import {
  createCheckerTexture,
  createArtPiece,
  createDoor,
  createWindow,
  createOverheadLamp,
  type OverheadLamp,
} from './roomDecor';

/**
 * "Fish tank" style environment: a glass aquarium box (matching the sim's
 * actual world bounds exactly, so the glass reads as a real container the
 * fish swim inside) sitting on a table, inside a fully enclosed room —
 * floor, ceiling, four walls, an overhead light, a door, windows, and
 * some wall art — so the scene reads as a real room the tank sits in
 * whichever way the camera orbits, not just a two-wall backdrop.
 *
 * This is an independent module from nature's environment.ts — a future
 * "fish tank scenery" pass can freely add tank features (gravel, plants,
 * bubbles, caustics, etc.) without touching nature's ground/mountains/
 * lakes code, or risking merge conflicts with work in progress there.
 * The tank/water/table objects themselves are intentionally left as-is
 * here (only the room shell around them was reworked) so other agents
 * can keep iterating on the tank's own contents independently.
 */
export interface FishtankEnvironment {
  waterFill: THREE.Mesh;
  glassPanels: THREE.Mesh;
  frameEdges: THREE.LineSegments;
  table: THREE.Group;
  roomFloor: THREE.Mesh;
  roomCeiling: THREE.Mesh;
  roomWallBack: THREE.Mesh;
  roomWallLeft: THREE.Mesh;
  roomWallRight: THREE.Mesh;
  roomWallFront: THREE.Mesh;
  door: THREE.Group;
  windowLeft: THREE.Group;
  windowFront: THREE.Group;
  artPieces: THREE.Group[];
  lamp: OverheadLamp;
  ambientLight: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** Call once per frame while fishtank style is active (currently a no-op stub — reserved for future caustics/particle animation). */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall fishtank-style visibility. */
  setFogEnabled(enabled: boolean): void;
  /**
   * Independently hides/shows just the surrounding room (table, floor,
   * ceiling, walls, door, windows, art, lamp) without touching the tank
   * itself (glass/water/tank lighting) — used by the Model Gallery so a
   * close-up, creature-relative camera distance can sit *inside* the
   * tank/water volume without the room being visible (nonsensically)
   * through the transparent glass behind the creature.
   */
  setRoomVisible(visible: boolean): void;
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
const TABLE_TOP_COLOR = 0x6b4423;
const TABLE_LEG_COLOR = 0x5a3a1e;
const WALL_COLOR = 0xe4ded0;
// Muted sage green for the single "feature" accent wall behind the tank —
// paired with the other three off-white walls per a fairly standard
// "one accent wall" paint scheme.
const ACCENT_WALL_COLOR = 0x7c8f74;
const CEILING_COLOR = 0xf2efe6;

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}

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

  // Table: tabletop slab + four legs, built as a group rather than one
  // solid block so it reads as actual furniture rather than a plinth.
  const table = new THREE.Group();
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: TABLE_TOP_COLOR, roughness: 0.5, metalness: 0.05 });
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tableTopMaterial);
  tableTop.name = 'tableTop';
  table.add(tableTop);
  const legMaterial = new THREE.MeshStandardMaterial({ color: TABLE_LEG_COLOR, roughness: 0.6, metalness: 0.05 });
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), legMaterial);
    leg.name = `tableLeg${i}`;
    table.add(leg);
  }
  table.visible = false;

  // Floor: black/white checker tile texture rather than a flat color.
  const floorTexture = createCheckerTexture('#1c1c1c', '#f2f2f2', 8);
  const floorGeometry = new THREE.PlaneGeometry(1, 1);
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.55, metalness: 0.05 });
  const roomFloor = new THREE.Mesh(floorGeometry, floorMaterial);
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.visible = false;

  const ceilingGeometry = new THREE.PlaneGeometry(1, 1);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95, metalness: 0 });
  const roomCeiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  roomCeiling.rotation.x = Math.PI / 2;
  roomCeiling.visible = false;

  const wallGeometry = new THREE.PlaneGeometry(1, 1);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, metalness: 0 });
  const accentWallMaterial = new THREE.MeshStandardMaterial({ color: ACCENT_WALL_COLOR, roughness: 0.9, metalness: 0 });

  // Back wall is the single accent wall (muted green) — the natural
  // "feature wall" backdrop directly behind the tank.
  const roomWallBack = new THREE.Mesh(wallGeometry, accentWallMaterial);
  roomWallBack.visible = false;
  // Left/right/front walls share the same off-white material/geometry —
  // sharing is fine since none of these are ever disposed independently
  // (they all go away together in dispose()).
  const roomWallLeft = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallLeft.rotation.y = Math.PI / 2;
  roomWallLeft.visible = false;
  const roomWallRight = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallRight.rotation.y = -Math.PI / 2;
  roomWallRight.visible = false;
  const roomWallFront = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallFront.rotation.y = Math.PI;
  roomWallFront.visible = false;

  // Door on the right wall, windows on the left and front walls, and a
  // few framed art pieces spread across the back/front walls.
  const door = createDoor();
  door.visible = false;
  const windowLeft = createWindow();
  windowLeft.visible = false;
  const windowFront = createWindow();
  windowFront.visible = false;
  const artPieces = [createArtPiece('coral'), createArtPiece('orbits'), createArtPiece('sunsetBands')];
  artPieces.forEach((piece) => {
    piece.visible = false;
  });

  const lamp = createOverheadLamp();
  lamp.group.visible = false;
  lamp.light.visible = false;

  const ambientLight = new THREE.AmbientLight(0xd8ecff, 0.55);
  const keyLight = new THREE.DirectionalLight(0xfff6e8, 0.7);
  // Soft light from above, like an overhead room/tank hood lamp rather
  // than nature's low sun angle.
  keyLight.position.set(0.4, 1, 0.5);
  ambientLight.visible = false;
  keyLight.visible = false;

  // Fog is scoped tightly to roughly the tank's own scale (see
  // placeFishtankEnvironment) rather than nature's whole-world haze, so it
  // reads as "water murkiness" for fish near the far glass wall when
  // viewed from up close/inside the tank without ever visibly touching
  // the room/table outside the tank.
  const fog = new THREE.Fog(WATER_COLOR, 10, 4000);

  scene.add(
    glassPanels,
    frameEdges,
    waterFill,
    table,
    roomFloor,
    roomCeiling,
    roomWallBack,
    roomWallLeft,
    roomWallRight,
    roomWallFront,
    door,
    windowLeft,
    windowFront,
    ...artPieces,
    lamp.group,
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
    roomCeiling,
    roomWallBack,
    roomWallLeft,
    roomWallRight,
    roomWallFront,
    door,
    windowLeft,
    windowFront,
    artPieces,
    lamp,
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
      roomCeiling.visible = visible;
      roomWallBack.visible = visible;
      roomWallLeft.visible = visible;
      roomWallRight.visible = visible;
      roomWallFront.visible = visible;
      door.visible = visible;
      windowLeft.visible = visible;
      windowFront.visible = visible;
      artPieces.forEach((piece) => {
        piece.visible = visible;
      });
      lamp.group.visible = visible;
      lamp.light.visible = visible;
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
    setRoomVisible(visible: boolean) {
      // Guarded by waterFill.visible (same pattern as setFogEnabled) so
      // this only touches the room while fishtank is actually the active
      // style — Renderer3D calls this every frame regardless of which
      // style is active, and unconditionally setting visible here would
      // un-hide the whole room even while nature/arcade is active (the
      // room's still in the scene graph, just hidden via setVisible).
      if (!waterFill.visible) return;
      table.visible = visible;
      roomFloor.visible = visible;
      roomCeiling.visible = visible;
      roomWallBack.visible = visible;
      roomWallLeft.visible = visible;
      roomWallRight.visible = visible;
      roomWallFront.visible = visible;
      door.visible = visible;
      windowLeft.visible = visible;
      windowFront.visible = visible;
      artPieces.forEach((piece) => {
        piece.visible = visible;
      });
      lamp.group.visible = visible;
      lamp.light.visible = visible;
    },
    dispose() {
      scene.remove(
        glassPanels,
        frameEdges,
        waterFill,
        table,
        roomFloor,
        roomCeiling,
        roomWallBack,
        roomWallLeft,
        roomWallRight,
        roomWallFront,
        door,
        windowLeft,
        windowFront,
        ...artPieces,
        lamp.group,
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
      disposeObject3D(table);
      roomFloor.geometry.dispose();
      (roomFloor.material as THREE.MeshStandardMaterial).map?.dispose();
      (roomFloor.material as THREE.Material).dispose();
      roomCeiling.geometry.dispose();
      (roomCeiling.material as THREE.Material).dispose();
      roomWallBack.geometry.dispose();
      accentWallMaterial.dispose();
      wallMaterial.dispose();
      disposeObject3D(door);
      disposeObject3D(windowLeft);
      disposeObject3D(windowFront);
      artPieces.forEach(disposeObject3D);
      disposeObject3D(lamp.group);
    },
  };
}

/**
 * Sizes/positions the fishtank environment so the glass box matches the
 * sim's actual world bounds exactly (fish already swim within x:[0,width],
 * y:[0,height], z:[0,depth] — the same convention Renderer3D's debug
 * boundsHelper uses), then builds a table and a fully enclosed room
 * around it at a scale derived from the tank's own size.
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
  // furniture the tank sits on rather than a coincidentally-sized block,
  // standing on four legs inset from the tabletop's edges.
  const tableHeight = maxDim * 0.5;
  const tableFootprintX = worldWidth * 1.6;
  const tableFootprintZ = worldDepth * 1.6;
  const tableTopThickness = tableHeight * 0.16;
  // Extra gap below glassThickness so the table's top surface never sits
  // exactly coplanar with the glass box's bottom face — an exact
  // coincidence there previously caused visible z-fighting stripes
  // between the (transparent) glass and the (opaque) table where they'd
  // otherwise perfectly overlap.
  const tableGap = glassThickness * 1.5;
  const tableTopY = -tableGap - tableTopThickness / 2;
  // The table Group itself stays at the scene origin — tabletop/leg
  // children below are positioned with absolute world coordinates
  // (including center.x/center.z) directly, so giving the group its own
  // center offset too would double-apply it and shift the table away
  // from the tank.
  env.table.position.set(0, 0, 0);

  const tableTop = env.table.getObjectByName('tableTop') as THREE.Mesh;
  tableTop.scale.set(tableFootprintX, tableTopThickness, tableFootprintZ);
  tableTop.position.set(center.x, tableTopY, center.z);

  const legThickness = Math.min(tableFootprintX, tableFootprintZ) * 0.06;
  const legHeight = tableHeight - tableTopThickness;
  const legInsetX = tableFootprintX / 2 - legThickness * 1.2;
  const legInsetZ = tableFootprintZ / 2 - legThickness * 1.2;
  const legY = tableTopY - tableTopThickness / 2 - legHeight / 2;
  const legOffsets = [
    [-legInsetX, -legInsetZ],
    [legInsetX, -legInsetZ],
    [-legInsetX, legInsetZ],
    [legInsetX, legInsetZ],
  ];
  legOffsets.forEach(([dx, dz], i) => {
    const leg = env.table.getObjectByName(`tableLeg${i}`) as THREE.Mesh;
    leg.scale.set(legThickness, legHeight, legThickness);
    leg.position.set(center.x + dx, legY, center.z + dz);
  });

  // Room: floor, ceiling, and four walls fully enclosing a box around
  // the tank/table, sized generously relative to the tank so it reads as
  // a real room rather than a tight diorama shell.
  const roomFloorSize = maxDim * 8;
  const roomHeight = maxDim * 5;
  const roomFloorY = -tableGap - tableHeight;
  const wallMargin = maxDim * 3;

  env.roomFloor.scale.set(roomFloorSize, roomFloorSize, 1);
  env.roomFloor.position.set(center.x, roomFloorY, center.z);
  // Repeat the checker texture so each tile reads at a believable
  // real-world size rather than one giant texture stretched over the
  // whole floor.
  const floorMap = (env.roomFloor.material as THREE.MeshStandardMaterial).map;
  if (floorMap) {
    const tileRepeats = roomFloorSize / (maxDim * 2.4);
    floorMap.repeat.set(tileRepeats, tileRepeats);
  }

  env.roomCeiling.scale.set(roomFloorSize, roomFloorSize, 1);
  env.roomCeiling.position.set(center.x, roomFloorY + roomHeight, center.z);

  // Back wall (perpendicular to Z, behind the tank at the low-Z side —
  // the side facing away from the camera's default approach angle, which
  // orbits in from the +x/+y/+z octant, see Renderer3D's initial camera
  // placement). This is the muted-green accent wall.
  env.roomWallBack.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallBack.position.set(center.x, roomFloorY + roomHeight / 2, center.z - wallMargin);

  // Front wall completes the enclosure on the high-Z side.
  env.roomWallFront.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallFront.position.set(center.x, roomFloorY + roomHeight / 2, center.z + wallMargin);

  // Left/right walls (perpendicular to X) complete the box.
  env.roomWallLeft.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallLeft.position.set(center.x - wallMargin, roomFloorY + roomHeight / 2, center.z);
  env.roomWallRight.scale.set(roomFloorSize, roomHeight, 1);
  env.roomWallRight.position.set(center.x + wallMargin, roomFloorY + roomHeight / 2, center.z);

  // Door on the right wall, standing on the floor.
  const doorScale = maxDim * 1.3;
  env.door.scale.set(doorScale, doorScale * 1.7, doorScale);
  env.door.position.set(
    center.x + wallMargin - maxDim * 0.02,
    roomFloorY + (doorScale * 1.7) / 2,
    center.z - wallMargin * 0.35,
  );
  env.door.rotation.y = -Math.PI / 2;

  // Windows: one on the left wall, one on the front wall, both at
  // roughly eye-level height above the floor.
  const windowScale = maxDim * 1.6;
  const windowY = roomFloorY + roomHeight * 0.35;
  env.windowLeft.scale.set(windowScale, windowScale, windowScale);
  env.windowLeft.position.set(center.x - wallMargin + maxDim * 0.02, windowY, center.z + wallMargin * 0.4);
  env.windowLeft.rotation.y = Math.PI / 2;

  env.windowFront.scale.set(windowScale, windowScale, windowScale);
  env.windowFront.position.set(center.x - wallMargin * 0.45, windowY, center.z + wallMargin - maxDim * 0.02);
  env.windowFront.rotation.y = Math.PI;

  // Art: two pieces on the back accent wall flanking the tank, one on
  // the front wall beside its window.
  const artScale = maxDim * 1.1;
  const artY = roomFloorY + roomHeight * 0.4;
  const [artBackLeft, artBackRight, artFront] = env.artPieces;
  artBackLeft.scale.set(artScale, artScale, artScale);
  artBackLeft.position.set(center.x - wallMargin * 0.55, artY, center.z - wallMargin + maxDim * 0.02);
  artBackRight.scale.set(artScale, artScale, artScale);
  artBackRight.position.set(center.x + wallMargin * 0.55, artY, center.z - wallMargin + maxDim * 0.02);
  artFront.scale.set(artScale, artScale, artScale);
  artFront.position.set(center.x + wallMargin * 0.45, artY, center.z + wallMargin - maxDim * 0.02);
  artFront.rotation.y = Math.PI;

  // Overhead lamp: hangs from the ceiling directly above the tank, aimed
  // straight down like a room/tank hood light. roomDecor's lamp is
  // authored with a local rod length of 1 unit, so a uniform group scale
  // of the desired world-space rod length sizes the whole fixture
  // (rod/shade/bulb) proportionally in one step, rather than
  // independently rescaling individual parts (which previously caused
  // the rod to be scaled twice).
  const lampScale = roomHeight * 0.32;
  env.lamp.group.position.set(center.x, roomFloorY + roomHeight, center.z);
  env.lamp.group.scale.set(lampScale, lampScale, lampScale);
  // Light distance/decay are absolute world-space values, unaffected by
  // the group's transform scale, so they're set directly here.
  env.lamp.light.distance = roomHeight * 3;

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

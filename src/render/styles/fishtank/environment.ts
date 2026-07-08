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
  frame: THREE.Group;
  baseTrim: THREE.Mesh;
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

// How much bigger the tank renders than the sim's literal swim bounds
// (sim.width/height/params.worldDepth). Those bounds are shared with
// every other 3D style (arcade/nature), so they can't just be bumped up
// for fishtank alone without also enlarging arcade/nature's flight
// space — instead, fishtank inflates its own visuals (glass box, water,
// room, and — via Renderer3D applying this same constant to fishtank's
// boid instance positions/scale — the fish themselves) by this factor,
// entirely independently of the sim's actual coordinate space. Without
// this, a big enough room to read as "a real room" makes a tank sized
// to the raw sim bounds (and the fish inside it) look tiny/bug-sized
// once the camera pulls back far enough to frame that room.
export const TANK_VISUAL_SCALE = 4;

/**
 * Room extents and a safe camera distance, derived from the sim's raw
 * (unscaled) world bounds using the exact same formulas as
 * `placeFishtankEnvironment` below. Exported so Renderer3D's camera
 * distance clamps can stay in lockstep with the room's actual size
 * without duplicating/drifting from this math — previously the camera
 * clamp was derived from a since-removed depth-dominated `maxDim`
 * formula that no longer matches the room's true footprint.
 */
export interface FishtankRoomBounds {
  /** Horizontal distance from room center to each wall. */
  wallMargin: number;
  /** Vertical distance from the floor to the ceiling. */
  roomHeight: number;
  /** World-space Y of the floor. */
  roomFloorY: number;
  /**
   * World-space Y of the tank's true vertical middle (bottom-anchored at
   * y=0, see placeFishtankEnvironment's `center.y` doc comment) — the
   * right height for the orbit camera to look at, rather than the sim's
   * raw/unscaled vertical center, which sits near the tank's *bottom*
   * once the tank is scaled up (since the tank only grows upward from
   * y=0, not around its raw center).
   */
  tankCenterY: number;
  /**
   * Largest orbit-camera distance (from the tank's true center, see
   * `tankCenterY`) that still keeps the camera comfortably inside the
   * room's floor/ceiling/walls at every *permitted* orbit tilt (see
   * `cameraTiltLimitRad`). The tank's table height is intentionally kept
   * fixed rather than scaling with TANK_VISUAL_SCALE (see
   * placeFishtankEnvironment's tableHeight doc comment), so the tank's
   * center ends up fairly close to the floor — a fully unrestricted
   * "any tilt, any distance" bound would clamp zoom-out to a tiny
   * fraction of the room's actual horizontal size (wallMargin), which is
   * what previously made fishtank's zoom-out feel badly restricted
   * compared to nature. Restricting *tilt* instead (steep straight-up/
   * straight-down orbits are rarely useful for viewing a tank anyway)
   * buys back a much more generous zoom-out range while remaining
   * mathematically guaranteed never to clip through the floor/ceiling —
   * see `cameraTiltLimitRad`'s doc comment for the derivation.
   */
  maxCameraDistance: number;
  /**
   * Max allowed tilt (radians) away from perfectly horizontal, applied
   * as Renderer3D's OrbitControls minPolarAngle/maxPolarAngle
   * (Math.PI/2 ∓ this value). Paired 1:1 with `maxCameraDistance`: at
   * this tilt and that distance, `distance * sin(tilt)` exactly equals
   * the tighter of the floor/ceiling clearance (times a small safety
   * factor), so the camera can never poke through either surface no
   * matter how the user orbits within the permitted tilt range. A
   * tighter tilt limit would allow a larger maxCameraDistance (and vice
   * versa) — this value was chosen as a reasonable "look around a room"
   * range (30° above/below horizontal) that still leaves a usable
   * zoom-out distance, rather than solving for the absolute maximum
   * distance at the cost of barely any tilt freedom.
   */
  cameraTiltLimitRad: number;
}

export function computeFishtankRoomBounds(
  rawWorldWidth: number,
  rawWorldHeight: number,
  rawWorldDepth: number,
): FishtankRoomBounds {
  const simMaxDim = Math.max(rawWorldWidth, rawWorldHeight, rawWorldDepth);
  const worldWidth = rawWorldWidth * TANK_VISUAL_SCALE;
  const worldHeight = rawWorldHeight * TANK_VISUAL_SCALE;
  const worldDepth = rawWorldDepth * TANK_VISUAL_SCALE;

  const tableHeight = simMaxDim * 0.5;
  const tableFootprintX = worldWidth * 1.6;
  const tableFootprintZ = worldDepth * 1.6;
  const tankFootprint = Math.max(tableFootprintX, tableFootprintZ);
  // Pulled back in (1.3x the tank/table footprint, was 2.6x — an
  // earlier pass had briefly pushed the walls out much farther purely
  // to buy zoom headroom) per an explicit ask for a visually smaller,
  // closer-walled room while keeping the ceiling (roomHeight below)
  // unchanged. doorHeight is still derived from tankTopY, not from
  // wallMargin or roomHeight, so door/tank proportions are unaffected.
  const wallMargin = tankFootprint * 1.3;

  const tankTopY = tableHeight + worldHeight;
  const doorHeight = tankTopY * 1.05;
  const roomHeight = doorHeight * 3.2;

  const maxDim = Math.max(worldWidth, worldHeight, worldDepth);
  const glassThickness = maxDim * 0.012;
  const tableGap = glassThickness * 1.5;
  const roomFloorY = -tableGap - tableHeight;

  // The tank is bottom-anchored at y=0 and grows upward (see
  // placeFishtankEnvironment's `center.y` doc comment), so its true
  // vertical middle — the right point for the camera to look at — is
  // simply half its (scaled) height, not the sim's raw vertical center.
  const tankCenterY = worldHeight / 2;
  const distToCeiling = roomFloorY + roomHeight - tankCenterY;
  const distToFloor = tankCenterY - roomFloorY;
  // See `cameraTiltLimitRad`'s doc comment: this is a "look around a
  // room" tilt range (18° above/below horizontal — loosened from an
  // earlier 14° pass per an explicit ask to allow panning up closer to
  // the ceiling, at the cost of a somewhat shorter maxCameraDistance)
  // rather than full vertical freedom, chosen specifically so that
  // `maxCameraDistance` below can safely be derived from it without ever
  // risking a floor/ceiling clip.
  const cameraTiltLimitRad = Math.PI * (18 / 180);
  // Solve for the largest distance where, even at the steepest permitted
  // tilt, `distance * sin(tilt)` still clears the tighter of the two
  // vertical clearances (with a small safety factor). wallMargin caps
  // the *horizontal* side of the same worst-case tilt (`distance *
  // cos(tilt)`, cos being close to 1 at this tilt so it's rarely the
  // binding constraint) so the camera also can't be pushed out past the
  // walls at a shallow tilt.
  const verticalCap = (Math.min(distToFloor, distToCeiling) / Math.sin(cameraTiltLimitRad)) * 0.9;
  const horizontalCap = (wallMargin / Math.cos(cameraTiltLimitRad)) * 0.9;
  const maxCameraDistance = Math.min(verticalCap, horizontalCap);

  return { wallMargin, roomHeight, roomFloorY, tankCenterY, maxCameraDistance, cameraTiltLimitRad };
}

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

  // A dark plastic/rubber base plinth just under the glass, hiding the
  // seam where the tank meets the table — a detail seen on virtually
  // every real aquarium.
  const baseTrimMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.7, metalness: 0.1 });
  const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseTrimMaterial);
  baseTrim.visible = false;

  // Metal frame: thin brushed-aluminum bars along all 12 edges of the
  // glass box (4 vertical corner posts + 4 top edges + 4 bottom edges),
  // replacing the old flat LineSegments wireframe with an actual 3D
  // frame — narrower than the previous line-drawn "border" reads, and
  // one that actually catches light/specular highlights like real
  // aquarium framing.
  const frameBarMaterial = new THREE.MeshStandardMaterial({ color: 0xb7bdc4, roughness: 0.35, metalness: 0.9 });
  const frame = new THREE.Group();
  const barGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 12; i++) {
    const bar = new THREE.Mesh(barGeometry, frameBarMaterial);
    bar.name = `frameBar${i}`;
    frame.add(bar);
  }
  frame.visible = false;

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
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const roomFloor = new THREE.Mesh(floorGeometry, floorMaterial);
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.visible = false;

  const ceilingGeometry = new THREE.PlaneGeometry(1, 1);
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const roomCeiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  roomCeiling.rotation.x = Math.PI / 2;
  roomCeiling.visible = false;

  const wallGeometry = new THREE.PlaneGeometry(1, 1);
  // DoubleSide as a safety net: even with the room now sized to
  // comfortably exceed the camera's max zoom-out distance (see
  // placeFishtankEnvironment), a single-sided wall the camera ever ends
  // up behind would otherwise vanish outright (backface culling) rather
  // than simply looking wrong from an unexpected angle.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const accentWallMaterial = new THREE.MeshStandardMaterial({
    color: ACCENT_WALL_COLOR,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });

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
    frame,
    baseTrim,
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
    frame,
    baseTrim,
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
      frame.visible = visible;
      baseTrim.visible = visible;
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
        frame,
        baseTrim,
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
      disposeObject3D(frame);
      baseTrim.geometry.dispose();
      (baseTrim.material as THREE.Material).dispose();
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
  // Computed once, from the raw (unscaled) args, before they're inflated
  // below — reused for the room/door sizing further down so this stays
  // in lockstep with Renderer3D's camera clamp (which calls this same
  // function) rather than duplicating and risking drift between the two.
  const roomBounds = computeFishtankRoomBounds(worldWidth, worldHeight, worldDepth);

  // Table height must stay anchored to the sim's actual (unscaled) size,
  // not the inflated visual tank size below — otherwise a bigger tank
  // would also stand on a taller table, when the ask is a bigger tank on
  // the *same* table.
  const simMaxDim = Math.max(worldWidth, worldHeight, worldDepth);
  // Horizontally (X/Z), the tank's center is fixed at the sim's actual
  // (unscaled) center — computed here, before worldWidth/Height/Depth are
  // inflated below — so the visually-bigger tank grows symmetrically
  // outward from the same point rather than shifting away from it. This
  // matters because Renderer3D's camera target/framing and fish
  // positions (see TANK_VISUAL_SCALE's doc comment) are anchored to this
  // same raw sim center horizontally.
  //
  // Vertically (Y) the tank is intentionally NOT grown around its
  // center: its bottom always sits at y=0 (on the table, matching the
  // sim's own y=0 swim-space floor) and it grows upward from there as
  // TANK_VISUAL_SCALE increases. Growing around the vertical center
  // instead (as this used to) makes the tank's bottom sink further and
  // further *through* the table/floor the bigger the scale, since half
  // of the added height extends downward — which is also what made the
  // tank look disproportionately short next to the room/door: only half
  // of its height growth was visible above the table. Renderer3D mirrors
  // this bottom-anchored growth for fish (via `fishtankCenter`, y=0).
  const center = new THREE.Vector3(worldWidth / 2, 0, worldDepth / 2);

  // Inflate the tank's rendered dimensions (see TANK_VISUAL_SCALE's doc
  // comment) — every tank/water/room *size* measurement below is derived
  // from these scaled values, not the raw sim bounds passed in. Only
  // sizes are scaled here, never the horizontal center computed above.
  worldWidth *= TANK_VISUAL_SCALE;
  worldHeight *= TANK_VISUAL_SCALE;
  worldDepth *= TANK_VISUAL_SCALE;
  // Now that worldHeight is inflated, place the tank's vertical center
  // so its bottom lands at y=0 (see comment above).
  center.y = worldHeight / 2;

  const maxDim = Math.max(worldWidth, worldHeight, worldDepth);
  // Thin glass shell just outside the tank's actual swim bounds.
  const glassThickness = maxDim * 0.012;

  env.glassPanels.scale.set(worldWidth + glassThickness * 2, worldHeight + glassThickness * 2, worldDepth + glassThickness * 2);
  env.glassPanels.position.copy(center);

  // Metal frame: 12 thin bars tracing the outer glass box's edges,
  // narrower than the old line-drawn border and built with an actual
  // brushed-metal material so it catches specular highlights like real
  // aquarium framing.
  const frameBarThickness = maxDim * 0.016;
  const halfW = (worldWidth + glassThickness * 2) / 2;
  const halfH = (worldHeight + glassThickness * 2) / 2;
  const halfD = (worldDepth + glassThickness * 2) / 2;
  const edgeSpecs: { axis: 'x' | 'y' | 'z'; oy: number; oz: number; ox: number }[] = [
    // 4 edges running along X, at each Y/Z corner.
    { axis: 'x', oy: -halfH, oz: -halfD, ox: 0 },
    { axis: 'x', oy: -halfH, oz: halfD, ox: 0 },
    { axis: 'x', oy: halfH, oz: -halfD, ox: 0 },
    { axis: 'x', oy: halfH, oz: halfD, ox: 0 },
    // 4 edges running along Y, at each X/Z corner.
    { axis: 'y', ox: -halfW, oz: -halfD, oy: 0 },
    { axis: 'y', ox: -halfW, oz: halfD, oy: 0 },
    { axis: 'y', ox: halfW, oz: -halfD, oy: 0 },
    { axis: 'y', ox: halfW, oz: halfD, oy: 0 },
    // 4 edges running along Z, at each X/Y corner.
    { axis: 'z', ox: -halfW, oy: -halfH, oz: 0 },
    { axis: 'z', ox: -halfW, oy: halfH, oz: 0 },
    { axis: 'z', ox: halfW, oy: -halfH, oz: 0 },
    { axis: 'z', ox: halfW, oy: halfH, oz: 0 },
  ];
  edgeSpecs.forEach((spec, i) => {
    const bar = env.frame.getObjectByName(`frameBar${i}`) as THREE.Mesh;
    const length = spec.axis === 'x' ? worldWidth + glassThickness * 2 : spec.axis === 'y' ? worldHeight + glassThickness * 2 : worldDepth + glassThickness * 2;
    if (spec.axis === 'x') bar.scale.set(length, frameBarThickness, frameBarThickness);
    else if (spec.axis === 'y') bar.scale.set(frameBarThickness, length, frameBarThickness);
    else bar.scale.set(frameBarThickness, frameBarThickness, length);
    bar.position.set(center.x + spec.ox, center.y + spec.oy, center.z + spec.oz);
  });

  // Base trim: a dark plastic plinth bridging the small gap between the
  // glass box's bottom edge and the table surface beneath it, hiding
  // that seam the way real aquarium bases do.
  const trimFootprintX = worldWidth + glassThickness * 6;
  const trimFootprintZ = worldDepth + glassThickness * 6;

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
  const tableHeight = simMaxDim * 0.5;
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

  // Now that tableGap is known, size/position the base trim to bridge
  // exactly the gap between the glass box's bottom face (world y=0) and
  // the table surface beneath it.
  env.baseTrim.scale.set(trimFootprintX, tableGap * 1.8, trimFootprintZ);
  env.baseTrim.position.set(center.x, -tableGap * 0.9, center.z);

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
  // the tank/table, sized generously relative to the tank/table's own
  // horizontal footprint so it reads as a real room rather than a tight
  // diorama shell. wallMargin/roomHeight/roomFloorY come from
  // computeFishtankRoomBounds (computed once at the top of this
  // function) so they always stay exactly in sync with Renderer3D's
  // camera clamp, which calls that same function independently.
  const tankFootprint = Math.max(tableFootprintX, tableFootprintZ);
  const wallMargin = roomBounds.wallMargin;
  const roomFloorSize = wallMargin * 2;

  // Door height is anchored to the tank's own vertical size (tankTopY:
  // floor to the top of the glass, as actually installed on the table)
  // rather than a generic maxDim, so the tank always visually reads as
  // reaching up to about the height of the doors regardless of how big
  // TANK_VISUAL_SCALE makes it.
  const tankTopY = tableHeight + worldHeight;
  const doorHeight = tankTopY * 1.05;
  const doorScale = doorHeight / 1.7;
  const roomHeight = roomBounds.roomHeight;
  const roomFloorY = roomBounds.roomFloorY;

  // Small epsilon used to hug door/window/art flush against a wall
  // surface without exact z-fighting coincidence — sized off wallMargin
  // (the room's own scale) rather than maxDim, so it stays a small
  // fraction of the room at any tank size instead of ballooning into a
  // gap large enough to read as the decor "floating" in front of the
  // wall instead of on it.
  const wallHug = wallMargin * 0.003;

  env.roomFloor.scale.set(roomFloorSize, roomFloorSize, 1);
  env.roomFloor.position.set(center.x, roomFloorY, center.z);
  // Repeat the checker texture so each tile reads at a believable
  // real-world size rather than one giant texture stretched over the
  // whole floor.
  const floorMap = (env.roomFloor.material as THREE.MeshStandardMaterial).map;
  if (floorMap) {
    // Divisor doubled (tankFootprint * 1.0, was * 0.5) so each tile
    // reads as twice as large per an explicit ask, without changing how
    // tileRepeats scales with the room's own footprint.
    const tileRepeats = roomFloorSize / (tankFootprint * 1.0);
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
  env.door.scale.set(doorScale, doorScale * 1.7, doorScale);
  env.door.position.set(
    center.x + wallMargin - wallHug,
    roomFloorY + (doorScale * 1.7) / 2,
    center.z - wallMargin * 0.35,
  );
  env.door.rotation.y = -Math.PI / 2;

  // Windows: one on the left wall, one on the front wall, both at
  // roughly eye-level height above the floor. Sized off doorHeight
  // (a fixed, sane real-world-ish reference) rather than the old
  // depth-dominated maxDim.
  const windowScale = doorHeight * 0.7;
  const windowY = roomFloorY + roomHeight * 0.35;
  env.windowLeft.scale.set(windowScale, windowScale, windowScale);
  env.windowLeft.position.set(center.x - wallMargin + wallHug, windowY, center.z + wallMargin * 0.4);
  env.windowLeft.rotation.y = Math.PI / 2;

  env.windowFront.scale.set(windowScale, windowScale, windowScale);
  env.windowFront.position.set(center.x - wallMargin * 0.45, windowY, center.z + wallMargin - wallHug);
  env.windowFront.rotation.y = Math.PI;

  // Art: two pieces on the back accent wall flanking the tank, one on
  // the front wall beside its window.
  const artScale = doorHeight * 0.5;
  const artY = roomFloorY + roomHeight * 0.4;
  const [artBackLeft, artBackRight, artFront] = env.artPieces;
  artBackLeft.scale.set(artScale, artScale, artScale);
  artBackLeft.position.set(center.x - wallMargin * 0.55, artY, center.z - wallMargin + wallHug);
  artBackRight.scale.set(artScale, artScale, artScale);
  artBackRight.position.set(center.x + wallMargin * 0.55, artY, center.z - wallMargin + wallHug);
  artFront.scale.set(artScale, artScale, artScale);
  artFront.position.set(center.x + wallMargin * 0.45, artY, center.z + wallMargin - wallHug);
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
  // THREE.Fog measures distance from the *camera*, not from the tank.
  // The camera is always somewhere inside the room (maxDistance is
  // clamped below wallMargin — see Renderer3D), so the farthest any
  // room surface (e.g. the wall behind the camera, seen reflected
  // across the room) can be is roughly 2 * wallMargin away. fog.near
  // must clear that worst case entirely, or walls/decor read as
  // washed out in a flat blue haze instead of being clearly visible —
  // exactly the "can't see the walls" bug this previously caused when
  // near/far were set relative to the tank's own (much smaller) size
  // rather than the room's.
  env.fog.near = wallMargin * 2.5;
  env.fog.far = wallMargin * 6;
}

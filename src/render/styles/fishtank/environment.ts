import * as THREE from 'three';
import type { TimeOfDayPreset } from '../../../sim/params';
import {
  createCheckerTexture,
  createArtPiece,
  createDoor,
  createOverheadLamp,
  createBench,
  createCornerStatue,
  createUpperFrieze,
  type CornerStatueKind,
  createTankWindow,
  rebuildTankWindow,
  createExhibitLabel,
  createServiceVent,
  createWayfindingSign,
  type OverheadLamp,
} from './roomDecor';

/**
 * "Fish tank" style environment: a glass aquarium box (matching the sim's
 * actual world bounds exactly, so the glass reads as a real container the
 * fish swim inside) sitting directly on the floor — like a genuine giant
 * public-aquarium exhibit tank rather than a household tank on a table —
 * inside a fully enclosed room: floor, ceiling, four walls, an overhead
 * light, several doors (including exits with illuminated signage), and
 * fish-themed wall art, so the scene reads as a real public-aquarium
 * gallery space the tank sits in, whichever way the camera orbits, not
 * just a two-wall backdrop.
 *
 * The room's human-scale reference props (doors, art) are intentionally
 * sized off the sim's fixed, unscaled dimensions rather than the
 * TANK_VISUAL_SCALE-inflated tank — this is what actually sells the
 * "giant tank" scale illusion: a normal-sized door standing next to a
 * tank that towers many multiples of its height reads as monumental,
 * whereas doors/windows that grew right along with the tank (as they
 * used to) never conveyed any sense of scale at all.
 *
 * This is an independent module from nature's environment.ts — a future
 * "fish tank scenery" pass can freely add tank features (gravel, plants,
 * bubbles, caustics, etc.) without touching nature's ground/mountains/
 * lakes code, or risking merge conflicts with work in progress there.
 */
export interface FishtankEnvironment {
  waterFill: THREE.Mesh;
  glassPanels: THREE.Mesh;
  frame: THREE.Group;
  baseTrim: THREE.Mesh;
  roomFloor: THREE.Mesh;
  roomCeiling: THREE.Mesh;
  roomWallBack: THREE.Mesh;
  roomWallLeft: THREE.Mesh;
  roomWallRight: THREE.Mesh;
  roomWallFront: THREE.Mesh;
  /** Main entrance door, right wall — no signage, just the everyday way in. */
  door: THREE.Group;
  /** Exit doors (left + front walls), each with its own illuminated "EXIT" sign mounted above the frame, like a public building's emergency exits. */
  exitDoors: THREE.Group[];
  artPieces: THREE.Group[];
  /** 8 ceiling-mounted overhead lamps distributed across the floor around the tank (not directly above it) — replacing the old single centered lamp. */
  lamps: OverheadLamp[];
  /** 4 backless wooden gallery benches, one on each side of the tank (N/E/S/W), about halfway between the tank and the walls — museum/aquarium-hall seating. */
  benches: THREE.Group[];
  /** 4 aquarium-themed corner sculptures (coral/starfish/shell clusters), one in each open corner floor square. */
  cornerSculptures: THREE.Group[];
  /** Small static "other tank" wall windows, filling open wall stretches not covered by a mural — suggesting a wing of smaller neighboring exhibit tanks. No animation, just a dim static backdrop + a glossy glass pane. */
  tankWindows: THREE.Group[];
  sectionWindows: THREE.Group[];
  /** Small museum-style placards mounted beside each tank window (see tankWindows) — sells the exhibit-hall feel. */
  exhibitLabels: THREE.Group[];
  upperFriezeSegments: THREE.Group[];
  serviceVents: THREE.Group[];
  wayfindingSigns: THREE.Group[];
  ambientLight: THREE.AmbientLight;
  hemisphereLight: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  bounceLights: THREE.PointLight[];
  fog: THREE.Fog;
  caustics: THREE.Mesh;
  suspendedParticles: THREE.Points;
  /** Call once per frame while fishtank style is active (animates caustics + suspended particles). */
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  /** Independently toggle scene fog on/off without affecting overall fishtank-style visibility. */
  setFogEnabled(enabled: boolean): void;
  /**
   * Independently hides/shows just the surrounding room (floor,
   * ceiling, walls, doors, art, lamps) without touching the tank
   * itself (glass/water/tank lighting) — used by the Model Gallery so a
   * close-up, creature-relative camera distance can sit *inside* the
   * tank/water volume without the room being visible (nonsensically)
   * through the transparent glass behind the creature.
   */
  setRoomVisible(visible: boolean): void;
  setTimeOfDay(preset: TimeOfDayPreset): void;
  setWaterEffectsEnabled(enabled: boolean): void;
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
   * y=0, standing directly on the floor, see placeFishtankEnvironment's
   * `center.y` doc comment) — the right height for the orbit camera to
   * look at, rather than the sim's raw/unscaled vertical center, which
   * sits near the tank's *bottom* once the tank is scaled up (since the
   * tank only grows upward from y=0, not around its raw center).
   */
  tankCenterY: number;
  /**
   * Largest orbit-camera distance (from the tank's true center, see
   * `tankCenterY`) that still keeps the camera comfortably inside the
   * room's floor/ceiling/walls at every *permitted* orbit tilt (see
   * `cameraTiltUpRad`/`cameraTiltDownRad`). The tank now stands directly
   * on the floor (no table) and the ceiling sits only a modest headroom
   * fraction above the tank's own top (see `roomHeight`'s derivation in
   * `computeFishtankRoomBounds`) — a real giant-aquarium-exhibit room
   * reads as "the tank reaches nearly to the ceiling", which necessarily
   * means less vertical headroom than the old table-mounted design had,
   * so `cameraTiltUpRad` is more modest than it once was. Restricting
   * *tilt* (rather than zoom-out distance) is still what buys back a
   * more generous zoom-out range while remaining mathematically
   * guaranteed never to clip through the floor/ceiling.
   */
  maxCameraDistance: number;
  /**
   * Max allowed tilt (radians) *upward* from horizontal (toward looking
   * down at the tank from above), applied as Renderer3D's OrbitControls
   * minPolarAngle (Math.PI/2 - this value). Somewhat larger than
   * `cameraTiltDownRad` since the ceiling still has more clearance above
   * the tank's center than the floor does below it, but much more
   * modest than the old table-mounted design's headroom allowed, now
   * that the tank stands on the floor and its top sits close to the
   * ceiling (see `roomHeight`'s headroom fraction in
   * `computeFishtankRoomBounds`).
   */
  cameraTiltUpRad: number;
  /**
   * Max allowed tilt (radians) *downward* from horizontal (toward
   * looking up at the tank from below), applied as Renderer3D's
   * OrbitControls maxPolarAngle (Math.PI/2 + this value). Kept modest
   * because the tank stands directly on the floor, so the tank's center
   * is fairly close to the floor — a generous down-tilt at any real
   * zoom-out distance would clip through the floor. Restricting *this*
   * direction's tilt (rather than clamping zoom-out distance itself) is
   * what buys back a much more generous zoom-out range while remaining
   * mathematically guaranteed never to clip through the floor no matter
   * how the user orbits within the permitted tilt range.
   */
  cameraTiltDownRad: number;
  /**
   * Fixed-scale door/art-prop reference height, derived from the sim's
   * raw/unscaled dimensions rather than the inflated tank size — see its
   * derivation below for why this must NOT scale with TANK_VISUAL_SCALE.
   * Exported here (rather than only computed locally in
   * placeFishtankEnvironment) so nothing else that might need this fixed
   * "human scale" reference has to duplicate the formula.
   */
  doorHeight: number;
  /**
   * Multiplier applied to the tank's raw (sim-derived) swim height to
   * get the actual rendered glass box height — intentionally taller
   * than the sim's own vertical swim range (rather than exactly matching
   * it, as this used to) so there's headroom above the highest point any
   * fish/predator can actually reach, and the water fill (see
   * `waterLevelFrac`) can sit clearly above that range too — fixing
   * fish/sharks visually poking their nose/tail out of the water at the
   * top of their swim range.
   */
  tankHeightScale: number;
  /**
   * Fraction of the (already-taller, see `tankHeightScale`) glass box
   * height that the water actually fills, leaving a thin air gap at the
   * very top of the glass — like a real aquarium's water line sitting
   * just under the rim, rather than flush with the glass top.
   */
  waterLevelFrac: number;
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

  // Room footprint is now derived directly from the tank's own footprint
  // (no more table, so no table-footprint multiplier) — still padded out
  // (1.3x) so the room reads as a real gallery space around the tank
  // rather than a tight diorama shell hugging the glass.
  const tankFootprint = Math.max(worldWidth, worldDepth) * 1.15;
  const wallMargin = tankFootprint * 1.3;

  // Door height is now a FIXED reference independent of TANK_VISUAL_SCALE
  // (derived from the sim's raw/unscaled dimensions, not the inflated
  // tank), so a bigger tank doesn't drag the doors up in size with it —
  // this fixed "human scale" prop is what actually sells the giant-tank
  // illusion: a normal-height door standing next to a tank many multiples
  // taller reads as monumental, whereas a door that grew right along
  // with the tank (as it used to) never conveyed scale at all.
  const doorHeight = simMaxDim * 0.55;

  // The tank now stands directly on the floor (bottom-anchored at y=0,
  // no table beneath it — see placeFishtankEnvironment's `center.y` doc
  // comment). Its glass top is intentionally taller than the sim's own
  // vertical swim range (`worldHeight`, the fish's actual max Y) — see
  // `tankHeightScale`'s doc comment — so there's headroom above the
  // highest a fish/predator can actually reach, and the water fill (see
  // `waterLevelFrac`) sits clearly above that range too, instead of
  // flush with the glass top as it used to (which left fish/sharks at
  // the top of their swim range visibly poking out of the water).
  const tankHeightScale = 1.22;
  const waterLevelFrac = 0.94;
  const tankTopY = worldHeight * tankHeightScale;
  const maxDim = Math.max(worldWidth, worldHeight, worldDepth);
  const glassThickness = maxDim * 0.012;
  // Tiny gap between the glass box's bottom face and the floor beneath
  // it (bridged by baseTrim), replacing the old glass-to-table gap.
  const floorGap = glassThickness * 1.5;
  const roomFloorY = -floorGap;

  // Ceiling sits only a modest fraction of the tank's own height above
  // its top (rather than many multiples of doorHeight, as the old
  // table-mounted design did) — per the ask that "the tank can go all
  // the way up to a very tall ceiling": the tank itself now dominates
  // the room's vertical space (~70-75% of roomHeight) instead of being
  // a small fixture dwarfed by a cavernous ceiling.
  const headroomFrac = 0.35;
  const roomHeight = tankTopY * (1 + headroomFrac) - roomFloorY;

  // The tank is bottom-anchored at y=0 and grows upward (see
  // placeFishtankEnvironment's `center.y` doc comment), so its true
  // vertical middle — the right point for the camera to look at — is
  // simply half its (scaled) height, not the sim's raw vertical center.
  const tankCenterY = worldHeight / 2;
  const distToCeiling = roomFloorY + roomHeight - tankCenterY;
  const distToFloor = tankCenterY - roomFloorY;
  // Asymmetric tilt limits (see cameraTiltUpRad/cameraTiltDownRad's doc
  // comments) — more modest than the old table-mounted design's 60°/18°
  // now that the ceiling headroom above the tank is deliberately small
  // (the tank itself, not empty headroom, is what should dominate the
  // room's vertical space).
  const cameraTiltUpRad = Math.PI * (30 / 180);
  const cameraTiltDownRad = Math.PI * (18 / 180);
  // Solve for the largest distance where, even at each direction's own
  // steepest permitted tilt, `distance * sin(tilt)` still clears that
  // direction's own vertical clearance (with a small safety factor).
  const upCap = (distToCeiling / Math.sin(cameraTiltUpRad)) * 0.9;
  const downCap = (distToFloor / Math.sin(cameraTiltDownRad)) * 0.9;
  // wallMargin caps the *horizontal* side at the larger of the two
  // tilts (cos being smallest, i.e. most restrictive, at the steeper
  // tilt) so the camera also can't be pushed out past the walls at a
  // shallow-enough tilt.
  const horizontalCap = (wallMargin / Math.cos(Math.max(cameraTiltUpRad, cameraTiltDownRad))) * 0.9;
  const maxCameraDistance = Math.min(upCap, downCap, horizontalCap);

  return {
    wallMargin,
    roomHeight,
    roomFloorY,
    tankCenterY,
    maxCameraDistance,
    cameraTiltUpRad,
    cameraTiltDownRad,
    doorHeight,
    tankHeightScale,
    waterLevelFrac,
  };
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

interface TankLightingPreset {
  ambient: number;
  hemi: number;
  key: number;
  keyColor: number;
  fogColor: number;
  waterColor: number;
  wallColor: number;
  accentWallColor: number;
  ceilingColor: number;
  causticsBaseOpacity: number;
  particleOpacity: number;
}

const TANK_LIGHTING_PRESETS: Record<TimeOfDayPreset, TankLightingPreset> = {
  dawn: {
    ambient: 0.34,
    hemi: 0.4,
    key: 0.62,
    keyColor: 0xffd7bb,
    fogColor: 0x245b7f,
    waterColor: 0x145b84,
    wallColor: 0xe7dfd2,
    accentWallColor: 0x809373,
    ceilingColor: 0xf3ede0,
    causticsBaseOpacity: 0.15,
    particleOpacity: 0.27,
  },
  noon: {
    ambient: 0.4,
    hemi: 0.46,
    key: 0.78,
    keyColor: 0xfff6e8,
    fogColor: WATER_COLOR,
    waterColor: WATER_COLOR,
    wallColor: WALL_COLOR,
    accentWallColor: ACCENT_WALL_COLOR,
    ceilingColor: CEILING_COLOR,
    causticsBaseOpacity: 0.17,
    particleOpacity: 0.3,
  },
  sunset: {
    ambient: 0.33,
    hemi: 0.39,
    key: 0.6,
    keyColor: 0xffc89f,
    fogColor: 0x2d5a73,
    waterColor: 0x11567a,
    wallColor: 0xe2d7c9,
    accentWallColor: 0x7a876b,
    ceilingColor: 0xeee6d8,
    causticsBaseOpacity: 0.14,
    particleOpacity: 0.26,
  },
  night: {
    ambient: 0.24,
    hemi: 0.28,
    key: 0.35,
    keyColor: 0x97b7ff,
    fogColor: 0x0c2334,
    waterColor: 0x0a3858,
    wallColor: 0xc8c2b8,
    accentWallColor: 0x647364,
    ceilingColor: 0xd8d3c8,
    causticsBaseOpacity: 0.09,
    particleOpacity: 0.2,
  },
};

function createCausticsTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.05 + Math.random() * 0.12);
    const gradient = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
  glassPanels.receiveShadow = true;

  // A dark plastic/rubber base plinth just under the glass, hiding the
  // seam where the tank meets the table — a detail seen on virtually
  // every real aquarium.
  const baseTrimMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.7, metalness: 0.1 });
  const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseTrimMaterial);
  baseTrim.visible = false;
  baseTrim.castShadow = true;
  baseTrim.receiveShadow = true;

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
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: WATER_COLOR,
    transparent: true,
    opacity: 0.34,
    transmission: 0.35,
    thickness: 0.8,
    ior: 1.07,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const waterFill = new THREE.Mesh(waterGeometry, waterMaterial);
  waterFill.visible = false;
  waterFill.receiveShadow = true;
  const causticsTexture = createCausticsTexture();
  const causticsMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fdfff,
    map: causticsTexture,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), causticsMaterial);
  caustics.rotation.x = -Math.PI / 2;
  caustics.visible = false;

  const particleCount = 750;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSeeds = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3 + 0] = Math.random() - 0.5;
    particlePositions[i * 3 + 1] = Math.random() - 0.5;
    particlePositions[i * 3 + 2] = Math.random() - 0.5;
    particleSeeds[i] = Math.random();
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('seed', new THREE.BufferAttribute(particleSeeds, 1));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xc9f1ff,
    size: 0.8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const suspendedParticles = new THREE.Points(particleGeometry, particleMaterial);
  suspendedParticles.visible = false;

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
  roomFloor.receiveShadow = true;

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
  roomCeiling.receiveShadow = true;

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
  roomWallBack.receiveShadow = true;
  // Left/right/front walls share the same off-white material/geometry —
  // sharing is fine since none of these are ever disposed independently
  // (they all go away together in dispose()).
  const roomWallLeft = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallLeft.rotation.y = Math.PI / 2;
  roomWallLeft.visible = false;
  roomWallLeft.receiveShadow = true;
  const roomWallRight = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallRight.rotation.y = -Math.PI / 2;
  roomWallRight.visible = false;
  roomWallRight.receiveShadow = true;
  const roomWallFront = new THREE.Mesh(wallGeometry, wallMaterial);
  roomWallFront.rotation.y = Math.PI;
  roomWallFront.visible = false;
  roomWallFront.receiveShadow = true;

  // Main entrance door on the right wall (no signage), exit doors (each
  // with its own illuminated "EXIT" sign) on the left and front walls —
  // replacing the old windows entirely, since a reflective glass pane
  // was causing rendering artifacts and a public-aquarium exhibit hall
  // plausibly has multiple marked exits anyway. Four fish-themed framed
  // art pieces spread across the back/front/right walls fill out the
  // gallery feel.
  const door = createDoor();
  door.visible = false;
  const exitDoors = [createDoor(true), createDoor(true)];
  exitDoors.forEach((d) => {
    d.visible = false;
  });
  const artPieces = [
    createArtPiece('schoolOfFish'),
    createArtPiece('coralReef'),
    createArtPiece('jellyfish'),
    createArtPiece('seahorseSilhouette'),
    // Four large wide-format murals, scaled up to match the room's own
    // giant-aquarium scale (see placeFishtankEnvironment's mural
    // placement below) — the four pieces above stay small and are
    // deliberately kept as-is, doubling as a visual size reference
    // against these much bigger murals and the tank itself.
    createArtPiece('blueWhale', 2.4),
    createArtPiece('welcomeSign', 2.2),
    createArtPiece('giantSquid', 2.2),
    createArtPiece('seaTurtle', 2.0),
  ];
  artPieces.forEach((piece) => {
    piece.visible = false;
  });

  // 4 backless wooden benches, one per side of the tank — plain gallery
  // seating, no backrest, to match a museum/aquarium exhibit hall.
  const benches = Array.from({ length: 4 }, () => createBench());
  benches.forEach((bench) => {
    bench.visible = false;
  });

  // 4 bronze marine-animal statues (whale, dolphin, sea turtle, shark),
  // one per diagonal corner floor square — each a distinct species so
  // the four don't repeat, matching a real aquarium's habit of putting
  // a different sculpture centerpiece in each gallery corner.
  const cornerStatueKinds: CornerStatueKind[] = ['whale', 'dolphin', 'turtle', 'shark'];
  const cornerSculptures = cornerStatueKinds.map((kind) => createCornerStatue(kind));
  cornerSculptures.forEach((sculpture) => {
    sculpture.visible = false;
  });

  // Small static "other tank" windows, filling open wall stretches that
  // aren't already covered by a door/mural — 2 per wall, positioned in
  // placeFishtankEnvironment below.
  const tankWindows = Array.from({ length: 8 }, () => createTankWindow());
  tankWindows.forEach((win) => {
    win.visible = false;
  });

  // Two larger windows into neighboring aquarium sections, one on each
  // long side wall, so the room feels like part of a bigger aquarium wing
  // rather than a completely sealed box.
  const sectionWindows = [createTankWindow(2.8), createTankWindow(2.8)];
  sectionWindows.forEach((win) => {
    win.visible = false;
  });

  // A small museum-style placard beside each tank window above, with a
  // generic exhibit-hall title/subtitle — sells the "real aquarium wing"
  // feel, matching the (window order: back-left, back-right, front-left,
  // front-right, left-far, left-near, right-far, right-near) ordering.
  const exhibitLabels = [
    createExhibitLabel('Coral Shallows', 'Reef community exhibit'),
    createExhibitLabel('Open Water School', 'Pelagic species'),
    createExhibitLabel('Tide Pool Wing', 'Coastal species'),
    createExhibitLabel('Kelp Forest', 'Temperate species'),
    createExhibitLabel('Deep Blue Wing', 'Mid-water species'),
    createExhibitLabel('Mangrove Shallows', 'Juvenile species'),
    createExhibitLabel('Cold Water Wing', 'Northern species'),
    createExhibitLabel('Estuary Habitat', 'Brackish species'),
  ];
  exhibitLabels.forEach((label) => {
    label.visible = false;
  });

  // Simple upper-wall dressing: a thin frieze band, a few service vents,
  // and small wayfinding plaques so the top of the room doesn't read as
  // a huge empty rectangle.
  const upperFriezeSegments = Array.from({ length: 4 }, () => createUpperFrieze());
  upperFriezeSegments.forEach((segment) => {
    segment.visible = false;
  });

  const serviceVents = Array.from({ length: 6 }, () => createServiceVent());
  serviceVents.forEach((vent) => {
    vent.visible = false;
  });

  const wayfindingSigns = [
    createWayfindingSign('Gallery Wing', 'right'),
    createWayfindingSign('Exhibits', 'left'),
    createWayfindingSign('Aquarium Hall', 'right'),
    createWayfindingSign('Entry Lobby', 'left'),
  ];
  wayfindingSigns.forEach((sign) => {
    sign.visible = false;
  });

  // 8 ceiling lamps distributed around the floor outside the tank
  // footprint (positioned in placeFishtankEnvironment below), replacing
  // the old single lamp centered directly above the tank — eight simple
  // spotlights is a trivial cost for WebGL to render (nowhere near
  // enough lights to be a real perf concern) and reads as a proper
  // gallery-hall lighting grid instead of a single household pendant.
  const lamps = Array.from({ length: 8 }, () => createOverheadLamp());
  lamps.forEach((lamp) => {
    lamp.group.visible = false;
    lamp.light.visible = false;
  });

  const ambientLight = new THREE.AmbientLight(0xd8ecff, 0.38);
  const hemisphereLight = new THREE.HemisphereLight(0xcfeeff, 0x675042, 0.42);
  const bounceLights = Array.from({ length: 4 }, (_, i) => {
    const light = new THREE.PointLight(i % 2 === 0 ? 0xe3f4ff : 0xfff0df, 0.14, 0, 2);
    light.visible = false;
    return light;
  });
  const keyLight = new THREE.DirectionalLight(0xfff6e8, 0.7);
  // Soft light from above, like an overhead room/tank hood lamp rather
  // than nature's low sun angle.
  keyLight.position.set(0.4, 1, 0.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1536, 1536);
  keyLight.shadow.radius = 3;
  ambientLight.visible = false;
  hemisphereLight.visible = false;
  keyLight.visible = false;

  // Fog is scoped tightly to roughly the tank's own scale (see
  // placeFishtankEnvironment) rather than nature's whole-world haze, so it
  // reads as "water murkiness" for fish near the far glass wall when
  // viewed from up close/inside the tank without ever visibly touching
  // the rest of the room.
  const fog = new THREE.Fog(WATER_COLOR, 10, 4000);

  scene.add(
    glassPanels,
    frame,
    baseTrim,
    waterFill,
    caustics,
    suspendedParticles,
    roomFloor,
    roomCeiling,
    roomWallBack,
    roomWallLeft,
    roomWallRight,
    roomWallFront,
    door,
    ...exitDoors,
    ...artPieces,
    ...benches,
    ...cornerSculptures,
    ...tankWindows,
    ...sectionWindows,
    ...exhibitLabels,
    ...upperFriezeSegments,
    ...serviceVents,
    ...wayfindingSigns,
    ...lamps.map((lamp) => lamp.group),
    ambientLight,
    hemisphereLight,
    ...bounceLights,
    keyLight,
  );

  let fogEnabled = true;
  let waterEffectsEnabled = true;
  let causticsBaseOpacity = TANK_LIGHTING_PRESETS.noon.causticsBaseOpacity;
  let particlesBaseOpacity = TANK_LIGHTING_PRESETS.noon.particleOpacity;

  const applyTimeOfDay = (preset: TimeOfDayPreset): void => {
    const settings = TANK_LIGHTING_PRESETS[preset];
    ambientLight.intensity = settings.ambient;
    hemisphereLight.intensity = settings.hemi;
    keyLight.intensity = settings.key;
    keyLight.color.setHex(settings.keyColor);
    fog.color.setHex(settings.fogColor);
    waterMaterial.color.setHex(settings.waterColor);
    wallMaterial.color.setHex(settings.wallColor);
    accentWallMaterial.color.setHex(settings.accentWallColor);
    ceilingMaterial.color.setHex(settings.ceilingColor);
    causticsBaseOpacity = settings.causticsBaseOpacity;
    particlesBaseOpacity = settings.particleOpacity;
  };
  applyTimeOfDay('noon');

  return {
    waterFill,
    glassPanels,
    frame,
    baseTrim,
    roomFloor,
    roomCeiling,
    roomWallBack,
    roomWallLeft,
    roomWallRight,
    roomWallFront,
    door,
    exitDoors,
    artPieces,
    benches,
    cornerSculptures,
    tankWindows,
    sectionWindows,
    exhibitLabels,
    upperFriezeSegments,
    serviceVents,
    wayfindingSigns,
    lamps,
    ambientLight,
    hemisphereLight,
    keyLight,
    bounceLights,
    fog,
    caustics,
    suspendedParticles,
    update(elapsed: number) {
      if (!waterFill.visible) return;
      const causticsMap = causticsMaterial.map;
      if (causticsMap) {
        causticsMap.offset.x = elapsed * 0.025;
        causticsMap.offset.y = elapsed * 0.018;
      }
      causticsMaterial.opacity = waterEffectsEnabled ? causticsBaseOpacity + Math.sin(elapsed * 1.3) * 0.035 : 0;
      particleMaterial.opacity = waterEffectsEnabled ? particlesBaseOpacity : 0;

      const positions = particleGeometry.getAttribute('position') as THREE.BufferAttribute;
      const seeds = particleGeometry.getAttribute('seed') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const sx = seeds.getX(i);
        const y = ((sx * 8 + elapsed * 0.035) % 1) - 0.5;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
    },
    setVisible(visible: boolean) {
      glassPanels.visible = visible;
      frame.visible = visible;
      baseTrim.visible = visible;
      waterFill.visible = visible;
      caustics.visible = visible && waterEffectsEnabled;
      suspendedParticles.visible = visible && waterEffectsEnabled;
      roomFloor.visible = visible;
      roomCeiling.visible = visible;
      roomWallBack.visible = visible;
      roomWallLeft.visible = visible;
      roomWallRight.visible = visible;
      roomWallFront.visible = visible;
      door.visible = visible;
      exitDoors.forEach((d) => {
        d.visible = visible;
      });
      artPieces.forEach((piece) => {
        piece.visible = visible;
      });
      benches.forEach((bench) => {
        bench.visible = visible;
      });
      cornerSculptures.forEach((sculpture) => {
        sculpture.visible = visible;
      });
      tankWindows.forEach((win) => {
        win.visible = visible;
      });
      sectionWindows.forEach((win) => {
        win.visible = visible;
      });
      exhibitLabels.forEach((label) => {
        label.visible = visible;
      });
      upperFriezeSegments.forEach((segment) => {
        segment.visible = visible;
      });
      serviceVents.forEach((vent) => {
        vent.visible = visible;
      });
      wayfindingSigns.forEach((sign) => {
        sign.visible = visible;
      });
      lamps.forEach((lamp) => {
        lamp.group.visible = visible;
        lamp.light.visible = visible;
      });
      ambientLight.visible = visible;
      hemisphereLight.visible = visible;
      bounceLights.forEach((light) => {
        light.visible = visible;
      });
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
    setTimeOfDay(preset: TimeOfDayPreset) {
      applyTimeOfDay(preset);
    },
    setWaterEffectsEnabled(enabled: boolean) {
      waterEffectsEnabled = enabled;
      const visible = waterFill.visible && enabled;
      caustics.visible = visible;
      suspendedParticles.visible = visible;
    },
    setRoomVisible(visible: boolean) {
      // Guarded by waterFill.visible (same pattern as setFogEnabled) so
      // this only touches the room while fishtank is actually the active
      // style — Renderer3D calls this every frame regardless of which
      // style is active, and unconditionally setting visible here would
      // un-hide the whole room even while nature/arcade is active (the
      // room's still in the scene graph, just hidden via setVisible).
      if (!waterFill.visible) return;
      roomFloor.visible = visible;
      roomCeiling.visible = visible;
      roomWallBack.visible = visible;
      roomWallLeft.visible = visible;
      roomWallRight.visible = visible;
      roomWallFront.visible = visible;
      door.visible = visible;
      exitDoors.forEach((d) => {
        d.visible = visible;
      });
      artPieces.forEach((piece) => {
        piece.visible = visible;
      });
      benches.forEach((bench) => {
        bench.visible = visible;
      });
      cornerSculptures.forEach((sculpture) => {
        sculpture.visible = visible;
      });
      tankWindows.forEach((win) => {
        win.visible = visible;
      });
      sectionWindows.forEach((win) => {
        win.visible = visible;
      });
      exhibitLabels.forEach((label) => {
        label.visible = visible;
      });
      upperFriezeSegments.forEach((segment) => {
        segment.visible = visible;
      });
      serviceVents.forEach((vent) => {
        vent.visible = visible;
      });
      wayfindingSigns.forEach((sign) => {
        sign.visible = visible;
      });
      lamps.forEach((lamp) => {
        lamp.group.visible = visible;
        lamp.light.visible = visible;
      });
    },
    dispose() {
      scene.remove(
        glassPanels,
        frame,
        baseTrim,
        waterFill,
        caustics,
        suspendedParticles,
        roomFloor,
        roomCeiling,
        roomWallBack,
        roomWallLeft,
        roomWallRight,
        roomWallFront,
        door,
        ...exitDoors,
        ...artPieces,
        ...benches,
        ...cornerSculptures,
        ...tankWindows,
        ...sectionWindows,
        ...exhibitLabels,
        ...upperFriezeSegments,
        ...serviceVents,
        ...wayfindingSigns,
        ...lamps.map((lamp) => lamp.group),
        ambientLight,
        hemisphereLight,
        ...bounceLights,
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
      caustics.geometry.dispose();
      (caustics.material as THREE.MeshBasicMaterial).map?.dispose();
      (caustics.material as THREE.Material).dispose();
      suspendedParticles.geometry.dispose();
      (suspendedParticles.material as THREE.Material).dispose();
      roomFloor.geometry.dispose();
      (roomFloor.material as THREE.MeshStandardMaterial).map?.dispose();
      (roomFloor.material as THREE.Material).dispose();
      roomCeiling.geometry.dispose();
      (roomCeiling.material as THREE.Material).dispose();
      roomWallBack.geometry.dispose();
      accentWallMaterial.dispose();
      wallMaterial.dispose();
      disposeObject3D(door);
      exitDoors.forEach(disposeObject3D);
      artPieces.forEach(disposeObject3D);
      benches.forEach(disposeObject3D);
      cornerSculptures.forEach(disposeObject3D);
      tankWindows.forEach(disposeObject3D);
      sectionWindows.forEach(disposeObject3D);
      exhibitLabels.forEach(disposeObject3D);
      upperFriezeSegments.forEach(disposeObject3D);
      serviceVents.forEach(disposeObject3D);
      wayfindingSigns.forEach(disposeObject3D);
      lamps.forEach((lamp) => disposeObject3D(lamp.group));
    },
  };
}

/**
 * Sizes/positions the fishtank environment so the glass box matches the
 * sim's actual world bounds exactly (fish already swim within x:[0,width],
 * y:[0,height], z:[0,depth] — the same convention Renderer3D's debug
 * boundsHelper uses), sitting directly on the floor, then builds a
 * fully enclosed room around it (with fixed-scale door/art props
 * independent of the tank's own inflated size).
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

  // Horizontally (X/Z), the tank's center is fixed at the sim's actual
  // (unscaled) center — computed here, before worldWidth/Height/Depth are
  // inflated below — so the visually-bigger tank grows symmetrically
  // outward from the same point rather than shifting away from it. This
  // matters because Renderer3D's camera target/framing and fish
  // positions (see TANK_VISUAL_SCALE's doc comment) are anchored to this
  // same raw sim center horizontally.
  //
  // Vertically (Y) the tank is intentionally NOT grown around its
  // center: its bottom always sits at y=0 — directly on the room floor,
  // matching the sim's own y=0 swim-space floor, now that there's no
  // table underneath — and it grows upward from there as
  // TANK_VISUAL_SCALE increases. Growing around the vertical center
  // instead (as this used to) makes the tank's bottom sink further and
  // further *through* the floor the bigger the scale, since half of the
  // added height extends downward. Renderer3D mirrors this
  // bottom-anchored growth for fish (via `fishtankCenter`, y=0).
  const center = new THREE.Vector3(worldWidth / 2, 0, worldDepth / 2);

  // Inflate the tank's rendered dimensions (see TANK_VISUAL_SCALE's doc
  // comment) — every tank/water/room *size* measurement below is derived
  // from these scaled values, not the raw sim bounds passed in. Only
  // sizes are scaled here, never the horizontal center computed above.
  worldWidth *= TANK_VISUAL_SCALE;
  worldHeight *= TANK_VISUAL_SCALE;
  worldDepth *= TANK_VISUAL_SCALE;
  // The rendered glass box is intentionally taller than the fish's own
  // swim height (`worldHeight`) — see `tankHeightScale`'s doc comment on
  // FishtankRoomBounds — so there's headroom above the highest a
  // fish/predator can actually reach. Now that glassHeight is inflated,
  // place the tank's vertical center so its bottom lands at y=0 (see
  // comment above) — note this is the glass box's own center, NOT
  // `tankCenterY` (which stays anchored to the fish's actual swim range,
  // for the camera to look at, rather than drifting up into the now
  // taller-than-necessary glass).
  const glassHeight = worldHeight * roomBounds.tankHeightScale;
  center.y = glassHeight / 2;

  const maxDim = Math.max(worldWidth, glassHeight, worldDepth);
  // Thin glass shell just outside the tank's actual swim bounds.
  const glassThickness = maxDim * 0.012;

  env.glassPanels.scale.set(worldWidth + glassThickness * 2, glassHeight + glassThickness * 2, worldDepth + glassThickness * 2);
  env.glassPanels.position.copy(center);

  // Metal frame: 12 thin bars tracing the outer glass box's edges,
  // narrower than the old line-drawn border and built with an actual
  // brushed-metal material so it catches specular highlights like real
  // aquarium framing.
  const frameBarThickness = maxDim * 0.016;
  const halfW = (worldWidth + glassThickness * 2) / 2;
  const halfH = (glassHeight + glassThickness * 2) / 2;
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
    const length = spec.axis === 'x' ? worldWidth + glassThickness * 2 : spec.axis === 'y' ? glassHeight + glassThickness * 2 : worldDepth + glassThickness * 2;
    if (spec.axis === 'x') bar.scale.set(length, frameBarThickness, frameBarThickness);
    else if (spec.axis === 'y') bar.scale.set(frameBarThickness, length, frameBarThickness);
    else bar.scale.set(frameBarThickness, frameBarThickness, length);
    bar.position.set(center.x + spec.ox, center.y + spec.oy, center.z + spec.oz);
  });

  // Inset further than glassThickness so the water fill's faces are
  // never nearly-coplanar with the glass box's inner faces — too small a
  // gap here causes visible z-fighting moiré stripes at grazing viewing
  // angles (most noticeable looking across the tank floor).
  const inset = glassThickness * 4;
  // Water height is a fraction of the (taller-than-swim-range) glass
  // height — see `waterLevelFrac`'s doc comment — leaving a thin air gap
  // at the very top of the glass, like a real aquarium's water line.
  // Bottom-anchored at y=0 like the glass box itself (not centered on
  // the glass's own vertical middle), so the water surface sits at a
  // fixed height above the floor regardless of the inset.
  const waterHeight = glassHeight * roomBounds.waterLevelFrac;
  env.waterFill.scale.set(worldWidth - inset, waterHeight - inset, worldDepth - inset);
  env.waterFill.position.set(center.x, waterHeight / 2, center.z);
  env.caustics.scale.set(worldWidth * 0.98, worldDepth * 0.98, 1);
  env.caustics.position.set(center.x, roomBounds.roomFloorY + glassThickness * 2, center.z);
  env.suspendedParticles.scale.set(worldWidth - inset, waterHeight - inset, worldDepth - inset);
  env.suspendedParticles.position.set(center.x, waterHeight / 2, center.z);

  // Base trim: a dark plastic plinth bridging the small gap between the
  // glass box's bottom edge and the room floor beneath it (no table
  // anymore — the tank stands directly on the floor, like a genuine
  // giant public-aquarium exhibit tank), hiding that seam the way real
  // aquarium bases do.
  const trimFootprintX = worldWidth + glassThickness * 6;
  const trimFootprintZ = worldDepth + glassThickness * 6;
  // Extra gap below glassThickness so the floor never sits exactly
  // coplanar with the glass box's bottom face — an exact coincidence
  // there previously caused visible z-fighting stripes between the
  // (transparent) glass and the (opaque) floor where they'd otherwise
  // perfectly overlap.
  const floorGap = glassThickness * 1.5;
  env.baseTrim.scale.set(trimFootprintX, floorGap * 1.8, trimFootprintZ);
  env.baseTrim.position.set(center.x, -floorGap * 0.9, center.z);

  // Room: floor, ceiling, and four walls fully enclosing a box around
  // the tank, sized generously relative to the tank's own horizontal
  // footprint so it reads as a real room rather than a tight diorama
  // shell. wallMargin/roomHeight/roomFloorY come from
  // computeFishtankRoomBounds (computed once at the top of this
  // function) so they always stay exactly in sync with Renderer3D's
  // camera clamp, which calls that same function independently.
  const tankFootprint = Math.max(worldWidth, worldDepth) * 1.15;
  const wallMargin = roomBounds.wallMargin;
  const roomFloorSize = wallMargin * 2;

  // Door height is now a FIXED reference derived from the sim's raw,
  // unscaled dimensions (simMaxDim) rather than the tank's own (inflated)
  // height — see doorHeight's doc comment in computeFishtankRoomBounds
  // for why this fixed-scale prop is what actually sells the giant-tank
  // illusion, instead of scaling right along with TANK_VISUAL_SCALE.
  const doorHeight = roomBounds.doorHeight;
  const doorScale = doorHeight / 1.7;
  const roomHeight = roomBounds.roomHeight;
  const roomFloorY = roomBounds.roomFloorY;

  // Small epsilon used to hug door/art flush against a wall surface
  // without exact z-fighting coincidence — sized off wallMargin
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

  // Door on the right wall (main entrance), standing on the floor.
  env.door.scale.set(doorScale, doorScale * 1.7, doorScale);
  env.door.position.set(
    center.x + wallMargin - wallHug,
    roomFloorY + (doorScale * 1.7) / 2,
    center.z - wallMargin * 0.35,
  );
  env.door.rotation.y = -Math.PI / 2;

  // Exit doors: one on the left wall, one on the front wall — replacing
  // the old windows entirely (their reflective glass was causing
  // rendering artifacts, and a public-aquarium exhibit hall plausibly
  // has multiple marked emergency exits anyway). Each carries its own
  // illuminated "EXIT" sign mounted above the frame (added as a child in
  // createDoor, so it scales/rotates/positions along with the door
  // group automatically).
  const [exitLeft, exitFront] = env.exitDoors;
  exitLeft.scale.set(doorScale, doorScale * 1.7, doorScale);
  exitLeft.position.set(center.x - wallMargin + wallHug, roomFloorY + (doorScale * 1.7) / 2, center.z + wallMargin * 0.4);
  exitLeft.rotation.y = Math.PI / 2;

  exitFront.scale.set(doorScale, doorScale * 1.7, doorScale);
  exitFront.position.set(center.x - wallMargin * 0.45, roomFloorY + (doorScale * 1.7) / 2, center.z + wallMargin - wallHug);
  exitFront.rotation.y = Math.PI;

  // Art: fish-themed pieces spread across the back accent wall (flanking
  // the tank, the natural feature-wall placement), the front wall
  // (beside its exit door), and the right wall (beside the main door) —
  // a proper little aquarium gallery rather than a single decor pair.
  const artScale = doorHeight * 0.5;
  const [artBackLeft, artBackRight, artFront, artRight] = env.artPieces;
  // Lower all wall art together so the large landscape murals sit a bit
  // more human-scale: their lower edge lands near the top of the doors,
  // and the smaller paintings drop by the same amount.
  const largeMuralScale = doorHeight * 2.2;
  const largeMuralHalfHeight = largeMuralScale * 0.56;
  const wallArtDrop = roomFloorY + doorHeight - (roomFloorY + roomHeight * 0.45 - largeMuralHalfHeight);
  const artY = roomFloorY + roomHeight * 0.4 + wallArtDrop;
  artBackLeft.scale.set(artScale, artScale, artScale);
  artBackLeft.position.set(center.x - wallMargin * 0.55, artY, center.z - wallMargin + wallHug);
  artBackRight.scale.set(artScale, artScale, artScale);
  artBackRight.position.set(center.x + wallMargin * 0.55, artY, center.z - wallMargin + wallHug);
  artFront.scale.set(artScale, artScale, artScale);
  artFront.position.set(center.x + wallMargin * 0.45, artY, center.z + wallMargin - wallHug);
  artFront.rotation.y = Math.PI;
  artRight.scale.set(artScale, artScale, artScale);
  artRight.position.set(center.x + wallMargin - wallHug, artY, center.z + wallMargin * 0.4);
  artRight.rotation.y = -Math.PI / 2;

  // Two large murals, scaled up to match the room's own giant-aquarium
  // proportions rather than the small human-scale reference pieces
  // above — positioned clear of the doors/small art already on their
  // walls (see the per-wall x/z fractions used above).
  const [, , , , muralWhale, muralWelcome] = env.artPieces;
  const muralY = roomFloorY + roomHeight * 0.45 + wallArtDrop;
  // createArtPiece's frame is BoxGeometry(1.12 * aspect, 1.12, 0.06), so
  // half-width in world units is scale * aspect * 0.56 — used below to
  // compute exact open-gap boundaries for the small tank windows so they
  // can never overlap a mural, regardless of the room's actual (runtime-
  // dependent) dimensions.
  const artHalfWidth = artScale * 0.56;
  const doorHalfWidth = doorScale * 0.54; // door frame local width 1.08

  // Blue whale landscape mural: centered on the (otherwise mostly bare)
  // left wall, clear of exitLeft (parked at wallMargin * 0.4 along Z).
  const whaleAspect = 2.4;
  const whaleScale = largeMuralScale;
  const whaleHalfWidth = whaleScale * whaleAspect * 0.56;
  muralWhale.scale.set(whaleScale, whaleScale, whaleScale);
  muralWhale.position.set(center.x - wallMargin + wallHug, muralY, center.z);
  muralWhale.rotation.y = Math.PI / 2;

  // "Lily and Mia's Aquarium" welcome mural: centered on the front wall,
  // clear of exitFront/artFront (parked at ±wallMargin * 0.45 along X).
  const welcomeAspect = 2.2;
  const welcomeScale = doorHeight * 1.8;
  const welcomeHalfWidth = welcomeScale * welcomeAspect * 0.56;
  muralWelcome.scale.set(welcomeScale, welcomeScale, welcomeScale);
  muralWelcome.position.set(center.x, muralY, center.z + wallMargin - wallHug);
  muralWelcome.rotation.y = Math.PI;

  // Giant squid landscape mural: centered on the right wall (the last
  // beige wall without a big feature), clear of the main door (parked
  // at -wallMargin * 0.35) and artRight (parked at +wallMargin * 0.4).
  const [, , , , , , muralSquid, muralTurtle] = env.artPieces;
  const squidAspect = 2.2;
  const squidScale = doorHeight * 2.0;
  const squidHalfWidth = squidScale * squidAspect * 0.56;
  muralSquid.scale.set(squidScale, squidScale, squidScale);
  muralSquid.position.set(center.x + wallMargin - wallHug, muralY, center.z);
  muralSquid.rotation.y = -Math.PI / 2;

  // Sea turtle landscape mural: centered on the back accent (green)
  // wall, clear of artBackLeft/artBackRight (parked at ±wallMargin * 0.55).
  const turtleAspect = 2.0;
  const turtleScale = doorHeight * 1.9;
  const turtleHalfWidth = turtleScale * turtleAspect * 0.56;
  muralTurtle.scale.set(turtleScale, turtleScale, turtleScale);
  muralTurtle.position.set(center.x, muralY, center.z - wallMargin + wallHug);

  // Upper-wall dressing: a continuous frieze band just under the ceiling,
  // a few service vents, and some directional plaques so the room has
  // visual structure above the murals instead of a tall blank void.
  const friezeY = roomFloorY + roomHeight - doorHeight * 0.55;
  const friezeScale = doorHeight * 0.42;
  const [friezeBack, friezeFront, friezeLeft, friezeRight] = env.upperFriezeSegments;
  friezeBack.scale.set(roomFloorSize * 0.95, friezeScale, friezeScale);
  friezeBack.position.set(center.x, friezeY, center.z - wallMargin + wallHug);
  friezeFront.scale.set(roomFloorSize * 0.95, friezeScale, friezeScale);
  friezeFront.position.set(center.x, friezeY, center.z + wallMargin - wallHug);
  friezeFront.rotation.y = Math.PI;
  friezeLeft.scale.set(roomFloorSize * 0.95, friezeScale, friezeScale);
  friezeLeft.position.set(center.x - wallMargin + wallHug, friezeY, center.z);
  friezeLeft.rotation.y = Math.PI / 2;
  friezeRight.scale.set(roomFloorSize * 0.95, friezeScale, friezeScale);
  friezeRight.position.set(center.x + wallMargin - wallHug, friezeY, center.z);
  friezeRight.rotation.y = -Math.PI / 2;

  const ventY = roomFloorY + roomHeight - doorHeight * 0.42;
  const ventScale = doorHeight * 0.42;
  const [ventBackLeft, ventBackRight, ventFrontLeft, ventFrontRight, ventLeft, ventRight] = env.serviceVents;
  ventBackLeft.scale.set(ventScale, ventScale, ventScale);
  ventBackLeft.position.set(center.x - wallMargin * 0.55, ventY, center.z - wallMargin + wallHug);
  ventBackRight.scale.set(ventScale, ventScale, ventScale);
  ventBackRight.position.set(center.x + wallMargin * 0.55, ventY, center.z - wallMargin + wallHug);
  ventFrontLeft.scale.set(ventScale, ventScale, ventScale);
  ventFrontLeft.position.set(center.x - wallMargin * 0.55, ventY, center.z + wallMargin - wallHug);
  ventFrontLeft.rotation.y = Math.PI;
  ventFrontRight.scale.set(ventScale, ventScale, ventScale);
  ventFrontRight.position.set(center.x + wallMargin * 0.55, ventY, center.z + wallMargin - wallHug);
  ventFrontRight.rotation.y = Math.PI;
  ventLeft.scale.set(ventScale, ventScale, ventScale);
  ventLeft.position.set(center.x - wallMargin + wallHug, ventY, center.z - wallMargin * 0.5);
  ventLeft.rotation.y = Math.PI / 2;
  ventRight.scale.set(ventScale, ventScale, ventScale);
  ventRight.position.set(center.x + wallMargin - wallHug, ventY, center.z + wallMargin * 0.5);
  ventRight.rotation.y = -Math.PI / 2;

  const signY = roomFloorY + roomHeight - doorHeight * 0.24;
  const signScale = doorHeight * 0.45;
  const [signBack, signFront, signLeft, signRight] = env.wayfindingSigns;
  signBack.scale.set(signScale, signScale, signScale);
  signBack.position.set(center.x, signY, center.z - wallMargin + wallHug);
  signFront.scale.set(signScale, signScale, signScale);
  signFront.position.set(center.x, signY, center.z + wallMargin - wallHug);
  signFront.rotation.y = Math.PI;
  signLeft.scale.set(signScale, signScale, signScale);
  signLeft.position.set(center.x - wallMargin + wallHug, signY, center.z);
  signLeft.rotation.y = Math.PI / 2;
  signRight.scale.set(signScale, signScale, signScale);
  signRight.position.set(center.x + wallMargin - wallHug, signY, center.z);
  signRight.rotation.y = -Math.PI / 2;

  // Benches: 4 plain backless wooden benches, one on each side of the
  // tank (N/E/S/W), parked about halfway between the tank's own
  // footprint and the walls — the same radius used for the lamp ring
  // above, but at the 4 cardinal angles instead of the 8 diagonal ones,
  // and oriented so the bench's long seat axis runs tangentially (i.e.
  // sitting on one faces the tank) rather than radially.
  const benchRadius = (tankFootprint / 2 + wallMargin) / 2;
  const benchScale = doorHeight * 0.9;
  const benchAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  env.benches.forEach((bench, i) => {
    const angle = benchAngles[i];
    bench.position.set(center.x + Math.sin(angle) * benchRadius, roomFloorY, center.z - Math.cos(angle) * benchRadius);
    bench.scale.set(benchScale, benchScale, benchScale);
    // The bench's local long axis is X; rotate it so that axis runs
    // tangentially (perpendicular to the radius) at the east/west spots.
    bench.rotation.y = angle;
  });

  // Corner sculptures: one aquarium-themed coral/shell/starfish cluster
  // in each of the room's 4 diagonal corner floor squares — parked
  // halfway between the lamp ring's radius (where they first sat, too
  // close to the tank per feedback) and the room's true diagonal wall
  // corner (wallMargin * sqrt(2), assuming a square room footprint), so
  // they land in the open floor space nearer the actual corners.
  const lampRingRadius = benchRadius; // same "(tankFootprint / 2 + wallMargin) / 2" radius as the lamp ring
  const trueCornerRadius = wallMargin * Math.SQRT2;
  const cornerRadius = (lampRingRadius + trueCornerRadius) / 2;
  const cornerScale = doorHeight * 1.7;
  const cornerAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  env.cornerSculptures.forEach((sculpture, i) => {
    const angle = cornerAngles[i];
    sculpture.position.set(center.x + Math.cos(angle) * cornerRadius, roomFloorY, center.z + Math.sin(angle) * cornerRadius);
    sculpture.scale.set(cornerScale, cornerScale, cornerScale);
  });

  // "Other tank" wall windows: small static portholes filling the open
  // wall stretches on either side of each wall's big mural (but clear of
  // doors/small art) — 2 per wall, suggesting a wider wing of smaller
  // neighboring exhibit tanks without any actual extra scene/animation.
  // Positioned low (near eye/chest height, like a real viewing window)
  // rather than up near the art line. Each gets a small museum-style
  // placard mounted right beside it (not above — there's no headroom
  // between the low window and the mural/art line above). Both are
  // fitted into each open gap together as a single [window][placard]
  // cluster (see fitWindowAndLabelToGap below), sized from the real
  // occupant half-widths so neither one can ever land behind/overlapping
  // a mural or door, regardless of the room's actual runtime dimensions.
  const windowHeight = doorHeight * 0.75;
  const windowY = roomFloorY + windowHeight * 0.6;
  const labelScale = windowHeight * 0.5;
  // createTankWindow's frame is BoxGeometry(1.1 * aspect, 1.1, 0.08), so
  // full width in world units is windowHeight * aspect * 1.1.
  // createExhibitLabel's backing is 0.62 wide at unit scale.
  const labelWidth = labelScale * 0.62;
  const clusterGap = windowHeight * 0.18; // small visual gap between window and its placard
  interface WindowFit {
    aspect: number;
    windowCenter: number;
    labelCenter: number;
  }
  function fitWindowAndLabelToGap(gapFrom: number, gapTo: number): WindowFit {
    const gapWidth = gapTo - gapFrom;
    const availableForWindow = Math.max(windowHeight, (gapWidth - labelWidth - clusterGap) * 0.85);
    const aspect = Math.max(0.9, Math.min(3.5, availableForWindow / (windowHeight * 1.1)));
    const windowWidth = aspect * windowHeight * 1.1;
    const clusterWidth = windowWidth + clusterGap + labelWidth;
    const clusterStart = gapFrom + (gapWidth - clusterWidth) / 2;
    const windowCenter = clusterStart + windowWidth / 2;
    const labelCenter = clusterStart + windowWidth + clusterGap + labelWidth / 2;
    return { aspect, windowCenter, labelCenter };
  }
  const [
    winBackLeft,
    winBackRight,
    winFrontLeft,
    winFrontRight,
    winLeftFar,
    winLeftNear,
    winRightFar,
    winRightNear,
  ] = env.tankWindows;

  // Each entry pairs a window/label with the gap it fills; `axis` is
  // which world axis the gap's from/to run along ('x' for the front/back
  // walls, 'z' for the left/right walls), and `wallCoord` is the fixed
  // position along the wall's own normal axis. Windows and their labels
  // are laid out and rebuilt together below, in one pass per wall, so
  // the [window][placard] cluster from fitWindowAndLabelToGap always
  // lands consistently regardless of which side of the gap is "near" or
  // "far" on a given wall.
  interface WindowSlot {
    win: THREE.Group;
    label: THREE.Group;
    gapFrom: number;
    gapTo: number;
    axis: 'x' | 'z';
    wallCoord: number;
    rotationY: number;
  }
  const slots: WindowSlot[] = [
    // Back wall (gaps flank the center turtle mural, ±wallMargin * 0.55 art).
    { win: winBackLeft, label: env.exhibitLabels[0], gapFrom: -wallMargin * 0.55 + artHalfWidth, gapTo: -turtleHalfWidth, axis: 'x', wallCoord: center.z - wallMargin + wallHug, rotationY: 0 },
    { win: winBackRight, label: env.exhibitLabels[1], gapFrom: turtleHalfWidth, gapTo: wallMargin * 0.55 - artHalfWidth, axis: 'x', wallCoord: center.z - wallMargin + wallHug, rotationY: 0 },
    // Front wall (gaps flank the center welcome mural, ±wallMargin * 0.45 door/art).
    { win: winFrontLeft, label: env.exhibitLabels[2], gapFrom: -wallMargin * 0.45 + doorHalfWidth, gapTo: -welcomeHalfWidth, axis: 'x', wallCoord: center.z + wallMargin - wallHug, rotationY: Math.PI },
    { win: winFrontRight, label: env.exhibitLabels[3], gapFrom: welcomeHalfWidth, gapTo: wallMargin * 0.45 - artHalfWidth, axis: 'x', wallCoord: center.z + wallMargin - wallHug, rotationY: Math.PI },
    // Left wall: small gap between the whale mural and exitLeft (+wallMargin * 0.4),
    // and the large open stretch on the mural's far side out to the corner.
    { win: winLeftNear, label: env.exhibitLabels[5], gapFrom: whaleHalfWidth, gapTo: wallMargin * 0.4 - doorHalfWidth, axis: 'z', wallCoord: center.x - wallMargin + wallHug, rotationY: Math.PI / 2 },
    { win: winLeftFar, label: env.exhibitLabels[4], gapFrom: -wallMargin * 0.92, gapTo: -whaleHalfWidth, axis: 'z', wallCoord: center.x - wallMargin + wallHug, rotationY: Math.PI / 2 },
    // Right wall: gap between the squid mural and the main door
    // (-wallMargin * 0.35), and the gap between the squid mural and artRight.
    { win: winRightNear, label: env.exhibitLabels[7], gapFrom: -wallMargin * 0.35 + doorHalfWidth, gapTo: -squidHalfWidth, axis: 'z', wallCoord: center.x + wallMargin - wallHug, rotationY: -Math.PI / 2 },
    { win: winRightFar, label: env.exhibitLabels[6], gapFrom: squidHalfWidth, gapTo: wallMargin * 0.4 - artHalfWidth, axis: 'z', wallCoord: center.x + wallMargin - wallHug, rotationY: -Math.PI / 2 },
  ];

  slots.forEach(({ win, label, gapFrom, gapTo, axis, wallCoord, rotationY }) => {
    const fit = fitWindowAndLabelToGap(gapFrom, gapTo);
    win.scale.set(windowHeight, windowHeight, windowHeight);
    label.scale.set(labelScale, labelScale, labelScale);
    win.rotation.y = rotationY;
    label.rotation.y = rotationY;
    if (axis === 'x') {
      win.position.set(center.x + fit.windowCenter, windowY, wallCoord);
      label.position.set(center.x + fit.labelCenter, windowY, wallCoord);
    } else {
      win.position.set(wallCoord, windowY, center.z + fit.windowCenter);
      label.position.set(wallCoord, windowY, center.z + fit.labelCenter);
    }
    // Each window's aspect (and thus its glass/frame/backdrop geometry)
    // is only known now that the exact gap widths above have been
    // computed (they depend on the room's actual runtime dimensions),
    // so rebuild its contents in place at the fitted aspect — cheap
    // (small canvases/planes), done once per resize/style switch, never
    // per frame.
    rebuildTankWindow(win, fit.aspect);
  });

  // Larger side-wall windows into neighboring exhibit halls. These sit
  // higher than the lower portholes so they read like bigger gallery
  // openings rather than duplicate the small viewports below.
  const sectionWindowScale = doorHeight * 0.7;
  const sectionWindowY = roomFloorY + roomHeight * 0.67;
  const [sectionLeft, sectionRight] = env.sectionWindows;
  sectionLeft.scale.set(sectionWindowScale, sectionWindowScale, sectionWindowScale);
  sectionLeft.position.set(center.x - wallMargin + wallHug, sectionWindowY, center.z);
  sectionLeft.rotation.y = Math.PI / 2;
  rebuildTankWindow(sectionLeft, 2.8, 'hallway');
  sectionRight.scale.set(sectionWindowScale, sectionWindowScale, sectionWindowScale);
  sectionRight.position.set(center.x + wallMargin - wallHug, sectionWindowY, center.z);
  sectionRight.rotation.y = -Math.PI / 2;
  rebuildTankWindow(sectionRight, 2.8, 'hallway');

  // Overhead lamps: 8 fixtures hang from the ceiling, spread in a ring
  // over the floor *around* the tank (not directly above it, per an
  // explicit ask) — evenly spaced at 45° increments, at a radius roughly
  // midway between the tank's own footprint edge and the walls, so each
  // one lands over open floor rather than over the tank/water itself.
  // roomDecor's lamp is authored with a local rod length of 1 unit, so a
  // uniform group scale of the desired world-space rod length sizes the
  // whole fixture (rod/shade/bulb) proportionally in one step, rather
  // than independently rescaling individual parts.
  const lampScale = roomHeight * 0.32;
  const lampRadius = (tankFootprint / 2 + wallMargin) / 2;
  const lampCeilingY = roomFloorY + roomHeight;
  env.lamps.forEach((lamp, i) => {
    const angle = (i / env.lamps.length) * Math.PI * 2;
    lamp.group.position.set(center.x + Math.cos(angle) * lampRadius, lampCeilingY, center.z + Math.sin(angle) * lampRadius);
    lamp.group.scale.set(lampScale, lampScale, lampScale);
    // Light distance/decay are absolute world-space values, unaffected by
    // the group's transform scale, so they're set directly here.
    lamp.light.distance = roomHeight * 3;
  });

  // Extra diffuse fill: one soft hemisphere light and four very low
  // intensity point lights around the tank. The visible ceiling fixtures
  // are still the primary room dressing, but these hidden sources keep the
  // aquarium from reading like a single hard key light when the camera
  // orbits close to the glass.
  env.hemisphereLight.position.set(center.x, roomFloorY + roomHeight, center.z);
  env.bounceLights.forEach((light, i) => {
    const angle = (i / env.bounceLights.length) * Math.PI * 2;
    light.position.set(center.x + Math.cos(angle) * lampRadius * 0.72, roomFloorY + roomHeight * 0.7, center.z + Math.sin(angle) * lampRadius * 0.72);
    light.distance = roomHeight * 2.4;
    light.decay = 2;
  });

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

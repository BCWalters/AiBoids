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
  // highest a fish/predator can actually reach. Now that glassHeight is
  // inflated, place the tank's vertical center so its bottom lands at y=0
  // (see comment above) — note this is the glass box's own center, NOT
  // `tankCenterY` (which stays anchored to the fish's actual swim range,
  // for the camera to look at, rather than drifting up into the now
  // taller-than-necessary glass).
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

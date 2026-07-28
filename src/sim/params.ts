// Single source of truth for tunable simulation parameters.
// Both the ControlPanel (writer) and the Simulation/Boid/Predator (readers)
// share this object, so slider changes take effect immediately without
// resetting the simulation.

export type SimMode = '2d' | '3d';

// 3D-only visual style: 'arcade' is the original glowing/neon instanced
// look; 'nature' swaps in a blue sky, drifting clouds, a ground plane,
// and more bird-like (earth-toned, fingered-wingtip) geometry aiming for
// "looks plausible from a distance" rather than true photo-realism.
// 'fishtank' is an independent underwater-themed style (see
// src/render/styles/fishtank/) — currently just an empty blue void with
// nature's creature geometry duplicated as a starting point, meant to be
// reskinned into fish/tank scenery independently of nature's assets.
export type VisualStyle = 'arcade' | 'nature' | 'fishtank';
export type TimeOfDayPreset = 'dawn' | 'noon' | 'sunset' | 'night';
// Creature View / follow-cam mode. 'off' = normal free orbit camera.
// 'orbit' = tier-1 "orbit-lock": OrbitControls stays fully interactive but
// the orbit target tracks a (damped) selected creature so it stays centered
// while the user orbits/zooms. Future tiers (chase / cockpit) will extend
// this union — see the Creature View feature lane.
export type FollowCamMode = 'off' | 'orbit';

export interface SimParams {
  // Rendering / dimensionality mode
  mode: SimMode;

  // Population
  boidCount: number;
  multicolorCount: number;
  goldCount: number;
  redCount: number;
  blueCount: number;
  predatorCount: number;
  monsterCount: number;
  horseCount: number;

  // Movement
  boidMaxSpeed: number;
  predatorMaxSpeed: number;
  maxForce: number; // steering force clamp, shared by boids and predators

  // Turn-rate limit (boids only): the maximum rate, in degrees per second, at
  // which a boid's direction of travel may rotate. Steering can produce rapid,
  // high-frequency heading reversals (neighbors popping in/out of perception,
  // alignment vs cohesion fighting) that read as a wobbly flight path — this
  // caps how fast the heading can change, smoothing the path without altering
  // the flocking rules themselves. Speed is unaffected; only heading is slewed.
  // Set to 0 to disable (unlimited turn rate, original behavior).
  boidTurnRateDeg: number;

  // Steering-acceleration smoothing (boids only): the time constant, in
  // seconds, of a low-pass filter applied to each boid's steering force
  // before it's integrated into velocity. Complements boidTurnRateDeg — the
  // turn-rate limit caps how fast the *heading* rotates, while this softens
  // the high-frequency *magnitude/direction* jitter in the underlying force
  // (neighbors popping in/out of perception, alignment vs cohesion fighting).
  // Larger = smoother but more sluggish response. Bypassed while a boid is
  // fleeing a predator so escapes stay instant. Set to 0 to disable.
  boidAccelSmoothingTau: number;

  // Perception (boids)
  perceptionRadius: number;
  perceptionAngleDeg: number; // full field-of-view angle, centered on heading

  // Flocking rule weights (boids)
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  separationRadius: number; // distance at which separation kicks in (<= perceptionRadius)

  // A softer, longer-range push that only applies between different
  // species (unlike separationRadius/separationWeight above, which are
  // a tight "personal space" collision-avoidance radius applying to
  // everyone). Without this, mixed-species flocks freely interpenetrate
  // since alignment/cohesion never pull across species and the plain
  // separation radius is too short-range to matter until birds are
  // nearly colliding — this keeps each species' flock visually distinct
  // as a whole, gently steering it away from other flocks it's drifted
  // into, rather than just dodging individual birds at the last moment.
  interspeciesAvoidWeight: number;
  interspeciesAvoidRadius: number; // typically between separationRadius and perceptionRadius

  // Predator interaction
  panicRadius: number;
  fleeWeight: number;

  // Predator perception/behavior
  predatorPerceptionRadius: number;

  // 3D world bounds: a bounded box (not wraparound). Boids/predators steer
  // away softly as they approach a wall, rather than teleporting like the
  // 2D torus wraparound does.
  worldDepth: number; // z-axis size of the 3D world (x/y come from canvas size)
  boundaryMargin: number; // distance from a wall at which steer-away begins
  boundaryWeight: number; // strength of the steer-away force

  // 3D-only: a gentle, constant seek-to-center force, always active
  // (unlike boundaryWeight, which only kicks in near a wall). Without
  // this, cohesion tends to pin the whole flock against a wall or in a
  // corner once it drifts there, since only entities right at the edge
  // feel any push back — this keeps the flock cycling through open space.
  centerPullWeight: number;

  // Visuals (shared by both renderers): how strongly previous frames
  // persist, producing motion trails behind moving entities. 0 = no
  // trail (hard clear each frame). Keep below 1 (full persistence, trail
  // that never fades).
  trailAmount: number;

  // 3D-only: which visual style Renderer3D uses. Purely cosmetic — has
  // no effect on simulation behavior.
  visualStyle: VisualStyle;

  // Nature-style only: whether distance fog is applied in the 3D nature
  // scene. Fog hides seams at the world's edge (ground/mountains/ocean
  // fading into the sky), but disabling it is useful for inspecting
  // distant geometry (e.g. the ocean) that's otherwise heavily faded.
  fogEnabled: boolean;
  // 3D-only: lighting preset used by both nature and fishtank scenes.
  timeOfDay: TimeOfDayPreset;
  // 3D-only: enable soft shadow maps.
  softShadowsEnabled: boolean;
  // 3D-only: controls stylized sun shafts in nature style.
  lightShaftsEnabled: boolean;
  // 3D-only: strength of state-based flap/body/tail blending.
  animationBlendStrength: number;
  // Fishtank-only: animated caustics + suspended particle water FX.
  waterEffectsEnabled: boolean;

  // ---- Visual FX feature flags (scaffolding for parallel feature work) ----
  // These default to off/neutral so they produce no visual change until each
  // feature lane wires up the code that reads them. Grouped here so feature
  // agents each own only their scene/render file and never collide on this
  // shared params object.
  //
  // Creature View (follow-cam): click a creature to have the camera track it.
  // 'off' = normal free orbit. See FollowCamMode.
  followCamMode: FollowCamMode;
  // Show the on-screen creature inspector HUD (species / speed / state) while
  // a creature is selected via Creature View.
  showCreatureInspector: boolean;
  // Post-processing: filmic color grading (contrast/saturation) pass.
  colorGradingEnabled: boolean;
  // Post-processing: depth-of-field (focus on flock center / followed creature).
  depthOfFieldEnabled: boolean;
  // Nature-only: animated water surface (wave displacement).
  waterWavesEnabled: boolean;
  // Nature-only: reflections / sun specular glints on water.
  waterReflectionsEnabled: boolean;
  // Fishtank-only: depth-based murk gradient (water darkens toward the back).
  depthMurkEnabled: boolean;
  // ------------------------------------------------------------------------
  // Optional in-app rendering HUD (frame-time/fps and related diagnostics).
  showRenderingStats: boolean;
  // Optional bounded in-memory diagnostics capture for export/debugging.
  enableDiagnosticsCapture: boolean;

  // When true (default), a predator that gets close enough to a boid
  // catches it — the boid is removed (with a brief cartoony "swallowed"
  // shrink + blood-splatter effect) and the predator pauses to glide to a
  // stop and "digest" for a few seconds before resuming the hunt. When
  // false, predators can chase boids forever but never actually catch them.
  predatorCatchEnabled: boolean;

  // Predator burst strike (#237). When true, a predator that closes to
  // within predatorStrikeRange of its target commits to a short sprint:
  // it aims at an intercept point rather than the prey's current position,
  // and its speed cap ramps up to predatorMaxSpeed * predatorStrikeSpeedBoost.
  //
  // Exists because the base pursuit cannot actually catch anything. The
  // predator/prey speed ratio is only 150/120 = 1.25 against prey that flee
  // at fleeWeight 3.5 from panicRadius 90, which converges to a stable
  // trailing standoff: measured over ~70,000 predator-frames per scene, the
  // mouth point came within 3.5 units of a live boid in 0.00% of frames.
  // maxForce is NOT the binding constraint — strike force x3 vs x5 produced
  // byte-identical catch counts across all 10 seeds, because once up to speed
  // (desired - velocity) is already shorter than the clamp.
  predatorStrikeEnabled: boolean;
  predatorStrikeRange: number;
  predatorStrikeSpeedBoost: number;

  // Simulation control
  running: boolean;
  showDebugOverlay: boolean;

  // Creature Gallery: when set, isolates a single instance of the chosen
  // creature kind front-and-center (all other populations zeroed, sim
  // frozen so it holds a steady flying pose while wings/tail still
  // animate) so it can be inspected/orbited/screenshotted cleanly. Also
  // drivable via the `?galleryCreature=<kind>` URL param for automated
  // screenshot tooling (see main.ts). null = normal simulation.
  galleryCreature: GalleryCreature | null;
}

export type GalleryCreature = 'horse' | 'monster' | 'predator' | 'normal' | 'multicolor' | 'gold' | 'red' | 'blue';

export const defaultParams: SimParams = {
  mode: '3d',

  boidCount: 150,
  multicolorCount: 75,
  goldCount: 75,
  redCount: 75,
  blueCount: 75,
  // Default to 0 hawks — dragons and unicorns are the out-of-the-box
  // nature-scene experience. Players can add hawks via the slider.
  predatorCount: 0,
  monsterCount: 5,
  // Independent from predatorCount/monsterCount — horse-kind predators are
  // a separate population that coexists with hawks/dragons, so default to
  // a visible little herd rather than 0 (visible out of the box).
  horseCount: 5,

  boidMaxSpeed: 120,
  predatorMaxSpeed: 150,
  maxForce: 250,
  boidTurnRateDeg: 100,
  boidAccelSmoothingTau: 0.04,
  perceptionRadius: 70,
  perceptionAngleDeg: 270,

  separationWeight: 1.6,
  alignmentWeight: 1.0,
  cohesionWeight: 1.0,
  separationRadius: 24,
  interspeciesAvoidWeight: 1.2,
  interspeciesAvoidRadius: 45,

  panicRadius: 90,
  fleeWeight: 3.5,

  predatorPerceptionRadius: 220,

  worldDepth: 1000,
  boundaryMargin: 120,
  boundaryWeight: 3.5,
  centerPullWeight: 0.1,

  trailAmount: 0.82,

  visualStyle: 'nature',
  fogEnabled: true,
  timeOfDay: 'noon',
  softShadowsEnabled: true,
  lightShaftsEnabled: true,
  animationBlendStrength: 1,
  waterEffectsEnabled: true,
  showRenderingStats: false,

  // Visual FX feature flags — default off/neutral (no visual change until a
  // feature lane wires up the reads).
  followCamMode: 'orbit',
  showCreatureInspector: true,
  colorGradingEnabled: true,
  depthOfFieldEnabled: true,
  waterWavesEnabled: true,
  waterReflectionsEnabled: true,
  depthMurkEnabled: true,
  enableDiagnosticsCapture: false,
  predatorCatchEnabled: true,
  // Off by default: this is a feel change (predators sprint at 270 against
  // prey capped at 120), so it ships behind a toggle pending review.
  predatorStrikeEnabled: false,
  predatorStrikeRange: 60,
  predatorStrikeSpeedBoost: 1.8,

  running: true,
  showDebugOverlay: false,

  galleryCreature: null,
};

/** Mutable shared params instance. Mutate fields directly; do not reassign. */
export const params: SimParams = { ...defaultParams };

export function resetParams(): void {
  Object.assign(params, defaultParams);
}

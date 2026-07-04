# AiBoids — Design Doc

## Overview
A browser-based recreation of the classic "Boids" flocking simulation (Craig
Reynolds, 1986). Birds ("boids") flock on a 2D field using local perception
and simple steering rules. Predators can be introduced to scatter the flock,
which then reforms once the threat passes. All key parameters are tunable
live via a control panel.

## Tech Stack
- **Language**: TypeScript
- **Build tooling**: Vite (vanilla TS template, no framework)
- **Rendering**: HTML5 Canvas (2D context)
- **UI**: Plain HTML/CSS control panel (sliders, number inputs, buttons)
- No external simulation/physics libraries — core logic is hand-rolled so
  it stays transparent and easy to extend.

### Forward-compatibility note
Simulation/state logic (boid data, update loop, spatial partitioning) is
kept fully decoupled from the rendering layer, so a future V2 could swap
the Canvas2D renderer for a 3D renderer (e.g. Three.js) without touching
core flocking logic.

### V2 update: 3D mode shipped
V2 added a live-switchable 3D mode alongside the original 2D mode:
- Core sim generalized from `Vec2` to `Vec3` (`src/sim/vector.ts`); 2D mode
  simply keeps `z = 0` throughout, so all flocking rules and steering math
  are shared, unmodified, between both modes.
- Vision-cone perception now uses the angle between the heading and
  direction-to-neighbor vectors (dot-product based), which works
  identically in 2D and 3D — no more atan2-only logic in the hot path.
- **Rendering**: `src/render/Renderer3D.ts` (Three.js, instanced meshes,
  `OrbitControls`) sits behind the same `render(sim)` shape as the 2D
  `Renderer`. Two `<canvas>` elements are stacked in `index.html`; only the
  active mode's canvas is shown, since a canvas can't switch WebGL/2D
  context types after first use.
- **World boundaries diverge by mode**: 2D keeps torus wraparound (as
  designed originally). 3D uses a **bounded box with soft steer-away**
  near walls (see `src/sim/boundary.ts`) instead of wraparound, since
  teleporting reads as a jarring glitch once the camera can orbit/pan —
  this was a deliberate behavior change scoped to 3D only.
- Mode is switchable live from the control panel; switching resets the
  simulation (repositions entities appropriately for the new
  dimensionality/boundary model).

### V3 update: visual polish (trails, color-by-state, nature style)
- **Motion trails + color-by-state** (both modes): a shared `trailAmount`
  param controls a fading-frame effect (translucent overlay in 2D,
  `AfterimagePass` in 3D) so movement reads more fluidly. Boids/predators
  now track a smoothed `panicLevel`/`huntIntensity` (0-1) and lerp their
  color toward a highlight tone as they flee/hunt.
- **3D-only visual style toggle** (`params.visualStyle`: `'arcade'` |
  `'nature'`), purely cosmetic:
  - *Arcade* (default): the original glowing/neon instanced-triangle look
    with bloom post-processing.
  - *Nature*: aims for "plausible from a distance," not photo-realism.
    Adds a physically-based sky dome with a built-in procedural cloud
    layer (`three/examples/jsm/objects/Sky.js`), a procedurally textured
    ground plane (`src/render/environment.ts`, canvas-generated, no
    external image assets), earth-toned matte bird materials, and a more
    bird-like silhouette (`createRealisticBirdGeometries` in
    `src/render/birdGeometry.ts`: tapered lathed body, wings with fanned
    "finger" wingtip feathers, a flat fanned tail). Bloom is disabled and
    ACES tone mapping is enabled in this style for a natural look.
  - Both styles reuse the same instancing/steering/animation pipeline;
    only geometry, materials, lighting, and the sky/ground environment
    swap based on the selected style.

## World Model
- 2D continuous coordinate space (not a discrete grid) rendered on a
  full-size canvas.
- **Boundary behavior**: wrap-around (torus topology) — a boid exiting the
  right edge reappears on the left, etc. Applies to both boids and
  predators.

## Entities

### Boid
State: position (x, y), velocity (vector: heading + speed), id.

### Predator
State: position, velocity, id. Same physical movement model as boids but
different steering goals (hunting instead of flocking).

## Perception Model
Each boid/predator perceives neighbors within a **vision cone**:
- Limited radius (how far it can see) — tunable.
- Limited angle (field of view centered on current heading, e.g. 270°,
  not full 360°) — tunable.
- Neighbors behind the animal, outside the cone, are ignored — mimics
  real-world vision and produces more natural, less "telepathic" flocking.

### Performance note
Naive perception is O(n²) (every boid checks every other boid/predator).
For V1 boid counts (up to a few hundred) this is fine. If performance
becomes an issue we'll add a spatial partitioning structure (uniform grid
of cells) purely as an internal optimization — it does not change the
vision-cone perception *model*, just how candidate neighbors are looked up
before the angle/radius filter is applied.

## Flocking Rules (Boids)
Each boid computes a steering vector each frame as a weighted sum of:

1. **Separation** — steer away from neighbors that are too close, to avoid
   crowding/collisions. Weight: tunable slider.
2. **Alignment** — steer toward the average heading/velocity of visible
   neighbors. Weight: tunable slider.
3. **Cohesion** — steer toward the average position (center of mass) of
   visible neighbors. Weight: tunable slider.
4. **Predator avoidance (flee)** — a distinct, stronger rule: if a predator
   is within a boid's "panic radius," the boid steers directly away from
   it, and this rule overrides/dominates the other three while active
   (panic response scales with proximity — closer predator = stronger
   flee force). Panic radius and flee strength are tunable.

Each rule only considers neighbors within the boid's vision cone.
Final steering = weighted sum of the above, clamped to a max turn
rate/force, then applied to velocity (clamped to max speed).

## Predator Behavior
- Predators pursue prey using simple pursuit: steer toward the nearest
  visible boid, or toward the local flock center if none are individually
  close, using their own vision cone.
- Predators have their own speed (likely slightly faster than boids by
  default, tunable) so they can meaningfully break up a flock.
- Multiple predators act independently (no pack coordination in V1).

## Tunable Parameters (V1 Control Panel)
- Number of boids
- Number of predators
- Boid max speed
- Predator max speed
- Perception radius (boids)
- Perception angle / field of view (boids)
- Separation weight
- Alignment weight
- Cohesion weight
- Predator panic radius (flee trigger distance)
- Predator flee weight/strength
- Start / Pause / Reset simulation controls
- (Stretch) Add/remove predator on click, or click-to-place

All sliders update the running simulation live (no restart required)
except boid/predator *count* changes, which add/remove entities on the
fly without resetting existing positions.

## Rendering (V1)
- Boids: small triangles/arrowheads oriented in their direction of travel
  (classic Boids look), distinct color.
- Predators: larger, differently colored/shaped marker (e.g. red
  triangle or circle with an outline) so they're visually distinct.
- Optional debug overlay (togglable): draw a boid's vision cone and/or
  panic radius for inspection/tuning.
- Simple, dependency-free Canvas 2D drawing — no sprites/images needed for
  V1.

## Architecture / File Structure (initial sketch)
```
AiBoids/
  index.html
  src/
    main.ts            # bootstraps canvas, control panel, sim loop
    sim/
      Boid.ts           # boid entity + steering rule implementations
      Predator.ts       # predator entity + pursuit logic
      Simulation.ts     # holds entity lists, update(dt), world bounds/wrap
      vector.ts         # small 2D vector math helpers
      params.ts         # shared tunable-parameter state (single source
                         # of truth read by both UI and sim)
    render/
      Renderer.ts       # draws current sim state to canvas each frame
    ui/
      ControlPanel.ts   # wires up sliders/inputs to params + buttons
  style.css
```

## Simulation Loop
- `requestAnimationFrame` driven, using delta-time (dt) so behavior stays
  consistent across frame rates.
- Each frame: for every boid, gather visible neighbors (within
  radius+angle), compute steering (sep/align/cohesion/flee), update
  velocity + position (with wraparound), then render.

## Out of Scope for V1 (possible future work)
- 3D rendering
- Obstacles/walls within the world
- Predator pack coordination / multiple predator "species"
- Saving/loading parameter presets
- Mobile/touch-optimized control panel

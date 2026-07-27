# Architecture

A concise, current-state reference for the codebase — how it's laid out
and *why* the key tech choices were made. For the feature history and
original spec, see [`DESIGN.md`](./DESIGN.md).

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Strict typing catches whole classes of bugs in a codebase with two parallel render paths (2D/3D) sharing simulation state; near-zero cost with Vite. |
| Build tool | [Vite](https://vitejs.dev/) | Instant dev-server startup + HMR, zero-config TS support, tiny production bundler (esbuild/rollup under the hood). No framework needed since there's no component tree — just a canvas and a control panel. |
| 2D rendering | HTML5 Canvas 2D context | Simplest possible API for drawing a few hundred oriented triangles per frame; no GPU pipeline to manage for the original, simplest mode. |
| 3D rendering | [three.js](https://threejs.org/) | The de facto standard WebGL abstraction — scene graph, instanced meshes, materials/lighting, `OrbitControls`, post-processing (`AfterimagePass`, bloom) all out of the box. It also makes it easy to keep multiple 3D scene variants (arcade, nature, fishtank) behind the same renderer contract. |
| UI | Plain HTML/CSS + vanilla TS (`ControlPanel.ts`) | The control panel is a flat list of sliders/selects bound to a shared params object and a small amount of per-style state — no component framework needed for this scale. |
| Package manager | npm (`package-lock.json` committed) | Default, zero extra tooling; lockfile committed for reproducible CI installs (`npm ci`). |

### Alternatives considered

**3D rendering library:**

| Option | Pros | Why not chosen |
|---|---|---|
| **three.js** (chosen) | Huge ecosystem/examples, mature, good docs, exactly the level of abstraction needed (scene graph + shader escape hatches) | — |
| Babylon.js | Also mature, strong for full "game engine" needs (physics, GUI) | Heavier than needed for a boids sim; three.js's lower-level control was preferable for the custom procedural ground shader work |
| raw WebGL / WebGPU | Maximum control, no dependency | Would mean hand-rolling a scene graph, camera controls, and instancing — pure overhead for this project's scope |
| react-three-fiber | Nice declarative API over three.js | Pulls in React for a project with no other UI-framework need; simulation loop is imperative by nature anyway |

**Build tooling:**

| Option | Pros | Why not chosen |
|---|---|---|
| **Vite** (chosen) | Fast HMR, minimal config, first-class TS | — |
| webpack | Extremely configurable, huge plugin ecosystem | Much slower dev-server/HMR loop, far more config for the same result |
| esbuild directly | Fastest raw builds | No dev server / HMR story out of the box; Vite already uses esbuild under the hood in dev |
| Parcel | Zero-config, competitive speed | Smaller ecosystem/momentum than Vite for the three.js + TS combination |

**UI framework:**

| Option | Pros | Why not chosen |
|---|---|---|
| **Vanilla TS/DOM** (chosen) | No framework overhead/build step; control panel is simple, static, flat form | — |
| React | Component reuse, huge ecosystem | No component tree to justify it — a handful of sliders bound to one params object is simpler as plain DOM + event listeners |
| Svelte / Solid | Small runtime, good DX | Same as above — would add a compiler step for no structural benefit here |

## Directory structure

```
AiBoids/
  index.html              # two stacked <canvas> elements (2D + 3D); only
                           # the active mode's canvas is shown
  src/
    main.ts                # bootstraps canvases, control panel, mode/style
                           # switching, gallery deep links, sim loop
    sim/                   # pure simulation state/logic — no rendering
      vector.ts            # Vec3 math helpers (2D mode keeps z = 0)
      params.ts             # SimParams: single source of truth for every
                            # tunable value, read by both UI and sim
      boundary.ts           # world-bounds helpers: wraparound (2D) vs.
                            # bounded box + soft steer-away (3D)
      Boid.ts               # boid entity + steering rules, species enum
      Predator.ts           # predator entity + pursuit/hunt logic
      UFO.ts                # alien-invasion event entity (descend / beam
                            # up boids / ascend)
      Simulation.ts         # owns entity lists, update(dt), catch events
    render/
      Renderer.ts           # 2D canvas renderer
      Renderer3D.ts         # shared three.js renderer: scene setup,
                            # instanced meshes, camera/controls,
                            # post-processing, style switching
      CreatureInstanceRenderer.ts
                            # poses + colors one creature render batch per
                            # frame (orientation, flap, tail sway, banking)
      motion/               # pure creature-motion math (no THREE state):
                            # flapMath.ts, partTransform.ts, rig.ts — unit tested
      color/                # per-species color applicators
      creatureUprightTuning.ts
                            # per-upright-style tuning tables
      geometry/             # shared geometry helpers
      styles/
        nature/             # outdoor 3D scene
          environment.ts    # sky, ground, lakes/ocean, fog, room scale
          clouds.ts        # procedural cloud layer
          fireBreath.ts    # dragon fire-breath particle/effect system
          geometry/        # hawk/parrot/dragon/unicorn meshes
        fishtank/           # underwater 3D scene
          environment.ts    # aquarium room + glass tank + props
          geometry/        # fish, shark, seahorse meshes
      bloodEffects.ts       # predator-catch hit-effect particles
      ufoEffects.ts         # alien invasion beam/abduction visuals
    ui/
      ControlPanel.ts        # binds DOM inputs to `params`, live-updates
                            # the running simulation (no restart needed)
    style.css
```

## Core design decisions

- **Simulation/rendering separation**: `src/sim/*` has zero references to
  Canvas or three.js. Both renderers read the same `Simulation` state
  each frame. This is what let 3D mode, then additional 3D scene variants
  (nature/fishtank/arcade), plus dragons/UFOs, be added without touching
  the original flocking math.
- **Vec3 everywhere, even in 2D**: rather than maintaining separate 2D/3D
  vector types, 2D mode just keeps `z = 0`. Perception uses a dot-product
  angle check (not `atan2`), so the same steering code runs unmodified in
  both modes.
- **No external art/model/texture assets**: birds, fish, ground textures,
  sky, tank props, and clouds are all procedurally generated (lathed
  geometry, canvas textures, custom GLSL patched in via `onBeforeCompile`).
  Keeps the repo dependency-free for assets and everything
  tunable/regenerable in code.
- **Params object as single source of truth**: `src/sim/params.ts`'s
  `SimParams` is mutated directly by the control panel and read directly
  by the sim/renderers every frame — no event bus or state management
  library needed for this scale of app.
- **Style modules are isolated**: the 3D renderer owns the shared camera,
  instancing, and post-processing pipeline, while each scene style keeps
  its own environment/geometry modules under `src/render/styles/`. That
  keeps the outdoor `nature` scene and the underwater `fishtank` scene
  free to diverge without coupling their props, materials, or camera
  framing assumptions.
- **`onBeforeCompile` shader patching over custom `ShaderMaterial`**: the
  ground texture work extends three.js's built-in `MeshStandardMaterial`
  shader (patching `#include` chunks) rather than writing a full custom
  material, so lighting/shadows/fog integration is inherited for free.
- **Creature motion math is pure and separate from the renderer**:
  `src/render/motion/` holds plain functions (flap phase/amplitude, state
  blending, pivot articulation) with no THREE state and no `this`, unit
  tested without a WebGL context. `CreatureInstanceRenderer` keeps only the
  stateful parts — accumulated per-creature phase, scratch objects, matrix
  composition. Tuning how something moves shouldn't require editing the
  1000+ line renderer, which also keeps parallel work on different creatures
  out of the same file.
- **All articulated parts share one poser**: wings, tails, and any future
  jaw/neck/leg go through `applyArticulatedPartMatrix`, which rotates a part
  about an arbitrary model-space pivot. Rotating about the origin is the
  same code path with a null pivot, so there is one articulation behaviour
  rather than a bespoke matrix sequence per part.
- **A joint's position is declared by the geometry that builds it, not by the
  scene**: `src/render/motion/rig.ts` describes parts as plain data (pivot,
  axis, parent, drive) and each geometry builder emits that declaration
  alongside its buffers. A pivot is expressed in whatever model units that
  creature's builder chose, which a per-scene `MotionConfig` has no way to
  know — a wrong value detaches the limb rather than degrading gracefully.
  Scenes keep only the tuning they legitimately own: how fast and how hard to
  drive each oscillator. Parts are ordered root-first and reference their
  parent by index, so a chain (hip → knee) composes in one forward pass and
  a child inherits every rotation above it.
- **Colour keys off a part's group, not its identity**: leg tinting lives in
  `applyLegChainColor`, so splitting a creature's legs into more parts doesn't
  ripple back into six colour strategies that don't care how many parts there
  are.

## Where to look for common tasks

| Task | File(s) |
|---|---|
| Add/tune a flocking rule | `src/sim/Boid.ts`, `src/sim/params.ts` |
| Change predator/dragon behavior | `src/sim/Predator.ts` |
| Tweak 3D nature visuals (sky/ground/fog/lakes) | `src/render/styles/nature/environment.ts` |
| Tweak 3D fishtank visuals (tank/room/props) | `src/render/styles/fishtank/environment.ts` |
| Change bird/dragon appearance | `src/render/styles/nature/geometry/` |
| Change fish/shark appearance | `src/render/styles/fishtank/geometry/` |
| Tune how creatures move (flap, tail sway) | `src/render/motion/flapMath.ts` |
| Change where a limb bends | that creature's geometry file (its rig declaration) |
| Add a new animated body part | `src/render/CreatureInstanceRenderer.ts` (`applyArticulatedPartMatrix`) |
| Add a new control-panel slider | `src/sim/params.ts` + `src/ui/ControlPanel.ts` |
| Add a new special event (like the alien invasion) | `src/sim/UFO.ts` + `src/render/ufoEffects.ts` as a template |

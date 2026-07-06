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
| 3D rendering | [three.js](https://threejs.org/) | The de facto standard WebGL abstraction — scene graph, instanced meshes, materials/lighting, `OrbitControls`, post-processing (`AfterimagePass`, bloom) all out of the box. Avoids hand-rolling WebGL/shaders for anything but the custom ground-texture fragment shader patches. |
| UI | Plain HTML/CSS + vanilla TS (`ControlPanel.ts`) | The control panel is a flat list of sliders/selects bound to a shared params object — doesn't need a component framework's overhead or build complexity. |
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
    main.ts                # bootstraps canvases, control panel, sim loop
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
      Renderer3D.ts         # three.js renderer: scene setup, instanced
                            # meshes, camera/controls, post-processing
      birdGeometry.ts       # procedural lathed/fanned bird meshes (no
                            # external model assets)
      environment.ts        # 3D "nature" style world: sky, procedural
                            # ground texture + shader (Worley-noise blob
                            # field, texture bombing), lakes, ocean, fog
      clouds.ts             # procedural cloud layer
      fireBreath.ts          # dragon fire-breath particle/effect system
      bloodEffects.ts        # predator-catch hit-effect particles
      ufoEffects.ts          # alien invasion beam/abduction visuals
    ui/
      ControlPanel.ts        # binds DOM inputs to `params`, live-updates
                            # the running simulation (no restart needed)
    style.css
```

## Core design decisions

- **Simulation/rendering separation**: `src/sim/*` has zero references to
  Canvas or three.js. Both renderers read the same `Simulation` state
  each frame. This is what let 3D mode (and later, dragons/UFOs) be added
  without touching the original flocking math.
- **Vec3 everywhere, even in 2D**: rather than maintaining separate 2D/3D
  vector types, 2D mode just keeps `z = 0`. Perception uses a dot-product
  angle check (not `atan2`), so the same steering code runs unmodified in
  both modes.
- **No external art/model/texture assets**: birds, ground textures, sky,
  and clouds are all procedurally generated (lathed geometry, canvas
  textures, custom GLSL patched in via `onBeforeCompile`). Keeps the repo
  dependency-free for assets and everything tunable/regenerable in code.
- **Params object as single source of truth**: `src/sim/params.ts`'s
  `SimParams` is mutated directly by the control panel and read directly
  by the sim/renderers every frame — no event bus or state management
  library needed for this scale of app.
- **`onBeforeCompile` shader patching over custom `ShaderMaterial`**: the
  ground texture work extends three.js's built-in `MeshStandardMaterial`
  shader (patching `#include` chunks) rather than writing a full custom
  material, so lighting/shadows/fog integration is inherited for free.

## Where to look for common tasks

| Task | File(s) |
|---|---|
| Add/tune a flocking rule | `src/sim/Boid.ts`, `src/sim/params.ts` |
| Change predator/dragon behavior | `src/sim/Predator.ts` |
| Tweak 3D visuals (sky/ground/fog/lakes) | `src/render/environment.ts` |
| Change bird/dragon appearance | `src/render/birdGeometry.ts` |
| Add a new control-panel slider | `src/sim/params.ts` + `src/ui/ControlPanel.ts` |
| Add a new special event (like the alien invasion) | `src/sim/UFO.ts` + `src/render/ufoEffects.ts` as a template |

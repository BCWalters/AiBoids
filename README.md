# AiBoids

**The most advanced Boids *visualisation* ever built** — and built entirely
by an AI coding agent (GitHub Copilot CLI), as a running exercise in
iterative, agent-driven development.

Hosted on my projects site: [Ben's Page](https://victorious-forest-06eb42803.7.azurestaticapps.net/)

That is a deliberately strong claim, so here is exactly what it rests on.
Classic Boids demos are a triangle, or a cone, or an imported mesh. This
one renders:

- **10 creature types, every vertex generated procedurally in code.**
  There is not a single `.glb`, `.fbx`, `.obj`, texture file, or asset
  loader anywhere in this repo — hawks, dragons, unicorns, parrots,
  sharks, barracuda, seahorses and the rest are all built from maths at
  runtime. Other 3D flocking projects import their art.
- **10 hand-written GLSL shader modules** for feather barbs, dragon
  scales, fish scales and fin rays, unicorn mane hair, and per-creature
  wing undulation. For comparison, three.js's own well-known
  `webgl_gpgpu_birds` demo draws each bird as 3 grey triangles and
  animates the wings by moving two vertices on a sine wave.
- **3 fully distinct scenes** — an arcade mode, a nature world with sky,
  ground, lakes and fog, and a coral fishtank. Most projects have one.
- **Per-species behaviour**, not one shared steering rule: predators have
  individual catch profiles, and separation is aware of body size.

Underneath, the flocking itself is the classic, honest
separation/alignment/cohesion model — the ambition here is in the
rendering. Every parameter (population sizes, speeds, perception,
flocking weights) is tunable live from an on-screen control panel, in
both a simple 2D mode and a fully-3D mode with an orbiting camera.

If you know of a Boids visualisation that beats this one, please open an
issue — that is a conversation worth having.

## Quick start

Requires [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`). The
dev server hot-reloads as you edit source files.

### Other scripts

```bash
npm run build      # type-check (tsc) + production build to dist/
npm run preview    # locally preview the production build
npm test           # unit tests (Vitest) — pure sim/i18n logic
npm run test:watch # unit tests in watch mode
npm run test:e2e   # end-to-end smoke tests (Playwright Test) — boots a
                    # real browser against a dev server and checks the
                    # app loads, mode/visual-style switching keeps
                    # rendering, and boids are actually visible on screen
```

`npm run test:e2e` auto-starts its own dev server on port 4319 and needs
Chromium installed once via `npx playwright install chromium`.

## Documentation

- [`DESIGN.md`](./DESIGN.md) — original design spec and a running log of
  major feature additions (2D → 3D, visual styles, dragons, environment
  polish, etc.).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — a more current, at-a-glance
  reference for the codebase: file-by-file structure, key tech choices,
  and the alternatives considered for each.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch/PR conventions and how
  to run multiple agents/instances against this repo in parallel using
  `git worktree`.

## Contributing

All changes land via pull request into `main` (no direct commits) —
see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branch naming, review
requirements, and the required CI check.

## License

[MIT](./LICENSE)

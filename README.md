# AiBoids

A browser-based flocking ("Boids") simulation built entirely with an AI
coding agent (GitHub Copilot CLI), used as a running exercise in
iterative, agent-driven development.

Hosted on my projects site: [Ben's Page](https://victorious-forest-06eb42803.7.azurestaticapps.net/)

Small "boids" (sparrows, parrots, goldfinches, cardinals, blue jays) flock
together using the classic separation/alignment/cohesion rules, while
predators (hawks, and optionally fire-breathing dragons or an alien
invasion) hunt them and scatter the flock. Every parameter — population
sizes, speeds, perception, flocking weights — is tunable live from an
on-screen control panel, in both a simple 2D mode and a fully-3D mode
with an orbiting camera, sky, ground, lakes, ocean, and fog.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or later.

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

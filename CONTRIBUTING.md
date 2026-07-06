# Contributing to AiBoids

This project supports multiple Copilot CLI instances (and eventually
multiple people) working on it at the same time. To keep that
manageable, please follow these conventions.

## Workflow

- **Never commit directly to `main`.** All changes land via pull
  request, even for solo/self-reviewed work.
- **One reviewer required.** Self-review is fine for now, but every PR
  needs at least one approval before merging. `@BCWalters` is a
  required reviewer via `CODEOWNERS`.
- **CI must pass.** The `CI` GitHub Actions workflow runs `npm run
  build` (`tsc` + `vite build`) on every PR; a red check blocks merge.

## Branch naming

Use a short prefix that describes the area of work, e.g.:

- `feature/<short-description>` — new functionality (e.g.
  `feature/boid-behavior`)
- `fix/<short-description>` — bug fixes (e.g. `fix/dragon-flicker`)
- `chore/<short-description>` — tooling, docs, config (e.g.
  `chore/add-codeowners`)

## Running multiple agents/instances in parallel

Prefer **`git worktree`** over separate clones — it shares one
`.git` (history/objects) so branches pushed by one worktree are
immediately visible to others after a `fetch`, while each worktree
still gets a fully independent working directory, `node_modules`, and
dev server.

```bash
# From an existing clone, spin up an isolated working directory on a
# new branch for a second agent/terminal:
git worktree add ../AiBoids-<topic> -b feature/<topic>
cd ../AiBoids-<topic>
npm install
npm run dev -- --port 5174   # avoid clashing with another instance on 5173
```

When the work is done and merged, clean up with:

```bash
git worktree remove ../AiBoids-<topic>
```

## Local checks before opening a PR

```bash
npm run build   # type-check + production build
```

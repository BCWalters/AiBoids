# AGENTS.md — Parallel-Development Conventions

A quick-reference checklist for coding agents (and humans) working on AiBoids in parallel.
Read this before starting any task.

---

## 1. Check for in-flight PRs first

Before touching any file, scan open PRs for overlapping changes:

```
GitHub MCP → list_pull_requests (state: open)
```

- If a PR already modifies your target file(s), coordinate or sequence after it merges.
- Large code-motion refactors (splits, renames, reorganisations) **must** land before feature PRs in the same file — not concurrently.

---

## 2. Hotspot files — rules for each

These files attract concurrent edits. Follow the rule for each one to avoid add/add conflicts.

| File | Rule |
|------|------|
| `src/i18n/translations.ts` | Add keys in the smallest relevant namespace. Keep `en` / `es` / `fr` key sets in sync — a test enforces parity (`translations.test.ts`). |
| `src/sim/params.ts` (`SimParams` / `defaultParams`) | Add new fields grouped logically near related fields; **append within a logical group**, never reorder existing fields. |
| `src/ui/ControlPanel.ts` | Edit only the section relevant to your feature. If the file has been split into per-section modules (see #135 / #137), target only the correct module. |
| `src/render/FollowCamController.ts` | Selection/camera logic and HUD are separate concerns (see #138). Keep them in separate methods/blocks; do not mix concerns. |

---

## 3. Test-file naming convention

**Never invent a generic shared test filename** (e.g. `camera.test.ts`, `render.test.ts`).
Use a **concern-scoped name** that can't collide:

```
FollowCamController.drag.test.ts   ✓
CreatureHud.test.ts                ✓
camera.test.ts                     ✗  (too generic — two agents once both created this)
```

Two agents creating the same filename produces an irreconcilable add/add conflict (#118 vs #122).

---

## 4. Named-field params over positional args

All new renderer/simulation functions **must** use named-field objects, not long positional argument lists.

```ts
// ✗ Bad — inserting a bool at position 14 caused a silent rendering regression
updateInstances(scene, cam, birds, wind, ..., true, false, 3, ...);

// ✓ Good — type-safe, conflict-free, self-documenting
updateInstances({ scene, cam, birds, motionConfig, colourStrategy });
```

Existing learning: a 28-arg positional function caused a silent regression (small-bird gradients
stopped rendering) with no TypeScript error. Already noted in
`.github/instructions/workflow.instructions.md`.

---

## 5. Per-scene / per-creature file layout

New work should land in the **smallest relevant file**, not a shared monolith:

```
src/render/styles/
  nature/
    environment.ts            ← nature scene environment (sky, ground, fog)
    geometry/
      smallBirdGeometry.ts    ← small-bird mesh/colours
      dragonGeometry.ts       ← dragon mesh/colours
      unicornGeometry.ts      ← unicorn mesh/colours
      hawkGeometry.ts         ← hawk mesh/colours
      parrotGeometry.ts       ← parrot mesh/colours
      birdSharedGeometry.ts   ← helpers shared by all bird-family creatures
  fishtank/
    environment.ts            ← fishtank scene environment
    geometry/
      smallFishGeometry.ts
      sharkGeometry.ts
      barracudaGeometry.ts
      butterflyfishGeometry.ts
      seaHorseGeometry.ts
      fishSharedGeometry.ts

src/render/geometry/
  sharedGeometry.ts           ← cross-scene shared geometry helpers
```

Add a new creature type by creating a new `<CreatureName>Geometry.ts` inside the correct
`styles/<scene>/geometry/` folder; do not append to an existing creature file.

---

## 6. Standard workflow recap

Every change — including documentation — must follow this process:

1. **Feature branch** — never commit directly to `main`:
   ```bash
   git checkout -b feature/short-description
   ```

2. **Conventional Commits** with a scope:
   ```
   feat(boids): add predator avoidance radius
   fix(renderer): correct dragon wing colour
   docs: add AGENTS.md parallel-dev conventions
   ```

3. **Copilot co-author trailer** on every commit:
   ```
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```

4. **Validate before opening a PR:**
   ```bash
   npx tsc --noEmit
   npm test -- --run
   npm run build
   ```

5. **Open a PR via GitHub MCP** (`pull_request_write`) — not `gh pr create` or direct push.

6. **Never `git push origin main`** — only push feature branches.

---

## 7. Quick sanity checklist

Before opening a PR, confirm:

- [ ] Branch starts with `feature/`, `fix/`, `refactor/`, `chore/`, or `docs/`
- [ ] No open PR already modifies the same file(s)
- [ ] New keys added to all three locales (`en`, `es`, `fr`) in `translations.ts`
- [ ] New `params.ts` fields appended within a logical group, not reordered
- [ ] Test file is concern-scoped (not a generic shared name)
- [ ] New renderer functions use named-field objects, not positional arg lists
- [ ] New creature / scene geometry lives in the correct `styles/<scene>/geometry/` file
- [ ] `tsc --noEmit`, `npm test -- --run`, and `npm run build` all pass
- [ ] Commit message follows Conventional Commits with scope + Copilot trailer

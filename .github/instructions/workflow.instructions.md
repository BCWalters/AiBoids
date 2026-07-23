---
description: Development workflow rules for all code changes in AiBoids
applyTo: '**/*.ts'
---

# AiBoids Development Workflow

## Branch and PR Policy

**All code changes must go through a feature branch and PR — never commit directly to `main`.**

This project may have multiple agents working in parallel. Direct commits to `main` bypass CI checks and make rollback harder.

### Required steps for every change:

1. **Create a feature branch** before making any edits:
   ```bash
   git checkout -b feature/short-description
   ```

2. **Make changes on the branch**, committing as you go.

3. **Run build and tests** on the branch before opening a PR:
   ```bash
   npm run build
   npm test
   ```

4. **Open a PR** via the GitHub MCP server (not `gh` CLI). Tests must pass.

5. **Never `git push origin main`** — only push feature branches.

### Naming convention
- `feature/` — new features
- `fix/` — bug fixes  
- `refactor/` — refactoring
- `nature/` — nature-style visual tuning

## Learnings

- **2026-07-23**: Direct-to-main commits happened during iterative visual tuning sessions. Even for small one-liner tweaks, create a branch first. The overhead is minimal and it protects parallel agent workflows.

- **2026-07-23**: `updateInstances` had 28 positional parameters — inserting a new bool at the wrong position caused a silent regression (small-bird gradients stopped rendering) with no TypeScript error. All new renderer parameters should use named-field objects (`ColourStrategy`, `MotionConfig`) not positional args.

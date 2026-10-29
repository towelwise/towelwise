# Contributing

- `main` is always releasable. Changes land through pull requests, not direct pushes.
- One short-lived branch per task, named by type: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Keep pull requests small. They are squash-merged, so each lands as one commit.
- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `chore:`, `copy:`.
- Stage files explicitly (no `git add .`) so nothing stray is committed.
- Before opening a PR, run `npm run lint`, `npm run build` and `npm test` from the repo root. CI runs the same checks plus packaging.

By contributing you agree your work is licensed under the Apache License 2.0.

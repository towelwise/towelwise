# Contributing

Towelwise AI is an IDE built from Code-OSS, with most of its code in a built-in extension. Read the [README](README.md) first, and the [glossary](GLOSSARY.md) for what the project's words mean.

## How changes land

- `main` is always releasable. Changes land through pull requests, not direct pushes.
- One short-lived branch per task, named by type: `feat/...`, `fix/...`, `docs/...`, `chore/...`, and `site/...` in the website repo.
- Keep pull requests small. They are squash-merged, so each lands as one commit.
- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `chore:`, `copy:`.
- Stage files explicitly (no `git add .`) so nothing stray is committed.

## Before opening a PR

From the repo root, run:

```sh
npm run lint
npm run build
npm test
```

CI runs the same checks, packages the extension, and also runs the tests on VS Code 1.90.0, the oldest version the extension claims to support. `npm test` downloads VS Code on first run and opens a window.

## Bigger changes

- **Where the code goes.** Most changes belong in the extension, [packages/towelwise/](packages/towelwise/). Core code is patched only where an extension cannot reach ([decision 0005](docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)). A new or changed patch in [ide/patches/](ide/patches/) needs its note in that folder's README, and a full build to prove it applies. CI does not run that build, so say in the PR whether you ran it.
- **Specs and decisions.** Work of any size starts from a short spec in [.work/specs/](.work/specs/). Choices that rule other things out get a record in [docs/decisions/](docs/decisions/): the choice, why, and what was ruled out. Open an issue to talk it through first if you are not sure.
- **Agents.** Towelwise never bundles or drives an agent, and says "works with", never "official" or "supported by".

## Reporting problems

Bugs and ideas go in [issues](https://github.com/towelwise/towelwise/issues). To report a security problem, see [SECURITY.md](SECURITY.md) and do not open a public issue.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree your work is licensed under the Apache License 2.0.

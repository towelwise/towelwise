# Towelwise

VS Code extensions, developed in one repo as separate packages. Licensed under Apache 2.0.

## Status

Early setup. The only package so far is an empty core extension, `towelwise.towelwise`, in [packages/towelwise/](packages/towelwise/). See [ROADMAP.md](ROADMAP.md) for the plan.

## Development

Requires Node 22+ and npm. From the repo root:

```sh
npm ci
npm run lint
npm run build
npm test
npm run package   # writes packages/towelwise/towelwise.vsix
```

`npm test` downloads VS Code on first run and opens a window.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

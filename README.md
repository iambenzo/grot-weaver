# GROT Weaver

A Grafana app plugin that scores how well a stack's telemetry follows the OpenTelemetry semantic conventions and shows where to fix it. What the plugin does for its users is described in [src/README.md](./src/README.md), which is also the page shown in the Grafana plugin catalogue.

## Layout

| Path                               | What it holds                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                             | Frontend: a Grafana Scenes app. It queries Prometheus, Tempo and Loki through the datasource proxy and builds an inventory of names and keys. |
| `pkg/`                             | Backend (Go): scores an inventory against the embedded semantic conventions catalogue and returns findings, scores and fix guidance.          |
| `cmd/catalogue-gen/`, `catalogue/` | Generates the embedded catalogue (`pkg/catalogue/data/`) from the semantic conventions registry with Weaver.                                  |
| `dev/`                             | Local stack (Prometheus, Loki, Tempo, Collector, emitters) for development. See [dev/README.md](./dev/README.md).                             |
| `tests/`                           | End-to-end and accessibility tests with `@grafana/plugin-e2e`.                                                                                |

## Requirements

- Node.js (version in `.nvmrc`) and npm
- Go (version in `go.mod`) and [Mage](https://magefile.org/)
- Docker, for the local Grafana and dev stack

## Develop

```sh
npm install
npm run build                    # frontend, once
go run github.com/magefile/mage@v1.17.2 build:linuxARM64   # backend for the dev container
docker compose up -d --build     # Grafana on http://localhost:13000 plus the dev stack
```

Then run `npm run dev` in a separate terminal to rebuild the frontend on every change; it keeps running.

Grafana loads the plugin from `dist/`. Restart Grafana after changing `src/plugin.json`.

## Test

```sh
npm run typecheck
npm run lint
npm run test:ci                  # Jest unit tests
go test ./...                    # backend tests
npm run e2e                      # Playwright, against the running Grafana
```

## Build

```sh
npm run build                    # frontend, production
go run github.com/magefile/mage@v1.17.2   # backend for all platforms
```

## Release

Releases are signed as a Community plugin from the Grafana Cloud org `benburbage`, so the plugin ID starts with `benburbage-`. Signing needs an Access Policy token from that org with the `plugins:write` scope, created under **My Account > Security > Access Policies**.

Set the version and changelog first: `npm version <major|minor|patch> --no-git-tag-version` updates `package.json`, which becomes the plugin version, and `CHANGELOG.md` needs a dated entry for it.

### From a tag (GitHub Actions)

Push a tag such as `v0.1.0`. `.github/workflows/release.yml` builds the frontend and every backend platform, signs the plugin when the repository secret `GRAFANA_ACCESS_POLICY_TOKEN` is set, attests the build and drafts a GitHub release with the ZIP and its SHA1. Attestation needs a public repository.

For the first submission, leave the secret unset: Grafana assigns the signature level only after review, and signing before that fails before the release is drafted. Add the secret once the plugin is approved. The workflow pins `build-plugin` to a commit, but that action calls `package-plugin@main`, so packaging and signing can still change upstream.

### Locally

```sh
npm ci
npm run build
go run github.com/magefile/mage@v1.17.2          # backends for every platform
export GRAFANA_ACCESS_POLICY_TOKEN=<token>
npm run sign                                     # writes dist/MANIFEST.txt
VERSION=$(node -p "require('./package.json').version")
cp -r dist benburbage-semconvcompliance-app
zip -r benburbage-semconvcompliance-app-$VERSION.zip benburbage-semconvcompliance-app
shasum benburbage-semconvcompliance-app-$VERSION.zip
```

Upload the ZIP and its SHA1 where the catalog submission can reach them, for example as GitHub release assets. Until the plugin has been reviewed and given a signature level, `npm run sign` fails; that first submission can be unsigned.

## Licence

AGPL-3.0-only. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

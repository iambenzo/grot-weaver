# OTel Semconv Compliance

A Grafana app plugin that scores how well a stack's telemetry follows the OpenTelemetry semantic conventions and shows where to fix it. What the plugin does for its users is described in [src/README.md](./src/README.md), which is also the page shown in the Grafana plugin catalogue.

## Layout

| Path                               | What it holds                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                             | Frontend: a Grafana Scenes app. It queries Prometheus, Tempo and Loki through the datasource proxy and builds an inventory of names and keys. |
| `pkg/`                             | Backend (Go): scores an inventory against the embedded semantic conventions catalogue and returns findings, scores and fix guidance.          |
| `cmd/catalogue-gen/`, `catalogue/` | Generates the embedded catalogue (`pkg/catalogue/data/`) from the semantic conventions registry with Weaver.                                  |
| `dev/`                             | Local stack (Prometheus, Loki, Tempo, Collector, emitters) for development. See [dev/README.md](./dev/README.md).                             |
| `tests/`                           | End-to-end and accessibility tests with `@grafana/plugin-e2e`.                                                                                |
| `backlog/`                         | Tasks, decisions and design docs, managed with Backlog.md.                                                                                    |

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

## Licence

AGPL-3.0-only. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

# @async/github-app API Surface Ledger

This file is the generated review ledger for semantic API contract features. It is current-state contract documentation, not a changelog or tutorial.

## Async GitHub App Package Exports

Contract: `@async/github-app.package`

### Exports

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.actions` | @async/github-app/actions exports GitHub Actions bridge workflow rendering and pull-based apply helpers | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `export.content` | @async/github-app/content exports JSON, JSONC, Markdown, MDX, and generic content mapping helpers | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `export.root` | @async/github-app exports auth providers, GitHub client operations, app metadata, change-set types, receipts, and safety helpers | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `export.server` | @async/github-app/server exports Fetch-compatible webhook verification and routing handlers | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |

## Async GitHub Integration Runtime

Contract: `@async/github-app.runtime`

### Runtime

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.actions-bridge` | Actions bridge mode renders workflow YAML and pulls approved change sets with repo-local GITHUB_TOKEN receipts | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `runtime.auth` | Auth providers support GitHub App installation tokens, user tokens, static tokens, and Actions GITHUB_TOKEN fallback | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `runtime.change-set` | Change sets validate safe paths and commit upserts or deletes serially with branch, commit, PR, and index receipt metadata | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `runtime.content` | Content helpers map records to JSON, JSONC read-only-by-default, Markdown, and MDX file formats without schema ownership | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |
| `runtime.webhook` | Webhook handlers verify SHA-256 signatures before JSON routing and treat duplicate delivery ids idempotently | public | preview | active |  | [docs](https://github.com/async/github-app/blob/main/README.md) |

## Supported Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/github-app.package` | `sha256:9417af3e2ab66056111e0963fb92c2142a0ddba2fd53de1fb981a78af43ddf42` | `export.actions`, `export.content`, `export.root`, `export.server` |
| `@async/github-app.runtime` | `sha256:f21bef8556025acf31d8cfe0e22e12beefe9c7a8f50b06bd59a39c651d8cacdc` | `runtime.actions-bridge`, `runtime.auth`, `runtime.change-set`, `runtime.content`, `runtime.webhook` |

# Repository Guide For AI Agents

## Project Shape

This repo is a dependency-light Node.js ESM package named `@async/github-app`.

Core responsibilities:

- Authenticate as a GitHub App installation, user token, static token, or repo-local Actions bridge.
- Create branches, commit safe file change sets, open or update pull requests, compare refs, and read tree snapshots.
- Verify and route GitHub webhooks through Fetch-compatible handlers.
- Render and run the repo-local GitHub Actions bridge for organizations that cannot approve a GitHub App install.
- Provide content-format helpers for JSON, JSONC read/index support, Markdown, and MDX without owning app schemas.

Boundaries:

- Do not commit, log, test-fixture, or print real private keys, webhook secrets, installation tokens, PATs, cookies, or customer secrets.
- `@async/github-app` owns GitHub auth, branch, commit, PR, webhook, receipt, and Actions bridge mechanics.
- `@async/db` will own resource contracts, validation, generated types, REST/GraphQL, and runtime stores when it adds `githubStore`.
- Keep JSON/Markdown support content-format agnostic. Do not hard-code Async DB resources here.

## Commands

Use these while editing:

```bash
pnpm run build
pnpm run test
pnpm run api-surface:check
pnpm run pack:check
```

Run this before handing off releaseable changes:

```bash
pnpm run release:check
```

## Implementation Rules

- Keep the package ESM, Node.js 24+, pnpm, and dependency-light.
- Use explicit `.js` import extensions in TypeScript source.
- Prefer Web Fetch-compatible APIs for public server surfaces.
- Preserve generator ownership for GitHub Actions. CI workflow files are generated from `pipeline.ts` through `@async/pipeline`.
- Validate every change-set path before committing:
  - no absolute paths
  - no `..`
  - no `.github/workflows/**` writes unless explicitly enabled by the caller
- JSONC writes are rejected by default. Only allow them when the caller opts in and accepts canonical JSON output.
- Webhook verification must check `X-Hub-Signature-256` before treating the JSON body as trusted.
- Receipts should not include file contents unless a future explicit option adds that behavior.

## Testing Guidance

Use Node's built-in `node:test` runner. Tests should mock GitHub and Async endpoints with local fetch functions and generated throwaway keys. Do not use real tokens, app keys, or webhook secrets.

Public API changes require:

- Updated `api-contract.json`.
- Regenerated or updated `API_SURFACE.md`.
- README coverage when users need to call the new behavior.
- Tests for the behavior, especially auth, path validation, serializers, webhook verification, Actions workflow rendering, and receipt emission.

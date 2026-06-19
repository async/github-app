# @async/github-app

Reusable GitHub integration layer for Async packages.

It supports two operating modes:

- **GitHub App mode** for the normal SaaS path. Use the Async-owned app metadata by default, or pass a consumer-owned app definition with `defineGithubApp`.
- **GitHub Actions bridge mode** for organizations that cannot approve a GitHub App installation. The repo installs a generated workflow and uses its own `GITHUB_TOKEN`.

The package is content-format agnostic. JSON, JSONC read/index support, Markdown, and MDX use the same branch, commit, pull request, webhook, and receipt machinery.

## Install

```bash
pnpm add @async/github-app
```

Requires Node.js 24 or newer.

## Package Exports

```ts
import {
  asyncGithubApp,
  createGitHubClient,
  defineGithubApp,
  githubAppAuth
} from "@async/github-app";

import { createGithubWebhookHandler } from "@async/github-app/server";
import { renderActionsBridgeWorkflow } from "@async/github-app/actions";
import { contentMapping, renderJsonContent } from "@async/github-app/content";
```

## GitHub App Mode

The Async-owned app metadata is exported for product wiring:

```ts
import { asyncGithubApp } from "@async/github-app";

console.log(asyncGithubApp.installUrl);
```

Use installation auth at runtime:

```ts
import { createGitHubClient, githubAppAuth } from "@async/github-app";

const auth = githubAppAuth({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  installationId: process.env.GITHUB_INSTALLATION_ID
});

const github = createGitHubClient(auth);

await github.ensureBranch({
  repo: "acme/site",
  from: "main",
  branch: "async/update-homepage"
});

const receipt = await github.commitChangeSet({
  repo: "acme/site",
  branch: "async/update-homepage",
  baseBranch: "main",
  message: "Update homepage content",
  files: [
    {
      path: "content/settings.json",
      action: "upsert",
      content: renderJsonContent({ title: "Hello" })
    }
  ],
  allowedPathGlobs: ["content/**"]
});
```

Do not commit private keys, webhook secrets, installation tokens, PATs, or customer tokens. This package never ships Async-owned credentials.

Consumers can bring their own app definition:

```ts
import { defineGithubApp } from "@async/github-app";

export const customerApp = defineGithubApp({
  metadata: {
    slug: "acme-content-app",
    installUrl: "https://github.com/apps/acme-content-app/installations/new",
    callbackUrl: "https://acme.example/github/callback"
  },
  permissions: {
    contents: "write",
    metadata: "read",
    pull_requests: "write"
  }
});
```

## Webhooks

`@async/github-app/server` exports Fetch-compatible handlers that work in Workers-style runtimes and can be adapted to Node HTTP.

```ts
import { createGithubWebhookHandler } from "@async/github-app/server";

export default {
  fetch: createGithubWebhookHandler({
    verify: { secret: process.env.GITHUB_WEBHOOK_SECRET },
    route: {
      push: async (event) => {
        await queueReindex(event.payload);
      },
      pull_request: async (event) => {
        await queueReindex(event.payload);
      }
    }
  })
};
```

The handler verifies `X-Hub-Signature-256` before parsing trusted JSON, limits body size, and treats duplicate GitHub delivery IDs as idempotent.

## GitHub Actions Bridge Mode

For organizations that cannot approve a GitHub App install, render a repo-local workflow:

```ts
import { renderActionsBridgeWorkflow } from "@async/github-app/actions";

const yaml = renderActionsBridgeWorkflow({
  asyncEndpoint: "${{ vars.ASYNC_PROJECT_URL }}",
  branchPrefix: "async/bridge/",
  allowedPathGlobs: ["pipeline.ts", "package.json", "docs/**"]
});
```

Prefer `@async/pipeline` generated workflows for new repos so workflow triggers,
permissions, action pins, locks, and secret routing stay centrally managed. The
standalone renderer remains available for compatibility.

The generated workflow:

- supports `workflow_dispatch`
- runs on a documented five-minute schedule by default
- requests `contents: write` and `pull-requests: write`
- uses `ASYNC_PROJECT_TOKEN` plus repo-local `GITHUB_TOKEN`
- pulls approved change sets from Async
- enforces configured branch-prefix and allowed-path constraints
- commits branches and optionally opens PRs
- posts lease-aware receipts back to Async

Repo setting required for PR creation: enable “Allow GitHub Actions to create and approve pull requests”. If that is unavailable, Async can use branch-only mode and let a human open the PR.

External dispatch is optional. Async can trigger `workflow_dispatch` only when the customer provides a token with Actions write permission. Without that token, schedule or manual run is the fallback.

## Content Helpers

JSON writes are canonical and stable:

```ts
import { renderJsonContent } from "@async/github-app/content";

const content = renderJsonContent({ enabled: true });
```

JSONC is readable by default, but writes are opt-in because comments and formatting cannot be preserved safely:

```ts
import { parseJsoncContent } from "@async/github-app/content";

const value = parseJsoncContent(`{
  // allowed on read
  "enabled": true,
}`);
```

Markdown and MDX helpers preserve body text and use frontmatter for record fields:

```ts
import { parseMarkdownRecord, renderMarkdownRecord } from "@async/github-app/content";

const record = parseMarkdownRecord("---\ntitle: \"Hello\"\n---\nBody text\n");
const file = renderMarkdownRecord(record);
```

Generic mappings let future `@async/db` integration point resources at files without hard-coding formats into GitHub auth:

```ts
import { contentMapping } from "@async/github-app/content";

const posts = contentMapping({
  resource: "posts",
  pattern: "content/posts/{id}.json",
  format: "json"
});

const path = posts.pathFromRecord({ id: "hello", title: "Hello" });
```

## Safety Defaults

Change-set paths are rejected when they are absolute, include `..`, include empty segments, duplicate another file in the same change set, or write `.github/workflows/**` without `allowWorkflowPaths`.

Use `allowedPathGlobs` to constrain writes:

```ts
await github.commitChangeSet({
  repo: "acme/site",
  branch: "async/content",
  message: "Update content",
  files,
  allowedPathGlobs: ["content/**", "docs/**"]
});
```

Receipts include commit SHAs, branch names, PR URLs, file paths, and index hints. They do not include file contents.

## Verification

```bash
pnpm install
pnpm run release:check
npm pack --dry-run
```

CI is generated from `pipeline.ts` by `@async/pipeline`; workflow YAML should not be hand-edited.

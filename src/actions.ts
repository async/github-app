import { actionsBridgeAuth } from "./auth.js";
import { createGitHubClient } from "./github.js";
import type { ChangeSet, CommitReceipt, GitHubAuthProvider } from "./types.js";
import { redactSensitive } from "./util.js";

export interface RenderActionsBridgeWorkflowOptions {
  readonly name?: string;
  readonly asyncEndpoint?: string;
  readonly packageVersion?: string;
  readonly schedule?: string;
  readonly includePushTrigger?: boolean;
  readonly nodeVersion?: string | number;
  readonly pnpmVersion?: string;
}

export interface PendingChangeSetsResponse {
  readonly changeSets: readonly ChangeSet[];
}

export interface ApplyActionsBridgeOptions {
  readonly endpoint: string;
  readonly projectToken: string;
  readonly repository: string;
  readonly auth?: GitHubAuthProvider;
  readonly fetch?: typeof fetch;
  readonly requireApproved?: boolean;
}

export interface ApplyActionsBridgeResult {
  readonly receipts: readonly CommitReceipt[];
  readonly skipped: number;
}

export function renderActionsBridgeWorkflow(options: RenderActionsBridgeWorkflowOptions = {}): string {
  const name = options.name ?? "Async GitHub Bridge";
  const asyncEndpoint = options.asyncEndpoint ?? "${{ vars.ASYNC_PROJECT_URL }}";
  const packageVersion = options.packageVersion ?? "latest";
  const schedule = options.schedule ?? "*/5 * * * *";
  const nodeVersion = String(options.nodeVersion ?? 24);
  const pnpmVersion = options.pnpmVersion ?? "10.20.0";
  const pushTrigger = options.includePushTrigger ? "\n  push:\n    branches:\n      - main\n" : "";

  return `name: ${name}

on:
  workflow_dispatch:
  schedule:
    - cron: "${schedule}"${pushTrigger}

permissions:
  contents: write
  pull-requests: write

jobs:
  bridge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${pnpmVersion}
      - uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          cache: pnpm
      - name: Pull and apply Async change sets
        run: pnpm dlx @async/github-app@${packageVersion} actions pull
        env:
          ASYNC_PROJECT_URL: ${asyncEndpoint}
          ASYNC_PROJECT_TOKEN: \${{ secrets.ASYNC_PROJECT_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
`;
}

export async function applyActionsBridge(options: ApplyActionsBridgeOptions): Promise<ApplyActionsBridgeResult> {
  const apiFetch = options.fetch ?? fetch;
  const auth = options.auth ?? actionsBridgeAuth();
  const client = createGitHubClient(auth);
  const pending = await requestJson<PendingChangeSetsResponse>(apiFetch, `${trimSlash(options.endpoint)}/github/actions-bridge/change-sets?repo=${encodeURIComponent(options.repository)}`, {
    method: "GET",
    token: options.projectToken
  });
  const receipts: CommitReceipt[] = [];
  let skipped = 0;

  for (const changeSet of pending.changeSets) {
    if ((options.requireApproved ?? true) && changeSet.metadata?.approved !== true) {
      skipped += 1;
      continue;
    }

    const receipt = await client.commitChangeSet({
      repo: changeSet.repo,
      branch: changeSet.targetBranch,
      baseBranch: changeSet.baseBranch,
      changeSetId: changeSet.id,
      message: changeSet.message ?? `Apply Async change set ${changeSet.id}`,
      files: changeSet.files,
      metadata: changeSet.metadata
    });
    receipts.push(receipt);

    if (changeSet.mode === "pull_request" || changeSet.mode === "actions-pull") {
      const pr = await client.openOrUpdatePullRequest({
        repo: changeSet.repo,
        head: changeSet.targetBranch,
        base: changeSet.baseBranch,
        title: changeSet.title ?? `Apply Async change set ${changeSet.id}`,
        body: changeSet.body ?? "Created by the Async GitHub Actions bridge."
      });
      receipts[receipts.length - 1] = {
        ...receipt,
        pullRequestUrl: pr.url
      };
    }
  }

  await requestJson(apiFetch, `${trimSlash(options.endpoint)}/github/actions-bridge/receipts`, {
    method: "POST",
    token: options.projectToken,
    body: {
      repository: options.repository,
      receipts,
      skipped
    }
  });

  return { receipts, skipped };
}

async function requestJson<T>(
  apiFetch: typeof fetch,
  url: string,
  options: { readonly method: string; readonly token: string; readonly body?: unknown }
): Promise<T> {
  const init: RequestInit = {
    method: options.method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json"
    }
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await apiFetch(url, init);

  if (!response.ok) {
    throw new Error(`Async Actions bridge request failed with ${response.status}: ${redactSensitive(await response.text())}`);
  }

  return await response.json() as T;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

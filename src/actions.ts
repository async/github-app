import { actionsBridgeAuth } from "./auth.js";
import { createGitHubClient } from "./github.js";
import type { ChangeSet, CommitReceipt, GitHubAuthProvider, GitHubRepoInput } from "./types.js";
import { redactSensitive } from "./util.js";

export interface RenderActionsBridgeWorkflowOptions {
  readonly name?: string;
  readonly asyncEndpoint?: string;
  readonly packageVersion?: string;
  readonly schedule?: string;
  readonly includePushTrigger?: boolean;
  readonly nodeVersion?: string | number;
  readonly pnpmVersion?: string;
  readonly branchPrefix?: string;
  readonly allowedPathGlobs?: readonly string[];
  readonly pullRequest?: boolean;
}

export interface PendingChangeSetsResponse {
  readonly changeSets: readonly ChangeSet[];
  readonly leases?: readonly ActionsBridgeLease[];
}

export interface ActionsBridgeLease {
  readonly changeSetId: string;
  readonly repo: string;
  readonly worker: "actions" | "app";
  readonly leaseId: string;
  readonly leaseExpiresAt?: string;
}

export interface ApplyActionsBridgeOptions {
  readonly endpoint: string;
  readonly projectToken: string;
  readonly repository: string;
  readonly auth?: GitHubAuthProvider;
  readonly fetch?: typeof fetch;
  readonly requireApproved?: boolean;
  readonly branchPrefix?: string;
  readonly allowedPathGlobs?: readonly string[];
  readonly pullRequest?: boolean;
}

export interface ApplyActionsBridgeResult {
  readonly receipts: readonly ActionsBridgeReceipt[];
  readonly skipped: number;
}

export interface ActionsBridgeReceipt extends CommitReceipt {
  readonly changeSetId: string;
  readonly leaseId?: string;
  readonly leaseExpiresAt?: string;
  readonly worker: "actions";
  readonly status: "applied";
}

export function renderActionsBridgeWorkflow(options: RenderActionsBridgeWorkflowOptions = {}): string {
  const name = options.name ?? "Async GitHub Bridge";
  const asyncEndpoint = options.asyncEndpoint ?? "${{ vars.ASYNC_PROJECT_URL }}";
  const packageVersion = options.packageVersion ?? "latest";
  const schedule = options.schedule ?? "*/5 * * * *";
  const nodeVersion = String(options.nodeVersion ?? 24);
  const pnpmVersion = options.pnpmVersion ?? "10.20.0";
  const pushTrigger = options.includePushTrigger ? "\n  push:\n    branches:\n      - main\n" : "";
  const pullArgs = renderActionsPullArgs({
    branchPrefix: options.branchPrefix,
    allowedPathGlobs: options.allowedPathGlobs,
    pullRequest: options.pullRequest
  });

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
        run: pnpm dlx @async/github-app@${packageVersion} actions pull${pullArgs}
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
  const leases = indexLeases(pending.leases);
  const receipts: ActionsBridgeReceipt[] = [];
  let skipped = 0;

  for (const changeSet of pending.changeSets) {
    if ((options.requireApproved ?? true) && changeSet.metadata?.approved !== true) {
      skipped += 1;
      continue;
    }
    if (!isAllowedActionsWorker(changeSet.metadata)) {
      skipped += 1;
      continue;
    }
    const lease = leases.get(changeSet.id) ?? leaseFromMetadata(changeSet);
    if (lease && lease.worker !== "actions") {
      skipped += 1;
      continue;
    }
    if (lease && lease.repo !== formatRepoInput(changeSet.repo)) {
      throw new Error(`Actions bridge rejected change set ${changeSet.id}: lease repo ${lease.repo} does not match change set repo ${formatRepoInput(changeSet.repo)}.`);
    }
    if (options.branchPrefix && !changeSet.targetBranch.startsWith(options.branchPrefix)) {
      throw new Error(`Actions bridge rejected change set ${changeSet.id}: target branch must start with ${options.branchPrefix}.`);
    }

    const receipt = toActionsBridgeReceipt(await client.commitChangeSet({
      repo: changeSet.repo,
      branch: changeSet.targetBranch,
      baseBranch: changeSet.baseBranch,
      changeSetId: changeSet.id,
      message: changeSet.message ?? `Apply Async change set ${changeSet.id}`,
      files: changeSet.files,
      allowedPathGlobs: options.allowedPathGlobs,
      metadata: changeSet.metadata
    }), changeSet, lease);
    receipts.push(receipt);

    if (options.pullRequest !== false && (changeSet.mode === "pull_request" || changeSet.mode === "actions-pull")) {
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

function toActionsBridgeReceipt(receipt: CommitReceipt, changeSet: ChangeSet, lease: ActionsBridgeLease | undefined): ActionsBridgeReceipt {
  return {
    ...receipt,
    changeSetId: changeSet.id,
    ...(lease ? { leaseId: lease.leaseId } : {}),
    ...(lease?.leaseExpiresAt ? { leaseExpiresAt: lease.leaseExpiresAt } : {}),
    worker: "actions",
    status: "applied"
  };
}

function indexLeases(leases: readonly ActionsBridgeLease[] | undefined): Map<string, ActionsBridgeLease> {
  const indexed = new Map<string, ActionsBridgeLease>();
  for (const lease of leases ?? []) {
    indexed.set(lease.changeSetId, lease);
  }
  return indexed;
}

function leaseFromMetadata(changeSet: ChangeSet): ActionsBridgeLease | undefined {
  const leaseId = changeSet.metadata?.leaseId;
  if (typeof leaseId !== "string" || !leaseId) return undefined;
  const worker = changeSet.metadata?.worker === "app" ? "app" : "actions";
  const leaseExpiresAt = typeof changeSet.metadata.leaseExpiresAt === "string" ? changeSet.metadata.leaseExpiresAt : undefined;
  return {
    changeSetId: changeSet.id,
    repo: formatRepoInput(changeSet.repo),
    worker,
    leaseId,
    ...(leaseExpiresAt ? { leaseExpiresAt } : {})
  };
}

function formatRepoInput(repo: GitHubRepoInput): string {
  return typeof repo === "string" ? repo : `${repo.owner}/${repo.repo}`;
}

function renderActionsPullArgs(options: {
  readonly allowedPathGlobs?: readonly string[] | undefined;
  readonly branchPrefix?: string | undefined;
  readonly pullRequest?: boolean | undefined;
}): string {
  const args: string[] = [];
  if (options.branchPrefix) args.push("--branch-prefix", options.branchPrefix);
  if (options.pullRequest !== undefined) args.push("--pull-request", String(options.pullRequest));
  for (const glob of options.allowedPathGlobs ?? []) {
    args.push("--allowed-path", glob);
  }
  return args.length > 0 ? ` ${args.map(shellWord).join(" ")}` : "";
}

function isAllowedActionsWorker(metadata: Record<string, unknown> | undefined): boolean {
  const allowedWorkers = metadata?.allowedWorkers;
  if (!Array.isArray(allowedWorkers)) return true;
  return allowedWorkers.includes("actions");
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

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@*-]+$/u.test(value) ? value : JSON.stringify(value);
}

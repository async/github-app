import type {
  ChangeFile,
  ChangeFileReceipt,
  CommitChangeSetOptions,
  CommitReceipt,
  CompareBranchOptions,
  CompareBranchReceipt,
  EnsureBranchOptions,
  EnsureBranchReceipt,
  GitHubAuthProvider,
  GitHubClient,
  GitHubRepo,
  GitHubRepoInput,
  OpenOrUpdatePullRequestOptions,
  PullRequestReceipt,
  TreeSnapshot,
  TreeSnapshotEntry,
  TreeSnapshotOptions
} from "./types.js";
import { validateChangeFiles } from "./safety.js";
import { redactSensitive, utf8ToBase64 } from "./util.js";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function createGitHubClient(auth: GitHubAuthProvider): GitHubClient {
  async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await auth.getToken();
    const init: RequestInit = {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28"
      }
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${auth.baseUrl}${path}`, init);

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub ${method} ${path} failed with ${response.status}: ${redactSensitive(text)}`,
        response.status,
        method,
        path
      );
    }

    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    ensureBranch: (options) => ensureBranch(request, options),
    commitChangeSet: (options) => commitChangeSet(request, options),
    openOrUpdatePullRequest: (options) => openOrUpdatePullRequest(request, options),
    getTreeSnapshot: (options) => getTreeSnapshot(request, options),
    compareBranch: (options) => compareBranch(request, options)
  };
}

export function parseGitHubRepo(input: GitHubRepoInput): GitHubRepo {
  if (typeof input !== "string") {
    return input;
  }

  const [owner, repo, extra] = input.split("/");
  if (!owner || !repo || extra) {
    throw new Error(`Expected GitHub repo as owner/name, received "${input}".`);
  }

  return { owner, repo };
}

export function formatGitHubRepo(input: GitHubRepoInput): string {
  const repo = parseGitHubRepo(input);
  return `${repo.owner}/${repo.repo}`;
}

async function ensureBranch(
  request: GitHubClient["request"],
  options: EnsureBranchOptions
): Promise<EnsureBranchReceipt> {
  const repo = parseGitHubRepo(options.repo);
  const repoName = formatGitHubRepo(repo);
  const branchPath = `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(options.branch)}`;

  try {
    const existing = await request<{ object: { sha: string } }>("GET", branchPath);
    return {
      repo: repoName,
      branch: options.branch,
      sha: existing.object.sha,
      created: false
    };
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error;
    }
  }

  const base = await request<{ object: { sha: string } }>(
    "GET",
    `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(options.from)}`
  );
  await request("POST", `/repos/${repo.owner}/${repo.repo}/git/refs`, {
    ref: `refs/heads/${options.branch}`,
    sha: base.object.sha
  });

  return {
    repo: repoName,
    branch: options.branch,
    sha: base.object.sha,
    created: true
  };
}

async function commitChangeSet(
  request: GitHubClient["request"],
  options: CommitChangeSetOptions
): Promise<CommitReceipt> {
  validateChangeFiles(options.files, {
    allowWorkflowPaths: options.allowWorkflowPaths,
    allowedPathGlobs: options.allowedPathGlobs
  });

  const repo = parseGitHubRepo(options.repo);
  const repoName = formatGitHubRepo(repo);
  const receipts: ChangeFileReceipt[] = [];
  const commitShas: string[] = [];

  for (const file of options.files) {
    const receipt = await commitOneFile(request, repo, options.branch, options.message, file, {
      author: options.author,
      committer: options.committer
    });
    receipts.push(receipt);
    if (receipt.commitSha) {
      commitShas.push(receipt.commitSha);
    }
  }

  return {
    id: options.changeSetId,
    repo: repoName,
    branch: options.branch,
    baseBranch: options.baseBranch,
    commitSha: commitShas.at(-1),
    commitShas,
    files: receipts,
    indexHints: extractIndexHints(options.metadata),
    metadata: options.metadata
  };
}

async function commitOneFile(
  request: GitHubClient["request"],
  repo: GitHubRepo,
  branch: string,
  message: string,
  file: ChangeFile,
  identity: Pick<CommitChangeSetOptions, "author" | "committer">
): Promise<ChangeFileReceipt> {
  const contentPath = `/repos/${repo.owner}/${repo.repo}/contents/${encodeContentPath(file.path)}`;
  const sha = file.previousSha ?? await getContentSha(request, contentPath, branch);

  if (file.action === "delete") {
    if (!sha) {
      throw new GitHubApiError(`Cannot delete ${file.path}; GitHub did not return an existing sha.`, 404, "GET", contentPath);
    }

    const deleted = await request<{ commit: { sha: string } }>("DELETE", contentPath, {
      message,
      sha,
      branch,
      author: identity.author,
      committer: identity.committer
    });

    return {
      path: file.path,
      action: "delete",
      commitSha: deleted.commit.sha,
      contentSha: sha
    };
  }

  const updated = await request<{ content?: { sha?: string }; commit: { sha: string } }>("PUT", contentPath, {
    message,
    content: file.encoding === "base64" ? file.content : utf8ToBase64(file.content ?? ""),
    sha,
    branch,
    author: identity.author,
    committer: identity.committer
  });

  return {
    path: file.path,
    action: "upsert",
    commitSha: updated.commit.sha,
    contentSha: updated.content?.sha
  };
}

async function getContentSha(
  request: GitHubClient["request"],
  contentPath: string,
  branch: string
): Promise<string | undefined> {
  try {
    const current = await request<{ sha?: string }>("GET", `${contentPath}?ref=${encodeURIComponent(branch)}`);
    return current.sha;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return undefined;
    }

    throw error;
  }
}

async function openOrUpdatePullRequest(
  request: GitHubClient["request"],
  options: OpenOrUpdatePullRequestOptions
): Promise<PullRequestReceipt> {
  const repo = parseGitHubRepo(options.repo);
  const headForSearch = options.head.includes(":") ? options.head : `${repo.owner}:${options.head}`;
  const existing = await request<Array<{ number: number; html_url: string }>>(
    "GET",
    `/repos/${repo.owner}/${repo.repo}/pulls?state=open&head=${encodeURIComponent(headForSearch)}&base=${encodeURIComponent(options.base)}`
  );

  if (existing[0]) {
    const updated = await request<{ number: number; html_url: string }>(
      "PATCH",
      `/repos/${repo.owner}/${repo.repo}/pulls/${existing[0].number}`,
      {
        title: options.title,
        body: options.body
      }
    );

    return {
      number: updated.number,
      url: updated.html_url,
      head: options.head,
      base: options.base,
      created: false
    };
  }

  const created = await request<{ number: number; html_url: string }>("POST", `/repos/${repo.owner}/${repo.repo}/pulls`, {
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
    draft: options.draft
  });

  return {
    number: created.number,
    url: created.html_url,
    head: options.head,
    base: options.base,
    created: true
  };
}

async function getTreeSnapshot(
  request: GitHubClient["request"],
  options: TreeSnapshotOptions
): Promise<TreeSnapshot> {
  const repo = parseGitHubRepo(options.repo);
  const entries: TreeSnapshotEntry[] = [];

  if (options.paths?.length) {
    for (const path of options.paths) {
      const item = await request<GitHubContentItem | GitHubContentItem[]>(
        "GET",
        `/repos/${repo.owner}/${repo.repo}/contents/${encodeContentPath(path)}?ref=${encodeURIComponent(options.ref)}`
      );
      const items = Array.isArray(item) ? item : [item];
      for (const entry of items) {
        entries.push({
          path: entry.path,
          sha: entry.sha,
          type: normalizeContentType(entry.type),
          size: entry.size
        });
      }
    }
  } else {
    const tree = await request<{ tree: Array<{ path: string; sha: string; type: "tree" | "blob"; size?: number }> }>(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(options.ref)}?recursive=1`
    );
    for (const entry of tree.tree) {
      entries.push({
        path: entry.path,
        sha: entry.sha,
        type: entry.type,
        size: entry.size
      });
    }
  }

  return {
    repo: formatGitHubRepo(repo),
    ref: options.ref,
    entries
  };
}

async function compareBranch(
  request: GitHubClient["request"],
  options: CompareBranchOptions
): Promise<CompareBranchReceipt> {
  const repo = parseGitHubRepo(options.repo);
  const compared = await request<{
    status: string;
    ahead_by: number;
    behind_by: number;
    commits: Array<{ sha: string }>;
    html_url?: string;
  }>(
    "GET",
    `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(options.base)}...${encodeURIComponent(options.head)}`
  );

  return {
    status: compared.status,
    aheadBy: compared.ahead_by,
    behindBy: compared.behind_by,
    commits: compared.commits.map((commit) => ({ sha: commit.sha })),
    htmlUrl: compared.html_url
  };
}

interface GitHubContentItem {
  readonly path: string;
  readonly sha: string;
  readonly type: "file" | "dir" | "symlink" | "submodule";
  readonly size?: number;
}

function normalizeContentType(type: GitHubContentItem["type"]): TreeSnapshotEntry["type"] {
  return type;
}

function encodeContentPath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function extractIndexHints(metadata: Record<string, unknown> | undefined): readonly string[] {
  const hints = metadata?.indexHints;
  return Array.isArray(hints) && hints.every((hint) => typeof hint === "string") ? hints : [];
}

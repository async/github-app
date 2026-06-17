export type GitHubBaseUrl = `https://${string}` | `http://${string}`;

export interface GitHubAuthProvider {
  readonly kind: string;
  readonly baseUrl: GitHubBaseUrl;
  getToken(scope?: GitHubAuthScope): Promise<string>;
}

export interface GitHubAuthScope {
  readonly repo?: GitHubRepoInput;
  readonly permissions?: Record<string, "read" | "write">;
}

export interface GitHubAppAuthOptions {
  readonly appId: string | number;
  readonly privateKey: string;
  readonly installationId: string | number;
  readonly baseUrl?: GitHubBaseUrl | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface TokenAuthOptions {
  readonly token: string;
  readonly baseUrl?: GitHubBaseUrl | undefined;
}

export interface ActionsBridgeAuthOptions {
  readonly tokenEnv?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly baseUrl?: GitHubBaseUrl | undefined;
}

export interface AsyncGithubAppMetadata {
  readonly slug: string;
  readonly installUrl: string;
  readonly callbackUrl: string;
  readonly webhookEvents: readonly string[];
  readonly permissions: Readonly<Record<string, "read" | "write">>;
}

export interface GithubAppDefinition {
  readonly metadata: AsyncGithubAppMetadata;
  readonly auth?: GitHubAuthProvider | undefined;
  readonly permissions: Readonly<Record<string, "read" | "write">>;
  readonly endpoints: Readonly<Record<string, string>>;
}

export interface DefineGithubAppOptions {
  readonly metadata?: Partial<AsyncGithubAppMetadata> | undefined;
  readonly auth?: GitHubAuthProvider | undefined;
  readonly permissions?: Record<string, "read" | "write"> | undefined;
  readonly endpoints?: Record<string, string> | undefined;
}

export interface GitHubRepo {
  readonly owner: string;
  readonly repo: string;
}

export type GitHubRepoInput = GitHubRepo | `${string}/${string}`;

export type ChangeFileAction = "upsert" | "delete";

export interface ChangeFile {
  readonly path: string;
  readonly action: ChangeFileAction;
  readonly content?: string | undefined;
  readonly encoding?: "utf8" | "base64" | undefined;
  readonly previousSha?: string | undefined;
}

export type ChangeSetMode = "app" | "actions-pull" | "actions-dispatch" | "token" | "branch" | "pull_request" | "direct";

export interface ChangeSet {
  readonly id: string;
  readonly repo: GitHubRepoInput;
  readonly baseBranch: string;
  readonly targetBranch: string;
  readonly mode: ChangeSetMode;
  readonly files: readonly ChangeFile[];
  readonly message?: string | undefined;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface GitAuthor {
  readonly name: string;
  readonly email: string;
  readonly date?: string | undefined;
}

export interface CommitChangeSetOptions {
  readonly repo: GitHubRepoInput;
  readonly branch: string;
  readonly message: string;
  readonly files: readonly ChangeFile[];
  readonly baseBranch?: string | undefined;
  readonly changeSetId?: string | undefined;
  readonly author?: GitAuthor | undefined;
  readonly committer?: GitAuthor | undefined;
  readonly allowWorkflowPaths?: boolean | undefined;
  readonly allowedPathGlobs?: readonly string[] | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ChangeFileReceipt {
  readonly path: string;
  readonly action: ChangeFileAction;
  readonly commitSha?: string | undefined;
  readonly contentSha?: string | undefined;
}

export interface CommitReceipt {
  readonly id?: string | undefined;
  readonly repo: string;
  readonly branch: string;
  readonly baseBranch?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly commitShas: readonly string[];
  readonly pullRequestUrl?: string | undefined;
  readonly files: readonly ChangeFileReceipt[];
  readonly indexHints: readonly string[];
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface EnsureBranchOptions {
  readonly repo: GitHubRepoInput;
  readonly from: string;
  readonly branch: string;
}

export interface EnsureBranchReceipt {
  readonly repo: string;
  readonly branch: string;
  readonly sha: string;
  readonly created: boolean;
}

export interface OpenOrUpdatePullRequestOptions {
  readonly repo: GitHubRepoInput;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body?: string | undefined;
  readonly draft?: boolean | undefined;
}

export interface PullRequestReceipt {
  readonly number: number;
  readonly url: string;
  readonly head: string;
  readonly base: string;
  readonly created: boolean;
}

export interface TreeSnapshotOptions {
  readonly repo: GitHubRepoInput;
  readonly ref: string;
  readonly paths?: readonly string[];
}

export interface TreeSnapshotEntry {
  readonly path: string;
  readonly sha: string;
  readonly type: "file" | "dir" | "symlink" | "submodule" | "tree" | "blob";
  readonly size?: number | undefined;
}

export interface TreeSnapshot {
  readonly repo: string;
  readonly ref: string;
  readonly entries: readonly TreeSnapshotEntry[];
}

export interface CompareBranchOptions {
  readonly repo: GitHubRepoInput;
  readonly base: string;
  readonly head: string;
}

export interface CompareBranchReceipt {
  readonly status: string;
  readonly aheadBy: number;
  readonly behindBy: number;
  readonly commits: readonly { readonly sha: string }[];
  readonly htmlUrl?: string | undefined;
}

export interface GitHubClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  ensureBranch(options: EnsureBranchOptions): Promise<EnsureBranchReceipt>;
  commitChangeSet(options: CommitChangeSetOptions): Promise<CommitReceipt>;
  openOrUpdatePullRequest(options: OpenOrUpdatePullRequestOptions): Promise<PullRequestReceipt>;
  getTreeSnapshot(options: TreeSnapshotOptions): Promise<TreeSnapshot>;
  compareBranch(options: CompareBranchOptions): Promise<CompareBranchReceipt>;
}

export interface PathSafetyOptions {
  readonly allowWorkflowPaths?: boolean | undefined;
  readonly allowedPathGlobs?: readonly string[] | undefined;
}

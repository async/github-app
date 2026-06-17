import { createSign } from "node:crypto";

import type {
  ActionsBridgeAuthOptions,
  GitHubAppAuthOptions,
  GitHubAuthProvider,
  GitHubAuthScope,
  TokenAuthOptions
} from "./types.js";
import { base64Url, DEFAULT_GITHUB_API_BASE_URL, redactSensitive } from "./util.js";

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

interface CachedInstallationToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export function staticTokenAuth(options: TokenAuthOptions): GitHubAuthProvider {
  return {
    kind: "static-token",
    baseUrl: options.baseUrl ?? DEFAULT_GITHUB_API_BASE_URL,
    async getToken() {
      if (!options.token) {
        throw new GitHubAuthError("A non-empty GitHub token is required.");
      }

      return options.token;
    }
  };
}

export function githubUserAuth(options: TokenAuthOptions): GitHubAuthProvider {
  return {
    ...staticTokenAuth(options),
    kind: "github-user"
  };
}

export function actionsBridgeAuth(options: ActionsBridgeAuthOptions = {}): GitHubAuthProvider {
  const tokenEnv = options.tokenEnv ?? "GITHUB_TOKEN";
  const env = options.env ?? process.env;

  return {
    kind: "actions-bridge",
    baseUrl: options.baseUrl ?? DEFAULT_GITHUB_API_BASE_URL,
    async getToken() {
      const token = env[tokenEnv];
      if (!token) {
        throw new GitHubAuthError(`Missing ${tokenEnv}; Actions bridge mode needs a repo-local GitHub token.`);
      }

      return token;
    }
  };
}

export function githubAppAuth(options: GitHubAppAuthOptions): GitHubAuthProvider {
  const apiFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let cached: CachedInstallationToken | undefined;

  return {
    kind: "github-app-installation",
    baseUrl: options.baseUrl ?? DEFAULT_GITHUB_API_BASE_URL,
    async getToken(scope?: GitHubAuthScope) {
      const currentMs = now().getTime();
      if (cached && cached.expiresAtMs - 60_000 > currentMs) {
        return cached.token;
      }

      const jwt = createGitHubAppJwt({
        appId: options.appId,
        privateKey: options.privateKey,
        now
      });
      const init: RequestInit = {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28"
        }
      };
      if (scope?.permissions) {
        init.body = JSON.stringify({ permissions: scope.permissions });
      }

      const response = await apiFetch(
        `${this.baseUrl}/app/installations/${encodeURIComponent(String(options.installationId))}/access_tokens`,
        init
      );

      if (!response.ok) {
        throw new GitHubAuthError(
          `GitHub installation token exchange failed with ${response.status}: ${redactSensitive(await response.text())}`
        );
      }

      const payload = await response.json() as { token?: string; expires_at?: string };
      if (!payload.token || !payload.expires_at) {
        throw new GitHubAuthError("GitHub installation token exchange returned an invalid payload.");
      }

      cached = {
        token: payload.token,
        expiresAtMs: Date.parse(payload.expires_at)
      };

      return payload.token;
    }
  };
}

export interface CreateGitHubAppJwtOptions {
  readonly appId: string | number;
  readonly privateKey: string;
  readonly now?: () => Date;
}

export function createGitHubAppJwt(options: CreateGitHubAppJwtOptions): string {
  const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(options.appId)
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(options.privateKey);

  return `${signingInput}.${base64Url(signature)}`;
}

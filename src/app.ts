import type { AsyncGithubAppMetadata, DefineGithubAppOptions, GithubAppDefinition } from "./types.js";

export const asyncGithubApp: AsyncGithubAppMetadata = {
  slug: "async-github-app",
  installUrl: "https://github.com/apps/async-github-app/installations/new",
  callbackUrl: "https://async.dev/github/callback",
  webhookEvents: [
    "push",
    "create",
    "delete",
    "pull_request",
    "installation",
    "installation_repositories"
  ],
  permissions: {
    contents: "write",
    metadata: "read",
    pull_requests: "write"
  }
};

export function defineGithubApp(options: DefineGithubAppOptions = {}): GithubAppDefinition {
  const metadata: AsyncGithubAppMetadata = {
    ...asyncGithubApp,
    ...options.metadata,
    permissions: {
      ...asyncGithubApp.permissions,
      ...options.metadata?.permissions
    },
    webhookEvents: options.metadata?.webhookEvents ?? asyncGithubApp.webhookEvents
  };

  return {
    metadata,
    auth: options.auth,
    permissions: {
      ...metadata.permissions,
      ...options.permissions
    },
    endpoints: {
      install: metadata.installUrl,
      callback: metadata.callbackUrl,
      ...options.endpoints
    }
  };
}

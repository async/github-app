import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  actionsBridgeAuth,
  createGitHubAppJwt,
  githubAppAuth,
  staticTokenAuth
} from "../dist/index.js";

test("staticTokenAuth returns the configured token", async () => {
  const auth = staticTokenAuth({ token: "test-token" });
  assert.equal(await auth.getToken(), "test-token");
  assert.equal(auth.baseUrl, "https://api.github.com");
});

test("actionsBridgeAuth reads the configured environment token", async () => {
  const auth = actionsBridgeAuth({
    tokenEnv: "CUSTOM_GITHUB_TOKEN",
    env: { CUSTOM_GITHUB_TOKEN: "bridge-token" }
  });
  assert.equal(await auth.getToken(), "bridge-token");
});

test("githubAppAuth exchanges a generated JWT for an installation token and caches it", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  let calls = 0;
  const auth = githubAppAuth({
    appId: 123,
    installationId: 456,
    privateKey: pem,
    now: () => new Date("2026-06-17T00:00:00Z"),
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://api.github.com/app/installations/456/access_tokens");
      assert.match(init.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
      return new Response(JSON.stringify({
        token: "installation-token",
        expires_at: "2026-06-17T01:00:00Z"
      }), { status: 201 });
    }
  });

  assert.equal(await auth.getToken(), "installation-token");
  assert.equal(await auth.getToken(), "installation-token");
  assert.equal(calls, 1);
});

test("createGitHubAppJwt signs a three-part JWT", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = createGitHubAppJwt({
    appId: "app-id",
    privateKey: pem,
    now: () => new Date("2026-06-17T00:00:00Z")
  });

  assert.equal(jwt.split(".").length, 3);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeChangeFilePath,
  createGitHubClient,
  staticTokenAuth
} from "../dist/index.js";

test("path safety blocks traversal and workflow writes by default", () => {
  assert.throws(() => assertSafeChangeFilePath("../secret.json"), /absolute paths|cannot contain/u);
  assert.throws(() => assertSafeChangeFilePath(".github/workflows/build.yml"), /allowWorkflowPaths/u);
  assert.doesNotThrow(() => assertSafeChangeFilePath("content/settings.json", { allowedPathGlobs: ["content/**"] }));
});

test("ensureBranch creates a branch from the base ref when missing", async () => {
  await withMockFetch(async ({ calls }) => {
    const client = createGitHubClient(staticTokenAuth({ token: "token", baseUrl: "https://api.example.test" }));
    const receipt = await client.ensureBranch({
      repo: "async/github-app",
      from: "main",
      branch: "async/content"
    });

    assert.deepEqual(receipt, {
      repo: "async/github-app",
      branch: "async/content",
      sha: "base-sha",
      created: true
    });
    assert.equal(calls.map((call) => `${call.method} ${call.path}`).join("\n"), [
      "GET /repos/async/github-app/git/ref/heads/async%2Fcontent",
      "GET /repos/async/github-app/git/ref/heads/main",
      "POST /repos/async/github-app/git/refs"
    ].join("\n"));
  }, async (call) => {
    if (call.method === "GET" && call.path.endsWith("async%2Fcontent")) {
      return json({ message: "Not Found" }, 404);
    }

    if (call.method === "GET" && call.path.endsWith("/main")) {
      return json({ object: { sha: "base-sha" } });
    }

    return json({});
  });
});

test("commitChangeSet applies files serially and returns commit receipts", async () => {
  await withMockFetch(async () => {
    const client = createGitHubClient(staticTokenAuth({ token: "token", baseUrl: "https://api.example.test" }));
    const receipt = await client.commitChangeSet({
      repo: "async/github-app",
      branch: "async/content",
      baseBranch: "main",
      changeSetId: "cs_1",
      message: "Update content",
      files: [
        {
          path: "content/settings.json",
          action: "upsert",
          content: "{\"enabled\":true}\n"
        },
        {
          path: "content/old.json",
          action: "delete",
          previousSha: "old-sha"
        }
      ],
      metadata: {
        indexHints: ["content/settings.json"]
      }
    });

    assert.equal(receipt.commitSha, "delete-commit");
    assert.deepEqual(receipt.commitShas, ["put-commit", "delete-commit"]);
    assert.deepEqual(receipt.indexHints, ["content/settings.json"]);
    assert.equal(receipt.files.length, 2);
  }, async (call) => {
    if (call.method === "GET") {
      return json({ message: "Not Found" }, 404);
    }

    if (call.method === "PUT") {
      assert.equal(call.body.content, "eyJlbmFibGVkIjp0cnVlfQo=");
      return json({ content: { sha: "new-sha" }, commit: { sha: "put-commit" } });
    }

    if (call.method === "DELETE") {
      assert.equal(call.body.sha, "old-sha");
      return json({ commit: { sha: "delete-commit" } });
    }

    throw new Error(`Unexpected call ${call.method} ${call.path}`);
  });
});

test("openOrUpdatePullRequest updates an existing PR", async () => {
  await withMockFetch(async () => {
    const client = createGitHubClient(staticTokenAuth({ token: "token", baseUrl: "https://api.example.test" }));
    const receipt = await client.openOrUpdatePullRequest({
      repo: "async/github-app",
      head: "async/content",
      base: "main",
      title: "Update content",
      body: "Body"
    });

    assert.deepEqual(receipt, {
      number: 7,
      url: "https://github.com/async/github-app/pull/7",
      head: "async/content",
      base: "main",
      created: false
    });
  }, async (call) => {
    if (call.method === "GET") {
      return json([{ number: 7, html_url: "https://github.com/async/github-app/pull/7" }]);
    }

    if (call.method === "PATCH") {
      assert.equal(call.body.title, "Update content");
      return json({ number: 7, html_url: "https://github.com/async/github-app/pull/7" });
    }

    throw new Error(`Unexpected call ${call.method} ${call.path}`);
  });
});

async function withMockFetch(run, handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      method: init.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    return handler(call);
  };

  try {
    await run({ calls });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

import assert from "node:assert/strict";
import test from "node:test";

import { applyActionsBridge, renderActionsBridgeWorkflow } from "../dist/actions.js";
import { staticTokenAuth } from "../dist/index.js";

test("renderActionsBridgeWorkflow includes manual, schedule, permissions, and CLI pull step", () => {
  const workflow = renderActionsBridgeWorkflow({
    asyncEndpoint: "https://async.example/project",
    packageVersion: "0.1.0",
    branchPrefix: "async/bridge/",
    allowedPathGlobs: ["pipeline.ts", "docs/**"],
    pullRequest: false
  });

  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/u);
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /pnpm dlx @async\/github-app@0\.1\.0 actions pull --branch-prefix async\/bridge\/ --pull-request false --allowed-path pipeline\.ts --allowed-path docs\/\*\*/u);
  assert.match(workflow, /ASYNC_PROJECT_TOKEN/u);
});

test("applyActionsBridge enforces worker, branch, and path constraints", async () => {
  const auth = staticTokenAuth({ token: "token", baseUrl: "https://api.example.test" });

  await assert.rejects(() => applyActionsBridge({
    endpoint: "https://async.example/project",
    projectToken: "project-token",
    repository: "async/example",
    auth,
    fetch: async () => json({
      changeSets: [
        {
          id: "cs_bad_branch",
          repo: "async/example",
          baseBranch: "main",
          targetBranch: "feature/outside",
          mode: "pull_request",
          files: [{ path: "pipeline.ts", action: "upsert", content: "export default {};\n" }],
          metadata: { approved: true, allowedWorkers: ["actions"] }
        }
      ]
    }),
    branchPrefix: "async/bridge/",
    allowedPathGlobs: ["pipeline.ts"]
  }), /target branch must start/u);

  await assert.rejects(() => applyActionsBridge({
    endpoint: "https://async.example/project",
    projectToken: "project-token",
    repository: "async/example",
    auth,
    fetch: async () => json({
      changeSets: [
        {
          id: "cs_bad_path",
          repo: "async/example",
          baseBranch: "main",
          targetBranch: "async/bridge/cs_bad_path",
          mode: "pull_request",
          files: [{ path: "src/unsafe.ts", action: "upsert", content: "unsafe\n" }],
          metadata: { approved: true, allowedWorkers: ["actions"] }
        }
      ]
    }),
    branchPrefix: "async/bridge/",
    allowedPathGlobs: ["pipeline.ts"]
  }), /outside allowed globs/u);

  const skipped = await applyActionsBridge({
    endpoint: "https://async.example/project",
    projectToken: "project-token",
    repository: "async/example",
    auth,
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      if (init.method === "GET") {
        return json({
          changeSets: [
            {
              id: "cs_app_only",
              repo: "async/example",
              baseBranch: "main",
              targetBranch: "async/bridge/cs_app_only",
              mode: "pull_request",
              files: [{ path: "pipeline.ts", action: "upsert", content: "export default {};\n" }],
              metadata: { approved: true, allowedWorkers: ["app"] }
            }
          ]
        });
      }
      assert.equal(parsed.pathname, "/project/github/actions-bridge/receipts");
      return json({});
    },
    branchPrefix: "async/bridge/",
    allowedPathGlobs: ["pipeline.ts"]
  });

  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.receipts.length, 0);
});

test("applyActionsBridge posts lease-aware receipts", async () => {
  const originalFetch = globalThis.fetch;
  const githubCalls = [];
  let postedReceipt;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      method: init.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
      body: init.body ? JSON.parse(init.body) : undefined
    };
    githubCalls.push(call);
    if (call.method === "GET") {
      return json({ message: "Not Found" }, 404);
    }
    if (call.method === "PUT") {
      return json({ content: { sha: "content-sha" }, commit: { sha: "commit-sha" } });
    }
    throw new Error(`Unexpected GitHub call ${call.method} ${call.path}`);
  };

  try {
    const result = await applyActionsBridge({
      endpoint: "https://async.example/project",
      projectToken: "project-token",
      repository: "async/example",
      auth: staticTokenAuth({ token: "token", baseUrl: "https://api.example.test" }),
      fetch: async (url, init = {}) => {
        if (init.method === "GET") {
          return json({
            changeSets: [
              {
                id: "cs_lease",
                repo: "async/example",
                baseBranch: "main",
                targetBranch: "async/bridge/cs_lease",
                mode: "pull_request",
                files: [{ path: "pipeline.ts", action: "upsert", content: "export default {};\n" }],
                metadata: { approved: true, allowedWorkers: ["actions"] }
              }
            ],
            leases: [
              {
                changeSetId: "cs_lease",
                repo: "async/example",
                worker: "actions",
                leaseId: "lease_1",
                leaseExpiresAt: "2026-06-18T18:10:00Z"
              }
            ]
          });
        }
        postedReceipt = JSON.parse(init.body);
        return json({});
      },
      branchPrefix: "async/bridge/",
      allowedPathGlobs: ["pipeline.ts"],
      pullRequest: false
    });

    assert.equal(result.receipts[0].changeSetId, "cs_lease");
    assert.equal(result.receipts[0].leaseId, "lease_1");
    assert.equal(result.receipts[0].worker, "actions");
    assert.equal(result.receipts[0].status, "applied");
    assert.equal(postedReceipt.receipts[0].leaseId, "lease_1");
    assert.deepEqual(githubCalls.map((call) => call.method), ["GET", "PUT"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

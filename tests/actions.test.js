import assert from "node:assert/strict";
import test from "node:test";

import { renderActionsBridgeWorkflow } from "../dist/actions.js";

test("renderActionsBridgeWorkflow includes manual, schedule, permissions, and CLI pull step", () => {
  const workflow = renderActionsBridgeWorkflow({
    asyncEndpoint: "https://async.example/project",
    packageVersion: "0.1.0"
  });

  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/u);
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /pnpm dlx @async\/github-app@0\.1\.0 actions pull/u);
  assert.match(workflow, /ASYNC_PROJECT_TOKEN/u);
});

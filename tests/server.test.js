import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createGithubWebhookHandler,
  verifyWebhookSignature
} from "../dist/server.js";

test("verifyWebhookSignature accepts valid sha256 signatures", () => {
  const body = "{\"ok\":true}";
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyWebhookSignature({ secret: "secret", body, signature }), true);
  assert.equal(verifyWebhookSignature({ secret: "secret", body, signature: "sha256=bad" }), false);
});

test("createGithubWebhookHandler verifies before routing and deduplicates deliveries", async () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  let routed = 0;
  const handler = createGithubWebhookHandler({
    verify: { secret: "secret" },
    onEvent(event) {
      routed += 1;
      assert.equal(event.event, "push");
    }
  });

  const request = () => new Request("https://example.test/github/webhook", {
    method: "POST",
    headers: {
      "x-github-event": "push",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": signature
    },
    body
  });

  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.equal(routed, 1);
});

test("createGithubWebhookHandler rejects invalid signatures", async () => {
  const handler = createGithubWebhookHandler({
    verify: { secret: "secret" },
    onEvent() {
      throw new Error("should not route");
    }
  });
  const response = await handler(new Request("https://example.test/github/webhook", {
    method: "POST",
    headers: {
      "x-github-event": "push",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": "sha256=bad"
    },
    body: "{}"
  }));

  assert.equal(response.status, 401);
});

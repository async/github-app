import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface WebhookVerifyInput {
  readonly signature: string | null;
  readonly body: string;
  readonly event: string;
  readonly deliveryId: string;
}

export type WebhookVerifier = string | {
  readonly secret: string | (() => string | Promise<string>);
} | ((input: WebhookVerifyInput) => boolean | Promise<boolean>);

export interface GithubWebhookEvent {
  readonly event: string;
  readonly deliveryId: string;
  readonly payload: unknown;
  readonly rawBody: string;
  readonly headers: Headers;
}

export type GithubWebhookEventHandler = (event: GithubWebhookEvent) => void | Response | Promise<void | Response>;

export interface CreateGithubWebhookHandlerOptions {
  readonly verify: WebhookVerifier;
  readonly route?: Record<string, GithubWebhookEventHandler>;
  readonly onEvent?: GithubWebhookEventHandler;
  readonly maxBodyBytes?: number;
  readonly seenDeliveries?: Set<string>;
}

export function verifyWebhookSignature(options: {
  readonly secret: string;
  readonly body: string | Uint8Array;
  readonly signature: string | null | undefined;
}): boolean {
  const signature = options.signature;
  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", options.secret).update(options.body).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createGithubWebhookHandler(options: CreateGithubWebhookHandlerOptions): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const seenDeliveries = options.seenDeliveries ?? new Set<string>();

  return async function githubWebhookHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const event = request.headers.get("x-github-event") ?? "";
    const deliveryId = request.headers.get("x-github-delivery") ?? "";
    const signature = request.headers.get("x-hub-signature-256");
    const rawBody = await request.text();

    if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
      return json({ ok: false, error: "body_too_large" }, 413);
    }

    if (!event || !deliveryId) {
      return json({ ok: false, error: "missing_github_headers" }, 400);
    }

    const verified = await verifyRequest(options.verify, {
      signature,
      body: rawBody,
      event,
      deliveryId
    });
    if (!verified) {
      return json({ ok: false, error: "invalid_signature" }, 401);
    }

    if (seenDeliveries.has(deliveryId)) {
      return json({ ok: true, duplicate: true });
    }
    seenDeliveries.add(deliveryId);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const handler = options.route?.[event] ?? options.route?.["*"] ?? options.onEvent;
    if (!handler) {
      return json({ ok: true, ignored: true });
    }

    const response = await handler({
      event,
      deliveryId,
      payload,
      rawBody,
      headers: request.headers
    });

    return response ?? json({ ok: true });
  };
}

export function createNodeWebhookHandler(handler: (request: Request) => Promise<Response>) {
  return async function nodeWebhookHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const fetchRequest = new Request(`http://localhost${request.url ?? "/"}`, {
      method: request.method ?? "POST",
      headers,
      body: Buffer.concat(chunks)
    });
    const fetchResponse = await handler(fetchRequest);
    response.statusCode = fetchResponse.status;
    fetchResponse.headers.forEach((value, key) => response.setHeader(key, value));
    response.end(Buffer.from(await fetchResponse.arrayBuffer()));
  };
}

export function createDenoWebhookHandler(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return handler;
}

async function verifyRequest(verifier: WebhookVerifier, input: WebhookVerifyInput): Promise<boolean> {
  if (typeof verifier === "string") {
    return verifyWebhookSignature({ secret: verifier, body: input.body, signature: input.signature });
  }

  if (typeof verifier === "function") {
    return verifier(input);
  }

  const secret = typeof verifier.secret === "function" ? await verifier.secret() : verifier.secret;
  return verifyWebhookSignature({ secret, body: input.body, signature: input.signature });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

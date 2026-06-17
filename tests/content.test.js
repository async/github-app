import assert from "node:assert/strict";
import test from "node:test";

import {
  contentMapping,
  parseJsoncContent,
  parseMarkdownRecord,
  renderJsonContent,
  renderJsoncContent,
  renderMarkdownRecord
} from "../dist/content.js";

test("JSON content renders stable pretty JSON with trailing newline", () => {
  assert.equal(renderJsonContent({ enabled: true }), "{\n  \"enabled\": true\n}\n");
});

test("JSONC content is readable but not writable by default", () => {
  assert.deepEqual(parseJsoncContent("{\n// comment\n\"enabled\": true,\n}\n"), { enabled: true });
  assert.throws(() => renderJsoncContent({ enabled: true }), /JSONC writes are disabled/u);
});

test("Markdown records parse and render frontmatter plus body", () => {
  const record = parseMarkdownRecord("---\ntitle: \"Hello\"\npublished: true\n---\nBody\n");
  assert.deepEqual(record, {
    title: "Hello",
    published: true,
    body: "Body\n"
  });
  assert.equal(renderMarkdownRecord(record), "---\npublished: true\ntitle: \"Hello\"\n---\nBody\n");
});

test("contentMapping derives ids, paths, and serializers from pattern and format", () => {
  const posts = contentMapping({
    resource: "posts",
    pattern: "content/posts/{id}.json",
    format: "json"
  });

  assert.equal(posts.idFromPath("content/posts/hello.json"), "hello");
  assert.equal(posts.pathFromRecord({ id: "hello", title: "Hello" }), "content/posts/hello.json");
  assert.deepEqual(posts.parse("{\"id\":\"hello\"}"), { id: "hello" });
  assert.equal(posts.serialize({ id: "hello" }), "{\n  \"id\": \"hello\"\n}\n");
});

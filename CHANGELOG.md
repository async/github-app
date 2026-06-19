# Changelog

## 0.1.1 - 2026-06-18

- Add branch-prefix, allowed-path, and pull-request controls to the Actions bridge renderer and pull command so generated workflows can scope repo writes without changing backend APIs.
- Skip change sets whose metadata excludes the Actions worker, reject bridge pulls when the queued target branch is outside the configured prefix, and echo backend lease ids in bridge receipts.

## 0.1.0 - 2026-06-17

- Initial GitHub integration package for Async.
- Adds GitHub App, token, and Actions bridge auth providers.
- Adds branch, file commit, pull request, tree snapshot, compare, webhook, receipt, and content mapping helpers.
- Adds JSON, JSONC read-only by default, Markdown, and MDX content serializers.

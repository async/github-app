#!/usr/bin/env node
import { applyActionsBridge, renderActionsBridgeWorkflow } from "./actions.js";
import { redactSensitive } from "./util.js";

async function main(argv: readonly string[]): Promise<void> {
  const [scope, command, ...rest] = argv;

  if (scope !== "actions") {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "render-workflow") {
    const endpoint = readFlag(rest, "--endpoint");
    const branchPrefix = readFlag(rest, "--branch-prefix");
    const pullRequest = parseOptionalBooleanFlag(rest, "--pull-request");
    const allowedPathGlobs = readFlags(rest, "--allowed-path");
    process.stdout.write(renderActionsBridgeWorkflow({
      ...(endpoint ? { asyncEndpoint: endpoint } : {}),
      ...(branchPrefix ? { branchPrefix } : {}),
      ...(pullRequest !== undefined ? { pullRequest } : {}),
      ...(allowedPathGlobs.length > 0 ? { allowedPathGlobs } : {})
    }));
    return;
  }

  if (command === "pull") {
    const endpoint = readFlag(rest, "--endpoint") ?? process.env.ASYNC_PROJECT_URL;
    const projectToken = process.env.ASYNC_PROJECT_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    const branchPrefix = readFlag(rest, "--branch-prefix");
    const pullRequest = parseOptionalBooleanFlag(rest, "--pull-request");
    const allowedPathGlobs = readFlags(rest, "--allowed-path");

    if (!endpoint || !projectToken || !repository) {
      throw new Error("actions pull requires ASYNC_PROJECT_URL, ASYNC_PROJECT_TOKEN, and GITHUB_REPOSITORY.");
    }

    const result = await applyActionsBridge({
      endpoint,
      projectToken,
      repository,
      ...(branchPrefix ? { branchPrefix } : {}),
      ...(pullRequest !== undefined ? { pullRequest } : {}),
      ...(allowedPathGlobs.length > 0 ? { allowedPathGlobs } : {})
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  usage();
  process.exitCode = 1;
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readFlags(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === name && value) {
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function parseOptionalBooleanFlag(args: readonly string[], name: string): boolean | undefined {
  const value = readFlag(args, name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function usage(): void {
  process.stderr.write(`Usage:
  async-github-app actions render-workflow [--endpoint <url>] [--branch-prefix <prefix>] [--allowed-path <glob>...] [--pull-request true|false]
  async-github-app actions pull [--endpoint <url>] [--branch-prefix <prefix>] [--allowed-path <glob>...] [--pull-request true|false]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${redactSensitive(error instanceof Error ? error.message : error)}\n`);
  process.exitCode = 1;
});

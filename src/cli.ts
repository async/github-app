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
    process.stdout.write(renderActionsBridgeWorkflow(endpoint ? { asyncEndpoint: endpoint } : {}));
    return;
  }

  if (command === "pull") {
    const endpoint = readFlag(rest, "--endpoint") ?? process.env.ASYNC_PROJECT_URL;
    const projectToken = process.env.ASYNC_PROJECT_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;

    if (!endpoint || !projectToken || !repository) {
      throw new Error("actions pull requires ASYNC_PROJECT_URL, ASYNC_PROJECT_TOKEN, and GITHUB_REPOSITORY.");
    }

    const result = await applyActionsBridge({
      endpoint,
      projectToken,
      repository
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

function usage(): void {
  process.stderr.write(`Usage:
  async-github-app actions render-workflow [--endpoint <url>]
  async-github-app actions pull [--endpoint <url>]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${redactSensitive(error instanceof Error ? error.message : error)}\n`);
  process.exitCode = 1;
});

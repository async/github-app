import type { ChangeFile, PathSafetyOptions } from "./types.js";

export class UnsafeChangePathError extends Error {
  constructor(path: string, reason: string) {
    super(`Unsafe GitHub change path "${path}": ${reason}`);
    this.name = "UnsafeChangePathError";
  }
}

export function assertSafeChangeFilePath(path: string, options: PathSafetyOptions = {}): void {
  if (!path || path.trim() !== path) {
    throw new UnsafeChangePathError(path, "paths must be non-empty and cannot include leading or trailing whitespace");
  }

  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) {
    throw new UnsafeChangePathError(path, "absolute paths are not allowed");
  }

  const parts = path.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    throw new UnsafeChangePathError(path, "paths cannot contain empty segments or ..");
  }

  if (!options.allowWorkflowPaths && path.startsWith(".github/workflows/")) {
    throw new UnsafeChangePathError(path, ".github/workflows writes require allowWorkflowPaths");
  }

  if (options.allowedPathGlobs?.length && !options.allowedPathGlobs.some((glob) => matchesSimpleGlob(path, glob))) {
    throw new UnsafeChangePathError(path, `path is outside allowed globs: ${options.allowedPathGlobs.join(", ")}`);
  }
}

export function validateChangeFiles(files: readonly ChangeFile[], options: PathSafetyOptions = {}): void {
  if (!files.length) {
    throw new UnsafeChangePathError("(empty)", "change sets must contain at least one file");
  }

  const seen = new Set<string>();
  for (const file of files) {
    assertSafeChangeFilePath(file.path, options);
    if (seen.has(file.path)) {
      throw new UnsafeChangePathError(file.path, "a change set cannot include the same path more than once");
    }

    seen.add(file.path);
    if (file.action === "upsert" && file.content === undefined) {
      throw new UnsafeChangePathError(file.path, "upsert files require content");
    }
  }
}

function matchesSimpleGlob(path: string, glob: string): boolean {
  if (glob.endsWith("/**")) {
    return path.startsWith(glob.slice(0, -2));
  }

  if (glob.endsWith("/*")) {
    const prefix = glob.slice(0, -1);
    const rest = path.slice(prefix.length);
    return path.startsWith(prefix) && rest.length > 0 && !rest.includes("/");
  }

  if (glob.includes("*")) {
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
      .replaceAll("\\*", "[^/]*");
    return new RegExp(`^${escaped}$`, "u").test(path);
  }

  return path === glob || path.startsWith(`${glob}/`);
}

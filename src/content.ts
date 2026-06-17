import { ensureTrailingNewline, hasOwn } from "./util.js";

export type ContentFormat = "json" | "jsonc" | "markdown" | "mdx";

export interface JsonRenderOptions {
  readonly indent?: number;
}

export interface JsoncRenderOptions extends JsonRenderOptions {
  readonly allowWrite?: boolean;
}

export interface MarkdownOptions {
  readonly bodyField?: string;
}

export interface ContentMappingOptions {
  readonly resource: string;
  readonly pattern: string;
  readonly format: ContentFormat;
  readonly idFromPath?: (path: string) => string;
  readonly pathFromRecord?: (record: Record<string, unknown>) => string;
  readonly bodyField?: string;
}

export interface ContentMapping {
  readonly resource: string;
  readonly pattern: string;
  readonly format: ContentFormat;
  readonly bodyField: string;
  idFromPath(path: string): string;
  pathFromRecord(record: Record<string, unknown>): string;
  parse(source: string): unknown;
  serialize(record: unknown): string;
}

export class JsoncWriteError extends Error {
  constructor() {
    super("JSONC writes are disabled by default because comments and formatting cannot be preserved safely. Pass allowWrite: true to render canonical JSON content intentionally.");
    this.name = "JsoncWriteError";
  }
}

export function parseJsonContent<T = unknown>(source: string): T {
  return JSON.parse(source) as T;
}

export function renderJsonContent(value: unknown, options: JsonRenderOptions = {}): string {
  return ensureTrailingNewline(JSON.stringify(value, null, options.indent ?? 2));
}

export function parseJsoncContent<T = unknown>(source: string): T {
  return JSON.parse(stripJsonc(source)) as T;
}

export function renderJsoncContent(value: unknown, options: JsoncRenderOptions = {}): string {
  if (!options.allowWrite) {
    throw new JsoncWriteError();
  }

  return renderJsonContent(value, options);
}

export function parseMarkdownRecord(source: string, options: MarkdownOptions = {}): Record<string, unknown> {
  const bodyField = options.bodyField ?? "body";
  const { data, body } = splitFrontmatter(source);
  return {
    ...data,
    [bodyField]: body
  };
}

export function renderMarkdownRecord(record: Record<string, unknown>, options: MarkdownOptions = {}): string {
  const bodyField = options.bodyField ?? "body";
  const body = typeof record[bodyField] === "string" ? record[bodyField] : "";
  const frontmatter = Object.keys(record)
    .filter((key) => key !== bodyField && record[key] !== undefined)
    .sort()
    .map((key) => `${key}: ${renderFrontmatterScalar(record[key])}`)
    .join("\n");

  if (!frontmatter) {
    return ensureTrailingNewline(body);
  }

  return ensureTrailingNewline(`---\n${frontmatter}\n---\n${body}`);
}

export const parseMdxRecord = parseMarkdownRecord;
export const renderMdxRecord = renderMarkdownRecord;

export function contentMapping(options: ContentMappingOptions): ContentMapping {
  const bodyField = options.bodyField ?? "body";
  const compiled = compilePattern(options.pattern);

  return {
    resource: options.resource,
    pattern: options.pattern,
    format: options.format,
    bodyField,
    idFromPath: options.idFromPath ?? ((path) => {
      const match = compiled.match(path);
      if (!match) {
        throw new Error(`Path "${path}" does not match content mapping pattern "${options.pattern}".`);
      }

      return match.id ?? Object.values(match)[0] ?? path;
    }),
    pathFromRecord: options.pathFromRecord ?? ((record) => compiled.fill(record)),
    parse(source: string) {
      if (options.format === "json") {
        return parseJsonContent(source);
      }

      if (options.format === "jsonc") {
        return parseJsoncContent(source);
      }

      return parseMarkdownRecord(source, { bodyField });
    },
    serialize(record: unknown) {
      if (options.format === "json") {
        return renderJsonContent(record);
      }

      if (options.format === "jsonc") {
        return renderJsoncContent(record);
      }

      if (!isRecord(record)) {
        throw new Error(`${options.format.toUpperCase()} content mappings require object records.`);
      }

      return renderMarkdownRecord(record, { bodyField });
    }
  };
}

export function stripJsonc(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      }
      continue;
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (current === "\n") {
        output += "\n";
      }
      continue;
    }

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  return removeTrailingCommas(output);
}

function removeTrailingCommas(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }

    if (current === ",") {
      const rest = source.slice(index + 1);
      if (/^\s*[}\]]/u.test(rest)) {
        continue;
      }
    }

    output += current;
  }

  return output;
}

function splitFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  if (!source.startsWith("---\n")) {
    return { data: {}, body: source };
  }

  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, body: source };
  }

  const rawFrontmatter = source.slice(4, end);
  const bodyStart = source[end + 4] === "\n" ? end + 5 : end + 4;
  return {
    data: parseFrontmatter(rawFrontmatter),
    body: source.slice(bodyStart)
  };
}

function parseFrontmatter(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      data[key] = parseFrontmatterScalar(value);
    }
  }

  return data;
}

function parseFrontmatterScalar(value: string): unknown {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    value.startsWith("[") ||
    value.startsWith("{")
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function renderFrontmatterScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function compilePattern(pattern: string): {
  match(path: string): Record<string, string> | undefined;
  fill(record: Record<string, unknown>): string;
} {
  const placeholders = [...pattern.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu)].map((match) => match[1]!);
  const regexSource = pattern
    .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\\\{([A-Za-z_][A-Za-z0-9_]*)\\\}/gu, "(?<$1>[^/]+)");
  const regex = new RegExp(`^${regexSource}$`, "u");

  return {
    match(path: string) {
      const matched = regex.exec(path);
      return matched?.groups;
    },
    fill(record: Record<string, unknown>) {
      let path = pattern;
      for (const placeholder of placeholders) {
        if (!hasOwn(record, placeholder) || record[placeholder] === undefined) {
          throw new Error(`Record is missing "${placeholder}" required by content mapping pattern "${pattern}".`);
        }

        path = path.replaceAll(`{${placeholder}}`, encodeURIComponent(String(record[placeholder])));
      }

      return path;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

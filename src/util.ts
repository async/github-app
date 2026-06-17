export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com" as const;

export function base64Url(input: string | Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function utf8ToBase64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

export function redactSensitive(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._~+/=-]+/giu, "$1$2[REDACTED]")
    .replace(/(cookie\s*[:=]\s*)[^;\n]+/giu, "$1[REDACTED]")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]")
    .replace(/(webhook[_-]?secret\s*[:=]\s*)[A-Za-z0-9._~+/=-]+/giu, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[A-Za-z0-9._~+/=-]{12,}/giu, "$1[REDACTED]");
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

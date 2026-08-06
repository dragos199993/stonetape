/**
 * Redaction — "built-in redaction and safety checks", never "auto-redacted"
 * as an absolute promise (see review notes).
 *
 * v0.1: header denylist + well-known token shapes in bodies.
 * Roadmap: entropy-based detection, pre-commit scan command, custom rules.
 */

const SENSITIVE_HEADERS = [
  "authorization",
  "x-api-key",
  "api-key",
  "openai-organization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
];

/** Well-known credential shapes. Conservative on purpose. */
const TOKEN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style secret keys
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
];

export const REDACTED = "[REDACTED]";

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    out[key.toLowerCase()] = SENSITIVE_HEADERS.includes(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

export function redactText(text: string): string {
  let out = text;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redactBody(body: unknown): unknown {
  if (typeof body === "string") return redactText(body);
  if (body !== null && typeof body === "object") {
    return JSON.parse(redactText(JSON.stringify(body)));
  }
  return body;
}

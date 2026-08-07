/**
 * Request fingerprinting + matching.
 *
 * Decisions (from review, do not regress):
 * - `strict` and `smart` only. Semantic matching is deliberately absent:
 *   a false-positive match silently breaks the determinism promise.
 * - Every mismatch must be explainable: we keep enough information to
 *   tell the user exactly WHAT differed, not just that nothing matched.
 */
import { createHash } from "node:crypto";

export type MatchMode = "strict" | "smart";

export interface MatchOptions {
  mode: MatchMode;
  /**
   * Dot-paths into the request body to ignore in `smart` mode.
   * Supports `[*]` for "every array element", e.g. `messages[*].content.timestamp`.
   */
  ignore?: string[];
  /**
   * Match on path + query only, ignoring scheme/host/port. Essential for
   * proxy-mode cassettes, where the upstream origin is infrastructure that
   * legitimately differs between record and replay environments.
   */
  ignoreOrigin?: boolean;
}

/** Normalize a request into the object that gets fingerprinted. */
export function normalizeRequest(
  method: string,
  url: string,
  body: unknown,
  opts: MatchOptions,
): { method: string; url: string; body: unknown } {
  const u = new URL(url);
  // Volatile-by-construction: never part of identity.
  u.searchParams.delete("request_id");
  const normUrl = opts.ignoreOrigin ? `${u.pathname}${u.search}` : u.toString();
  let normBody = body;
  if (opts.mode === "smart" && opts.ignore?.length && typeof body === "object" && body !== null) {
    normBody = applyIgnores(structuredClone(body), opts.ignore);
  }
  return { method: method.toUpperCase(), url: normUrl, body: normBody };
}

export function fingerprint(
  method: string,
  url: string,
  body: unknown,
  opts: MatchOptions,
): string {
  const norm = normalizeRequest(method, url, body, opts);
  return createHash("sha256").update(stableStringify(norm)).digest("hex");
}

/** Delete every path in `paths` from `obj` (mutates and returns it). */
export function applyIgnores(obj: unknown, paths: string[]): unknown {
  for (const path of paths) deletePath(obj, path.split("."));
  return obj;
}

function deletePath(node: unknown, segments: string[]): void {
  if (node === null || typeof node !== "object" || segments.length === 0) return;
  const [head, ...rest] = segments as [string, ...string[]];

  const arrayMatch = head.match(/^(.*)\[\*\]$/);
  if (arrayMatch) {
    const key = arrayMatch[1];
    const target = key ? (node as Record<string, unknown>)[key] : node;
    if (Array.isArray(target)) {
      for (const el of target) {
        if (rest.length === 0) continue; // `field[*]` with no tail: nothing to delete per-element
        deletePath(el, rest);
      }
    }
    return;
  }

  if (rest.length === 0) {
    if (typeof node === "object" && node !== null) delete (node as Record<string, unknown>)[head];
    return;
  }
  deletePath((node as Record<string, unknown>)[head], rest);
}

/** JSON.stringify with sorted keys — stable across runs and platforms. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Mismatch explanation
// ---------------------------------------------------------------------------

export interface Difference {
  path: string;
  recorded: unknown;
  incoming: unknown;
}

/**
 * Deep-diff two normalized request bodies. Returns the first `limit`
 * differences with their paths — the raw material for a useful error.
 */
export function explainDiff(recorded: unknown, incoming: unknown, limit = 5): Difference[] {
  const out: Difference[] = [];
  walk(recorded, incoming, "", out, limit);
  return out;
}

function walk(a: unknown, b: unknown, path: string, out: Difference[], limit: number): void {
  if (out.length >= limit) return;
  if (a === b) return;
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    Array.isArray(a) === Array.isArray(b)
  ) {
    const keys = new Set([
      ...Object.keys(a as Record<string, unknown>),
      ...Object.keys(b as Record<string, unknown>),
    ]);
    for (const key of keys) {
      walk(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
        limit,
      );
      if (out.length >= limit) return;
    }
    return;
  }
  out.push({ path: path || "(root)", recorded: a, incoming: b });
}

export function formatDifferences(diffs: Difference[]): string {
  if (diffs.length === 0) return "  (bodies are equal after normalization — check method/url)";
  return diffs
    .map((d) => {
      const [rec, inc] = focusedPreviews(d.recorded, d.incoming);
      return `  at ${d.path}:\n    recorded: ${rec}\n    incoming: ${inc}`;
    })
    .join("\n");
}

/**
 * For a pair of long strings, window both previews around the FIRST differing
 * character — otherwise two 5KB system prompts that differ at char 3801 look
 * identical at preview length. (e2e-dogfood finding #6)
 */
function focusedPreviews(a: unknown, b: unknown): [string, string] {
  if (typeof a === "string" && typeof b === "string" && (a.length > 120 || b.length > 120)) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const from = Math.max(0, i - 40);
    const windowOf = (s: string) => {
      const prefix = from > 0 ? `…[${from} same chars]…` : "";
      const chunk = s.slice(from, from + 120);
      return `${prefix}${chunk}${s.length > from + 120 ? "…" : ""}`;
    };
    return [windowOf(a), windowOf(b)];
  }
  return [preview(a), preview(b)];
}

function preview(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "(missing)";
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

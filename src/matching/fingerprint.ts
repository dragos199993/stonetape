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
  let normBody = body;
  if (opts.mode === "smart" && opts.ignore?.length && typeof body === "object" && body !== null) {
    normBody = applyIgnores(structuredClone(body), opts.ignore);
  }
  return { method: method.toUpperCase(), url: u.toString(), body: normBody };
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
    .map(
      (d) =>
        `  at ${d.path}:\n    recorded: ${preview(d.recorded)}\n    incoming: ${preview(d.incoming)}`,
    )
    .join("\n");
}

function preview(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "(missing)";
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

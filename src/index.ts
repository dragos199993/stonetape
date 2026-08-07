/**
 * stonetape — Turn real agent runs into fast, hermetic regression tests.
 * https://stonetape.dev
 */
import { loadCassette, loadOrCreate, saveCassette } from "./store/fs.js";
import { emptyCassette } from "./schema/cassette.js";
import {
  type Mode,
  type OrderMode,
  type OrderPolicy,
  type TapeSession,
  StonetapeReplayError,
  createFetch,
} from "./transport/fetch.js";
import type { MatchOptions } from "./matching/fingerprint.js";
import { err, recDot } from "./ui/style.js";

export { StonetapeReplayError } from "./transport/fetch.js";
export type { Mode, OrderMode, OrderPolicy } from "./transport/fetch.js";
export type { MatchOptions, MatchMode } from "./matching/fingerprint.js";
export type { Cassette, Interaction } from "./schema/cassette.js";
export { SCHEMA_VERSION } from "./schema/cassette.js";

const VERSION = "0.1.0-alpha.3";

export interface TapeOptions {
  /** record | replay | live. Default: STONETAPE_MODE env, else "replay". */
  mode?: Mode;
  /** Matching behavior. Default: smart with no ignores (== strict in practice). */
  match?: Partial<MatchOptions>;
  /**
   * Chain-order policy. `strict` (default): calls must replay in recorded
   * order — catches agent-chain regressions (skipped/duplicated/reordered
   * steps). Use `any` for tests firing independent parallel LLM calls, or
   * the mixed form for apps with fire-and-forget side calls:
   *
   *   order: { mode: "strict", concurrent: ["/v1/feedback", "/telemetry"] }
   *
   * Declared-concurrent endpoints match by fingerprint anywhere; everything
   * else keeps strict chain ordering.
   */
  order?: OrderMode | { mode: OrderMode; concurrent?: string[] };
  /** Underlying fetch used in record/live modes. Default: globalThis.fetch. */
  fetch?: typeof fetch;
}

export interface Tape {
  /** Pass this to your SDK client: `new OpenAI({ fetch: tape.fetch })`. */
  fetch: typeof fetch;
  mode: Mode;
  /**
   * Patch `globalThis.fetch` with the tape's fetch — for apps that use bare
   * global fetch and offer no injection point. Returns an uninstall function;
   * `close()` also restores automatically.
   */
  install(): () => void;
  /**
   * Mismatches raised during replay — preserved even when the application
   * swallows the error (fallback/retry layers). Check this in teardown;
   * the vitest helper does it automatically.
   */
  readonly mismatches: readonly StonetapeReplayError[];
  /** Persist new recordings (no-op in replay/live). Always call when done. */
  close(): void;
}

/** Open a cassette. The tape records on first run, replays after. */
export function openCassette(path: string, options: TapeOptions = {}): Tape {
  const mode = options.mode ?? modeFromEnv();
  const rawOrder = options.order ?? "strict";
  const order: OrderPolicy =
    typeof rawOrder === "string"
      ? { mode: rawOrder, concurrent: [] }
      : { mode: rawOrder.mode, concurrent: rawOrder.concurrent ?? [] };
  const session: TapeSession = {
    path,
    // Record mode starts FRESH: appending across separate record runs mixes
    // stale interactions (e.g. a failed attempt) into the chain. Re-record
    // means re-record.
    cassette: mode === "record" ? emptyCassette(VERSION) : loadOrCreate(path, VERSION),
    mode,
    match: {
      mode: options.match?.mode ?? "smart",
      ignore: options.match?.ignore ?? [],
      ignoreOrigin: options.match?.ignoreOrigin ?? false,
    },
    order,
    consumed: new Set(),
    mismatches: [],
    dirty: false,
  };
  const boundFetch = createFetch(session, options.fetch ?? fetch);
  let restoreGlobal: (() => void) | undefined;
  return {
    fetch: boundFetch,
    mode,
    install() {
      const previous = globalThis.fetch;
      globalThis.fetch = boundFetch;
      restoreGlobal = () => {
        globalThis.fetch = previous;
        restoreGlobal = undefined;
      };
      return restoreGlobal;
    },
    get mismatches() {
      return session.mismatches as readonly StonetapeReplayError[];
    },
    close() {
      restoreGlobal?.();
      if (session.mode === "record" && session.dirty) {
        saveCassette(path, session.cassette);
        if (process.env.STONETAPE_QUIET === undefined) {
          const n = session.cassette.interactions.length;
          process.stderr.write(
            `${recDot(err)} REC  ${path} ${err.dim(`\u00b7 ${n} call${n === 1 ? "" : "s"} written`)}\n`,
          );
        }
      }
    },
  };
}

export function modeFromEnv(): Mode {
  const raw = process.env.STONETAPE_MODE?.toLowerCase();
  if (raw === "record" || raw === "live") return raw;
  return "replay";
}

/**
 * Find a StonetapeReplayError anywhere in an error's `cause` chain.
 *
 * Real SDKs (openai, anthropic) catch fetch exceptions, retry them, and wrap
 * them in their own connection-error types — so `instanceof` on the surface
 * error is not enough. Use this in tests:
 *
 *   const err = await run().catch((e) => e);
 *   expect(unwrapMismatch(err)?.message).toContain("Expected call: 2 of 2");
 *
 * Tip: construct SDK clients with `maxRetries: 0` in replay — retrying a
 * deterministic mismatch only wastes time.
 */
export function unwrapMismatch(err: unknown): StonetapeReplayError | undefined {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof StonetapeReplayError) return current;
    current = current.cause;
  }
  return undefined;
}

/** True if the error (or anything in its cause chain) is a cassette mismatch. */
export function isCassetteMismatch(err: unknown): boolean {
  return unwrapMismatch(err) !== undefined;
}

export { startProxy } from "./proxy/server.js";
export type { ProxyOptions, ProxyHandle } from "./proxy/server.js";

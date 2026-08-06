/**
 * stonetape — Turn real agent runs into fast, hermetic regression tests.
 * https://stonetape.dev
 */
import { loadOrCreate, saveCassette } from "./store/fs.js";
import { type Mode, type TapeSession, createFetch } from "./transport/fetch.js";
import type { MatchOptions } from "./matching/fingerprint.js";

export { StonetapeReplayError } from "./transport/fetch.js";
export type { Mode } from "./transport/fetch.js";
export type { MatchOptions, MatchMode } from "./matching/fingerprint.js";
export type { Cassette, Interaction } from "./schema/cassette.js";
export { SCHEMA_VERSION } from "./schema/cassette.js";

const VERSION = "0.1.0-dev.0";

export interface TapeOptions {
  /** record | replay | live. Default: STONETAPE_MODE env, else "replay". */
  mode?: Mode;
  /** Matching behavior. Default: smart with no ignores (== strict in practice). */
  match?: Partial<MatchOptions>;
  /** Underlying fetch used in record/live modes. Default: globalThis.fetch. */
  fetch?: typeof fetch;
}

export interface Tape {
  /** Pass this to your SDK client: `new OpenAI({ fetch: tape.fetch })`. */
  fetch: typeof fetch;
  mode: Mode;
  /** Persist new recordings (no-op in replay/live). Always call when done. */
  close(): void;
}

/** Open a cassette. The tape records on first run, replays after. */
export function openCassette(path: string, options: TapeOptions = {}): Tape {
  const mode = options.mode ?? modeFromEnv();
  const session: TapeSession = {
    cassette: loadOrCreate(path, VERSION),
    mode,
    match: { mode: options.match?.mode ?? "smart", ignore: options.match?.ignore ?? [] },
    consumed: new Set(),
    dirty: false,
  };
  const boundFetch = createFetch(session, options.fetch ?? fetch);
  return {
    fetch: boundFetch,
    mode,
    close() {
      if (session.mode === "record" && session.dirty) saveCassette(path, session.cassette);
    },
  };
}

export function modeFromEnv(): Mode {
  const raw = process.env.STONETAPE_MODE?.toLowerCase();
  if (raw === "record" || raw === "live") return raw;
  return "replay";
}

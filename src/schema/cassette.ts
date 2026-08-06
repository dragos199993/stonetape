/**
 * Stonetape cassette schema — the canonical event model.
 *
 * Design principles (decided in review, do not regress):
 * 1. Cassettes carry BOTH the raw provider payload (fidelity, debugging)
 *    and a normalized canonical representation (diffs, portability).
 * 2. The envelope is versioned independently of the recorder, with room
 *    for schema migrations. This file is the source of truth for the
 *    future language-independent spec.
 * 3. The event model must express whole agent sessions (LLM → tool call →
 *    LLM → …), not just single HTTP exchanges — even while v0.1 records
 *    only HTTP interactions.
 */

export const SCHEMA_VERSION = 1;

/** A single recorded HTTP exchange with an LLM provider. */
export interface Interaction {
  /** Stable id within the cassette (order of recording). */
  seq: number;
  request: RecordedRequest;
  response: RecordedResponse;
  /** Canonical, provider-normalized view — used for diffs and matching. */
  canonical?: CanonicalExchange;
  meta: InteractionMeta;
}

export interface RecordedRequest {
  method: string;
  url: string;
  /** Headers after redaction. Never contains Authorization/api-key values. */
  headers: Record<string, string>;
  /** Parsed JSON body when parseable, else raw string. */
  body: unknown;
  /** SHA-256 of the normalized request (after ignore-paths). Match key. */
  fingerprint: string;
}

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  /** For non-streaming responses: parsed JSON body when parseable, else raw string. */
  body?: unknown;
  /** For streaming responses: the exact chunks, in order. */
  stream?: StreamChunk[];
}

export interface StreamChunk {
  /** Position in the stream. */
  i: number;
  /** UTF-8 chunk payload (SSE lines land here verbatim). */
  data: string;
}

/**
 * Canonical exchange — provider-agnostic summary of what happened.
 * v0.1 fills `kind` and `model` when it can; richer normalization
 * (messages, tool calls) lands with the semantic adapters.
 */
export interface CanonicalExchange {
  kind: "chat" | "completion" | "embedding" | "tool_result" | "unknown";
  provider?: string;
  model?: string;
  /** Tool calls the model requested, if any (normalized). */
  toolCalls?: Array<{ name: string; arguments: unknown }>;
}

export interface InteractionMeta {
  recordedAt: string; // ISO timestamp — freshness policies build on this
  durationMs?: number;
}

export interface Cassette {
  schemaVersion: number;
  recorder: { name: "stonetape"; version: string };
  /** Cassette-level metadata for drift/freshness tooling. */
  meta: {
    createdAt: string;
    updatedAt: string;
  };
  interactions: Interaction[];
}

export function emptyCassette(recorderVersion: string): Cassette {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    recorder: { name: "stonetape", version: recorderVersion },
    meta: { createdAt: now, updatedAt: now },
    interactions: [],
  };
}

/** Guards against replaying cassettes from a future/incompatible schema. */
export function assertCompatible(c: Cassette): void {
  if (c.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Cassette schema v${c.schemaVersion} is newer than this stonetape build (v${SCHEMA_VERSION}). ` +
        `Upgrade stonetape, or re-record with this version.`,
    );
  }
}

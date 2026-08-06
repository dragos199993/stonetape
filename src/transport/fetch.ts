/**
 * The transport adapter: a recording/replaying `fetch`.
 *
 * This is the lowest layer — semantic adapters (Vercel AI SDK middleware,
 * agent frameworks) sit on top of it. Both OpenAI and Anthropic SDKs accept
 * a custom fetch, so v0.1 needs no monkeypatching anywhere.
 *
 * Fail-closed contract (do not regress):
 *   In replay mode, any request with no matching recorded interaction THROWS.
 *   No unrecorded network call ever escapes a replay run.
 */
import {
  type MatchOptions,
  explainDiff,
  fingerprint,
  formatDifferences,
  normalizeRequest,
} from "../matching/fingerprint.js";
import { redactBody, redactHeaders } from "../redact.js";
import {
  type CanonicalExchange,
  type Cassette,
  type Interaction,
  type StreamChunk,
} from "../schema/cassette.js";

export type Mode = "record" | "replay" | "live";

export interface TapeSession {
  cassette: Cassette;
  mode: Mode;
  match: MatchOptions;
  /** seqs already consumed in this replay run — enforces per-run isolation. */
  consumed: Set<number>;
  /** Called after a recording run to persist new interactions. */
  dirty: boolean;
}

export class StonetapeReplayError extends Error {}

/** Build a `fetch` bound to a session. Pass it to your SDK client. */
export function createFetch(session: TapeSession, realFetch: typeof fetch = fetch): typeof fetch {
  return async function stonetapeFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = request.url;
    const method = request.method;
    const bodyText = request.body ? await request.clone().text() : "";
    const body = tryJson(bodyText);

    if (session.mode === "live") return realFetch(input, init);

    if (session.mode === "replay") {
      return replay(session, method, url, body);
    }

    // --- record mode ---
    const started = Date.now();
    const response = await realFetch(input, init);
    const recorded = await captureResponse(response.clone());
    const interaction: Interaction = {
      seq: session.cassette.interactions.length,
      request: {
        method,
        url,
        headers: redactHeaders(request.headers),
        body: redactBody(body),
        fingerprint: fingerprint(method, url, body, session.match),
      },
      response: recorded,
      canonical: canonicalize(url, body),
      meta: { recordedAt: new Date().toISOString(), durationMs: Date.now() - started },
    };
    session.cassette.interactions.push(interaction);
    session.dirty = true;
    return response;
  };
}

function replay(session: TapeSession, method: string, url: string, body: unknown): Response {
  const fp = fingerprint(method, url, body, session.match);
  // Session ordering: first unconsumed interaction with this fingerprint.
  const hit = session.cassette.interactions.find(
    (i) => !session.consumed.has(i.seq) && i.request.fingerprint === fp,
  );
  if (hit) {
    session.consumed.add(hit.seq);
    return materialize(hit);
  }
  throw new StonetapeReplayError(buildMismatchMessage(session, method, url, body));
}

/** The error message IS the product: explain, don't just fail. */
function buildMismatchMessage(
  session: TapeSession,
  method: string,
  url: string,
  body: unknown,
): string {
  const header = `stonetape: no recorded interaction matches this request (fail-closed replay).\n  ${method} ${url}\n`;
  // Nearest miss: same normalized method+url, different body.
  const norm = normalizeRequest(method, url, body, session.match);
  const candidate = session.cassette.interactions.find((i) => {
    const c = normalizeRequest(i.request.method, i.request.url, i.request.body, session.match);
    return c.method === norm.method && c.url === norm.url && !session.consumed.has(i.seq);
  });
  if (candidate) {
    const diffs = explainDiff(
      normalizeRequest(
        candidate.request.method,
        candidate.request.url,
        candidate.request.body,
        session.match,
      ).body,
      norm.body,
    );
    return (
      header +
      `Closest recorded request (seq ${candidate.seq}) differs:\n` +
      formatDifferences(diffs) +
      `\n\nFix: add volatile paths to \`ignore\`, or re-record: STONETAPE_MODE=record`
    );
  }
  if (session.cassette.interactions.length === 0) {
    return header + `The cassette is empty. Record it first: STONETAPE_MODE=record`;
  }
  return (
    header +
    `No recorded request for this endpoint. ` +
    `The cassette has ${session.cassette.interactions.length} interaction(s) for other endpoints.\n` +
    `Fix: re-record this test: STONETAPE_MODE=record`
  );
}

async function captureResponse(
  response: Response,
): Promise<Interaction["response"]> {
  const headers = redactHeaders(response.headers);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    const chunks: StreamChunk[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let i = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push({ i: i++, data: decoder.decode(value, { stream: true }) });
    }
    return { status: response.status, headers, stream: chunks };
  }
  const text = await response.text();
  return { status: response.status, headers, body: redactBody(tryJson(text)) };
}

/** Rebuild a Response from a recorded interaction — streaming included. */
function materialize(interaction: Interaction): Response {
  const { response } = interaction;
  if (response.stream) {
    const encoder = new TextEncoder();
    const chunks = response.stream;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk.data));
        controller.close();
      },
    });
    return new Response(stream, {
      status: response.status,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const body =
    typeof response.body === "string" ? response.body : JSON.stringify(response.body);
  return new Response(body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalize(url: string, body: unknown): CanonicalExchange {
  const b = body as Record<string, unknown> | null;
  const model = b && typeof b.model === "string" ? b.model : undefined;
  let kind: CanonicalExchange["kind"] = "unknown";
  if (url.includes("/chat/completions") || url.includes("/messages")) kind = "chat";
  else if (url.includes("/embeddings")) kind = "embedding";
  else if (url.includes("/completions")) kind = "completion";
  const provider = url.includes("openai.com")
    ? "openai"
    : url.includes("anthropic.com")
      ? "anthropic"
      : undefined;
  const out: CanonicalExchange = { kind };
  if (provider) out.provider = provider;
  if (model !== undefined) out.model = model;
  return out;
}

function tryJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

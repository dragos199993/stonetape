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

/** Chain-order policy: `strict` = calls must replay in recorded order (chain
 * integrity for agents); `any` = fingerprint match anywhere (concurrency-safe
 * for independent parallel calls). */
export type OrderMode = "strict" | "any";

export interface TapeSession {
  /** Cassette file path — used in error messages and `stonetape diff` hints. */
  path: string;
  cassette: Cassette;
  mode: Mode;
  match: MatchOptions;
  order: OrderMode;
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
  const unconsumed = session.cassette.interactions.filter((i) => !session.consumed.has(i.seq));

  if (session.order === "strict") {
    const next = unconsumed[0];
    if (next && next.request.fingerprint === fp) {
      session.consumed.add(next.seq);
      return materialize(next);
    }
    throw new StonetapeReplayError(
      buildMismatchMessage(session, method, url, body, { strictNext: next, fp }),
    );
  }

  const hit = unconsumed.find((i) => i.request.fingerprint === fp);
  if (hit) {
    session.consumed.add(hit.seq);
    return materialize(hit);
  }
  throw new StonetapeReplayError(buildMismatchMessage(session, method, url, body, { fp }));
}

/** The error message IS the product: explain, don't just fail. */
function buildMismatchMessage(
  session: TapeSession,
  method: string,
  url: string,
  body: unknown,
  ctx: { strictNext?: Interaction | undefined; fp: string },
): string {
  const total = session.cassette.interactions.length;
  const position = session.consumed.size + 1;
  const lines: string[] = [
    `Stonetape cassette mismatch`,
    ``,
    `Cassette: ${session.path}`,
    `Expected call: ${position} of ${total}`,
    `Request: ${method} ${url}`,
    ``,
  ];

  const unconsumed = session.cassette.interactions.filter((i) => !session.consumed.has(i.seq));

  if (total === 0) {
    lines.push(`The cassette is empty — it has never been recorded.`);
  } else if (unconsumed.length === 0) {
    lines.push(
      `All ${total} recorded calls were already consumed — the app made MORE calls`,
      `than were recorded. (Did a tool or retry run twice?)`,
    );
  } else if (session.order === "strict") {
    const next = ctx.strictNext;
    const outOfOrder = unconsumed.find((i) => i.request.fingerprint === ctx.fp);
    if (outOfOrder && next) {
      lines.push(
        `This request matches recorded call ${outOfOrder.seq + 1} (${describe(outOfOrder)}),`,
        `but call ${next.seq + 1} (${describe(next)}) was expected next.`,
        `Calls arrived OUT OF ORDER — the chain changed.`,
      );
    } else if (next) {
      lines.push(`Differences vs recorded call ${next.seq + 1} (${describe(next)}):`);
      lines.push(diffAgainst(session, next, method, url, body));
    }
  } else {
    const candidate = nearestMiss(session, method, url, body, unconsumed);
    if (candidate) {
      lines.push(`Differences vs recorded call ${candidate.seq + 1} (${describe(candidate)}):`);
      lines.push(diffAgainst(session, candidate, method, url, body));
    } else {
      lines.push(
        `No recorded request for this endpoint. The cassette has ${total} interaction(s)`,
        `for other endpoints.`,
      );
    }
  }

  lines.push(
    ``,
    `Ignored fields:`,
    ...(session.match.ignore?.length
      ? session.match.ignore.map((p) => `  - ${p}`)
      : [`  (none configured — add volatile paths via \`match.ignore\`)`]),
    ``,
    `To inspect:  npx stonetape diff ${session.path}`,
    `Re-record:   STONETAPE_MODE=record vitest`,
  );
  return lines.join("\n");
}

function describe(i: Interaction): string {
  const c = i.canonical;
  if (!c) return "unknown";
  return [c.kind, c.model].filter(Boolean).join(" ");
}

function diffAgainst(
  session: TapeSession,
  recorded: Interaction,
  method: string,
  url: string,
  body: unknown,
): string {
  const recordedNorm = normalizeRequest(
    recorded.request.method,
    recorded.request.url,
    recorded.request.body,
    session.match,
  );
  const incomingNorm = normalizeRequest(method, url, body, session.match);
  if (recordedNorm.url !== incomingNorm.url || recordedNorm.method !== incomingNorm.method) {
    return `  endpoint differs:\n    recorded: ${recordedNorm.method} ${recordedNorm.url}\n    incoming: ${incomingNorm.method} ${incomingNorm.url}`;
  }
  return formatDifferences(explainDiff(recordedNorm.body, incomingNorm.body));
}

function nearestMiss(
  session: TapeSession,
  method: string,
  url: string,
  body: unknown,
  unconsumed: Interaction[],
): Interaction | undefined {
  const norm = normalizeRequest(method, url, body, session.match);
  return unconsumed.find((i) => {
    const c = normalizeRequest(i.request.method, i.request.url, i.request.body, session.match);
    return c.method === norm.method && c.url === norm.url;
  });
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

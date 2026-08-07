/**
 * stonetape proxy — process-level recording/replay (issue #4).
 *
 * A recording/replaying REVERSE proxy: point any process at it via its
 * provider base-URL env (OPENAI_BASE_URL, ANTHROPIC_BASE_URL, gateway URL
 * config, ...) and its LLM traffic records to / replays from a cassette —
 * regardless of language or process boundary. No TLS MITM, no CA certs:
 * base-URL redirection instead of CONNECT tunneling.
 *
 *   record: client → stonetape proxy → real upstream   (cassette written)
 *   replay: client → stonetape proxy → cassette        (upstream not needed)
 *
 * The proxy is deliberately a thin HTTP frontend over the same tape engine
 * the in-process transport uses — matching, ordering, redaction, mismatch
 * explanations and fail-closed semantics are identical.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type Tape, type TapeOptions, isCassetteMismatch, openCassette, unwrapMismatch } from "../index.js";

export interface ProxyOptions extends TapeOptions {
  /** Cassette file path. */
  cassette: string;
  /** Upstream base URL, e.g. https://api.openai.com (required in record mode). */
  target: string;
  /** Port to listen on. Default 0 (ephemeral). */
  port?: number;
}

export interface ProxyHandle {
  url: string;
  port: number;
  tape: Tape;
  close(): Promise<void>;
}

/** Hop-by-hop headers that must not be forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const target = new URL(options.target);
  const tape = openCassette(options.cassette, options);

  const server: Server = createServer(async (req, res) => {
    try {
      await handle(req, res, target, tape);
    } catch (err) {
      if (isCassetteMismatch(err)) {
        const mismatch = unwrapMismatch(err);
        // Surface the full explanation both to the caller and the operator.
        process.stderr.write(`\n${mismatch?.message ?? String(err)}\n`);
        res.writeHead(501, { "content-type": "text/plain" });
        res.end(mismatch?.message ?? String(err));
      } else {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`stonetape proxy upstream error: ${String(err)}`);
      }
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    tape,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      tape.close();
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  target: URL,
  tape: Tape,
): Promise<void> {
  const url = new URL(req.url ?? "/", target).toString();

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase()) || value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const response = await tape.fetch(url, {
    method: req.method ?? "GET",
    headers,
    body: body.length > 0 ? body : null,
  });

  const outHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders[key] = value;
  });
  res.writeHead(response.status, outHeaders);

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value); // stream through — SSE chunk boundaries preserved
    }
  }
  res.end();
}

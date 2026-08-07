/**
 * Proxy-mode tests (issue #4): process-level record/replay through the
 * reverse proxy. The "client" here talks to the proxy over real HTTP —
 * exactly what an external process (any language) would do.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startProxy } from "../src/proxy/server.js";

let upstream: Server;
let upstreamUrl: string;
let upstreamHits = 0;
const dir = mkdtempSync(join(tmpdir(), "stonetape-proxy-"));
const cassettePath = join(dir, "proxied.yaml");

beforeAll(async () => {
  upstream = createServer((req, res) => {
    upstreamHits++;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/v1/stream") {
        res.setHeader("content-type", "text/event-stream");
        res.write('data: {"delta":"hel"}\n\n');
        res.write('data: {"delta":"lo"}\n\n');
        res.end("data: [DONE]\n\n");
        return;
      }
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ echo: body.q, path: req.url }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, () => resolve()));
  const address = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  upstream?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("stonetape proxy (process-level record/replay)", () => {
  it("records an external client's traffic through the proxy", async () => {
    const proxy = await startProxy({
      cassette: cassettePath,
      target: upstreamUrl,
      mode: "record",
    });
    // an "external process": plain HTTP against the proxy port
    const r1 = await fetch(`${proxy.url}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-proxy-secret-12345" },
      body: JSON.stringify({ q: "hello" }),
    });
    expect(((await r1.json()) as { echo: string }).echo).toBe("hello");

    const r2 = await fetch(`${proxy.url}/v1/stream`, { method: "POST", body: "{}" });
    expect(await r2.text()).toContain('data: {"delta":"hel"}');
    await proxy.close();

    const raw = readFileSync(cassettePath, "utf8");
    expect(raw).not.toContain("sk-proxy-secret");
    expect(raw).toContain("[REDACTED]");
  });

  it("replays for an external client with the upstream DEAD", async () => {
    upstream.close(); // no more real backend from here on
    const hitsBefore = upstreamHits;

    const proxy = await startProxy({
      cassette: cassettePath,
      target: upstreamUrl, // resolves, but nothing listens — must not matter
      mode: "replay",
    });
    const r1 = await fetch(`${proxy.url}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "hello" }),
    });
    expect(((await r1.json()) as { echo: string }).echo).toBe("hello");

    const r2 = await fetch(`${proxy.url}/v1/stream`, { method: "POST", body: "{}" });
    expect(r2.headers.get("content-type")).toContain("text/event-stream");
    expect(await r2.text()).toContain("[DONE]");

    expect(upstreamHits).toBe(hitsBefore); // zero real network
    await proxy.close();
  });

  it("answers unrecorded requests with 501 + the mismatch explanation", async () => {
    const proxy = await startProxy({
      cassette: cassettePath,
      target: upstreamUrl,
      mode: "replay",
    });
    const res = await fetch(`${proxy.url}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "NEVER RECORDED" }),
    });
    expect(res.status).toBe(501);
    const text = await res.text();
    expect(text).toContain("Stonetape cassette mismatch");
    expect(text).toContain("recorded: hello");
    await proxy.close();
  });
});

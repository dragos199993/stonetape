/**
 * Regression tests for the first real-world dogfood findings (issues #1, #3):
 *  - resilient apps swallow StonetapeReplayError → the vitest helper surfaces it
 *  - JWTs in response bodies and stream chunks must be redacted
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCassette } from "../src/index.js";
import { cassette } from "../src/runner/vitest.js";

const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";

let server: Server;
let baseUrl: string;
const dir = mkdtempSync(join(tmpdir(), "stonetape-dogfood-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/token") {
        // token-vending endpoint: JWT in the RESPONSE body
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: FAKE_JWT, expires_in: 3600 }));
      } else if (req.url === "/stream") {
        // SSE stream that leaks a JWT mid-stream
        res.setHeader("content-type", "text/event-stream");
        res.write(`data: {"token":"${FAKE_JWT}"}\n\n`);
        res.end("data: [DONE]\n\n");
      } else {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ echo: JSON.parse(raw || "{}").step ?? null }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("redaction of minted tokens (issue #3)", () => {
  it("JWTs in response bodies and stream chunks never touch disk", async () => {
    const path = join(dir, "token-vend.yaml");
    const tape = openCassette(path, { mode: "record" });
    await tape.fetch(`${baseUrl}/token`, { method: "POST", body: "{}" });
    await tape.fetch(`${baseUrl}/stream`, { method: "POST", body: "{}" });
    tape.close();

    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(FAKE_JWT);
    expect(raw).toContain("[REDACTED]");
  });
});

describe("swallowed mismatches (issue #1)", () => {
  it("the vitest helper surfaces mismatches the app swallowed", async () => {
    // record one legitimate call
    const path = join(dir, "swallow.yaml");
    const rec = openCassette(path, { mode: "record" });
    await rec.fetch(`${baseUrl}/v1/chat`, { method: "POST", body: JSON.stringify({ step: "a" }) });
    rec.close();

    // a "resilient app": catches ANY upstream error and falls back gracefully
    const run = cassette(
      "swallow",
      async ({ fetch }) => {
        const res = await fetch(`${baseUrl}/v1/chat`, {
          method: "POST",
          body: JSON.stringify({ step: "DIFFERENT" }), // drifted request
        }).catch(() => new Response("fallback", { status: 502 }));
        expect(res.status).toBe(502); // the app is happy; the test body passes
      },
      { dir, mode: "replay" },
    );

    // ...but the tape knows the truth, and the helper tells it
    await expect(run()).rejects.toThrow(/swallowed this error/);
    await expect(run()).rejects.toThrow(/Expected call: 1 of 1/);
  });

  it("does not double-report when the test itself already failed", async () => {
    const run = cassette(
      "swallow",
      async ({ fetch }) => {
        await fetch(`${baseUrl}/v1/chat`, {
          method: "POST",
          body: JSON.stringify({ step: "DIFFERENT" }),
        }); // not swallowed: propagates
      },
      { dir, mode: "replay" },
    );
    await expect(run()).rejects.toThrow(/Stonetape cassette mismatch/);
  });
});

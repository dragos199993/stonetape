/**
 * Session/chain semantics — the foundation for agent-chain regression
 * detection (Demo 2 of the falsification sprint):
 *   - strict order (default): reordered chains fail with an "out of order" explanation
 *   - duplicated calls fail with "more calls than recorded"
 *   - the mismatch error carries chain position, ignored fields, and the diff hint
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StonetapeReplayError, openCassette } from "../src/index.js";

let server: Server;
let baseUrl: string;
const dir = mkdtempSync(join(tmpdir(), "stonetape-session-"));
const cassettePath = join(dir, "chain.yaml");

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ echo: body.step }));
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

function call(tapeFetch: typeof fetch, step: string) {
  return tapeFetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-test", step }),
  });
}

describe("agent chain semantics", () => {
  it("records a 3-call chain", async () => {
    const tape = openCassette(cassettePath, { mode: "record" });
    await call(tape.fetch, "plan");
    await call(tape.fetch, "tool");
    await call(tape.fetch, "answer");
    tape.close();
  });

  it("replays the chain in order", async () => {
    const tape = openCassette(cassettePath, { mode: "replay" });
    const r1 = (await (await call(tape.fetch, "plan")).json()) as { echo: string };
    const r2 = (await (await call(tape.fetch, "tool")).json()) as { echo: string };
    const r3 = (await (await call(tape.fetch, "answer")).json()) as { echo: string };
    expect([r1.echo, r2.echo, r3.echo]).toEqual(["plan", "tool", "answer"]);
    tape.close();
  });

  it("strict order (default): reordered chain fails with an out-of-order explanation", async () => {
    const tape = openCassette(cassettePath, { mode: "replay" });
    await call(tape.fetch, "plan");
    // orchestration bug: step 3 fires before step 2
    const err = await call(tape.fetch, "answer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonetapeReplayError);
    const msg = (err as Error).message;
    expect(msg).toContain("Expected call: 2 of 3");
    expect(msg).toContain("OUT OF ORDER");
    expect(msg).toContain("stonetape diff");
    tape.close();
  });

  it("order: any — reordered independent calls are fine", async () => {
    const tape = openCassette(cassettePath, { mode: "replay", order: "any" });
    const r3 = (await (await call(tape.fetch, "answer")).json()) as { echo: string };
    const r1 = (await (await call(tape.fetch, "plan")).json()) as { echo: string };
    expect([r3.echo, r1.echo]).toEqual(["answer", "plan"]);
    tape.close();
  });

  it("duplicated call fails with 'more calls than recorded'", async () => {
    const tape = openCassette(cassettePath, { mode: "replay" });
    await call(tape.fetch, "plan");
    await call(tape.fetch, "tool");
    await call(tape.fetch, "answer");
    // orchestration bug: a step runs twice
    const err = await call(tape.fetch, "answer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonetapeReplayError);
    expect((err as Error).message).toContain("MORE calls");
    tape.close();
  });

  it("body drift fails with a field-level diff and chain position", async () => {
    const tape = openCassette(cassettePath, { mode: "replay" });
    const err = await call(tape.fetch, "plan-CHANGED").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonetapeReplayError);
    const msg = (err as Error).message;
    expect(msg).toContain("Expected call: 1 of 3");
    expect(msg).toContain("at step:");
    expect(msg).toContain("recorded: plan");
    expect(msg).toContain("incoming: plan-CHANGED");
    tape.close();
  });
});

describe("mixed ordering: strict chain + declared-concurrent endpoints (issue #2)", () => {
  const mixedPath = join(dir, "mixed.yaml");

  function callUrl(tapeFetch: typeof fetch, path: string, step: string) {
    return tapeFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", step }),
    });
  }

  it("records a chain with a fire-and-forget telemetry call in the middle", async () => {
    const tape = openCassette(mixedPath, { mode: "record" });
    await callUrl(tape.fetch, "/v1/chat", "plan");
    await callUrl(tape.fetch, "/telemetry", "fire-and-forget");
    await callUrl(tape.fetch, "/v1/chat", "answer");
    tape.close();
  });

  it("replays with telemetry arriving late — strict chain intact, concurrent exempt", async () => {
    const tape = openCassette(mixedPath, {
      mode: "replay",
      order: { mode: "strict", concurrent: ["/telemetry"] },
    });
    await callUrl(tape.fetch, "/v1/chat", "plan");
    await callUrl(tape.fetch, "/v1/chat", "answer"); // chain continues before telemetry lands
    await callUrl(tape.fetch, "/telemetry", "fire-and-forget"); // arrives whenever
    tape.close();
  });

  it("plain strict (no exemption) fails on the same interleaving", async () => {
    const tape = openCassette(mixedPath, { mode: "replay" });
    await callUrl(tape.fetch, "/v1/chat", "plan");
    const err = await callUrl(tape.fetch, "/v1/chat", "answer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonetapeReplayError);
    expect((err as Error).message).toContain("OUT OF ORDER");
    tape.close();
  });

  it("still catches chain regressions among the strict subset", async () => {
    const tape = openCassette(mixedPath, {
      mode: "replay",
      order: { mode: "strict", concurrent: ["/telemetry"] },
    });
    // orchestration bug: the chain calls arrive reversed
    const err = await callUrl(tape.fetch, "/v1/chat", "answer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonetapeReplayError);
    expect((err as Error).message).toContain("OUT OF ORDER");
    tape.close();
  });
});

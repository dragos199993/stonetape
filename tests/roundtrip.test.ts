/**
 * Dogfood test: the full record → replay loop against a local fake LLM server.
 *
 * This is the demo GIF in test form:
 *  1. record against a real (local) HTTP server,
 *  2. kill the server,
 *  3. replay with the network dead — same responses, zero calls,
 *  4. fail-closed: unrecorded requests throw with an explanation.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StonetapeReplayError, openCassette } from "../src/index.js";

let server: Server;
let baseUrl: string;
let hits = 0;
const dir = mkdtempSync(join(tmpdir(), "stonetape-"));
const cassettePath = join(dir, "chat.yaml");

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          model: body.model,
          choices: [{ message: { role: "assistant", content: `echo: ${body.messages?.[0]?.content}` } }],
        }),
      );
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

async function callChat(tapeFetch: typeof fetch, content: string) {
  const res = await tapeFetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-verysecret123456789" },
    body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content }] }),
  });
  return res.json() as Promise<{ choices: Array<{ message: { content: string } }> }>;
}

describe("record → replay roundtrip", () => {
  it("records real interactions to a cassette", async () => {
    const tape = openCassette(cassettePath, { mode: "record" });
    const json = await callChat(tape.fetch, "hello stonetape");
    tape.close();
    expect(json.choices[0]?.message.content).toBe("echo: hello stonetape");
    expect(hits).toBe(1);
  });

  it("replays without touching the network", async () => {
    const hitsBefore = hits;
    server.close(); // network is DEAD from here on
    const tape = openCassette(cassettePath, { mode: "replay" });
    const json = await callChat(tape.fetch, "hello stonetape");
    tape.close();
    expect(json.choices[0]?.message.content).toBe("echo: hello stonetape");
    expect(hits).toBe(hitsBefore); // zero new network calls
  });

  it("fails closed with an explanation on unrecorded requests", async () => {
    const tape = openCassette(cassettePath, { mode: "replay" });
    await expect(callChat(tape.fetch, "a DIFFERENT prompt")).rejects.toThrow(
      StonetapeReplayError,
    );
    await expect(callChat(tape.fetch, "a DIFFERENT prompt")).rejects.toThrow(
      /Differences vs recorded call/,
    );
    tape.close();
  });

  it("never persists secrets into cassettes", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(cassettePath, "utf8");
    expect(raw).not.toContain("sk-verysecret123456789");
    expect(raw).toContain("[REDACTED]");
  });
});

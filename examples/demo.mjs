/**
 * stonetape playground — run it: `npm run demo`
 *
 * No API key needed: a local fake "OpenAI" server plays the provider.
 * Walks the full loop: record → replay offline → chain regression → safety.
 */
import { createServer } from "node:http";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { openCassette, StonetapeReplayError } from "../dist/index.js";

const CASSETTE = "examples/cassettes/weather-agent.yaml";
rmSync("examples/cassettes", { recursive: true, force: true });
mkdirSync("examples/cassettes", { recursive: true });

// ── a local fake "OpenAI" ──────────────────────────────────────────────────
const srv = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const lastMsg = body.messages.at(-1);
    res.setHeader("content-type", "application/json");
    if (lastMsg.role === "user") {
      // first call: the model requests a tool
      res.end(JSON.stringify({
        id: "chatcmpl-1", model: body.model,
        choices: [{ message: { role: "assistant", tool_calls: [
          { id: "call_1", type: "function",
            function: { name: "getWeather", arguments: '{"city":"Cluj","units":"metric"}' } },
        ] } }],
        usage: { prompt_tokens: 42, completion_tokens: 18 },
      }));
    } else {
      // second call: the model answers based on the tool result
      res.end(JSON.stringify({
        id: "chatcmpl-2", model: body.model,
        choices: [{ message: { role: "assistant", content: "It's 21°C and sunny in Cluj." } }],
        usage: { prompt_tokens: 61, completion_tokens: 12 },
      }));
    }
  });
});
await new Promise((r) => srv.listen(0, r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

// ── our "agent": 2 LLM calls + 1 local tool call ──────────────────────────
async function runAgent(tapeFetch, question) {
  const messages = [{ role: "user", content: question }];
  const r1 = await (await tapeFetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-demo-secret-123456" },
    body: JSON.stringify({ model: "gpt-5.2", messages, tools: [{ name: "getWeather" }] }),
  })).json();

  const toolCall = r1.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  const toolResult = { temp: 21, sky: "sunny", city: args.city }; // "real" local tool

  messages.push(r1.choices[0].message);
  messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) });

  const r2 = await (await tapeFetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-demo-secret-123456" },
    body: JSON.stringify({ model: "gpt-5.2", messages }),
  })).json();
  return r2.choices[0].message.content;
}

const step = (n, t) => console.log(`\n\x1b[1m━━ ${n}. ${t} ━━\x1b[0m`);

// 1 ─ RECORD
step(1, "RECORD — the agent runs against the 'real API' (local server)");
let tape = openCassette(CASSETTE, { mode: "record" });
console.log("→ agent:", await runAgent(tape.fetch, "What's the weather in Cluj?"));
tape.close();
console.log(`✓ cassette written: ${CASSETTE}`);

// 2 ─ REPLAY offline
step(2, "REPLAY — the server is DEAD, there is no network");
srv.close();
tape = openCassette(CASSETTE, { mode: "replay" });
const t0 = performance.now();
console.log("→ agent:", await runAgent(tape.fetch, "What's the weather in Cluj?"));
console.log(`✓ full chain (2 LLM calls + tool) replayed offline in ${(performance.now() - t0).toFixed(1)}ms`);
tape.close();

// 3 ─ chain REGRESSION: the tool result is dropped
step(3, "REGRESSION — orchestration bug: the tool result is no longer passed");
tape = openCassette(CASSETTE, { mode: "replay" });
try {
  const messages = [{ role: "user", content: "What's the weather in Cluj?" }];
  await (await tape.fetch(`${BASE}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.2", messages, tools: [{ name: "getWeather" }] }),
  })).json();
  // BUG: the second call goes out WITHOUT the tool message → different fingerprint
  await (await tape.fetch(`${BASE}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.2", messages }),
  })).json();
} catch (e) {
  if (!(e instanceof StonetapeReplayError)) throw e;
  console.log("\x1b[31m" + e.message + "\x1b[0m");
}
tape.close();

// 4 ─ secrets never touch disk
step(4, "SAFETY — the API key does not exist in the cassette");
const rawCassette = readFileSync(CASSETTE, "utf8");
console.log(rawCassette.includes("sk-demo-secret") ? "✗ LEAK!" : "✓ 'sk-demo-secret…' is absent; authorization: [REDACTED]");

console.log("\nInspect the cassette:  npx stonetape diff " + CASSETTE);
console.log("Or just open it:       cat " + CASSETTE + "\n");

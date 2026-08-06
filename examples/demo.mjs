/**
 * stonetape playground — run it: `npm run demo`
 *
 * No API key needed: a local fake "OpenAI" server plays the provider.
 * Walks the full loop: record → replay offline → chain regression → diff.
 */
import { createServer } from "node:http";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { openCassette, StonetapeReplayError } from "../dist/index.js";

const CASSETTE = "examples/cassettes/weather-agent.yaml";
rmSync("examples/cassettes", { recursive: true, force: true });
mkdirSync("examples/cassettes", { recursive: true });

// ── un "OpenAI" local ──────────────────────────────────────────────────────
const srv = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const lastMsg = body.messages.at(-1);
    res.setHeader("content-type", "application/json");
    if (lastMsg.role === "user") {
      // primul apel: modelul cere tool-ul
      res.end(JSON.stringify({
        id: "chatcmpl-1", model: body.model,
        choices: [{ message: { role: "assistant", tool_calls: [
          { id: "call_1", type: "function",
            function: { name: "getWeather", arguments: '{"city":"Cluj","units":"metric"}' } },
        ] } }],
        usage: { prompt_tokens: 42, completion_tokens: 18 },
      }));
    } else {
      // al doilea apel: modelul răspunde pe baza tool result-ului
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

// ── "agentul" nostru: 2 apeluri LLM + 1 tool call local ──────────────────
async function runAgent(tapeFetch, question) {
  const messages = [{ role: "user", content: question }];
  const r1 = await (await tapeFetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-demo-secret-123456" },
    body: JSON.stringify({ model: "gpt-5.2", messages, tools: [{ name: "getWeather" }] }),
  })).json();

  const toolCall = r1.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  const toolResult = { temp: 21, sky: "sunny", city: args.city }; // tool "real", local

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
step(1, "RECORD — agentul rulează pe 'API-ul real' (serverul local)");
let tape = openCassette(CASSETTE, { mode: "record" });
console.log("→ agent:", await runAgent(tape.fetch, "What's the weather in Cluj?"));
tape.close();
console.log(`✓ casetă scrisă: ${CASSETTE}`);

// 2 ─ REPLAY offline
step(2, "REPLAY — serverul e MORT, rețeaua nu există");
srv.close();
tape = openCassette(CASSETTE, { mode: "replay" });
const t0 = performance.now();
console.log("→ agent:", await runAgent(tape.fetch, "What's the weather in Cluj?"));
console.log(`✓ chain complet (2 apeluri LLM + tool) redat offline în ${(performance.now() - t0).toFixed(1)}ms`);
tape.close();

// 3 ─ REGRESIE de chain: sărim tool result-ul
step(3, "REGRESIE — bug de orchestrare: tool result-ul nu mai e transmis");
tape = openCassette(CASSETTE, { mode: "replay" });
try {
  const messages = [{ role: "user", content: "What's the weather in Cluj?" }];
  await (await tape.fetch(`${BASE}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.2", messages, tools: [{ name: "getWeather" }] }),
  })).json();
  // BUG: al doilea apel pleacă FĂRĂ mesajul tool → alt fingerprint
  await (await tape.fetch(`${BASE}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.2", messages }),
  })).json();
} catch (e) {
  if (!(e instanceof StonetapeReplayError)) throw e;
  console.log("\x1b[31m" + e.message + "\x1b[0m");
}
tape.close();

// 4 ─ secretele nu ating discul
step(4, "SIGURANȚĂ — cheia de API nu există în casetă");
const rawCassette = readFileSync(CASSETTE, "utf8");
console.log(rawCassette.includes("sk-demo-secret") ? "✗ LEAK!" : "✓ 'sk-demo-secret…' nu apare; authorization: [REDACTED]");

console.log("\nInspectează caseta:  npx stonetape diff " + CASSETTE);
console.log("Sau deschide-o:      cat " + CASSETTE + "\n");

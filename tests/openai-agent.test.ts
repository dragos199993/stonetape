/**
 * Demo 2 (falsification sprint): a REAL OpenAI SDK agent — 2 LLM calls + 1
 * local tool call — recorded once against the live API, replayed offline
 * forever.
 *
 * Record (once, needs a key, costs ~$0.01):
 *   OPENAI_API_KEY=sk-... npm run record:agent
 * Then commit tests/cassettes/openai-weather-agent.yaml and replay free:
 *   npm test
 *
 * These tests SKIP (loudly) until the cassette exists — they never silently
 * hit the network in CI.
 */
import { existsSync } from "node:fs";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { StonetapeReplayError, openCassette, unwrapMismatch, type Tape } from "../src/index.js";
import { loadCassette } from "../src/store/fs.js";

const CASSETTE = "tests/cassettes/openai-weather-agent.yaml";
const RECORDING = process.env.STONETAPE_MODE === "record";
const HAVE_CASSETTE = existsSync(CASSETTE);

// Replay must send byte-identical requests, so the model name comes from the
// cassette itself when available (self-healing across whatever you recorded).
// Default: gpt-5.6-luna — the cheapest 5.6-line model ($0.20/$1.20 per MTok),
// plenty for a weather tool call.
const MODEL =
  loadCassette(CASSETTE)?.interactions[0]?.canonical?.model ??
  process.env.OPENAI_MODEL ??
  "gpt-5.6-luna";

// ── the agent under test ───────────────────────────────────────────────────

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

interface AgentResult {
  answer: string | null;
  toolExecutions: number;
}

async function runWeatherAgent(
  tape: Tape,
  question: string,
  opts: { dropToolResult?: boolean } = {},
): Promise<AgentResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "stonetape-replay-no-key-needed",
    fetch: tape.fetch,
    // In replay, a mismatch is deterministic — retrying it only wastes time.
    maxRetries: 0,
  });

  let toolExecutions = 0;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: question },
  ];

  const first = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    // gpt-5.6 line: function tools on /v1/chat/completions require
    // reasoning_effort "none" (real API constraint, discovered on record)
    reasoning_effort: "none",
  });
  const assistantMsg = first.choices[0]?.message;
  if (!assistantMsg) throw new Error("no assistant message");
  const toolCall = assistantMsg.tool_calls?.[0];

  if (toolCall && toolCall.type === "function") {
    // execute the REAL local tool
    const args = JSON.parse(toolCall.function.arguments) as { city: string };
    const result = { city: args.city, temp_c: 21, sky: "sunny" };
    toolExecutions++;

    messages.push(assistantMsg);
    if (!opts.dropToolResult) {
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    const second = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      reasoning_effort: "none",
    });
    return { answer: second.choices[0]?.message.content ?? null, toolExecutions };
  }
  return { answer: assistantMsg.content ?? null, toolExecutions };
}

// ── tests ──────────────────────────────────────────────────────────────────

if (!HAVE_CASSETTE && !RECORDING) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[stonetape] ${CASSETTE} not recorded yet — skipping Demo 2 tests.\n` +
      `[stonetape] Record it once: OPENAI_API_KEY=sk-... npm run record:agent\n`,
  );
}

describe.skipIf(!HAVE_CASSETTE && !RECORDING)("real OpenAI agent (Demo 2)", () => {
  it("answers a weather question via one real tool call", async () => {
    const tape = openCassette(CASSETTE, RECORDING ? { mode: "record" } : { mode: "replay" });
    try {
      const result = await runWeatherAgent(tape, "What is the weather in Cluj right now?");
      expect(result.toolExecutions).toBe(1); // the model asked for the tool
      expect(result.answer).toBeTruthy(); // and produced a final answer from its result
    } finally {
      tape.close();
    }
  });

  it("replay is hermetic: the underlying network is unreachable on purpose", async () => {
    const bomb: typeof fetch = () => {
      throw new Error("BOOM: unrecorded network attempt escaped replay");
    };
    const tape = openCassette(CASSETTE, { mode: "replay", fetch: bomb });
    try {
      const result = await runWeatherAgent(tape, "What is the weather in Cluj right now?");
      expect(result.answer).toBeTruthy();
    } finally {
      tape.close();
    }
  });

  it("chain regression: dropping the tool result fails with a field-level diff", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const err = await runWeatherAgent(tape, "What is the weather in Cluj right now?", {
        dropToolResult: true,
      }).catch((e: unknown) => e);
      // Real SDKs wrap fetch errors (openai: APIConnectionError) — unwrap the cause chain.
      const mismatch = unwrapMismatch(err);
      expect(mismatch).toBeInstanceOf(StonetapeReplayError);
      expect(mismatch?.message).toContain("Expected call: 2 of 2");
      expect(mismatch?.message).toContain("(missing)"); // the tool message is gone from messages[]
    } finally {
      tape.close();
    }
  });
});

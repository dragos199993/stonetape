/**
 * Demo 1 (falsification sprint): the mock that lies vs the cassette that doesn't.
 *
 * Same app code, two test strategies:
 *   Variant A — a hand-written mock (what openai-SDK users actually do today)
 *   Variant B — stonetape replaying the REAL gpt-5.6-luna cassette from Demo 2
 *
 * The app code contains two bugs that are extremely common in the wild:
 *   Bug A: assumes `message.content` is always a string
 *          (real tool-call turns have `content: null`)
 *   Bug B: assumes `tool_call.function.arguments` is an object
 *          (the real API sends a STRING of JSON)
 *
 * The mock — written from the developer's imagination — passes both.
 * The cassette — recorded from reality — catches both.
 *
 * Thesis under test: "Mocks test scenarios you imagined. Stonetape preserves
 * the messy ones that actually happened."
 */
import { existsSync } from "node:fs";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { openCassette, unwrapMismatch, type Tape } from "../src/index.js";
import { loadCassette } from "../src/store/fs.js";

const CASSETTE = "tests/cassettes/openai-weather-agent.yaml";
const HAVE_CASSETTE = existsSync(CASSETTE);
const MODEL = loadCassette(CASSETTE)?.interactions[0]?.canonical?.model ?? "gpt-5.6-luna";
const QUESTION = "What is the weather in Cluj right now?";

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

// ── the app code under test ────────────────────────────────────────────────

type Bugs = { assumeContentIsString?: boolean; assumeArgsAreObject?: boolean };

async function weatherAgent(fetchImpl: typeof fetch, bugs: Bugs = {}): Promise<string | null> {
  const client = new OpenAI({ apiKey: "test-key", fetch: fetchImpl, maxRetries: 0 });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: QUESTION },
  ];

  const first = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    reasoning_effort: "none",
  });
  const assistantMsg = first.choices[0]!.message;

  // Bug A: on tool-call turns the REAL API sends content: null.
  // Mock authors imagine a friendly progress string.
  const progressLog = bugs.assumeContentIsString
    ? assistantMsg.content!.trim() // 💥 TypeError on the real payload
    : (assistantMsg.content ?? "").trim();
  void progressLog;

  const toolCall = assistantMsg.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return assistantMsg.content;

  // Bug B: the REAL API sends arguments as a STRING of JSON.
  // Mock authors imagine a parsed object.
  const args = bugs.assumeArgsAreObject
    ? (toolCall.function.arguments as unknown as { city: string }) // 💥 args.city === undefined
    : (JSON.parse(toolCall.function.arguments) as { city: string });

  const toolResult = { city: args.city, temp_c: 21, sky: "sunny" };
  messages.push(assistantMsg);
  messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) });

  const second = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    reasoning_effort: "none",
  });
  return second.choices[0]!.message.content;
}

// ── Variant A: the hand-written mock ──────────────────────────────────────────
// This author even did their homework: arguments is a proper JSON string,
// copied from the docs. The mock still lies twice:
//   1. content is an imagined progress string — the real API sends null
//   2. the mock never VALIDATES the second request — whatever broken
//      conversation your code sends back, it cheerfully answers

const imaginedMock: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    messages: Array<{ role: string }>;
  };
  const isSecondCall = body.messages.some((m) => m.role === "tool");
  if (!isSecondCall) {
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Checking the weather for you...", // imagined: real is null
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Cluj"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  }
  return Response.json({
    choices: [{ message: { role: "assistant", content: "It's sunny in Cluj." } }],
  });
};

// ── the comparison ─────────────────────────────────────────────────────────

describe.skipIf(!HAVE_CASSETTE)("Demo 1: hand-written mock vs stonetape cassette", () => {
  it("the mock passes BOTH buggy variants — the bugs ship", async () => {
    const withBugA = await weatherAgent(imaginedMock, { assumeContentIsString: true });
    const withBugB = await weatherAgent(imaginedMock, { assumeArgsAreObject: true });
    expect(withBugA).toBeTruthy(); // green. bug invisible.
    expect(withBugB).toBeTruthy(); // green: the mock answers even a broken conversation.
  });

  it("the cassette catches Bug A: content is null on real tool-call turns", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const err = await weatherAgent(tape.fetch, { assumeContentIsString: true }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(TypeError); // .trim() on null — a real crash, caught in CI
    } finally {
      tape.close();
    }
  });

  it("the cassette catches Bug B: arguments-as-object loses the city, chain diff names it", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const err = await weatherAgent(tape.fetch, { assumeArgsAreObject: true }).catch(
        (e: unknown) => e,
      );
      const mismatch = unwrapMismatch(err);
      expect(mismatch).toBeDefined();
      expect(mismatch?.message).toContain("Expected call: 2 of 2");
      expect(mismatch?.message).toContain("Cluj"); // the diff shows exactly what got lost
    } finally {
      tape.close();
    }
  });

  it("the cassette passes the CORRECT implementation", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const answer = await weatherAgent(tape.fetch);
      expect(answer).toBeTruthy();
    } finally {
      tape.close();
    }
  });
});

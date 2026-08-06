/**
 * Shared agent for the GIF demo (tests/gif/*.test.ts).
 * Same code as Demo 1, packaged for the three-act recording:
 *   act 1: buggy agent + hand-written mock  → green (the lie)
 *   act 2: buggy agent + real cassette      → red, mismatch names the bug
 *   act 3: fixed agent + real cassette      → green, offline
 */
import OpenAI from "openai";
import { loadCassette } from "../../src/store/fs.js";

export const CASSETTE = "tests/cassettes/openai-weather-agent.yaml";
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

export async function weatherAgent(
  fetchImpl: typeof fetch,
  opts: { buggy?: boolean } = {},
): Promise<string | null> {
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
  const toolCall = assistantMsg.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return assistantMsg.content;

  // THE BUG: treats `arguments` (a JSON string) as an object → city is lost
  const args = opts.buggy
    ? (toolCall.function.arguments as unknown as { city: string })
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

/** The mock a diligent developer writes — and it still lies. */
export const handWrittenMock: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string }> };
  if (!body.messages.some((m) => m.role === "tool")) {
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Checking the weather...",
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
